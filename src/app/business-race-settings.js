import { useEffect, useState } from "react";
import { Timestamp, doc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "../services/firebase";
import { DEFAULT_BUSINESS_RACE_SETTINGS, getTeamsDeadlineEnd, normalizeBusinessRaceSettings } from "./business-race-helpers";

// Réglages Business Race communs à toutes les entreprises (businessRaceSettings/current) :
// lecture pour tous (portails), écriture admin / gestionnaires.
const BUSINESS_RACE_SETTINGS_DOC = ["businessRaceSettings", "current"];

function useBusinessRaceSettings() {
  const [settings, setSettings] = useState(() => normalizeBusinessRaceSettings(DEFAULT_BUSINESS_RACE_SETTINGS));
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  useEffect(
    () =>
      onSnapshot(
        doc(db, ...BUSINESS_RACE_SETTINGS_DOC),
        (snapshot) => {
          setSettings(normalizeBusinessRaceSettings(snapshot.exists() ? snapshot.data() : DEFAULT_BUSINESS_RACE_SETTINGS));
          setSaved(snapshot.exists());
          setLoading(false);
        },
        () => setLoading(false),
      ),
    [],
  );
  return { settings, saved, loading };
}

// teamsDeadlineAt : fin du dernier jour, lu par les règles Firestore pour
// refuser les modifications d'équipe des entreprises après la date.
async function saveBusinessRaceSettings(draft) {
  const settings = normalizeBusinessRaceSettings(draft);
  const end = getTeamsDeadlineEnd(settings);
  await setDoc(doc(db, ...BUSINESS_RACE_SETTINGS_DOC), {
    ...settings,
    teamsDeadlineAt: end ? Timestamp.fromDate(end) : null,
    updatedAt: serverTimestamp(),
  });
}

export { saveBusinessRaceSettings, useBusinessRaceSettings };
