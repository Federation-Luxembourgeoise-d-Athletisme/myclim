import { useEffect, useState } from "react";
import {
  collection,
  doc,
  getDocs,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { db } from "../services/firebase";
import { getPerimeterEmails, getPerimeterNames, normalizeOrganisationTeams } from "./organisation-teams";
import { normalizeTask } from "./retroplanning";

const ORGANISATION_TEAMS_REF = ["appSettings", "organisationTeams"];
const MEETING_TASKS = "meetingTasks";

// Équipes de l'organisation : lisibles par les admins et gestionnaires
// (elles contiennent les e-mails du staff).
function useOrganisationTeams(enabled = true) {
  const [state, setState] = useState({ teams: [], exists: false, loading: Boolean(enabled), error: "" });
  useEffect(() => {
    if (!enabled) return undefined;
    return onSnapshot(
      doc(db, ...ORGANISATION_TEAMS_REF),
      (snapshot) =>
        setState({
          teams: normalizeOrganisationTeams(snapshot.exists() ? snapshot.data() : {}),
          exists: snapshot.exists(),
          loading: false,
          error: "",
        }),
      () => setState({ teams: [], exists: false, loading: false, error: "Impossible de charger les équipes de l'organisation." }),
    );
  }, [enabled]);
  return enabled ? state : { teams: [], exists: false, loading: false, error: "" };
}

// Enregistre les équipes, puis remet à jour les e-mails de périmètre des
// tâches du Rétroplanning (qui voit quelle tâche) quand une équipe change.
async function saveOrganisationTeams(teams) {
  const normalized = normalizeOrganisationTeams({ teams });
  await setDoc(doc(db, ...ORGANISATION_TEAMS_REF), { teams: normalized, updatedAt: serverTimestamp() });
  const snapshot = await getDocs(collection(db, MEETING_TASKS));
  const batch = writeBatch(db);
  let changes = 0;
  snapshot.forEach((entry) => {
    const task = normalizeTask(entry.data());
    const emails = getPerimeterEmails(normalized, task.perimeter);
    const names = getPerimeterNames(normalized, task.perimeter);
    if (emails.join("|") !== [...task.perimeterEmails].sort().join("|") || names.join("|") !== task.perimeterNames.join("|")) {
      batch.update(entry.ref, { perimeterEmails: emails, perimeterNames: names });
      changes += 1;
    }
  });
  if (changes) await batch.commit();
}

// Tâches d'une édition : toutes pour un admin / gestionnaire ; sinon celles
// dont le périmètre contient une équipe dont l'utilisateur est membre.
function useMeetingTasks({ year, isManager, email, enabled = true }) {
  const [state, setState] = useState({ tasks: [], loading: true, error: "" });
  const normalizedEmail = String(email || "").toLowerCase();
  useEffect(() => {
    if (!enabled || !year || (!isManager && !normalizedEmail)) return undefined;
    const tasksQuery = isManager
      ? query(collection(db, MEETING_TASKS), where("editionYear", "==", Number(year)))
      : query(collection(db, MEETING_TASKS), where("perimeterEmails", "array-contains", normalizedEmail));
    return onSnapshot(
      tasksQuery,
      (snapshot) =>
        setState({
          tasks: snapshot.docs
            .map((entry) => normalizeTask({ ...entry.data(), id: entry.id }))
            .filter((task) => task.editionYear === Number(year)),
          loading: false,
          error: "",
        }),
      (error) => {
        console.error("Unable to load meeting tasks", error);
        setState({ tasks: [], loading: false, error: "Impossible de charger le rétroplanning." });
      },
    );
  }, [enabled, year, isManager, normalizedEmail]);
  if (!enabled || !year || (!isManager && !normalizedEmail)) return { tasks: [], loading: false, error: "" };
  return state;
}

// Pour le menu : l'utilisateur (non gestionnaire) a-t-il au moins une tâche
// dans un périmètre de son équipe ?
function useHasOwnMeetingTasks(email, enabled = true) {
  const [hasTasks, setHasTasks] = useState(false);
  const normalizedEmail = String(email || "").toLowerCase();
  useEffect(() => {
    if (!enabled || !normalizedEmail) return undefined;
    let cancelled = false;
    getDocs(query(collection(db, MEETING_TASKS), where("perimeterEmails", "array-contains", normalizedEmail), limit(1)))
      .then((snapshot) => {
        if (!cancelled) setHasTasks(!snapshot.empty);
      })
      .catch(() => {
        if (!cancelled) setHasTasks(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, normalizedEmail]);
  return enabled && normalizedEmail ? hasTasks : false;
}

export { MEETING_TASKS, saveOrganisationTeams, useHasOwnMeetingTasks, useMeetingTasks, useOrganisationTeams };
