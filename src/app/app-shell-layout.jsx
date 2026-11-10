import { NavLink, Outlet, useLocation, useNavigate, useOutletContext } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { collection, deleteField, doc, getDoc, getDocs, onSnapshot, serverTimestamp, setDoc, writeBatch } from "firebase/firestore";
import { useAuth } from "../context/auth-context";
import {
  ACTIVE_EDITION_DOC_PATH,
  getEditionLabel,
  normalizeEditionId,
  useActiveEdition,
} from "./edition";
import { APP_ROUTES, buildNavigationFromRoles, getActiveRoles, getDefaultRouteByRoles, getPrimaryRole } from "./navigation";
import { canAccessAthletePortal, canImportAthletes, useAthletePortalSettings } from "./athlete-portal-hooks";
import { useTeamConfiguration } from "./config-hooks";
import { useDocumentsCollection } from "./documents-hooks";
import { useMeetingEditions } from "./meeting-history-hooks";
import { useVolunteerApplication, useVolunteerApplicationsList } from "./volunteer-hooks";
import { formatRoleLabel } from "./volunteer-helpers";
import { useParentU14Children, useU14RequestsList } from "./u14-hooks";
import { formatParentRequestSchedule, formatParentRequestStatus, normalizeComparableValue } from "./u14-helpers";
import { buildUserIdentitySet, formatVolunteerApplicationStatus, isTeamLeadAssignment } from "./common-helpers";
import { ACCREDITATION_CONFIGURATION_DOC_PATH, TEAM_CONFIGURATION_DOC_PATH } from "./seed-data";
import { getDisplayName, normalizeRole } from "./utils";
import { LanguageSwitch } from "./language";
import { NotificationBell } from "./notifications/notifications-ui";
import { InstallAppBanner } from "./install-app-banner";
import { confirmLeaveIfUnsaved } from "./unsaved-changes-guard";
import { useLanguage } from "./language-context";
import { db } from "../services/firebase";

function flattenNavigationItems(items) {
  return items.flatMap((item) => (item.type === "section" ? item.links : [item]));
}

function isRouteMatch(pathname, targetPath) {
  if (targetPath === "/app") return pathname === targetPath;
  return pathname === targetPath || pathname.startsWith(`${targetPath}/`);
}

function NavIcon({ icon }) {
  const paths = {
    dashboard: "M3 11.5 12 4l9 7.5V20a1 1 0 0 1-1 1h-5.5v-6h-5v6H4a1 1 0 0 1-1-1z",
    users: "M7.5 12a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7Zm9 0a3 3 0 1 1 0-6 3 3 0 0 1 0 6ZM3.5 19a4.5 4.5 0 0 1 8.96 0zm9 0a4 4 0 0 1 7.5-1.8V19z",
    check: "M5 12.5 9.2 16.7 19 7.5",
    spark: "m12 3 2.2 4.8L19 10l-4.8 2.2L12 17l-2.2-4.8L5 10l4.8-2.2z",
    folder: "M3.5 7.5a2 2 0 0 1 2-2H10l2 2h6.5a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z",
    ticket: "M4 9a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4z",
    shield: "M12 3 19 6v5c0 5-3.4 8-7 10-3.6-2-7-5-7-10V6z",
    profile: "M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4Zm-7 8a7 7 0 0 1 14 0",
    bell: "M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0",
    badge: "M12 3 6 5.5v6.2c0 4.1 2.4 7 6 9.3 3.6-2.3 6-5.2 6-9.3V5.5z",
    pin: "M12 21s-5.5-5.7-5.5-10A5.5 5.5 0 1 1 17.5 11C17.5 15.3 12 21 12 21Zm0-7.5a2.5 2.5 0 1 0-2.5-2.5 2.5 2.5 0 0 0 2.5 2.5Z",
    child: "M12 7.2a2.7 2.7 0 1 0-2.7-2.7A2.7 2.7 0 0 0 12 7.2Zm-4.8 12.3v-4.2a3.2 3.2 0 0 1 3.2-3.2h3.2a3.2 3.2 0 0 1 3.2 3.2v4.2M8.5 10l-2 2.2m9-2.2 2 2.2",
    grid: "M4 4h7v7H4zm9 0h7v7h-7zM4 13h7v7H4zm9 0h7v7h-7z",
    calendar: "M7 3.5V6m10-2.5V6M4.5 8.5h15M6 5h12a1.5 1.5 0 0 1 1.5 1.5v11A1.5 1.5 0 0 1 18 19H6A1.5 1.5 0 0 1 4.5 17.5v-11A1.5 1.5 0 0 1 6 5Z",
    star: "m12 3 2.7 5.5 6 0.9-4.3 4.2 1 6-5.4-2.9-5.4 2.9 1-6-4.3-4.2 6-0.9z",
    trophy: "M8 4h8v2.5A4 4 0 0 1 12 10.5 4 4 0 0 1 8 6.5zm-3 1h3v1.5A5.5 5.5 0 0 1 5 12a2.5 2.5 0 0 1 0-5Zm14 0h-3v1.5A5.5 5.5 0 0 0 19 12a2.5 2.5 0 0 0 0-5ZM9 20h6M10 16h4v4h-4z",
  };

  return (
    <span aria-hidden="true" className="nav-link__icon">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d={paths[icon] || paths.folder} />
      </svg>
    </span>
  );
}

// « Voir comme » (admin) : les rôles simulés pour chaque profil. Un
// gestionnaire est aussi bénévole dans la pratique, d'où « Mon espace ».
const VIEW_AS_ROLES = {
  admin: ["admin"],
  gestionnaire: ["gestionnaire", "benevole"],
  budget: ["budget"],
  chef_equipe: ["chef_equipe"],
  benevole: ["benevole"],
  parent_u14: ["parent_u14"],
  athlete_preprogram: ["athlete_preprogram"],
  commission_athletes: ["commission_athletes"],
  kine: ["kine"],
  chef_transport_athletes: ["chef_transport_athletes"],
  benevole_transport_athletes: ["benevole_transport_athletes"],
  gestionnaire_site: ["gestionnaire_site"],
  meeting_director: ["meeting_director"],
};

function getInitials(name) {
  return String(name || "")
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("");
}

