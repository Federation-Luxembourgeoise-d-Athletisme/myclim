import { NavLink, Outlet, useLocation, useNavigate, useOutletContext } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { collection, deleteField, doc, getDoc, getDocs, serverTimestamp, setDoc, writeBatch } from "firebase/firestore";
import { useAuth } from "../context/auth-context";
import {
  ACTIVE_EDITION_DOC_PATH,
  getEditionLabel,
  normalizeEditionId,
  useActiveEdition,
} from "./edition";
import { buildAthletePortalNavigation, buildNavigationFromRoles, buildStatisticsNavigation, getActiveRoles, getPrimaryRole } from "./navigation";
import { canAccessAthletePortal, canImportAthletes, useAthletePortalSettings } from "./athlete-portal-hooks";
import { useTeamConfiguration } from "./config-hooks";
import { useDocumentsCollection } from "./documents-hooks";
import { useMeetingEditions } from "./meeting-history-hooks";
import { useVolunteerApplication, useVolunteerApplicationsList } from "./volunteer-hooks";
import { useParentU14Children, useU14RequestsList } from "./u14-hooks";
import { buildUserIdentitySet, formatVolunteerApplicationStatus, isTeamLeadAssignment } from "./common-helpers";
import { ACCREDITATION_CONFIGURATION_DOC_PATH, TEAM_CONFIGURATION_DOC_PATH } from "./seed-data";
import { getDisplayName, normalizeRole } from "./utils";
import { LanguageSwitch } from "./language";
import { useLanguage } from "./language-context";
import { db } from "../services/firebase";

function flattenNavigationItems(items) {
  return items.flatMap((item) => (item.type === "section" ? item.links : [item]));
}

function isRouteMatch(pathname, targetPath) {
  if (targetPath === "/app") return pathname === targetPath;
  return pathname === targetPath || pathname.startsWith(`${targetPath}/`);
}

