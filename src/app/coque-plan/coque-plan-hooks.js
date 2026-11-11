import { useEffect, useState } from "react";
import { doc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "../../services/firebase";
import { attachPlanIcons, normalizePlanElements, normalizePlanIcons, PLAN_DEFAULT_ELEMENTS } from "./coque-plan-data";

// Un seul document, lisible par le site public (siteContent) : le plan sert aussi au venue map.
// Les icônes ajoutées depuis l'éditeur (icons) y sont aussi, pour s'afficher partout où le plan est dessiné.
const PLAN_DOC = ["siteContent", "coquePlan"];

const DEFAULT_ELEMENTS = normalizePlanElements(PLAN_DEFAULT_ELEMENTS);

// Repères du plan, prêts à dessiner (icônes perso jointes). Tant que rien n'est enregistré, on part
// du plan de départ (maquette). rawElements : les repères sans les images, pour l'éditeur.
export function useCoquePlan() {
  const [state, setState] = useState({ elements: DEFAULT_ELEMENTS, rawElements: DEFAULT_ELEMENTS, icons: [], saved: false, published: false, loading: true, error: "" });
  useEffect(() => {
    const unsubscribe = onSnapshot(
      doc(db, ...PLAN_DOC),
      (snap) => {
        const data = snap.exists() ? snap.data() : {};
        const stored = data.elements;
        const icons = normalizePlanIcons(data.icons);
        const rawElements = normalizePlanElements(Array.isArray(stored) ? stored : PLAN_DEFAULT_ELEMENTS);
        setState({
          elements: attachPlanIcons(rawElements, icons),
          rawElements,
          icons,
          saved: Array.isArray(stored),
          // Le plan public n'apparaît sur le site qu'une fois validé (case « Publié sur le site »)
          published: data.published === true,
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

export async function saveCoquePlan(elements, updatedBy = "", published = false, icons = []) {
  // normalizePlanElement ne garde pas iconImg : les images restent dans icons
  await setDoc(doc(db, ...PLAN_DOC), {
    elements: normalizePlanElements(elements),
    icons: normalizePlanIcons(icons),
    published,
    updatedAt: serverTimestamp(),
    updatedBy,
  });
}
