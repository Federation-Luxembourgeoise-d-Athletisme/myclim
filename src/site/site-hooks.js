import { useEffect, useState } from "react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
  where,
} from "firebase/firestore";
import { db } from "../services/firebase";
import { LINKS_PAGE_DOC_ID, normalizeLinksPage } from "./links-page-config";
import { getSponsorMediaSettings } from "./sponsor-media-utils";
import {
  normalizeSponsorCategories,
  normalizeSponsorCategory,
  sponsorCategorySortIndex,
} from "./sponsor-utils";

export const SITE_NEWS_COL = "siteNews";
export const SITE_SPONSORS_COL = "siteSponsors";
export const SITE_PRESS_RELEASES_COL = "sitePressReleases";
export const SITE_CONTENT_COL = "siteContent";
export const SITE_SPONSOR_CATEGORIES_DOC = "sponsorCategories";

// ─── News ───────────────────────────────────────────────────────────────────

export function usePublishedNews(limit = 0) {
  const [news, setNews] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const q = query(
      collection(db, SITE_NEWS_COL),
      where("status", "==", "published"),
      orderBy("publishedAt", "desc"),
    );
    const unsub = onSnapshot(q, (snap) => {
      let items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      if (limit > 0) items = items.slice(0, limit);
      setNews(items);
      setLoading(false);
    }, () => setLoading(false));
    return unsub;
  }, [limit]);
  return { news, loading };
}

export function useNewsArticle(slug) {
  const [article, setArticle] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!slug) { setLoading(false); return; }
    const q = query(
      collection(db, SITE_NEWS_COL),
      where("slug", "==", slug),
      where("status", "==", "published"),
    );
    const unsub = onSnapshot(q, (snap) => {
      setArticle(snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() });
      setLoading(false);
    }, () => setLoading(false));
    return unsub;
  }, [slug]);
  return { article, loading };
}

