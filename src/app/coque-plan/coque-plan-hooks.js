import { useEffect, useState } from "react";
import { doc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "../../services/firebase";
import { normalizePlanElements, PLAN_DEFAULT_ELEMENTS } from "./coque-plan-data";

// Un seul document, lisible par le site public (siteContent) : le plan sert aussi au venue map.
const PLAN_DOC = ["siteContent", "coquePlan"];

// Repères du plan. Tant que rien n'est enregistré, on part du plan de départ (maquette).
export function useCoquePlan() {
  const [state, setState] = useState({ elements: normalizePlanElements(PLAN_DEFAULT_ELEMENTS), saved: false, loading: true, error: "" });
  useEffect(() => {
    const unsubscribe = onSnapshot(
      doc(db, ...PLAN_DOC),
      (snap) => {
        const stored = snap.exists() ? snap.data().elements : null;
        setState({
          elements: normalizePlanElements(Array.isArray(stored) ? stored : PLAN_DEFAULT_ELEMENTS),
          saved: Array.isArray(stored),
          updatedAt: snap.exists() ? snap.data().updatedAt || null : null,
          updatedBy: snap.exists() ? snap.data().updatedBy || "" : "",
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

export async function saveCoquePlan(elements, updatedBy = "") {
  await setDoc(doc(db, ...PLAN_DOC), { elements: normalizePlanElements(elements), updatedAt: serverTimestamp(), updatedBy });
}
