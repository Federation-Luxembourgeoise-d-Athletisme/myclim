import { useEffect, useState } from "react";
import { addDoc, collection, doc, onSnapshot, query, serverTimestamp, setDoc, updateDoc, where } from "firebase/firestore";
import { db } from "../services/firebase";
import { enqueueTransactionalMail, buildExpenseClaimSubmittedMail, buildExpenseClaimPresetMail } from "../services/mailQueue";
import { buildClaimExcelAttachment } from "./expense-claim-export";
import { DECOMPTE_RECIPIENT, claimOwnerName, computeClaimTotals, getReceiptsNotInBudget, normalizeClaim } from "./expense-claims";

const EXPENSE_CLAIMS = "expenseClaims";
// Profil privé (adresse, IBAN, banque) : lisible par la personne, les admins
// et le rôle budget seulement.
const USER_PRIVATE = "userPrivate";

function useClaimsQuery(buildQuery, deps, enabled = true) {
  const [state, setState] = useState({ claims: [], loading: true, error: "" });
  useEffect(() => {
    if (!enabled) return undefined;
    const claimsQuery = buildQuery();
    if (!claimsQuery) return undefined;
    return onSnapshot(
      claimsQuery,
      (snapshot) =>
        setState({
          claims: snapshot.docs
            .map((entry) => ({ ...normalizeClaim({ ...entry.data(), id: entry.id }), submittedAt: entry.data().submittedAt || null, updatedAt: entry.data().updatedAt || null }))
            .sort((left, right) => (right.updatedAt?.seconds || 0) - (left.updatedAt?.seconds || 0)),
          loading: false,
          error: "",
        }),
      (error) => {
        console.error("Unable to load expense claims", error);
        setState({ claims: [], loading: false, error: "Impossible de charger les décomptes." });
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps]);
  return enabled ? state : { claims: [], loading: false, error: "" };
}

function useMyExpenseClaims(uid) {
  return useClaimsQuery(() => (uid ? query(collection(db, EXPENSE_CLAIMS), where("ownerUid", "==", uid)) : null), [uid], Boolean(uid));
}

function useAllExpenseClaims(enabled) {
  return useClaimsQuery(() => collection(db, EXPENSE_CLAIMS), [], enabled);
}

function useMyPrivateProfile(uid) {
  const [state, setState] = useState({ profile: null, loading: true });
  useEffect(() => {
    if (!uid) return undefined;
    return onSnapshot(
      doc(db, USER_PRIVATE, uid),
      (snapshot) => setState({ profile: snapshot.exists() ? snapshot.data() : {}, loading: false }),
      () => setState({ profile: {}, loading: false }),
    );
  }, [uid]);
  return uid ? state : { profile: {}, loading: false };
}

function claimPayload(claim) {
  const { id: _id, history: _history, ...data } = normalizeClaim(claim);
  return data;
}

async function saveClaimDraft(claim) {
  const data = { ...claimPayload(claim), updatedAt: serverTimestamp() };
  if (claim.id) {
    await updateDoc(doc(db, EXPENSE_CLAIMS, claim.id), data);
    return claim.id;
  }
  const created = await addDoc(collection(db, EXPENSE_CLAIMS), { ...data, status: "draft", history: [], createdAt: serverTimestamp() });
  return created.id;
}

// Envoi : enregistre (statut « Envoyé »), garde adresse/IBAN dans le profil
// privé, puis envoie l'e-mail à Margot avec l'Excel rempli. L'e-mail ne bloque
// pas l'envoi : le décompte reste visible dans le suivi même si le mail échoue.
async function submitClaim(claim, { appUrl }) {
  const now = new Date().toISOString();
  const ready = normalizeClaim({ ...claim, certifiedAt: now });
  const history = [...(claim.history || []), { status: "submitted", at: now, byName: claimOwnerName(ready) }];
  const data = { ...claimPayload(ready), status: "submitted", history, submittedAt: serverTimestamp(), updatedAt: serverTimestamp() };
  let id = claim.id;
  if (id) await updateDoc(doc(db, EXPENSE_CLAIMS, id), data);
  else id = (await addDoc(collection(db, EXPENSE_CLAIMS), { ...data, createdAt: serverTimestamp() })).id;

  await setDoc(
    doc(db, USER_PRIVATE, ready.ownerUid),
    { address: ready.address, iban: ready.iban, bank: ready.bank, updatedAt: serverTimestamp() },
    { merge: true },
  );

  let mailError = "";
  try {
    const attachment = await buildClaimExcelAttachment(ready);
    await enqueueTransactionalMail({
      ...buildExpenseClaimSubmittedMail({
        to: DECOMPTE_RECIPIENT,
        ownerName: claimOwnerName(ready),
        ownerEmail: ready.ownerEmail,
        reason: ready.reason,
        toPay: computeClaimTotals(ready).toPay,
        receipts: ready.receipts,
        trackingUrl: `${appUrl}/app/decomptes?d=${id}`,
      }),
      attachments: [attachment],
    });
  } catch (error) {
    console.error("Expense claim mail failed", error);
    mailError = "Le décompte est bien enregistré, mais l'e-mail n'est pas parti. Margot le verra dans le suivi.";
  }
  return { id, mailError };
}

// Chaque justificatif d'un décompte devient une facture du budget (« à
// classer »), comme une facture déposée : on la range ensuite sur sa ligne
// budgétaire. Fait par un admin / rôle budget (au passage à « Vérifié »).
async function sendClaimInvoicesToBudget(claim, { uid }) {
  const pending = getReceiptsNotInBudget(claim);
  if (!pending.length) return 0;
  const created = { ...(claim.budgetInvoiceIds || {}) };
  const owner = claimOwnerName(claim);
  for (const receipt of pending) {
    const reference = await addDoc(collection(db, "documents"), {
      documentType: "invoice",
      title: receipt.fileName,
      reference: receipt.fileUrl,
      fileName: receipt.fileName,
      fileUrl: receipt.fileUrl,
      filePath: receipt.filePath,
      mimeType: receipt.mimeType,
      scope: "private",
      teams: [],
      visibility: "Facture privée",
      editionId: String(claim.editionYear || "").trim(),
      uploadedByUid: uid,
      uploadedByName: owner,
      ownerUid: claim.ownerUid,
      invoiceNote: `Décompte de ${owner} — ${claim.reason}`,
      paymentMethod: "reimbursement",
      expenseClaimId: claim.id,
      invoiceStatus: "unclassified",
      linkedBudgetEditionId: "",
      linkedBudgetCollectionKey: "",
      linkedBudgetRowId: "",
      linkedBudgetRowLabel: "",
      linkedBudgetSectionName: "",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    created[receipt.fileUrl] = reference.id;
  }
  await updateDoc(doc(db, EXPENSE_CLAIMS, claim.id), { budgetInvoiceIds: created, updatedAt: serverTimestamp() });
  return pending.length;
}

async function setClaimStatus(claim, status, byName, uid) {
  const history = [...(claim.history || []), { status, at: new Date().toISOString(), byName }];
  await updateDoc(doc(db, EXPENSE_CLAIMS, claim.id), { status, history, updatedAt: serverTimestamp() });
  if (status === "checked") await sendClaimInvoicesToBudget(claim, { uid });
}

// Décompte préparé par un organisateur pour une ou plusieurs personnes : une
// copie « À compléter » par personne, et un e-mail pour la prévenir.
async function createPresetClaims({ people, reason, lines, note, byName, editionYear, appUrl }) {
  let mailFailures = 0;
  for (const person of people) {
    await addDoc(collection(db, EXPENSE_CLAIMS), {
      ...claimPayload({
        editionYear,
        ownerUid: person.uid,
        ownerEmail: person.email,
        ownerFirstName: person.firstName,
        ownerLastName: person.lastName,
        reason,
        lines,
        preset: { byName, note },
      }),
      status: "preset",
      history: [{ status: "preset", at: new Date().toISOString(), byName }],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    if (person.email) {
      try {
        await enqueueTransactionalMail(
          buildExpenseClaimPresetMail({ to: person.email, firstName: person.firstName, reason, byName, url: `${appUrl}/app/mes-decomptes` }),
        );
      } catch {
        mailFailures += 1;
      }
    }
  }
  return { mailFailures };
}

export {
  EXPENSE_CLAIMS,
  createPresetClaims,
  saveClaimDraft,
  sendClaimInvoicesToBudget,
  setClaimStatus,
  submitClaim,
  useAllExpenseClaims,
  useMyExpenseClaims,
  useMyPrivateProfile,
};
