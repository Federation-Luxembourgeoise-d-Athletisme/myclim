import { addDoc, collection, doc, getDocs, limit, query, serverTimestamp, setDoc, where } from "firebase/firestore";
import { db } from "../services/firebase";
import { getAppBaseUrl } from "../services/app-url";

// Chef d'équipe nommé directement (Margot, 12/11/2026 : « Jane Doe sera
// cheffe de la VIP team, je sais où elle va, pourquoi lui faire remplir le
// formulaire bénévole ? »). On crée sa fiche bénévole déjà affectée comme
// « Chef d'équipe » ; si la personne a déjà un compte, la fiche y est reliée et le
// rôle chef_equipe suit l'affectation ; sinon un admin lui envoie un lien
// d'activation (rôles benevole + chef_equipe) qui relie la fiche à son compte.

const LEAD_ROLE = "Chef d'équipe";
const MEMBER_ROLE = "Bénévole";
// Margot, 12/11/2026 : « on doit pouvoir y mettre n'importe qui » — la même
// création sert aussi pour un simple bénévole (fonction « Bénévole »), depuis
// le panneau ou la recherche des cartes d'équipe.

async function findActiveUserByEmail(email) {
  const snapshot = await getDocs(query(collection(db, "users"), where("email", "==", email), limit(5)));
  const entry = snapshot.docs.find((item) => {
    const data = item.data();
    return data.accountStatus !== "disabled" && (!data.uid || data.uid === item.id);
  });
  return entry ? { id: entry.id, ...entry.data() } : null;
}

async function createDirectMember(
  { firstName, lastName, email, teamName, editionId, canInvite, memberRole = LEAD_ROLE, knownUser = undefined },
  sync,
) {
  const normalizedEmail = email.trim().toLowerCase();
  const isLead = memberRole === LEAD_ROLE;
  const user = knownUser === undefined ? await findActiveUserByEmail(normalizedEmail) : knownUser;
  const existing = await getDocs(query(collection(db, "volunteerApplications"), where("email", "==", normalizedEmail), limit(5)));
  if (existing.docs.some((entry) => String(entry.data().editionId || "") === String(editionId || ""))) {
    throw new Error("already-applied");
  }
  const application = {
    editionId,
    uid: user?.id || "",
    firstName: firstName.trim(),
    lastName: lastName.trim(),
    email: normalizedEmail,
    phone: "",
    languages: [],
    availability: [],
    assignedRole: teamName,
    assignedRoles: [teamName],
    teamRole: memberRole,
    teamRoleAssignments: { [teamName]: memberRole },
    assignmentStatus: "Confirmé",
    workflowStatus: "Affecté",
    directTeamLead: isLead,
    directAssignment: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  const created = await addDoc(collection(db, "volunteerApplications"), application);
  const volunteer = { ...application, id: created.id };
  await Promise.all([sync.teams(volunteer), user ? sync.profile(volunteer) : Promise.resolve()]);
  if (user) return { linked: true };
  if (!canInvite) return { linked: false, invited: false };

  const token = crypto.randomUUID();
  await setDoc(doc(db, "invitations", token), {
    email: normalizedEmail,
    firstName: application.firstName,
    lastName: application.lastName,
    roles: isLead ? ["benevole", "chef_equipe"] : ["benevole"],
    roleLabels: [`${memberRole} · ${teamName}`],
    token,
    status: "pending",
    source: isLead ? "directTeamLead" : "directAssignment",
    applicationId: created.id,
    ...(isLead ? { leadTeam: teamName } : { memberTeam: teamName }),
    createdAt: serverTimestamp(),
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  });
  const activationUrl = `${getAppBaseUrl()}/invite?token=${token}`;
  let mailSent = false;
  try {
    const { enqueueTransactionalMail, buildInvitationMail } = await import("../services/mailQueue");
    await enqueueTransactionalMail(
      buildInvitationMail({ email: normalizedEmail, firstName: application.firstName, roles: [`${memberRole} · ${teamName}`], activationUrl }),
    );
    mailSent = true;
  } catch (mailError) {
    console.error("Unable to send the team lead invitation", mailError);
  }
  return { linked: false, invited: true, activationUrl, mailSent };
}

export { LEAD_ROLE, MEMBER_ROLE, createDirectMember, findActiveUserByEmail };