function AppShell(props) {
  const { cmcmLogo } = props;
  const { t } = useLanguage();
  const { currentUser, logout, userProfile } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const roles = getActiveRoles(userProfile);
  const { activeEditionId, activeEditionLabel } = useActiveEdition();
  const { settings: portalSettings, loading: portalSettingsLoading } = useAthletePortalSettings();
  const [preferredViewAsRole, setPreferredViewAsRole] = useState(() => getPrimaryRole(userProfile));
  const [isSidebarOpen, setIsSidebarOpen] = useState(() =>
    typeof window === "undefined" ? true : window.innerWidth > 1100,
  );
  const isAdmin = roles.includes("admin");
  const primaryRole = getPrimaryRole(userProfile);
  const viewAsRole = isAdmin && VIEW_AS_ROLES[preferredViewAsRole] ? preferredViewAsRole : primaryRole;
  const effectiveRoles = useMemo(() => {
    if (!isAdmin || viewAsRole === "admin") return roles;
    return VIEW_AS_ROLES[viewAsRole];
  }, [isAdmin, roles, viewAsRole]);

  // Statistiques et engagés font partie de la section « Athlètes » du menu :
  // navigation.js a seulement besoin de savoir si ce rôle voit le portail.
  const athletePortalAccess = useMemo(
    () => ({
      canAccess: !portalSettingsLoading && canAccessAthletePortal(effectiveRoles, portalSettings),
      canImport: canImportAthletes(effectiveRoles, portalSettings),
    }),
    [effectiveRoles, portalSettings, portalSettingsLoading],
  );
  const navigation = useMemo(
    () => buildNavigationFromRoles(effectiveRoles, { athletePortal: athletePortalAccess }),
    [athletePortalAccess, effectiveRoles],
  );
  const linkLabel = (link) => (t(link.labelKey) || link.label).replace("{edition}", activeEditionId || "");
  const flatNavigation = useMemo(() => flattenNavigationItems(navigation), [navigation]);
  const [openSections, setOpenSections] = useState({});
  const displayName = getDisplayName(userProfile, currentUser?.email);
  const currentRouteLink =
    flatNavigation.find((item) => item.to === location.pathname) ||
    flatNavigation.find((item) => item.to !== "/app" && isRouteMatch(location.pathname, item.to));
  const currentRouteLabel = currentRouteLink ? linkLabel(currentRouteLink) : t("shellMenuLabel");

  useEffect(() => {
    function syncSidebarWithViewport() {
      if (window.innerWidth > 1100) {
        setIsSidebarOpen(true);
      }
    }

    window.addEventListener("resize", syncSidebarWithViewport);
    return () => window.removeEventListener("resize", syncSidebarWithViewport);
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined" && window.innerWidth <= 1100) {
      const timeoutId = window.setTimeout(() => {
        setIsSidebarOpen(false);
      }, 0);
      return () => window.clearTimeout(timeoutId);
    }
    return undefined;
  }, [location.pathname]);

  useEffect(() => {
    if (!location.state?.accessDeniedMessage) return;

    navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
  }, [location.pathname, location.search, location.state, navigate]);

  function handleViewAsChange(nextRole) {
    if (!confirmLeaveIfUnsaved()) return;
    setPreferredViewAsRole(nextRole);
    navigate(nextRole === "admin" ? APP_ROUTES.home : getDefaultRouteByRoles(VIEW_AS_ROLES[nextRole] || []));
  }

  async function handleLogout() {
    if (!confirmLeaveIfUnsaved()) return;
    await logout();
    navigate("/login");
  }

  function isSectionOpen(section, index) {
    const hasManualValue = Object.prototype.hasOwnProperty.call(openSections, section.titleKey);
    if (hasManualValue) return openSections[section.titleKey];
    return section.links.some((link) => isRouteMatch(location.pathname, link.to)) || index === 0;
  }

  function toggleSection(titleKey, fallbackOpen) {
    setOpenSections((current) => {
      const hasManualValue = Object.prototype.hasOwnProperty.call(current, titleKey);
      const currentValue = hasManualValue ? current[titleKey] : fallbackOpen;
      return { ...current, [titleKey]: !currentValue };
    });
  }

  return (
    <div className={`shell${isSidebarOpen ? " shell--sidebar-open" : " shell--sidebar-closed"}`}>
      <aside className={`sidebar${isSidebarOpen ? " sidebar--open" : ""}`}>
        <div className="sidebar-header">
          <div className="sidebar-brand">
            <a href="/" className="sidebar-brand-lockup sidebar-brand-lockup--link" title={t("shellBackToSite")}>
              <div className="sidebar-brand-logo-shell">
                <img alt="Logo CMCM Luxembourg Indoor Meeting" className="sidebar-brand-logo" src={cmcmLogo} />
              </div>
              <div className="sidebar-brand-copy">
                <h2>MyCLIM</h2>
              </div>
            </a>
            <p className="sidebar-brand-tagline">{t("shellTagline")}</p>
          </div>
          <button
            className="button button--ghost sidebar-toggle sidebar-toggle--inside"
            type="button"
            onClick={() => setIsSidebarOpen(false)}
          >
            {t("shellCollapse")}
          </button>
        </div>
        <div className="sidebar-main">
          <nav className="sidebar-nav">
            {navigation.map((item, index) =>
              item.type === "section" ? (
                (() => {
                  const sectionOpen = isSectionOpen(item, index);
                  const sectionActive = item.links.some((link) => isRouteMatch(location.pathname, link.to));
                  const sectionTitle = t(item.titleKey) || item.title;

                  return (
                    <section
                      key={item.titleKey}
                      className={`sidebar-nav-section${sectionOpen ? " sidebar-nav-section--open" : ""}${sectionActive ? " sidebar-nav-section--active" : ""}`}
                      aria-label={sectionTitle}
                    >
                      <button
                        aria-expanded={sectionOpen}
                        className="sidebar-nav-section__button"
                        type="button"
                        onClick={() => toggleSection(item.titleKey, sectionOpen)}
                      >
                        <span className="sidebar-nav-section__header">
                          <span className="sidebar-nav-section__title">{sectionTitle}</span>
                          <span className="sidebar-nav-section__meta">{item.links.length}</span>
                        </span>
                        <span aria-hidden="true" className="sidebar-nav-section__chevron">
                          ⌄
                        </span>
                      </button>
                      {sectionOpen ? (
                        <div className="sidebar-nav-section__links">
                          {item.links.map((link) => (
                            <NavLink
                              key={link.to}
                              className={({ isActive }) => `nav-link${isActive ? " nav-link--active" : ""}`}
                              to={link.to}
                              end={link.to === "/app"}
                            >
                              <span className="nav-link__label">
                                <NavIcon icon={link.icon} />
                                <span>{linkLabel(link)}</span>
                              </span>
                              <span aria-hidden="true" className="nav-link__chevron">
                                ›
                              </span>
                            </NavLink>
                          ))}
                        </div>
                      ) : null}
                    </section>
                  );
                })()
              ) : (
                <NavLink
                  key={item.to}
                  className={({ isActive }) => `nav-link${isActive ? " nav-link--active" : ""}`}
                  to={item.to}
                  end={item.to === "/app"}
                >
                  <span className="nav-link__label">
                    <NavIcon icon={item.icon} />
                    <span>{linkLabel(item)}</span>
                  </span>
                  <span aria-hidden="true" className="nav-link__chevron">
                    ›
                  </span>
                </NavLink>
              ),
            )}
          </nav>
        </div>
        <div className="sidebar-footer">
          <div className="sidebar-footer__identity">
            <strong>{displayName}</strong>
            <p>{currentUser?.email}</p>
            <p>{t("shellActiveEditionLabel")}: {activeEditionLabel}</p>
          </div>
          <div className="sidebar-footer__actions">
            <span className="status-pill status-pill--accent">
              {/* getPrimaryRole retombe sur « benevole » pour les rôles qu'il ne
                  classe pas (commission, kiné…) : on affiche alors le vrai rôle. */}
              {formatRoleLabel(roles.includes("admin") ? viewAsRole : roles.includes(primaryRole) ? primaryRole : roles[0] || primaryRole, t)}
            </span>
            <LanguageSwitch variant="on-light" />
            <button className="button button--secondary sidebar-footer__logout" onClick={handleLogout} type="button">
              {t("shellLogout")}
            </button>
          </div>
        </div>
      </aside>
      {isSidebarOpen ? (
        <button
          aria-label={t("shellCloseMenuAria")}
          className="sidebar-backdrop"
          type="button"
          onClick={() => setIsSidebarOpen(false)}
        />
      ) : null}
      <main className="content">
        <div className="shell-header">
          {isAdmin ? (
            <label className="view-switcher view-switcher--inline">
              <span>{t("shellViewAsLabel")}</span>
              <select value={viewAsRole} onChange={(event) => handleViewAsChange(event.target.value)}>
                {Object.keys(VIEW_AS_ROLES).map((role) => (
                  <option key={role} value={role}>{formatRoleLabel(role, t)}</option>
                ))}
              </select>
            </label>
          ) : null}
          <NotificationBell />
          <NavLink
            className={({ isActive }) => `shell-account${isActive ? " shell-account--active" : ""}`}
            to={APP_ROUTES.account}
            title={t("navMyAccount")}
            aria-label={t("navMyAccount")}
          >
            <span className="shell-account__avatar" aria-hidden="true">{getInitials(displayName) || "?"}</span>
            <span className="shell-account__label">{t("navMyAccount")}</span>
          </NavLink>
        </div>
        {!isSidebarOpen ? (
          <button
            className="shell-sidebar-rail"
            type="button"
            onClick={() => setIsSidebarOpen(true)}
            aria-label={t("shellReopenMenuAria")}
          >
            {t("shellMenuLabel")}
          </button>
        ) : null}
        <div className="shell-mobile-bar">
          <button
            className="button button--secondary shell-mobile-bar__toggle"
            type="button"
            onClick={() => setIsSidebarOpen((current) => !current)}
          >
            {isSidebarOpen ? t("shellCloseLabel") : t("shellMenuLabel")}
          </button>
          <span className="shell-mobile-bar__route">{currentRouteLabel}</span>
        </div>
        {location.state?.accessDeniedMessage ? (
          <div className="notice-card notice-card--warn">
            <strong>{t("shellAccessDeniedTitle")}</strong>
            <p>{location.state.accessDeniedMessage}</p>
          </div>
        ) : null}
        <Outlet
          context={{
            activeRole: roles.includes("admin") ? viewAsRole : primaryRole,
            availableRoles: roles,
            onSwitchRole: handleViewAsChange,
          }}
        />
      </main>
    </div>
  );
}

