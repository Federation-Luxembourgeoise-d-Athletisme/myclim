import { useEffect, useState } from "react";
import { collection, doc, onSnapshot, query, where } from "firebase/firestore";
import {
  NATIONAL_RACE_MAIL_TEMPLATES_DOC_PATH,
  NATIONAL_RACE_REQUESTS_COLLECTION,
  normalizeNationalRaceMailTemplates,
} from "./national-races-helpers";
import { getTimestampMs } from "./u14-helpers";
import { recordMatchesEdition, useActiveEdition } from "./edition";
import { db } from "../services/firebase";

function mapRequestSnapshot(snapshot, activeEditionId) {
  return snapshot.docs
    .map((entry) => {
      const data = entry.data();
      return { id: entry.id, ...data, submittedAtMs: getTimestampMs(data.submittedAt) };
    })
    .filter((entry) => recordMatchesEdition(entry, activeEditionId));
}

function useNationalRaceRequests({ enabled = true, athleteUserId = "" } = {}) {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const { activeEditionId, loading: editionLoading, error: editionError } = useActiveEdition(enabled);

  useEffect(() => {
    if (!enabled || editionLoading) return undefined;

    setLoading(true);

    const source = athleteUserId
      ? query(collection(db, NATIONAL_RACE_REQUESTS_COLLECTION), where("athleteUserId", "==", athleteUserId))
      : collection(db, NATIONAL_RACE_REQUESTS_COLLECTION);

    const unsubscribe = onSnapshot(
      source,
      (snapshot) => {
        setRequests(mapRequestSnapshot(snapshot, activeEditionId));
        setLoading(false);
        setError("");
      },
      () => {
        setRequests([]);
        setLoading(false);
        setError("Impossible de charger les inscriptions aux courses nationales.");
      },
    );

    return unsubscribe;
  }, [activeEditionId, athleteUserId, editionLoading, enabled]);

  return enabled
    ? { requests, loading: loading || editionLoading, error: error || editionError }
    : { requests: [], loading: false, error: "" };
}

function useNationalRaceMailTemplates(enabled = true) {
  const [templates, setTemplates] = useState(() => normalizeNationalRaceMailTemplates(null));
  const [error, setError] = useState("");

  useEffect(() => {
    if (!enabled) return undefined;

    return onSnapshot(
      doc(db, ...NATIONAL_RACE_MAIL_TEMPLATES_DOC_PATH),
      (snapshot) => {
        setTemplates(normalizeNationalRaceMailTemplates(snapshot.exists() ? snapshot.data() : null));
        setError("");
      },
      () => setError("Impossible de charger les modèles de mails."),
    );
  }, [enabled]);

  return { templates, error };
}

export { useNationalRaceMailTemplates, useNationalRaceRequests };
