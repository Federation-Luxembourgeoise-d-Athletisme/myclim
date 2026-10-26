// ── Module Communication, étape 2 : réseaux sociaux et galerie photos ───────
// Porté de myFLA (lib/server/facebook.ts, instagram.ts, piwigo-gallery.ts et
// netlify/functions/scheduledInstagramTokenRefresh.js).
//
// Secrets (à créer une fois, jamais dans le code) :
//   firebase functions:secrets:set META_PAGE_TOKEN   (jeton de la page Facebook du meeting)
//   firebase functions:secrets:set META_PAGE_ID      (identifiant de la page)
//   firebase functions:secrets:set INSTAGRAM_TOKEN   (jeton Instagram initial, 60 jours)
// Le jeton Instagram est renouvelé chaque semaine et rangé dans
// server_secrets/instagram (Firestore, aucun accès client : voir firestore.rules).
// La galerie flaphoto.net (Piwigo) est lue sans identifiant : albums publics.
/* global process */

import admin from "firebase-admin";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineSecret } from "firebase-functions/params";
import { logger } from "firebase-functions";

const REGION = "europe-west1";
const COMMUNICATION_ROLES = ["admin", "gestionnaire"];
const GRAPH_VERSION = "v23.0";
const CACHE_TTL_MS = 5 * 60 * 1000;
// *_BASE_URL : uniquement pour les tests locaux (faux serveurs).
const FACEBOOK_BASE = () => process.env.META_GRAPH_BASE_URL || `https://graph.facebook.com/${GRAPH_VERSION}`;
const INSTAGRAM_BASE = () => process.env.INSTAGRAM_GRAPH_BASE_URL || `https://graph.instagram.com/${GRAPH_VERSION}`;
const INSTAGRAM_REFRESH_BASE = () => process.env.INSTAGRAM_GRAPH_BASE_URL || "https://graph.instagram.com";
const PIWIGO_WS_URL = () => process.env.PIWIGO_WS_URL || "https://flaphoto.net/galerie/ws.php?format=json";
const GALLERY_PAGE_SIZE = 60;

const metaPageToken = defineSecret("META_PAGE_TOKEN");
const metaPageId = defineSecret("META_PAGE_ID");
const instagramToken = defineSecret("INSTAGRAM_TOKEN");

const firestore = () => admin.firestore();
const INSTAGRAM_SECRET_REF = () => firestore().collection("server_secrets").doc("instagram");

// Messages dans la langue de l'app de la personne (français ou anglais).
const translator = (request) => (fr, en) => (request.data?.lang === "fr" ? fr : en);

async function assertCommunicationMember(request) {
  const tr = translator(request);
  const uid = String(request.auth?.uid || "");
  if (!uid) throw new HttpsError("unauthenticated", tr("Authentification requise.", "Sign-in required."));
  const snapshot = await firestore().collection("users").doc(uid).get();
  const roles = Array.isArray(snapshot.data()?.userTypes) ? snapshot.data().userTypes : [];
  if (!roles.some((role) => COMMUNICATION_ROLES.includes(role))) {
    throw new HttpsError("permission-denied", tr("Réservé à l'équipe d'organisation (admin, gestionnaire).", "Reserved for the organising team (admin, manager)."));
  }
}

const secretValue = (secret) => {
  try {
    return String(secret.value() || "").trim();
  } catch {
    return "";
  }
};

/* ---------- Facebook ---------- */

const FB_METRICS = ["post_media_view", "post_total_media_view_unique", "post_clicks_by_type", "post_activity_by_action_type", "post_reactions_by_type_total"];
const FB_FIELDS = ["id", "message", "story", "created_time", "permalink_url", "full_picture", "shares", `insights.metric(${FB_METRICS.join(",")})`].join(",");

const sumInsight = (value) =>
  value === undefined ? null : typeof value === "number" ? value : Object.values(value || {}).reduce((a, b) => a + Number(b || 0), 0);

function toFacebookPost(raw) {
  const metric = (name) => raw.insights?.data?.find((m) => m.name === name)?.values?.[0]?.value;
  const activity = metric("post_activity_by_action_type");
  const clicks = metric("post_clicks_by_type");
  return {
    id: raw.id,
    message: String(raw.message || raw.story || "").trim(),
    createdTime: raw.created_time,
    permalinkUrl: raw.permalink_url || null,
    pictureUrl: raw.full_picture || null,
    views: sumInsight(metric("post_media_view")),
    reach: sumInsight(metric("post_total_media_view_unique")),
    reactions: sumInsight(metric("post_reactions_by_type_total")),
    comments: activity === undefined || typeof activity === "number" ? null : activity.comment ?? 0,
    shares: raw.shares?.count ?? 0,
    clicks: sumInsight(clicks),
    linkClicks: clicks === undefined || typeof clicks === "number" ? null : clicks["link clicks"] ?? 0,
  };
}

