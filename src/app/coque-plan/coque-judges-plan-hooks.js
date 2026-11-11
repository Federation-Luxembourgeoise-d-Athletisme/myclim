import { useEffect, useState } from "react";
import { doc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "../../services/firebase";
import { JUDGES_DEFAULT_ELEMENTS, JUDGES_DEFAULT_TEAMS, normalizeJudgesElements, normalizeJudgesTeams } from "./coque-judges-plan-data";

// Document interne (pas sur le site public) : lecture et écriture admins / gestionnaires.
const JUDGES_PLAN_DOC = ["accreditationPlans", "judgesInfield"];

export function judgesPlanDefaults() {
  const teams = normalizeJudgesTeams(JUDGES_DEFAULT_TEAMS);
  return { teams, elements: normalizeJudgesElements(JUDGES_DEFAULT_ELEMENTS, teams) };
}

export function useJudgesPlan() {
  const [state, setState] = useState(() => ({ ...judgesPlanDefaults(), saved: false, loading: true, error: "" }));
  useEffect(() => {
    const unsubscribe = onSnapshot(
      doc(db, ...JUDGES_PLAN_DOC),
      (snap) => {
        const data = snap.exists() ? snap.data() : {};
        const saved = Array.isArray(data.elements);
        const teams = normalizeJudgesTeams(Array.isArray(data.teams) ? data.teams : JUDGES_DEFAULT_TEAMS);
        setState({
          teams,
          elements: normalizeJudgesElements(saved ? data.elements : JUDGES_DEFAULT_ELEMENTS, teams),
          saved,
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

export async function saveJudgesPlan(elements, teams, updatedBy = "") {
  const cleanTeams = normalizeJudgesTeams(teams);
  await setDoc(doc(db, ...JUDGES_PLAN_DOC), {
    teams: cleanTeams,
    elements: normalizeJudgesElements(elements, cleanTeams),
    updatedAt: serverTimestamp(),
    updatedBy,
  });
}
