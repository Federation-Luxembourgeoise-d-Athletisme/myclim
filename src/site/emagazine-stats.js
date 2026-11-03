import { useEffect, useState } from "react";
import { collection, doc, increment, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "../services/firebase";

// Audience du e-magazine, par édition (emagazineStats/{année}) : chiffres à
// remettre aux sponsors. Écrit directement par les lecteurs du site public ;
// firestore.rules n'accepte que des incréments de +1 sur ces compteurs.
//   emagazineStats/{année}                 opens, uniqueReaders, prints
//   emagazineStats/{année}/pages/{pageId}  views, title
//   emagazineStats/{année}/days/{AAAA-MM-JJ} opens
// Une ouverture = une session de navigation ; une page vue = une page restée
// affichée au moins PAGE_VIEW_DELAY_MS, comptée une fois par session.

export const PAGE_VIEW_DELAY_MS = 1500;

// En dev sans émulateurs, le site parle à la base de production : on ne
// compte pas pour ne pas fausser les chiffres remis aux sponsors.
const TRACKING_ENABLED = import.meta.env.PROD || import.meta.env.VITE_USE_FIREBASE_EMULATORS === "true";

function readStorage(storage, key) {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(storage, key, value) {
  try {
    storage.setItem(key, value);
  } catch {
    // Stockage bloqué (navigation privée…) : on compte quand même.
  }
}

function todayKey() {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Luxembourg" });
}

export function emagazineStatsPageId(pageKey) {
  return String(pageKey || "page").replace(/\//g, "_").slice(0, 140);
}

// Pages tracked for one entry of the admin page order, with the same keys as
// the public reader (orderedMagazinePages in site-emagazine.jsx).
export function emagazineStatsPagesForEntry(page, config) {
  if (page.id === "sponsors") {
    return config.sponsorPages.length
      ? config.sponsorPages.map((entry) => ({ key: `sponsor-page-${entry.id}`, title: entry.title || "Sponsors" }))
      : [{ key: "sponsors", title: "Sponsor overview" }];
  }
  const prefixes = [
    ["official-startlist:", "startlist-"],
    ["special:", "special-"],
    ["athlete:", "athlete-"],
    ["highlight:", "highlight-"],
    ["partner:", "partner-"],
  ];
  const match = prefixes.find(([prefix]) => page.id.startsWith(prefix));
  const key = match ? `${match[1]}${page.id.slice(match[0].length)}` : page.id;
  return [{ key, title: page.title }];
}

function bump(ref, fields) {
  setDoc(ref, { ...fields, updatedAt: serverTimestamp() }, { merge: true }).catch(() => {});
}

export function trackEmagazineOpen(year) {
  if (!TRACKING_ENABLED || !year) return;
  const statsId = String(year);
  const sessionKey = `emag-open-${statsId}`;
  if (readStorage(window.sessionStorage, sessionKey)) return;
  writeStorage(window.sessionStorage, sessionKey, "1");

  const readerKey = `emag-reader-${statsId}`;
  const isNewReader = !readStorage(window.localStorage, readerKey);
  if (isNewReader) writeStorage(window.localStorage, readerKey, "1");

  bump(doc(db, "emagazineStats", statsId), {
    opens: increment(1),
    ...(isNewReader ? { uniqueReaders: increment(1) } : {}),
  });
  bump(doc(db, "emagazineStats", statsId, "days", todayKey()), { opens: increment(1) });
}

export function trackEmagazinePageView(year, pageKey, title) {
  if (!TRACKING_ENABLED || !year || !pageKey) return;
  const statsId = String(year);
  const pageId = emagazineStatsPageId(pageKey);
  const sessionKey = `emag-pages-${statsId}`;
  let seen = [];
  try {
    seen = JSON.parse(readStorage(window.sessionStorage, sessionKey) || "[]");
  } catch {
    seen = [];
  }
  if (seen.includes(pageId)) return;
  writeStorage(window.sessionStorage, sessionKey, JSON.stringify([...seen, pageId]));

  bump(doc(db, "emagazineStats", statsId, "pages", pageId), {
    views: increment(1),
    title: String(title || pageId).slice(0, 200),
  });
}

export function trackEmagazinePrint(year) {
  if (!TRACKING_ENABLED || !year) return;
  bump(doc(db, "emagazineStats", String(year)), { prints: increment(1) });
}

// Lecture côté admin (gestionnaires du site).
export function useEmagazineStats(year) {
  // Each value is tagged with the edition it belongs to, so switching edition
  // never shows the previous edition's figures.
  const [summary, setSummary] = useState({ statsId: null, data: null });
  const [pages, setPages] = useState({ statsId: null, data: [] });
  const [days, setDays] = useState({ statsId: null, data: [] });
  const [error, setError] = useState({ statsId: null, message: "" });
  const statsId = year ? String(year) : null;

  useEffect(() => {
    if (!statsId) return undefined;
    const onError = (err) => setError({ statsId, message: err.message || "Unable to load the e-magazine statistics." });
    const unsubscribers = [
      onSnapshot(doc(db, "emagazineStats", statsId), (snapshot) => {
        setSummary({ statsId, data: snapshot.exists() ? snapshot.data() : null });
      }, onError),
      onSnapshot(collection(db, "emagazineStats", statsId, "pages"), (snapshot) => {
        setPages({ statsId, data: snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() })) });
      }, onError),
      onSnapshot(collection(db, "emagazineStats", statsId, "days"), (snapshot) => {
        setDays({
          statsId,
          data: snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() })).sort((a, b) => a.id.localeCompare(b.id)),
        });
      }, onError),
    ];
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [statsId]);

  const errorMessage = error.statsId === statsId ? error.message : "";
  return {
    summary: summary.statsId === statsId ? summary.data : null,
    pages: pages.statsId === statsId ? pages.data : [],
    days: days.statsId === statsId ? days.data : [],
    loading: summary.statsId !== statsId && !errorMessage,
    error: errorMessage,
  };
}