// « À traiter aujourd'hui » : une seule liste par rôle, dont chaque ligne
// ouvre la page concernée (plus de raccourcis qui doublent le menu).
function TodoItem({ to, children }) {
  if (!to) return <li>{children}</li>;
  return (
    <li>
      <NavLink className="dashboard-todo__link" to={to}>
        <span>{children}</span>
        <span aria-hidden="true">›</span>
      </NavLink>
    </li>
  );
}

// Prochaines échéances de l'Accueil.
const DEADLINE_TASK_LIMIT = 5;

function toDateOrNull(value) {
  if (!value) return null;
  const date = typeof value?.toDate === "function" ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function startOfToday() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

// Tâches de communication pas encore faites (lisibles par admin et
// gestionnaires seulement, d'où enabled).
function useOpenCommunicationTasks(enabled) {
  const [tasks, setTasks] = useState([]);
  useEffect(() => {
    if (!enabled) return undefined;
    return onSnapshot(
      collection(db, "com_tasks"),
      (snapshot) => {
        setTasks(
          snapshot.docs
            .map((entry) => ({ id: entry.id, ...entry.data() }))
            .filter((task) => task.statut !== "done" && task.echeance),
        );
      },
      () => setTasks([]),
    );
  }, [enabled]);
  return enabled ? tasks : [];
}

function DashboardHome(props) {
  const { Panel } = props;
  const { t } = useLanguage();
  const { currentUser, userProfile } = useAuth();
  const roles = getActiveRoles(userProfile);
  const outletContext = useOutletContext() ?? {};
  const activeRole = outletContext.activeRole || getPrimaryRole(userProfile);
  // La commission des athlètes n'a pas d'accueil propre : getPrimaryRole la
  // classe en bénévole, elle verrait « Ma mission ». On l'envoie sur son module.
  const navigateHome = useNavigate();
  const isCommissionOnly =
    activeRole === "commission_athletes" ||
    (roles.includes("commission_athletes") && !roles.some((role) => ["admin", "gestionnaire", "benevole", "chef_equipe"].includes(role)));
  useEffect(() => {
    if (isCommissionOnly) navigateHome(APP_ROUTES.nationalRaces, { replace: true });
  }, [isCommissionOnly, navigateHome]);
  const { application: volunteerApplication } = useVolunteerApplication(currentUser?.uid);
  const { roles: teamRoles, teamAssignments, loading: teamsLoading } = useTeamConfiguration();
  const { applications: volunteerApplications, loading: volunteerApplicationsLoading } = useVolunteerApplicationsList(
    roles.includes("admin"),
  );
  const { documents, loading: documentsLoading } = useDocumentsCollection(
    roles.includes("admin") || roles.includes("benevole") || roles.includes("chef_equipe"),
  );
  const { requests: u14Requests, loading: u14RequestsLoading } = useU14RequestsList(roles.includes("admin"));
  const { rows: parentRequestRows, loading: parentRowsLoading } = useParentU14Children(currentUser?.uid);
  const shouldPromptParentToVolunteer = roles.includes("parent_u14") && !volunteerApplication;
  const userIdentitySet = useMemo(
    () => buildUserIdentitySet(userProfile, currentUser),
    [buildUserIdentitySet, currentUser, userProfile],
  );
  const myAssignments = useMemo(
    () =>
      teamAssignments.filter((member) =>
        [member.id, member.email, `${member.firstName} ${member.lastName}`.trim()]
          .map((value) => String(value || "").trim().toLowerCase())
          .some((value) => value && userIdentitySet.has(value)),
      ),
    [teamAssignments, userIdentitySet],
  );
  const myVolunteerAssignments = useMemo(
    () => myAssignments.filter((assignment) => !isTeamLeadAssignment(assignment)),
    [isTeamLeadAssignment, myAssignments],
  );
  const myLeadAssignments = useMemo(
    () => myAssignments.filter((assignment) => isTeamLeadAssignment(assignment)),
    [isTeamLeadAssignment, myAssignments],
  );
  const myLeadRoleIds = useMemo(
    () =>
      teamRoles
        .filter(
          (role) =>
            userIdentitySet.has(String(role.leaderName || "").trim().toLowerCase()) ||
            myLeadAssignments.some((assignment) => assignment.assignedRoleId === role.id),
        )
        .map((role) => role.id),
    [myLeadAssignments, teamRoles, userIdentitySet],
  );
  const ledRoles = useMemo(() => teamRoles.filter((role) => myLeadRoleIds.includes(role.id)), [myLeadRoleIds, teamRoles]);
  const myRoleIds = useMemo(
    () => [...new Set(myVolunteerAssignments.map((assignment) => assignment.assignedRoleId).filter(Boolean))],
    [myVolunteerAssignments],
  );
  const myTeamRoles = useMemo(() => teamRoles.filter((role) => myRoleIds.includes(role.id)), [myRoleIds, teamRoles]);
  const incompleteTeamsCount = useMemo(
    () =>
      teamRoles.filter((role) => {
        const assignedMembers = teamAssignments.filter((member) => member.assignedRoleId === role.id).length;
        return assignedMembers < role.neededCount;
      }).length,
    [teamAssignments, teamRoles],
  );
  const pendingApplicationsCount = useMemo(
    () =>
      volunteerApplications.filter((volunteer) =>
        ["candidature_recue", "pending_guardian_approval"].includes(String(volunteer.status || "").trim().toLowerCase()),
      ).length,
    [volunteerApplications],
  );
  const submittedU14RequestsCount = useMemo(
    () => u14Requests.filter((request) => String(request.status || "").trim().toLowerCase() === "submitted").length,
    [u14Requests],
  );
  const myDocumentsCount = useMemo(() => {
    if (!myTeamRoles.length) return 0;
    const assignedTeamNames = myTeamRoles.map((role) => role.roleName);

    return documents.filter((document) => {
      if (document.scope === "global" || document.teams.length === 0) return true;
      return document.teams.some((team) => assignedTeamNames.includes(team));
    }).length;
  }, [documents, myTeamRoles]);
  const leadDocumentsCount = useMemo(() => {
    if (!ledRoles.length) return 0;
    const ledRoleNames = ledRoles.map((role) => role.roleName);

    return documents.filter((document) => {
      if (document.scope === "global" || document.teams.length === 0) return true;
      return document.teams.some((team) => ledRoleNames.includes(team));
    }).length;
  }, [documents, ledRoles]);
  const totalOpenPositions = useMemo(
    () =>
      ledRoles.reduce((accumulator, role) => {
        const assignedMembers = teamAssignments.filter((member) => member.assignedRoleId === role.id).length;
        return accumulator + Math.max(role.neededCount - assignedMembers, 0);
      }, 0),
    [ledRoles, teamAssignments],
  );
  const totalReplacements = useMemo(
    () =>
      ledRoles.reduce(
        (accumulator, role) =>
          accumulator +
          teamAssignments.filter(
            (member) =>
              member.assignedRoleId === role.id && normalizeRole(member.teamRole) === normalizeRole("Remplaçant"),
          ).length,
        0,
      ),
    [ledRoles, teamAssignments],
  );
  const totalLeadMembers = useMemo(
    () =>
      ledRoles.reduce(
        (accumulator, role) => accumulator + teamAssignments.filter((member) => member.assignedRoleId === role.id).length,
        0,
      ),
    [ledRoles, teamAssignments],
  );
  const nextVolunteerRole = myTeamRoles[0] ?? null;
  const volunteerAssignmentSummary =
    nextVolunteerRole?.roleName || userProfile?.assignedRole || t("dashboardNoAssignmentYet");
  const volunteerShiftSummary = userProfile?.shift || nextVolunteerRole?.shiftTime || t("assignmentsToBeConfirmed");
  const volunteerBriefingSummary = nextVolunteerRole?.briefingTime || t("dashboardBriefingToBeConfirmed");
  const parentConfirmedCount = parentRequestRows.filter((child) => normalizeComparableValue(child.status) === "valide").length;
  const parentPendingCount = parentRequestRows.length - parentConfirmedCount;
  const adminDataLoading = teamsLoading || volunteerApplicationsLoading || documentsLoading || u14RequestsLoading;
  const volunteerDataLoading = teamsLoading || documentsLoading;
  const leadDataLoading = teamsLoading || documentsLoading;

  // Prochaines échéances : jour du meeting pour tous ; ouverture du
  // pré-programme et tâches de communication pour l'admin et les gestionnaires.
  const { language } = useLanguage();
  const { activeEditionId, preprogramOpeningDate } = useActiveEdition();
  const { editions: meetingEditions } = useMeetingEditions();
  const canReadPlanning = roles.includes("admin") || roles.includes("gestionnaire");
  const showPlanningDeadlines = canReadPlanning && ["admin", "gestionnaire"].includes(activeRole);
  const openCommunicationTasks = useOpenCommunicationTasks(canReadPlanning);
  const deadlines = useMemo(() => {
    const today = startOfToday();
    const items = [];
    const activeEdition = (meetingEditions || []).find((edition) => String(edition.year) === String(activeEditionId));
    const meetingDate = toDateOrNull(activeEdition?.date);
    if (meetingDate && meetingDate >= today) {
      items.push({ id: "meeting", date: meetingDate, label: t("dashboardDeadlineMeeting").replace("{edition}", activeEditionId), to: APP_ROUTES.edition });
    }
    if (showPlanningDeadlines) {
      if (preprogramOpeningDate && !Number.isNaN(preprogramOpeningDate.getTime()) && preprogramOpeningDate >= today) {
        items.push({ id: "preprogram", date: preprogramOpeningDate, label: t("dashboardDeadlinePreprogram"), to: APP_ROUTES.u14 });
      }
      [...openCommunicationTasks]
        .sort((left, right) => String(left.echeance).localeCompare(String(right.echeance)))
        .slice(0, DEADLINE_TASK_LIMIT)
        .forEach((task) => {
          const date = toDateOrNull(`${task.echeance}T00:00:00`);
          if (!date) return;
          items.push({ id: `task-${task.id}`, date, label: task.titre || t("navTasks"), to: APP_ROUTES.tasks, late: date < today });
        });
    }
    return items.sort((left, right) => left.date - right.date);
  }, [activeEditionId, meetingEditions, openCommunicationTasks, preprogramOpeningDate, showPlanningDeadlines, t]);
  const formatDeadlineDate = (date) =>
    date.toLocaleDateString(language === "fr" ? "fr-LU" : language === "de" ? "de-LU" : "en-GB", {
      weekday: "short",
      day: "numeric",
      month: "long",
      ...(date.getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}),
    });

  function renderTodoPanel(subtitleKey, items) {
    return (
      <section className="panel-grid">
        <Panel title={t("dashboardTodoTitle")} subtitle={t(subtitleKey)}>
          <ul className="compact-list dashboard-todo">{items}</ul>
        </Panel>
      </section>
    );
  }

  function renderRoleSummary() {
    if (activeRole === "admin") {
      return renderTodoPanel("dashboardAdminPrioritiesSubtitle", (
        <>
          <TodoItem to={APP_ROUTES.applications}>{adminDataLoading ? t("dashboardLoadingApplications") : t("dashboardAdminApplicationsToProcess").replace("{count}", pendingApplicationsCount)}</TodoItem>
          <TodoItem to={APP_ROUTES.teams}>{adminDataLoading ? t("dashboardLoadingTeams") : t("dashboardAdminIncompleteTeams").replace("{count}", incompleteTeamsCount)}</TodoItem>
          <TodoItem to={APP_ROUTES.documents}>{documentsLoading ? t("dashboardLoadingDocuments") : t("dashboardAdminDocumentsToReview").replace("{count}", documents.length)}</TodoItem>
          <TodoItem to={APP_ROUTES.u14}>{u14RequestsLoading ? t("dashboardLoadingU14Requests") : t("dashboardAdminU14RequestsToFollow").replace("{count}", submittedU14RequestsCount)}</TodoItem>
        </>
      ));
    }

    if (activeRole === "benevole") {
      const hasMission = Boolean(nextVolunteerRole || userProfile?.assignedRole);
      const volunteerTiles = [
        {
          to: APP_ROUTES.myAssignments,
          label: t("navMyAssignments"),
          hint: t("volunteerHomeAssignmentsHint"),
          tone: "red",
          icon: (
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <rect x="4" y="5" width="16" height="15" rx="3" />
              <path d="M8 3v4M16 3v4M4 10h16M8.5 14.5l2 2 4-4" />
            </svg>
          ),
        },
        {
          to: APP_ROUTES.myDocuments,
          label: t("navMyDocuments"),
          hint: t("volunteerHomeDocumentsHint"),
          badge: !documentsLoading && myDocumentsCount > 0 ? myDocumentsCount : null,
          tone: "blue",
          icon: (
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M7 3h7l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" />
              <path d="M14 3v5h5M9 13h6M9 17h4" />
            </svg>
          ),
        },
        ...(volunteerApplication
          ? [
              {
                to: `${APP_ROUTES.myAssignments}/mon-dossier`,
                label: t("navMyVolunteerFile"),
                hint: t("volunteerHomeFileHint"),
                tone: "navy",
                icon: (
                  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                    <circle cx="12" cy="8" r="4" />
                    <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
                  </svg>
                ),
              },
            ]
          : []),
      ];

      return (
        <>
          <section className="volunteer-mission" aria-labelledby="volunteer-mission-title">
            <div className="volunteer-mission__top">
              <span className="volunteer-mission__eyebrow">{t("volunteerHomeMissionLabel")}</span>
              {volunteerApplication ? (
                <span className="volunteer-mission__status">{formatVolunteerApplicationStatus(volunteerApplication.status, t)}</span>
              ) : null}
            </div>
            <h2 id="volunteer-mission-title" className={hasMission ? "" : "volunteer-mission__role--pending"}>
              {volunteerDataLoading ? t("dashboardLoadingAssignment") : volunteerAssignmentSummary}
            </h2>
            {!volunteerDataLoading && !hasMission ? (
              <p className="volunteer-mission__pending">{t("volunteerHomeNoMissionYet")}</p>
            ) : null}
            <dl className="volunteer-mission__facts">
              <div>
                <dt>{t("dashboardPlannedShift")}</dt>
                <dd>{volunteerShiftSummary}</dd>
              </div>
              <div>
                <dt>{t("dashboardBriefingLabel")}</dt>
                <dd>{nextVolunteerRole?.briefingTime || t("assignmentsToBeConfirmed")}</dd>
              </div>
            </dl>
          </section>

          <nav className="volunteer-tiles" aria-label={t("dashboardQuickAccessTitle")}>
            {volunteerTiles.map((tile) => (
              <NavLink key={tile.to} to={tile.to} className={`volunteer-tile volunteer-tile--${tile.tone}`}>
                <span className="volunteer-tile__icon">{tile.icon}</span>
                <span className="volunteer-tile__text">
                  <strong>{tile.label}</strong>
                  <span>{tile.hint}</span>
                </span>
                {tile.badge ? <span className="volunteer-tile__badge">{tile.badge}</span> : null}
                <svg className="volunteer-tile__chevron" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path d="m9 6 6 6-6 6" />
                </svg>
              </NavLink>
            ))}
          </nav>

          <p className="volunteer-reminder">
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7.5v5l3 2" />
            </svg>
            <span>{t("dashboardVolunteerDepartureReminder")}</span>
          </p>
        </>
      );
    }

    if (activeRole === "gestionnaire") {
      return renderTodoPanel("dashboardManagerPrioritiesSubtitle", (
        <>
          <TodoItem to={APP_ROUTES.attendance}>{t("dashboardManagerTaskCheckIn")}</TodoItem>
          <TodoItem to={APP_ROUTES.attendance}>{t("dashboardManagerTaskLunch")}</TodoItem>
          <TodoItem to={APP_ROUTES.attendance}>{t("dashboardManagerTaskAttendance")}</TodoItem>
        </>
      ));
    }

    if (activeRole === "parent_u14") {
      return renderTodoPanel("dashboardParentPrioritiesSubtitle", (
        <>
          {parentRowsLoading ? <TodoItem>{t("dashboardLoadingU14Requests")}</TodoItem> : null}
          {!parentRowsLoading && parentRequestRows.length === 0 ? <TodoItem to={APP_ROUTES.myChildren}>{t("dashboardNoU14Request")}</TodoItem> : null}
          {!parentRowsLoading && parentRequestRows.map((child) => (
            <TodoItem key={child.id} to={APP_ROUTES.myChildren}>{child.name}: {formatParentRequestStatus(child.status, t)} - {formatParentRequestSchedule(child, t)}</TodoItem>
          ))}
          {!parentRowsLoading && parentRequestRows.length > 0 ? (
            <TodoItem>
              {t("dashboardParentConfirmedPending")
                .replace("{confirmed}", parentConfirmedCount)
                .replace("{pending}", parentPendingCount)}
            </TodoItem>
          ) : null}
        </>
      ));
    }

    if (activeRole === "chef_equipe") {
      return renderTodoPanel("dashboardTeamLeadPrioritiesSubtitle", (
        <>
          <TodoItem to={APP_ROUTES.myTeam}>
            {leadDataLoading
              ? t("dashboardLoadingTeams")
              : totalOpenPositions > 0
                ? t("dashboardOpenPositions")
                    .replace("{count}", totalOpenPositions)
                    .replace("{roles}", ledRoles.map((role) => role.roleName).join(", "))
                : t("dashboardAllTeamsFull")}
          </TodoItem>
          <TodoItem to={APP_ROUTES.myTeam}>{leadDataLoading ? t("dashboardLoadingAssignments") : t("dashboardTeamMembersCount").replace("{count}", totalLeadMembers)}</TodoItem>
          <TodoItem to={APP_ROUTES.myDocuments}>{documentsLoading ? t("dashboardLoadingTeamDocuments") : t("dashboardTeamDocumentsAvailable").replace("{count}", leadDocumentsCount)}</TodoItem>
          <TodoItem to={APP_ROUTES.myTeam}>{leadDataLoading ? t("dashboardLoadingReplacements") : t("dashboardReplacementsIdentified").replace("{count}", totalReplacements)}</TodoItem>
          <TodoItem to={APP_ROUTES.myTeamAttendance}>{t("dashboardTeamLeadDepartureReminder")}</TodoItem>
        </>
      ));
    }

    return null;
  }

  return (
    <div className="page">
      {activeRole === "benevole" ? (
        <section className="volunteer-greeting">
          <h1>
            {t("volunteerHomeHello")} {String(userProfile?.firstName || "").trim() || getDisplayName(userProfile, currentUser?.email)}
          </h1>
          <p>{t("volunteerHomeIntro")}</p>
        </section>
      ) : (
        <section className="page-header">
          <div>
            <p className="eyebrow">{t("navHome")}</p>
            <h1>{t("dashboardWelcome")} {getDisplayName(userProfile, currentUser?.email)}</h1>
            <p>{t("dashboardIntro")}</p>
          </div>
        </section>
      )}

      {renderRoleSummary()}

      <section className="panel-grid">
        <Panel title={t("dashboardDeadlinesTitle")} subtitle={t("dashboardDeadlinesSubtitle")}>
          {deadlines.length ? (
            <ul className="compact-list dashboard-todo">
              {deadlines.map((deadline) => (
                <TodoItem key={deadline.id} to={deadline.to}>
                  <strong>{formatDeadlineDate(deadline.date)}</strong>
                  {deadline.late ? <span className="status-pill status-pill--warn"> {t("dashboardDeadlineLate")}</span> : null}
                  {" — "}
                  {deadline.label}
                </TodoItem>
              ))}
            </ul>
          ) : (
            <p className="panel-note">{t("dashboardDeadlinesNone")}</p>
          )}
        </Panel>
      </section>

      <InstallAppBanner />

      {volunteerApplication && activeRole !== "benevole" ? (
        <section className="panel-grid panel-grid--2">
          <Panel
            title={t("navMyVolunteerFile")}
            subtitle={t("dashboardVolunteerFileSubtitle")}
            actions={<NavLink className="button button--primary button-link" to="/app/mes-affectations/mon-dossier">{t("dashboardOpenMyFile")}</NavLink>}
          >
            <ul className="compact-list">
              <li>{t("assignmentsStatusLabel")}: {formatVolunteerApplicationStatus(volunteerApplication.status, t)}</li>
              <li>{t("statedPreferences")}: {Array.isArray(volunteerApplication.missionPreferences) && volunteerApplication.missionPreferences.length ? volunteerApplication.missionPreferences.join(", ") : t("dashboardToComplete")}</li>
              <li>{t("dashboardAvailabilityLabel")}: {Array.isArray(volunteerApplication.availability) && volunteerApplication.availability.length ? volunteerApplication.availability.join(", ") : t("dashboardToComplete")}</li>
            </ul>
          </Panel>
          <article className="info-card">
            <h3>{t("dashboardWhatYouCanDoTitle")}</h3>
            <p>{t("dashboardWhatYouCanDoBody")}</p>
          </article>
        </section>
      ) : null}

      {shouldPromptParentToVolunteer ? (
        <section className="panel-grid panel-grid--2">
          <Panel
            title={t("dashboardJoinVolunteersTitle")}
            subtitle={t("dashboardJoinVolunteersSubtitle")}
            actions={<NavLink className="button button--primary button-link" to="/app/mes-affectations/mon-dossier">{t("dashboardBecomeVolunteer")}</NavLink>}
          >
            <ul className="compact-list">
              <li>{t("dashboardJoinVolunteersPoint1")}</li>
              <li>{t("dashboardJoinVolunteersPoint2")}</li>
              <li>{t("dashboardJoinVolunteersPoint3")}</li>
            </ul>
          </Panel>
        </section>
      ) : null}
    </div>
  );
}

