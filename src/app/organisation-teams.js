// Équipes de l'organisation (Équipes & affectations › Équipes organisation) :
// le staff, la communication, les étudiants LUNEX, Apex, la TV, les juges…
// Décision de Margot (09/11/2026) : elles vivent dans Équipes, à côté des
// équipes bénévoles ; un membre est un compte de l'app (e-mail) ou juste un
// prénom + nom. Elles servent de colonnes au Planning et de périmètre au
// Rétroplanning.
//
// Document Firestore : appSettings/organisationTeams
//   { teams: [{ id, name, description, members: [{ id, firstName, lastName, email, phone, lead, access }] }] }
//
// Accès d'un membre (Margot, 12/11/2026 : lier des comptes avec les droits
// qui vont bien, et leur envoyer un lien d'activation) :
//  - « none »         : pas de compte (juste un nom dans l'équipe) ;
//  - « organisation » : compte MyCLIM limité à Mon planning, Mes échéances
//                        et Mes décomptes (rôle « organisation ») ;
//  - « staff »        : Staff FLA, rôle « gestionnaire » (toute la gestion
//                        sauf le budget ; les étudiants LUNEX l'ont aussi).
// Règles pures, testées dans tests/organisation-teams.test.js.

function normalizeKey(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9@]+/g, " ")
    .trim();
}

// Équipes proposées au départ, d'après le fichier « Task and Organisation »
// de l'an dernier (périmètres des tâches et colonnes du vendredi/samedi).
// `aliases` sert uniquement à l'import de l'an dernier.
const DEFAULT_ORGANISATION_TEAMS = [
  { id: "staff", name: "Staff", aliases: ["staff", "conf athlete@work", "conf athlete work"] },
  { id: "communication", name: "Communication", aliases: ["communication"] },
  { id: "vip", name: "VIP", aliases: ["vip"] },
  { id: "juges", name: "Juges & officiels", aliases: ["juges", "officials", "judges"] },
  { id: "lunex", name: "Étudiants LUNEX", aliases: ["master lunex", "lunex", "lunex students"] },
  { id: "preprogramme", name: "Pré-programme", aliases: ["pre program", "pre programme", "pre programme zone d echauffement"] },
  { id: "benevoles", name: "Coordination bénévoles", aliases: ["volunteers"] },
  { id: "durabilite", name: "Durabilité", aliases: ["sustainability"] },
  { id: "technique", name: "Technique & installation", aliases: ["installation", "technical installation"] },
  { id: "apex", name: "Apex", aliases: ["apex"] },
  { id: "tv", name: "TV", aliases: ["tv"] },
  { id: "presentation", name: "Event presentation", aliases: ["event presentation"] },
  { id: "speakers", name: "Speakers (Athle.ch)", aliases: ["speakers athle ch", "speakers"] },
];

function cleanText(value) {
  return String(value || "").trim();
}

const ORGANISATION_ACCESS = [
  { value: "none", label: "Pas de compte", role: "" },
  { value: "organisation", label: "Organisation", role: "organisation", help: "Son planning, ses échéances et ses décomptes" },
  { value: "staff", label: "Staff FLA", role: "gestionnaire", help: "Gestionnaire : toute la gestion sauf le budget" },
];

function getAccessOption(access) {
  return ORGANISATION_ACCESS.find((option) => option.value === access) || ORGANISATION_ACCESS[0];
}

// Où en est le compte d'un membre : « active » (compte qui a déjà le bon
// rôle), « missing-role » (compte existant sans ce rôle), « invited »
// (invitation en attente), « none » (rien encore) ou « no-access ».
function getMemberAccountStatus(member = {}, { user = null, invitation = null } = {}) {
  const option = getAccessOption(member.access);
  if (!option.role) return "no-access";
  if (user) {
    const roles = Array.isArray(user.userTypes) ? user.userTypes : [];
    const covered = roles.includes(option.role) || roles.includes("admin") || (option.role === "organisation" && roles.includes("gestionnaire"));
    return covered ? "active" : "missing-role";
  }
  if (invitation && invitation.status === "pending") {
    const expiresAt = invitation.expiresAt?.toDate ? invitation.expiresAt.toDate() : invitation.expiresAt ? new Date(invitation.expiresAt) : null;
    if (!expiresAt || expiresAt > new Date()) return "invited";
  }
  return "none";
}

