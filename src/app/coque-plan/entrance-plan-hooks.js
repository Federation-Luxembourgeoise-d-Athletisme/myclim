import { useEffect, useState } from "react";
import { doc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "../../services/firebase";
import { ENTRANCE_DEFAULT_ITEMS, normalizeEntranceItems } from "./entrance-plan-data";

// Document à part (le plan général reste dans siteContent/coquePlan) : même règles d'écriture.
const ENTRANCE_DOC = ["siteContent", "coqueEntrancePlan"];

// Plan de l'entrée enregistré ; tant que rien n'est enregistré, le plan de départ (à ajuster).
export function useEntrancePlan() {
  const [state, setState] = useState({ items: ENTRANCE_DEFAULT_ITEMS, saved: false, loading: true, error: "" });
  useEffect(() => {
    const unsubscribe = onSnapshot(
      doc(db, ...ENTRANCE_DOC),
      (snap) => {
        const data = snap.exists() ? snap.data() : {};
        const stored = Array.isArray(data.items);
        setState({
          items: stored ? normalizeEntranceItems(data.items) : ENTRANCE_DEFAULT_ITEMS,
          saved: stored,
          updatedAt: data.updatedAt || null,
          updatedBy: data.updatedBy || "",
          loading: false,
          error: "",
        });
      },
      (error) => setState((current) => ({ ...current, loading: false, error: error?.message || "Lecture du plan impossible." })),
    );
    return unsubscribe;
  }, []);
  return state;
}

export async function saveEntrancePlan(items, updatedBy = "") {
  await setDoc(doc(db, ...ENTRANCE_DOC), {
    items: normalizeEntranceItems(items),
    updatedAt: serverTimestamp(),
    updatedBy,
  });
}