function EditionSettingsPage(props) {
  const { Panel } = props;
  const { t } = useLanguage();
  const {
    activeEditionId,
    activeEditionLabel,
    loading: editionLoading,
    preprogramOpeningByEdition,
    preprogramOpeningDate,
  } = useActiveEdition();
  const [editionDraft, setEditionDraft] = useState(activeEditionId);
  const [preprogramOpeningDraft, setPreprogramOpeningDraft] = useState("");
  const [editionSaveStatus, setEditionSaveStatus] = useState("");
  const currentPreprogramOpeningValue = preprogramOpeningByEdition?.[normalizeEditionId(activeEditionId)] || "";
  const { editions: meetingEditions } = useMeetingEditions();
  const availableEditionOptions = useMemo(() => {
    const numericEditionIds = [...new Set((meetingEditions || []).map((edition) => normalizeEditionId(edition.year)).filter(Boolean))]
      .sort((left, right) => Number(right) - Number(left));

    return [
      { value: "test", label: `test — ${t("dashboardTemplateConfiguration")}` },
      ...numericEditionIds.map((editionId) => {
        const edition = (meetingEditions || []).find((entry) => normalizeEditionId(entry.year) === editionId);
        return {
          value: editionId,
          label: edition?.isClosed
            ? `${t("dashboardEditionWord")} ${editionId} — ${t("dashboardClosed")}`
            : `${t("dashboardEditionWord")} ${editionId}`,
        };
      }),
    ];
  }, [meetingEditions, t]);

  useEffect(() => {
    setEditionDraft(activeEditionId);
  }, [activeEditionId]);

  useEffect(() => {
    setPreprogramOpeningDraft(
      preprogramOpeningDate && !Number.isNaN(preprogramOpeningDate.getTime())
        ? formatDateTimeLocalValue(preprogramOpeningDate)
        : "",
    );
  }, [activeEditionId, currentPreprogramOpeningValue]);

  async function handleEditionSwitch(event) {
    event.preventDefault();

    const nextEditionId = normalizeEditionId(editionDraft);
    setEditionSaveStatus(t("dashboardEditionSaving"));

    try {
      if (nextEditionId !== activeEditionId) {
        await archiveCurrentEditionData(activeEditionId);
        if (activeEditionId === "test" && nextEditionId !== "test") {
          await copyEditionStructureToArchive(activeEditionId, nextEditionId);
        }
        const currentEditionYear = Number(activeEditionId);
        const nextEditionYear = Number(nextEditionId);
        if (
          activeEditionId !== "test" &&
          nextEditionId !== "test" &&
          Number.isFinite(currentEditionYear) &&
          Number.isFinite(nextEditionYear) &&
          nextEditionYear > currentEditionYear
        ) {
          await setDoc(
            doc(db, "meetingEditions", String(currentEditionYear)),
            {
              isClosed: true,
              closedAt: serverTimestamp(),
            },
            { merge: true },
          );
        }
        if (nextEditionId !== "test" && Number.isFinite(nextEditionYear)) {
          await setDoc(
            doc(db, "meetingEditions", String(nextEditionYear)),
            {
              isClosed: false,
              updatedAt: serverTimestamp(),
            },
            { merge: true },
          );
        }
        await resetEditionScopedData();
        await restoreEditionScopedData(nextEditionId, {
          restoreAssignments: nextEditionId === "test",
        });
      }

      await setDoc(
        doc(db, ...ACTIVE_EDITION_DOC_PATH),
        {
          activeEdition: nextEditionId,
          preprogramOpeningByEdition: {
            ...preprogramOpeningByEdition,
            [nextEditionId]: preprogramOpeningDraft ? new Date(preprogramOpeningDraft).toISOString() : null,
          },
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
      setEditionSaveStatus(`${t("dashboardEditionUpdated")}: ${getEditionLabel(nextEditionId)}.`);
    } catch (error) {
      console.error("Unable to switch active edition", error);
      setEditionSaveStatus(t("dashboardEditionSwitchFailed"));
    }
  }

  async function resetEditionScopedData() {
    const usersSnapshot = await getDocs(collection(db, "users"));
    const batch = writeBatch(db);

    usersSnapshot.docs.forEach((userSnapshot) => {
      const userData = userSnapshot.data();
      const normalizedUserTypes = Array.isArray(userData?.userTypes) ? userData.userTypes : [];
      const isAdminProfile = normalizedUserTypes.includes("admin");

      batch.set(
        doc(db, "users", userSnapshot.id),
        {
          assignedRole: deleteField(),
          assignedTeams: [],
          assignmentStatus: "En attente",
          teamEmailSent: false,
          teamRole: deleteField(),
          teamRoleAssignments: {},
          updatedAt: serverTimestamp(),
          ...(isAdminProfile ? {} : {}),
        },
        { merge: true },
      );
    });

    batch.set(
      doc(db, "appSettings", "teamsConfiguration"),
      {
        teamAssignments: [],
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );

    batch.set(
      doc(db, "appSettings", "accreditationConfiguration"),
      {
        volunteerOverrides: {},
        badgeStorageLocations: {},
        printHistory: [],
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );

    await batch.commit();
  }

  async function archiveCurrentEditionData(editionId) {
    const normalizedEditionId = normalizeEditionId(editionId);
    const [usersSnapshot, teamsSnapshot, accreditationSnapshot] = await Promise.all([
      getDocs(collection(db, "users")),
      getDoc(doc(db, ...TEAM_CONFIGURATION_DOC_PATH)),
      getDoc(doc(db, ...ACCREDITATION_CONFIGURATION_DOC_PATH)),
    ]);

    const userAssignmentSnapshots = usersSnapshot.docs
      .map((userSnapshot) => {
        const userData = userSnapshot.data();
        const assignedTeams = Array.isArray(userData?.assignedTeams) ? userData.assignedTeams : [];
        const teamRoleAssignments =
          userData?.teamRoleAssignments && typeof userData.teamRoleAssignments === "object"
            ? userData.teamRoleAssignments
            : {};

        const hasAssignmentData =
          assignedTeams.length > 0 ||
          String(userData?.assignedRole || "").trim() ||
          Object.keys(teamRoleAssignments).length > 0;

        if (!hasAssignmentData) return null;

        return {
          userId: userSnapshot.id,
          uid: String(userData?.uid || userSnapshot.id || "").trim(),
          firstName: String(userData?.firstName || ""),
          lastName: String(userData?.lastName || ""),
          email: String(userData?.email || ""),
          userTypes: Array.isArray(userData?.userTypes) ? userData.userTypes : [],
          assignedRole: String(userData?.assignedRole || ""),
          assignedTeams,
          assignmentStatus: String(userData?.assignmentStatus || ""),
          teamRole: String(userData?.teamRole || ""),
          teamRoleAssignments,
        };
      })
      .filter(Boolean);

    const teamsData = teamsSnapshot.exists() ? teamsSnapshot.data() : {};
    const accreditationData = accreditationSnapshot.exists() ? accreditationSnapshot.data() : {};
    const archivedAtIso = new Date().toISOString();

    await setDoc(
      doc(db, "editionArchives", normalizedEditionId),
      {
        editionId: normalizedEditionId,
        archivedAt: serverTimestamp(),
        teamConfigurationSnapshot: {
          roles: Array.isArray(teamsData?.roles) ? teamsData.roles : [],
          teamAssignments: Array.isArray(teamsData?.teamAssignments) ? teamsData.teamAssignments : [],
          supportTasks: Array.isArray(teamsData?.supportTasks) ? teamsData.supportTasks : [],
        },
        accreditationSnapshot: {
          volunteerOverrides:
            accreditationData?.volunteerOverrides && typeof accreditationData.volunteerOverrides === "object"
              ? accreditationData.volunteerOverrides
              : {},
          badgeStorageLocations:
            accreditationData?.badgeStorageLocations && typeof accreditationData.badgeStorageLocations === "object"
              ? accreditationData.badgeStorageLocations
              : {},
          printHistory: Array.isArray(accreditationData?.printHistory) ? accreditationData.printHistory : [],
        },
        userAssignmentSnapshots,
      },
      { merge: true },
    );

    if (!userAssignmentSnapshots.length) return;

    const historyBatch = writeBatch(db);

    userAssignmentSnapshots.forEach((userSnapshot) => {
      const userId = String(userSnapshot?.userId || userSnapshot?.uid || "").trim();
      if (!userId) return;

      historyBatch.set(
        doc(db, "users", userId),
        {
          assignmentHistoryByEdition: {
            [normalizedEditionId]: {
              editionId: normalizedEditionId,
              archivedAt: archivedAtIso,
              assignedRole: String(userSnapshot?.assignedRole || "").trim(),
              assignedTeams: Array.isArray(userSnapshot?.assignedTeams) ? userSnapshot.assignedTeams : [],
              assignmentStatus: String(userSnapshot?.assignmentStatus || "").trim() || "En attente",
              teamRole: String(userSnapshot?.teamRole || "").trim(),
              teamRoleAssignments:
                userSnapshot?.teamRoleAssignments && typeof userSnapshot.teamRoleAssignments === "object"
                  ? userSnapshot.teamRoleAssignments
                  : {},
            },
          },
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
    });

    await historyBatch.commit();
  }

  async function copyEditionStructureToArchive(sourceEditionId, targetEditionId) {
    const normalizedSourceEditionId = normalizeEditionId(sourceEditionId);
    const normalizedTargetEditionId = normalizeEditionId(targetEditionId);
    const sourceArchiveSnapshot = await getDoc(doc(db, "editionArchives", normalizedSourceEditionId));

    if (!sourceArchiveSnapshot.exists()) return;

    const sourceArchiveData = sourceArchiveSnapshot.data() || {};
    const sourceTeamConfigurationSnapshot =
      sourceArchiveData?.teamConfigurationSnapshot && typeof sourceArchiveData.teamConfigurationSnapshot === "object"
        ? sourceArchiveData.teamConfigurationSnapshot
        : {};

    await setDoc(
      doc(db, "editionArchives", normalizedTargetEditionId),
      {
        editionId: normalizedTargetEditionId,
        preparedFromEditionId: normalizedSourceEditionId,
        preparedAt: serverTimestamp(),
        teamConfigurationSnapshot: {
          roles: Array.isArray(sourceTeamConfigurationSnapshot?.roles) ? sourceTeamConfigurationSnapshot.roles : [],
          teamAssignments: [],
          supportTasks: Array.isArray(sourceTeamConfigurationSnapshot?.supportTasks)
            ? sourceTeamConfigurationSnapshot.supportTasks
            : [],
        },
        accreditationSnapshot: {
          volunteerOverrides: {},
          badgeStorageLocations: {},
          printHistory: [],
        },
        userAssignmentSnapshots: [],
      },
      { merge: true },
    );
  }

  async function restoreEditionScopedData(editionId, options = {}) {
    const { restoreAssignments = true } = options;
    const normalizedEditionId = normalizeEditionId(editionId);
    const archiveSnapshot = await getDoc(doc(db, "editionArchives", normalizedEditionId));

    if (!archiveSnapshot.exists()) return;

    const archiveData = archiveSnapshot.data() || {};
    const userAssignmentSnapshots = Array.isArray(archiveData?.userAssignmentSnapshots)
      ? archiveData.userAssignmentSnapshots
      : [];
    const teamConfigurationSnapshot =
      archiveData?.teamConfigurationSnapshot && typeof archiveData.teamConfigurationSnapshot === "object"
        ? archiveData.teamConfigurationSnapshot
        : {};
    const accreditationSnapshot =
      archiveData?.accreditationSnapshot && typeof archiveData.accreditationSnapshot === "object"
        ? archiveData.accreditationSnapshot
        : {};
    const batch = writeBatch(db);

    if (restoreAssignments) {
      userAssignmentSnapshots.forEach((userSnapshot) => {
        const userId = String(userSnapshot?.userId || userSnapshot?.uid || "").trim();
        if (!userId) return;

        batch.set(
          doc(db, "users", userId),
          {
            assignedRole: String(userSnapshot?.assignedRole || "").trim() || deleteField(),
            assignedTeams: Array.isArray(userSnapshot?.assignedTeams) ? userSnapshot.assignedTeams : [],
            assignmentStatus: String(userSnapshot?.assignmentStatus || "").trim() || "En attente",
            teamRole: String(userSnapshot?.teamRole || "").trim() || deleteField(),
            teamRoleAssignments:
              userSnapshot?.teamRoleAssignments && typeof userSnapshot.teamRoleAssignments === "object"
                ? userSnapshot.teamRoleAssignments
                : {},
            updatedAt: serverTimestamp(),
          },
          { merge: true },
        );
      });
    }

    batch.set(
      doc(db, ...TEAM_CONFIGURATION_DOC_PATH),
      {
        roles: Array.isArray(teamConfigurationSnapshot?.roles) ? teamConfigurationSnapshot.roles : [],
        teamAssignments:
          restoreAssignments && Array.isArray(teamConfigurationSnapshot?.teamAssignments)
            ? teamConfigurationSnapshot.teamAssignments
            : [],
        supportTasks: Array.isArray(teamConfigurationSnapshot?.supportTasks) ? teamConfigurationSnapshot.supportTasks : [],
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );

    batch.set(
      doc(db, ...ACCREDITATION_CONFIGURATION_DOC_PATH),
      {
        volunteerOverrides:
          restoreAssignments &&
          accreditationSnapshot?.volunteerOverrides &&
          typeof accreditationSnapshot.volunteerOverrides === "object"
            ? accreditationSnapshot.volunteerOverrides
            : {},
        badgeStorageLocations:
          restoreAssignments &&
          accreditationSnapshot?.badgeStorageLocations &&
          typeof accreditationSnapshot.badgeStorageLocations === "object"
            ? accreditationSnapshot.badgeStorageLocations
            : {},
        printHistory:
          restoreAssignments && Array.isArray(accreditationSnapshot?.printHistory)
            ? accreditationSnapshot.printHistory
            : [],
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );

    await batch.commit();
  }

  return (
    <div className="page">
      <section className="page-header">
        <div>
          <p className="eyebrow">{t("navSectionSettings")}</p>
          <h1>{t("navEditionSettings")}</h1>
          <p>{t("dashboardActiveEditionSubtitle")}</p>
        </div>
      </section>

      <section className="panel-grid panel-grid--2">
        <Panel title={t("dashboardActiveEditionTitle")} subtitle={t("dashboardActiveEditionSubtitle")}>
          <form className="profile-form" onSubmit={handleEditionSwitch}>
            <AuthEditionField
              activeEditionLabel={activeEditionLabel}
              editionDraft={editionDraft}
              editionLoading={editionLoading}
              editionOptions={availableEditionOptions}
              onEditionDraftChange={setEditionDraft}
              preprogramOpeningDraft={preprogramOpeningDraft}
              onPreprogramOpeningDraftChange={setPreprogramOpeningDraft}
              t={t}
            />
            <div className="dashboard-action-grid">
              <button className="button button--primary" disabled={editionLoading} type="submit">
                {t("dashboardSwitchEdition")}
              </button>
            </div>
            {editionSaveStatus ? <p className="panel-note">{editionSaveStatus}</p> : null}
          </form>
        </Panel>
        <Panel title={t("dashboardSwitchEffectTitle")} subtitle={t("dashboardSwitchEffectSubtitle")}>
          <ul className="compact-list">
            <li>{t("dashboardSwitchEffectAccounts")}</li>
            <li>{t("dashboardSwitchEffectRoles")}</li>
            <li>{t("dashboardSwitchEffectVolunteerModule")}</li>
            <li>{t("dashboardSwitchEffectPreprogram")}</li>
            <li>{t("dashboardSwitchEffectClosedEdition")}</li>
            <li>{t("dashboardSwitchEffectArchivedData")}</li>
          </ul>
        </Panel>
      </section>
    </div>
  );
}

function AuthEditionField(props) {
  const {
    activeEditionLabel,
    editionDraft,
    editionLoading,
    editionOptions,
    onEditionDraftChange,
    preprogramOpeningDraft,
    onPreprogramOpeningDraftChange,
    t,
  } = props;

  return (
    <>
      <label className="field">
        <span>{t("dashboardTargetEdition")}</span>
        <select
          disabled={editionLoading}
          onChange={(event) => onEditionDraftChange(event.target.value)}
          value={editionDraft}
        >
          {editionOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <p className="panel-note">
        {t("dashboardCurrentlyVisibleEdition")}: {editionLoading ? t("dashboardLoadingGeneric") : activeEditionLabel}
      </p>
      <label className="field">
        <span>{t("dashboardPreprogramOpening")}</span>
        <input
          disabled={editionLoading}
          onChange={(event) => onPreprogramOpeningDraftChange(event.target.value)}
          type="datetime-local"
          value={preprogramOpeningDraft}
        />
      </label>
    </>
  );
}

function formatDateTimeLocalValue(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

export { AppShell, DashboardHome, EditionSettingsPage };