export function useAllNews() {
  const [news, setNews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [retryKey, setRetryKey] = useState(0);
  useEffect(() => {
    const q = query(collection(db, SITE_NEWS_COL), orderBy("createdAt", "desc"));
    const unsub = onSnapshot(q, (snap) => {
      setNews(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setLoading(false);
    }, () => {
      setLoading(false);
      const t = setTimeout(() => setRetryKey((k) => k + 1), 3000);
      return () => clearTimeout(t);
    });
    return unsub;
  }, [retryKey]);
  return { news, loading };
}

export async function saveNewsArticle(id, data) {
  const now = serverTimestamp();
  if (id) {
    await updateDoc(doc(db, SITE_NEWS_COL, id), { ...data, updatedAt: now });
    return id;
  }
  const ref = await addDoc(collection(db, SITE_NEWS_COL), { ...data, createdAt: now, updatedAt: now });
  return ref.id;
}

export async function deleteNewsArticle(id) {
  await deleteDoc(doc(db, SITE_NEWS_COL, id));
}

export function generateSlug(title) {
  return title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

// ─── Sponsors ────────────────────────────────────────────────────────────────

export function useSponsors(activeOnly = true) {
  const [sponsors, setSponsors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [retryKey, setRetryKey] = useState(0);

  function isSponsorActive(value) {
    if (typeof value === "boolean") return value;
    if (typeof value === "string") return value.trim().toLowerCase() === "true";
    if (typeof value === "number") return value === 1;
    return false;
  }

  useEffect(() => {
    const q = collection(db, SITE_SPONSORS_COL);
    const unsub = onSnapshot(q, (snap) => {
      let items = snap.docs
        .map((d) => {
          const data = d.data();
          return {
            id: d.id,
            ...data,
            active: isSponsorActive(data.active),
            rawCategory: data.category ?? "",
            category: normalizeSponsorCategory(data.category),
            ...getSponsorMediaSettings(data),
          };
        })
        .filter((sponsor) => (activeOnly ? sponsor.active : true))
        .sort((a, b) => {
          const ai = sponsorCategorySortIndex(a.category);
          const bi = sponsorCategorySortIndex(b.category);
          if (ai !== bi) return ai - bi;
          return (a.order ?? 99) - (b.order ?? 99);
        });
      setSponsors(items);
      setLoading(false);
    }, () => {
      setLoading(false);
      // Retry after 3s in case of a transient permission error (e.g. auth just changed)
      const t = setTimeout(() => setRetryKey((k) => k + 1), 3000);
      return () => clearTimeout(t);
    });
    return unsub;
  }, [activeOnly, retryKey]);
  return { sponsors, loading };
}

export async function saveSponsor(id, data) {
  const now = serverTimestamp();
  if (id) {
    await updateDoc(doc(db, SITE_SPONSORS_COL, id), { ...data, updatedAt: now });
    return id;
  }
  const ref = await addDoc(collection(db, SITE_SPONSORS_COL), { ...data, createdAt: now, updatedAt: now });
  return ref.id;
}

export async function deleteSponsor(id) {
  await deleteDoc(doc(db, SITE_SPONSORS_COL, id));
}

export async function renameSponsorCategoryKey(previousKey, nextKey) {
  const trimmedPreviousKey = String(previousKey || "").trim();
  const trimmedNextKey = String(nextKey || "").trim();
  if (!trimmedPreviousKey || !trimmedNextKey || trimmedPreviousKey === trimmedNextKey) return;

  const snapshot = await getDocs(collection(db, SITE_SPONSORS_COL));
  const matchingDocs = snapshot.docs.filter((entry) => String(entry.data()?.category || "").trim() === trimmedPreviousKey);
  if (matchingDocs.length === 0) return;

  const batch = writeBatch(db);
  matchingDocs.forEach((entry) => {
    batch.update(doc(db, SITE_SPONSORS_COL, entry.id), {
      category: trimmedNextKey,
      updatedAt: serverTimestamp(),
    });
  });
  await batch.commit();
}

export function useSponsorCategories() {
  const [categories, setCategories] = useState(normalizeSponsorCategories([]));
  const [loading, setLoading] = useState(true);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      doc(db, SITE_CONTENT_COL, SITE_SPONSOR_CATEGORIES_DOC),
      (snapshot) => {
        const nextCategories = snapshot.exists()
          ? normalizeSponsorCategories(snapshot.data()?.categories)
          : normalizeSponsorCategories([]);
        setCategories(nextCategories);
        setLoading(false);
      },
      () => {
        setLoading(false);
        const t = setTimeout(() => setRetryKey((current) => current + 1), 3000);
        return () => clearTimeout(t);
      },
    );

    return unsubscribe;
  }, [retryKey]);

  return { categories, loading };
}

export async function saveSponsorCategories(categories) {
  await setDoc(
    doc(db, SITE_CONTENT_COL, SITE_SPONSOR_CATEGORIES_DOC),
    {
      categories: normalizeSponsorCategories(categories),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}

// ─── Press releases ──────────────────────────────────────────────────────────

export function usePublishedPressReleases() {
  const [releases, setReleases] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    // No composite index needed: fetch all ordered by date, filter published client-side
    const q = query(
      collection(db, SITE_PRESS_RELEASES_COL),
      orderBy("date", "desc"),
    );
    const unsub = onSnapshot(q, (snap) => {
      setReleases(snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((r) => r.published === true));
      setLoading(false);
    }, () => setLoading(false));
    return unsub;
  }, []);
  return { releases, loading };
}

export function useAllPressReleases() {
  const [releases, setReleases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [retryKey, setRetryKey] = useState(0);
  useEffect(() => {
    const q = query(collection(db, SITE_PRESS_RELEASES_COL), orderBy("date", "desc"));
    const unsub = onSnapshot(q, (snap) => {
      setReleases(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setLoading(false);
    }, () => {
      setLoading(false);
      const t = setTimeout(() => setRetryKey((k) => k + 1), 3000);
      return () => clearTimeout(t);
    });
    return unsub;
  }, [retryKey]);
  return { releases, loading };
}

export async function savePressRelease(id, data) {
  const now = serverTimestamp();
  if (id) {
    await updateDoc(doc(db, SITE_PRESS_RELEASES_COL, id), { ...data, updatedAt: now });
    return id;
  }
  const ref = await addDoc(collection(db, SITE_PRESS_RELEASES_COL), { ...data, createdAt: now, updatedAt: now });
  return ref.id;
}

export async function deletePressRelease(id) {
  await deleteDoc(doc(db, SITE_PRESS_RELEASES_COL, id));
}

// ─── Editable site content ────────────────────────────────────────────────────

export function useSiteContent(key) {
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const unsub = onSnapshot(doc(db, SITE_CONTENT_COL, key), (snap) => {
      setContent(snap.exists() ? (snap.data().content ?? "") : "");
      setLoading(false);
    }, () => setLoading(false));
    return unsub;
  }, [key]);
  return { content, loading };
}

export async function setSiteContent(key, content) {
  await setDoc(doc(db, SITE_CONTENT_COL, key), { content, updatedAt: serverTimestamp() }, { merge: true });
}

// ─── Page liens grand public (/links) ────────────────────────────────────────

export function useLinksPageSettings() {
  const [settings, setSettings] = useState(() => normalizeLinksPage());
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, SITE_CONTENT_COL, LINKS_PAGE_DOC_ID),
      (snap) => {
        setSettings(normalizeLinksPage(snap.exists() ? snap.data() : {}));
        setLoading(false);
      },
      () => setLoading(false),
    );
    return unsub;
  }, []);
  return { settings, loading };
}

export async function saveLinksPageSettings(settings) {
  await setDoc(doc(db, SITE_CONTENT_COL, LINKS_PAGE_DOC_ID), { ...normalizeLinksPage(settings), updatedAt: serverTimestamp() });
}
