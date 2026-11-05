import { extractRolesFromProfile } from "./utils";

// Adresse de chaque page du back-office. Le menu, l'accueil et les
// redirections lisent tous cette table : une page = une seule adresse.
const APP_ROUTES = {
  home: "/app",
  edition: "/app/edition",
  budget: "/app/budget",
  documents: "/app/documents",
  applications: "/app/candidatures",
  teams: "/app/equipes",
  entries: "/app/athletes",
  transport: "/app/transport",
  roadbook: "/app/roadbook",
  physio: "/app/kine",
  results: "/app/resultats",
  u14: "/app/u14",
  nationalRaces: "/app/courses-nationales",
  accreditations: "/app/accreditations",
  vip: "/app/vip",
  cashDesk: "/app/caisse",
  attendance: "/app/presences",
  emergencyExports: "/app/documents",
  calendar: "/app/calendrier",
  tasks: "/app/taches",
  partners: "/app/partenaires",
  press: "/app/presse",
  news: "/app/actualites",
  emagazine: "/app/e-magazine",
  links: "/app/page-liens",
  users: "/app/utilisateurs",
  settings: "/app/reglages",
  notifications: "/app/notifications",
  account: "/app/mon-compte",
  myAssignments: "/app/mes-affectations",
  myDocuments: "/app/mes-documents",
  myTeam: "/app/mon-equipe",
  myTeamAttendance: "/app/presences",
  myChildren: "/app/mes-enfants",
  myTransports: "/app/mes-transports",
  myNationalRace: "/app/mon-inscription",
};

// Anciennes adresses → nouvelles (liens déjà envoyés par e-mail, favoris).
// La clé est le chemin sous /app ; un « /* » garde la fin de l'adresse
// (sous-onglet) et la requête.
const LEGACY_APP_REDIRECTS = {
  "edition-meeting": "/app/edition/changer",
  "website/edition": APP_ROUTES.edition,
  "benevoles": APP_ROUTES.applications,
  "postes": APP_ROUTES.teams,
  "athlete-roadbook": APP_ROUTES.roadbook,
  "roles": APP_ROUTES.users,
  "invitations": "/app/utilisateurs/inviter",
  "certificat": APP_ROUTES.settings,
  "profil": APP_ROUTES.account,
  "equipe": APP_ROUTES.myTeam,
  "communication/taches": APP_ROUTES.tasks,
  "communication/partenaires/*": "/app/partenaires/contreparties",
  "communication/*": APP_ROUTES.calendar,
  "website": APP_ROUTES.home,
  "website/news": APP_ROUTES.news,
  "website/emagazine": APP_ROUTES.emagazine,
  "website/links": APP_ROUTES.links,
  "athlete-portal": APP_ROUTES.entries,
  "athlete-portal/athletes": APP_ROUTES.entries,
  "athlete-portal/transport": APP_ROUTES.transport,
  "athlete-portal/mes-transport": APP_ROUTES.myTransports,
  "athlete-portal/history": APP_ROUTES.results,
  "statistics": APP_ROUTES.results,
  "statistics/results": APP_ROUTES.results,
  "statistics/records": "/app/resultats/records",
  "statistics/winners": "/app/resultats/hall-of-winners",
  "statistics/registry": "/app/resultats/base-athletes",
  "athlete-portal/records": "/app/resultats/records",
  "athlete-portal/winners": "/app/resultats/hall-of-winners",
  "athlete-portal/registry": "/app/resultats/base-athletes",
  "website/press": "/app/presse/communiques",
  "website/sponsors": APP_ROUTES.partners,
};

function makeSection(titleKey, title, links) {
  return { type: "section", titleKey, title, links };
}

function makeLink(to, labelKey, label, icon) {
  return { to, labelKey, label, icon };
}

function getActiveRoles(profile) {
  const roles = extractRolesFromProfile(profile);
  return roles.length ? roles : ["benevole"];
}

function getPrimaryRole(profile) {
  const roles = getActiveRoles(profile);

  if (roles.includes("admin")) return "admin";
  if (roles.includes("budget")) return "budget";
  if (roles.includes("gestionnaire")) return "gestionnaire";
  if (roles.includes("chef_equipe")) return "chef_equipe";
  if (roles.includes("parent_u14")) return "parent_u14";
  if (roles.includes("athlete_preprogram")) return "athlete_preprogram";
  return "benevole";
}

function buildNavigation(profile, options) {
  return buildNavigationFromRoles(getActiveRoles(profile), options);
}

