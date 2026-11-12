import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { addDoc, collection, doc, onSnapshot, query, serverTimestamp, setDoc, updateDoc, where } from "firebase/firestore";
import { useLocation, useNavigate } from "react-router-dom";
import QRCode from "qrcode";
import {
  buildAccreditationPrintHistoryMarkup,
  buildAccreditationRoleLabel,
  buildAccreditationUsers,
  formatZoneLabel,
  getAccreditationFinalZoneIds,
  getBadgeRoleLabel,
  getConfirmedAccreditationRoleNames,
  sortAccreditationZones,
  toggleIdInList,
} from "./accreditation-helpers";
import {
  ACCREDITATION_BADGE_VISUALS,
  ACCREDITATION_PRINT_STATUS_OPTIONS,
  BADGE_CATEGORIES,
  BADGE_STORAGE_LOCATIONS,
  DEFAULT_ROLE_BADGE_CATEGORY,
  QR_LINK_SOURCES,
} from "./accreditation-config";
import { buildAccreditationBadgeMarkup } from "./badge-print";
import { getDocumentUploadErrorMessage } from "./common-helpers";
import { getDocumentReferenceUrl, useDocumentsCollection } from "./documents-hooks";
import { FileUpload } from "./file-upload";
import { JUDGE_ROSTER_DOC_PATH } from "./seed-data";
import { getActiveRoles } from "./navigation";
import { useAccreditationConfiguration, useJudgeRoster, useTeamConfiguration } from "./config-hooks";
import { normalizeComparableValue } from "./u14-helpers";
import { enterQueue } from "./accreditation-queue";
import { REASON_LABELS, STEP_LABELS, canPrintStep, countSteps, getBadgeStep } from "./accreditation-steps";
import { nationalBadgeKey, toggleZone } from "./extra-badge-types";
import { getNationalRaceDefinition, isNationalRacePacer, NATIONAL_RACE_REQUESTS_COLLECTION } from "./national-races-helpers";
import { recordMatchesEdition } from "./edition";
import { useAuth } from "../context/auth-context";
import { useActiveEdition } from "./edition";
import { useMeetingEditions } from "./meeting-history-hooks";
import { useLinksPageSettings } from "../site/site-hooks";
import { PUBLIC_SITE_URL } from "./qr-link-sources";
import { buildVipBadgeItems, buildVipBadgePrintMarkup } from "./vip-badge-print";
import { getVipRegistrationDocRef, useVipRegistrations } from "./vip-registrations-hooks";
import { db } from "../services/firebase";
import { CoquePlanEditor } from "./coque-plan/coque-plan-editor";
import { EntrancePlanEditor } from "./coque-plan/entrance-plan-editor";
import { JudgesPlanEditor } from "./coque-plan/coque-judges-plan-editor";
import { AccreditationCheckpoints } from "./accreditation-checkpoints";
import { AccreditationDesk } from "./accreditation-desk";
import { saveCoquePlan, useCoquePlan } from "./coque-plan/coque-plan-hooks";
import { getZonePlacement, syncPlanZones } from "./coque-plan/plan-zone-sync";
import { useTr } from "./use-tr";

const DEFAULT_LIST_PAGE_SIZE = 10;
const AUTO_CANCEL_MESSAGE = "Cette accréditation a été annulée car le bénévole n'est plus affecté.";
const AUTO_DESTROY_MESSAGE = "Attention : ce bénévole n'est plus affecté. Badge imprimé à récupérer ou détruire.";
// Les 3 étapes d'un badge (+ À traiter), qui servent aussi de filtres
// (accreditation-steps.js ; maquette design/accreditation/maquette-simple.html).
const PEOPLE_FILTERS = [
  { id: "todo", label: STEP_LABELS.todo.fr, labelEn: STEP_LABELS.todo.en },
  { id: "done", label: "Imprimés", labelEn: "Printed" },
  { id: "given", label: STEP_LABELS.given.fr, labelEn: STEP_LABELS.given.en },
  { id: "attn", label: STEP_LABELS.attn.fr, labelEn: STEP_LABELS.attn.en },
  { id: "all", label: "Tous", labelEn: "All" },
];
const STEP_PILL_CLASS = { todo: "acc-step acc-step--todo", done: "acc-step acc-step--done", given: "acc-step acc-step--given", attn: "acc-step acc-step--attn" };
const PRESS_REQUEST_TYPE_LABELS = { press: "Presse", photographer: "Photographe" };
// Affichage seulement (le libellé français reste celui imprimé / enregistré).
const PRESS_REQUEST_TYPE_LABELS_EN = { press: "Press", photographer: "Photographer" };
// Libellés anglais des visuels de badge et des liens QR (accreditation-config.js et
// qr-link-sources.js n'ont que le français) : affichage seulement.
const BADGE_VISUAL_EN = {
  volunteer: { label: "Named volunteer", description: "Named badge for assigned volunteers." },
  athlete: { label: "Athlete without name", description: "Batch of Athlete badges without names." },
  coach: { label: "Coach without name", description: "Batch of Coach badges without names." },
  judge: { label: "Named judge", description: "Named badge for judges." },
  press: { label: "Named press", description: "Named badge for accredited press (journalists, photographers)." },
  vip: { label: "Named VIP", description: "Named badge for VIP guests, same zones as other badges but its own design." },
};
// Messages d'alerte enregistrés en français dans volunteerOverrides : traduits à l'affichage.
const WARNING_MESSAGE_EN = {
  [AUTO_CANCEL_MESSAGE]: "This badge was cancelled because the volunteer is no longer assigned.",
  [AUTO_DESTROY_MESSAGE]: "Warning: this volunteer is no longer assigned. Printed badge to collect or destroy.",
  "Attention modification : le contenu de cette accréditation a changé depuis la dernière impression.":
    "Change warning: this badge's content changed since it was last printed.",
  "Attention modification : les rôles, zones ou le libellé badge ont changé depuis la dernière impression.":
    "Change warning: the roles, zones or badge label changed since it was last printed.",
};
const QR_LINK_SOURCES_EN = {
  results: { label: "Live results", where: "Website › Edition › Live results" },
  photos: { label: "Meeting-day photos", where: "Website › Links page › Photos" },
  emagazine: { label: "E-magazine", where: "public page /e-magazine" },
  athleteRoadbook: { label: "Athlete roadbook", where: "public page /roadbook" },
  links: { label: "Links page", where: "public page /links" },
};
const ACCREDITATION_TAB_PATHS = {
  people: "/app/accreditations",
  desk: "/app/accreditations/guichet",
  history: "/app/accreditations/historique",
  plans: "/app/accreditations/plans",
  entrance: "/app/accreditations/plan-entree",
  judgesPlan: "/app/accreditations/plan-juges",
  controls: "/app/accreditations/controles",
  settings: "/app/accreditations/reglages",
};

function getAccreditationTabFromPath(pathname, availableTabs) {
  const normalizedPath = String(pathname || "").replace(/\/+$/, "") || "/app/accreditations";

  // Zones par rôle et ressources QR sont réunies dans un seul onglet Réglages.
  if (normalizedPath.endsWith("/reglages") && availableTabs.includes("settings")) return "settings";
  if (normalizedPath.endsWith("/ressources-qr") && availableTabs.includes("settings")) return "settings";
  if (normalizedPath.endsWith("/guichet") && availableTabs.includes("desk")) return "desk";
  // Avant la simplification (12/11/2026) : Impression → Badges, Retrait & suivi → Guichet.
  if (normalizedPath.endsWith("/impressions") && availableTabs.includes("people")) return "people";
  if (normalizedPath.endsWith("/suivi") && availableTabs.includes("desk")) return "desk";
  if (normalizedPath.endsWith("/historique") && availableTabs.includes("history")) return "history";
  if (normalizedPath.endsWith("/plans") && availableTabs.includes("plans")) return "plans";
  if (normalizedPath.endsWith("/plan-entree") && availableTabs.includes("entrance")) return "entrance";
  if (normalizedPath.endsWith("/plan-juges") && availableTabs.includes("judgesPlan")) return "judgesPlan";
  if (normalizedPath.endsWith("/controles") && availableTabs.includes("controls")) return "controls";
  if (normalizedPath.endsWith("/roles") && availableTabs.includes("settings")) return "settings";
  // Legacy bookmarks/links from before the redesign (juges/presse/bénévoles
  // were merged into "people", the new default landing tab).
  if (normalizedPath.endsWith("/benevoles") && availableTabs.includes("people")) return "people";
  if (normalizedPath.endsWith("/juges") && availableTabs.includes("people")) return "people";
  if (normalizedPath.endsWith("/presse") && availableTabs.includes("people")) return "people";
  if (normalizedPath === "/app/accreditations" && availableTabs.includes("people")) return "people";

  return availableTabs[0] || "people";
}

const EMPTY_QR_RESOURCE_FORM = {
  label: "",
  subtitle: "",
  targetMode: "linked",
  documentId: "",
  url: "",
  source: "results",
  uploadedFileUrl: "",
  uploadedFileName: "",
  uploadedFilePath: "",
};

