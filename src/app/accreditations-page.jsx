import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { addDoc, collection, doc, onSnapshot, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
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
  NON_NOMINATIVE_BADGE_TEMPLATES,
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
import { useAuth } from "../context/auth-context";
import { useActiveEdition } from "./edition";
import { buildVipBadgeItems, buildVipBadgePrintMarkup } from "./vip-badge-print";
import { getVipRegistrationDocRef, useVipRegistrations } from "./vip-registrations-hooks";
import { db } from "../services/firebase";
import { CoquePlanEditor } from "./coque-plan/coque-plan-editor";
import { EntrancePlanEditor } from "./coque-plan/entrance-plan-editor";
import { JudgesPlanEditor } from "./coque-plan/coque-judges-plan-editor";
import { AccreditationCheckpoints } from "./accreditation-checkpoints";
import { AccreditationDesk } from "./accreditation-desk";
import { useCoquePlan } from "./coque-plan/coque-plan-hooks";

const DEFAULT_LIST_PAGE_SIZE = 10;
const AUTO_CANCEL_MESSAGE = "Cette accréditation a été annulée car le bénévole n'est plus affecté.";
const AUTO_DESTROY_MESSAGE = "Attention : ce bénévole n'est plus affecté. Badge imprimé à récupérer ou détruire.";
// Les 3 étapes d'un badge (+ À traiter), qui servent aussi de filtres
// (accreditation-steps.js ; maquette design/accreditation/maquette-simple.html).
const PEOPLE_FILTERS = [
  { id: "todo", label: STEP_LABELS.todo.fr },
  { id: "done", label: "Imprimés" },
  { id: "given", label: STEP_LABELS.given.fr },
  { id: "attn", label: STEP_LABELS.attn.fr },
  { id: "all", label: "Tous" },
];
const STEP_PILL_CLASS = { todo: "acc-step acc-step--todo", done: "acc-step acc-step--done", given: "acc-step acc-step--given", attn: "acc-step acc-step--attn" };
const PRESS_REQUEST_TYPE_LABELS = { press: "Presse", photographer: "Photographe" };
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
  targetMode: "document_existing",
  documentId: "",
  url: "",
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
  const location = useLocation();
  const navigate = useNavigate();
  const activeRoles = getActiveRoles(userProfile);
  const canManageAccreditationConfiguration = activeRoles.includes("admin");
  const canOperatePrinting = activeRoles.includes("admin") || activeRoles.includes("gestionnaire");
  const canManageJudges = activeRoles.includes("admin");
  const { roles, teamAssignments, loading: teamsLoading, error: teamsError } = useTeamConfiguration();
  const { judges, loading: judgesLoading, error: judgesError } = useJudgeRoster();
  // Plan de la Coque (onglet Plans) imprimé au verso des badges
  const { elements: coquePlanElements } = useCoquePlan();
  const { activeEditionId, loading: editionLoading } = useActiveEdition(canOperatePrinting);
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
    loading: accreditationLoading,
    error: accreditationError,
  } = useAccreditationConfiguration(roles);
  const {
    documents,
    loading: documentsLoading,
    error: documentsError,
  } = useDocumentsCollection(canManageAccreditationConfiguration);
  const [isZoneLibraryExpanded, setIsZoneLibraryExpanded] = useState(false);
  const [users, setUsers] = useState([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [accreditationStatus, setAccreditationStatus] = useState("");
  const [isSavingAccreditation, setIsSavingAccreditation] = useState(false);
  const [newZoneName, setNewZoneName] = useState("");
  const [newStorageLocationName, setNewStorageLocationName] = useState("");
  const [volunteerSearch, setVolunteerSearch] = useState("");
  const [peopleFilter, setPeopleFilter] = useState("todo");
  const [settingsSection, setSettingsSection] = useState("roles");
  // Badges cochés pour l'impression (plus de file : on coche, on imprime).
  const [printSelection, setPrintSelection] = useState(() => new Set());
  const [peopleType, setPeopleType] = useState("volunteers");
  const [isJudgeFormOpen, setIsJudgeFormOpen] = useState(false);
  const [editingJudgeZonesId, setEditingJudgeZonesId] = useState("");
  const [selectedNonNominativeTemplateId, setSelectedNonNominativeTemplateId] = useState(
    NON_NOMINATIVE_BADGE_TEMPLATES[0]?.id ?? "",
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
        setAccreditationStatus("La sauvegarde des accréditations a échoué.");
      } finally {
        setIsSavingAccreditation(false);
      }
    },
    [ACCREDITATION_CONFIGURATION_DOC_PATH],
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
      "Catégorie du badge mise à jour.",
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

    return confirmedRoleLabel || (badgeRoleLabel ? `(${badgeRoleLabel})` : "En attente de confirmation");
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
    const resolvedTargetMode = resource.targetType === "document" ? "document_existing" : "url";

    setEditingQrResourceId(resource.id);
    setQrResourceForm({
      label: resource.label || "",
      subtitle: resource.subtitle || "",
      targetMode: resolvedTargetMode,
      documentId: resource.documentId || "",
      url: resource.url || "",
      uploadedFileUrl: "",
      uploadedFileName: "",
      uploadedFilePath: "",
    });
  }

  function getAccreditationResourceTargetUrl(resource) {
    if (!resource) return "";

    if (resource.targetType === "document") {
      return getDocumentReferenceUrl(documentsById.get(resource.documentId) || null);
    }

    return String(resource.url || "").trim();
  }

  function getQrResourceTargetSummary(resource) {
    if (!resource) return "Cible indisponible";

    if (resource.targetType === "document") {
      const linkedDocument = documentsById.get(resource.documentId) || null;
      if (!linkedDocument) return "Document introuvable";
      return linkedDocument.title || linkedDocument.fileName || "Document lié";
    }

    return resource.url ? resource.url : "Lien à configurer";
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

        if (!src) {
          src = resource.legacyImageUrl || "";
        }

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
      setAccreditationStatus("Ajoutez un libellé pour la ressource QR.");
      return;
    }

    let documentId = "";
    let externalUrl = "";

    if (targetMode === "document_existing") {
      documentId = String(qrResourceForm.documentId || "").trim();
      if (!documentId) {
        setAccreditationStatus("Sélectionnez un document existant pour cette ressource QR.");
        return;
      }
    } else if (targetMode === "document_upload") {
      if (!qrResourceForm.uploadedFileUrl) {
        setAccreditationStatus("Téléversez un document avant d'enregistrer la ressource QR.");
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
        setAccreditationStatus("Ajoutez une URL pour cette ressource QR.");
        return;
      }
    }

    const existingResource = qrResources.find((resource) => resource.id === editingQrResourceId) || null;
    const nextResource = {
      id: existingResource?.id || `qr-resource-${Date.now()}`,
      label: trimmedLabel,
      subtitle: trimmedSubtitle,
      targetType: documentId ? "document" : "url",
      documentId,
      url: documentId ? "" : externalUrl,
      legacyImageUrl: existingResource?.legacyImageUrl || "",
    };
    const nextQrResources = existingResource
      ? qrResources.map((resource) => (resource.id === existingResource.id ? nextResource : resource))
      : [...qrResources, nextResource];

    await persistAccreditationConfiguration(
      buildCurrentConfiguration({
        qrResources: nextQrResources,
      }),
      existingResource ? "Ressource QR mise à jour." : "Ressource QR ajoutée.",
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
      "Ressource QR supprimée.",
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
      "Affectation QR mise à jour.",
    );
  }

  const allStorageLocations = [
    ...BADGE_STORAGE_LOCATIONS,
    ...customStorageLocations.filter((loc) => !BADGE_STORAGE_LOCATIONS.includes(loc)),
  ];
  const effectiveSelectedNonNominativeTemplateId = NON_NOMINATIVE_BADGE_TEMPLATES.some(
    (template) => template.id === selectedNonNominativeTemplateId,
  )
    ? selectedNonNominativeTemplateId
    : NON_NOMINATIVE_BADGE_TEMPLATES[0]?.id ?? "";
  const selectedNonNominativeTemplate = NON_NOMINATIVE_BADGE_TEMPLATES.find(
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
      setAccreditationStatus("La sauvegarde du roster des juges a échoué.");
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

    persistJudgeRoster(nextJudges, "Juge ajouté au roster.");
    resetJudgeForm();
  }

  function updateJudge(judgeId, patch, successMessage = "Roster des juges mis à jour.") {
    const nextJudges = judges.map((judge) => (judge.id === judgeId ? { ...judge, ...patch } : judge));
    persistJudgeRoster(nextJudges, successMessage);
  }

  function removeJudge(judgeId) {
    const nextJudges = judges.filter((judge) => judge.id !== judgeId);
    persistJudgeRoster(nextJudges, "Juge retiré du roster.");
  }

  function updatePrintHistoryEntry(batchId, entryId, patch, successMessage = "Suivi d'impression mis à jour.") {
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
      "Point de retrait ajouté.",
    );
    setNewStorageLocationName("");
  }

  function removeCustomStorageLocation(loc) {
    const next = customStorageLocations.filter((l) => l !== loc);
    persistAccreditationConfiguration(
      buildCurrentConfiguration({ customStorageLocations: next }),
      "Point de retrait supprimé.",
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
      "Badge marqué comme remis.",
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
      "Badge marqué comme détruit.",
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
          {checked.length ? `${checked.length} badge(s) coché(s)` : `${printableItems.length} badge(s) à imprimer dans cette liste`}
        </span>
        <button
          className="button button--primary button--small"
          type="button"
          onClick={async () => {
            await print(target);
            setPrintSelection(new Set());
          }}
        >
          {checked.length ? `Imprimer les ${checked.length} cochés (PDF)` : `Imprimer les ${target.length} (PDF)`}
        </button>
        {checked.length ? (
          <button className="button button--ghost button--small" type="button" onClick={() => setPrintSelection(new Set())}>
            Décocher
          </button>
        ) : (
          <span className="acc-print-bar__hint">ou cochez pour n'en imprimer qu'une partie</span>
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
      "Point de retrait juge enregistré.",
    );
    setStoragePickerOpenById((current) => ({ ...current, [judgeId]: false }));
  }



  function markJudgeBadgeDestroyed(judge) {
    updateJudge(
      judge.id,
      {
        destroyedAt: new Date().toISOString(),
      },
      "Badge juge marqué comme détruit.",
    );
  }




  async function markPressBadgeHandedOver(registration) {
    try {
      await updateDoc(doc(db, "pressRegistrations", registration.id), { handedOverAt: new Date().toISOString() });
      setAccreditationStatus("Badge presse remis.");
    } catch (error) {
      console.error("Impossible de marquer le badge presse comme remis.", error);
      setAccreditationStatus("Impossible de marquer le badge presse comme remis.");
    }
  }

  async function markPressBadgeDestroyed(registration) {
    try {
      await updateDoc(doc(db, "pressRegistrations", registration.id), { destroyedAt: new Date().toISOString() });
      setAccreditationStatus("Badge presse marqué comme détruit.");
    } catch (error) {
      console.error("Impossible de marquer le badge presse comme détruit.", error);
      setAccreditationStatus("Impossible de marquer le badge presse comme détruit.");
    }
  }

  function getPressStorageLocation(registrationId) {
    return badgeStorageLocations[registrationId] ?? "";
  }

  function updatePressBadgeStorageLocation(registrationId, location) {
    const nextLocations = { ...badgeStorageLocations, [registrationId]: location };
    persistAccreditationConfiguration(
      buildCurrentConfiguration({ badgeStorageLocations: nextLocations }),
      "Point de retrait presse enregistré.",
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
        "Historique d'impression presse enregistré.",
      ),
    ]);

    openPrintWindow(buildAccreditationBadgeMarkup(badgeItems, { planElements: coquePlanElements }));
    openPrintWindow(buildAccreditationPrintHistoryMarkup(historyEntries, formatDateTimeForDisplay));
  }

  function updateBadgeStorageLocation(volunteerId, location) {
    const nextLocations = { ...badgeStorageLocations, [volunteerId]: location };
    persistAccreditationConfiguration(
      buildCurrentConfiguration({ badgeStorageLocations: nextLocations }),
      "Point de retrait enregistré.",
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
      "Configuration des zones enregistrée.",
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
      "Nouvelle zone ajoutée.",
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
      "Zone supprimée.",
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
      "Accès par rôle mis à jour.",
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
      "Ajustement individuel enregistré.",
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
      "Libellé de l'accréditation mis à jour.",
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
      "Statut d'impression mis à jour.",
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
      "Lot d'impression généré.",
    );

    openPrintWindow(buildAccreditationBadgeMarkup(badgeItems, { planElements: coquePlanElements }));
    openPrintWindow(buildAccreditationPrintHistoryMarkup(historyEntries, formatDateTimeForDisplay));
  }

  async function generateNonNominativeBadgePdf() {
    if (!selectedNonNominativeTemplate) return;

    const quantity = Math.max(1, Number.parseInt(nonNominativeQuantity, 10) || 1);
    const printedAt = new Date().toISOString();
    const resourceCards = await buildResourceCardsForVisual(selectedNonNominativeTemplate.id);
    const zoneIds = selectedNonNominativeTemplate.defaultZoneIds.filter((zoneId) =>
      sortedZones.some((zone) => zone.id === zoneId),
    );
    const zoneLabels = sortedZones
      .filter((zone) => zoneIds.includes(zone.id))
      .map((zone) => formatZoneLabel(zone));
    const badgeItems = Array.from({ length: quantity }, (_, index) => ({
      volunteerId: `non-nominative-${selectedNonNominativeTemplate.id}-${Date.now()}-${index + 1}`,
      name: "Non nominatif",
      nominative: false,
      category: selectedNonNominativeTemplate.id === "coach" ? "coach" : "athlete",
      role: "Accreditation",
      roleNames: [selectedNonNominativeTemplate.badgeLabel],
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
      `${quantity} badge(s) ${selectedNonNominativeTemplate.label.toLowerCase()} non nominatif(s) généré(s).`,
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
      setVipPrintError("Le statut des badges VIP n'a pas pu être enregistré.");
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
      persistJudgeRoster(nextJudges, "Lot d'impression juges généré."),
      persistAccreditationConfiguration(
        buildCurrentConfiguration({
          printHistory: [historyBatch, ...printHistory],
        }),
        "Historique d'impression juges enregistré.",
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
        .filter((zone) => selectedNonNominativeTemplate.defaultZoneIds.includes(zone.id))
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
      handOver: () => updateJudge(judge.id, { handedOverAt: new Date().toISOString() }, "Badge juge remis."),
    })),
    ...acceptedPressRegistrations.map((registration) => ({
      key: `p:${registration.id}`,
      name: `${registration.firstName || ""} ${registration.lastName || ""}`.trim() || registration.media || "Presse",
      role: [registration.requestType === "photographer" ? "Photographe" : "", registration.media].filter(Boolean).join(" · "),
      kind: "Presse",
      step: getBadgeStep(registration).step,
      location: getPressStorageLocation(registration.id),
      setLocation: (location) => updatePressBadgeStorageLocation(registration.id, location),
      handOver: () => markPressBadgeHandedOver(registration),
    })),
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
        "Statuts d'accréditation mis à jour selon les affectations.",
      );
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [
    accreditationDataReady,
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
        "Certaines accréditations imprimées ont été repassées en non-imprimé après modification.",
      );
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [
    accreditationDataReady,
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
              <p className="eyebrow">Accès &amp; jour J</p>
              <h1>Accréditations</h1>
              <p>Un badge passe par 3 étapes : à imprimer, imprimé, remis. On coche, on imprime ; le guichet remet les badges le jour J.</p>
            </>
          ) : null}
          {teamsLoading || accreditationLoading || usersLoading ? <p className="panel-note">Chargement en cours...</p> : null}
          {teamsError || accreditationError ? <p className="panel-note">{teamsError || accreditationError}</p> : null}
          {accreditationStatus ? <p className="panel-note">{accreditationStatus}</p> : null}
          {isSavingAccreditation ? <p className="panel-note">Sauvegarde des accréditations...</p> : null}
        </div>
        {/* Guichet du jour J : page à part, ouverte seulement depuis ce bouton,
            au niveau de la page et pas dans les onglets (Margot, 12/11/2026). */}
        {canOperatePrinting && activeAccreditationTab !== "desk" ? (
          <button className="acc-desk-button" type="button" onClick={() => openAccreditationTab("desk")}>
            Ouvrir le guichet jour J ↗
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
              Plans &amp; contrôles
            </button>
          </>
        ) : null}
        {canManageAccreditationConfiguration ? (
          <button
            className={`admin-subtab ${activeAccreditationTab === "settings" ? "admin-subtab--active" : ""}`}
            type="button"
            onClick={() => openAccreditationTab("settings")}
          >
            Réglages
          </button>
        ) : null}
      </div>
      ) : null}

      {canOperatePrinting && ["plans", "entrance", "judgesPlan", "controls"].includes(activeAccreditationTab) ? (
        <div className="acc-type-switch" role="tablist" aria-label="Plans et contrôles">
          {[
            ["plans", "Plan de la Coque"],
            ["entrance", "Plan de l'entrée"],
            ["judgesPlan", "Plan des juges"],
            ["controls", "Points de contrôle"],
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
          <div className="acc-type-switch" role="tablist" aria-label="Réglages">
            {[
              ["roles", "Zones par rôle"],
              ["zones", "Liste des zones"],
              ["boxes", "Boîtes du guichet"],
              ["qr", "QR sur les badges"],
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
            title="Zones par rôle"
            subtitle="Chaque rôle donne ses zones à toute personne affectée. Cliquez une case pour donner ou retirer une zone ; la couleur de la bande se choisit par rôle."
          >
            <div className="acc-matrix-toolbar">
              <input
                className="acc-people-search"
                placeholder="Rechercher un rôle…"
                type="search"
                value={roleSearch}
                onChange={(event) => setRoleSearch(event.target.value)}
              />
              <span className="acc-people-muted">
                {filteredRoles.length} rôle(s) · {sortedZones.length} zones
              </span>
            </div>
            <div className="table-wrap">
              <table className="acc-matrix">
                <thead>
                  <tr>
                    <th className="acc-matrix__role">Rôle</th>
                    <th className="acc-matrix__band">Bande du badge</th>
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
                              aria-label={`Bande du badge pour ${role.roleName}`}
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
                                aria-label={`${on ? "Retirer" : "Donner"} ${zone.name} à ${role.roleName}`}
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
                        Aucun rôle ne correspond à la recherche.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            <p className="acc-people-muted">
              Les juges, la presse et les badges sans nom ont leurs zones dans leur propre liste (onglet Badges). Les zones
              ajoutées ou retirées à une personne se règlent dans sa fiche.
            </p>
          </Panel>
          </>
          ) : null}

          {settingsSection === "zones" ? (
          <>
          <Panel
            title="Bibliothèque des zones"
            subtitle="Gérez ici les zones d'accréditation : nom, ordre, ajout ou suppression."
            actions={
              <button
                className="button button--secondary button--small"
                type="button"
                onClick={() => setIsZoneLibraryExpanded((current) => !current)}
                aria-expanded={isZoneLibraryExpanded}
              >
                {isZoneLibraryExpanded ? "Replier" : "Déplier"}
              </button>
            }
          >
            {isZoneLibraryExpanded ? (
              <>
                <div className="accreditation-zone-list">
                  {sortedZones.map((zone) => (
                    <div key={zone.id} className="accreditation-zone-row">
                      <label className="field">
                        <span>Numéro</span>
                        <input
                          type="number"
                          min="1"
                          value={zone.order}
                          onChange={(event) => updateZone(zone.id, "order", event.target.value)}
                        />
                      </label>
                      <label className="field">
                        <span>Nom de la zone</span>
                        <input
                          value={zone.name}
                          onChange={(event) => updateZone(zone.id, "name", event.target.value)}
                        />
                      </label>
                      <button
                        className="button button--ghost-danger"
                        type="button"
                        onClick={() => removeZone(zone.id)}
                      >
                        Supprimer
                      </button>
                    </div>
                  ))}
                </div>

                <div className="accreditation-zone-add">
                  <label className="field">
                    <span>Nouvelle zone</span>
                    <input
                      placeholder="Ex: Media lounge"
                      value={newZoneName}
                      onChange={(event) => setNewZoneName(event.target.value)}
                    />
                  </label>
                  <button className="button button--secondary" type="button" onClick={addZone}>
                    Ajouter la zone
                  </button>
                </div>
              </>
            ) : (
              <div className="accreditation-zone-collapsed">
                <div className="accreditation-zone-library-preview">
                  <div className="team-summary-pill">
                    <strong>{sortedZones.length}</strong>
                    <span>Zone(s) disponibles</span>
                  </div>
                  <div className="accreditation-tag-list">
                    {sortedZones.slice(0, 4).map((zone) => (
                      <span key={zone.id} className="accreditation-tag">
                        {formatZoneLabel(zone)}
                      </span>
                    ))}
                    {sortedZones.length > 4 ? (
                      <span className="accreditation-tag">+ {sortedZones.length - 4} autres</span>
                    ) : null}
                  </div>
                </div>
              </div>
            )}
          </Panel>

          </>
          ) : null}

          {settingsSection === "boxes" ? (
          <>
          <Panel
            title="Boîtes du guichet"
            subtitle="Les boîtes où sont rangés les badges imprimés, choisies au guichet le jour J."
          >
            <div className="accreditation-zone-list">
              {customStorageLocations.length === 0 ? (
                <p className="panel-note">Aucune boîte définie. Ajoutez-en une ci-dessous.</p>
              ) : null}
              {customStorageLocations.map((loc) => (
                <div key={loc} className="tracking-location-row">
                  <span>{loc}</span>
                  <button
                    className="button button--ghost-danger button--small"
                    type="button"
                    onClick={() => removeCustomStorageLocation(loc)}
                  >
                    Supprimer
                  </button>
                </div>
              ))}
            </div>
            <div className="accreditation-zone-add">
              <label className="field">
                <span>Nouvelle boîte</span>
                <input
                  placeholder="Ex : Boîte A–F"
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
                Ajouter
              </button>
            </div>
          </Panel>

          </>
          ) : null}

          {settingsSection === "qr" ? (
          <>
        <section className="admin-stack">
          <Panel
            title="Affectation des QR par visuel"
            subtitle="Choisissez quelles ressources QR doivent apparaître sur chaque type d'accréditation."
          >
            <div className="admin-split accreditation-role-layout">
              <div className="admin-split__nav accreditation-role-nav">
                <div className="accreditation-role-nav__meta">
                  <span>{ACCREDITATION_BADGE_VISUALS.length} visuel(x)</span>
                  <span>{qrResources.length} ressource(s) réutilisable(s)</span>
                </div>
                <div className="accreditation-role-list">
                  {ACCREDITATION_BADGE_VISUALS.map((visual) => (
                    <button
                      key={visual.id}
                      className={`role-chip ${effectiveSelectedQrVisualId === visual.id ? "role-chip--active" : ""}`}
                      type="button"
                      onClick={() => setSelectedQrVisualId(visual.id)}
                    >
                      <span className="accreditation-role-list__label">{visual.label}</span>
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
                    title={selectedQrVisual.label}
                    subtitle={selectedQrVisual.description}
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
                            "Toutes les ressources QR ont été retirées de ce visuel.",
                          )
                        }
                      >
                        Vider ce visuel
                      </button>
                    }
                  >
                    <div className="choice-grid choice-grid--2">
                      {qrResources.map((resource) => {
                        const isAssigned = selectedQrVisualResourceIds.includes(resource.id);
                        const usageVisualLabels = (qrResourceUsageById[resource.id] ?? [])
                          .map(
                            (visualId) =>
                              ACCREDITATION_BADGE_VISUALS.find((visual) => visual.id === visualId)?.label || visualId,
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
                                  {isAssigned ? "Affiché" : "Masqué"}
                                </span>
                              </div>
                              <p>{resource.subtitle || "Aucun sous-titre renseigné."}</p>
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
            title="Bibliothèque des ressources QR"
            subtitle="Créez ici les ressources QR réutilisables : document existant, nouveau document uploadé ou lien externe."
          >
            {documentsLoading ? <p className="panel-note">Chargement des documents...</p> : null}
            {documentsError ? <p className="panel-note">{documentsError}</p> : null}

            <div className="table-wrap">
              <table className="data-table data-table--admin">
                <thead>
                  <tr>
                    <th>Ressource</th>
                    <th>Type</th>
                    <th>Cible</th>
                    <th>Utilisée sur</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {qrResources.map((resource) => {
                    const usageVisualLabels = (qrResourceUsageById[resource.id] ?? [])
                      .map(
                        (visualId) =>
                          ACCREDITATION_BADGE_VISUALS.find((visual) => visual.id === visualId)?.label || visualId,
                      )
                      .join(", ");

                    return (
                      <tr key={resource.id}>
                        <td>
                          <strong>{resource.label}</strong>
                          {resource.subtitle ? <p className="panel-note">{resource.subtitle}</p> : null}
                        </td>
                        <td>{resource.targetType === "document" ? "Document" : "Lien externe"}</td>
                        <td>{getQrResourceTargetSummary(resource)}</td>
                        <td>{usageVisualLabels || "Non utilisée"}</td>
                        <td>
                          <div className="panel-actions">
                            <button
                              className="button button--secondary button--small"
                              type="button"
                              onClick={() => editQrResource(resource)}
                            >
                              Modifier
                            </button>
                            <button
                              className="button button--ghost-danger button--small"
                              type="button"
                              onClick={() => removeQrResource(resource.id)}
                            >
                              Supprimer
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {!qrResources.length ? (
                    <tr>
                      <td colSpan="5">Aucune ressource QR configurée pour le moment.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>

            <div className="admin-stack" style={{ marginTop: "1rem" }}>
              <div className="form-section-head">
                <p className="eyebrow">Ressource QR</p>
                <h3>{editingQrResourceId ? "Modifier une ressource" : "Ajouter une ressource"}</h3>
              </div>
              <div className="field-grid">
                <AuthFormField label="Libellé">
                  <input
                    name="label"
                    placeholder="Ex: Roadbook athlètes"
                    value={qrResourceForm.label}
                    onChange={handleQrResourceFormChange}
                  />
                </AuthFormField>
                <AuthFormField label="Sous-titre">
                  <input
                    name="subtitle"
                    placeholder="Ex: Informations utiles meeting"
                    value={qrResourceForm.subtitle}
                    onChange={handleQrResourceFormChange}
                  />
                </AuthFormField>
              </div>
              <AuthFormField label="Type de cible">
                <select
                  name="targetMode"
                  value={qrResourceForm.targetMode}
                  onChange={handleQrResourceFormChange}
                >
                  <option value="document_existing">Document existant</option>
                  <option value="document_upload">Téléverser un document ici</option>
                  <option value="url">Lien externe</option>
                </select>
              </AuthFormField>

              {qrResourceForm.targetMode === "document_existing" ? (
                <AuthFormField label="Document à utiliser">
                  <select
                    name="documentId"
                    value={qrResourceForm.documentId}
                    onChange={handleQrResourceFormChange}
                  >
                    <option value="">Sélectionner un document</option>
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
                    label="Document à téléverser"
                    helperText="PDF ou image · sera aussi enregistré dans la bibliothèque Documents"
                  />
                  {qrResourceForm.uploadedFileName ? (
                    <p className="panel-note">Fichier prêt: {qrResourceForm.uploadedFileName}</p>
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
                  {editingQrResourceId ? "Enregistrer la ressource" : "Ajouter la ressource"}
                </button>
                {editingQrResourceId ? (
                  <button
                    className="button button--secondary"
                    type="button"
                    onClick={resetQrResourceForm}
                  >
                    Annuler
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
          <div className="acc-type-switch" role="tablist" aria-label="Type d’accréditation">
            {[
              { id: "volunteers", label: "Bénévoles & staff", count: printableVolunteers.length },
              { id: "judges", label: "Juges", count: activeJudges.length },
              { id: "press", label: "Presse", count: acceptedPressRegistrations.length },
              { id: "vip", label: "VIP", count: queuedVipBadgeCount },
              { id: "nominless", label: "Sans nom (athlètes, coachs)", count: null },
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
              Voir un exemple de badge
            </button>
            <button className="acc-link-button" type="button" onClick={() => openAccreditationTab("history")}>
              Historique des impressions
            </button>
          </div>

          {peopleType === "vip" ? (
          <Panel
            title="VIP"
            subtitle="Badge VIP dédié, 8 par A4, +1 pour l’accompagnant nommé. Les invités se mettent en file dans VIP › Inscrits."
          >
            {vipRegistrationsError || vipPrintError ? (
              <p className="form-error">{vipPrintError || vipRegistrationsError}</p>
            ) : null}
            <div className="table-wrap">
              <table className="data-table data-table--admin">
                <thead>
                  <tr>
                    <th>Personne</th>
                    <th>Entreprise</th>
                    <th>Accompagnant</th>
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
                          Retirer
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!queuedVip.length ? (
                    <tr>
                      <td colSpan="4">Aucun invité VIP n'est actuellement dans la file d'impression.</td>
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
                + File : inscrits sans badge ({unprintedVip.length})
              </button>
              <button
                className="button button--primary"
                type="button"
                onClick={finalizeVipPrintQueue}
                disabled={!queuedVip.length}
              >
                Générer le PDF ({queuedVipBadgeCount} badge{queuedVipBadgeCount > 1 ? "s" : ""})
              </button>
            </div>
          </Panel>

          ) : null}

          {peopleType === "nominless" ? (
          <Panel
            title="Badges sans nom"
            subtitle="Athlètes et coachs : badges sans nom, zones du modèle. Chaque lot est gardé dans l’historique."
          >
            <div className="acc-add-form__row acc-add-form__row--end">
              <label className="acc-mini-field">
                <span>Type</span>
                <select
                  value={effectiveSelectedNonNominativeTemplateId}
                  onChange={(event) => setSelectedNonNominativeTemplateId(event.target.value)}
                >
                  {NON_NOMINATIVE_BADGE_TEMPLATES.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="acc-mini-field acc-mini-field--narrow">
                <span>Quantité</span>
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
                Générer le PDF ({Math.max(1, Number.parseInt(nonNominativeQuantity, 10) || 1)})
              </button>
            </div>
            <p className="acc-people-muted">
              Zones : {selectedNonNominativeZoneLabels.join(", ") || "aucune zone pour ce modèle"}
            </p>
          </Panel>
          ) : null}

          {peopleType === "volunteers" ? (
          <>
          <Panel
            title="Personnes"
            subtitle="Cliquez sur une ligne pour voir sa fiche (zones, texte du badge, historique). Cochez des badges puis « Imprimer »."
          >
            {unconfirmedVolunteersCount ? (
              <p className="panel-note acc-unconfirmed-note">
                {unconfirmedVolunteersCount} bénévole{unconfirmedVolunteersCount > 1 ? "s" : ""} affecté{unconfirmedVolunteersCount > 1 ? "s" : ""} mais pas encore
                confirmé{unconfirmedVolunteersCount > 1 ? "s" : ""} : badge masqué jusqu'à la confirmation du poste.
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
                    {filter.label}
                    <span className="acc-people-filter__count">{peopleBucketCounts[filter.id] ?? 0}</span>
                  </button>
                ))}
              </div>
              <input
                className="acc-people-search"
                type="search"
                placeholder="Rechercher nom, email, rôle…"
                value={volunteerSearch}
                onChange={(event) => setVolunteerSearch(event.target.value)}
              />
            </div>

            <div className="table-wrap">
              <table className="data-table data-table--admin accreditation-people-table acc-people-table">
                <thead>
                  <tr>
                    <th className="acc-cb" aria-label="Cocher" />
                    <th>Personne</th>
                    <th>Rôle badge</th>
                    <th>Zones</th>
                    <th>Étape</th>
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
                              aria-label={`Cocher ${volunteer.firstName} ${volunteer.lastName}`}
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
                            <span className="acc-people-tag" title="Affectation pas encore confirmée">
                              non confirmé
                            </span>
                          ) : null}
                        </td>
                        <td>
                          {zoneLabels.length ? (
                            <span className="acc-people-zones" title={zoneLabels.join(", ")}>
                              {zoneLabels.join(", ")}
                            </span>
                          ) : (
                            <span className="acc-people-muted" title="Aucune zone liée à ce rôle (Réglages › zones par rôle)">
                              aucune zone
                            </span>
                          )}
                        </td>
                        <td>
                          <span className="acc-people-status">
                            {stepInfo.step ? <span className={STEP_PILL_CLASS[stepInfo.step]}>{STEP_LABELS[stepInfo.step].fr}</span> : null}
                            {stepInfo.reason ? <small className="acc-step-reason">{REASON_LABELS[stepInfo.reason].fr}</small> : null}
                          </span>
                        </td>
                        <td className="acc-people-actions" onClick={(event) => event.stopPropagation()}>
                          {canDestroyBadge ? (
                            <button
                              className="button button--ghost-danger button--small"
                              type="button"
                              title="Le badge imprimé a été récupéré et détruit"
                              onClick={() => markBadgeDestroyed(volunteer)}
                            >
                              Récupéré
                            </button>
                          ) : null}
                          {stepInfo.step === "done" ? (
                            <button
                              className="button button--secondary button--small"
                              type="button"
                              title="Badge donné à la personne"
                              onClick={() => markBadgeHandedOver(volunteer)}
                            >
                              Remis
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
                          ? "Aucune personne à cette étape."
                          : "Aucune personne n'a encore été affectée à un rôle."}
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
                  Afficher 10 de plus
                </button>
              </div>
            ) : null}
          </Panel>

          {selectedVolunteer ? (
            <Panel
              title={`${selectedVolunteer.firstName} ${selectedVolunteer.lastName}`}
              subtitle="Zones héritées, ajustements manuels et libellé utilisé sur l'accréditation."
            >
              {selectedVolunteerOverride.warningMessage ? (
                <div className="accreditation-warning-panel">
                  <strong>Attention modification</strong>
                  <p>{selectedVolunteerOverride.warningMessage}</p>
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
                    return step ? <span className={STEP_PILL_CLASS[step]}>{STEP_LABELS[step].fr}</span> : null;
                  })()}
                  <span className="acc-person__dot" aria-hidden="true">·</span>
                  <span>
                    <strong>{getFinalZoneIds(selectedVolunteer).length}</strong> / {sortedZones.length} zones
                  </span>
                </div>

                <div className="acc-person__fields">
                  <label className="acc-person__field">
                    <span>Texte sur le badge</span>
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
                                {stepInfo.step === "attn" ? "Réimprimer" : "Imprimer ce badge"}
                              </button>
                            ) : null}
                            {stepInfo.step === "done" ? (
                              <>
                                <button className="button button--secondary button--small" type="button" onClick={() => markBadgeHandedOver(selectedVolunteer)}>
                                  Remis
                                </button>
                                <button
                                  className="button button--ghost button--small"
                                  title="Imprimé par erreur : le badge redevient « à imprimer »"
                                  type="button"
                                  onClick={() => updateVolunteerPrintStatus(selectedVolunteer, "Non-imprimé")}
                                >
                                  Annuler l'impression
                                </button>
                              </>
                            ) : null}
                            {stepInfo.step === "given" ? (
                              <button
                                className="button button--ghost button--small"
                                title="Badge perdu : il faut en imprimer un nouveau"
                                type="button"
                                onClick={() => updateVolunteerPrintStatus(selectedVolunteer, "Non-imprimé")}
                              >
                                Badge perdu : réimprimer
                              </button>
                            ) : null}
                            {stepInfo.reason === "recover" ? (
                              <button className="button button--ghost-danger button--small" type="button" onClick={() => markBadgeDestroyed(selectedVolunteer)}>
                                Récupéré
                              </button>
                            ) : null}
                            {!confirmed && stepInfo.step === "todo" ? <small className="acc-step-reason">Poste pas encore confirmé.</small> : null}
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
                    ...(override.handedOverAt ? [{ key: "given", text: `Remis le ${formatDateTimeForDisplay(override.handedOverAt)}` }] : []),
                    ...printed.map((item) => ({ key: item.id, text: `Imprimé le ${formatDateTimeForDisplay(item.printedAt)}${item.generatedBy ? ` par ${item.generatedBy}` : ""}` })),
                    ...(override.destroyedAt ? [{ key: "destroyed", text: `Ancien badge détruit le ${formatDateTimeForDisplay(override.destroyedAt)}` }] : []),
                  ];
                  return (
                    <div className="acc-person__history">
                      <span>Historique</span>
                      {events.length ? (
                        <ul>
                          {events.map((event) => (
                            <li key={event.key}>{event.text}</li>
                          ))}
                        </ul>
                      ) : (
                        <small>Pas encore imprimé.</small>
                      )}
                    </div>
                  );
                })()}

                <div className="acc-person__zones-head">
                  <span>Zones</span>
                  <small>Cliquer ajoute une zone pour cette personne, ou retire une zone donnée par son rôle.</small>
                </div>
                <div className="acc-person__zones">
                  {sortedZones.map((zone) => {
                    const inherited = inheritedZoneIds.includes(zone.id);
                    const added = selectedVolunteerOverride.addZoneIds.includes(zone.id);
                    const removed = selectedVolunteerOverride.removeZoneIds.includes(zone.id);
                    const active = (inherited && !removed) || added;
                    const state = removed ? "removed" : added ? "added" : inherited ? "inherited" : "off";
                    const tag = { removed: "− retirée", added: "+ ajoutée", inherited: "rôle", off: "" }[state];
                    return (
                      <button
                        key={zone.id}
                        aria-pressed={active}
                        className={`acc-zone acc-zone--${state}`}
                        title={
                          inherited
                            ? removed
                              ? "Zone du rôle retirée pour cette personne : cliquer pour la rendre"
                              : "Zone donnée par son rôle : cliquer pour la retirer à cette personne"
                            : added
                              ? "Zone ajoutée pour cette personne : cliquer pour l'enlever"
                              : "Cliquer pour ajouter cette zone à cette personne"
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
            title="Juges"
            subtitle="Roster nominatif sans compte utilisateur. Zones et libellé modifiables ligne par ligne."
          >
            {judgesLoading ? <p className="panel-note">Chargement des juges...</p> : null}
            {judgesError ? <p className="panel-note">{judgesError}</p> : null}

            <div className="acc-people-toolbar">
              <div className="acc-inline-stats">
                <span><strong>{activeJudges.length}</strong> juge(s)</span>
                <span><strong>{countSteps(activeJudges).todo}</strong> à imprimer</span>
                <span><strong>{countSteps(activeJudges).done}</strong> imprimé(s)</span>
                <span><strong>{countSteps(activeJudges).given}</strong> remis</span>
              </div>
              <div className="acc-toolbar-right">
                <input
                  className="acc-people-search"
                  type="search"
                  placeholder="Rechercher un juge…"
                  value={judgeSearch}
                  onChange={(event) => setJudgeSearch(event.target.value)}
                />
                {canManageJudges ? (
                  <button
                    className="button button--primary button--small"
                    type="button"
                    onClick={() => setIsJudgeFormOpen((open) => !open)}
                  >
                    {isJudgeFormOpen ? "Fermer" : "+ Ajouter un juge"}
                  </button>
                ) : null}
              </div>
            </div>

            {canManageJudges && isJudgeFormOpen ? (
              <div className="acc-add-form">
                <div className="acc-add-form__row">
                  <label className="acc-mini-field">
                    <span>Prénom</span>
                    <input value={newJudgeFirstName} onChange={(event) => setNewJudgeFirstName(event.target.value)} />
                  </label>
                  <label className="acc-mini-field">
                    <span>Nom</span>
                    <input value={newJudgeLastName} onChange={(event) => setNewJudgeLastName(event.target.value)} />
                  </label>
                  <label className="acc-mini-field">
                    <span>Libellé badge</span>
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
                    Ajouter
                  </button>
                </div>
              </div>
            ) : null}

            <div className="table-wrap">
              <table className="data-table data-table--admin acc-people-table">
                <thead>
                  <tr>
                    <th className="acc-cb" aria-label="Cocher" />
                    <th>Juge</th>
                    <th>Libellé badge</th>
                    <th>Zones</th>
                    <th>Étape</th>
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
                                aria-label={`Cocher ${judge.firstName} ${judge.lastName}`}
                                checked={printSelection.has(judgeKey)}
                                type="checkbox"
                                onChange={(event) => togglePrintSelection(judgeKey, event.target.checked)}
                              />
                            ) : null}
                          </td>
                          <td>
                            <span className="acc-people-name">
                              {`${judge.firstName} ${judge.lastName}`.trim() || "Juge sans nom"}
                            </span>
                          </td>
                          <td>
                            {canManageJudges ? (
                              <input
                                className="acc-cell-input"
                                value={judge.badgeLabel || "Judge"}
                                onChange={(event) =>
                                  updateJudge(judge.id, { badgeLabel: event.target.value }, "Libellé badge juge mis à jour.")
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
                              <span className="acc-people-muted">aucune zone</span>
                            )}
                            {canManageJudges ? (
                              <button
                                className="acc-link-button"
                                type="button"
                                onClick={() => setEditingJudgeZonesId(zonesOpen ? "" : judge.id)}
                              >
                                {zonesOpen ? "fermer" : "modifier"}
                              </button>
                            ) : null}
                          </td>
                          <td>
                            <span className="acc-people-status">
                              {judgeStep.step ? <span className={STEP_PILL_CLASS[judgeStep.step]}>{STEP_LABELS[judgeStep.step].fr}</span> : null}
                              {judgeStep.reason ? <small className="acc-step-reason">{REASON_LABELS[judgeStep.reason].fr}</small> : null}
                            </span>
                          </td>
                          <td className="acc-people-actions">
                            {judgeStep.reason === "recover" ? (
                              <button
                                className="button button--ghost-danger button--small"
                                type="button"
                                onClick={() => markJudgeBadgeDestroyed(judge)}
                              >
                                Récupéré
                              </button>
                            ) : null}
                            {judgeStep.step === "done" ? (
                              <button
                                className="button button--secondary button--small"
                                type="button"
                                onClick={() => updateJudge(judge.id, { handedOverAt: new Date().toISOString() }, "Badge juge remis.")}
                              >
                                Remis
                              </button>
                            ) : null}
                            {canManageJudges ? (
                              <button
                                className="acc-icon-button"
                                type="button"
                                title="Supprimer ce juge"
                                aria-label="Supprimer ce juge"
                                onClick={() => {
                                  if (window.confirm(`Supprimer ${`${judge.firstName} ${judge.lastName}`.trim() || "ce juge"} du roster ?`)) {
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
                                <span className="acc-zone-chips__label">Zones de {judge.firstName || "ce juge"}</span>
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
                                          "Zones juge mises à jour.",
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
                          ? "Aucun juge pour le moment. Cliquez sur « + Ajouter un juge »."
                          : "Aucun juge pour le moment (ajout réservé aux administrateurs)."}
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
                  Afficher 10 de plus
                </button>
              </div>
            ) : null}
          </Panel>
          ) : null}

          {peopleType === "press" ? (
          <Panel
            title="Presse"
            subtitle="Demandes acceptées uniquement. Accepter ou refuser une demande se fait dans le module Presse."
          >
            {pressLoading ? <p className="panel-note">Chargement des accréditations presse...</p> : null}
            {pressError ? <p className="panel-note">{pressError}</p> : null}

            <div className="acc-people-toolbar">
              <div className="acc-inline-stats">
                <span><strong>{acceptedPressRegistrations.length}</strong> accrédité(s)</span>
                <span><strong>{countSteps(acceptedPressRegistrations).todo}</strong> à imprimer</span>
                <span>
                  <strong>
                    {acceptedPressRegistrations.filter((r) => r.printStatus === "Imprimé" && !r.destroyedAt).length}
                  </strong>{" "}
                  imprimé(s)
                </span>
              </div>
              <input
                className="acc-people-search"
                type="search"
                placeholder="Rechercher nom, média…"
                value={pressSearch}
                onChange={(event) => setPressSearch(event.target.value)}
              />
            </div>

            <div className="table-wrap">
              <table className="data-table data-table--admin acc-people-table">
                <thead>
                  <tr>
                    <th className="acc-cb" aria-label="Cocher" />
                    <th>Personne</th>
                    <th>Média</th>
                    <th>Zones</th>
                    <th>Étape</th>
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
                              aria-label={`Cocher ${registration.firstName || ""} ${registration.lastName || ""}`}
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
                            {PRESS_REQUEST_TYPE_LABELS[registration.requestType] || registration.requestType}
                          </span>
                        </td>
                        <td>
                          {zoneLabels.length ? (
                            <span className="acc-people-zones" title={zoneLabels.join(", ")}>
                              {zoneLabels.join(", ")}
                            </span>
                          ) : (
                            <span className="acc-people-muted">aucune zone</span>
                          )}
                        </td>
                        <td>
                          <span className="acc-people-status">
                            {pressStep.step ? <span className={STEP_PILL_CLASS[pressStep.step]}>{STEP_LABELS[pressStep.step].fr}</span> : null}
                            {pressStep.reason ? <small className="acc-step-reason">{REASON_LABELS[pressStep.reason].fr}</small> : null}
                          </span>
                        </td>
                        <td className="acc-people-actions">
                          {pressStep.reason === "recover" ? (
                            <button
                              className="button button--ghost-danger button--small"
                              type="button"
                              onClick={() => markPressBadgeDestroyed(registration)}
                            >
                              Récupéré
                            </button>
                          ) : null}
                          {pressStep.step === "done" ? (
                            <button
                              className="button button--secondary button--small"
                              type="button"
                              onClick={() => markPressBadgeHandedOver(registration)}
                            >
                              Remis
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                  {!acceptedPressRegistrations.length ? (
                    <tr>
                      <td colSpan="6" className="acc-people-empty">Aucune demande presse acceptée pour le moment.</td>
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
                  Afficher 10 de plus
                </button>
              </div>
            ) : null}
          </Panel>
          ) : null}
        </section>
      ) : canOperatePrinting && activeAccreditationTab === "plans" ? (
        <CoquePlanEditor currentUserLabel={getCurrentOperatorLabel()} />
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
              title="Batchs d'impression"
              subtitle="Choisissez un batch pour voir le détail imprimé."
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
                  <p className="panel-note">Aucun batch d'impression enregistré.</p>
                )}
              </div>
            </Panel>
          </div>

          <div className="admin-stack">
            <Panel
              title="Résumé du batch"
              subtitle="Détail du lot imprimé sélectionné."
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
                      <span>Imprimé le</span>
                    </div>
                    <div className="team-summary-pill">
                      <strong>{selectedPrintHistoryBatch.generatedBy || "—"}</strong>
                      <span>Généré par</span>
                    </div>
                  </div>

                  <div className="table-wrap">
                    <table className="data-table data-table--admin">
                      <thead>
                        <tr>
                          <th>Personne</th>
                          <th>Rôle badge</th>
                          <th>Zones</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedPrintHistoryBatch.items.length ? (
                          selectedPrintHistoryBatch.items.map((entry) => (
                            <tr key={entry.id}>
                              <td>{entry.name || "-"}</td>
                              <td>{entry.roleLabel || "-"}</td>
                              <td>{Array.isArray(entry.zoneLabels) ? (entry.zoneLabels.join(", ") || "Aucune zone") : "Aucune zone"}</td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan="3">Aucun badge détaillé pour ce batch.</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <p className="panel-note">Sélectionnez un batch pour afficher son contenu.</p>
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