function formatRoleLabel(role, t) {
  const labelKeys = {
    admin: "roleLabelAdmin",
    budget: "roleLabelBudget",
    gestionnaire: "roleLabelManager",
    chef_equipe: "roleLabelTeamLead",
    benevole: "roleLabelVolunteer",
    parent_u14: "roleLabelParentU14",
    gestionnaire_site: "roleLabelWebsiteManager",
    chef_transport_athletes: "roleLabelAthleteTransportLead",
    benevole_transport_athletes: "roleLabelAthleteTransportVolunteer",
    meeting_director: "roleLabelMeetingDirector",
    kine: "roleLabelPhysio",
  };

  const labelKey = labelKeys[role];
  return labelKey ? t(labelKey) : String(role || "").replaceAll("_", " ");
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

function AppShell(props) {
  const { cmcmLogo } = props;
  const { t } = useLanguage();
  const { currentUser, logout, userProfile } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const roles = getActiveRoles(userProfile);
  const { activeEditionLabel } = useActiveEdition();
  const { settings: portalSettings, loading: portalSettingsLoading } = useAthletePortalSettings();
  const [preferredViewAsRole, setPreferredViewAsRole] = useState(() => getPrimaryRole(userProfile));
  const [isSidebarOpen, setIsSidebarOpen] = useState(() =>
    typeof window === "undefined" ? true : window.innerWidth > 1100,
  );
  const primaryRole = getPrimaryRole(userProfile);
  const viewAsRole = roles.includes("admin")
    ? (roles.includes(preferredViewAsRole) ? preferredViewAsRole : primaryRole)
    : primaryRole;
  const effectiveRoles = useMemo(() => {
    if (!roles.includes("admin")) return roles;
    if (viewAsRole === "admin") return roles;
    return [viewAsRole];
  }, [roles, viewAsRole]);

  const portalCanImport = useMemo(
    () => canImportAthletes(effectiveRoles, portalSettings),
    [effectiveRoles, portalSettings],
  );
  const portalSection = useMemo(() => {
    if (portalSettingsLoading || !canAccessAthletePortal(effectiveRoles, portalSettings)) return null;
    return {
      type: "section",
      titleKey: "navSectionAthletePortal",
      title: "Athlete Portal",
      links: buildAthletePortalNavigation(effectiveRoles, portalSettings, { canImport: portalCanImport }),
    };
  }, [effectiveRoles, portalCanImport, portalSettings, portalSettingsLoading]);
  const statisticsSection = useMemo(() => {
    const links = buildStatisticsNavigation(effectiveRoles);
    if (!links.length) return null;
    return {
      type: "section",
      titleKey: "navSectionStatistics",
      title: "Statistiques",
      links,
    };
  }, [effectiveRoles]);

  const mainNavigation = useMemo(() => {
    const nav = buildNavigationFromRoles(effectiveRoles);

    if (statisticsSection && Array.isArray(nav)) {
      const settingsIndex = nav.findIndex((item) => item.type === "section" && item.titleKey === "navSectionSettings");
      if (settingsIndex >= 0) {
        nav.splice(settingsIndex, 0, statisticsSection);
      } else {
        nav.push(statisticsSection);
      }
    }

    if (portalSection && Array.isArray(nav)) {
      const settingsIndex = nav.findIndex((item) => item.type === "section" && item.titleKey === "navSectionSettings");
      if (settingsIndex >= 0) {
        nav.splice(settingsIndex, 0, portalSection);
      } else {
        nav.push(portalSection);
      }
    }

    return nav;
  }, [effectiveRoles, portalSection, statisticsSection]);

  const navigation = mainNavigation;
  const flatNavigation = useMemo(() => flattenNavigationItems(navigation), [navigation]);
  const [openSections, setOpenSections] = useState({});
  const displayName = getDisplayName(userProfile, currentUser?.email);
  const currentRouteLabelKey =
    flatNavigation.find((item) => item.to === location.pathname)?.labelKey ||
    flatNavigation.find((item) => item.to !== "/app" && isRouteMatch(location.pathname, item.to))?.labelKey;
  const currentRouteLabel = currentRouteLabelKey ? t(currentRouteLabelKey) : t("shellMenuLabel");

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
    setPreferredViewAsRole(nextRole);

    const defaultRouteByRole = {
      admin: "/app",
      budget: "/app/budget",
      gestionnaire: "/app/benevoles",
      chef_equipe: "/app/equipe",
      benevole: "/app/mes-affectations",
      parent_u14: "/app/mes-enfants",
    };

    navigate(defaultRouteByRole[nextRole] || "/app");
  }

  async function handleLogout() {
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
                                <span>{t(link.labelKey) || link.label}</span>
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
                    <span>{t(item.labelKey) || item.label}</span>
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
              {formatRoleLabel(roles.includes("admin") ? viewAsRole : primaryRole, t)}
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
        {roles.includes("admin") ? (
          <div className="content-toolbar">
            <label className="view-switcher">
              <span>{t("shellViewAsLabel")}</span>
              <select value={viewAsRole} onChange={(event) => handleViewAsChange(event.target.value)}>
                {roles.includes("admin") ? <option value="admin">{t("roleLabelAdmin")}</option> : null}
                {roles.includes("budget") ? <option value="budget">{t("roleLabelBudget")}</option> : null}
                {roles.includes("chef_equipe") ? <option value="chef_equipe">{t("roleLabelTeamLead")}</option> : null}
                {roles.includes("benevole") ? <option value="benevole">{t("roleLabelVolunteer")}</option> : null}
                {roles.includes("parent_u14") ? <option value="parent_u14">{t("roleLabelParentU14")}</option> : null}
              </select>
            </label>
            {viewAsRole === "admin" ? (
              <p className="content-toolbar__hint">{t("shellAdminViewHint")}</p>
            ) : null}
          </div>
        ) : null}
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

function DashboardHome(props) {
  const { Panel } = props;
  const { t } = useLanguage();
  const { currentUser, userProfile } = useAuth();
  const roles = getActiveRoles(userProfile);
  const outletContext = useOutletContext() ?? {};
  const activeRole = outletContext.activeRole || getPrimaryRole(userProfile);
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
  const parentConfirmedCount = parentRequestRows.filter((child) => child.status === "Confirmée").length;
  const parentPendingCount = parentRequestRows.filter((child) => child.status !== "Confirmée").length;
  const adminDataLoading = teamsLoading || volunteerApplicationsLoading || documentsLoading || u14RequestsLoading;
  const volunteerDataLoading = teamsLoading || documentsLoading;
  const leadDataLoading = teamsLoading || documentsLoading;

  function renderRoleSummary() {
    if (activeRole === "admin") {
      return (
        <section className="panel-grid panel-grid--2">
          <Panel title={t("dashboardPrioritiesTitle")} subtitle={t("dashboardAdminPrioritiesSubtitle")}>
            <ul className="compact-list">
              <li>{adminDataLoading ? t("dashboardLoadingApplications") : t("dashboardAdminApplicationsToProcess").replace("{count}", pendingApplicationsCount)}</li>
              <li>{adminDataLoading ? t("dashboardLoadingTeams") : t("dashboardAdminIncompleteTeams").replace("{count}", incompleteTeamsCount)}</li>
              <li>{documentsLoading ? t("dashboardLoadingDocuments") : t("dashboardAdminDocumentsToReview").replace("{count}", documents.length)}</li>
              <li>{u14RequestsLoading ? t("dashboardLoadingU14Requests") : t("dashboardAdminU14RequestsToFollow").replace("{count}", submittedU14RequestsCount)}</li>
            </ul>
          </Panel>
          <Panel title={t("dashboardQuickAccessTitle")} subtitle={t("dashboardAdminQuickAccessSubtitle")}>
            <div className="dashboard-action-grid">
              <NavLink className="button button--secondary button-link" to="/app/benevoles">{t("dashboardManageVolunteers")}</NavLink>
              <NavLink className="button button--secondary button-link" to="/app/roles">{t("dashboardManageRoles")}</NavLink>
              <NavLink className="button button--secondary button-link" to="/app/edition-meeting">{t("navEditionSettings")}</NavLink>
              <NavLink className="button button--secondary button-link" to="/app/postes">{t("dashboardAdjustTeams")}</NavLink>
              <NavLink className="button button--secondary button-link" to="/app/accreditations">{t("dashboardProduceBadges")}</NavLink>
              <NavLink className="button button--secondary button-link" to="/app/website">{t("dashboardManageWebsite")}</NavLink>
              <NavLink className="button button--secondary button-link" to="/app/athlete-portal/athletes">{t("dashboardManageAthletes")}</NavLink>
              <NavLink className="button button--secondary button-link" to="/app/statistics/results">{t("dashboardManageResults")}</NavLink>
            </div>
          </Panel>
        </section>
      );
    }

    if (activeRole === "benevole") {
      return (
        <section className="panel-grid panel-grid--2">
          <Panel title={t("dashboardPrioritiesTitle")} subtitle={t("dashboardVolunteerPrioritiesSubtitle")}>
            <ul className="compact-list">
              <li>{volunteerDataLoading ? t("dashboardLoadingAssignment") : `${t("dashboardCurrentAssignment")}: ${volunteerAssignmentSummary}`}</li>
              <li>{t("dashboardPlannedShift")}: {volunteerShiftSummary}</li>
              <li>{t("dashboardVolunteerFileStatus")}: {formatVolunteerApplicationStatus(volunteerApplication?.status, t)}</li>
              <li>{documentsLoading ? t("dashboardLoadingMissionDocuments") : t("dashboardDocumentsAvailableForTeams").replace("{count}", myDocumentsCount)}</li>
              <li>{t("dashboardBriefingLabel")}: {volunteerBriefingSummary}</li>
              <li>{t("dashboardVolunteerDepartureReminder")}</li>
            </ul>
          </Panel>
          <Panel title={t("dashboardQuickAccessTitle")} subtitle={t("dashboardVolunteerQuickAccessSubtitle")}>
            <div className="dashboard-action-grid">
              <NavLink className="button button--secondary button-link" to="/app/mes-affectations">{t("navMyAssignments")}</NavLink>
              <NavLink className="button button--secondary button-link" to="/app/mes-documents">{t("navMyDocuments")}</NavLink>
            </div>
          </Panel>
        </section>
      );
    }

    if (activeRole === "gestionnaire") {
      return (
        <section className="panel-grid panel-grid--2">
          <Panel title={t("dashboardPrioritiesTitle")} subtitle={t("dashboardManagerPrioritiesSubtitle")}>
            <ul className="compact-list">
              <li>{t("dashboardManagerTaskCheckIn")}</li>
              <li>{t("dashboardManagerTaskLunch")}</li>
              <li>{t("dashboardManagerTaskAttendance")}</li>
            </ul>
          </Panel>
          <Panel title={t("dashboardQuickAccessTitle")} subtitle={t("dashboardManagerQuickAccessSubtitle")}>
            <div className="dashboard-action-grid">
              <NavLink className="button button--secondary button-link" to="/app/benevoles">{t("navVolunteersLink")}</NavLink>
              <NavLink className="button button--secondary button-link" to="/app/accreditations">{t("navSectionAccreditations")}</NavLink>
              <NavLink className="button button--secondary button-link" to="/app/presences">{t("navAttendance")}</NavLink>
              <NavLink className="button button--secondary button-link" to="/app/u14">{t("navSectionPreprogram")}</NavLink>
              <NavLink className="button button--secondary button-link" to="/app/documents">{t("navDocuments")}</NavLink>
            </div>
          </Panel>
        </section>
      );
    }

    if (activeRole === "parent_u14") {
      return (
        <section className="panel-grid panel-grid--2">
          <Panel title={t("dashboardPrioritiesTitle")} subtitle={t("dashboardParentPrioritiesSubtitle")}>
            <ul className="compact-list">
              {parentRowsLoading ? <li>{t("dashboardLoadingU14Requests")}</li> : null}
              {!parentRowsLoading && parentRequestRows.length === 0 ? <li>{t("dashboardNoU14Request")}</li> : null}
              {!parentRowsLoading && parentRequestRows.map((child) => (
                <li key={child.id}>{child.name}: {child.status} - {child.schedule}</li>
              ))}
            </ul>
          </Panel>
          <Panel title={t("dashboardQuickAccessTitle")} subtitle={t("dashboardParentQuickAccessSubtitle")}>
            <div className="dashboard-action-grid">
              <NavLink className="button button--secondary button-link" to="/app/mes-enfants">{t("navMyChildren")}</NavLink>
              <NavLink className="button button--secondary button-link" to="/app/profil">{t("navMyProfile")}</NavLink>
            </div>
            {!parentRowsLoading && parentRequestRows.length > 0 ? (
              <p className="panel-note">
                {t("dashboardParentConfirmedPending")
                  .replace("{confirmed}", parentConfirmedCount)
                  .replace("{pending}", parentPendingCount)}
              </p>
            ) : null}
          </Panel>
        </section>
      );
    }

    if (activeRole === "chef_equipe") {
      return (
        <section className="panel-grid panel-grid--2">
          <Panel title={t("dashboardPrioritiesTitle")} subtitle={t("dashboardTeamLeadPrioritiesSubtitle")}>
            <ul className="compact-list">
              <li>
                {leadDataLoading
                  ? t("dashboardLoadingTeams")
                  : totalOpenPositions > 0
                    ? t("dashboardOpenPositions")
                        .replace("{count}", totalOpenPositions)
                        .replace("{roles}", ledRoles.map((role) => role.roleName).join(", "))
                    : t("dashboardAllTeamsFull")}
              </li>
              <li>{leadDataLoading ? t("dashboardLoadingAssignments") : t("dashboardTeamMembersCount").replace("{count}", totalLeadMembers)}</li>
              <li>{documentsLoading ? t("dashboardLoadingTeamDocuments") : t("dashboardTeamDocumentsAvailable").replace("{count}", leadDocumentsCount)}</li>
              <li>{leadDataLoading ? t("dashboardLoadingReplacements") : t("dashboardReplacementsIdentified").replace("{count}", totalReplacements)}</li>
              <li>{t("dashboardTeamLeadDepartureReminder")}</li>
            </ul>
          </Panel>
          <Panel title={t("dashboardQuickAccessTitle")} subtitle={t("dashboardTeamLeadQuickAccessSubtitle")}>
            <div className="dashboard-action-grid">
              <NavLink className="button button--secondary button-link" to="/app/equipe">{t("navMyTeam")}</NavLink>
              <NavLink className="button button--secondary button-link" to="/app/presences">{t("navAttendance")}</NavLink>
              <NavLink className="button button--secondary button-link" to="/app/mes-documents">{t("navDocuments")}</NavLink>
            </div>
          </Panel>
        </section>
      );
    }

    return null;
  }

  return (
    <div className="page">
      <section className="page-header">
        <div>
          <p className="eyebrow">{t("navOverview")}</p>
          <h1>{t("dashboardWelcome")} {getDisplayName(userProfile, currentUser?.email)}</h1>
          <p>{t("dashboardIntro")}</p>
        </div>
      </section>

      <article className="info-card install-app-card">
        <h3>{t("dashboardInstallTitle")}</h3>
        <p>{t("dashboardInstallIntro")}</p>
        <section className="install-app-grid" aria-label={t("dashboardInstallInstructionsAria")}>
          <article className="install-app-step">
            <strong className="install-app-step__title">
              <span className="install-app-step__icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" focusable="false">
                  <path d="M15.2 3.6c.7-.8 1.2-1.8 1.1-2.9-1 .1-2.1.7-2.8 1.5-.6.7-1.2 1.8-1 2.8 1.1.1 2-.5 2.7-1.4Z" />
                  <path d="M17.4 12.7c0-2.3 1.9-3.4 2-3.5-1.1-1.6-2.8-1.8-3.4-1.8-1.4-.1-2.7.8-3.5.8s-1.9-.8-3.1-.8c-1.6 0-3 .9-3.8 2.3-1.6 2.7-.4 6.8 1.1 8.9.7 1 1.6 2.2 2.8 2.1 1.1 0 1.6-.7 3-.7 1.4 0 1.9.7 3 .7 1.2 0 2-.9 2.7-1.9.8-1.2 1.2-2.3 1.2-2.4-.1-.1-2-.8-2-3.7Z" />
                </svg>
              </span>
              {t("dashboardInstallOnIphone")}
            </strong>
            <p>{t("dashboardInstallIphoneSteps")}</p>
          </article>
          <article className="install-app-step">
            <strong className="install-app-step__title">
              <span className="install-app-step__icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" focusable="false">
                  <path d="M7.1 8.1h9.8c.6 0 1 .5 1 1v6.8c0 .6-.4 1-1 1h-.7v2.3c0 .5-.4.9-.9.9s-.9-.4-.9-.9v-2.3h-4.8v2.3c0 .5-.4.9-.9.9s-.9-.4-.9-.9v-2.3h-.7c-.6 0-1-.4-1-1V9.1c0-.5.4-1 1-1Z" />
                  <path d="M8.7 6.8a3.4 3.4 0 0 1 6.6 0Z" />
                  <path d="M9.2 4.2 8 2.7m8 1.5 1.2-1.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  <circle cx="10" cy="11.1" r=".7" />
                  <circle cx="14" cy="11.1" r=".7" />
                </svg>
              </span>
              {t("dashboardInstallOnAndroid")}
            </strong>
            <p>{t("dashboardInstallAndroidSteps")}</p>
          </article>
        </section>
        <p className="install-app-note">{t("dashboardInstallNote")}</p>
      </article>

      {renderRoleSummary()}

      {volunteerApplication ? (
        <section className="panel-grid panel-grid--2">
          <Panel
            title={t("navMyVolunteerFile")}
            subtitle={t("dashboardVolunteerFileSubtitle")}
            actions={<NavLink className="button button--primary button-link" to="/app/mon-dossier-benevole">{t("dashboardOpenMyFile")}</NavLink>}
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
            actions={<NavLink className="button button--primary button-link" to="/app/mon-dossier-benevole">{t("dashboardBecomeVolunteer")}</NavLink>}
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
