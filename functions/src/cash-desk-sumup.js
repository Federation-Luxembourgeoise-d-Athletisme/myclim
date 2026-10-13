// ── Caisse jour J : paiement par terminal SumUp Solo (Cloud API) ────────────
// Chaque poste de caisse peut être appairé à un Solo. La caisse envoie le
// panier ; le serveur recalcule le total à partir de cashArticles (jamais à
// partir des prix envoyés par le navigateur), crée la vente « pending » et
// pousse le montant sur le Solo. SumUp rappelle sumupWebhook à la fin du
// paiement ; ce webhook n'est pas signé, donc la vente n'est marquée payée
// qu'après relecture de la transaction via l'API Transactions.
//
// Configuration (une fois, valeurs jamais commitées) :
//   firebase functions:secrets:set SUMUP_API_KEY
//   firebase functions:secrets:set SUMUP_MERCHANT_CODE
//   firebase functions:secrets:set SUMUP_AFFILIATE_KEY
//   firebase functions:secrets:set SUMUP_AFFILIATE_APP_ID
/* global process */

import admin from "firebase-admin";
import { HttpsError, onCall, onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { logger } from "firebase-functions";

const REGION = "europe-west1";
// SUMUP_API_BASE_URL ne sert qu'aux tests locaux (faux serveur SumUp + émulateurs).
const SUMUP_API_BASE = process.env.SUMUP_API_BASE_URL || "https://api.sumup.com";
const MAX_QUANTITY_PER_ARTICLE = 50;
// Sans transaction trouvée chez SumUp après ce délai, la demande est
// considérée comme abandonnée (le Solo n'accepte un paiement que 60 s).
const ORPHAN_CHECKOUT_MS = 3 * 60 * 1000;

const sumupApiKey = defineSecret("SUMUP_API_KEY");
const sumupMerchantCode = defineSecret("SUMUP_MERCHANT_CODE");
const sumupAffiliateKey = defineSecret("SUMUP_AFFILIATE_KEY");
const sumupAffiliateAppId = defineSecret("SUMUP_AFFILIATE_APP_ID");
const SUMUP_SECRETS = [sumupApiKey, sumupMerchantCode, sumupAffiliateKey, sumupAffiliateAppId];

function firestore() {
  return admin.firestore();
}

function serverTimestamp() {
  return admin.firestore.FieldValue.serverTimestamp();
}

function normalizeEditionId(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, "-") || "test";
}

function getProjectId() {
  if (process.env.GCLOUD_PROJECT) return process.env.GCLOUD_PROJECT;
  try {
    return JSON.parse(process.env.FIREBASE_CONFIG || "{}").projectId || "";
  } catch {
    return "";
  }
}

function getWebhookUrl() {
  return `https://${REGION}-${getProjectId()}.cloudfunctions.net/sumupWebhook`;
}

function assertSumupConfigured() {
  const missing = SUMUP_SECRETS.filter((secret) => !String(secret.value() || "").trim()).map((secret) => secret.name);
  if (missing.length) {
    logger.error("SumUp secrets missing", { missing });
    throw new HttpsError("failed-precondition", "Le paiement SumUp n'est pas encore configuré. Utilise le mode manuel.");
  }
}

function merchantPath(suffix, version = "v0.1") {
  return `/${version}/merchants/${encodeURIComponent(String(sumupMerchantCode.value()).trim())}${suffix}`;
}

async function sumupRequest(path, { method = "GET", body } = {}) {
  const response = await fetch(`${SUMUP_API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${String(sumupApiKey.value()).trim()}`,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text.slice(0, 500) };
  }

  if (!response.ok) {
    const error = new Error(`SumUp ${method} ${path.replace(/merchants\/[^/]+/, "merchants/…")} → ${response.status}`);
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
}

function describeSumupError(error) {
  const detail = error?.data?.errors?.detail || error?.data?.detail || error?.data?.message || "";
  return String(detail || error?.message || "Erreur SumUp").slice(0, 300);
}

async function getUserRoles(uid) {
  const snapshot = await firestore().collection("users").doc(uid).get();
  return Array.isArray(snapshot.data()?.userTypes) ? snapshot.data().userTypes : [];
}

async function assertManager(request) {
  const uid = String(request.auth?.uid || "");
  if (!uid) throw new HttpsError("unauthenticated", "Authentification requise.");
  const roles = await getUserRoles(uid);
  if (!roles.includes("admin") && !roles.includes("gestionnaire")) {
    throw new HttpsError("permission-denied", "Réservé aux administrateurs et gestionnaires.");
  }
  return uid;
}

async function loadPost(postId) {
  const snapshot = await firestore().collection("cashPosts").doc(postId).get();
  if (!snapshot.exists) throw new HttpsError("not-found", "Ce poste de caisse n'existe pas.");
  return { id: snapshot.id, ...snapshot.data() };
}

