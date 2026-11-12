import { useEffect, useState } from "react";
import {
  arrayUnion,
  collection,
  doc,
  getDocs,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { db } from "../services/firebase";
import { getAppBaseUrl } from "../services/app-url";
import { getAccessOption, buildMembershipByEmail, getPerimeterEmails, getPerimeterNames, normalizeOrganisationTeams } from "./organisation-teams";
import { normalizeTask } from "./retroplanning";

const ORGANISATION_TEAMS_REF = ["appSettings", "organisationTeams"];
const MEETING_TASKS = "meetingTasks";
// Une fiche par membre (identifiant = son e-mail) : ses équipes de
// l'organisation, lisibles par lui seul (règles Firestore).
const ORGANISATION_MEMBERS = "organisationMembers";

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

// Enregistre les équipes, puis remet à jour :
//  - la fiche de chaque membre (ses équipes, pour Mon planning) ;
//  - les e-mails et noms de périmètre des tâches du Rétroplanning.
async function saveOrganisationTeams(teams) {
  const normalized = normalizeOrganisationTeams({ teams });
  await setDoc(doc(db, ...ORGANISATION_TEAMS_REF), { teams: normalized, updatedAt: serverTimestamp() });

  const membership = buildMembershipByEmail(normalized);
  const previous = await getDocs(collection(db, ORGANISATION_MEMBERS));
  const memberBatch = writeBatch(db);
  previous.forEach((entry) => {
    if (!membership[entry.id]) memberBatch.delete(entry.ref);
  });
  Object.entries(membership).forEach(([email, teamsOfMember]) => {
    const current = previous.docs.find((entry) => entry.id === email)?.data()?.teams || [];
    if (JSON.stringify(current) !== JSON.stringify(teamsOfMember)) {
      memberBatch.set(doc(db, ORGANISATION_MEMBERS, email), { teams: teamsOfMember, updatedAt: serverTimestamp() });
    }
  });
  await memberBatch.commit();

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

// Les équipes de l'organisation de l'utilisateur connecté ([{ id, name, lead }]).
function useMyOrganisationTeams(email, enabled = true) {
  const [state, setState] = useState({ teams: [], loading: true, key: "" });
  const normalizedEmail = String(email || "").trim().toLowerCase();
  useEffect(() => {
    if (!enabled || !normalizedEmail) return undefined;
    return onSnapshot(
      doc(db, ORGANISATION_MEMBERS, normalizedEmail),
      (snapshot) =>
        setState({
          teams: Array.isArray(snapshot.data()?.teams) ? snapshot.data().teams : [],
          loading: false,
          key: normalizedEmail,
        }),
      () => setState({ teams: [], loading: false, key: normalizedEmail }),
    );
  }, [enabled, normalizedEmail]);
  if (!enabled || !normalizedEmail) return { teams: [], loading: false };
  return state.key === normalizedEmail ? state : { teams: [], loading: true };
}

// ─── Comptes des membres (Équipes organisation) ─────────────────────────────

function chunks(values, size) {
  const out = [];
  for (let index = 0; index < values.length; index += size) out.push(values.slice(index, index + size));
  return out;
}

// Comptes MyCLIM et invitations des e-mails donnés. Les invitations ne sont
// lisibles que par un admin : pour un gestionnaire, la liste reste vide.
function useMemberAccounts(emails = [], { canReadInvitations = false, refreshKey = 0 } = {}) {
  const [state, setState] = useState({ usersByEmail: {}, invitationsByEmail: {}, loading: true });
  const key = [...new Set(emails.map((email) => String(email || "").trim().toLowerCase()).filter(Boolean))].sort().join("|");
  useEffect(() => {
    let cancelled = false;
    const list = key ? key.split("|") : [];
    async function load() {
      const usersByEmail = {};
      const invitationsByEmail = {};
      for (const group of chunks(list, 30)) {
        const snapshot = await getDocs(query(collection(db, "users"), where("email", "in", group)));
        snapshot.docs.forEach((entry) => {
          const data = entry.data();
          // Un profil n'est un compte activé que si son id est l'uid.
          if (data.accountStatus === "disabled" || (data.uid && data.uid !== entry.id)) return;
          usersByEmail[String(data.email).toLowerCase()] = { id: entry.id, ...data };
        });
        if (canReadInvitations) {
          const invitations = await getDocs(query(collection(db, "invitations"), where("email", "in", group)));
          invitations.docs
            .map((entry) => ({ id: entry.id, ...entry.data() }))
            .filter((invitation) => invitation.status === "pending")
            .forEach((invitation) => {
              const email = String(invitation.email).toLowerCase();
              const current = invitationsByEmail[email];
              const time = (value) => (value?.toMillis ? value.toMillis() : 0);
              if (!current || time(invitation.createdAt) > time(current.createdAt)) invitationsByEmail[email] = invitation;
            });
        }
      }
      if (!cancelled) setState({ usersByEmail, invitationsByEmail, loading: false });
    }
    load().catch((error) => {
      console.error("Unable to load member accounts", error);
      if (!cancelled) setState({ usersByEmail: {}, invitationsByEmail: {}, loading: false });
    });
    return () => {
      cancelled = true;
    };
  }, [key, canReadInvitations, refreshKey]);
  return state;
}

// Lien d'activation pour un membre : une invitation (7 jours) avec le rôle
// de son accès, et l'e-mail d'invitation habituel. Renvoie le lien, et si
// l'e-mail est parti.
async function sendMemberInvitation(member, previousInvitation = null) {
  const option = getAccessOption(member.access);
  if (!option.role || !member.email) throw new Error("Ce membre n'a pas d'accès ou pas d'e-mail.");
  const token = crypto.randomUUID();
  const roleLabel = option.value === "staff" ? "Staff FLA (gestionnaire)" : "Membre de l'organisation";
  await setDoc(doc(db, "invitations", token), {
    email: member.email.toLowerCase(),
    firstName: member.firstName,
    lastName: member.lastName,
    roles: [option.role],
    roleLabels: [roleLabel],
    token,
    status: "pending",
    source: "organisationTeams",
    createdAt: serverTimestamp(),
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  });
  // Le lien précédent ne sert plus.
  if (previousInvitation?.id) await updateDoc(doc(db, "invitations", previousInvitation.id), { status: "cancelled" }).catch(() => {});
  const activationUrl = `${getAppBaseUrl()}/invite?token=${token}`;
  let mailSent = false;
  try {
    const { enqueueTransactionalMail, buildInvitationMail } = await import("../services/mailQueue");
    await enqueueTransactionalMail(buildInvitationMail({ email: member.email, firstName: member.firstName, roles: [roleLabel], activationUrl }));
    mailSent = true;
  } catch (error) {
    console.error("Unable to send the invitation e-mail", error);
  }
  return { activationUrl, mailSent };
}

// Compte déjà activé : on lui ajoute le rôle de son accès (sans rien retirer).
async function grantMemberAccess(user, member) {
  const option = getAccessOption(member.access);
  if (!option.role || !user?.id) return;
  await updateDoc(doc(db, "users", user.id), { userTypes: arrayUnion(option.role), updatedAt: serverTimestamp() });
}

// Comptes existants dont le nom ou l'e-mail commence par le texte saisi.
async function searchUserAccounts(text) {
  const needle = String(text || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
  const words = needle.split(/[^a-z0-9]+/).filter((word) => word.length >= 2);
  if (!words.length) return [];
  const snapshot = await getDocs(query(collection(db, "users"), where("searchTokens", "array-contains", words[0].slice(0, 10)), limit(20)));
  return snapshot.docs
    .map((entry) => ({ id: entry.id, ...entry.data() }))
    .filter((user) => user.email && user.accountStatus !== "disabled" && (!user.uid || user.uid === user.id))
    .filter((user) => (user.searchTokens || []).length === 0 || words.every((word) => user.searchTokens.includes(word.slice(0, 10))))
    .slice(0, 8);
}

export {
  grantMemberAccess,
  searchUserAccounts,
  sendMemberInvitation,
  useMemberAccounts,
  MEETING_TASKS,
  saveOrganisationTeams,
  useHasOwnMeetingTasks,
  useMeetingTasks,
  useMyOrganisationTeams,
  useOrganisationTeams,
};
