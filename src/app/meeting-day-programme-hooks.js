import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../services/firebase";
import { PLANNING_DAYS, normalizeProgramme } from "./meeting-day-programme";

// Document du planning d'un jour : meetingDayProgrammes/{année}-{jour}
// (le dimanche reste {année}-sunday, son identifiant d'origine).
function programmeDocRef(year, dayKey = "sunday") {
  return doc(db, "meetingDayProgrammes", `${year}-${dayKey}`);
}

function useDayProgramme(year, dayKey = "sunday") {
  const [state, setState] = useState({ programme: null, exists: false, loading: true, error: "", key: "" });
  const key = `${year}-${dayKey}`;
  useEffect(() => {
    if (!year) return undefined;
    return onSnapshot(
      programmeDocRef(year, dayKey),
      (snapshot) =>
        setState({
          programme: normalizeProgramme(snapshot.exists() ? snapshot.data() : {}, dayKey),
          exists: snapshot.exists(),
          loading: false,
          error: "",
          key,
        }),
      () => setState({ programme: null, exists: false, loading: false, error: "Impossible de charger le planning de ce jour.", key }),
    );
  }, [year, dayKey, key]);
  // Tant que le jour demandé n'a pas répondu, on n'expose pas l'ancien jour.
  return state.key === key ? state : { programme: null, exists: false, loading: true, error: "", key };
}

function useSundayProgramme(year) {
  return useDayProgramme(year, "sunday");
}

// Tous les jours du planning d'une édition (onglets, espace bénévole).
function useAllDayProgrammes(year) {
  const [byDay, setByDay] = useState({});
  useEffect(() => {
    if (!year) return undefined;
    const unsubscribers = PLANNING_DAYS.map((day) =>
      onSnapshot(
        programmeDocRef(year, day.key),
        (snapshot) =>
          setByDay((current) => ({
            ...current,
            [day.key]: { programme: normalizeProgramme(snapshot.exists() ? snapshot.data() : {}, day.key), exists: snapshot.exists() },
          })),
        () => setByDay((current) => ({ ...current, [day.key]: { programme: null, exists: false } })),
      ),
    );
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [year]);
  return byDay;
}

export { programmeDocRef, useAllDayProgrammes, useDayProgramme, useSundayProgramme };
