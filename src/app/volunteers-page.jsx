import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { NavLink } from "react-router-dom";
import { arrayUnion, doc, onSnapshot, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import { getWorkflowStatusClass } from "./common-helpers";
import {
  TEAM_CONFIGURATION_DOC_PATH,
  VOLUNTEER_ALERT_LOG_DOC_PATH,
  supportTaskOptions,
  volunteerWorkflowStatusOptions,
} from "./seed-data";
import { mapVolunteerApplicationToAdminVolunteer } from "./volunteer-helpers";
import { useVolunteerAlertLog, useVolunteerApplicationsList } from "./volunteer-hooks";
import { defaultTeamRoles, normalizeSubRoles, normalizeTeamConfigurationPayload } from "./team-config";
import { db } from "../services/firebase";
import { useLanguage } from "./language-context";

const DEFAULT_LIST_PAGE_SIZE = 10;

const LANGUAGE_CODES = {
  français: "FR",
  anglais: "EN",
  allemand: "DE",
  luxembourgeois: "LU",
  portugais: "PT",
  italien: "IT",
  espagnol: "ES",
  néerlandais: "NL",
};

// Codes courts pour la liste dense (FR EN LU…) ; le nom complet reste en infobulle.
function getLanguageCode(language) {
  const name = String(language || "").trim();
  return LANGUAGE_CODES[name.toLowerCase()] || name.slice(0, 3);
}

// view : onglet affiché quand la page est un onglet de Candidatures ou
// d'Équipes & affectations ("meeting", "assigned-posts", "support",
// "alerts") ; sans view, la page garde ses propres onglets.
// initialStatusFilter : filtre de statut au chargement (onglet « À traiter »).
function VolunteersPage(props) {
  const {
    initialStatusFilter,
    Panel,
    syncVolunteerAssignmentToUserProfile,
    syncVolunteerAssignmentsToTeamConfiguration,
    view,
  } = props;
  const { t } = useLanguage();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState(initialStatusFilter || "Tous");
  const [volunteerSortMode, setVolunteerSortMode] = useState("alphabetical");
  const [localVolunteerView, setActiveVolunteerView] = useState("meeting");
  const activeVolunteerView = view || localVolunteerView;
  const [assignedRoleFilter, setAssignedRoleFilter] = useState("Tous");
  const [teamRoleFilter, setTeamRoleFilter] = useState("Tous");
  const [mailFilter, setMailFilter] = useState("Tous");
  // Filtres du tableau : équipe ("Tous", "__none__" = sans équipe, ou nom), langue, préférence.
  const [teamFilter, setTeamFilter] = useState("Tous");
  const [languageFilter, setLanguageFilter] = useState("Tous");
  const [preferenceFilter, setPreferenceFilter] = useState("Tous");
  const [selectedVolunteerId, setSelectedVolunteerId] = useState(null);
  const [volunteers, setVolunteers] = useState([]);
  const [teamRoleConfigs, setTeamRoleConfigs] = useState(defaultTeamRoles);
  const [volunteerActionStatus, setVolunteerActionStatus] = useState(null);
  const [visibleListCountByKey, setVisibleListCountByKey] = useState({});
  const {
    applications: volunteerApplications,
    loading: volunteerApplicationsLoading,
    error: volunteerApplicationsError,
  } = useVolunteerApplicationsList(true);
  const {
    entries: volunteerAlertEntries,
    loading: volunteerAlertLogLoading,
    error: volunteerAlertLogError,
  } = useVolunteerAlertLog(true);

  function clearVolunteerActionStatus() {
    setVolunteerActionStatus(null);
  }

  function setVolunteerErrorStatus(message, detail = "") {
    setVolunteerActionStatus({ tone: "error", message, detail });
  }

  function getActionErrorDetail(error) {
    const rawMessage = String(error?.message || error?.code || "").trim();
    if (!rawMessage) {
      return "Aucun détail technique supplémentaire n'a été renvoyé.";
    }

    if (rawMessage.toLowerCase().includes("permission")) {
      return "Accès refusé par Firebase. Vérifie les règles Firestore ou les droits du compte connecté.";
    }

    if (rawMessage.toLowerCase().includes("network")) {
      return "Erreur réseau pendant la synchronisation avec Firebase.";
    }

    return rawMessage;
  }

  function getVisibleListItems(listKey, items) {
    const visibleCount = visibleListCountByKey[listKey] ?? DEFAULT_LIST_PAGE_SIZE;
    return items.slice(0, visibleCount);
  }

  function canShowMoreListItems(listKey, items) {
    const visibleCount = visibleListCountByKey[listKey] ?? DEFAULT_LIST_PAGE_SIZE;
    return items.length > visibleCount;
  }

  function showMoreListItems(listKey) {
    setVisibleListCountByKey((current) => ({
      ...current,
      [listKey]: (current[listKey] ?? DEFAULT_LIST_PAGE_SIZE) + DEFAULT_LIST_PAGE_SIZE,
    }));
  }

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setVolunteers(volunteerApplications.map((application) => mapVolunteerApplicationToAdminVolunteer(application)));
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [volunteerApplications]);

  useEffect(() => {
    const teamsConfigurationRef = doc(db, ...TEAM_CONFIGURATION_DOC_PATH);

    const unsubscribe = onSnapshot(
      teamsConfigurationRef,
      (snapshot) => {
        const nextRoles = snapshot.exists()
          ? normalizeTeamConfigurationPayload(snapshot.data()).roles
          : defaultTeamRoles;
        setTeamRoleConfigs(nextRoles);
      },
      () => {
        setTeamRoleConfigs(defaultTeamRoles);
      },
    );

    return unsubscribe;
  }, []);

  const getVolunteerAssignedRoles = useCallback((volunteer) => {
    return normalizeSubRoles(
      Array.isArray(volunteer.assignedRoles)
        ? volunteer.assignedRoles
        : volunteer.assignedRole
          ? [volunteer.assignedRole]
          : [],
    );
  }, []);

  const getVolunteerTeamRoleAssignments = useCallback(
    (volunteer, assignedRoles = getVolunteerAssignedRoles(volunteer)) => {
      const rawAssignments =
        volunteer?.teamRoleAssignments && typeof volunteer.teamRoleAssignments === "object"
          ? volunteer.teamRoleAssignments
          : {};
      const normalizedAssignments = {};

      assignedRoles.forEach((assignedRole, index) => {
        normalizedAssignments[assignedRole] =
          String(
            rawAssignments[assignedRole] ||
              (index === 0 ? volunteer.teamRole : "") ||
              "Bénévole",
          ) || "Bénévole";
      });

      return normalizedAssignments;
    },
    [getVolunteerAssignedRoles],
  );

  const getVolunteerTeamRoleForAssignedRole = useCallback(
    (volunteer, assignedRole) => getVolunteerTeamRoleAssignments(volunteer)[assignedRole] || "Bénévole",
    [getVolunteerTeamRoleAssignments],
  );

  function buildVolunteerAlertEntry(volunteer, reason, alertType = "withdrawal") {
    const previousRoles = getVolunteerAssignedRoles(volunteer);
    return {
      id: `volunteer-alert-${volunteer.id}-${Date.now()}`,
      volunteerId: volunteer.id,
      volunteerName: `${volunteer.firstName} ${volunteer.lastName}`.trim(),
      volunteerEmail: volunteer.email || "",
      previousRoles,
      previousTeamRoleAssignments: getVolunteerTeamRoleAssignments(volunteer, previousRoles),
      previousWorkflowStatus: volunteer.workflowStatus || "",
      alertType,
      reason: String(reason || "").trim(),
      createdAt: new Date().toISOString(),
    };
  }

  async function appendVolunteerAlertEntry(entry) {
    try {
      await setDoc(
        doc(db, ...VOLUNTEER_ALERT_LOG_DOC_PATH),
        {
          entries: arrayUnion(entry),
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
    } catch (error) {
      console.error("Impossible d'enregistrer l'alerte bénévole.", error);
    }
  }

  async function persistVolunteerPatchWithAlerts(id, patch, options = {}) {
    const volunteer = volunteers.find((entry) => entry.id === id);
    if (!volunteer) return;

    const previousRoles = getVolunteerAssignedRoles(volunteer);
    const nextAssignedRoles = normalizeSubRoles(
      Array.isArray(patch?.assignedRoles)
        ? patch.assignedRoles
        : patch?.assignedRole
          ? [patch.assignedRole]
          : previousRoles,
    );
    const nextWorkflowStatus = String(patch?.workflowStatus || volunteer.workflowStatus || "").trim();
    const shouldCreateAlert =
      previousRoles.length > 0 &&
      (
        nextWorkflowStatus === "Annulé" ||
        (previousRoles.length > 0 && nextAssignedRoles.length === 0)
      );

    if (shouldCreateAlert) {
      const alertReason =
        options.alertReason ||
        (nextWorkflowStatus === "Annulé"
          ? "Bénévole retiré des affectations."
          : "Dernière affectation retirée.");
      await appendVolunteerAlertEntry(
        buildVolunteerAlertEntry(
          volunteer,
          alertReason,
          nextWorkflowStatus === "Annulé" ? "withdrawal" : "assignment_removed",
        ),
      );
    }

    await persistVolunteerPatch(id, patch);
  }

  function buildNextVolunteerState(volunteer, patch) {
    return {
      ...volunteer,
      ...patch,
    };
  }

  const filteredVolunteers = useMemo(() => {
    return volunteers.filter((volunteer) => {
      const haystack = [
        volunteer.firstName,
        volunteer.lastName,
        volunteer.email,
        ...getVolunteerAssignedRoles(volunteer),
      ]
        .join(" ")
        .toLowerCase();

      const matchesSearch = haystack.includes(search.toLowerCase());
      const matchesStatus =
        statusFilter === "Tous" || volunteer.workflowStatus === statusFilter;
      const assignedRoles = getVolunteerAssignedRoles(volunteer);
      const matchesTeam =
        teamFilter === "Tous" ||
        (teamFilter === "__none__" ? assignedRoles.length === 0 : assignedRoles.includes(teamFilter));
      const matchesLanguage =
        languageFilter === "Tous" || (volunteer.languages || []).includes(languageFilter);
      const matchesPreference =
        preferenceFilter === "Tous" || (volunteer.missionPreferences || []).includes(preferenceFilter);

      return matchesSearch && matchesStatus && matchesTeam && matchesLanguage && matchesPreference;
    });
  }, [
    getVolunteerAssignedRoles,
    languageFilter,
    preferenceFilter,
    search,
    statusFilter,
    teamFilter,
    volunteers,
  ]);

  const languageOptions = useMemo(
    () =>
      [...new Set(volunteers.flatMap((volunteer) => volunteer.languages || []))]
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b, "fr")),
    [volunteers],
  );

  const preferenceOptions = useMemo(
    () =>
      [...new Set(volunteers.flatMap((volunteer) => volunteer.missionPreferences || []))]
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b, "fr")),
    [volunteers],
  );

  const hasSheetFilters =
    search !== "" ||
    statusFilter !== (initialStatusFilter || "Tous") ||
    teamFilter !== "Tous" ||
    languageFilter !== "Tous" ||
    preferenceFilter !== "Tous";

  function resetSheetFilters() {
    setSearch("");
    setStatusFilter(initialStatusFilter || "Tous");
    setTeamFilter("Tous");
    setLanguageFilter("Tous");
    setPreferenceFilter("Tous");
  }

  const compactRoleOptions = useMemo(() => {
    return [...new Set(volunteers.flatMap((volunteer) => getVolunteerAssignedRoles(volunteer)))].sort((a, b) =>
      a.localeCompare(b),
    );
  }, [getVolunteerAssignedRoles, volunteers]);

  const compactTeamRoleOptions = useMemo(() => {
    return [
      ...new Set(
        volunteers.flatMap((volunteer) =>
          getVolunteerAssignedRoles(volunteer).map((assignedRole) =>
            getVolunteerTeamRoleForAssignedRole(volunteer, assignedRole),
          ),
        ),
      ),
    ].sort((a, b) => a.localeCompare(b));
  }, [getVolunteerAssignedRoles, getVolunteerTeamRoleForAssignedRole, volunteers]);

  const compactAssignmentGroups = useMemo(() => {
    const sortedVolunteers = [...filteredVolunteers].sort((leftVolunteer, rightVolunteer) => {
      const lastNameComparison = String(leftVolunteer.lastName || "").localeCompare(
        String(rightVolunteer.lastName || ""),
        "fr",
        { sensitivity: "base" },
      );

      if (lastNameComparison !== 0) return lastNameComparison;

      const firstNameComparison = String(leftVolunteer.firstName || "").localeCompare(
        String(rightVolunteer.firstName || ""),
        "fr",
        { sensitivity: "base" },
      );

      if (firstNameComparison !== 0) return firstNameComparison;

      return String(leftVolunteer.id || "").localeCompare(String(rightVolunteer.id || ""));
    });

    return teamRoleConfigs
      .map((roleConfig) => {
        const members = sortedVolunteers.filter((volunteer) => {
          const assignedRoles = getVolunteerAssignedRoles(volunteer);
          if (!assignedRoles.includes(roleConfig.roleName)) return false;

          const teamRole = getVolunteerTeamRoleForAssignedRole(volunteer, roleConfig.roleName);
          const matchesTeamRole = teamRoleFilter === "Tous" || teamRole === teamRoleFilter;
          const matchesMail =
            mailFilter === "Tous" ||
            (mailFilter === "Informés" ? volunteer.teamEmailSent : !volunteer.teamEmailSent);

          return matchesTeamRole && matchesMail;
        });

        return {
          roleName: roleConfig.roleName,
          neededCount: Number(roleConfig.neededCount || 0),
          assignedCount: members.length,
          missingCount: Math.max(Number(roleConfig.neededCount || 0) - members.length, 0),
          members,
        };
      })
      .filter((group) => {
        const matchesAssignedRole =
          assignedRoleFilter === "Tous" || group.roleName === assignedRoleFilter;

        return matchesAssignedRole && (group.members.length > 0 || group.neededCount > 0);
      });
  }, [
    assignedRoleFilter,
    filteredVolunteers,
    getVolunteerAssignedRoles,
    getVolunteerTeamRoleForAssignedRole,
    mailFilter,
    teamRoleConfigs,
    teamRoleFilter,
  ]);

  const meetingVolunteers = useMemo(() => {
    function compareByName(leftVolunteer, rightVolunteer) {
      const lastNameComparison = String(leftVolunteer.lastName || "").localeCompare(
        String(rightVolunteer.lastName || ""),
        "fr",
        { sensitivity: "base" },
      );
      if (lastNameComparison !== 0) return lastNameComparison;

      const firstNameComparison = String(leftVolunteer.firstName || "").localeCompare(
        String(rightVolunteer.firstName || ""),
        "fr",
        { sensitivity: "base" },
      );
      if (firstNameComparison !== 0) return firstNameComparison;

      return String(leftVolunteer.id || "").localeCompare(String(rightVolunteer.id || ""));
    }

    if (volunteerSortMode === "team") {
      return [...filteredVolunteers].sort((leftVolunteer, rightVolunteer) => {
        const leftRole = getVolunteerAssignedRoles(leftVolunteer)[0] || "";
        const rightRole = getVolunteerAssignedRoles(rightVolunteer)[0] || "";
        const roleComparison = leftRole.localeCompare(rightRole, "fr", { sensitivity: "base" });
        if (roleComparison !== 0) return roleComparison;
        return compareByName(leftVolunteer, rightVolunteer);
      });
    }

    return [...filteredVolunteers].sort(compareByName);
  }, [filteredVolunteers, getVolunteerAssignedRoles, volunteerSortMode]);

  const supportVolunteers = filteredVolunteers.filter(
    (volunteer) =>
      volunteer.supportAvailability &&
      volunteer.supportAvailability !== "Pas d'aide complémentaire indiquée",
  );
  const filteredVolunteerAlertEntries = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return volunteerAlertEntries.filter((entry) => {
      if (!normalizedSearch) return true;
      const haystack = [
        entry.volunteerName,
        entry.volunteerEmail,
        ...(entry.previousRoles || []),
        ...Object.values(entry.previousTeamRoleAssignments || {}),
        entry.reason,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(normalizedSearch);
    });
  }, [search, volunteerAlertEntries]);

  const effectiveSelectedVolunteerId =
    selectedVolunteerId && volunteers.some((volunteer) => volunteer.id === selectedVolunteerId)
      ? selectedVolunteerId
      : null;
  const selectedVolunteer =
    volunteers.find((volunteer) => volunteer.id === effectiveSelectedVolunteerId) ?? null;
  const visibleMeetingVolunteers = getVisibleListItems("meeting-volunteers", meetingVolunteers);
  const visibleCompactAssignmentGroups = getVisibleListItems("compact-assignment-groups", compactAssignmentGroups);
  const visibleVolunteerAlertEntries = getVisibleListItems("volunteer-alerts", filteredVolunteerAlertEntries);
  const visibleSupportVolunteers = getVisibleListItems("support-volunteers", supportVolunteers);

  async function persistVolunteerPatch(id, patch) {
    const volunteer = volunteers.find((entry) => entry.id === id);
    const nextVolunteer = volunteer ? buildNextVolunteerState(volunteer, patch) : null;

    setVolunteers((current) =>
      current.map((volunteer) => (volunteer.id === id ? { ...volunteer, ...patch } : volunteer)),
    );

    try {
      await updateDoc(doc(db, "volunteerApplications", id), {
        ...patch,
        updatedAt: serverTimestamp(),
      });
      return nextVolunteer;
    } catch (error) {
      console.error("Impossible de mettre à jour la candidature bénévole.", error);
      throw error;
    }
  }

  async function syncVolunteerInternalAssignmentState(nextVolunteer, options = {}) {
    if (!nextVolunteer) return;

    try {
      await Promise.all([
        syncVolunteerAssignmentsToTeamConfiguration(nextVolunteer),
        syncVolunteerAssignmentToUserProfile(nextVolunteer),
      ]);
    } catch (error) {
      console.error("Impossible de synchroniser l'affectation interne du bénévole.", error);
      setVolunteerErrorStatus(
        options.message ||
          "L'affectation a bien ete enregistree, mais la synchronisation interne complementaire a echoue.",
        getActionErrorDetail(error),
      );
    }
  }

  async function persistVolunteerPatchAndSync(id, patch, options = {}) {
    try {
      const nextVolunteer = await persistVolunteerPatch(id, patch);
      await syncVolunteerInternalAssignmentState(nextVolunteer, options);
      return nextVolunteer;
    } catch (error) {
      setVolunteerErrorStatus(
        options.persistenceErrorMessage || "La mise a jour du benevole a echoue.",
        getActionErrorDetail(error),
      );
      return null;
    }
  }

  async function persistVolunteerPatchWithAlertsAndSync(id, patch, options = {}) {
    try {
      await persistVolunteerPatchWithAlerts(id, patch, options);
      const volunteer = volunteers.find((entry) => entry.id === id);
      const nextVolunteer = volunteer ? buildNextVolunteerState(volunteer, patch) : null;
      await syncVolunteerInternalAssignmentState(nextVolunteer, options);
      return nextVolunteer;
    } catch (error) {
      setVolunteerErrorStatus(
        options.persistenceErrorMessage || "La mise a jour du benevole a echoue.",
        getActionErrorDetail(error),
      );
      return null;
    }
  }

  function getStatusLabel(status) {
    switch (status) {
      case "Candidature reçue":
        return t("statusReceived");
      case "Affecté":
        return t("statusAssigned");
      case "Informé":
        return t("statusInformed");
      case "Confirmé":
        return t("statusConfirmed");
      case "Annulé":
        return t("statusCancelled");
      default:
        return status;
    }
  }

  function formatVolunteerTimestamp(value) {
    if (!value) return null;
    const date = typeof value?.toDate === "function" ? value.toDate() : new Date(value);
    return Number.isNaN(date.getTime())
      ? null
      : date.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
  }

  function formatVolunteerRequestAge(value) {
    if (!value) return null;
    const date = typeof value?.toDate === "function" ? value.toDate() : new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    const startOfDay = (input) => new Date(input.getFullYear(), input.getMonth(), input.getDate()).getTime();
    const days = Math.round((startOfDay(new Date()) - startOfDay(date)) / 86400000);
    return days <= 0 ? t("requestedTodayLabel") : t("requestedDaysAgoLabel").replace("{count}", days);
  }

  function getVolunteerStatusHistoryTitle(volunteer) {
    const lines = [t("statusBadgeTooltip")];
    if (volunteer.firstAssignedRole) {
      lines.push(t("initialAssignmentLabel").replace("{role}", volunteer.firstAssignedRole));
    }
    const lastMailSentAt = formatVolunteerTimestamp(volunteer.lastMailSentAt);
    if (lastMailSentAt) {
      lines.push(
        t("lastMailSentLabel").replace("{date}", lastMailSentAt).replace("{role}", volunteer.lastMailSentRole || "-"),
      );
    }
    return lines.join("\n");
  }

  async function updateVolunteerStatus(id, nextStatus) {
    clearVolunteerActionStatus();
    const volunteer = volunteers.find((entry) => entry.id === id);
    if (!volunteer) return;

    if (nextStatus === "Annulé" || nextStatus === "Candidature reçue") {
      await persistVolunteerPatchWithAlertsAndSync(id, {
        workflowStatus: nextStatus,
        assignedRole: "",
        assignedRoles: [],
        teamRole: "Bénévole",
        teamRoleAssignments: {},
      }, {
        alertReason:
          nextStatus === "Annulé"
            ? "Bénévole marqué comme désisté / annulé."
            : "Bénévole repassé sans affectation active.",
        message:
          "Le statut a bien ete mis a jour, mais la synchronisation interne complete a echoue.",
        persistenceErrorMessage: "Impossible de mettre a jour le statut du benevole.",
      });
      return;
    }

    if (nextStatus === "Affecté") {
      await persistVolunteerPatchAndSync(id, { workflowStatus: nextStatus, teamEmailSent: false }, {
        message:
          "Le statut a bien ete mis a jour, mais la synchronisation interne complete a echoue.",
        persistenceErrorMessage: "Impossible de mettre a jour le statut du benevole.",
      });
      return;
    }

    await persistVolunteerPatchAndSync(id, { workflowStatus: nextStatus }, {
      message:
        "Le statut a bien ete mis a jour, mais la synchronisation interne complete a echoue.",
      persistenceErrorMessage: "Impossible de mettre a jour le statut du benevole.",
    });
  }

  function updateSupportTask(id, slot, task) {
    const volunteer = volunteers.find((entry) => entry.id === id);
    if (!volunteer) return;

    persistVolunteerPatch(id, {
      supportTasks: {
        ...(volunteer.supportTasks ?? {}),
        [slot]: task,
      },
    });
  }

  return (
    <div className="page">
      <section className="page-header">
        <div>
          <p className="eyebrow">Admin</p>
          <h1>{t("adminVolPageTitle")}</h1>
          <p>{t("adminVolPageSubtitle")}</p>
        </div>
      </section>
      {volunteerApplicationsError ? <p className="status-note status-note--error">{volunteerApplicationsError}</p> : null}
      {volunteerAlertLogError ? <p className="status-note status-note--error">{volunteerAlertLogError}</p> : null}
      {volunteerApplicationsLoading ? <p className="status-note">Chargement des candidatures bénévoles...</p> : null}
      {volunteerAlertLogLoading ? <p className="status-note">Chargement des alertes bénévoles...</p> : null}
      {volunteerActionStatus ? (
        <div className={`status-note ${volunteerActionStatus.tone === "error" ? "status-note--error" : "status-note--success"}`}>
          <strong>{volunteerActionStatus.message}</strong>
          {volunteerActionStatus.detail ? <div className="status-note__detail">{volunteerActionStatus.detail}</div> : null}
        </div>
      ) : null}

      {/* Légende compacte : le détail de chaque statut est en infobulle. */}
      <div className="status-legend-compact">
        <span className={getWorkflowStatusClass("Candidature reçue")} title={t("statusReceivedDesc")}>{t("statusReceived")}</span>
        <span className={getWorkflowStatusClass("Affecté")} title={t("statusAssignedDesc")}>{t("statusAssigned")}</span>
        <span className={getWorkflowStatusClass("Informé")} title={t("statusInformedDesc")}>{t("statusInformed")}</span>
        <span className={getWorkflowStatusClass("Confirmé")} title={t("statusConfirmedDesc")}>{t("statusConfirmed")}</span>
        <span className={getWorkflowStatusClass("Annulé")} title={t("statusCancelledDesc")}>{t("statusCancelledLabel")}</span>
      </div>

      <Panel
        title={
          activeVolunteerView === "meeting"
            ? t("tabMeetingVolunteers")
            : activeVolunteerView === "assigned-posts"
              ? t("panelTitleAllAssignedPosts")
              : activeVolunteerView === "alerts"
                ? t("panelTitleAlerts")
              : t("tabMeetingSupport")
        }
        subtitle={
          activeVolunteerView === "meeting"
            ? t("meetingViewSubtitle")
            : activeVolunteerView === "assigned-posts"
              ? t("panelSubtitleAssignedPosts")
              : activeVolunteerView === "alerts"
                ? t("panelSubtitleAlerts")
              : t("panelSubtitleSupport")
        }
      >
        <div className="admin-subtabs" style={view ? { display: "none" } : undefined}>
          <button
            className={`admin-subtab ${activeVolunteerView === "meeting" ? "admin-subtab--active" : ""}`}
            type="button"
            onClick={() => setActiveVolunteerView("meeting")}
          >
            {t("tabMeetingVolunteers")} ({filteredVolunteers.length})
          </button>
          <button
            className={`admin-subtab ${activeVolunteerView === "assigned-posts" ? "admin-subtab--active" : ""}`}
            type="button"
            onClick={() => setActiveVolunteerView("assigned-posts")}
          >
            {t("tabAssignedPosts")} (
            {compactAssignmentGroups.reduce((total, group) => total + group.members.length, 0)})
          </button>
          <button
            className={`admin-subtab ${activeVolunteerView === "support" ? "admin-subtab--active" : ""}`}
            type="button"
            onClick={() => setActiveVolunteerView("support")}
          >
            {t("tabMeetingSupport")} ({supportVolunteers.length})
          </button>
          <button
            className={`admin-subtab ${activeVolunteerView === "alerts" ? "admin-subtab--active" : ""}`}
            type="button"
            onClick={() => setActiveVolunteerView("alerts")}
          >
            {t("tabAlerts")} ({filteredVolunteerAlertEntries.length})
          </button>
        </div>

        <div className="admin-toolbar admin-toolbar--compact">
          <label className="field">
            <span>{t("searchLabel")}</span>
            <input
              placeholder={t("searchPlaceholder")}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <label className="field">
            <span>{t("statusFilterLabel")}</span>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="Tous">{t("allLabel")}</option>
              {volunteerWorkflowStatusOptions.map((option) => (
                <option key={option} value={option}>{getStatusLabel(option)}</option>
              ))}
            </select>
          </label>
          {activeVolunteerView === "meeting" ? (
            <>
              <label className="field">
                <span>{t("teamFilterLabel")}</span>
                <select value={teamFilter} onChange={(event) => setTeamFilter(event.target.value)}>
                  <option value="Tous">{t("allLabel")}</option>
                  <option value="__none__">{t("noTeamOption")}</option>
                  {compactRoleOptions.map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>{t("languageFilterLabel")}</span>
                <select value={languageFilter} onChange={(event) => setLanguageFilter(event.target.value)}>
                  <option value="Tous">{t("allLabel")}</option>
                  {languageOptions.map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>{t("preferenceFilterLabel")}</span>
                <select value={preferenceFilter} onChange={(event) => setPreferenceFilter(event.target.value)}>
                  <option value="Tous">{t("allLabel")}</option>
                  {preferenceOptions.map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>{t("sortModeLabel")}</span>
                <select value={volunteerSortMode} onChange={(event) => setVolunteerSortMode(event.target.value)}>
                  <option value="alphabetical">{t("sortAlphabetical")}</option>
                  <option value="team">{t("sortByTeam")}</option>
                </select>
              </label>
              <span className="sheet-toolbar-count">
                {t("sheetVolunteerCount")
                  .replace("{count}", filteredVolunteers.length)
                  .replace("{total}", volunteers.length)}
                {hasSheetFilters ? (
                  <button className="sheet-link" type="button" onClick={resetSheetFilters}>
                    {t("resetFilters")}
                  </button>
                ) : null}
              </span>
              <NavLink className="sheet-toolbar-link" to="/app/equipes/affectations">
                {t("editInAssignments")}
              </NavLink>
            </>
          ) : null}
          {activeVolunteerView === "assigned-posts" ? (
            <>
              <label className="field">
                <span>Poste attribué</span>
                <select value={assignedRoleFilter} onChange={(event) => setAssignedRoleFilter(event.target.value)}>
                  <option>Tous</option>
                  {compactRoleOptions.map((option) => (
                    <option key={option}>{option}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Rôle dans l'équipe</span>
                <select value={teamRoleFilter} onChange={(event) => setTeamRoleFilter(event.target.value)}>
                  <option>Tous</option>
                  {compactTeamRoleOptions.map((option) => (
                    <option key={option}>{option}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Mail équipe</span>
                <select value={mailFilter} onChange={(event) => setMailFilter(event.target.value)}>
                  <option>Tous</option>
                  <option>À informer</option>
                  <option>Informés</option>
                </select>
              </label>
            </>
          ) : null}
        </div>

        {selectedVolunteer ? (
          <div className="volunteer-detail-card">
            <div className="volunteer-detail-card__head">
              <h3>
                {selectedVolunteer.firstName} {selectedVolunteer.lastName} ({selectedVolunteer.age} {t("ageUnit")})
              </h3>
              <span className={getWorkflowStatusClass(selectedVolunteer.workflowStatus)}>
                {getStatusLabel(selectedVolunteer.workflowStatus)}
              </span>
              <button
                className="button button--secondary button--small"
                type="button"
                onClick={() => setSelectedVolunteerId(null)}
              >
                {t("volunteerDetailClose")}
              </button>
            </div>

            <div className="volunteer-detail-grid">
              <div>
                <strong>{t("volunteerDetailContact")}</strong>
                <p>{selectedVolunteer.email} · {selectedVolunteer.phone}</p>
              </div>
              <div>
                <strong>{t("volunteerDetailLanguages")}</strong>
                <p>{selectedVolunteer.languages.join(", ")}</p>
              </div>
              <div>
                <strong>{t("volunteerDetailMeetingRole")}</strong>
                <p>
                  {getVolunteerAssignedRoles(selectedVolunteer)
                    .map(
                      (assignedRole) =>
                        `${assignedRole} (${getVolunteerTeamRoleForAssignedRole(selectedVolunteer, assignedRole)})`,
                    )
                    .join(", ") || t("volunteerNotAssigned")}
                </p>
              </div>
              <div>
                <strong>{t("volunteerDetailSunday")}</strong>
                <p>{selectedVolunteer.sundayAvailability}</p>
              </div>
              <div>
                <strong>{t("volunteerDetailSupport")}</strong>
                <p>{selectedVolunteer.supportAvailability}</p>
              </div>
            </div>
          </div>
        ) : null}

        {activeVolunteerView === "meeting" ? (
          <div className="section-stack">
            <div className="table-wrap table-wrap--sheet">
              <table className="data-table data-table--sheet">
                <thead>
                  <tr>
                    <th>{t("colVolunteer")}</th>
                    <th>{t("colRequestDate")}</th>
                    <th>{t("colEmail")}</th>
                    <th>{t("colPhone")}</th>
                    <th>{t("colLanguages")}</th>
                    <th>{t("colStatus")}</th>
                    <th>{t("colTeams")}</th>
                    <th>{t("colPreferences")}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {visibleMeetingVolunteers.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="table-empty-state">
                        {t("emptyMeetingVolunteers")}
                      </td>
                    </tr>
                  ) : null}
                  {visibleMeetingVolunteers.map((volunteer, index) => {
                    const primaryRole = getVolunteerAssignedRoles(volunteer)[0] || "";
                    const previousVolunteer = visibleMeetingVolunteers[index - 1];
                    const previousRole = previousVolunteer ? getVolunteerAssignedRoles(previousVolunteer)[0] || "" : null;
                    const showGroupDivider = volunteerSortMode === "team" && primaryRole !== previousRole;
                    return (
                    <Fragment key={volunteer.id}>
                      {showGroupDivider ? (
                        <tr className="table-group-row">
                          <td colSpan={9}>
                            <strong>{primaryRole || t("unassignedGroupLabel")}</strong>
                          </td>
                        </tr>
                      ) : null}
                      <tr>
                        <td className="sheet-name">
                          <button className="sheet-link" type="button" onClick={() => setSelectedVolunteerId(volunteer.id)}>
                            {volunteer.lastName} {volunteer.firstName}
                          </button>
                          {Number.isFinite(volunteer.age) ? <span className="sheet-muted"> {volunteer.age}</span> : null}
                        </td>
                        <td className="sheet-nowrap" title={formatVolunteerTimestamp(volunteer.submittedAt) || undefined}>
                          {formatVolunteerRequestAge(volunteer.submittedAt) || <span className="sheet-muted">—</span>}
                        </td>
                        <td className="sheet-ellipsis" title={volunteer.email}>{volunteer.email}</td>
                        <td className="sheet-nowrap">{volunteer.phone}</td>
                        <td className="sheet-nowrap" title={volunteer.languages.join(", ")}>
                          {volunteer.languages.map(getLanguageCode).join(" ")}
                        </td>
                        <td className="sheet-nowrap">
                          <span
                            className={`sheet-status ${getWorkflowStatusClass(volunteer.workflowStatus)}`}
                            title={getVolunteerStatusHistoryTitle(volunteer)}
                          >
                            {getStatusLabel(volunteer.workflowStatus)}
                          </span>
                        </td>
                        <td className="sheet-ellipsis">
                          {getVolunteerAssignedRoles(volunteer).length === 0 ? (
                            <span className="sheet-muted">—</span>
                          ) : (
                            getVolunteerAssignedRoles(volunteer).map((assignedRole, roleIndex) => (
                              <Fragment key={`${volunteer.id}-${assignedRole}`}>
                                {roleIndex > 0 ? ", " : ""}
                                {assignedRole}
                                <span className="sheet-muted"> ({getVolunteerTeamRoleForAssignedRole(volunteer, assignedRole)})</span>
                              </Fragment>
                            ))
                          )}
                        </td>
                        <td className="sheet-ellipsis sheet-muted" title={volunteer.missionPreferences.join(", ")}>
                          {volunteer.missionPreferences.join(", ")}
                        </td>
                        <td className="sheet-nowrap sheet-actions">
                          {volunteer.workflowStatus === "Annulé" ? (
                            <button type="button" onClick={() => updateVolunteerStatus(volunteer.id, "Candidature reçue")}>
                              {t("reactivateShort")}
                            </button>
                          ) : (
                            <>
                              {volunteer.workflowStatus === "Affecté" || volunteer.workflowStatus === "Informé" ? (
                                <button type="button" onClick={() => updateVolunteerStatus(volunteer.id, "Confirmé")}>
                                  {t("confirmAction")}
                                </button>
                              ) : null}
                              <button
                                className="sheet-actions__danger"
                                type="button"
                                onClick={() => updateVolunteerStatus(volunteer.id, "Annulé")}
                              >
                                {t("cancelShort")}
                              </button>
                            </>
                          )}
                        </td>
                      </tr>
                    </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {canShowMoreListItems("meeting-volunteers", meetingVolunteers) ? (
              <div className="list-progressive-actions">
                <button
                  className="button button--secondary button--small"
                  type="button"
                  onClick={() => showMoreListItems("meeting-volunteers")}
                >
                  {t("showMoreButton")}
                </button>
              </div>
            ) : null}
          </div>
        ) : activeVolunteerView === "assigned-posts" ? (
          <div className="section-stack">
            <div className="section-intro">
              <h3>Vue compacte des affectations</h3>
              <p>
                Chaque bloc correspond à un rôle avec le besoin, le nombre déjà attribué et le
                manque restant, puis les bénévoles affectés triés par nom de famille.
              </p>
            </div>

            <div className="table-wrap table-wrap--compact">
              <table className="data-table data-table--admin data-table--compact">
                <thead>
                  <tr>
                    <th>Rôle / Bénévole</th>
                    <th>Besoin</th>
                    <th>Attribués</th>
                    <th>Manque</th>
                    <th>Poste</th>
                    <th>Rôle équipe</th>
                    <th>Statut</th>
                    <th>Mail</th>
                    <th>Dimanche</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleCompactAssignmentGroups.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="table-empty-state">
                        Aucun poste à afficher pour le moment.
                      </td>
                    </tr>
                  ) : null}
                  {visibleCompactAssignmentGroups.map((group) => (
                    <Fragment key={group.roleName}>
                      <tr className="compact-group-row">
                        <td>
                          <strong>{group.roleName}</strong>
                        </td>
                        <td>{group.neededCount}</td>
                        <td>{group.assignedCount}</td>
                        <td>{group.missingCount}</td>
                        <td colSpan={5}>
                          {group.missingCount > 0
                            ? `${group.missingCount} personne(s) encore à trouver`
                            : "Équipe complète"}
                        </td>
                      </tr>
                      {group.members.map((volunteer) => (
                        <tr key={`${group.roleName}-${volunteer.id}`}>
                          <td>
                            <div className="compact-volunteer-cell">
                              <button
                                className="name-link-button"
                                type="button"
                                onClick={() => setSelectedVolunteerId(volunteer.id)}
                              >
                                {volunteer.lastName} {volunteer.firstName}
                              </button>
                              <span>{volunteer.age} ans</span>
                            </div>
                          </td>
                          <td />
                          <td />
                          <td />
                          <td>{group.roleName}</td>
                          <td>{getVolunteerTeamRoleForAssignedRole(volunteer, group.roleName)}</td>
                          <td>{volunteer.workflowStatus}</td>
                          <td>{volunteer.teamEmailSent ? "Informé" : "À informer"}</td>
                          <td>{volunteer.sundayAvailability}</td>
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
            {canShowMoreListItems("compact-assignment-groups", compactAssignmentGroups) ? (
              <div className="list-progressive-actions">
                <button
                  className="button button--secondary button--small"
                  type="button"
                  onClick={() => showMoreListItems("compact-assignment-groups")}
                >
                  {t("showMoreButton")}
                </button>
              </div>
            ) : null}
          </div>
        ) : activeVolunteerView === "alerts" ? (
          <div className="section-stack">
            <div className="section-intro">
              <h3>Historique des retraits et désistements</h3>
              <p>
                Chaque entrée conserve l'affectation initiale au moment du retrait pour permettre aux
                gestionnaires de suivre les postes à remplacer et les badges potentiellement déjà imprimés.
              </p>
            </div>

            <div className="table-wrap">
              <table className="data-table data-table--admin">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Bénévole</th>
                    <th>Postes initiaux</th>
                    <th>Rôles équipe</th>
                    <th>Statut avant retrait</th>
                    <th>Type d'alerte</th>
                    <th>Motif</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleVolunteerAlertEntries.map((entry) => (
                    <tr key={entry.id}>
                      <td>{entry.createdAt ? new Date(entry.createdAt).toLocaleString("fr-FR") : "-"}</td>
                      <td>
                        <div className="table-stack">
                          <strong>{entry.volunteerName || "-"}</strong>
                          <span>{entry.volunteerEmail || "Sans e-mail"}</span>
                        </div>
                      </td>
                      <td>{entry.previousRoles.join(", ") || "Aucun poste"}</td>
                      <td>
                        {Object.entries(entry.previousTeamRoleAssignments || {})
                          .map(([roleName, teamRole]) => `${roleName}: ${teamRole}`)
                          .join(", ") || "Aucun"}
                      </td>
                      <td>
                        <span className={getWorkflowStatusClass(entry.previousWorkflowStatus)}>
                          {entry.previousWorkflowStatus || "Inconnu"}
                        </span>
                      </td>
                      <td>{entry.alertType === "withdrawal" ? "Désistement / annulation" : "Retrait d'affectation"}</td>
                      <td>{entry.reason || "—"}</td>
                    </tr>
                  ))}
                  {!filteredVolunteerAlertEntries.length ? (
                    <tr>
                      <td colSpan="7" className="table-empty-state">Aucune alerte d'affectation enregistrée pour le moment.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            {canShowMoreListItems("volunteer-alerts", filteredVolunteerAlertEntries) ? (
              <div className="list-progressive-actions">
                <button
                  className="button button--secondary button--small"
                  type="button"
                  onClick={() => showMoreListItems("volunteer-alerts")}
                >
                  {t("showMoreButton")}
                </button>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="section-stack">
            <div className="section-intro">
              <h3>Bénévoles disponibles autour du meeting</h3>
              <p>
                Cette vue regroupe les disponibilités complémentaires avant et après le meeting. Une
                même personne peut être disponible sur plusieurs créneaux.
              </p>
            </div>

            <div className="table-wrap">
              <table className="data-table data-table--admin">
                <thead>
                  <tr>
                    <th>Bénévole</th>
                    <th>Coordonnées</th>
                    <th>Langues</th>
                    <th>Statut</th>
                    <th>Rôle meeting</th>
                    <th>Disponibilités complémentaires</th>
                    <th>Tâches par disponibilité</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleSupportVolunteers.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="table-empty-state">
                        Aucun bénévole disponible autour du meeting pour le moment.
                      </td>
                    </tr>
                  ) : null}
                  {visibleSupportVolunteers.map((volunteer) => (
                    <tr key={volunteer.id}>
                      <td>
                        <div className="table-stack">
                          <button
                            className="name-link-button"
                            type="button"
                            onClick={() => setSelectedVolunteerId(volunteer.id)}
                          >
                            {volunteer.firstName} {volunteer.lastName} ({volunteer.age} {t("ageUnit")})
                          </button>
                          <span className={getWorkflowStatusClass(volunteer.workflowStatus)}>
                            {volunteer.workflowStatus}
                          </span>
                        </div>
                      </td>
                      <td>
                        <div className="table-stack">
                          <span>{volunteer.email}</span>
                          <span>{volunteer.phone}</span>
                        </div>
                      </td>
                      <td>{volunteer.languages.join(", ")}</td>
                      <td>{volunteer.workflowStatus}</td>
                      <td>{volunteer.assignedRole || "Non attribué"}</td>
                      <td>
                        <div className="support-slot-list">
                          {volunteer.supportAvailability.split(",").map((slot) => (
                            <span key={`${volunteer.id}-${slot.trim()}`} className="support-slot-tag">
                              {slot.trim()}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td>
                        <div className="support-task-grid">
                          {volunteer.supportAvailability.split(",").map((slot) => {
                            const normalizedSlot = slot.trim();

                            return (
                              <label key={`${volunteer.id}-task-${normalizedSlot}`} className="support-task-row">
                                <span>{normalizedSlot}</span>
                                <select
                                  value={volunteer.supportTasks?.[normalizedSlot] ?? ""}
                                  onChange={(event) =>
                                    updateSupportTask(volunteer.id, normalizedSlot, event.target.value)
                                  }
                                >
                                  <option value="">Choisir une tâche</option>
                                  {supportTaskOptions.map((option) => (
                                    <option key={option}>{option}</option>
                                  ))}
                                </select>
                              </label>
                            );
                          })}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {canShowMoreListItems("support-volunteers", supportVolunteers) ? (
              <div className="list-progressive-actions">
                <button
                  className="button button--secondary button--small"
                  type="button"
                  onClick={() => showMoreListItems("support-volunteers")}
                >
                  {t("showMoreButton")}
                </button>
              </div>
            ) : null}
          </div>
        )}
      </Panel>
    </div>
  );
}

export { VolunteersPage };