function getDefaultRouteByRoles(roles = []) {
  if (roles.includes("admin")) return APP_ROUTES.home;
  if (roles.includes("budget")) return APP_ROUTES.budget;
  if (roles.includes("gestionnaire")) return APP_ROUTES.applications;
  if (roles.includes("gestionnaire_site")) return APP_ROUTES.news;
  if (roles.includes("chef_equipe")) return APP_ROUTES.myTeam;
  if (roles.includes("chef_transport_athletes")) return APP_ROUTES.transport;
  if (roles.includes("benevole_transport_athletes")) return APP_ROUTES.myTransports;
  if (roles.includes("kine")) return APP_ROUTES.physio;
  if (roles.includes("commission_athletes")) return APP_ROUTES.nationalRaces;
  if (roles.includes("benevole")) return APP_ROUTES.myAssignments;
  if (roles.includes("parent_u14")) return APP_ROUTES.myChildren;
  if (roles.includes("athlete_preprogram")) return APP_ROUTES.myNationalRace;
  return APP_ROUTES.home;
}

// Les liens, un par page. Le libellé du menu est aussi le titre de la page.
const LINKS = {
  home: () => makeLink(APP_ROUTES.home, "navHome", "Accueil", "dashboard"),
  edition: () => makeLink(APP_ROUTES.edition, "navEdition", "Édition", "calendar"),
  budget: () => makeLink(APP_ROUTES.budget, "navBudget", "Budget", "dashboard"),
  documents: () => makeLink(APP_ROUTES.documents, "navDocuments", "Documents", "folder"),
  applications: () => makeLink(APP_ROUTES.applications, "navApplications", "Candidatures", "users"),
  teams: () => makeLink(APP_ROUTES.teams, "navTeamsAssignments", "Équipes & affectations", "grid"),
  entries: () => makeLink(APP_ROUTES.entries, "navEntries", "Engagés", "users"),
  transport: () => makeLink(APP_ROUTES.transport, "navAthleteTransport", "Transport", "pin"),
  roadbook: () => makeLink(APP_ROUTES.roadbook, "navRoadbook", "Roadbook", "folder"),
  physio: () => makeLink(APP_ROUTES.physio, "navPhysio", "Kiné", "users"),
  results: () => makeLink(APP_ROUTES.results, "navResultsRecords", "Résultats & records", "trophy"),
  u14: () => makeLink(APP_ROUTES.u14, "navPreprogramU12U14", "U12 / U14", "child"),
  nationalRaces: () => makeLink(APP_ROUTES.nationalRaces, "navNationalRaces", "Courses nationales", "spark"),
  accreditations: () => makeLink(APP_ROUTES.accreditations, "navAccreditations", "Accréditations", "ticket"),
  vip: () => makeLink(APP_ROUTES.vip, "navVip", "VIP", "star"),
  cashDesk: () => makeLink(APP_ROUTES.cashDesk, "navCashDesk", "Caisse & entrées", "check"),
  attendance: () => makeLink(APP_ROUTES.attendance, "navAttendance", "Présences", "check"),
  emergencyExports: () => makeLink(APP_ROUTES.emergencyExports, "navEmergencyExports", "Exports d'urgence", "shield"),
  calendar: () => makeLink(APP_ROUTES.calendar, "navCalendar", "Calendrier", "calendar"),
  tasks: () => makeLink(APP_ROUTES.tasks, "navTasks", "Tâches", "check"),
  partners: () => makeLink(APP_ROUTES.partners, "navPartners", "Partenaires", "badge"),
  press: () => makeLink(APP_ROUTES.press, "navPress", "Presse", "folder"),
  // Gestionnaire du site seul : il n'a accès qu'aux onglets « site » de ces pages.
  pressReleases: () => makeLink("/app/presse/communiques", "navPress", "Presse", "folder"),
  news: () => makeLink(APP_ROUTES.news, "navWebsiteNews", "Actualités", "spark"),
  emagazine: () => makeLink(APP_ROUTES.emagazine, "navWebsiteEmagazine", "E-magazine", "folder"),
  links: () => makeLink(APP_ROUTES.links, "navWebsiteLinks", "Page liens (QR)", "grid"),
  users: () => makeLink(APP_ROUTES.users, "navUsersRoles", "Utilisateurs & rôles", "shield"),
  settings: () => makeLink(APP_ROUTES.settings, "navSettings", "Réglages", "shield"),
  myAssignments: () => makeLink(APP_ROUTES.myAssignments, "navMyAssignments", "Mes affectations", "pin"),
  myDocuments: () => makeLink(APP_ROUTES.myDocuments, "navMyDocuments", "Mes documents", "folder"),
  myTeam: () => makeLink(APP_ROUTES.myTeam, "navMyTeam", "Mon équipe", "users"),
  myTeamAttendance: () => makeLink(APP_ROUTES.myTeamAttendance, "navTeamAttendance", "Présences de l'équipe", "check"),
  myChildren: () => makeLink(APP_ROUTES.myChildren, "navMyChildren", "Mes enfants", "child"),
  myTransports: () => makeLink(APP_ROUTES.myTransports, "navMyTransports", "Mes transports", "pin"),
  myNationalRace: () => makeLink(APP_ROUTES.myNationalRace, "navMyNationalRace", "Mon inscription", "spark"),
};