/* ---------- Instagram ---------- */

const IG_METRICS = ["views", "reach", "shares", "saved"];
const IG_FIELDS = [
  "id",
  "caption",
  "timestamp",
  "media_type",
  "media_product_type",
  "permalink",
  "media_url",
  "thumbnail_url",
  "like_count",
  "comments_count",
  `insights.metric(${IG_METRICS.join(",")})`,
].join(",");

function toInstagramPost(raw) {
  const metric = (name) => raw.insights?.data?.find((m) => m.name === name)?.values?.[0]?.value ?? null;
  const isVideo = raw.media_type === "VIDEO";
  return {
    id: raw.id,
    message: String(raw.caption || "").trim(),
    createdTime: raw.timestamp,
    permalinkUrl: raw.permalink || null,
    pictureUrl: (isVideo ? raw.thumbnail_url : raw.media_url) || null,
    kind: raw.media_product_type === "REELS" ? "REELS" : raw.media_type || "",
    views: metric("views"),
    reach: metric("reach"),
    likes: raw.like_count ?? null,
    comments: raw.comments_count ?? null,
    shares: metric("shares"),
    saved: metric("saved"),
  };
}

async function currentInstagramToken() {
  const stored = await INSTAGRAM_SECRET_REF().get();
  return String((stored.exists && stored.data()?.token) || "").trim() || secretValue(instagramToken);
}

async function graphGet(url, token, service, tr) {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    logger.error(`${service} Graph error`, { status: response.status, code: payload?.error?.code, message: payload?.error?.message });
    const detail = payload?.error?.message || response.status;
    throw new HttpsError("unavailable", tr(`${service} ne répond pas pour le moment (${detail}).`, `${service} is not responding right now (${detail}).`));
  }
  return payload;
}

// Les 40 publications les plus récentes de la page Facebook ou du compte Instagram, avec leurs statistiques.
// Pas de cache : les statistiques sont relues chez Meta à chaque appel.
export const comSocialPosts = onCall({ region: REGION, secrets: [metaPageToken, metaPageId, instagramToken] }, async (request) => {
  await assertCommunicationMember(request);
  const tr = translator(request);
  const network = request.data?.network === "instagram" ? "instagram" : "facebook";

  let posts;
  if (network === "facebook") {
    const token = secretValue(metaPageToken);
    const pageId = secretValue(metaPageId);
    if (!token || !pageId) return {
        notConfigured: true,
        message: tr("Facebook n'est pas encore relié : il manque le jeton de la page du meeting.", "Facebook is not connected yet: the meeting page token is missing."),
      };
    const payload = await graphGet(`${FACEBOOK_BASE()}/${encodeURIComponent(pageId)}/posts?limit=40&fields=${encodeURIComponent(FB_FIELDS)}`, token, "Facebook", tr);
    posts = (payload.data || []).map(toFacebookPost);
  } else {
    const token = await currentInstagramToken();
    if (!token) return {
        notConfigured: true,
        message: tr("Instagram n'est pas encore relié : il manque le jeton du compte @cmcm_lux_indoor_meet.", "Instagram is not connected yet: the @cmcm_lux_indoor_meet account token is missing."),
      };
    const payload = await graphGet(`${INSTAGRAM_BASE()}/me/media?limit=40&fields=${encodeURIComponent(IG_FIELDS)}`, token, "Instagram", tr);
    posts = (payload.data || []).map(toInstagramPost);
  }

  return { posts };
});