function AccreditationsPage(props) {
  const {
    ACCREDITATION_CONFIGURATION_DOC_PATH,
    AuthFormField,
    Panel,
    formatDateTimeForDisplay,
    normalizeSubRoles,
  } = props;
  const { userProfile } = useAuth();
  const tr = useTr();
  const getVisualLabel = (visual) => (visual ? tr(visual.label, BADGE_VISUAL_EN[visual.id]?.label || visual.label) : "");
  const getVisualDescription = (visual) =>
    visual ? tr(visual.description, BADGE_VISUAL_EN[visual.id]?.description || visual.description) : "";
  const getLinkSourceLabel = (item) => (item ? tr(item.label, QR_LINK_SOURCES_EN[item.key]?.label || item.label) : "");
  const getLinkSourceWhere = (item) => (item ? tr(item.where, QR_LINK_SOURCES_EN[item.key]?.where || item.where) : "");
  const location = useLocation();
  const navigate = useNavigate();
  const activeRoles = getActiveRoles(userProfile);
  const canManageAccreditationConfiguration = activeRoles.includes("admin");
  const canOperatePrinting = activeRoles.includes("admin") || activeRoles.includes("gestionnaire");
  const canManageJudges = activeRoles.includes("admin");
  const { roles, teamAssignments, loading: teamsLoading, error: teamsError } = useTeamConfiguration();
  const { judges, loading: judgesLoading, error: judgesError } = useJudgeRoster();
  // Plan de la Coque (onglet Plans) imprimé au verso des badges
  const coquePlan = useCoquePlan();
  const { activeEditionId, loading: editionLoading } = useActiveEdition(canOperatePrinting);
  // Liens repris pour les QR des badges : résultats (édition), photos (page liens).
  const { editions: meetingEditions } = useMeetingEditions();
  const currentEdition = meetingEditions.find((item) => String(item.year || item.id) === String(activeEditionId)) || null;
  const { settings: linksPage } = useLinksPageSettings();
  const { registrations: vipRegistrations, error: vipRegistrationsError } = useVipRegistrations(
    activeEditionId,
    canOperatePrinting && !editionLoading,
  );
  const [vipPrintError, setVipPrintError] = useState("");
  const {
    zones: storedZones,
    roleZoneAssignments: storedRoleZoneAssignments,
    roleBadgeCategories: storedRoleBadgeCategories,
    volunteerOverrides: storedVolunteerOverrides,
    printHistory: storedPrintHistory,
    badgeStorageLocations: storedBadgeStorageLocations,
    customStorageLocations: storedCustomStorageLocations,
    qrResources: storedQrResources,
    qrVisualAssignments: storedQrVisualAssignments,
    namelessBadgeTypes,
    nationalBadge,
    loading: accreditationLoading,
    error: accreditationError,
  } = useAccreditationConfiguration(roles);
  const {
    documents,
    loading: documentsLoading,
    error: documentsError,
  } = useDocumentsCollection(canManageAccreditationConfiguration);
  const [users, setUsers] = useState([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [accreditationStatus, setAccreditationStatus] = useState("");
  const [isSavingAccreditation, setIsSavingAccreditation] = useState(false);
  const [newZoneName, setNewZoneName] = useState("");
  const [newStorageLocationName, setNewStorageLocationName] = useState("");
  const [volunteerSearch, setVolunteerSearch] = useState("");
  const [peopleFilter, setPeopleFilter] = useState("todo");
  const [settingsSection, setSettingsSection] = useState("roles");
  // Courses nationales : athlètes retenus (badge nominatif).
  const [nationalAthletes, setNationalAthletes] = useState([]);
  // Badges cochés pour l'impression (plus de file : on coche, on imprime).
  const [printSelection, setPrintSelection] = useState(() => new Set());
  const [peopleType, setPeopleType] = useState("volunteers");
  const [isJudgeFormOpen, setIsJudgeFormOpen] = useState(false);
  const [editingJudgeZonesId, setEditingJudgeZonesId] = useState("");
  const [selectedNonNominativeTemplateId, setSelectedNonNominativeTemplateId] = useState(
    namelessBadgeTypes[0]?.id ?? "",
  );
  const [nonNominativeQuantity, setNonNominativeQuantity] = useState("1");
  const [newJudgeFirstName, setNewJudgeFirstName] = useState("");
  const [newJudgeLastName, setNewJudgeLastName] = useState("");
  const [newJudgeBadgeLabel, setNewJudgeBadgeLabel] = useState("Judge");
  const [newJudgeZoneIds, setNewJudgeZoneIds] = useState(["zone-judges", "zone-infield"]);
  const [, setStoragePickerOpenById] = useState({});
  const [printHistoryCommentOpenById, setPrintHistoryCommentOpenById] = useState({});
  const [printHistoryBatchOpenById, setPrintHistoryBatchOpenById] = useState({});
  const [selectedPrintHistoryBatchId, setSelectedPrintHistoryBatchId] = useState("");
  const [judgeSearch, setJudgeSearch] = useState("");
  const [pressRegistrations, setPressRegistrations] = useState([]);
  const [pressLoading, setPressLoading] = useState(true);
  const [pressError, setPressError] = useState("");
  const [pressSearch, setPressSearch] = useState("");
  const [roleSearch, setRoleSearch] = useState("");
  const [visibleListCountByKey, setVisibleListCountByKey] = useState({});
  const [selectedQrVisualId, setSelectedQrVisualId] = useState(ACCREDITATION_BADGE_VISUALS[0]?.id ?? "volunteer");
  const [editingQrResourceId, setEditingQrResourceId] = useState("");
  const [qrResourceForm, setQrResourceForm] = useState(EMPTY_QR_RESOURCE_FORM);
  const zones = Array.isArray(storedZones) ? storedZones : [];
  const roleZoneAssignments = storedRoleZoneAssignments && typeof storedRoleZoneAssignments === "object"
    ? storedRoleZoneAssignments
    : {};
  const roleBadgeCategories = storedRoleBadgeCategories && typeof storedRoleBadgeCategories === "object"
    ? storedRoleBadgeCategories
    : {};
  const volunteerOverrides = storedVolunteerOverrides && typeof storedVolunteerOverrides === "object"
    ? storedVolunteerOverrides
    : {};
  const printHistory = Array.isArray(storedPrintHistory) ? storedPrintHistory : [];
  const recentPrintHistoryBatches = printHistory
    .map((batch, index) => ({
      id: String(batch?.id || `safe-batch-${index + 1}`),
      printedAt: batch?.printedAt || null,
      generatedBy: String(batch?.generatedBy || "").trim(),
      items: Array.isArray(batch?.items) ? batch.items : [],
    }))
    .slice(0, 5);
  const effectiveSelectedPrintHistoryBatchId =
    selectedPrintHistoryBatchId && printHistory.some((batch) => batch.id === selectedPrintHistoryBatchId)
      ? selectedPrintHistoryBatchId
      : printHistory[0]?.id ?? "";
  const selectedPrintHistoryBatch =
    printHistory.find((batch) => batch.id === effectiveSelectedPrintHistoryBatchId) ?? printHistory[0] ?? null;
  const badgeStorageLocations = storedBadgeStorageLocations && typeof storedBadgeStorageLocations === "object"
    ? storedBadgeStorageLocations
    : {};
  const customStorageLocations = Array.isArray(storedCustomStorageLocations) ? storedCustomStorageLocations : [];
  const qrResources = Array.isArray(storedQrResources) ? storedQrResources : [];
  const qrVisualAssignments =
    storedQrVisualAssignments && typeof storedQrVisualAssignments === "object"
      ? storedQrVisualAssignments
      : {};
  const documentsById = useMemo(
    () => new Map(documents.map((documentItem) => [documentItem.id, documentItem])),
    [documents],
  );
  const sortedZones = useMemo(() => sortAccreditationZones(zones), [sortAccreditationZones, zones]);
  // Plan des badges : les zones portent le nom de la liste des zones (plan-zone-sync.js).
  const coquePlanElements = useMemo(() => syncPlanZones(coquePlan.elements, sortedZones), [coquePlan.elements, sortedZones]);
  const zonePlacement = useMemo(() => getZonePlacement(coquePlan.rawElements, sortedZones), [coquePlan.rawElements, sortedZones]);
  const volunteers = useMemo(
    () => buildAccreditationUsers(users, teamAssignments),
    [buildAccreditationUsers, teamAssignments, users],
  );
  const [selectedVolunteerId, setSelectedVolunteerId] = useState("");

  function volunteerHasPrintableAssignment(volunteer) {
    return normalizeSubRoles(volunteer?.assignedRoles || [volunteer?.assignedRole].filter(Boolean)).length > 0;
  }

  function volunteerHasPrintedBadgeEvidence(volunteerId) {
    const override = getVolunteerOverride(volunteerId);
    const snapshot = override?.printedSnapshot || {};

    if (override.destroyedAt) return false;

    return Boolean(
      override.lastPrintedAt ||
        override.printStatus === "Imprimé" ||
        override.printStatus === "Imprimé à détruire" ||
        snapshot.roleLabel ||
        snapshot.roleNames?.length ||
        snapshot.zoneIds?.length,
    );
  }

  function volunteerHasAccreditationHistory(volunteerId) {
    const override = getVolunteerOverride(volunteerId);
    const snapshot = override?.printedSnapshot || {};
    return Boolean(
      !override.destroyedAt && (
      override.badgeLabel ||
        override.printStatus === "Dans la file" ||
        override.printStatus === "Imprimé" ||
        override.printStatus === "Imprimé à détruire" ||
        override.warningMessage ||
        override.lastPrintedAt ||
        override.lastQueuedAt ||
        snapshot.roleLabel ||
        snapshot.roleNames?.length ||
        snapshot.zoneIds?.length
      ),
    );
  }

  function isVolunteerAccreditationInvalid(volunteer) {
    return !volunteerHasPrintableAssignment(volunteer);
  }

  function shouldDisplayVolunteerAccreditation(volunteer) {
    const override = getVolunteerOverride(volunteer.id);
    // Une personne réaffectée réapparaît toujours, même si son ancien badge a été détruit,
    // mais seulement une fois son affectation confirmée (Margot, 12/11/2026 : un badge
    // pour un poste pas encore confirmé n'a pas de sens).
    if (volunteerHasPrintableAssignment(volunteer) && getConfirmedAccreditationRoleNames(volunteer, normalizeComparableValue).length > 0) {
      return true;
    }
    // Plus affectée : on ne la garde que s'il reste un badge physique à récupérer / détruire.
    // Une accréditation annulée sans badge imprimé est traitée d'office et sort de la liste.
    if (override.destroyedAt) return false;
    return volunteerHasPrintedBadgeEvidence(volunteer.id);
  }

  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, "users"),
      (snapshot) => {
        setUsers(
          snapshot.docs.map((userSnapshot) => ({
            id: userSnapshot.id,
            ...userSnapshot.data(),
          })),
        );
        setUsersLoading(false);
      },
      () => {
        setUsers([]);
        setUsersLoading(false);
      },
    );

    return unsubscribe;
  }, []);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, "pressRegistrations"),
      (snapshot) => {
        setPressRegistrations(snapshot.docs.map((pressDoc) => ({ id: pressDoc.id, ...pressDoc.data() })));
        setPressLoading(false);
        setPressError("");
      },
      () => {
        setPressRegistrations([]);
        setPressLoading(false);
        setPressError("Impossible de charger les demandes presse.");
      },
    );

    return unsubscribe;
  }, []);

  // Messages traduits calculés au rendu (chaînes stables) pour les hooks plus bas.
  const saveFailedMessage = tr("La sauvegarde des accréditations a échoué.", "Saving the badge settings failed.");
  const autoStatusUpdatedMessage = tr(
    "Statuts d'accréditation mis à jour selon les affectations.",
    "Badge statuses updated from the assignments.",
  );
  const autoResetMessage = tr(
    "Certaines accréditations imprimées ont été repassées en non-imprimé après modification.",
    "Some printed badges were set back to not printed after a change.",
  );
  const persistAccreditationConfiguration = useCallback(
    async (nextConfiguration, successMessage) => {
      setIsSavingAccreditation(true);

      try {
        await setDoc(
          doc(db, ...ACCREDITATION_CONFIGURATION_DOC_PATH),
          {
            ...nextConfiguration,
            updatedAt: serverTimestamp(),
          },
          { merge: true },
        );
        setAccreditationStatus(successMessage);
      } catch (error) {
        console.error("Impossible de sauvegarder la configuration des accréditations.", error);
        setAccreditationStatus(saveFailedMessage);
      } finally {
        setIsSavingAccreditation(false);
      }
    },
    [ACCREDITATION_CONFIGURATION_DOC_PATH, saveFailedMessage],
  );

  // Catégorie du badge d'un bénévole : celle de son premier rôle qui n'est pas « Volunteer »
  // (Organisation, Technical…), sinon Volunteer. Réglée par rôle dans Réglages.
  function getVolunteerBadgeCategory(roleNames = []) {
    const categories = roleNames
      .map((roleName) => roles.find((role) => normalizeComparableValue(role.roleName) === normalizeComparableValue(roleName)))
      .filter(Boolean)
      .map((role) => roleBadgeCategories[role.id] || DEFAULT_ROLE_BADGE_CATEGORY);
    return categories.find((category) => category !== DEFAULT_ROLE_BADGE_CATEGORY) || DEFAULT_ROLE_BADGE_CATEGORY;
  }

  function setRoleBadgeCategory(roleId, category) {
    persistAccreditationConfiguration(
      buildCurrentConfiguration({ roleBadgeCategories: { ...roleBadgeCategories, [roleId]: category } }),
      tr("Catégorie du badge mise à jour.", "Badge category updated."),
    );
  }

  function getRoleZoneIds(roleId) {
    return roleZoneAssignments[roleId] ?? [];
  }

  function getRoleByName(roleName) {
    return roles.find(
      (role) => role.roleName.trim().toLowerCase() === String(roleName || "").trim().toLowerCase(),
    );
  }

  function getRoleZoneIdsByName(roleName) {
    return getRoleZoneIds(getRoleByName(roleName)?.id || "");
  }

  const getVolunteerOverride = useCallback(
    (volunteerId) =>
      volunteerOverrides[volunteerId] ?? {
        addZoneIds: [],
        removeZoneIds: [],
        printStatus: "Non-imprimé",
        badgeLabel: "",
        warningMessage: "",
        lastQueuedAt: null,
        lastPrintedAt: null,
        destroyedAt: null,
        printedSnapshot: { roleLabel: "", roleNames: [], zoneIds: [] },
      },
    [volunteerOverrides],
  );

  const getFinalZoneIds = useCallback(
    (volunteer) =>
      getAccreditationFinalZoneIds({
        assignedRoles: normalizeSubRoles(volunteer?.assignedRoles || [volunteer?.assignedRole].filter(Boolean)),
        roles,
        zones: sortedZones,
        roleZoneAssignments,
        override: getVolunteerOverride(volunteer.id),
        normalizeComparableValue,
      }),
    [getAccreditationFinalZoneIds, getVolunteerOverride, normalizeSubRoles, roleZoneAssignments, roles, sortedZones],
  );

  function getFinalZoneLabels(volunteer) {
    return sortedZones
      .filter((zone) => getFinalZoneIds(volunteer).includes(zone.id))
      .map((zone) => formatZoneLabel(zone));
  }

  function getRoleTableLabel(volunteer) {
    const override = getVolunteerOverride(volunteer.id);
    const confirmedRoles = getConfirmedAccreditationRoleNames(volunteer, normalizeComparableValue);
    const confirmedRoleLabel = buildAccreditationRoleLabel(confirmedRoles);
    const badgeRoleLabel = getBadgeRoleLabel(volunteer, override, normalizeComparableValue);

    if (confirmedRoleLabel && badgeRoleLabel && badgeRoleLabel !== confirmedRoleLabel) {
      return `${confirmedRoleLabel} (${badgeRoleLabel})`;
    }

    return confirmedRoleLabel || (badgeRoleLabel ? `(${badgeRoleLabel})` : tr("En attente de confirmation", "Awaiting confirmation"));
  }

  const buildCurrentConfiguration = useCallback(
    (nextPartial = {}) => ({
      zones,
      roleZoneAssignments,
      roleBadgeCategories,
      volunteerOverrides,
      printHistory,
      badgeStorageLocations,
      customStorageLocations,
      qrResources,
      qrVisualAssignments,
      ...nextPartial,
    }),
    [
      badgeStorageLocations,
      customStorageLocations,
      printHistory,
      qrResources,
      qrVisualAssignments,
      roleBadgeCategories,
      roleZoneAssignments,
      volunteerOverrides,
      zones,
    ],
  );

  const qrResourceUsageById = useMemo(
    () =>
      qrResources.reduce((accumulator, resource) => {
        accumulator[resource.id] = ACCREDITATION_BADGE_VISUALS
          .filter((visual) => (qrVisualAssignments[visual.id] ?? []).includes(resource.id))
          .map((visual) => visual.id);
        return accumulator;
      }, {}),
    [qrResources, qrVisualAssignments],
  );
  const effectiveSelectedQrVisualId = ACCREDITATION_BADGE_VISUALS.some((visual) => visual.id === selectedQrVisualId)
    ? selectedQrVisualId
    : ACCREDITATION_BADGE_VISUALS[0]?.id ?? "volunteer";
  const selectedQrVisual =
    ACCREDITATION_BADGE_VISUALS.find((visual) => visual.id === effectiveSelectedQrVisualId) ??
    ACCREDITATION_BADGE_VISUALS[0] ??
    null;
  const selectedQrVisualResourceIds = qrVisualAssignments[effectiveSelectedQrVisualId] ?? [];

  function resetQrResourceForm() {
    setEditingQrResourceId("");
    setQrResourceForm(EMPTY_QR_RESOURCE_FORM);
  }

  function handleQrResourceFormChange(event) {
    const { name, value } = event.target;
    setQrResourceForm((current) => ({ ...current, [name]: value }));
  }

  function editQrResource(resource) {
    const resolvedTargetMode = resource.source ? "linked" : resource.targetType === "document" ? "document_existing" : "url";

    setEditingQrResourceId(resource.id);
    setQrResourceForm({
      label: resource.label || "",
      subtitle: resource.subtitle || "",
      targetMode: resolvedTargetMode,
      documentId: resource.documentId || "",
      url: resource.url || "",
      source: resource.source || QR_LINK_SOURCES[0].key,
      uploadedFileUrl: "",
      uploadedFileName: "",
      uploadedFilePath: "",
    });
  }

  // Valeur actuelle d'un lien repris d'ailleurs (QR_LINK_SOURCES).
  function getLinkedSourceUrl(source) {
    const base = PUBLIC_SITE_URL;
    switch (source) {
      case "results":
        return String(currentEdition?.resultsUrl || "").trim();
      case "photos":
        return String(linksPage?.photos?.currentUrl || "").trim();
      case "emagazine":
        return `${base}/e-magazine`;
      case "athleteRoadbook":
        return `${base}/roadbook`;
      case "links":
        return `${base}/links`;
      default:
        return "";
    }
  }

  function getAccreditationResourceTargetUrl(resource) {
    if (!resource) return "";
    if (resource.source) return getLinkedSourceUrl(resource.source);

    if (resource.targetType === "document") {
      return getDocumentReferenceUrl(documentsById.get(resource.documentId) || null);
    }

    return String(resource.url || "").trim();
  }

  function getQrResourceTargetSummary(resource) {
    if (!resource) return tr("Cible indisponible", "Target unavailable");
    if (resource.source) {
      const source = QR_LINK_SOURCES.find((item) => item.key === resource.source);
      const url = getLinkedSourceUrl(resource.source);
      return tr(
        `Repris de ${source?.where || "MyCLIM"} : ${url || "pas encore renseigné"}`,
        `Taken from ${getLinkSourceWhere(source) || "MyCLIM"}: ${url || "not set yet"}`,
      );
    }

    if (resource.targetType === "document") {
      const linkedDocument = documentsById.get(resource.documentId) || null;
      if (!linkedDocument) return tr("Document introuvable", "Document not found");
      return linkedDocument.title || linkedDocument.fileName || tr("Document lié", "Linked document");
    }

    return resource.url ? resource.url : tr("Lien à configurer", "Link to set up");
  }

  async function buildResourceCardsForVisual(visualId) {
    const resourceIds = qrVisualAssignments[visualId] ?? [];
    const cards = await Promise.all(
      resourceIds.map(async (resourceId) => {
        const resource = qrResources.find((entry) => entry.id === resourceId);
        if (!resource) return null;

        const targetUrl = getAccreditationResourceTargetUrl(resource);
        let src = "";

        if (targetUrl) {
          try {
            src = await QRCode.toDataURL(targetUrl, {
              errorCorrectionLevel: "M",
              margin: 1,
              width: 160,
            });
          } catch (error) {
            console.error("Impossible de générer le QR code.", error);
          }
        }

        // Plus d'anciennes images QR figées (2026) : un badge ne porte un QR que si
        // son lien existe vraiment (Margot, 12/11/2026). Le roadbook bénévoles,
        // page à construire plus tard, n'a donc pas de QR pour l'instant.

        if (!src) return null;

        return {
          id: resource.id,
          src,
          title: resource.label,
          subtitle: resource.subtitle,
          alt: resource.label,
        };
      }),
    );

    return cards.filter(Boolean);
  }

  async function saveQrResource() {
    const trimmedLabel = qrResourceForm.label.trim();
    const trimmedSubtitle = qrResourceForm.subtitle.trim();
    const targetMode = qrResourceForm.targetMode;

    if (!trimmedLabel) {
      setAccreditationStatus(tr("Ajoutez un libellé pour la ressource QR.", "Add a label for the QR resource."));
      return;
    }

    let documentId = "";
    let externalUrl = "";
    let source = "";

    if (targetMode === "linked") {
      source = QR_LINK_SOURCES.some((item) => item.key === qrResourceForm.source) ? qrResourceForm.source : "";
      if (!source) {
        setAccreditationStatus(tr("Choisissez le lien à reprendre.", "Choose the link to use."));
        return;
      }
    } else if (targetMode === "document_existing") {
      documentId = String(qrResourceForm.documentId || "").trim();
      if (!documentId) {
        setAccreditationStatus(tr("Sélectionnez un document existant pour cette ressource QR.", "Select an existing document for this QR resource."));
        return;
      }
    } else if (targetMode === "document_upload") {
      if (!qrResourceForm.uploadedFileUrl) {
        setAccreditationStatus(tr("Téléversez un document avant d'enregistrer la ressource QR.", "Upload a document before saving the QR resource."));
        return;
      }

      try {
        const documentRef = await addDoc(collection(db, "documents"), {
          title: trimmedLabel,
          reference: "",
          fileName: qrResourceForm.uploadedFileName || "",
          filePath: qrResourceForm.uploadedFilePath || "",
          fileUrl: qrResourceForm.uploadedFileUrl,
          scope: "global",
          teams: [],
          visibility: "Tous les utilisateurs concernés",
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        documentId = documentRef.id;
      } catch (error) {
        setAccreditationStatus(getDocumentUploadErrorMessage(error));
        return;
      }
    } else {
      externalUrl = String(qrResourceForm.url || "").trim();
      if (!externalUrl) {
        setAccreditationStatus(tr("Ajoutez une URL pour cette ressource QR.", "Add a URL for this QR resource."));
        return;
      }
    }

    const existingResource = qrResources.find((resource) => resource.id === editingQrResourceId) || null;
    const nextResource = {
      id: existingResource?.id || `qr-resource-${Date.now()}`,
      label: trimmedLabel,
      subtitle: trimmedSubtitle,
      targetType: documentId ? "document" : "url",
      source,
      documentId,
      url: documentId || source ? "" : externalUrl,
      legacyImageUrl: existingResource?.legacyImageUrl || "",
    };
    const nextQrResources = existingResource
      ? qrResources.map((resource) => (resource.id === existingResource.id ? nextResource : resource))
      : [...qrResources, nextResource];

    await persistAccreditationConfiguration(
      buildCurrentConfiguration({
        qrResources: nextQrResources,
      }),
      existingResource ? tr("Ressource QR mise à jour.", "QR resource updated.") : tr("Ressource QR ajoutée.", "QR resource added."),
    );

    resetQrResourceForm();
  }

  function removeQrResource(resourceId) {
    const nextQrResources = qrResources.filter((resource) => resource.id !== resourceId);
    const nextQrVisualAssignments = Object.fromEntries(
      Object.entries(qrVisualAssignments).map(([visualId, resourceIds]) => [
        visualId,
        Array.isArray(resourceIds) ? resourceIds.filter((currentResourceId) => currentResourceId !== resourceId) : [],
      ]),
    );

    persistAccreditationConfiguration(
      buildCurrentConfiguration({
        qrResources: nextQrResources,
        qrVisualAssignments: nextQrVisualAssignments,
      }),
      tr("Ressource QR supprimée.", "QR resource deleted."),
    );

    if (editingQrResourceId === resourceId) {
      resetQrResourceForm();
    }
  }

  function toggleQrResourceAssignment(visualId, resourceId) {
    persistAccreditationConfiguration(
      buildCurrentConfiguration({
        qrVisualAssignments: {
          ...qrVisualAssignments,
          [visualId]: toggleIdInList(qrVisualAssignments[visualId] ?? [], resourceId),
        },
      }),
      tr("Affectation QR mise à jour.", "QR assignment updated."),
    );
  }

  const allStorageLocations = [
    ...BADGE_STORAGE_LOCATIONS,
    ...customStorageLocations.filter((loc) => !BADGE_STORAGE_LOCATIONS.includes(loc)),
  ];
  const effectiveSelectedNonNominativeTemplateId = namelessBadgeTypes.some(
    (template) => template.id === selectedNonNominativeTemplateId,
  )
    ? selectedNonNominativeTemplateId
    : namelessBadgeTypes[0]?.id ?? "";
  const selectedNonNominativeTemplate = namelessBadgeTypes.find(
    (template) => template.id === effectiveSelectedNonNominativeTemplateId,
  );

  function getCurrentOperatorLabel() {
    const fullName = [userProfile?.firstName, userProfile?.lastName].filter(Boolean).join(" ").trim();
    if (fullName) return fullName;
    if (String(userProfile?.displayName || "").trim()) return String(userProfile.displayName).trim();
    if (String(userProfile?.email || "").trim()) return String(userProfile.email).trim();
    return "Utilisateur inconnu";
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

  async function persistJudgeRoster(nextJudges, successMessage) {
    setIsSavingAccreditation(true);

    try {
      await setDoc(
        doc(db, ...JUDGE_ROSTER_DOC_PATH),
        {
          judges: nextJudges,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
      setAccreditationStatus(successMessage);
    } catch (error) {
      console.error("Impossible de sauvegarder le roster des juges.", error);
      setAccreditationStatus(tr("La sauvegarde du roster des juges a échoué.", "Saving the judges roster failed."));
    } finally {
      setIsSavingAccreditation(false);
    }
  }

  function resetJudgeForm() {
    setNewJudgeFirstName("");
    setNewJudgeLastName("");
    setNewJudgeBadgeLabel("Judge");
    setNewJudgeZoneIds(["zone-judges", "zone-infield"]);
  }

  function addJudge() {
    const firstName = newJudgeFirstName.trim();
    const lastName = newJudgeLastName.trim();
    if (!firstName || !lastName) return;

    const nextJudges = [
      ...judges,
      {
        id: `judge-${Date.now()}`,
        firstName,
        lastName,
        badgeLabel: String(newJudgeBadgeLabel || "Judge").trim() || "Judge",
        assignedZones: newJudgeZoneIds,
        printStatus: "Non-imprimé",
        lastPrintedAt: null,
        destroyedAt: null,
        createdBy: "manual",
      },
    ];

    persistJudgeRoster(nextJudges, tr("Juge ajouté au roster.", "Judge added to the roster."));
    resetJudgeForm();
  }

  function updateJudge(judgeId, patch, successMessage = tr("Roster des juges mis à jour.", "Judges roster updated.")) {
    const nextJudges = judges.map((judge) => (judge.id === judgeId ? { ...judge, ...patch } : judge));
    persistJudgeRoster(nextJudges, successMessage);
  }

  function removeJudge(judgeId) {
    const nextJudges = judges.filter((judge) => judge.id !== judgeId);
    persistJudgeRoster(nextJudges, tr("Juge retiré du roster.", "Judge removed from the roster."));
  }

  function updatePrintHistoryEntry(batchId, entryId, patch, successMessage = tr("Suivi d'impression mis à jour.", "Print tracking updated.")) {
    const nextPrintHistory = printHistory.map((batch) => (
      batch.id === batchId
        ? {
            ...batch,
            items: batch.items.map((entry) => (
              entry.id === entryId
                ? {
                    ...entry,
                    ...patch,
                  }
                : entry
            )),
          }
        : batch
    ));

    persistAccreditationConfiguration(
      buildCurrentConfiguration({
        printHistory: nextPrintHistory,
      }),
      successMessage,
    );
  }

  function addCustomStorageLocation() {
    const trimmed = newStorageLocationName.trim();
    if (!trimmed || allStorageLocations.includes(trimmed)) return;
    const next = [...customStorageLocations, trimmed];
    persistAccreditationConfiguration(
      buildCurrentConfiguration({ customStorageLocations: next }),
      tr("Point de retrait ajouté.", "Pick-up point added."),
    );
    setNewStorageLocationName("");
  }

  function removeCustomStorageLocation(loc) {
    const next = customStorageLocations.filter((l) => l !== loc);
    persistAccreditationConfiguration(
      buildCurrentConfiguration({ customStorageLocations: next }),
      tr("Point de retrait supprimé.", "Pick-up point deleted."),
    );
  }

  function getBadgeStorageLocation(volunteerId) {
    return badgeStorageLocations[volunteerId] ?? "";
  }

  function getJudgeStorageLocation(judgeId) {
    return badgeStorageLocations[judgeId] ?? "";
  }


  function markBadgeHandedOver(volunteer) {
    const existing = getVolunteerOverride(volunteer.id);
    const nextOverride = {
      ...existing,
      handedOverAt: new Date().toISOString(),
      handedOverBy: getCurrentOperatorLabel(),
    };

    persistAccreditationConfiguration(
      buildCurrentConfiguration({
        volunteerOverrides: {
          ...volunteerOverrides,
          [volunteer.id]: nextOverride,
        },
      }),
      tr("Badge marqué comme remis.", "Badge marked as handed over."),
    );
  }

  function markBadgeDestroyed(volunteer) {
    const existing = getVolunteerOverride(volunteer.id);
    const nextOverride = {
      ...existing,
      destroyedAt: new Date().toISOString(),
      warningMessage: "",
    };

    persistAccreditationConfiguration(
      buildCurrentConfiguration({
        volunteerOverrides: {
          ...volunteerOverrides,
          [volunteer.id]: nextOverride,
        },
      }),
      tr("Badge marqué comme détruit.", "Badge marked as destroyed."),
    );
  }

  function getVolunteerStep(volunteer) {
    return getBadgeStep(getVolunteerOverride(volunteer.id));
  }

  // Barre sous une liste : imprime les badges cochés, ou sinon tous ceux de la
  // liste qui sont à imprimer / à réimprimer. Plus de file d'impression.
  function renderPrintBar(printableItems, keyOf, print) {
    const checked = printableItems.filter((item) => printSelection.has(keyOf(item)));
    const target = checked.length ? checked : printableItems;
    if (!target.length) return null;
    return (
      <div className="acc-print-bar">
        <span>
          {checked.length
            ? tr(`${checked.length} badge(s) coché(s)`, `${checked.length} badge(s) selected`)
            : tr(`${printableItems.length} badge(s) à imprimer dans cette liste`, `${printableItems.length} badge(s) to print in this list`)}
        </span>
        <button
          className="button button--primary button--small"
          type="button"
          onClick={async () => {
            await print(target);
            setPrintSelection(new Set());
          }}
        >
          {checked.length
            ? tr(`Imprimer les ${checked.length} cochés (PDF)`, `Print the ${checked.length} selected (PDF)`)
            : tr(`Imprimer les ${target.length} (PDF)`, `Print all ${target.length} (PDF)`)}
        </button>
        {checked.length ? (
          <button className="button button--ghost button--small" type="button" onClick={() => setPrintSelection(new Set())}>
            {tr("Décocher", "Clear selection")}
          </button>
        ) : (
          <span className="acc-print-bar__hint">{tr("ou cochez pour n'en imprimer qu'une partie", "or tick some to print only those")}</span>
        )}
      </div>
    );
  }

  function togglePrintSelection(key, on) {
    setPrintSelection((current) => {
      const next = new Set(current);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  }





  function updateJudgeBadgeStorageLocation(judgeId, location) {
    const nextLocations = { ...badgeStorageLocations, [judgeId]: location };
    persistAccreditationConfiguration(
      buildCurrentConfiguration({ badgeStorageLocations: nextLocations }),
      tr("Point de retrait juge enregistré.", "Judge pick-up point saved."),
    );
    setStoragePickerOpenById((current) => ({ ...current, [judgeId]: false }));
  }



  function markJudgeBadgeDestroyed(judge) {
    updateJudge(
      judge.id,
      {
        destroyedAt: new Date().toISOString(),
      },
      tr("Badge juge marqué comme détruit.", "Judge badge marked as destroyed."),
    );
  }




  async function markPressBadgeHandedOver(registration) {
    try {
      await updateDoc(doc(db, "pressRegistrations", registration.id), { handedOverAt: new Date().toISOString() });
      setAccreditationStatus(tr("Badge presse remis.", "Press badge handed over."));
    } catch (error) {
      console.error("Impossible de marquer le badge presse comme remis.", error);
      setAccreditationStatus(tr("Impossible de marquer le badge presse comme remis.", "Could not mark the press badge as handed over."));
    }
  }

  async function markPressBadgeDestroyed(registration) {
    try {
      await updateDoc(doc(db, "pressRegistrations", registration.id), { destroyedAt: new Date().toISOString() });
      setAccreditationStatus(tr("Badge presse marqué comme détruit.", "Press badge marked as destroyed."));
    } catch (error) {
      console.error("Impossible de marquer le badge presse comme détruit.", error);
      setAccreditationStatus(tr("Impossible de marquer le badge presse comme détruit.", "Could not mark the press badge as destroyed."));
    }
  }

  function getPressStorageLocation(registrationId) {
    return badgeStorageLocations[registrationId] ?? "";
  }

  function updatePressBadgeStorageLocation(registrationId, location) {
    const nextLocations = { ...badgeStorageLocations, [registrationId]: location };
    persistAccreditationConfiguration(
      buildCurrentConfiguration({ badgeStorageLocations: nextLocations }),
      tr("Point de retrait presse enregistré.", "Press pick-up point saved."),
    );
    setStoragePickerOpenById((current) => ({ ...current, [registrationId]: false }));
  }


  async function finalizePressPrintQueue(selectedPress = null) {
    const queuedPress = (selectedPress || acceptedPressRegistrations.filter((registration) => registration.printStatus === "Dans la file")).filter(
      (registration) => !registration.destroyedAt && canPrintStep(getBadgeStep(registration)),
    );
    if (!queuedPress.length) return;

    const printedAt = new Date().toISOString();
    const pressResourceCards = await buildResourceCardsForVisual("press");
    const badgeItems = queuedPress.map((registration) => {
      const badgeRoleLabel = PRESS_REQUEST_TYPE_LABELS[registration.requestType] || "Presse";
      return {
        volunteerId: registration.id,
        name: `${registration.firstName || ""} ${registration.lastName || ""}`.trim() || registration.media || "Presse",
        firstName: registration.firstName || "",
        lastName: registration.lastName || "",
        category: registration.requestType === "photographer" ? "photographer" : "press",
        role: [registration.requestType === "photographer" ? "Photographer" : "Press", registration.media].filter(Boolean).join(" · "),
        roleNames: [badgeRoleLabel],
        zoneIds: registration.zoneIds || [],
        zoneLabels: sortedZones
          .filter((zone) => (registration.zoneIds || []).includes(zone.id))
          .map((zone) => formatZoneLabel(zone)),
        resourceCards: pressResourceCards,
      };
    });
    const historyEntries = badgeItems.map((item, index) => ({
      id: `${item.volunteerId}-press-${Date.now()}-${index}`,
      volunteerId: item.volunteerId,
      name: item.name,
      roleLabel: item.role,
      roleNames: item.roleNames,
      zoneLabels: item.zoneLabels,
      printedAt,
      generatedBy: getCurrentOperatorLabel(),
      reviewStatus: "",
      reviewComment: "",
    }));
    const historyBatch = {
      id: `press-batch-${Date.now()}`,
      printedAt,
      generatedBy: getCurrentOperatorLabel(),
      items: historyEntries,
    };

    await Promise.all([
      ...queuedPress.map((registration) =>
        updateDoc(doc(db, "pressRegistrations", registration.id), {
          printStatus: "Imprimé",
          lastPrintedAt: printedAt,
          destroyedAt: null,
          handedOverAt: null,
        }),
      ),
      persistAccreditationConfiguration(
        buildCurrentConfiguration({
          printHistory: [historyBatch, ...printHistory],
        }),
        tr("Historique d'impression presse enregistré.", "Press print history saved."),
      ),
    ]);

    openPrintWindow(buildAccreditationBadgeMarkup(badgeItems, { planElements: coquePlanElements }));
    openPrintWindow(buildAccreditationPrintHistoryMarkup(historyEntries, formatDateTimeForDisplay));
  }

  function updateBadgeStorageLocation(volunteerId, location) {
    const nextLocations = { ...badgeStorageLocations, [volunteerId]: location };
    persistAccreditationConfiguration(
      buildCurrentConfiguration({ badgeStorageLocations: nextLocations }),
      tr("Point de retrait enregistré.", "Pick-up point saved."),
    );
    setStoragePickerOpenById((current) => ({ ...current, [volunteerId]: false }));
  }

  function buildUpdatedVolunteerOverride(volunteer, patch, options = {}) {
    const existing = getVolunteerOverride(volunteer.id);
    const nextOverride = {
      ...existing,
      ...patch,
      printedSnapshot: {
        ...existing.printedSnapshot,
        ...(patch.printedSnapshot || {}),
      },
    };

    if (
      options.markAsModifiedAfterPrint &&
      existing.printStatus === "Imprimé"
    ) {
      nextOverride.printStatus = "Non-imprimé";
      nextOverride.warningMessage =
        "Attention modification : le contenu de cette accréditation a changé depuis la dernière impression.";
    }

    if (patch.printStatus === "Dans la file") {
      return { ...enterQueue({ ...nextOverride, printStatus: existing.printStatus }), printedSnapshot: nextOverride.printedSnapshot };
    }

    if (patch.printStatus === "Imprimé") {
      nextOverride.warningMessage = "";
      nextOverride.queuedFrom = "";
      nextOverride.queuedWarning = "";
    }

    return nextOverride;
  }

  // Renommer une zone renomme aussi ses repères sur le plan enregistré (badges,
  // plan du site, roadbook), une fois la saisie terminée.
  async function syncZoneNamesToPlan() {
    if (!coquePlan.saved) return;
    const synced = syncPlanZones(coquePlan.rawElements, sortedZones);
    const changed = synced.some((element, index) => element !== coquePlan.rawElements[index]);
    if (!changed) return;
    try {
      await saveCoquePlan(synced, getCurrentOperatorLabel(), coquePlan.published, coquePlan.icons);
      setAccreditationStatus(tr("Nom de zone repris sur le plan de la Coque.", "Zone name updated on the Coque plan."));
    } catch (error) {
      console.error("Impossible de mettre à jour le plan.", error);
      setAccreditationStatus(tr(
        "La zone est renommée, mais le plan n'a pas pu être mis à jour : enregistrez-le depuis Plans & contrôles.",
        "The zone is renamed, but the plan could not be updated: save it from Plans & checks.",
      ));
    }
  }

  function updateZone(zoneId, field, value) {
    const nextZones = zones.map((zone) =>
      zone.id === zoneId
        ? {
            ...zone,
            [field]: field === "order" ? Math.max(1, Number(value) || 1) : value,
          }
        : zone,
    );
    persistAccreditationConfiguration(
      {
        zones: nextZones,
        roleZoneAssignments,
        volunteerOverrides,
        printHistory,
      },
      tr("Configuration des zones enregistrée.", "Zone settings saved."),
    );
  }

  function addZone() {
    if (!newZoneName.trim()) return;

    const nextOrder = Math.max(0, ...zones.map((zone) => zone.order)) + 1;
    const nextId = `zone-${Date.now()}`;

    const nextZones = [
      ...zones,
      {
        id: nextId,
        order: nextOrder,
        name: newZoneName.trim(),
      },
    ];
    persistAccreditationConfiguration(
      {
        zones: nextZones,
        roleZoneAssignments,
        volunteerOverrides,
        printHistory,
      },
      tr("Nouvelle zone ajoutée.", "New zone added."),
    );
    setNewZoneName("");
  }

  function removeZone(zoneId) {
    const nextZones = zones.filter((zone) => zone.id !== zoneId);
    const nextRoleZoneAssignments = Object.fromEntries(
      Object.entries(roleZoneAssignments).map(([roleName, zoneIds]) => [
        roleName,
        zoneIds.filter((currentZoneId) => currentZoneId !== zoneId),
      ]),
    );
    const nextVolunteerOverrides = Object.fromEntries(
      Object.entries(volunteerOverrides).map(([volunteerId, override]) => [
        volunteerId,
        {
          ...override,
          addZoneIds: override.addZoneIds.filter((currentZoneId) => currentZoneId !== zoneId),
          removeZoneIds: override.removeZoneIds.filter((currentZoneId) => currentZoneId !== zoneId),
        },
      ]),
    );

    persistAccreditationConfiguration(
      {
        zones: nextZones,
        roleZoneAssignments: nextRoleZoneAssignments,
        volunteerOverrides: nextVolunteerOverrides,
        printHistory,
      },
      tr("Zone supprimée.", "Zone deleted."),
    );
  }

  function toggleRoleZone(roleId, zoneId) {
    persistAccreditationConfiguration(
      {
        zones,
        roleZoneAssignments: {
          ...roleZoneAssignments,
          [roleId]: toggleIdInList(roleZoneAssignments[roleId] ?? [], zoneId),
        },
        volunteerOverrides,
        printHistory,
      },
      tr("Accès par rôle mis à jour.", "Access by role updated."),
    );
  }


  function updateVolunteerOverride(volunteer, field, zoneId) {
    const nextOverride = buildUpdatedVolunteerOverride(
      volunteer,
      {
        [field]: toggleIdInList(getVolunteerOverride(volunteer.id)[field], zoneId),
      },
      { markAsModifiedAfterPrint: true },
    );

    persistAccreditationConfiguration(
      buildCurrentConfiguration({
        volunteerOverrides: {
          ...volunteerOverrides,
          [volunteer.id]: nextOverride,
        },
      }),
      tr("Ajustement individuel enregistré.", "Individual adjustment saved."),
    );
  }

  function updateVolunteerBadgeLabel(volunteer, badgeLabel) {
    const trimmedLabel = String(badgeLabel || "").trim();
    const existing = getVolunteerOverride(volunteer.id);
    if (trimmedLabel === existing.badgeLabel) return;

    const nextOverride = buildUpdatedVolunteerOverride(
      volunteer,
      { badgeLabel: trimmedLabel },
      { markAsModifiedAfterPrint: true },
    );

    persistAccreditationConfiguration(
      buildCurrentConfiguration({
        volunteerOverrides: {
          ...volunteerOverrides,
          [volunteer.id]: nextOverride,
        },
      }),
      tr("Libellé de l'accréditation mis à jour.", "Badge label updated."),
    );
  }

  function updateVolunteerPrintStatus(volunteer, printStatus) {
    const printStatusPatch =
      printStatus === "Imprimé"
        ? {
            printStatus,
            lastPrintedAt: new Date().toISOString(),
            printedSnapshot: {
              roleLabel: getBadgeRoleLabel(volunteer, getVolunteerOverride(volunteer.id), normalizeComparableValue),
              roleNames: normalizeSubRoles(volunteer.assignedRoles || [volunteer.assignedRole].filter(Boolean)),
              zoneIds: getFinalZoneIds(volunteer),
            },
          }
        : { printStatus };
    const nextOverride = buildUpdatedVolunteerOverride(volunteer, printStatusPatch);

    persistAccreditationConfiguration(
      buildCurrentConfiguration({
        volunteerOverrides: {
          ...volunteerOverrides,
          [volunteer.id]: nextOverride,
        },
      }),
      tr("Statut d'impression mis à jour.", "Print status updated."),
    );
  }



  function openPrintWindow(markup) {
    if (typeof window === "undefined") return;
    const printWindow = window.open("", "_blank", "width=1200,height=900");
    if (!printWindow) return;
    printWindow.document.write(markup);
    printWindow.document.close();
  }

  async function openSampleAccreditation() {
    const legendZoneLabels = sortedZones.length
      ? sortedZones.map((zone) => formatZoneLabel(zone))
      : ["1. Tribune", "2. Warm-up", "3. Mixed zone", "4. Call room", "5. Media", "6. Infield"];
    const normalizedLegendLabels = legendZoneLabels.map((label) =>
      String(label)
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase(),
    );
    const infieldIndex = normalizedLegendLabels.findIndex((label) => label.includes("infield"));
    const infieldLabel = infieldIndex >= 0 ? legendZoneLabels[infieldIndex] : legendZoneLabels[0] || "6. Infield";
    const nonInfieldLabels = legendZoneLabels.filter((label, index) => index !== infieldIndex);
    const allZonesLabels = legendZoneLabels;
    const infieldOnlyLabels = [infieldLabel];
    const partialWithoutInfieldLabels = nonInfieldLabels.slice(0, Math.max(1, Math.min(3, nonInfieldLabels.length)));
    const noZoneLabels = [];
    const volunteerResourceCards = await buildResourceCardsForVisual("volunteer");
    const athleteResourceCards = await buildResourceCardsForVisual("athlete");
    const judgeResourceCards = await buildResourceCardsForVisual("judge");

    openPrintWindow(
      buildAccreditationBadgeMarkup([
        {
          volunteerId: "sample-accreditation",
          name: "Carmela Esposito",
          firstName: "Carmela",
          lastName: "Esposito",
          category: "organisation",
          role: "FLA Executive Board",
          roleNames: ["Comite directeur FLA"],
          zoneIds: allZonesLabels.map((_, index) => `sample-zone-all-${index + 1}`),
          zoneLabels: allZonesLabels,
          resourceCards: judgeResourceCards,
        },
        {
          volunteerId: "sample-accreditation-2",
          name: "Nina Hoffmann",
          firstName: "Nina",
          lastName: "Hoffmann",
          category: "judge",
          role: "Referee",
          roleNames: ["Officiel terrain"],
          zoneIds: infieldOnlyLabels.map((_, index) => `sample-zone-infield-${index + 1}`),
          zoneLabels: infieldOnlyLabels,
          resourceCards: judgeResourceCards,
        },
        {
          volunteerId: "sample-accreditation-3",
          name: "Tom Becker",
          firstName: "Tom",
          lastName: "Becker",
          category: "photographer",
          role: "Photographer · FLA",
          roleNames: ["Media"],
          zoneIds: partialWithoutInfieldLabels.map((_, index) => `sample-zone-no-infield-${index + 1}`),
          zoneLabels: partialWithoutInfieldLabels,
          resourceCards: athleteResourceCards,
        },
        {
          volunteerId: "sample-accreditation-4",
          name: "Alex Muller",
          firstName: "Alex",
          lastName: "Muller",
          category: "volunteer",
          role: "Hurdles team",
          roleNames: ["Benevole"],
          zoneIds: [],
          zoneLabels: noZoneLabels,
          resourceCards: volunteerResourceCards,
        },
      ], { planElements: coquePlanElements }),
    );
  }

  // Imprime les badges choisis (cochés, ou tous ceux « à imprimer » du filtre).
  // Seulement des personnes visibles dont le poste est confirmé.
  async function finalizePrintQueue(selectedVolunteers = null) {
    const queuedVolunteers = (selectedVolunteers || volunteers.filter(
      (volunteer) => getVolunteerOverride(volunteer.id).printStatus === "Dans la file",
    )).filter(
      (volunteer) =>
        shouldDisplayVolunteerAccreditation(volunteer) &&
        getConfirmedAccreditationRoleNames(volunteer, normalizeComparableValue).length > 0 &&
        canPrintStep(getVolunteerStep(volunteer)),
    );
    if (!queuedVolunteers.length) return;

    const printedAt = new Date().toISOString();
    const volunteerResourceCards = await buildResourceCardsForVisual("volunteer");
    const badgeItems = queuedVolunteers.map((volunteer) => {
      const override = getVolunteerOverride(volunteer.id);
      const zoneIds = getFinalZoneIds(volunteer);
      return {
        volunteerId: volunteer.id,
        name: `${volunteer.firstName} ${volunteer.lastName}`.trim(),
        firstName: volunteer.firstName || "",
        lastName: volunteer.lastName || "",
        category: getVolunteerBadgeCategory(normalizeSubRoles(volunteer.assignedRoles || [volunteer.assignedRole].filter(Boolean))),
        role: getBadgeRoleLabel(volunteer, override, normalizeComparableValue) || "Accreditation",
        roleNames: normalizeSubRoles(volunteer.assignedRoles || [volunteer.assignedRole].filter(Boolean)),
        zoneIds,
        zoneLabels: getFinalZoneLabels(volunteer),
        resourceCards: volunteerResourceCards,
      };
    });

    const historyEntries = badgeItems.map((item, index) => ({
      id: `${item.volunteerId}-${Date.now()}-${index}`,
      volunteerId: item.volunteerId,
      name: item.name,
      roleLabel: item.role,
      roleNames: item.roleNames,
      zoneLabels: item.zoneLabels,
      printedAt,
      generatedBy: getCurrentOperatorLabel(),
      reviewStatus: "",
      reviewComment: "",
    }));
    const historyBatch = {
      id: `print-batch-${Date.now()}`,
      printedAt,
      generatedBy: getCurrentOperatorLabel(),
      items: historyEntries,
    };

    const nextVolunteerOverrides = {
      ...volunteerOverrides,
    };

    badgeItems.forEach((item) => {
      const volunteer = queuedVolunteers.find((entry) => entry.id === item.volunteerId);
      nextVolunteerOverrides[item.volunteerId] = buildUpdatedVolunteerOverride(volunteer, {
        printStatus: "Imprimé",
        lastPrintedAt: printedAt,
        printedSnapshot: {
          roleLabel: item.role,
          roleNames: item.roleNames,
          zoneIds: item.zoneIds,
        },
      });
      nextVolunteerOverrides[item.volunteerId].warningMessage = "";
    });

    await persistAccreditationConfiguration(
      buildCurrentConfiguration({
        volunteerOverrides: nextVolunteerOverrides,
        printHistory: [historyBatch, ...printHistory],
      }),
      tr("Lot d'impression généré.", "Print batch generated."),
    );

    openPrintWindow(buildAccreditationBadgeMarkup(badgeItems, { planElements: coquePlanElements }));
    openPrintWindow(buildAccreditationPrintHistoryMarkup(historyEntries, formatDateTimeForDisplay));
  }

  async function generateNonNominativeBadgePdf() {
    if (!selectedNonNominativeTemplate) return;

    const quantity = Math.max(1, Number.parseInt(nonNominativeQuantity, 10) || 1);
    const printedAt = new Date().toISOString();
    const resourceCards = await buildResourceCardsForVisual(selectedNonNominativeTemplate.id);
    const zoneIds = selectedNonNominativeTemplate.zoneIds.filter((zoneId) =>
      sortedZones.some((zone) => zone.id === zoneId),
    );
    const zoneLabels = sortedZones
      .filter((zone) => zoneIds.includes(zone.id))
      .map((zone) => formatZoneLabel(zone));
    const badgeItems = Array.from({ length: quantity }, (_, index) => ({
      volunteerId: `non-nominative-${selectedNonNominativeTemplate.id}-${Date.now()}-${index + 1}`,
      name: "Non nominatif",
      nominative: false,
      category: selectedNonNominativeTemplate.category,
      role: "Accreditation",
      roleNames: [selectedNonNominativeTemplate.label],
      zoneIds,
      zoneLabels,
      resourceCards,
    }));
    const historyEntries = badgeItems.map((item, index) => ({
      id: `non-nominative-history-${selectedNonNominativeTemplate.id}-${Date.now()}-${index + 1}`,
      volunteerId: item.volunteerId,
      name: `${selectedNonNominativeTemplate.label} non nominatif`,
      roleLabel: item.role,
      roleNames: item.roleNames,
      zoneLabels: item.zoneLabels,
      printedAt,
      generatedBy: getCurrentOperatorLabel(),
      reviewStatus: "",
      reviewComment: "",
    }));
    const historyBatch = {
      id: `non-nominative-batch-${selectedNonNominativeTemplate.id}-${Date.now()}`,
      printedAt,
      generatedBy: getCurrentOperatorLabel(),
      items: historyEntries,
    };

    await persistAccreditationConfiguration(
      buildCurrentConfiguration({
        printHistory: [historyBatch, ...printHistory],
      }),
      tr(
        `${quantity} badge(s) ${selectedNonNominativeTemplate.label.toLowerCase()} non nominatif(s) généré(s).`,
        `${quantity} nameless ${selectedNonNominativeTemplate.label.toLowerCase()} badge(s) generated.`,
      ),
    );

    openPrintWindow(buildAccreditationBadgeMarkup(badgeItems, { planElements: coquePlanElements }));
  }

  // Badges VIP : la mise en file se fait aussi depuis VIP › Inscrits (statut du badge).
  async function updateVipBadgeStatus(registrations, badgePrintStatus, extra = {}) {
    setVipPrintError("");
    try {
      await Promise.all(
        registrations.map((registration) =>
          updateDoc(getVipRegistrationDocRef(registration), {
            badgePrintStatus,
            ...extra,
            updatedAt: serverTimestamp(),
          }),
        ),
      );
    } catch (updateError) {
      console.error("VIP badge status update failed", updateError);
      setVipPrintError(tr("Le statut des badges VIP n'a pas pu être enregistré.", "The VIP badge status could not be saved."));
    }
  }

  async function finalizeVipPrintQueue() {
    if (!queuedVip.length) return;
    openPrintWindow(
      buildVipBadgePrintMarkup(buildVipBadgeItems(queuedVip), {
        editionYear: /^d{4}$/.test(activeEditionId) ? activeEditionId : "",
      }),
    );
    await updateVipBadgeStatus(queuedVip, "imprime", {
      badgePrintedAt: new Date().toISOString(),
      badgePrintedBy: getCurrentOperatorLabel(),
    });
  }

  async function finalizeJudgePrintQueue(selectedJudges = null) {
    const queuedJudges = (selectedJudges || judges.filter((judge) => judge.printStatus === "Dans la file")).filter(
      (judge) => !judge.destroyedAt && canPrintStep(getBadgeStep(judge)),
    );
    if (!queuedJudges.length) return;

    const printedAt = new Date().toISOString();
    const judgeResourceCards = await buildResourceCardsForVisual("judge");
    const badgeItems = queuedJudges.map((judge) => ({
      volunteerId: judge.id,
      name: `${judge.firstName} ${judge.lastName}`.trim() || "Judge",
      firstName: judge.firstName || "",
      lastName: judge.lastName || "",
      category: "judge",
      role: judge.badgeLabel || "Judge",
      roleNames: [judge.badgeLabel || "Judge"],
      zoneIds: judge.assignedZones,
      zoneLabels: sortedZones
        .filter((zone) => judge.assignedZones.includes(zone.id))
        .map((zone) => formatZoneLabel(zone)),
      resourceCards: judgeResourceCards,
    }));
    const historyEntries = badgeItems.map((item, index) => ({
      id: `${item.volunteerId}-judge-${Date.now()}-${index}`,
      volunteerId: item.volunteerId,
      name: item.name,
      roleLabel: item.role,
      roleNames: item.roleNames,
      zoneLabels: item.zoneLabels,
      printedAt,
      generatedBy: getCurrentOperatorLabel(),
      reviewStatus: "",
      reviewComment: "",
    }));
    const historyBatch = {
      id: `judge-batch-${Date.now()}`,
      printedAt,
      generatedBy: getCurrentOperatorLabel(),
      items: historyEntries,
    };

    const nextJudges = judges.map((judge) =>
      queuedJudges.some((queuedJudge) => queuedJudge.id === judge.id)
        ? {
            ...judge,
            printStatus: "Imprimé",
            lastPrintedAt: printedAt,
            destroyedAt: null,
            handedOverAt: null,
          }
        : judge,
    );

    await Promise.all([
      persistJudgeRoster(nextJudges, tr("Lot d'impression juges généré.", "Judges print batch generated.")),
      persistAccreditationConfiguration(
        buildCurrentConfiguration({
          printHistory: [historyBatch, ...printHistory],
        }),
        tr("Historique d'impression juges enregistré.", "Judges print history saved."),
      ),
    ]);

    openPrintWindow(buildAccreditationBadgeMarkup(badgeItems, { planElements: coquePlanElements }));
    openPrintWindow(buildAccreditationPrintHistoryMarkup(historyEntries, formatDateTimeForDisplay));
  }

  const normalizedRoleSearch = roleSearch.trim().toLowerCase();
  const filteredRoles = useMemo(
    () => roles.filter((role) => role.roleName.toLowerCase().includes(normalizedRoleSearch)),
    [normalizedRoleSearch, roles],
  );
  // Le détail ne montre qu'une personne visible dans la liste (jamais un bénévole masqué).
  const displayableVolunteers = volunteers.filter((volunteer) => shouldDisplayVolunteerAccreditation(volunteer));
  const effectiveSelectedVolunteerId =
    selectedVolunteerId && displayableVolunteers.some((volunteer) => volunteer.id === selectedVolunteerId)
      ? selectedVolunteerId
      : displayableVolunteers[0]?.id ?? "";
  const selectedVolunteer = displayableVolunteers.find((volunteer) => volunteer.id === effectiveSelectedVolunteerId);
  const selectedVolunteerOverride = selectedVolunteer
    ? getVolunteerOverride(selectedVolunteer.id)
    : {
        addZoneIds: [],
        removeZoneIds: [],
        printStatus: "Non-imprimé",
        badgeLabel: "",
        warningMessage: "",
        lastQueuedAt: null,
        lastPrintedAt: null,
        destroyedAt: null,
        printedSnapshot: { roleLabel: "", roleNames: [], zoneIds: [] },
      };
  const inheritedZoneIds = selectedVolunteer
    ? normalizeSubRoles(
        normalizeSubRoles(selectedVolunteer.assignedRoles || [selectedVolunteer.assignedRole].filter(Boolean)).flatMap(
          (assignedRole) => getRoleZoneIdsByName(assignedRole),
        ),
      )
    : [];
  const normalizedJudgeSearch = judgeSearch.trim().toLowerCase();

  const activeJudges = judges.filter((judge) => {
    if (judge.destroyedAt) return false;
    if (!normalizedJudgeSearch) return true;
    const haystack = `${judge.firstName} ${judge.lastName} ${judge.badgeLabel}`.toLowerCase();
    return haystack.includes(normalizedJudgeSearch);
  });
  const normalizedPressSearch = pressSearch.trim().toLowerCase();
  const acceptedPressRegistrations = pressRegistrations.filter((registration) => {
    if (registration.status !== "accepted") return false;
    if (!normalizedPressSearch) return true;
    const haystack = `${registration.firstName} ${registration.lastName} ${registration.media}`.toLowerCase();
    return haystack.includes(normalizedPressSearch);
  });

  const queuedVip = vipRegistrations
    .filter((registration) => registration.badgePrintStatus === "en_file")
    .sort((left, right) =>
      `${left.lastName || ""} ${left.firstName || ""}`.localeCompare(`${right.lastName || ""} ${right.firstName || ""}`, "fr"),
    );
  const unprintedVip = vipRegistrations.filter(
    (registration) => (registration.badgePrintStatus || "non_imprime") === "non_imprime",
  );
  const queuedVipBadgeCount = buildVipBadgeItems(queuedVip).length;
  const selectedNonNominativeZoneLabels = selectedNonNominativeTemplate
    ? sortedZones
        .filter((zone) => selectedNonNominativeTemplate.zoneIds.includes(zone.id))
        .map((zone) => formatZoneLabel(zone))
    : [];
  const printableVolunteers = displayableVolunteers;
  // Affectés mais pas encore confirmés : pas de badge tant que le poste n'est pas confirmé.
  const unconfirmedVolunteersCount = volunteers.filter(
    (volunteer) =>
      volunteerHasPrintableAssignment(volunteer) &&
      getConfirmedAccreditationRoleNames(volunteer, normalizeComparableValue).length === 0 &&
      !displayableVolunteers.includes(volunteer),
  ).length;
  const peopleBucketCounts = printableVolunteers.reduce(
    (counts, volunteer) => {
      const { step } = getVolunteerStep(volunteer);
      if (step) counts[step] = (counts[step] ?? 0) + 1;
      counts.all += 1;
      return counts;
    },
    { all: 0, todo: 0, done: 0, given: 0, attn: 0 },
  );
  const filteredPrintableVolunteers = printableVolunteers.filter((volunteer) => {
    if (peopleFilter !== "all" && getVolunteerStep(volunteer).step !== peopleFilter) return false;
    const haystack = [
      volunteer.firstName,
      volunteer.lastName,
      volunteer.email,
      volunteer.assignedRole,
      ...(volunteer.assignedRoles || []),
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(volunteerSearch.trim().toLowerCase());
  });

  const visiblePrintableVolunteers = getVisibleListItems("printable-volunteers", filteredPrintableVolunteers);
  const visibleActiveJudges = getVisibleListItems("active-judges", activeJudges);
  const visibleAcceptedPress = getVisibleListItems("accepted-press", acceptedPressRegistrations);

  const availableAccreditationTabs = [
    ...(canOperatePrinting ? ["people", "desk", "history", "plans", "entrance", "judgesPlan", "controls"] : []),
    ...(canManageAccreditationConfiguration ? ["settings"] : []),
  ];
  const [activeAccreditationTab, setActiveAccreditationTab] = useState(() =>
    getAccreditationTabFromPath(location.pathname, availableAccreditationTabs),
  );

  useEffect(() => {
    const nextTab = getAccreditationTabFromPath(location.pathname, availableAccreditationTabs);
    if (nextTab === activeAccreditationTab) return;
    setActiveAccreditationTab(nextTab);
  }, [activeAccreditationTab, availableAccreditationTabs, location.pathname]);

  const accreditationDataReady = !usersLoading && !teamsLoading && !accreditationLoading;

  useEffect(() => {
    if (!canOperatePrinting || editionLoading) return undefined;
    return onSnapshot(
      query(collection(db, NATIONAL_RACE_REQUESTS_COLLECTION), where("status", "==", "selected")),
      (snapshot) =>
        setNationalAthletes(
          snapshot.docs
            .map((entry) => ({ id: entry.id, ...entry.data() }))
            .filter((request) => recordMatchesEdition(request, activeEditionId))
            .sort((left, right) => `${left.lastName} ${left.firstName}`.localeCompare(`${right.lastName} ${right.firstName}`, "fr")),
        ),
      () => setNationalAthletes([]),
    );
  }, [activeEditionId, canOperatePrinting, editionLoading]);

  // Badge d'un athlète de course nationale : suivi dans volunteerOverrides (clé nr-…).
  // printed : texte imprimé sur le badge (toujours en anglais, comme les badges) ;
  // sinon dans la langue de l'écran.
  function getNationalRaceLabel(request, printed = false) {
    const definition = getNationalRaceDefinition(request.raceCode);
    const english = printed || tr("fr", "en") === "en";
    const race = definition
      ? english
        ? `${definition.event} ${definition.gender === "femme" ? "Women" : "Men"}`
        : definition.label
      : request.event || "";
    if (!isNationalRacePacer(request)) return race;
    return `${race} · ${english ? "pacer" : "lièvre"}`;
  }
  const nationalZoneLabels = sortedZones.filter((zone) => nationalBadge.zoneIds.includes(zone.id)).map((zone) => formatZoneLabel(zone));

  async function printNationalBadges(requests) {
    const list = requests.filter((request) => canPrintStep(getBadgeStep(getVolunteerOverride(nationalBadgeKey(request.id)))));
    if (!list.length) return;
    const printedAt = new Date().toISOString();
    const resourceCards = await buildResourceCardsForVisual("athlete");
    const badgeItems = list.map((request) => ({
      volunteerId: nationalBadgeKey(request.id),
      name: `${request.firstName || ""} ${request.lastName || ""}`.trim(),
      firstName: request.firstName || "",
      lastName: request.lastName || "",
      category: nationalBadge.category,
      role: [nationalBadge.label, getNationalRaceLabel(request, true)].filter(Boolean).join(" · "),
      roleNames: [getNationalRaceLabel(request, true)],
      zoneIds: nationalBadge.zoneIds,
      zoneLabels: nationalZoneLabels,
      resourceCards,
    }));
    const historyEntries = badgeItems.map((item, index) => ({
      id: `${item.volunteerId}-${Date.now()}-${index}`,
      volunteerId: item.volunteerId,
      name: item.name,
      roleLabel: item.role,
      roleNames: item.roleNames,
      zoneLabels: item.zoneLabels,
      printedAt,
      generatedBy: getCurrentOperatorLabel(),
      reviewStatus: "",
      reviewComment: "",
    }));
    const nextOverrides = { ...volunteerOverrides };
    badgeItems.forEach((item) => {
      nextOverrides[item.volunteerId] = {
        ...getVolunteerOverride(item.volunteerId),
        printStatus: "Imprimé",
        lastPrintedAt: printedAt,
        handedOverAt: null,
        warningMessage: "",
        printedSnapshot: { roleLabel: item.role, roleNames: item.roleNames, zoneIds: item.zoneIds },
      };
    });
    await persistAccreditationConfiguration(
      buildCurrentConfiguration({
        volunteerOverrides: nextOverrides,
        printHistory: [{ id: `national-batch-${Date.now()}`, printedAt, generatedBy: getCurrentOperatorLabel(), items: historyEntries }, ...printHistory],
      }),
      tr(`${list.length} badge(s) course nationale imprimé(s).`, `${list.length} national race badge(s) printed.`),
    );
    openPrintWindow(buildAccreditationBadgeMarkup(badgeItems, { planElements: coquePlanElements }));
    openPrintWindow(buildAccreditationPrintHistoryMarkup(historyEntries, formatDateTimeForDisplay));
  }

  // Réglages des badges sans nom et du badge course nationale (enregistrement partiel, fusionné).
  function saveNamelessTypes(nextTypes, message = tr("Badges sans nom enregistrés.", "Badges without names saved.")) {
    persistAccreditationConfiguration({ namelessBadgeTypes: nextTypes }, message);
  }
  function updateNamelessType(typeId, patch) {
    saveNamelessTypes(namelessBadgeTypes.map((type) => (type.id === typeId ? { ...type, ...patch } : type)));
  }
  function addNamelessType() {
    saveNamelessTypes([...namelessBadgeTypes, { id: `nameless-${Date.now()}`, label: "Nouveau badge", category: "organisation", zoneIds: [] }], tr("Type de badge sans nom ajouté.", "Badge type without name added."));
  }
  function removeNamelessType(typeId) {
    saveNamelessTypes(namelessBadgeTypes.filter((type) => type.id !== typeId), tr("Type de badge sans nom supprimé.", "Badge type without name deleted."));
  }
  function updateNationalBadge(patch) {
    persistAccreditationConfiguration({ nationalBadge: { ...nationalBadge, ...patch } }, tr("Badge course nationale enregistré.", "National race badge saved."));
  }

  // Guichet du jour J : les badges imprimés, à ranger puis à remettre.
  const deskRows = [
    ...printableVolunteers.map((volunteer) => ({
      key: `v:${volunteer.id}`,
      name: `${volunteer.firstName} ${volunteer.lastName}`.trim() || volunteer.email,
      role: getBadgeRoleLabel(volunteer, getVolunteerOverride(volunteer.id), normalizeComparableValue),
      kind: "Bénévole",
      step: getVolunteerStep(volunteer).step,
      location: getBadgeStorageLocation(volunteer.id),
      setLocation: (location) => updateBadgeStorageLocation(volunteer.id, location),
      handOver: () => markBadgeHandedOver(volunteer),
    })),
    ...activeJudges.map((judge) => ({
      key: `j:${judge.id}`,
      name: `${judge.firstName} ${judge.lastName}`.trim() || "Judge",
      role: judge.badgeLabel || "Judge",
      kind: "Juge",
      step: getBadgeStep(judge).step,
      location: getJudgeStorageLocation(judge.id),
      setLocation: (location) => updateJudgeBadgeStorageLocation(judge.id, location),
      handOver: () => updateJudge(judge.id, { handedOverAt: new Date().toISOString() }, tr("Badge juge remis.", "Judge badge handed over.")),
    })),
    ...acceptedPressRegistrations.map((registration) => ({
      key: `p:${registration.id}`,
      name: `${registration.firstName || ""} ${registration.lastName || ""}`.trim() || registration.media || "Presse",
      role: [registration.requestType === "photographer" ? tr("Photographe", "Photographer") : "", registration.media].filter(Boolean).join(" · "),
      kind: "Presse",
      step: getBadgeStep(registration).step,
      location: getPressStorageLocation(registration.id),
      setLocation: (location) => updatePressBadgeStorageLocation(registration.id, location),
      handOver: () => markPressBadgeHandedOver(registration),
    })),
    ...nationalAthletes.map((request) => {
      const key = nationalBadgeKey(request.id);
      return {
        key,
        name: `${request.firstName || ""} ${request.lastName || ""}`.trim(),
        role: getNationalRaceLabel(request),
        kind: "Course nationale",
        step: getBadgeStep(getVolunteerOverride(key)).step,
        location: getBadgeStorageLocation(key),
        setLocation: (location) => updateBadgeStorageLocation(key, location),
        handOver: () => markBadgeHandedOver({ id: key }),
      };
    }),
  ].filter((row) => row.step === "done" || row.step === "given");

  function openAccreditationTab(tabId) {
    if (!availableAccreditationTabs.includes(tabId)) return;
    const nextPath = ACCREDITATION_TAB_PATHS[tabId] || ACCREDITATION_TAB_PATHS.people;
    setActiveAccreditationTab(tabId);
    if (location.pathname !== nextPath) {
      navigate(nextPath);
    }
  }

  useEffect(() => {
    // Ne jamais tourner avant que TOUT soit chargé : pendant le chargement chaque bénévole
    // paraît « non affecté » et était annulé à tort (bug Lily / Margot, nov. 2026).
    if (!accreditationDataReady) return undefined;

    const invalidVolunteerUpdates = volunteers
      .map((volunteer) => {
        const override = getVolunteerOverride(volunteer.id);

        if (!isVolunteerAccreditationInvalid(volunteer)) {
          // Personne (ré)affectée : on lève l'annulation automatique.
          if (override.printStatus === "Annulé" && override.warningMessage === AUTO_CANCEL_MESSAGE) {
            return {
              volunteerId: volunteer.id,
              override: { ...override, printStatus: "Non-imprimé", warningMessage: "" },
            };
          }
          if (
            override.printStatus === "Imprimé à détruire" &&
            override.warningMessage === AUTO_DESTROY_MESSAGE &&
            !override.destroyedAt
          ) {
            return {
              volunteerId: volunteer.id,
              override: { ...override, printStatus: "Imprimé", warningMessage: "" },
            };
          }
          if (override.destroyedAt) {
            // Ancien badge détruit puis réaffectation : nouveau badge à produire.
            return {
              volunteerId: volunteer.id,
              override: {
                ...override,
                printStatus: "Non-imprimé",
                warningMessage: "",
                destroyedAt: null,
              },
            };
          }
          return null;
        }

        if (override.destroyedAt) return null;

        let nextPrintStatus;
        let nextWarningMessage;
        if (volunteerHasPrintedBadgeEvidence(volunteer.id)) {
          // Un badge physique existe : à récupérer ou détruire.
          nextPrintStatus = "Imprimé à détruire";
          nextWarningMessage = AUTO_DESTROY_MESSAGE;
        } else if (override.printStatus === "Dans la file") {
          nextPrintStatus = "Annulé";
          nextWarningMessage = AUTO_CANCEL_MESSAGE;
        } else {
          // Jamais imprimé ni en file : rien à annuler, la personne sort simplement de la liste.
          return null;
        }

        if (override.printStatus === nextPrintStatus && override.warningMessage === nextWarningMessage) return null;

        return {
          volunteerId: volunteer.id,
          override: {
            ...override,
            printStatus: nextPrintStatus,
            warningMessage: nextWarningMessage,
            lastQueuedAt: nextPrintStatus === "Annulé" ? null : override.lastQueuedAt,
          },
        };
      })
      .filter(Boolean);

    if (!invalidVolunteerUpdates.length) return undefined;

    const timeoutId = window.setTimeout(() => {
      persistAccreditationConfiguration(
        buildCurrentConfiguration({
          volunteerOverrides: {
            ...volunteerOverrides,
            ...Object.fromEntries(invalidVolunteerUpdates.map((entry) => [entry.volunteerId, entry.override])),
          },
        }),
        autoStatusUpdatedMessage,
      );
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [
    accreditationDataReady,
    autoStatusUpdatedMessage,
    buildCurrentConfiguration,
    getVolunteerOverride,
    normalizeSubRoles,
    persistAccreditationConfiguration,
    volunteerOverrides,
    volunteers,
  ]);

  useEffect(() => {
    if (!accreditationDataReady) return undefined;

    const printedUsersToReset = volunteers
      .map((volunteer) => {
        if (isVolunteerAccreditationInvalid(volunteer)) return null;
        const override = getVolunteerOverride(volunteer.id);
        const snapshot = override.printedSnapshot;
        const snapshotExists =
          snapshot.roleLabel || snapshot.roleNames.length || snapshot.zoneIds.length;
        if (!snapshotExists || override.printStatus !== "Imprimé") return null;

        const currentRoleLabel = getBadgeRoleLabel(volunteer, override, normalizeComparableValue);
        const currentRoleNames = normalizeSubRoles(volunteer.assignedRoles || [volunteer.assignedRole].filter(Boolean));
        const currentZoneIds = getFinalZoneIds(volunteer);
        const rolesChanged =
          JSON.stringify(snapshot.roleNames) !== JSON.stringify(currentRoleNames);
        const roleLabelChanged = snapshot.roleLabel !== currentRoleLabel;
        const zonesChanged = JSON.stringify(snapshot.zoneIds) !== JSON.stringify(currentZoneIds);

        if (!rolesChanged && !roleLabelChanged && !zonesChanged) return null;

        return {
          volunteerId: volunteer.id,
          override: {
            ...override,
            printStatus: "Non-imprimé",
            warningMessage:
              "Attention modification : les rôles, zones ou le libellé badge ont changé depuis la dernière impression.",
          },
        };
      })
      .filter(Boolean);

    if (!printedUsersToReset.length) return undefined;

    const timeoutId = window.setTimeout(() => {
      persistAccreditationConfiguration(
        buildCurrentConfiguration({
          volunteerOverrides: {
            ...volunteerOverrides,
            ...Object.fromEntries(printedUsersToReset.map((entry) => [entry.volunteerId, entry.override])),
          },
        }),
        autoResetMessage,
      );
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [
    accreditationDataReady,
    autoResetMessage,
    buildCurrentConfiguration,
    getBadgeRoleLabel,
    getFinalZoneIds,
    getVolunteerOverride,
    isVolunteerAccreditationInvalid,
    normalizeSubRoles,
    persistAccreditationConfiguration,
    volunteerOverrides,
    volunteers,
  ]);

  return (
    <div className="page accreditation-page">
      <section className="page-header">
        <div>
          {/* Le guichet a son propre titre : page à part. */}
          {activeAccreditationTab !== "desk" ? (
            <>
              <p className="eyebrow">{tr("Accès & jour J", "Access & meeting day")}</p>
              <h1>{tr("Accréditations", "Accreditations")}</h1>
              <p>
                {tr(
                  "Un badge passe par 3 étapes : à imprimer, imprimé, remis. On coche, on imprime ; le guichet remet les badges le jour J.",
                  "A badge goes through 3 steps: to print, printed, handed over. Tick, print; the desk hands the badges over on meeting day.",
                )}
              </p>
            </>
          ) : null}
          {teamsLoading || accreditationLoading || usersLoading ? <p className="panel-note">{tr("Chargement en cours...", "Loading...")}</p> : null}
          {teamsError || accreditationError ? <p className="panel-note">{teamsError || accreditationError}</p> : null}
          {accreditationStatus ? <p className="panel-note">{accreditationStatus}</p> : null}
          {isSavingAccreditation ? <p className="panel-note">{tr("Sauvegarde des accréditations...", "Saving...")}</p> : null}
        </div>
        {/* Guichet du jour J : page à part, ouverte seulement depuis ce bouton,
            au niveau de la page et pas dans les onglets (Margot, 12/11/2026). */}
        {canOperatePrinting && activeAccreditationTab !== "desk" ? (
          <button className="acc-desk-button" type="button" onClick={() => openAccreditationTab("desk")}>
            {tr("Ouvrir le guichet jour J ↗", "Open the meeting-day desk ↗")}
          </button>
        ) : null}
      </section>
      {activeAccreditationTab !== "desk" ? (
      <div className="admin-subtabs acc-tabs">
        {canOperatePrinting ? (
          <>
            <button
              className={`admin-subtab ${activeAccreditationTab === "people" || activeAccreditationTab === "history" ? "admin-subtab--active" : ""}`}
              type="button"
              onClick={() => openAccreditationTab("people")}
            >
              Badges
            </button>
            <button
              className={`admin-subtab ${["plans", "entrance", "judgesPlan", "controls"].includes(activeAccreditationTab) ? "admin-subtab--active" : ""}`}
              type="button"
              onClick={() => openAccreditationTab("plans")}
            >
              {tr("Plans & contrôles", "Plans & checks")}
            </button>
          </>
        ) : null}
        {canManageAccreditationConfiguration ? (
          <button
            className={`admin-subtab ${activeAccreditationTab === "settings" ? "admin-subtab--active" : ""}`}
            type="button"
            onClick={() => openAccreditationTab("settings")}
          >
            {tr("Réglages", "Settings")}
          </button>
        ) : null}
      </div>
      ) : null}

      {canOperatePrinting && ["plans", "entrance", "judgesPlan", "controls"].includes(activeAccreditationTab) ? (
        <div className="acc-type-switch" role="tablist" aria-label={tr("Plans et contrôles", "Plans and checks")}>
          {[
            ["plans", tr("Plan de la Coque", "Coque plan")],
            ["entrance", tr("Plan de l'entrée", "Entrance plan")],
            ["judgesPlan", tr("Plan des juges", "Judges plan")],
            ["controls", tr("Points de contrôle", "Checkpoints")],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={activeAccreditationTab === id}
              className={`acc-type-switch__item${activeAccreditationTab === id ? " is-active" : ""}`}
              onClick={() => openAccreditationTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}

      {canManageAccreditationConfiguration && activeAccreditationTab === "settings" ? (
        <>
          {/* Réglages en 4 parties, une à la fois (Margot, 12/11/2026 : la page
              était illisible avec tout empilé). */}
          <div className="acc-type-switch" role="tablist" aria-label={tr("Réglages", "Settings")}>
            {[
              ["roles", tr("Zones par rôle", "Zones by role")],
              ["zones", tr("Liste des zones", "Zone list")],
              ["boxes", tr("Boîtes du guichet", "Desk boxes")],
              ["qr", tr("QR sur les badges", "QR codes on badges")],
            ].map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={settingsSection === id}
                className={`acc-type-switch__item${settingsSection === id ? " is-active" : ""}`}
                onClick={() => setSettingsSection(id)}
              >
                {label}
              </button>
            ))}
          </div>

          {settingsSection === "roles" ? (
          <>
          <Panel
            title={tr("Zones par rôle", "Zones by role")}
            subtitle={tr(
              "Chaque rôle donne ses zones à toute personne affectée. Cliquez une case pour donner ou retirer une zone ; la couleur de la bande se choisit par rôle.",
              "Each role gives its zones to everyone assigned to it. Click a cell to give or remove a zone; the band colour is chosen per role.",
            )}
          >
            <div className="acc-matrix-toolbar">
              <input
                className="acc-people-search"
                placeholder={tr("Rechercher un rôle…", "Search a role…")}
                type="search"
                value={roleSearch}
                onChange={(event) => setRoleSearch(event.target.value)}
              />
              <span className="acc-people-muted">
                {tr(`${filteredRoles.length} rôle(s)`, `${filteredRoles.length} role(s)`)} · {sortedZones.length} zones
              </span>
            </div>
            <div className="table-wrap">
              <table className="acc-matrix">
                <thead>
                  <tr>
                    <th className="acc-matrix__role">{tr("Rôle", "Role")}</th>
                    <th className="acc-matrix__band">{tr("Bande du badge", "Badge band")}</th>
                    {sortedZones.map((zone) => (
                      <th key={zone.id} className="acc-matrix__zone" title={zone.name}>
                        <i>{zone.order}</i>
                        <span>{zone.name}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredRoles.map((role) => {
                    const roleZoneIds = getRoleZoneIds(role.id);
                    const categoryKey = roleBadgeCategories[role.id] || DEFAULT_ROLE_BADGE_CATEGORY;
                    const category = BADGE_CATEGORIES.find((item) => item.key === categoryKey);
                    return (
                      <tr key={role.id}>
                        <td className="acc-matrix__role">
                          <strong>{role.roleName}</strong>
                          <small>{roleZoneIds.length} zone{roleZoneIds.length > 1 ? "s" : ""}</small>
                        </td>
                        <td className="acc-matrix__band">
                          <span className="acc-matrix__category">
                            <i style={{ background: category?.color }} />
                            <select
                              aria-label={tr(`Bande du badge pour ${role.roleName}`, `Badge band for ${role.roleName}`)}
                              value={categoryKey}
                              onChange={(event) => setRoleBadgeCategory(role.id, event.target.value)}
                            >
                              {BADGE_CATEGORIES.filter((item) => ["volunteer", "organisation", "technical"].includes(item.key)).map((item) => (
                                <option key={item.key} value={item.key}>
                                  {item.label}
                                </option>
                              ))}
                            </select>
                          </span>
                        </td>
                        {sortedZones.map((zone) => {
                          const on = roleZoneIds.includes(zone.id);
                          return (
                            <td key={zone.id} className="acc-matrix__cell">
                              <button
                                aria-label={on
                                  ? tr(`Retirer ${zone.name} à ${role.roleName}`, `Remove ${zone.name} from ${role.roleName}`)
                                  : tr(`Donner ${zone.name} à ${role.roleName}`, `Give ${zone.name} to ${role.roleName}`)}
                                aria-pressed={on}
                                className={`acc-matrix__toggle${on ? " is-on" : ""}`}
                                style={on ? { background: category?.color } : undefined}
                                type="button"
                                onClick={() => toggleRoleZone(role.id, zone.id)}
                              />
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                  {!filteredRoles.length ? (
                    <tr>
                      <td className="acc-people-empty" colSpan={sortedZones.length + 2}>
                        {tr("Aucun rôle ne correspond à la recherche.", "No role matches the search.")}
                      </td>
                    </tr>
                  ) : null}
                  <tr className="acc-matrix__group">
                    <td colSpan={sortedZones.length + 2}>
                      {tr("Badges sans nom", "Badges without names")}{" "}
                      <small>{tr("imprimés en lot dans Badges › Sans nom", "printed in batches in Badges › Without name")}</small>
                      <button className="acc-link-button" type="button" onClick={addNamelessType}>
                        {tr("+ Type sans nom", "+ Type without name")}
                      </button>
                    </td>
                  </tr>
                  {namelessBadgeTypes.map((type) => {
                    const category = BADGE_CATEGORIES.find((item) => item.key === type.category);
                    return (
                      <tr key={`nameless-${type.id}`}>
                        <td className="acc-matrix__role">
                          {type.builtIn ? (
                            <strong>{type.label}</strong>
                          ) : (
                            <input
                              aria-label={tr("Nom imprimé sur le badge", "Name printed on the badge")}
                              className="acc-matrix__name"
                              defaultValue={type.label}
                              onBlur={(event) => event.target.value.trim() && event.target.value.trim() !== type.label && updateNamelessType(type.id, { label: event.target.value.trim() })}
                            />
                          )}
                          <small>
                            {tr("sans nom", "without name")}
                            {type.builtIn ? null : (
                              <button className="acc-link-button acc-link-button--danger" type="button" onClick={() => removeNamelessType(type.id)}>
                                {tr("supprimer", "delete")}
                              </button>
                            )}
                          </small>
                        </td>
                        <td className="acc-matrix__band">
                          <span className="acc-matrix__category">
                            <i style={{ background: category?.color }} />
                            <select aria-label={tr(`Bande du badge ${type.label}`, `Badge band ${type.label}`)} value={type.category} onChange={(event) => updateNamelessType(type.id, { category: event.target.value })}>
                              {BADGE_CATEGORIES.map((item) => (
                                <option key={item.key} value={item.key}>
                                  {item.label}
                                </option>
                              ))}
                            </select>
                          </span>
                        </td>
                        {sortedZones.map((zone) => {
                          const on = type.zoneIds.includes(zone.id);
                          return (
                            <td key={zone.id} className="acc-matrix__cell">
                              <button
                                aria-label={on
                                  ? tr(`Retirer ${zone.name} au badge ${type.label}`, `Remove ${zone.name} from the ${type.label} badge`)
                                  : tr(`Donner ${zone.name} au badge ${type.label}`, `Give ${zone.name} to the ${type.label} badge`)}
                                aria-pressed={on}
                                className={`acc-matrix__toggle${on ? " is-on" : ""}`}
                                style={on ? { background: category?.color } : undefined}
                                type="button"
                                onClick={() => updateNamelessType(type.id, { zoneIds: toggleZone(type.zoneIds, zone.id) })}
                              />
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                  <tr className="acc-matrix__group">
                    <td colSpan={sortedZones.length + 2}>
                      {tr("Courses nationales", "National races")}{" "}
                      <small>{tr("badge nominatif, nom repris des athlètes retenus", "named badge, name taken from the selected athletes")}</small>
                    </td>
                  </tr>
                  {(() => {
                    const category = BADGE_CATEGORIES.find((item) => item.key === nationalBadge.category);
                    return (
                      <tr>
                        <td className="acc-matrix__role">
                          <strong>{nationalBadge.label}</strong>
                          <small>{tr(`${nationalAthletes.length} athlète(s) retenu(s)`, `${nationalAthletes.length} selected athlete(s)`)}</small>
                        </td>
                        <td className="acc-matrix__band">
                          <span className="acc-matrix__category">
                            <i style={{ background: category?.color }} />
                            <select aria-label={tr("Bande du badge course nationale", "National race badge band")} value={nationalBadge.category} onChange={(event) => updateNationalBadge({ category: event.target.value })}>
                              {BADGE_CATEGORIES.map((item) => (
                                <option key={item.key} value={item.key}>
                                  {item.label}
                                </option>
                              ))}
                            </select>
                          </span>
                        </td>
                        {sortedZones.map((zone) => {
                          const on = nationalBadge.zoneIds.includes(zone.id);
                          return (
                            <td key={zone.id} className="acc-matrix__cell">
                              <button
                                aria-label={on
                                  ? tr(`Retirer ${zone.name} aux courses nationales`, `Remove ${zone.name} from national races`)
                                  : tr(`Donner ${zone.name} aux courses nationales`, `Give ${zone.name} to national races`)}
                                aria-pressed={on}
                                className={`acc-matrix__toggle${on ? " is-on" : ""}`}
                                style={on ? { background: category?.color } : undefined}
                                type="button"
                                onClick={() => updateNationalBadge({ zoneIds: toggleZone(nationalBadge.zoneIds, zone.id) })}
                              />
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })()}
                </tbody>
              </table>
            </div>
            <p className="acc-people-muted">
              {tr(
                "Les juges et la presse ont leurs zones dans leur propre liste (onglet Badges). Les zones ajoutées ou retirées à une personne se règlent dans sa fiche.",
                "Judges and press have their zones in their own list (Badges tab). Zones added or removed for one person are set in their details.",
              )}
            </p>
          </Panel>
          </>
          ) : null}

          {settingsSection === "zones" ? (
          <>
          <Panel
            title={tr("Liste des zones", "Zone list")}
            subtitle={tr(
              "Le numéro est imprimé au dos du badge et sur le plan de la Coque. Cette liste fait foi : les zones du plan reprennent ces noms.",
              "The number is printed on the back of the badge and on the Coque plan. This list is the reference: the plan zones use these names.",
            )}
          >
            <div className="table-wrap">
              <table className="acc-zone-table">
                <thead>
                  <tr>
                    <th>{tr("N°", "No.")}</th>
                    <th>{tr("Nom", "Name")}</th>
                    <th>{tr("Sur le plan des badges", "On the badge plan")}</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {sortedZones.map((zone) => {
                    const placed = zonePlacement.counts.get(Number(zone.order)) || 0;
                    return (
                      <tr key={zone.id}>
                        <td>
                          <input
                            aria-label={tr(`Numéro de ${zone.name}`, `Number of ${zone.name}`)}
                            className="acc-zone-table__num"
                            min="1"
                            type="number"
                            value={zone.order}
                            onChange={(event) => updateZone(zone.id, "order", event.target.value)}
                          />
                        </td>
                        <td>
                          <input
                            aria-label={tr("Nom de la zone", "Zone name")}
                            className="acc-zone-table__name"
                            value={zone.name}
                            onChange={(event) => updateZone(zone.id, "name", event.target.value)}
                            onBlur={() => syncZoneNamesToPlan()}
                          />
                        </td>
                        <td>
                          {placed ? (
                            <span className="acc-step acc-step--given">
                              {tr("✓ placée", "✓ placed")}
                              {placed > 1 ? tr(` (${placed} repères)`, ` (${placed} markers)`) : ""}
                            </span>
                          ) : (
                            <span className="acc-step acc-step--attn">{tr("pas encore sur le plan", "not on the plan yet")}</span>
                          )}
                        </td>
                        <td className="acc-people-actions">
                          <button className="button button--ghost-danger button--small" type="button" onClick={() => removeZone(zone.id)}>
                            {tr("Supprimer", "Delete")}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {zonePlacement.orphans.length ? (
              <p className="acc-step-reason">
                {zonePlacement.orphans.length > 1
                  ? tr(
                      `Sur le plan, les repères n° ${zonePlacement.orphans.join(", ")} ne correspondent à aucune zone de cette liste : à corriger dans Plans & contrôles.`,
                      `On the plan, markers no. ${zonePlacement.orphans.join(", ")} match no zone in this list: fix them in Plans & checks.`,
                    )
                  : tr(
                      `Sur le plan, le repère n° ${zonePlacement.orphans.join(", ")} ne correspond à aucune zone de cette liste : à corriger dans Plans & contrôles.`,
                      `On the plan, marker no. ${zonePlacement.orphans.join(", ")} matches no zone in this list: fix it in Plans & checks.`,
                    )}
              </p>
            ) : null}
            <div className="acc-zone-add">
              <input
                aria-label={tr("Nouvelle zone", "New zone")}
                placeholder={tr("Nouvelle zone, ex. Media lounge", "New zone, e.g. Media lounge")}
                value={newZoneName}
                onChange={(event) => setNewZoneName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") addZone();
                }}
              />
              <button className="button button--secondary button--small" type="button" onClick={addZone} disabled={!newZoneName.trim()}>
                {tr("Ajouter", "Add")}
              </button>
              <span className="acc-people-muted">
                {tr("Placez-la ensuite sur le plan (Plans & contrôles › Plan de la Coque).", "Then place it on the plan (Plans & checks › Coque plan).")}
              </span>
            </div>
          </Panel>

          </>
          ) : null}

          {settingsSection === "boxes" ? (
          <>
          <Panel
            title={tr("Boîtes du guichet", "Desk boxes")}
            subtitle={tr(
              "Les boîtes où sont rangés les badges imprimés, choisies au guichet le jour J.",
              "The boxes where printed badges are stored, picked at the desk on meeting day.",
            )}
          >
            <div className="accreditation-zone-list">
              {customStorageLocations.length === 0 ? (
                <p className="panel-note">{tr("Aucune boîte définie. Ajoutez-en une ci-dessous.", "No box yet. Add one below.")}</p>
              ) : null}
              {customStorageLocations.map((loc) => (
                <div key={loc} className="tracking-location-row">
                  <span>{loc}</span>
                  <button
                    className="button button--ghost-danger button--small"
                    type="button"
                    onClick={() => removeCustomStorageLocation(loc)}
                  >
                    {tr("Supprimer", "Delete")}
                  </button>
                </div>
              ))}
            </div>
            <div className="accreditation-zone-add">
              <label className="field">
                <span>{tr("Nouvelle boîte", "New box")}</span>
                <input
                  placeholder={tr("Ex : Boîte A–F", "E.g. Box A–F")}
                  value={newStorageLocationName}
                  onChange={(event) => setNewStorageLocationName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") addCustomStorageLocation();
                  }}
                />
              </label>
              <button
                className="button button--secondary"
                type="button"
                onClick={addCustomStorageLocation}
                disabled={!newStorageLocationName.trim()}
              >
                {tr("Ajouter", "Add")}
              </button>
            </div>
          </Panel>

          </>
          ) : null}

          {settingsSection === "qr" ? (
          <>
        <section className="admin-stack">
          <Panel
            title={tr("Affectation des QR par visuel", "QR codes by badge design")}
            subtitle={tr(
              "Choisissez quelles ressources QR doivent apparaître sur chaque type d'accréditation.",
              "Choose which QR resources appear on each badge type.",
            )}
          >
            <div className="admin-split accreditation-role-layout">
              <div className="admin-split__nav accreditation-role-nav">
                <div className="accreditation-role-nav__meta">
                  <span>{tr(`${ACCREDITATION_BADGE_VISUALS.length} visuel(x)`, `${ACCREDITATION_BADGE_VISUALS.length} design(s)`)}</span>
                  <span>{tr(`${qrResources.length} ressource(s) réutilisable(s)`, `${qrResources.length} reusable resource(s)`)}</span>
                </div>
                <div className="accreditation-role-list">
                  {ACCREDITATION_BADGE_VISUALS.map((visual) => (
                    <button
                      key={visual.id}
                      className={`role-chip ${effectiveSelectedQrVisualId === visual.id ? "role-chip--active" : ""}`}
                      type="button"
                      onClick={() => setSelectedQrVisualId(visual.id)}
                    >
                      <span className="accreditation-role-list__label">{getVisualLabel(visual)}</span>
                      <span className="accreditation-role-list__count">
                        {(qrVisualAssignments[visual.id] ?? []).length} QR
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {selectedQrVisual ? (
                <div className="admin-stack">
                  <Panel
                    title={getVisualLabel(selectedQrVisual)}
                    subtitle={getVisualDescription(selectedQrVisual)}
                    actions={
                      <button
                        className="button button--secondary button--small"
                        type="button"
                        onClick={() =>
                          persistAccreditationConfiguration(
                            buildCurrentConfiguration({
                              qrVisualAssignments: {
                                ...qrVisualAssignments,
                                [selectedQrVisual.id]: [],
                              },
                            }),
                            tr("Toutes les ressources QR ont été retirées de ce visuel.", "All QR resources were removed from this design."),
                          )
                        }
                      >
                        {tr("Vider ce visuel", "Clear this design")}
                      </button>
                    }
                  >
                    <div className="choice-grid choice-grid--2">
                      {qrResources.map((resource) => {
                        const isAssigned = selectedQrVisualResourceIds.includes(resource.id);
                        const usageVisualLabels = (qrResourceUsageById[resource.id] ?? [])
                          .map(
                            (visualId) =>
                              getVisualLabel(ACCREDITATION_BADGE_VISUALS.find((visual) => visual.id === visualId)) || visualId,
                          );

                        return (
                          <label
                            key={`visual-${selectedQrVisual.id}-${resource.id}`}
                            className="selection-card selection-card--compact accreditation-zone-option"
                          >
                            <input
                              type="checkbox"
                              checked={isAssigned}
                              onChange={() => toggleQrResourceAssignment(selectedQrVisual.id, resource.id)}
                            />
                            <div>
                              <div className="accreditation-zone-option__top">
                                <strong>{resource.label}</strong>
                                <span className={`accreditation-tag ${isAssigned ? "accreditation-tag--active" : ""}`}>
                                  {isAssigned ? tr("Affiché", "Shown") : tr("Masqué", "Hidden")}
                                </span>
                              </div>
                              <p>{resource.subtitle || tr("Aucun sous-titre renseigné.", "No subtitle.")}</p>
                              <p className="panel-note">{getQrResourceTargetSummary(resource)}</p>
                              {usageVisualLabels.length ? (
                                <div className="accreditation-tag-list">
                                  {usageVisualLabels.map((label) => (
                                    <span key={`${resource.id}-${label}`} className="accreditation-tag">
                                      {label}
                                    </span>
                                  ))}
                                </div>
                              ) : null}
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </Panel>
                </div>
              ) : null}
            </div>
          </Panel>

          <Panel
            title={tr("Bibliothèque des ressources QR", "QR resource library")}
            subtitle={tr(
              "Créez ici les ressources QR réutilisables : document existant, nouveau document uploadé ou lien externe.",
              "Create reusable QR resources here: existing document, newly uploaded document or external link.",
            )}
          >
            {documentsLoading ? <p className="panel-note">{tr("Chargement des documents...", "Loading documents...")}</p> : null}
            {documentsError ? <p className="panel-note">{documentsError}</p> : null}

            <div className="table-wrap">
              <table className="data-table data-table--admin">
                <thead>
                  <tr>
                    <th>{tr("Ressource", "Resource")}</th>
                    <th>Type</th>
                    <th>{tr("Cible", "Target")}</th>
                    <th>{tr("Utilisée sur", "Used on")}</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {qrResources.map((resource) => {
                    const usageVisualLabels = (qrResourceUsageById[resource.id] ?? [])
                      .map(
                        (visualId) =>
                          getVisualLabel(ACCREDITATION_BADGE_VISUALS.find((visual) => visual.id === visualId)) || visualId,
                      )
                      .join(", ");

                    return (
                      <tr key={resource.id}>
                        <td>
                          <strong>{resource.label}</strong>
                          {resource.subtitle ? <p className="panel-note">{resource.subtitle}</p> : null}
                        </td>
                        <td>
                          {resource.source
                            ? tr("Repris de MyCLIM", "Taken from MyCLIM")
                            : resource.targetType === "document"
                              ? "Document"
                              : tr("Lien externe", "External link")}
                        </td>
                        <td>{getQrResourceTargetSummary(resource)}</td>
                        <td>{usageVisualLabels || tr("Non utilisée", "Not used")}</td>
                        <td>
                          <div className="panel-actions">
                            <button
                              className="button button--secondary button--small"
                              type="button"
                              onClick={() => editQrResource(resource)}
                            >
                              {tr("Modifier", "Edit")}
                            </button>
                            <button
                              className="button button--ghost-danger button--small"
                              type="button"
                              onClick={() => removeQrResource(resource.id)}
                            >
                              {tr("Supprimer", "Delete")}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {!qrResources.length ? (
                    <tr>
                      <td colSpan="5">{tr("Aucune ressource QR configurée pour le moment.", "No QR resource set up yet.")}</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>

            <div className="admin-stack" style={{ marginTop: "1rem" }}>
              <div className="form-section-head">
                <p className="eyebrow">{tr("Ressource QR", "QR resource")}</p>
                <h3>{editingQrResourceId ? tr("Modifier une ressource", "Edit a resource") : tr("Ajouter une ressource", "Add a resource")}</h3>
              </div>
              <div className="field-grid">
                <AuthFormField label={tr("Libellé", "Label")}>
                  <input
                    name="label"
                    placeholder={tr("Ex: Roadbook athlètes", "E.g. Athlete roadbook")}
                    value={qrResourceForm.label}
                    onChange={handleQrResourceFormChange}
                  />
                </AuthFormField>
                <AuthFormField label={tr("Sous-titre", "Subtitle")}>
                  <input
                    name="subtitle"
                    placeholder={tr("Ex: Informations utiles meeting", "E.g. Useful meeting info")}
                    value={qrResourceForm.subtitle}
                    onChange={handleQrResourceFormChange}
                  />
                </AuthFormField>
              </div>
              <AuthFormField label={tr("Type de cible", "Target type")}>
                <select
                  name="targetMode"
                  value={qrResourceForm.targetMode}
                  onChange={handleQrResourceFormChange}
                >
                  <option value="linked">{tr("Lien déjà saisi dans MyCLIM", "Link already set in MyCLIM")}</option>
                  <option value="document_existing">{tr("Document existant", "Existing document")}</option>
                  <option value="document_upload">{tr("Téléverser un document ici", "Upload a document here")}</option>
                  <option value="url">{tr("Lien externe", "External link")}</option>
                </select>
              </AuthFormField>

              {qrResourceForm.targetMode === "linked" ? (
                <label className="field">
                  <span>{tr("Lien repris", "Linked source")}</span>
                  <select name="source" value={qrResourceForm.source} onChange={handleQrResourceFormChange}>
                    {QR_LINK_SOURCES.map((item) => (
                      <option key={item.key} value={item.key}>
                        {getLinkSourceLabel(item)} ({getLinkSourceWhere(item)})
                      </option>
                    ))}
                  </select>
                  <small className="panel-note">
                    {tr(
                      `Lien actuel : ${getLinkedSourceUrl(qrResourceForm.source) || "pas encore renseigné à cet endroit"}. Le badge suit ce lien : changez-le là-bas, pas ici.`,
                      `Current link: ${getLinkedSourceUrl(qrResourceForm.source) || "not set there yet"}. The badge follows this link: change it there, not here.`,
                    )}
                  </small>
                </label>
              ) : null}

              {qrResourceForm.targetMode === "document_existing" ? (
                <AuthFormField label={tr("Document à utiliser", "Document to use")}>
                  <select
                    name="documentId"
                    value={qrResourceForm.documentId}
                    onChange={handleQrResourceFormChange}
                  >
                    <option value="">{tr("Sélectionner un document", "Select a document")}</option>
                    {documents.map((documentItem) => (
                      <option key={documentItem.id} value={documentItem.id}>
                        {documentItem.title}
                      </option>
                    ))}
                  </select>
                </AuthFormField>
              ) : null}

              {qrResourceForm.targetMode === "document_upload" ? (
                <div className="admin-stack">
                  <FileUpload
                    value={qrResourceForm.uploadedFileUrl}
                    onChange={(url) =>
                      setQrResourceForm((current) => ({
                        ...current,
                        uploadedFileUrl: url,
                      }))
                    }
                    onUploadComplete={(uploadMeta) =>
                      setQrResourceForm((current) => ({
                        ...current,
                        uploadedFileUrl: uploadMeta.url,
                        uploadedFileName: uploadMeta.fileName || "",
                        uploadedFilePath: uploadMeta.filePath || "",
                      }))
                    }
                    accept=".pdf,image/*"
                    storagePath="accreditations/documents"
                    label={tr("Document à téléverser", "Document to upload")}
                    helperText={tr(
                      "PDF ou image · sera aussi enregistré dans la bibliothèque Documents",
                      "PDF or image · also saved in the Documents library",
                    )}
                  />
                  {qrResourceForm.uploadedFileName ? (
                    <p className="panel-note">{tr("Fichier prêt", "File ready")}: {qrResourceForm.uploadedFileName}</p>
                  ) : null}
                </div>
              ) : null}

              {qrResourceForm.targetMode === "url" ? (
                <AuthFormField label="URL">
                  <input
                    name="url"
                    type="url"
                    placeholder="https://..."
                    value={qrResourceForm.url}
                    onChange={handleQrResourceFormChange}
                  />
                </AuthFormField>
              ) : null}

              <div className="panel-actions">
                <button
                  className="button button--primary"
                  type="button"
                  onClick={saveQrResource}
                >
                  {editingQrResourceId ? tr("Enregistrer la ressource", "Save the resource") : tr("Ajouter la ressource", "Add the resource")}
                </button>
                {editingQrResourceId ? (
                  <button
                    className="button button--secondary"
                    type="button"
                    onClick={resetQrResourceForm}
                  >
                    {tr("Annuler", "Cancel")}
                  </button>
                ) : null}
              </div>
            </div>
          </Panel>
        </section>
          </>
          ) : null}
        </>
      ) : canOperatePrinting && activeAccreditationTab === "people" ? (
        <section className="admin-stack">
          <div className="acc-type-switch" role="tablist" aria-label={tr("Type d’accréditation", "Badge type")}>
            {[
              { id: "volunteers", label: tr("Bénévoles & staff", "Volunteers & staff"), count: printableVolunteers.length },
              { id: "judges", label: tr("Juges", "Judges"), count: activeJudges.length },
              { id: "press", label: tr("Presse", "Press"), count: acceptedPressRegistrations.length },
              { id: "national", label: tr("Courses nationales", "National races"), count: nationalAthletes.length },
              { id: "vip", label: "VIP", count: queuedVipBadgeCount },
              { id: "nominless", label: tr("Sans nom (athlètes, coachs)", "Without name (athletes, coaches)"), count: null },
            ].map((type) => (
              <button
                key={type.id}
                type="button"
                role="tab"
                aria-selected={peopleType === type.id}
                className={`acc-type-switch__item${peopleType === type.id ? " is-active" : ""}`}
                onClick={() => setPeopleType(type.id)}
              >
                {type.label}
                {type.count === null ? null : <span className="acc-people-filter__count">{type.count}</span>}
              </button>
            ))}
          </div>

          <div className="acc-badges-links">
            <button className="acc-link-button" type="button" onClick={openSampleAccreditation}>
              {tr("Voir un exemple de badge", "See a sample badge")}
            </button>
            <button className="acc-link-button" type="button" onClick={() => openAccreditationTab("history")}>
              {tr("Historique des impressions", "Print history")}
            </button>
          </div>

          {peopleType === "national" ? (
          <Panel
            title={tr("Courses nationales", "National races")}
            subtitle={tr(
              "Badge nominatif des athlètes retenus (pré-programme), lièvres compris. Les zones et la couleur se règlent dans Réglages › Zones par rôle.",
              "Named badge for the selected athletes (pre-programme), pacers included. Zones and colour are set in Settings › Zones by role.",
            )}
          >
            <div className="table-wrap">
              <table className="data-table data-table--admin acc-people-table">
                <thead>
                  <tr>
                    <th className="acc-cb" aria-label={tr("Cocher", "Select")} />
                    <th>{tr("Athlète", "Athlete")}</th>
                    <th>{tr("Course", "Race")}</th>
                    <th>Zones</th>
                    <th>{tr("Étape", "Step")}</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {nationalAthletes.map((request) => {
                    const key = nationalBadgeKey(request.id);
                    const stepInfo = getBadgeStep(getVolunteerOverride(key));
                    return (
                      <tr key={request.id}>
                        <td className="acc-cb">
                          {canPrintStep(stepInfo) ? (
                            <input
                              aria-label={tr(`Cocher ${request.firstName} ${request.lastName}`, `Select ${request.firstName} ${request.lastName}`)}
                              checked={printSelection.has(key)}
                              type="checkbox"
                              onChange={(event) => togglePrintSelection(key, event.target.checked)}
                            />
                          ) : null}
                        </td>
                        <td>
                          <span className="acc-people-name">{`${request.firstName || ""} ${request.lastName || ""}`.trim() || "—"}</span>
                        </td>
                        <td>{getNationalRaceLabel(request)}</td>
                        <td>
                          {nationalZoneLabels.length ? (
                            <span className="acc-people-zones">{nationalZoneLabels.join(", ")}</span>
                          ) : (
                            <span className="acc-people-muted">{tr("aucune zone", "no zone")}</span>
                          )}
                        </td>
                        <td>
                          {stepInfo.step ? <span className={STEP_PILL_CLASS[stepInfo.step]}>{tr(STEP_LABELS[stepInfo.step].fr, STEP_LABELS[stepInfo.step].en)}</span> : null}
                        </td>
                        <td className="acc-people-actions">
                          {stepInfo.step === "done" ? (
                            <button className="button button--secondary button--small" type="button" onClick={() => markBadgeHandedOver({ id: key })}>
                              {tr("Remis", "Handed over")}
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                  {!nationalAthletes.length ? (
                    <tr>
                      <td colSpan="6" className="acc-people-empty">
                        {tr("Aucun athlète retenu pour les courses nationales pour l'instant.", "No athlete selected for the national races yet.")}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            {renderPrintBar(
              nationalAthletes.filter((request) => canPrintStep(getBadgeStep(getVolunteerOverride(nationalBadgeKey(request.id))))),
              (request) => nationalBadgeKey(request.id),
              printNationalBadges,
            )}
          </Panel>
          ) : null}

          {peopleType === "vip" ? (
          <Panel
            title="VIP"
            subtitle={tr(
              "Badge VIP dédié, 8 par A4, +1 pour l’accompagnant nommé. Les invités se mettent en file dans VIP › Inscrits.",
              "Dedicated VIP badge, 8 per A4, +1 for the named companion. Guests are queued in VIP › Registered.",
            )}
          >
            {vipRegistrationsError || vipPrintError ? (
              <p className="form-error">{vipPrintError || vipRegistrationsError}</p>
            ) : null}
            <div className="table-wrap">
              <table className="data-table data-table--admin">
                <thead>
                  <tr>
                    <th>{tr("Personne", "Person")}</th>
                    <th>{tr("Entreprise", "Company")}</th>
                    <th>{tr("Accompagnant", "Companion")}</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {queuedVip.map((registration) => (
                    <tr key={`vip-queue-${registration.sourceCollection}-${registration.id}`}>
                      <td>{`${registration.firstName || ""} ${registration.lastName || ""}`.trim() || "—"}</td>
                      <td>{registration.organization || "—"}</td>
                      <td>
                        {`${registration.guestFirstName || ""} ${registration.guestLastName || ""}`.trim() || "—"}
                      </td>
                      <td>
                        <button
                          className="button button--ghost-danger button--small"
                          type="button"
                          onClick={() => updateVipBadgeStatus([registration], "non_imprime")}
                        >
                          {tr("Retirer", "Remove")}
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!queuedVip.length ? (
                    <tr>
                      <td colSpan="4">{tr("Aucun invité VIP n'est actuellement dans la file d'impression.", "No VIP guest in the print queue right now.")}</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>

            <div className="table-actions table-actions--inline">
              <button
                className="button button--secondary"
                type="button"
                onClick={() => updateVipBadgeStatus(unprintedVip, "en_file")}
                disabled={!unprintedVip.length}
              >
                {tr(`+ File : inscrits sans badge (${unprintedVip.length})`, `+ Queue: registered without badge (${unprintedVip.length})`)}
              </button>
              <button
                className="button button--primary"
                type="button"
                onClick={finalizeVipPrintQueue}
                disabled={!queuedVip.length}
              >
                {tr("Générer le PDF", "Generate the PDF")} ({queuedVipBadgeCount} badge{queuedVipBadgeCount > 1 ? "s" : ""})
              </button>
            </div>
          </Panel>

          ) : null}

          {peopleType === "nominless" ? (
          <Panel
            title={tr("Badges sans nom", "Badges without names")}
            subtitle={tr(
              "Athlètes et coachs : badges sans nom, zones du modèle. Chaque lot est gardé dans l’historique.",
              "Athletes and coaches: badges without names, zones from the template. Each batch is kept in the history.",
            )}
          >
            <div className="acc-add-form__row acc-add-form__row--end">
              <label className="acc-mini-field">
                <span>Type</span>
                <select
                  value={effectiveSelectedNonNominativeTemplateId}
                  onChange={(event) => setSelectedNonNominativeTemplateId(event.target.value)}
                >
                  {namelessBadgeTypes.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="acc-mini-field acc-mini-field--narrow">
                <span>{tr("Quantité", "Quantity")}</span>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={nonNominativeQuantity}
                  onChange={(event) => setNonNominativeQuantity(event.target.value)}
                />
              </label>
              <button
                className="button button--primary button--small"
                type="button"
                onClick={generateNonNominativeBadgePdf}
                disabled={!selectedNonNominativeTemplate}
              >
                {tr("Générer le PDF", "Generate the PDF")} ({Math.max(1, Number.parseInt(nonNominativeQuantity, 10) || 1)})
              </button>
            </div>
            <p className="acc-people-muted">
              {tr("Zones :", "Zones:")} {selectedNonNominativeZoneLabels.join(", ") || tr("aucune zone pour ce modèle", "no zone for this template")}
            </p>
          </Panel>
          ) : null}

          {peopleType === "volunteers" ? (
          <>
          <Panel
            title={tr("Personnes", "People")}
            subtitle={tr(
              "Cliquez sur une ligne pour voir sa fiche (zones, texte du badge, historique). Cochez des badges puis « Imprimer ».",
              "Click a row to see the details (zones, badge text, history). Tick badges, then “Print”.",
            )}
          >
            {unconfirmedVolunteersCount ? (
              <p className="panel-note acc-unconfirmed-note">
                {unconfirmedVolunteersCount > 1
                  ? tr(
                      `${unconfirmedVolunteersCount} bénévoles affectés mais pas encore confirmés : badge masqué jusqu'à la confirmation du poste.`,
                      `${unconfirmedVolunteersCount} volunteers assigned but not confirmed yet: badge hidden until the position is confirmed.`,
                    )
                  : tr(
                      `${unconfirmedVolunteersCount} bénévole affecté mais pas encore confirmé : badge masqué jusqu'à la confirmation du poste.`,
                      `${unconfirmedVolunteersCount} volunteer assigned but not confirmed yet: badge hidden until the position is confirmed.`,
                    )}
              </p>
            ) : null}
            <div className="acc-people-toolbar">
              <div className="acc-people-filters">
                {PEOPLE_FILTERS.map((filter) => (
                  <button
                    key={filter.id}
                    type="button"
                    className={`acc-people-filter${peopleFilter === filter.id ? " is-active" : ""}${
                      filter.id === "attention" && peopleBucketCounts.attention ? " acc-people-filter--alert" : ""
                    }`}
                    onClick={() => setPeopleFilter(filter.id)}
                  >
                    {tr(filter.label, filter.labelEn)}
                    <span className="acc-people-filter__count">{peopleBucketCounts[filter.id] ?? 0}</span>
                  </button>
                ))}
              </div>
              <input
                className="acc-people-search"
                type="search"
                placeholder={tr("Rechercher nom, email, rôle…", "Search name, email, role…")}
                value={volunteerSearch}
                onChange={(event) => setVolunteerSearch(event.target.value)}
              />
            </div>

            <div className="table-wrap">
              <table className="data-table data-table--admin accreditation-people-table acc-people-table">
                <thead>
                  <tr>
                    <th className="acc-cb" aria-label={tr("Cocher", "Select")} />
                    <th>{tr("Personne", "Person")}</th>
                    <th>{tr("Rôle badge", "Badge role")}</th>
                    <th>Zones</th>
                    <th>{tr("Étape", "Step")}</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {visiblePrintableVolunteers.map((volunteer) => {
                    const override = getVolunteerOverride(volunteer.id);
                    const isSelected = effectiveSelectedVolunteerId === volunteer.id;
                    const isInvalid = isVolunteerAccreditationInvalid(volunteer);
                    const canDestroyBadge = override.printStatus === "Imprimé à détruire";
                    const isConfirmed =
                      getConfirmedAccreditationRoleNames(volunteer, normalizeComparableValue).length > 0;
                    const zoneLabels = getFinalZoneLabels(volunteer);
                    const stepInfo = getVolunteerStep(volunteer);
                    const printable = isConfirmed && canPrintStep(stepInfo);
                    const selectionKey = `v:${volunteer.id}`;
                    return (
                      <tr
                        key={volunteer.id}
                        className={`accreditation-people-row${isSelected ? " row--selected" : ""}${
                          stepInfo.step === "attn" ? " row--warning" : ""
                        }`}
                        onClick={() => setSelectedVolunteerId(volunteer.id)}
                      >
                        <td className="acc-cb" onClick={(event) => event.stopPropagation()}>
                          {printable ? (
                            <input
                              aria-label={tr(`Cocher ${volunteer.firstName} ${volunteer.lastName}`, `Select ${volunteer.firstName} ${volunteer.lastName}`)}
                              checked={printSelection.has(selectionKey)}
                              type="checkbox"
                              onChange={(event) => togglePrintSelection(selectionKey, event.target.checked)}
                            />
                          ) : null}
                        </td>
                        <td>
                          <span className="acc-people-name">
                            {`${volunteer.firstName} ${volunteer.lastName}`.trim() || volunteer.email}
                          </span>
                        </td>
                        <td>
                          {getBadgeRoleLabel(volunteer, override, normalizeComparableValue) || "—"}
                          {!isConfirmed && !isInvalid ? (
                            <span className="acc-people-tag" title={tr("Affectation pas encore confirmée", "Assignment not confirmed yet")}>
                              {tr("non confirmé", "not confirmed")}
                            </span>
                          ) : null}
                        </td>
                        <td>
                          {zoneLabels.length ? (
                            <span className="acc-people-zones" title={zoneLabels.join(", ")}>
                              {zoneLabels.join(", ")}
                            </span>
                          ) : (
                            <span className="acc-people-muted" title={tr("Aucune zone liée à ce rôle (Réglages › zones par rôle)", "No zone linked to this role (Settings › zones by role)")}>
                              {tr("aucune zone", "no zone")}
                            </span>
                          )}
                        </td>
                        <td>
                          <span className="acc-people-status">
                            {stepInfo.step ? <span className={STEP_PILL_CLASS[stepInfo.step]}>{tr(STEP_LABELS[stepInfo.step].fr, STEP_LABELS[stepInfo.step].en)}</span> : null}
                            {stepInfo.reason ? <small className="acc-step-reason">{tr(REASON_LABELS[stepInfo.reason].fr, REASON_LABELS[stepInfo.reason].en)}</small> : null}
                          </span>
                        </td>
                        <td className="acc-people-actions" onClick={(event) => event.stopPropagation()}>
                          {canDestroyBadge ? (
                            <button
                              className="button button--ghost-danger button--small"
                              type="button"
                              title={tr("Le badge imprimé a été récupéré et détruit", "The printed badge was collected and destroyed")}
                              onClick={() => markBadgeDestroyed(volunteer)}
                            >
                              {tr("Récupéré", "Collected")}
                            </button>
                          ) : null}
                          {stepInfo.step === "done" ? (
                            <button
                              className="button button--secondary button--small"
                              type="button"
                              title={tr("Badge donné à la personne", "Badge given to the person")}
                              onClick={() => markBadgeHandedOver(volunteer)}
                            >
                              {tr("Remis", "Handed over")}
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                  {!filteredPrintableVolunteers.length ? (
                    <tr>
                      <td colSpan="6" className="acc-people-empty">
                        {printableVolunteers.length
                          ? tr("Aucune personne à cette étape.", "No one at this step.")
                          : tr("Aucune personne n'a encore été affectée à un rôle.", "No one has been assigned to a role yet.")}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            {renderPrintBar(
              filteredPrintableVolunteers.filter(
                (volunteer) =>
                  getConfirmedAccreditationRoleNames(volunteer, normalizeComparableValue).length > 0 &&
                  canPrintStep(getVolunteerStep(volunteer)),
              ),
              (volunteer) => `v:${volunteer.id}`,
              finalizePrintQueue,
            )}
            {canShowMoreListItems("printable-volunteers", filteredPrintableVolunteers) ? (
              <div className="list-progressive-actions">
                <button
                  className="button button--secondary button--small"
                  type="button"
                  onClick={() => showMoreListItems("printable-volunteers")}
                >
                  {tr("Afficher 10 de plus", "Show 10 more")}
                </button>
              </div>
            ) : null}
          </Panel>

          {selectedVolunteer ? (
            <Panel
              title={`${selectedVolunteer.firstName} ${selectedVolunteer.lastName}`}
              subtitle={tr(
                "Zones héritées, ajustements manuels et libellé utilisé sur l'accréditation.",
                "Inherited zones, manual adjustments and the label used on the badge.",
              )}
            >
              {selectedVolunteerOverride.warningMessage ? (
                <div className="accreditation-warning-panel">
                  <strong>{tr("Attention modification", "Change warning")}</strong>
                  <p>
                    {tr(
                      selectedVolunteerOverride.warningMessage,
                      WARNING_MESSAGE_EN[selectedVolunteerOverride.warningMessage] || selectedVolunteerOverride.warningMessage,
                    )}
                  </p>
                </div>
              ) : null}

              {/* Fiche compacte (Margot, 12/11/2026 : plus de gros blocs) : une ligne
                  de résumé, les deux réglages côte à côte, puis une grille de zones
                  où un clic ajoute une zone ou retire une zone héritée du rôle. */}
              <div className="acc-person">
                <div className="acc-person__summary">
                  <span>{getRoleTableLabel(selectedVolunteer)}</span>
                  <span className="acc-person__dot" aria-hidden="true">·</span>
                  {(() => {
                    const { step } = getVolunteerStep(selectedVolunteer);
                    return step ? <span className={STEP_PILL_CLASS[step]}>{tr(STEP_LABELS[step].fr, STEP_LABELS[step].en)}</span> : null;
                  })()}
                  <span className="acc-person__dot" aria-hidden="true">·</span>
                  <span>
                    <strong>{getFinalZoneIds(selectedVolunteer).length}</strong> / {sortedZones.length} zones
                  </span>
                </div>

                <div className="acc-person__fields">
                  <label className="acc-person__field">
                    <span>{tr("Texte sur le badge", "Text on the badge")}</span>
                    <input
                      value={selectedVolunteerOverride.badgeLabel}
                      placeholder={buildAccreditationRoleLabel(selectedVolunteer.assignedRoles)}
                      onChange={(event) => updateVolunteerBadgeLabel(selectedVolunteer, event.target.value)}
                    />
                  </label>
                  <div className="acc-person__field">
                    <span>Actions</span>
                    <div className="acc-person__actions">
                      {(() => {
                        const stepInfo = getVolunteerStep(selectedVolunteer);
                        const confirmed = getConfirmedAccreditationRoleNames(selectedVolunteer, normalizeComparableValue).length > 0;
                        return (
                          <>
                            {confirmed && canPrintStep(stepInfo) ? (
                              <button className="button button--primary button--small" type="button" onClick={() => finalizePrintQueue([selectedVolunteer])}>
                                {stepInfo.step === "attn" ? tr("Réimprimer", "Reprint") : tr("Imprimer ce badge", "Print this badge")}
                              </button>
                            ) : null}
                            {stepInfo.step === "done" ? (
                              <>
                                <button className="button button--secondary button--small" type="button" onClick={() => markBadgeHandedOver(selectedVolunteer)}>
                                  {tr("Remis", "Handed over")}
                                </button>
                                <button
                                  className="button button--ghost button--small"
                                  title={tr("Imprimé par erreur : le badge redevient « à imprimer »", "Printed by mistake: the badge goes back to “to print”")}
                                  type="button"
                                  onClick={() => updateVolunteerPrintStatus(selectedVolunteer, "Non-imprimé")}
                                >
                                  {tr("Annuler l'impression", "Undo printing")}
                                </button>
                              </>
                            ) : null}
                            {stepInfo.step === "given" ? (
                              <button
                                className="button button--ghost button--small"
                                title={tr("Badge perdu : il faut en imprimer un nouveau", "Badge lost: a new one must be printed")}
                                type="button"
                                onClick={() => updateVolunteerPrintStatus(selectedVolunteer, "Non-imprimé")}
                              >
                                {tr("Badge perdu : réimprimer", "Badge lost: reprint")}
                              </button>
                            ) : null}
                            {stepInfo.reason === "recover" ? (
                              <button className="button button--ghost-danger button--small" type="button" onClick={() => markBadgeDestroyed(selectedVolunteer)}>
                                {tr("Récupéré", "Collected")}
                              </button>
                            ) : null}
                            {!confirmed && stepInfo.step === "todo" ? <small className="acc-step-reason">{tr("Poste pas encore confirmé.", "Position not confirmed yet.")}</small> : null}
                          </>
                        );
                      })()}
                    </div>
                  </div>
                </div>

                {(() => {
                  // Historique de ce badge (lots d'impression), plus récent d'abord.
                  const override = selectedVolunteerOverride;
                  const printed = printHistory
                    .flatMap((batch) => batch.items.filter((item) => item.volunteerId === selectedVolunteer.id))
                    .sort((left, right) => String(right.printedAt).localeCompare(String(left.printedAt)));
                  const events = [
                    ...(override.handedOverAt
                      ? [{ key: "given", text: tr(`Remis le ${formatDateTimeForDisplay(override.handedOverAt)}`, `Handed over on ${formatDateTimeForDisplay(override.handedOverAt)}`) }]
                      : []),
                    ...printed.map((item) => ({
                      key: item.id,
                      text: tr(
                        `Imprimé le ${formatDateTimeForDisplay(item.printedAt)}${item.generatedBy ? ` par ${item.generatedBy}` : ""}`,
                        `Printed on ${formatDateTimeForDisplay(item.printedAt)}${item.generatedBy ? ` by ${item.generatedBy}` : ""}`,
                      ),
                    })),
                    ...(override.destroyedAt
                      ? [{ key: "destroyed", text: tr(`Ancien badge détruit le ${formatDateTimeForDisplay(override.destroyedAt)}`, `Old badge destroyed on ${formatDateTimeForDisplay(override.destroyedAt)}`) }]
                      : []),
                  ];
                  return (
                    <div className="acc-person__history">
                      <span>{tr("Historique", "History")}</span>
                      {events.length ? (
                        <ul>
                          {events.map((event) => (
                            <li key={event.key}>{event.text}</li>
                          ))}
                        </ul>
                      ) : (
                        <small>{tr("Pas encore imprimé.", "Not printed yet.")}</small>
                      )}
                    </div>
                  );
                })()}

                <div className="acc-person__zones-head">
                  <span>Zones</span>
                  <small>{tr("Cliquer ajoute une zone pour cette personne, ou retire une zone donnée par son rôle.", "Click to add a zone for this person, or remove a zone given by their role.")}</small>
                </div>
                <div className="acc-person__zones">
                  {sortedZones.map((zone) => {
                    const inherited = inheritedZoneIds.includes(zone.id);
                    const added = selectedVolunteerOverride.addZoneIds.includes(zone.id);
                    const removed = selectedVolunteerOverride.removeZoneIds.includes(zone.id);
                    const active = (inherited && !removed) || added;
                    const state = removed ? "removed" : added ? "added" : inherited ? "inherited" : "off";
                    const tag = {
                      removed: tr("− retirée", "− removed"),
                      added: tr("+ ajoutée", "+ added"),
                      inherited: tr("rôle", "role"),
                      off: "",
                    }[state];
                    return (
                      <button
                        key={zone.id}
                        aria-pressed={active}
                        className={`acc-zone acc-zone--${state}`}
                        title={
                          inherited
                            ? removed
                              ? tr("Zone du rôle retirée pour cette personne : cliquer pour la rendre", "Role zone removed for this person: click to give it back")
                              : tr("Zone donnée par son rôle : cliquer pour la retirer à cette personne", "Zone given by their role: click to remove it for this person")
                            : added
                              ? tr("Zone ajoutée pour cette personne : cliquer pour l'enlever", "Zone added for this person: click to remove it")
                              : tr("Cliquer pour ajouter cette zone à cette personne", "Click to add this zone for this person")
                        }
                        type="button"
                        onClick={() => updateVolunteerOverride(selectedVolunteer, inherited ? "removeZoneIds" : "addZoneIds", zone.id)}
                      >
                        <i>{zone.order ?? ""}</i>
                        <span>{zone.name}</span>
                        {tag ? <small>{tag}</small> : null}
                      </button>
                    );
                  })}
                </div>
              </div>
            </Panel>
          ) : null}
          </>
          ) : null}

          {peopleType === "judges" ? (
          <Panel
            title={tr("Juges", "Judges")}
            subtitle={tr(
              "Roster nominatif sans compte utilisateur. Zones et libellé modifiables ligne par ligne.",
              "Named roster without user accounts. Zones and label can be edited row by row.",
            )}
          >
            {judgesLoading ? <p className="panel-note">{tr("Chargement des juges...", "Loading judges...")}</p> : null}
            {judgesError ? <p className="panel-note">{judgesError}</p> : null}

            <div className="acc-people-toolbar">
              <div className="acc-inline-stats">
                <span><strong>{activeJudges.length}</strong> {tr("juge(s)", "judge(s)")}</span>
                <span><strong>{countSteps(activeJudges).todo}</strong> {tr("à imprimer", "to print")}</span>
                <span><strong>{countSteps(activeJudges).done}</strong> {tr("imprimé(s)", "printed")}</span>
                <span><strong>{countSteps(activeJudges).given}</strong> {tr("remis", "handed over")}</span>
              </div>
              <div className="acc-toolbar-right">
                <input
                  className="acc-people-search"
                  type="search"
                  placeholder={tr("Rechercher un juge…", "Search a judge…")}
                  value={judgeSearch}
                  onChange={(event) => setJudgeSearch(event.target.value)}
                />
                {canManageJudges ? (
                  <button
                    className="button button--primary button--small"
                    type="button"
                    onClick={() => setIsJudgeFormOpen((open) => !open)}
                  >
                    {isJudgeFormOpen ? tr("Fermer", "Close") : tr("+ Ajouter un juge", "+ Add a judge")}
                  </button>
                ) : null}
              </div>
            </div>

            {canManageJudges && isJudgeFormOpen ? (
              <div className="acc-add-form">
                <div className="acc-add-form__row">
                  <label className="acc-mini-field">
                    <span>{tr("Prénom", "First name")}</span>
                    <input value={newJudgeFirstName} onChange={(event) => setNewJudgeFirstName(event.target.value)} />
                  </label>
                  <label className="acc-mini-field">
                    <span>{tr("Nom", "Last name")}</span>
                    <input value={newJudgeLastName} onChange={(event) => setNewJudgeLastName(event.target.value)} />
                  </label>
                  <label className="acc-mini-field">
                    <span>{tr("Libellé badge", "Badge label")}</span>
                    <input
                      value={newJudgeBadgeLabel}
                      placeholder="Judge"
                      onChange={(event) => setNewJudgeBadgeLabel(event.target.value)}
                    />
                  </label>
                </div>
                <div className="acc-zone-chips">
                  <span className="acc-zone-chips__label">Zones</span>
                  {sortedZones.map((zone) => (
                    <button
                      key={`new-judge-zone-${zone.id}`}
                      type="button"
                      className={`acc-zone-chip${newJudgeZoneIds.includes(zone.id) ? " is-on" : ""}`}
                      onClick={() => setNewJudgeZoneIds((current) => toggleIdInList(current, zone.id))}
                    >
                      {formatZoneLabel(zone)}
                    </button>
                  ))}
                </div>
                <div className="acc-add-form__actions">
                  <button
                    className="button button--primary button--small"
                    type="button"
                    onClick={() => {
                      addJudge();
                      setIsJudgeFormOpen(false);
                    }}
                    disabled={!newJudgeFirstName.trim() || !newJudgeLastName.trim()}
                  >
                    {tr("Ajouter", "Add")}
                  </button>
                </div>
              </div>
            ) : null}

            <div className="table-wrap">
              <table className="data-table data-table--admin acc-people-table">
                <thead>
                  <tr>
                    <th className="acc-cb" aria-label={tr("Cocher", "Select")} />
                    <th>{tr("Juge", "Judge")}</th>
                    <th>{tr("Libellé badge", "Badge label")}</th>
                    <th>Zones</th>
                    <th>{tr("Étape", "Step")}</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {visibleActiveJudges.map((judge) => {
                    const judgeStep = getBadgeStep(judge);
                    const judgeKey = `j:${judge.id}`;
                    const zoneLabels = sortedZones
                      .filter((zone) => judge.assignedZones.includes(zone.id))
                      .map((zone) => formatZoneLabel(zone));
                    const zonesOpen = editingJudgeZonesId === judge.id;

                    return (
                      <Fragment key={judge.id}>
                        <tr className={`${zonesOpen ? "row--selected" : ""}${judgeStep.step === "attn" ? " row--warning" : ""}`}>
                          <td className="acc-cb">
                            {canPrintStep(judgeStep) ? (
                              <input
                                aria-label={tr(`Cocher ${judge.firstName} ${judge.lastName}`, `Select ${judge.firstName} ${judge.lastName}`)}
                                checked={printSelection.has(judgeKey)}
                                type="checkbox"
                                onChange={(event) => togglePrintSelection(judgeKey, event.target.checked)}
                              />
                            ) : null}
                          </td>
                          <td>
                            <span className="acc-people-name">
                              {`${judge.firstName} ${judge.lastName}`.trim() || tr("Juge sans nom", "Judge without name")}
                            </span>
                          </td>
                          <td>
                            {canManageJudges ? (
                              <input
                                className="acc-cell-input"
                                value={judge.badgeLabel || "Judge"}
                                onChange={(event) =>
                                  updateJudge(judge.id, { badgeLabel: event.target.value }, tr("Libellé badge juge mis à jour.", "Judge badge label updated."))
                                }
                              />
                            ) : (
                              judge.badgeLabel || "Judge"
                            )}
                          </td>
                          <td>
                            {zoneLabels.length ? (
                              <span className="acc-people-zones" title={zoneLabels.join(", ")}>
                                {zoneLabels.join(", ")}
                              </span>
                            ) : (
                              <span className="acc-people-muted">{tr("aucune zone", "no zone")}</span>
                            )}
                            {canManageJudges ? (
                              <button
                                className="acc-link-button"
                                type="button"
                                onClick={() => setEditingJudgeZonesId(zonesOpen ? "" : judge.id)}
                              >
                                {zonesOpen ? tr("fermer", "close") : tr("modifier", "edit")}
                              </button>
                            ) : null}
                          </td>
                          <td>
                            <span className="acc-people-status">
                              {judgeStep.step ? <span className={STEP_PILL_CLASS[judgeStep.step]}>{tr(STEP_LABELS[judgeStep.step].fr, STEP_LABELS[judgeStep.step].en)}</span> : null}
                              {judgeStep.reason ? <small className="acc-step-reason">{tr(REASON_LABELS[judgeStep.reason].fr, REASON_LABELS[judgeStep.reason].en)}</small> : null}
                            </span>
                          </td>
                          <td className="acc-people-actions">
                            {judgeStep.reason === "recover" ? (
                              <button
                                className="button button--ghost-danger button--small"
                                type="button"
                                onClick={() => markJudgeBadgeDestroyed(judge)}
                              >
                                {tr("Récupéré", "Collected")}
                              </button>
                            ) : null}
                            {judgeStep.step === "done" ? (
                              <button
                                className="button button--secondary button--small"
                                type="button"
                                onClick={() => updateJudge(judge.id, { handedOverAt: new Date().toISOString() }, tr("Badge juge remis.", "Judge badge handed over."))}
                              >
                                {tr("Remis", "Handed over")}
                              </button>
                            ) : null}
                            {canManageJudges ? (
                              <button
                                className="acc-icon-button"
                                type="button"
                                title={tr("Supprimer ce juge", "Delete this judge")}
                                aria-label={tr("Supprimer ce juge", "Delete this judge")}
                                onClick={() => {
                                  const judgeName = `${judge.firstName} ${judge.lastName}`.trim();
                                  if (window.confirm(tr(`Supprimer ${judgeName || "ce juge"} du roster ?`, `Remove ${judgeName || "this judge"} from the roster?`))) {
                                    removeJudge(judge.id);
                                  }
                                }}
                              >
                                ×
                              </button>
                            ) : null}
                          </td>
                        </tr>
                        {zonesOpen ? (
                          <tr className="acc-expand-row">
                            <td colSpan="6">
                              <div className="acc-zone-chips">
                                <span className="acc-zone-chips__label">
                                  {tr(`Zones de ${judge.firstName || "ce juge"}`, `Zones for ${judge.firstName || "this judge"}`)}
                                </span>
                                {sortedZones.map((zone) => {
                                  const isOn = judge.assignedZones.includes(zone.id);
                                  return (
                                    <button
                                      key={`${judge.id}-zone-${zone.id}`}
                                      type="button"
                                      className={`acc-zone-chip${isOn ? " is-on" : ""}`}
                                      onClick={() =>
                                        updateJudge(
                                          judge.id,
                                          {
                                            assignedZones: isOn
                                              ? judge.assignedZones.filter((zoneId) => zoneId !== zone.id)
                                              : [...judge.assignedZones, zone.id],
                                          },
                                          tr("Zones juge mises à jour.", "Judge zones updated."),
                                        )
                                      }
                                    >
                                      {formatZoneLabel(zone)}
                                    </button>
                                  );
                                })}
                              </div>
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })}
                  {!activeJudges.length ? (
                    <tr>
                      <td colSpan="6" className="acc-people-empty">
                        {canManageJudges
                          ? tr("Aucun juge pour le moment. Cliquez sur « + Ajouter un juge ».", "No judge yet. Click “+ Add a judge”.")
                          : tr("Aucun juge pour le moment (ajout réservé aux administrateurs).", "No judge yet (only admins can add one).")}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            {renderPrintBar(
              activeJudges.filter((judge) => canPrintStep(getBadgeStep(judge))),
              (judge) => `j:${judge.id}`,
              finalizeJudgePrintQueue,
            )}
            {canShowMoreListItems("active-judges", activeJudges) ? (
              <div className="list-progressive-actions">
                <button
                  className="button button--secondary button--small"
                  type="button"
                  onClick={() => showMoreListItems("active-judges")}
                >
                  {tr("Afficher 10 de plus", "Show 10 more")}
                </button>
              </div>
            ) : null}
          </Panel>
          ) : null}

          {peopleType === "press" ? (
          <Panel
            title={tr("Presse", "Press")}
            subtitle={tr(
              "Demandes acceptées uniquement. Accepter ou refuser une demande se fait dans le module Presse.",
              "Accepted requests only. Requests are accepted or declined in the Press module.",
            )}
          >
            {pressLoading ? <p className="panel-note">{tr("Chargement des accréditations presse...", "Loading press badges...")}</p> : null}
            {pressError ? <p className="panel-note">{tr(pressError, "Could not load the press requests.")}</p> : null}

            <div className="acc-people-toolbar">
              <div className="acc-inline-stats">
                <span><strong>{acceptedPressRegistrations.length}</strong> {tr("accrédité(s)", "accredited")}</span>
                <span><strong>{countSteps(acceptedPressRegistrations).todo}</strong> {tr("à imprimer", "to print")}</span>
                <span>
                  <strong>
                    {acceptedPressRegistrations.filter((r) => r.printStatus === "Imprimé" && !r.destroyedAt).length}
                  </strong>{" "}
                  {tr("imprimé(s)", "printed")}
                </span>
              </div>
              <input
                className="acc-people-search"
                type="search"
                placeholder={tr("Rechercher nom, média…", "Search name, media…")}
                value={pressSearch}
                onChange={(event) => setPressSearch(event.target.value)}
              />
            </div>

            <div className="table-wrap">
              <table className="data-table data-table--admin acc-people-table">
                <thead>
                  <tr>
                    <th className="acc-cb" aria-label={tr("Cocher", "Select")} />
                    <th>{tr("Personne", "Person")}</th>
                    <th>{tr("Média", "Media")}</th>
                    <th>Zones</th>
                    <th>{tr("Étape", "Step")}</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {visibleAcceptedPress.map((registration) => {
                    const pressStep = getBadgeStep(registration);
                    const pressKey = `p:${registration.id}`;
                    const zoneLabels = sortedZones
                      .filter((zone) => (registration.zoneIds || []).includes(zone.id))
                      .map((zone) => formatZoneLabel(zone));

                    return (
                      <tr key={registration.id} className={pressStep.step === "attn" ? "row--warning" : ""}>
                        <td className="acc-cb">
                          {canPrintStep(pressStep) ? (
                            <input
                              aria-label={tr(
                                `Cocher ${registration.firstName || ""} ${registration.lastName || ""}`,
                                `Select ${registration.firstName || ""} ${registration.lastName || ""}`,
                              )}
                              checked={printSelection.has(pressKey)}
                              type="checkbox"
                              onChange={(event) => togglePrintSelection(pressKey, event.target.checked)}
                            />
                          ) : null}
                        </td>
                        <td>
                          <span className="acc-people-name">
                            {`${registration.firstName || ""} ${registration.lastName || ""}`.trim() || "—"}
                          </span>
                        </td>
                        <td>
                          {registration.media || "—"}
                          <span className="acc-people-tag">
                            {tr(
                              PRESS_REQUEST_TYPE_LABELS[registration.requestType] || registration.requestType,
                              PRESS_REQUEST_TYPE_LABELS_EN[registration.requestType] || registration.requestType,
                            )}
                          </span>
                        </td>
                        <td>
                          {zoneLabels.length ? (
                            <span className="acc-people-zones" title={zoneLabels.join(", ")}>
                              {zoneLabels.join(", ")}
                            </span>
                          ) : (
                            <span className="acc-people-muted">{tr("aucune zone", "no zone")}</span>
                          )}
                        </td>
                        <td>
                          <span className="acc-people-status">
                            {pressStep.step ? <span className={STEP_PILL_CLASS[pressStep.step]}>{tr(STEP_LABELS[pressStep.step].fr, STEP_LABELS[pressStep.step].en)}</span> : null}
                            {pressStep.reason ? <small className="acc-step-reason">{tr(REASON_LABELS[pressStep.reason].fr, REASON_LABELS[pressStep.reason].en)}</small> : null}
                          </span>
                        </td>
                        <td className="acc-people-actions">
                          {pressStep.reason === "recover" ? (
                            <button
                              className="button button--ghost-danger button--small"
                              type="button"
                              onClick={() => markPressBadgeDestroyed(registration)}
                            >
                              {tr("Récupéré", "Collected")}
                            </button>
                          ) : null}
                          {pressStep.step === "done" ? (
                            <button
                              className="button button--secondary button--small"
                              type="button"
                              onClick={() => markPressBadgeHandedOver(registration)}
                            >
                              {tr("Remis", "Handed over")}
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                  {!acceptedPressRegistrations.length ? (
                    <tr>
                      <td colSpan="6" className="acc-people-empty">{tr("Aucune demande presse acceptée pour le moment.", "No accepted press request yet.")}</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            {renderPrintBar(
              acceptedPressRegistrations.filter((registration) => canPrintStep(getBadgeStep(registration))),
              (registration) => `p:${registration.id}`,
              finalizePressPrintQueue,
            )}
            {canShowMoreListItems("accepted-press", acceptedPressRegistrations) ? (
              <div className="list-progressive-actions">
                <button
                  className="button button--secondary button--small"
                  type="button"
                  onClick={() => showMoreListItems("accepted-press")}
                >
                  {tr("Afficher 10 de plus", "Show 10 more")}
                </button>
              </div>
            ) : null}
          </Panel>
          ) : null}
        </section>
      ) : canOperatePrinting && activeAccreditationTab === "plans" ? (
        <CoquePlanEditor accreditationZones={sortedZones} currentUserLabel={getCurrentOperatorLabel()} />
      ) : canOperatePrinting && activeAccreditationTab === "entrance" ? (
        <EntrancePlanEditor currentUserLabel={getCurrentOperatorLabel()} />
      ) : canOperatePrinting && activeAccreditationTab === "judgesPlan" ? (
        <JudgesPlanEditor currentUserLabel={getCurrentOperatorLabel()} />
      ) : canOperatePrinting && activeAccreditationTab === "controls" ? (
        <AccreditationCheckpoints zones={sortedZones} currentUserLabel={getCurrentOperatorLabel()} />
      ) : canOperatePrinting && activeAccreditationTab === "history" ? (
        <section className="admin-split">
          <div className="admin-split__nav">
            <Panel
              title={tr("Batchs d'impression", "Print batches")}
              subtitle={tr("Choisissez un batch pour voir le détail imprimé.", "Choose a batch to see what was printed.")}
            >
              <div className="accreditation-zone-list">
                {printHistory.length ? (
                  printHistory.slice(0, 10).map((batch, index) => (
                    <button
                      key={batch.id}
                      className={`role-chip ${effectiveSelectedPrintHistoryBatchId === batch.id ? "role-chip--active" : ""}`}
                      type="button"
                      onClick={() => setSelectedPrintHistoryBatchId(batch.id)}
                    >
                      <strong>{`Batch ${printHistory.length - index}`}</strong>
                      <span>{batch.items.length} badge(s)</span>
                      <span>{batch.printedAt ? formatDateTimeForDisplay(batch.printedAt) : "—"}</span>
                    </button>
                  ))
                ) : (
                  <p className="panel-note">{tr("Aucun batch d'impression enregistré.", "No print batch saved.")}</p>
                )}
              </div>
            </Panel>
          </div>

          <div className="admin-stack">
            <Panel
              title={tr("Résumé du batch", "Batch summary")}
              subtitle={tr("Détail du lot imprimé sélectionné.", "Details of the selected print batch.")}
            >
              {selectedPrintHistoryBatch ? (
                <>
                  <div className="accreditation-person-summary">
                    <div className="team-summary-pill">
                      <strong>{selectedPrintHistoryBatch.items.length}</strong>
                      <span>Badge(s)</span>
                    </div>
                    <div className="team-summary-pill">
                      <strong>{selectedPrintHistoryBatch.printedAt ? formatDateTimeForDisplay(selectedPrintHistoryBatch.printedAt) : "—"}</strong>
                      <span>{tr("Imprimé le", "Printed on")}</span>
                    </div>
                    <div className="team-summary-pill">
                      <strong>{selectedPrintHistoryBatch.generatedBy || "—"}</strong>
                      <span>{tr("Généré par", "Generated by")}</span>
                    </div>
                  </div>

                  <div className="table-wrap">
                    <table className="data-table data-table--admin">
                      <thead>
                        <tr>
                          <th>{tr("Personne", "Person")}</th>
                          <th>{tr("Rôle badge", "Badge role")}</th>
                          <th>Zones</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedPrintHistoryBatch.items.length ? (
                          selectedPrintHistoryBatch.items.map((entry) => (
                            <tr key={entry.id}>
                              <td>{entry.name || "-"}</td>
                              <td>{entry.roleLabel || "-"}</td>
                              <td>
                                {Array.isArray(entry.zoneLabels)
                                  ? entry.zoneLabels.join(", ") || tr("Aucune zone", "No zone")
                                  : tr("Aucune zone", "No zone")}
                              </td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan="3">{tr("Aucun badge détaillé pour ce batch.", "No badge details for this batch.")}</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <p className="panel-note">{tr("Sélectionnez un batch pour afficher son contenu.", "Select a batch to see its content.")}</p>
              )}
            </Panel>
          </div>
        </section>
      ) : canOperatePrinting && activeAccreditationTab === "desk" ? (
        <AccreditationDesk
          rows={deskRows}
          storageLocations={allStorageLocations}
          onBack={() => openAccreditationTab("people")}
        />
      ) : null}
    </div>
  );
}

export { AccreditationsPage };
