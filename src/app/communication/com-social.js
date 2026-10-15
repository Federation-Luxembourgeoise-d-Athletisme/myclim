// Module Communication, étape 2 : publications Facebook / Instagram du meeting et
// galerie flaphoto.net, lues via les Cloud Functions (porté de myFLA,
// lib/communication/social.ts et gallery.ts).
import { useEffect, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "../../services/firebase";

export const MAX_PUBLICATION_PHOTOS = 30;

// state : { status: "idle" | "loading" | "ready" | "not-configured" | "error", posts, message? }
export function useSocialPosts(network, enabled) {
  const [state, setState] = useState({ status: "idle", posts: [] });
  const service = network === "instagram" ? "Instagram" : "Facebook";

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    httpsCallable(functions, "comSocialPosts")({ network })
      .then(({ data }) => {
        if (cancelled) return;
        if (data?.notConfigured) setState({ status: "not-configured", posts: [], message: data.message });
        else setState({ status: "ready", posts: data?.posts || [] });
      })
      .catch((error) => {
        console.error(`${service} posts load failed`, error);
        if (!cancelled) setState({ status: "error", posts: [], message: error?.message || `${service} est indisponible.` });
      });
    return () => {
      cancelled = true;
    };
  }, [network, service, enabled]);

  return enabled && state.status === "idle" ? { ...state, status: "loading" } : state;
}

// Date locale (AAAA-MM-JJ, heure de Luxembourg) d'une publication, pour la comparer à la date prévue.
export const socialPostDay = (post) => new Date(post.createdTime).toLocaleDateString("sv-SE", { timeZone: "Europe/Luxembourg" });

export const formatCount = (n) => (n === null || n === undefined ? "—" : Number(n).toLocaleString("fr-LU"));

export const facebookStats = (p) => [
  ["vues", p.views],
  ["personnes touchées", p.reach],
  ["réactions", p.reactions],
  ["commentaires", p.comments],
  ["partages", p.shares],
  ["clics", p.clicks],
];

export const instagramStats = (p) => [
  ["vues", p.views],
  ["comptes touchés", p.reach],
  ["j'aime", p.likes],
  ["commentaires", p.comments],
  ["partages", p.shares],
  ["enregistrements", p.saved],
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
export function creditLine(photos) {
  const names = [...new Set(photos.map((p) => p.credit).filter(Boolean))];
  if (!names.length) return null;
  return `${names.length > 1 || photos.length > 1 ? "Photos" : "Photo"} : ${names.join(", ")}`;
}