// Chaque semaine : renouvelle le jeton Instagram (valable 60 jours).
export const comInstagramTokenRefresh = onSchedule(
  { region: REGION, schedule: "every monday 06:00", timeZone: "Europe/Luxembourg", secrets: [instagramToken] },
  async () => {
    const current = await currentInstagramToken();
    if (!current) {
      logger.info("Instagram token refresh skipped: no token configured");
      return;
    }
    const response = await fetch(`${INSTAGRAM_REFRESH_BASE()}/refresh_access_token?grant_type=ig_refresh_token`, {
      headers: { Authorization: `Bearer ${current}` },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.access_token) {
      logger.error("Instagram token refresh failed", { status: response.status, message: payload?.error?.message });
      return;
    }
    const expiresAt = new Date(Date.now() + Number(payload.expires_in || 0) * 1000).toISOString().slice(0, 10);
    await INSTAGRAM_SECRET_REF().set({
      token: payload.access_token,
      expiresAt,
      refreshedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    logger.info("Instagram token refreshed", { expiresAt });
  },
);

/* ---------- Galerie flaphoto.net (Piwigo) ---------- */

async function piwigo(method, params = {}) {
  const response = await fetch(PIWIGO_WS_URL(), {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...params, method }),
  });
  const text = await response.text();
  let data = null;
  try {
    data = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
  } catch {
    data = null;
  }
  if (!response.ok || data?.stat !== "ok" || !data?.result) {
    logger.error("Piwigo error", { method, status: response.status, message: data?.message || text.slice(0, 200) });
    throw new HttpsError("unavailable", "flaphoto.net gallery unreachable / galerie flaphoto.net injoignable.");
  }
  return data.result;
}

// Les entités HTML (&amp;, &#039;…) arrivent encodées dans les noms d'albums.
const decodeEntities = (value) =>
  String(value || "")
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();

let albumsCache = null;

async function listAlbums() {
  if (albumsCache && albumsCache.expiresAt > Date.now()) return albumsCache.albums;
  const { categories = [] } = await piwigo("pwg.categories.getList", { recursive: "true", tree_output: "false" });
  // Albums virtuels générés par le plugin de cartes (OSM) : sans intérêt ici.
  const hidden = new Set(categories.filter((c) => String(c.comment || "").startsWith("Generated by OSM plugin")).map((c) => String(c.id)));
  const albums = categories
    .filter((c) => !String(c.uppercats || c.id).split(",").some((id) => hidden.has(id.trim())))
    .map((c, index) => ({
      id: String(c.id),
      name: decodeEntities(c.name || `Album ${c.id}`),
      parentId: c.id_uppercat === null || c.id_uppercat === undefined || c.id_uppercat === "" ? null : String(c.id_uppercat),
      nbImages: Number(c.nb_images) || 0,
      totalImages: Number(c.total_nb_images) || 0,
      nbChildren: Number(c.nb_categories) || 0,
      lastDate: c.max_date_last || null,
      thumbUrl: c.tn_url || null,
      piwigoUrl: c.url || null,
      rank: index,
    }));
  albumsCache = { albums, expiresAt: Date.now() + CACHE_TTL_MS };
  return albums;
}

export const comGalleryAlbums = onCall({ region: REGION }, async (request) => {
  await assertCommunicationMember(request);
  return { albums: await listAlbums() };
});

// Photos d'un album, sous-albums compris (un album d'événement contient un sous-album par photographe).
export const comGalleryPhotos = onCall({ region: REGION }, async (request) => {
  await assertCommunicationMember(request);
  const albumId = String(request.data?.albumId || "").replace(/\D/g, "");
  const page = Math.max(0, Math.floor(Number(request.data?.page) || 0));
  if (!albumId) throw new HttpsError("invalid-argument", "Missing album / album manquant.");

  const [albums, result] = await Promise.all([
    listAlbums(),
    piwigo("pwg.categories.getImages", {
      cat_id: albumId,
      recursive: "true",
      per_page: String(GALLERY_PAGE_SIZE),
      page: String(page),
      order: "date_creation ASC, file ASC",
    }),
  ]);
  const albumNames = new Map(albums.map((a) => [a.id, a.name]));
  const photos = (result.images || []).map((image) => {
    const d = image.derivatives || {};
    const albumOfImage = String(image.categories?.[0]?.id ?? "");
    return {
      id: String(image.id),
      file: image.file || "",
      date: image.date_creation || image.date_available || null,
      // Le photographe est le nom du sous-album dans lequel il dépose ses photos.
      albumId: albumOfImage,
      albumName: albumNames.get(albumOfImage) || null,
      thumbUrl: d.thumb?.url || d.small?.url || image.element_url || "",
      largeUrl: d.xxlarge?.url || d.xlarge?.url || d.large?.url || image.element_url || "",
      downloadUrl: image.download_url || image.element_url || null,
      piwigoUrl: image.page_url || null,
    };
  });
  return { photos, total: Number(result.paging?.total_count) || 0 };
});