// Ordinateur de caisse (session technique valide) ou admin/gestionnaire
// agissant pour un poste choisi.
async function resolveCashPost(request, requestedPostId) {
  const uid = String(request.auth?.uid || "");
  if (!uid) throw new HttpsError("unauthenticated", "Authentification requise.");
  const token = request.auth.token || {};

  if (typeof token.cashPostId === "string" && token.cashPostId) {
    const post = await loadPost(token.cashPostId);
    if (post.active === false || Number(post.accessVersion || 0) !== Number(token.cashAccessVersion)) {
      throw new HttpsError("permission-denied", "Accès à ce poste coupé. Saisis à nouveau le code du poste.");
    }
    return post;
  }

  await assertManager(request);
  const postId = String(requestedPostId || "").trim();
  if (!postId) throw new HttpsError("invalid-argument", "Poste manquant.");
  return loadPost(postId);
}

async function getActiveEditionId() {
  const snapshot = await firestore().collection("appSettings").doc("platform").get();
  return normalizeEditionId(snapshot.data()?.activeEdition);
}

// Panier { articleId: quantité } → lignes au prix enregistré côté serveur.
async function buildServerCartLines(cart, post, editionId) {
  const entries = Object.entries(cart && typeof cart === "object" ? cart : {})
    .map(([articleId, quantity]) => [String(articleId), Math.floor(Number(quantity) || 0)])
    .filter(([, quantity]) => quantity > 0);

  if (!entries.length) throw new HttpsError("invalid-argument", "Panier vide.");
  if (entries.some(([, quantity]) => quantity > MAX_QUANTITY_PER_ARTICLE)) {
    throw new HttpsError("invalid-argument", "Quantité trop élevée.");
  }

  const refs = entries.map(([articleId]) => firestore().collection("cashArticles").doc(articleId));
  const snapshots = await firestore().getAll(...refs);

  return entries.map(([articleId, quantity], index) => {
    const article = snapshots[index].exists ? snapshots[index].data() : null;
    const postKinds = Array.isArray(article?.postKinds) ? article.postKinds : [];
    if (
      !article ||
      article.active === false ||
      normalizeEditionId(article.editionId) !== editionId ||
      (postKinds.length && !postKinds.includes(post.kind))
    ) {
      throw new HttpsError("failed-precondition", "Un article du panier n'est plus en vente sur ce poste. Recharge la page.");
    }
    const unitPriceCents = Math.max(0, Math.round(Number(article.priceCents) || 0));
    return {
      articleId,
      label: String(article.label || ""),
      unitPriceCents,
      quantity,
      lineTotalCents: unitPriceCents * quantity,
    };
  });
}

// Relit la transaction chez SumUp et met la vente à jour. Seule source de
// vérité pour passer une vente en « paid ».
async function verifySale(saleRef) {
  const snapshot = await saleRef.get();
  const sale = snapshot.exists ? snapshot.data() : null;
  if (!sale || sale.status !== "pending" || !sale.sumupClientTransactionId) {
    return sale?.status || "unknown";
  }

  let transaction = null;
  try {
    const query = new URLSearchParams({ client_transaction_id: sale.sumupClientTransactionId });
    transaction = await sumupRequest(`${merchantPath("/transactions", "v2.1")}?${query}`);
  } catch (error) {
    if (error.status !== 404) {
      logger.error("SumUp transaction lookup failed", { saleId: saleRef.id, error: describeSumupError(error) });
      return "pending";
    }
  }

  if (!transaction) {
    const sentAtMs = sale.sentToReaderAt?.toMillis?.() || 0;
    if (sentAtMs && Date.now() - sentAtMs > ORPHAN_CHECKOUT_MS) {
      await saleRef.update({
        status: "failed",
        failureReason: sale.terminateRequestedAt ? "Annulé depuis la caisse." : "Aucun paiement reçu par le Solo.",
        updatedAt: serverTimestamp(),
      });
      return "failed";
    }
    return "pending";
  }

  const sumupStatus = String(transaction.status || "").toUpperCase();
  const common = {
    sumupStatus,
    sumupTransactionId: String(transaction.id || ""),
    sumupTransactionCode: String(transaction.transaction_code || ""),
    updatedAt: serverTimestamp(),
  };

  if (sumupStatus === "SUCCESSFUL") {
    const paidCents = Math.round(Number(transaction.amount || 0) * 100);
    await saleRef.update({
      ...common,
      status: "paid",
      paidAt: serverTimestamp(),
      paidAmountCents: paidCents,
      ...(paidCents !== Number(sale.totalCents) ? { amountMismatch: true } : {}),
    });
    if (paidCents !== Number(sale.totalCents)) {
      logger.warn("SumUp paid amount differs from sale total", { saleId: saleRef.id, paidCents, totalCents: sale.totalCents });
    }
    return "paid";
  }

  if (sumupStatus === "FAILED" || sumupStatus === "CANCELLED") {
    await saleRef.update({
      ...common,
      status: "failed",
      failureReason: sale.terminateRequestedAt ? "Annulé depuis la caisse." : "Paiement refusé ou abandonné sur le Solo.",
    });
    return "failed";
  }

  await saleRef.update(common);
  return "pending";
}

