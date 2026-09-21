import { extractRolesFromProfile } from "./utils";

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
  return "benevole";
}

function buildNavigation(profile) {
  return buildNavigationFromRoles(getActiveRoles(profile));
}

function getDefaultRouteByRoles(roles = []) {
  if (roles.includes("admin")) return "/app";
  if (roles.includes("budget")) return "/app/budget";
  if (roles.includes("gestionnaire")) return "/app/benevoles";
  if (roles.includes("gestionnaire_site")) return "/app/website";
  if (roles.includes("chef_equipe")) return "/app/equipe";
  if (roles.includes("chef_transport_athletes")) return "/app/athlete-portal/transport";
  if (roles.includes("benevole_transport_athletes")) return "/app/athlete-portal/mes-transport";
  if (roles.includes("benevole")) return "/app/mes-affectations";
  if (roles.includes("parent_u14")) return "/app/mes-enfants";
  return "/app";
}

function buildNavigationFromRoles(roles) {
  const isAdminNavigation = roles.includes("admin");
  const preProgrammeLinks = [
    makeLink("/app/u14", "navPreprogramU12U14", "U12 / U14", "spark"),
    makeLink("/app/u14/porte-panier", "navPreprogramBasketCarrier", "Porte-panier", "child"),
  ];

  if (isAdminNavigation) {
    return [
      makeSection("navSectionOverview", "Vue générale", [
        makeLink("/app", "navDashboard", "Tableau de bord", "dashboard"),
        makeLink("/app/documents", "navDocuments", "Documents", "folder"),
        makeLink("/app/budget", "navBudget", "Budget", "dashboard"),
      ]),
      makeSection("navSectionVolunteers", "Bénévoles", [
        makeLink("/app/benevoles", "navVolunteersLink", "Bénévoles", "users"),
        makeLink("/app/postes", "navTeamsAndPosts", "Équipes & postes", "grid"),
        makeLink("/app/presences", "navAttendance", "Présences", "check"),
      ]),
      makeSection("navSectionAccreditations", "Accréditations", [
        makeLink("/app/accreditations", "navAccreditationBadges", "Badges & zones", "ticket"),
        makeLink("/app/presse", "navPress", "Presse", "badge"),
        makeLink("/app/vip", "navVip", "VIP", "ticket"),
      ]),
      makeSection("navSectionPreprogram", "Pré-programme", preProgrammeLinks),
      makeSection("navSectionWebsite", "Site web", [
        makeLink("/app/website", "navWebsiteOverviewAdmin", "Vue d’ensemble", "grid"),
        makeLink("/app/website/edition", "navWebsiteEdition", "Édition courante", "calendar"),
        makeLink("/app/website/emagazine", "navWebsiteEmagazine", "E-magazine", "folder"),
        makeLink("/app/website/news", "navWebsiteNews", "Actualités", "spark"),
        makeLink("/app/website/sponsors", "navWebsitePartners", "Partenaires", "badge"),
        makeLink("/app/website/press", "navWebsitePressReleases", "Communiqués presse", "folder"),
      ]),
      makeSection("navSectionSettings", "Réglages", [
        makeLink("/app/roles", "navRolesAccess", "Rôles & accès", "shield"),
        makeLink("/app/edition-meeting", "navEditionSettings", "Édition du meeting", "calendar"),
        makeLink("/app/invitations", "navInvitations", "Invitations", "spark"),
        makeLink("/app/certificat", "navCertificateSettings", "Certificat bénévole", "badge"),
        makeLink("/app/profil", "navMyProfile", "Mon profil", "profile"),
      ]),
    ];
  }

  if (roles.includes("gestionnaire")) {
    const personalLinks = [];

    if (roles.includes("chef_equipe")) {
      personalLinks.push(makeLink("/app/equipe", "navMyTeam", "Mon équipe", "users"));
    }

    if (roles.includes("benevole")) {
      personalLinks.push(
        makeLink("/app/mon-dossier-benevole", "navMyVolunteerFile", "Mon dossier bénévole", "badge"),
        makeLink("/app/mes-affectations", "navMyAssignments", "Mes affectations", "pin"),
        makeLink("/app/mes-documents", "navMyDocuments", "Mes documents", "folder"),
      );
    }

    if (roles.includes("parent_u14")) {
      personalLinks.push(makeLink("/app/mes-enfants", "navMyChildren", "Mes enfants", "child"));
    }

    const navigation = [
      makeSection("navSectionOverview", "Vue générale", [
        makeLink("/app", "navOverview", "Vue d'ensemble", "dashboard"),
        makeLink("/app/documents", "navDocuments", "Documents", "folder"),
        ...(roles.includes("budget") ? [makeLink("/app/budget", "navBudget", "Budget", "dashboard")] : []),
      ]),
      makeSection("navSectionVolunteers", "Bénévoles", [
        makeLink("/app/benevoles", "navVolunteersLink", "Bénévoles", "users"),
        makeLink("/app/presences", "navAttendance", "Présences", "check"),
      ]),
      makeSection("navSectionAccreditations", "Accréditations", [
        makeLink("/app/accreditations", "navAccreditationBadges", "Badges & zones", "ticket"),
        makeLink("/app/presse", "navPress", "Presse", "badge"),
        makeLink("/app/vip", "navVip", "VIP", "ticket"),
      ]),
      makeSection("navSectionPreprogram", "Pré-programme", preProgrammeLinks),
    ];

    if (roles.includes("gestionnaire_site")) {
      navigation.push(
        makeSection("navSectionWebsite", "Site web", [
          makeLink("/app/website", "navWebsiteOverviewManager", "Site web — vue d'ensemble", "grid"),
          makeLink("/app/website/edition", "navWebsiteEdition", "Édition courante", "calendar"),
          makeLink("/app/website/emagazine", "navWebsiteEmagazine", "E-magazine", "folder"),
          makeLink("/app/website/news", "navWebsiteNews", "Actualités", "spark"),
          makeLink("/app/website/sponsors", "navWebsitePartners", "Partenaires", "badge"),
          makeLink("/app/website/press", "navWebsitePressReleases", "Communiqués presse", "folder"),
        ]),
      );
    }

    if (personalLinks.length) {
      navigation.push(makeSection("navSectionMyAccess", "Mes accès", personalLinks));
    }

    navigation.push(
      makeSection("navSectionSettings", "Réglages", [makeLink("/app/profil", "navMyProfile", "Mon profil", "profile")]),
    );

    return navigation;
  }

  const links = [makeLink("/app", "navOverview", "Vue d'ensemble", "dashboard")];

  if (roles.includes("budget")) {
    links.push(makeLink("/app/budget", "navBudget", "Budget", "dashboard"));
  }

  if (roles.includes("chef_equipe")) {
    links.push(
      makeLink("/app/equipe", "navMyTeam", "Mon équipe", "users"),
      makeLink("/app/presences", "navAttendance", "Présences", "check"),
    );
  }

  if (roles.includes("benevole")) {
    links.push(
      makeLink("/app/mon-dossier-benevole", "navMyVolunteerFile", "Mon dossier bénévole", "badge"),
      makeLink("/app/mes-affectations", "navMyAssignments", "Mes affectations", "pin"),
      makeLink("/app/mes-documents", "navMyDocuments", "Mes documents", "folder"),
    );
  }

  if (roles.includes("gestionnaire_site")) {
    links.push(
      makeLink("/app/website", "navWebsiteOverviewManager", "Site web — vue d'ensemble", "grid"),
      makeLink("/app/website/edition", "navWebsiteEdition", "Édition courante", "calendar"),
      makeLink("/app/website/emagazine", "navWebsiteEmagazine", "E-magazine", "folder"),
      makeLink("/app/website/news", "navWebsiteNews", "Actualités", "spark"),
      makeLink("/app/website/sponsors", "navWebsitePartners", "Partenaires", "badge"),
      makeLink("/app/website/press", "navWebsitePressReleases", "Communiqués presse", "folder"),
    );
  }

  if (roles.includes("parent_u14")) {
    links.push(makeLink("/app/mes-enfants", "navMyChildren", "Mes enfants", "child"));
  }

  if (roles.includes("chef_transport_athletes")) {
    links.push(makeLink("/app/athlete-portal/transport", "navAthleteTransport", "Transport athlètes", "users"));
  }

  if (roles.includes("benevole_transport_athletes")) {
    links.push(makeLink("/app/athlete-portal/mes-transport", "navMyTransports", "Mes transports", "pin"));
  }

  links.push(makeLink("/app/profil", "navMyProfile", "Mon profil", "profile"));

  return links;
}

