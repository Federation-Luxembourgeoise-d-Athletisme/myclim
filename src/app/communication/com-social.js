// Module Communication, étape 2 : publications Facebook / Instagram du meeting et
// galerie flaphoto.net, lues via les Cloud Functions (porté de myFLA,
// lib/communication/social.ts et gallery.ts).
import { useEffect, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "../../services/firebase";

export const MAX_PUBLICATION_PHOTOS = 30;

// state : { status: "idle" | "loading" | "ready" | "not-configured" | "error", posts, message? }
// lang : langue des messages renvoyés par le serveur (« pas encore relié »…).
export function useSocialPosts(network, enabled, lang = "fr") {
  const [state, setState] = useState({ status: "idle", posts: [] });
  const service = network === "instagram" ? "Instagram" : "Facebook";

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    httpsCallable(functions, "comSocialPosts")({ network, lang })
      .then(({ data }) => {
        if (cancelled) return;
        if (data?.notConfigured) setState({ status: "not-configured", posts: [], message: data.message });
        else setState({ status: "ready", posts: data?.posts || [] });
      })
      .catch((error) => {
        console.error(`${service} posts load failed`, error);
        if (!cancelled) setState({ status: "error", posts: [], message: error?.message || `${service} is unavailable.` });
      });
    return () => {
      cancelled = true;
    };
  }, [network, service, enabled, lang]);

  return enabled && state.status === "idle" ? { ...state, status: "loading" } : state;
}

// Date locale (AAAA-MM-JJ, heure de Luxembourg) d'une publication, pour la comparer à la date prévue.
export const socialPostDay = (post) => new Date(post.createdTime).toLocaleDateString("sv-SE", { timeZone: "Europe/Luxembourg" });

export const formatCount = (n, locale = "fr-LU") => (n === null || n === undefined ? "—" : Number(n).toLocaleString(locale));

const en = (lang) => lang !== "fr";

export const facebookStats = (p, lang = "fr") => [
  [en(lang) ? "views" : "vues", p.views],
  [en(lang) ? "people reached" : "personnes touchées", p.reach],
  [en(lang) ? "reactions" : "réactions", p.reactions],
  [en(lang) ? "comments" : "commentaires", p.comments],
  [en(lang) ? "shares" : "partages", p.shares],
  [en(lang) ? "clicks" : "clics", p.clicks],
];

export const instagramStats = (p, lang = "fr") => [
  [en(lang) ? "views" : "vues", p.views],
  [en(lang) ? "accounts reached" : "comptes touchés", p.reach],
  [en(lang) ? "likes" : "j'aime", p.likes],
  [en(lang) ? "comments" : "commentaires", p.comments],
  [en(lang) ? "shares" : "partages", p.shares],
  [en(lang) ? "saves" : "enregistrements", p.saved],
];

/* ---------- Galerie flaphoto.net ---------- */

export async function loadGalleryAlbums() {
  const { data } = await httpsCallable(functions, "comGalleryAlbums")();
  return data?.albums || [];
}

export async function loadGalleryPhotos(albumId, page) {
  const { data } = await httpsCallable(functions, "comGalleryPhotos")({ albumId, page });
  return { photos: data?.photos || [], total: Number(data?.total) || 0 };
}

// Référence enregistrée dans la publication pour une photo choisie (le fichier reste dans Piwigo).
export const toPublicationPhoto = (photo) => ({
  id: photo.id,
  albumId: photo.albumId,
  credit: photo.albumName,
  thumbUrl: photo.thumbUrl,
  largeUrl: photo.largeUrl,
  downloadUrl: photo.downloadUrl,
  piwigoUrl: photo.piwigoUrl,
});

// Crédits distincts des photos, dans l'ordre : « Photos : Harry Daemen, Henri Weyer ».
// En anglais : « Photos: Harry Daemen ».
export function creditLine(photos, lang = "fr") {
  const names = [...new Set(photos.map((p) => p.credit).filter(Boolean))];
  if (!names.length) return null;
  return `${names.length > 1 || photos.length > 1 ? "Photos" : "Photo"}${lang === "fr" ? " :" : ":"} ${names.join(", ")}`;
}