async function loadOwnSale(request, saleId) {
  const id = String(saleId || "").trim();
  if (!id) throw new HttpsError("invalid-argument", "Vente manquante.");
  const saleRef = firestore().collection("cashSales").doc(id);
  const snapshot = await saleRef.get();
  if (!snapshot.exists) throw new HttpsError("not-found", "Vente introuvable.");
  const sale = snapshot.data();
  await resolveCashPost(request, sale.postId).then((post) => {
    if (post.id !== sale.postId) throw new HttpsError("permission-denied", "Cette vente appartient à un autre poste.");
  });
  return { saleRef, sale };
}

// ── Appairage (admin) ───────────────────────────────────────────────────────

export const pairSumupReader = onCall({ region: REGION, secrets: SUMUP_SECRETS }, async (request) => {
  const uid = await assertManager(request);
  assertSumupConfigured();
  const post = await loadPost(String(request.data?.postId || "").trim());
  const pairingCode = String(request.data?.pairingCode || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (pairingCode.length < 8 || pairingCode.length > 9) {
    throw new HttpsError("invalid-argument", "Le code d'appairage affiché par le Solo fait 8 ou 9 caractères.");
  }

  let reader;
  try {
    reader = await sumupRequest(merchantPath("/readers"), {
      method: "POST",
      body: { pairing_code: pairingCode, name: String(post.name || post.id).slice(0, 500), metadata: { postId: post.id } },
    });
  } catch (error) {
    logger.error("SumUp pairing failed", { postId: post.id, error: describeSumupError(error) });
    throw new HttpsError(
      "failed-precondition",
      "Appairage refusé par SumUp. Le code expire après 5 minutes : relance « Connecter » sur le Solo et réessaie.",
    );
  }

  await firestore().collection("cashPosts").doc(post.id).set(
    {
      sumupReaderId: String(reader?.id || ""),
      sumupReaderSerial: String(reader?.device?.identifier || ""),
      sumupReaderModel: String(reader?.device?.model || ""),
      sumupReaderPairedAt: serverTimestamp(),
      sumupReaderPairedBy: uid,
    },
    { merge: true },
  );

  return { readerId: reader?.id || "", serial: reader?.device?.identifier || "", status: reader?.status || "" };
});

export const unpairSumupReader = onCall({ region: REGION, secrets: SUMUP_SECRETS }, async (request) => {
  await assertManager(request);
  assertSumupConfigured();
  const post = await loadPost(String(request.data?.postId || "").trim());

  if (post.sumupReaderId) {
    try {
      await sumupRequest(merchantPath(`/readers/${encodeURIComponent(post.sumupReaderId)}`), { method: "DELETE" });
    } catch (error) {
      if (error.status !== 404) {
        logger.error("SumUp unpair failed", { postId: post.id, error: describeSumupError(error) });
        throw new HttpsError("internal", "SumUp n'a pas pu dissocier ce Solo. Réessaie.");
      }
    }
  }

  const remove = admin.firestore.FieldValue.delete();
  await firestore().collection("cashPosts").doc(post.id).update({
    sumupReaderId: remove,
    sumupReaderSerial: remove,
    sumupReaderModel: remove,
    sumupReaderPairedAt: remove,
    sumupReaderPairedBy: remove,
  });

  return { ok: true };
});

export const getSumupReaderStatus = onCall({ region: REGION, secrets: SUMUP_SECRETS }, async (request) => {
  const post = await resolveCashPost(request, request.data?.postId);
  assertSumupConfigured();
  if (!post.sumupReaderId) return { paired: false };

  try {
    const response = await sumupRequest(merchantPath(`/readers/${encodeURIComponent(post.sumupReaderId)}/status`));
    const data = response?.data || {};
    return {
      paired: true,
      status: String(data.status || "OFFLINE"),
      state: String(data.state || ""),
      batteryLevel: data.battery_level ?? null,
      connectionType: String(data.connection_type || ""),
    };
  } catch (error) {
    logger.warn("SumUp reader status failed", { postId: post.id, error: describeSumupError(error) });
    return { paired: true, status: "UNKNOWN" };
  }
});

// ── Encaissement ────────────────────────────────────────────────────────────

export const startCashSaleCheckout = onCall({ region: REGION, secrets: SUMUP_SECRETS }, async (request) => {
  const post = await resolveCashPost(request, request.data?.postId);
  assertSumupConfigured();
  if (!post.sumupReaderId) {
    throw new HttpsError("failed-precondition", "Aucun Solo n'est appairé à ce poste. Utilise le mode manuel.");
  }

  const editionId = await getActiveEditionId();
  const items = await buildServerCartLines(request.data?.cart, post, editionId);
  const totalCents = items.reduce((sum, item) => sum + item.lineTotalCents, 0);
  const ticketCount = items.reduce((sum, item) => sum + item.quantity, 0);
  if (totalCents <= 0) {
    throw new HttpsError("invalid-argument", "Panier gratuit : valide-le sans passer par le Solo.");
  }

  const saleRef = firestore().collection("cashSales").doc();
  await saleRef.set({
    editionId,
    postId: post.id,
    postName: post.name || post.id,
    operator: String(request.data?.operator || "").slice(0, 80),
    items,
    ticketCount,
    totalCents,
    currency: "EUR",
    paymentMethod: "sumup_solo",
    status: "pending",
    sumupReaderId: post.sumupReaderId,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  try {
    const response = await sumupRequest(merchantPath(`/readers/${encodeURIComponent(post.sumupReaderId)}/checkout`), {
      method: "POST",
      body: {
        total_amount: { value: totalCents, currency: "EUR", minor_unit: 2 },
        description: `${post.name || post.id} · ${ticketCount} billet(s)`.slice(0, 120),
        return_url: getWebhookUrl(),
        affiliate: {
          app_id: String(sumupAffiliateAppId.value()).trim(),
          key: String(sumupAffiliateKey.value()).trim(),
          foreign_transaction_id: saleRef.id,
          tags: { postId: post.id, editionId },
        },
      },
    });

    await saleRef.update({
      sumupClientTransactionId: String(response?.data?.client_transaction_id || ""),
      sentToReaderAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    const reason = describeSumupError(error);
    logger.error("SumUp reader checkout failed", { saleId: saleRef.id, postId: post.id, status: error.status, reason });
    await saleRef.update({
      status: "failed",
      failureReason: "Le Solo n'a pas reçu le montant.",
      sumupError: reason,
      updatedAt: serverTimestamp(),
    });
    throw new HttpsError(
      "unavailable",
      "Le Solo n'a pas reçu le montant. Vérifie qu'il est allumé, connecté au Wi-Fi et sur l'écran d'accueil, puis réessaie (ou passe en mode manuel).",
    );
  }

  return { saleId: saleRef.id, totalCents };
});

export const refreshCashSaleStatus = onCall({ region: REGION, secrets: SUMUP_SECRETS }, async (request) => {
  const { saleRef } = await loadOwnSale(request, request.data?.saleId);
  assertSumupConfigured();
  return { status: await verifySale(saleRef) };
});

export const cancelCashSaleCheckout = onCall({ region: REGION, secrets: SUMUP_SECRETS }, async (request) => {
  const { saleRef, sale } = await loadOwnSale(request, request.data?.saleId);
  assertSumupConfigured();
  if (sale.status !== "pending") return { status: sale.status };

  await saleRef.update({ terminateRequestedAt: serverTimestamp(), updatedAt: serverTimestamp() });
  try {
    await sumupRequest(merchantPath(`/readers/${encodeURIComponent(sale.sumupReaderId)}/terminate`), { method: "POST" });
  } catch (error) {
    // Refusé si le client a déjà présenté sa carte : on laisse la vérification trancher.
    logger.warn("SumUp terminate refused", { saleId: saleRef.id, error: describeSumupError(error) });
  }

  return { status: await verifySale(saleRef) };
});

// Rappel de SumUp (return_url) à la fin d'une transaction Solo.
export const sumupWebhook = onRequest({ region: REGION, secrets: SUMUP_SECRETS }, async (request, response) => {
  if (request.method !== "POST") {
    response.status(405).send("Method not allowed");
    return;
  }

  const clientTransactionId = String(request.body?.payload?.client_transaction_id || "").trim();
  if (!clientTransactionId) {
    response.status(200).send("ignored");
    return;
  }

  try {
    const matches = await firestore()
      .collection("cashSales")
      .where("sumupClientTransactionId", "==", clientTransactionId)
      .limit(1)
      .get();
    if (!matches.empty) {
      await verifySale(matches.docs[0].ref);
    } else {
      logger.warn("SumUp webhook for unknown transaction", { clientTransactionId });
    }
  } catch (error) {
    logger.error("SumUp webhook handling failed", { clientTransactionId, error: error?.message });
  }

  response.status(200).send("ok");
});