const SECTION_TITLES = {
  steering: ["navSectionSteering", "Pilotage"],
  volunteers: ["navSectionVolunteers", "Bénévoles"],
  athletes: ["navSectionAthletes", "Athlètes"],
  preprogram: ["navSectionPreprogram", "Pré-programme"],
  accessDay: ["navSectionAccessDay", "Accès & jour J"],
  communication: ["navSectionCommunication", "Communication"],
  website: ["navSectionWebsite", "Site web"],
  administration: ["navSectionAdministration", "Administration"],
  mySpace: ["navSectionMySpace", "Mon espace"],
};

function section(key, linkKeys) {
  const links = linkKeys.filter(Boolean).map((linkKey) => LINKS[linkKey]());
  if (!links.length) return null;
  const [titleKey, title] = SECTION_TITLES[key];
  return makeSection(titleKey, title, links);
}

// Pages personnelles (« Mon espace ») d'après les rôles détenus.
function personalLinkKeys(roles) {
  const isTeamLead = roles.includes("chef_equipe");
  const isVolunteer = roles.includes("benevole") || isTeamLead;

  return [
    isTeamLead && "myTeam",
    isTeamLead && "myTeamAttendance",
    isVolunteer && "myAssignments",
    isVolunteer && "myDocuments",
    roles.includes("parent_u14") && "myChildren",
    roles.includes("benevole_transport_athletes") && "myTransports",
    roles.includes("athlete_preprogram") && "myNationalRace",
  ];
}

/**
 * Menu du back-office. Les sections sont rangées par public :
 * Pilotage, Bénévoles, Athlètes, Pré-programme, Accès & jour J,
 * Communication, Site web, Administration, plus l'Accueil et « Mon espace ».
 * Notifications et Mon compte ne sont pas dans le menu : ils sont dans
 * l'en-tête (cloche et avatar).
 *
 * options.athletePortal : { canAccess, canImport } d'après les réglages du
 * portail athlètes (qui peut voir les engagés).
 */
function buildNavigationFromRoles(roles, options = {}) {
  const canAccessEntries = Boolean(options.athletePortal?.canAccess);
  const has = (role) => roles.includes(role);
  const canSeeStatistics = canAccessStatistics(roles);

  if (has("admin")) {
    return [
      LINKS.home(),
      section("steering", ["edition", "budget", "documents"]),
      section("volunteers", ["applications", "teams"]),
      section("athletes", ["entries", "transport", "roadbook", "physio", "results"]),
      section("preprogram", ["u14", "nationalRaces"]),
      section("accessDay", ["accreditations", "vip", "cashDesk", "attendance", "emergencyExports"]),
      section("communication", ["calendar", "tasks", "partners", "press"]),
      section("website", ["news", "emagazine", "links"]),
      section("administration", ["users", "settings"]),
    ].filter(Boolean);
  }

  if (has("gestionnaire")) {
    return [
      LINKS.home(),
      section("mySpace", personalLinkKeys(roles)),
      section("steering", [has("gestionnaire_site") && "edition", has("budget") && "budget", "documents"]),
      section("volunteers", ["applications", "teams"]),
      section("athletes", [
        has("chef_transport_athletes") && "transport",
        "roadbook",
        "physio",
        canSeeStatistics && "results",
      ]),
      section("preprogram", ["u14", has("commission_athletes") && "nationalRaces"]),
      section("accessDay", ["accreditations", "vip", "cashDesk", "attendance", "emergencyExports"]),
      section("communication", ["calendar", "tasks", "partners", "press"]),
      section("website", has("gestionnaire_site") ? ["news", "emagazine", "links"] : []),
    ].filter(Boolean);
  }

  // Rôles « métier » (budget, site, kiné, transport, commission) et rôles
  // personnels (bénévole, chef d'équipe, parent, athlète pré-programme).
  return [
    LINKS.home(),
    section("mySpace", personalLinkKeys(roles)),
    section("steering", [has("gestionnaire_site") && "edition", has("budget") && "budget"]),
    section("athletes", [
      canAccessEntries && "entries",
      has("chef_transport_athletes") && "transport",
      has("kine") && "physio",
      canSeeStatistics && "results",
    ]),
    section("preprogram", [has("commission_athletes") && "nationalRaces"]),
    section("communication", has("gestionnaire_site") ? ["partners", "pressReleases"] : []),
    section("website", has("gestionnaire_site") ? ["news", "emagazine", "links"] : []),
  ].filter(Boolean);
}

// Module Statistiques (base athlètes, résultats, records, Hall of Winners) :
// ouvert à tous les gestionnaires, en plus des admins et du meeting director.
const STATISTICS_ACCESS_ROLES = ["admin", "meeting_director", "gestionnaire"];

function canAccessStatistics(roles = []) {
  return STATISTICS_ACCESS_ROLES.some((role) => roles.includes(role));
}

export {
  APP_ROUTES,
  LEGACY_APP_REDIRECTS,
  STATISTICS_ACCESS_ROLES,
  buildNavigation,
  buildNavigationFromRoles,
  canAccessStatistics,
  getActiveRoles,
  getDefaultRouteByRoles,
  getPrimaryRole,
};