function normalizeMember(member = {}) {
  const email = cleanText(member.email).toLowerCase();
  return {
    id: cleanText(member.id) || `m-${Math.random().toString(36).slice(2, 10)}`,
    firstName: cleanText(member.firstName),
    lastName: cleanText(member.lastName),
    email,
    phone: cleanText(member.phone),
    lead: Boolean(member.lead),
    // Sans choix explicite : un membre avec e-mail a un accès Organisation.
    access: ORGANISATION_ACCESS.some((option) => option.value === member.access) ? member.access : email ? "organisation" : "none",
  };
}

function normalizeOrganisationTeams(data = {}) {
  const seen = new Set();
  return (Array.isArray(data?.teams) ? data.teams : [])
    .filter((team) => team?.id && cleanText(team.name) && !seen.has(team.id) && seen.add(team.id))
    .map((team) => ({
      id: String(team.id),
      name: cleanText(team.name),
      description: cleanText(team.description),
      members: (Array.isArray(team.members) ? team.members : []).map(normalizeMember),
    }));
}

function buildDefaultOrganisationTeams() {
  return DEFAULT_ORGANISATION_TEAMS.map(({ id, name }) => ({ id, name, description: "", members: [] }));
}

function memberDisplayName(member = {}) {
  return [member.firstName, member.lastName].filter(Boolean).join(" ") || member.email || "—";
}

// Une équipe de l'an dernier (« Master Lunex », « Officials »…) retrouvée
// par son nom ou par un alias connu.
function findOrganisationTeam(teams = [], legacyName = "") {
  const key = normalizeKey(legacyName);
  if (!key) return null;
  const direct = teams.find((team) => normalizeKey(team.name) === key);
  if (direct) return direct;
  const known = DEFAULT_ORGANISATION_TEAMS.find((team) => team.aliases.includes(key));
  return known ? teams.find((team) => team.id === known.id) || null : null;
}

// E-mails des membres des équipes d'un périmètre : ce sont eux qui voient
// (et font avancer) les tâches de ce périmètre dans le Rétroplanning.
function getPerimeterEmails(teams = [], perimeterIds = []) {
  const emails = new Set();
  teams
    .filter((team) => perimeterIds.includes(team.id))
    .forEach((team) => team.members.forEach((member) => member.email && emails.add(member.email.toLowerCase())));
  return [...emails].sort();
}

// Noms des équipes d'un périmètre, recopiés sur la tâche : un membre qui
// n'a pas accès à la liste des équipes (e-mails du staff) les voit quand même.
function getPerimeterNames(teams = [], perimeterIds = []) {
  return perimeterIds.map((id) => teams.find((team) => team.id === id)?.name).filter(Boolean);
}

// Équipes de chaque membre, par e-mail : recopiées dans
// organisationMembers/{e-mail} pour que chacun retrouve SES équipes (Mon
// planning, filtre « Mes équipes ») sans lire la liste complète du staff.
function buildMembershipByEmail(teams = []) {
  const byEmail = {};
  teams.forEach((team) =>
    team.members.forEach((member) => {
      const email = String(member.email || "").trim().toLowerCase();
      if (!email) return;
      byEmail[email] = byEmail[email] || [];
      if (!byEmail[email].some((entry) => entry.id === team.id)) {
        byEmail[email].push({ id: team.id, name: team.name, lead: Boolean(member.lead) });
      }
    }),
  );
  return byEmail;
}

export {
  ORGANISATION_ACCESS,
  getAccessOption,
  getMemberAccountStatus,
  DEFAULT_ORGANISATION_TEAMS,
  buildMembershipByEmail,
  getPerimeterNames,
  buildDefaultOrganisationTeams,
  findOrganisationTeam,
  getPerimeterEmails,
  memberDisplayName,
  normalizeKey,
  normalizeMember,
  normalizeOrganisationTeams,
};
