import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../services/firebase";
import { normalizeProgramme } from "./meeting-day-programme";

// Document du programme du dimanche d'une édition : meetingDayProgrammes/{année}-sunday.
function programmeDocRef(year) {
  return doc(db, "meetingDayProgrammes", `${year}-sunday`);
}

function useSundayProgramme(year) {
  const [state, setState] = useState({ programme: null, exists: false, loading: true, error: "" });
  useEffect(() => {
    if (!year) return undefined;
    return onSnapshot(
      programmeDocRef(year),
      (snapshot) =>
        setState({
          programme: normalizeProgramme(snapshot.exists() ? snapshot.data() : {}),
          exists: snapshot.exists(),
          loading: false,
          error: "",
        }),
      () => setState((current) => ({ ...current, loading: false, error: "Impossible de charger le programme du dimanche." })),
    );
  }, [year]);
  return state;
}

export { programmeDocRef, useSundayProgramme };