function buildAthletePortalNavigation(roles, portalSettings, { canImport }) {
  const isAdmin = roles.includes("admin") || roles.includes("meeting_director");
  const links = [makeLink("/app/athlete-portal/athletes", "navAthletes", "Athlètes", "users")];

  if (canImport) {
    links.push(makeLink("/app/athlete-portal/import", "navAthleteImport", "Import Excel", "folder"));
  }

  if (roles.includes("chef_transport_athletes") || roles.includes("admin")) {
    links.push(makeLink("/app/athlete-portal/transport", "navAthleteTransport", "Transport athlètes", "users"));
  }

  if (roles.includes("benevole_transport_athletes")) {
    links.push(makeLink("/app/athlete-portal/mes-transport", "navMyTransports", "Mes transports", "pin"));
  }

  if (roles.includes("admin")) {
    links.push(makeLink("/app/athlete-portal/settings", "navPortalSettings", "Réglages portal", "shield"));
  }

  return links;
}

function buildStatisticsNavigation(roles) {
  const isAdmin = roles.includes("admin") || roles.includes("meeting_director");
  if (!isAdmin) return [];

  return [
    makeLink("/app/statistics/registry", "navAthleteRegistry", "Base athlètes", "users"),
    makeLink("/app/statistics/results", "navMeetingResults", "Résultats meeting", "calendar"),
    makeLink("/app/statistics/records", "navMeetingRecords", "Records meeting", "star"),
    makeLink("/app/statistics/winners", "navHallOfWinners", "Hall of Winners", "trophy"),
  ];
}

export {
  buildNavigation,
  buildNavigationFromRoles,
  buildAthletePortalNavigation,
  buildStatisticsNavigation,
  getActiveRoles,
  getDefaultRouteByRoles,
  getPrimaryRole,
};
