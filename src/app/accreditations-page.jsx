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
  getAccreditationStatusClass,
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
import { useAuth } from "../context/auth-context";
import { useActiveEdition } from "./edition";
import { buildVipBadgeItems, buildVipBadgePrintMarkup } from "./vip-badge-print";
import { getVipRegistrationDocRef, useVipRegistrations } from "./vip-registrations-hooks";
import { db } from "../services/firebase";
import { CoquePlanEditor } from "./coque-plan/coque-plan-editor";
import { useCoquePlan } from "./coque-plan/coque-plan-hooks";

const DEFAULT_LIST_PAGE_SIZE = 10;
const AUTO_CANCEL_MESSAGE = "Cette accréditation a été annulée car le bénévole n'est plus affecté.";
const AUTO_DESTROY_MESSAGE = "Attention : ce bénévole n'est plus affecté. Badge imprimé à récupérer ou détruire.";
const PEOPLE_FILTERS = [
  { id: "all", label: "Tous" },
  { id: "todo", label: "À imprimer" },
  { id: "queued", label: "Dans la file" },
  { id: "printed", label: "Imprimés" },
  { id: "attention", label: "À traiter" },
];
const PRESS_REQUEST_TYPE_LABELS = { press: "Presse", photographer: "Photographe" };
const ACCREDITATION_TAB_PATHS = {
  people: "/app/accreditations",
  print: "/app/accreditations/impressions",
  tracking: "/app/accreditations/suivi",
  history: "/app/accreditations/historique",
  plans: "/app/accreditations/plans",
  settings: "/app/accreditations/reglages",
};

function getAccreditationTabFromPath(pathname, availableTabs) {
  const normalizedPath = String(pathname || "").replace(/\/+$/, "") || "/app/accreditations";

  // Zones par rôle et ressources QR sont réunies dans un seul onglet Réglages.
  if (normalizedPath.endsWith("/reglages") && availableTabs.includes("settings")) return "settings";
  if (normalizedPath.endsWith("/ressources-qr") && availableTabs.includes("settings")) return "settings";
  if (normalizedPath.endsWith("/impressions") && availableTabs.includes("print")) return "print";
  if (normalizedPath.endsWith("/suivi") && availableTabs.includes("tracking")) return "tracking";
  if (normalizedPath.endsWith("/historique") && availableTabs.includes("history")) return "history";
  if (normalizedPath.endsWith("/plans") && availableTabs.includes("plans")) return "plans";
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
  const [selectedRoleId, setSelectedRoleId] = useState("");
  const [volunteerSearch, setVolunteerSearch] = useState("");
  const [peopleFilter, setPeopleFilter] = useState("all");
  const [peopleType, setPeopleType] = useState("volunteers");
  const [isJudgeFormOpen, setIsJudgeFormOpen] = useState(false);
  const [editingJudgeZonesId, setEditingJudgeZonesId] = useState("");
  const [trackingSearch, setTrackingSearch] = useState("");
  const [trackingStatusFilter, setTrackingStatusFilter] = useState("Tous");
  const [trackingLocationFilter, setTrackingLocationFilter] = useState("Tous");
  const [selectedNonNominativeTemplateId, setSelectedNonNominativeTemplateId] = useState(
    NON_NOMINATIVE_BADGE_TEMPLATES[0]?.id ?? "",
  );
  const [nonNominativeQuantity, setNonNominativeQuantity] = useState("1");
  const [newJudgeFirstName, setNewJudgeFirstName] = useState("");
  const [newJudgeLastName, setNewJudgeLastName] = useState("");
  const [newJudgeBadgeLabel, setNewJudgeBadgeLabel] = useState("Judge");
  const [newJudgeZoneIds, setNewJudgeZoneIds] = useState(["zone-judges", "zone-infield"]);
  const [storagePickerOpenById, setStoragePickerOpenById] = useState({});
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
  const effectiveSelectedRoleId =
    roles.some((role) => role.id === selectedRoleId) ? selectedRoleId : roles[0]?.id ?? "";
  const selectedRole = roles.find((role) => role.id === effectiveSelectedRoleId) ?? roles[0];
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
    // Une personne réaffectée réapparaît toujours, même si son ancien badge a été détruit.
    if (volunteerHasPrintableAssignment(volunteer)) return true;
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

  function getBadgeTrackingStatus(volunteer) {
    const override = getVolunteerOverride(volunteer.id);
    if (override.destroyedAt) return "Détruit";
    if (override.printStatus === "Annulé" || override.printStatus === "Imprimé à détruire") return override.printStatus;
    if (override.printStatus !== "Imprimé") return "Non imprimé";
    if (override.handedOverAt) return "Remis";
    if (getBadgeStorageLocation(volunteer.id)) return "Rangé";
    return "Imprimé non rangé";
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

  // Filtre « Personnes » : une ligne peut être à la fois « À imprimer » et « À traiter » (badge modifié).
  function getPeopleRowState(volunteer) {
    const override = getVolunteerOverride(volunteer.id);
    switch (override.printStatus) {
      case "Annulé":
      case "Imprimé à détruire":
        return { buckets: ["attention"], flag: "" };
      case "Dans la file":
        return { buckets: ["queued"], flag: "" };
      case "Imprimé":
        return { buckets: ["printed"], flag: "" };
      default:
        return override.warningMessage
          ? { buckets: ["todo", "attention"], flag: "Modifié" }
          : { buckets: ["todo"], flag: "" };
    }
  }

  function persistVolunteerOverride(volunteer, nextOverride, successMessage) {
    persistAccreditationConfiguration(
      buildCurrentConfiguration({
        volunteerOverrides: { ...volunteerOverrides, [volunteer.id]: nextOverride },
      }),
      successMessage,
    );
  }

  // Alerte « modifié » vue : on retire le message, le badge reste « Non-imprimé » (à réimprimer).
  function acknowledgeVolunteerWarning(volunteer) {
    persistVolunteerOverride(
      volunteer,
      { ...getVolunteerOverride(volunteer.id), warningMessage: "" },
      "Alerte retirée.",
    );
  }

  function getJudgeTrackingStatus(judge) {
    if (judge.destroyedAt) return "Détruit";
    if (judge.printStatus === "Annulé" || judge.printStatus === "Imprimé à détruire") return judge.printStatus;
    if (judge.printStatus !== "Imprimé") return "Non imprimé";
    if (getJudgeStorageLocation(judge.id)) return "Rangé";
    return "Imprimé non rangé";
  }

  function updateJudgeBadgeStorageLocation(judgeId, location) {
    const nextLocations = { ...badgeStorageLocations, [judgeId]: location };
    persistAccreditationConfiguration(
      buildCurrentConfiguration({ badgeStorageLocations: nextLocations }),
      "Point de retrait juge enregistré.",
    );
    setStoragePickerOpenById((current) => ({ ...current, [judgeId]: false }));
  }

  function updateJudgePrintStatus(judge, printStatus) {
    const patch =
      printStatus === "Imprimé"
        ? {
            printStatus,
            lastPrintedAt: new Date().toISOString(),
            destroyedAt: null,
          }
        : printStatus === "Non-imprimé"
          ? {
              printStatus,
              destroyedAt: null,
            }
          : { printStatus };

    updateJudge(judge.id, patch, "Statut d'impression juge mis à jour.");
  }

  function addJudgeToPrintQueue(judge) {
    updateJudgePrintStatus(judge, "Dans la file");
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

  async function updatePressPrintStatus(registration, printStatus) {
    const patch =
      printStatus === "Imprimé"
        ? { printStatus, lastPrintedAt: new Date().toISOString(), destroyedAt: null }
        : printStatus === "Non-imprimé"
          ? { printStatus, destroyedAt: null }
          : { printStatus };

    try {
      await updateDoc(doc(db, "pressRegistrations", registration.id), patch);
      setAccreditationStatus("Statut d'impression presse mis à jour.");
    } catch (error) {
      console.error("Impossible de mettre à jour le statut d'impression presse.", error);
      setAccreditationStatus("Impossible de mettre à jour le statut d'impression presse.");
    }
  }

  function addPressToPrintQueue(registration) {
    updatePressPrintStatus(registration, "Dans la file");
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

  function getPressTrackingStatus(registration) {
    if (registration.destroyedAt) return "Détruit";
    if (registration.printStatus === "Annulé" || registration.printStatus === "Imprimé à détruire") {
      return registration.printStatus;
    }
    if (registration.printStatus !== "Imprimé") return "Non imprimé";
    if (getPressStorageLocation(registration.id)) return "Rangé";
    return "Imprimé non rangé";
  }

  async function finalizePressPrintQueue() {
    const queuedPress = acceptedPressRegistrations.filter(
      (registration) => registration.printStatus === "Dans la file" && !registration.destroyedAt,
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
      nextOverride.warningMessage = "";
      nextOverride.lastQueuedAt = new Date().toISOString();
    }

    if (patch.printStatus === "Imprimé") {
      nextOverride.warningMessage = "";
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

  function setRoleZoneSelection(roleId, nextZoneIds, successMessage = "Accès par rôle mis à jour.") {
    persistAccreditationConfiguration(
      {
        zones,
        roleZoneAssignments: {
          ...roleZoneAssignments,
          [roleId]: nextZoneIds,
        },
        volunteerOverrides,
        printHistory,
      },
      successMessage,
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

  function addVolunteerToPrintQueue(volunteer) {
    updateVolunteerPrintStatus(volunteer, "Dans la file");
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

  async function finalizePrintQueue() {
    const queuedVolunteers = volunteers.filter(
      (volunteer) => getVolunteerOverride(volunteer.id).printStatus === "Dans la file",
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

  async function finalizeJudgePrintQueue() {
    const queuedJudges = judges.filter((judge) => judge.printStatus === "Dans la file" && !judge.destroyedAt);
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

  const selectedRoleZoneIds = selectedRole ? getRoleZoneIds(selectedRole.id) : [];
  const normalizedRoleSearch = roleSearch.trim().toLowerCase();
  const filteredRoles = useMemo(
    () => roles.filter((role) => role.roleName.toLowerCase().includes(normalizedRoleSearch)),
    [normalizedRoleSearch, roles],
  );
  const selectedRoleZoneLabels = sortedZones
    .filter((zone) => selectedRoleZoneIds.includes(zone.id))
    .map((zone) => formatZoneLabel(zone));
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
  const removableInheritedZones = sortedZones.filter((zone) => inheritedZoneIds.includes(zone.id));
  const addableZones = sortedZones.filter((zone) => !inheritedZoneIds.includes(zone.id));
  const queuedVolunteers = volunteers.filter(
    (volunteer) => getVolunteerOverride(volunteer.id).printStatus === "Dans la file",
  );
  const normalizedJudgeSearch = judgeSearch.trim().toLowerCase();
  const queuedJudges = judges.filter((judge) => {
    if (judge.printStatus !== "Dans la file" || judge.destroyedAt) return false;
    if (!normalizedJudgeSearch) return true;
    const haystack = `${judge.firstName} ${judge.lastName} ${judge.badgeLabel}`.toLowerCase();
    return haystack.includes(normalizedJudgeSearch);
  });
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
  const queuedPress = acceptedPressRegistrations.filter(
    (registration) => registration.printStatus === "Dans la file" && !registration.destroyedAt,
  );
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
  const peopleBucketCounts = printableVolunteers.reduce(
    (counts, volunteer) => {
      const { buckets } = getPeopleRowState(volunteer);
      buckets.forEach((bucket) => {
        counts[bucket] = (counts[bucket] ?? 0) + 1;
      });
      counts.all += 1;
      return counts;
    },
    { all: 0 },
  );
  const filteredPrintableVolunteers = printableVolunteers.filter((volunteer) => {
    if (peopleFilter !== "all" && !getPeopleRowState(volunteer).buckets.includes(peopleFilter)) return false;
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
  const trackingVolunteers = printableVolunteers.filter((volunteer) => {
    const haystack = `${volunteer.firstName} ${volunteer.lastName} ${volunteer.email}`.toLowerCase();
    if (!haystack.includes(trackingSearch.trim().toLowerCase())) return false;
    const status = getBadgeTrackingStatus(volunteer);
    if (trackingStatusFilter !== "Tous" && status !== trackingStatusFilter) return false;
    if (trackingLocationFilter !== "Tous") {
      const loc = getBadgeStorageLocation(volunteer.id);
      if (trackingLocationFilter === "Non rangé" && loc) return false;
      if (trackingLocationFilter !== "Non rangé" && loc !== trackingLocationFilter) return false;
    }
    return true;
  });
  const trackingCountByStatus = printableVolunteers.reduce((acc, volunteer) => {
    const s = getBadgeTrackingStatus(volunteer);
    acc[s] = (acc[s] ?? 0) + 1;
    return acc;
  }, {});
  const trackingUsedLocations = [
    ...new Set(printableVolunteers.map((v) => getBadgeStorageLocation(v.id)).filter(Boolean)),
  ].sort((a, b) => a.localeCompare(b, "fr"));
  const visiblePrintableVolunteers = getVisibleListItems("printable-volunteers", filteredPrintableVolunteers);
  const visibleQueuedVolunteers = getVisibleListItems("queued-volunteers", queuedVolunteers);
  const visibleTrackingVolunteers = getVisibleListItems("tracking-volunteers", trackingVolunteers);
  const visibleQueuedJudges = getVisibleListItems("queued-judges", queuedJudges);
  const visibleActiveJudges = getVisibleListItems("active-judges", activeJudges);
  const visibleQueuedPress = getVisibleListItems("queued-press", queuedPress);
  const visibleAcceptedPress = getVisibleListItems("accepted-press", acceptedPressRegistrations);

  const availableAccreditationTabs = [
    ...(canOperatePrinting ? ["people", "print", "tracking", "history", "plans"] : []),
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
          <p className="eyebrow">Accès &amp; jour J</p>
          <h1>Accréditations</h1>
          <p>Zones par personne, file d'impression unique, retrait des badges.</p>
          {teamsLoading || accreditationLoading || usersLoading ? <p className="panel-note">Chargement en cours...</p> : null}
          {teamsError || accreditationError ? <p className="panel-note">{teamsError || accreditationError}</p> : null}
          {accreditationStatus ? <p className="panel-note">{accreditationStatus}</p> : null}
          {isSavingAccreditation ? <p className="panel-note">Sauvegarde des accréditations...</p> : null}
        </div>
      </section>
      <div className="admin-subtabs">
        {canOperatePrinting ? (
          <>
            <button
              className={`admin-subtab ${activeAccreditationTab === "people" ? "admin-subtab--active" : ""}`}
              type="button"
              onClick={() => openAccreditationTab("people")}
            >
              Personnes
            </button>
            <button
              className={`admin-subtab ${activeAccreditationTab === "print" ? "admin-subtab--active" : ""}`}
              type="button"
              onClick={() => openAccreditationTab("print")}
            >
              Impression
            </button>
            <button
              className={`admin-subtab ${activeAccreditationTab === "tracking" ? "admin-subtab--active" : ""}`}
              type="button"
              onClick={() => openAccreditationTab("tracking")}
            >
              Retrait &amp; suivi
            </button>
            <button
              className={`admin-subtab ${activeAccreditationTab === "history" ? "admin-subtab--active" : ""}`}
              type="button"
              onClick={() => openAccreditationTab("history")}
            >
              Historique
            </button>
            <button
              className={`admin-subtab ${activeAccreditationTab === "plans" ? "admin-subtab--active" : ""}`}
              type="button"
              onClick={() => openAccreditationTab("plans")}
            >
              Plans
            </button>
          </>
        ) : null}
        {canManageAccreditationConfiguration ? (
          <button
            className={`admin-subtab ${activeAccreditationTab === "settings" ? "admin-subtab--active" : ""}`}
            type="button"
            onClick={() => openAccreditationTab("settings")}
          >
            ⚙ Réglages
          </button>
        ) : null}
      </div>

      {canManageAccreditationConfiguration && activeAccreditationTab === "settings" ? (
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

          <section className="admin-split accreditation-role-layout">
            <Panel title="Rôles" subtitle="Choisissez un rôle pour régler ses accès par défaut.">
              <div className="admin-split__nav accreditation-role-nav">
                <label className="field accreditation-role-search">
                  <span>Rechercher un rôle</span>
                  <input
                    placeholder="Ex: VIP, presse, tribune..."
                    value={roleSearch}
                    onChange={(event) => setRoleSearch(event.target.value)}
                  />
                </label>
                <div className="accreditation-role-nav__meta">
                  <span>{filteredRoles.length} rôle(s) visible(s)</span>
                  <span>{roles.length} au total</span>
                </div>
                <div className="accreditation-role-list">
                  {filteredRoles.map((role) => {
                    const roleZoneCount = getRoleZoneIds(role.id).length;

                    return (
                      <button
                        key={role.id}
                        className={`role-chip ${effectiveSelectedRoleId === role.id ? "role-chip--active" : ""}`}
                        type="button"
                        onClick={() => setSelectedRoleId(role.id)}
                      >
                        <span className="accreditation-role-list__label">{role.roleName}</span>
                        <span className="accreditation-role-list__count">
                          {roleZoneCount} zone{roleZoneCount > 1 ? "s" : ""}
                        </span>
                      </button>
                    );
                  })}
                  {!filteredRoles.length ? (
                    <p className="panel-note">Aucun rôle ne correspond à la recherche.</p>
                  ) : null}
                </div>
              </div>
            </Panel>

            {selectedRole ? (
              <div className="admin-stack">
                <Panel
                  title={`Zones par défaut - ${selectedRole.roleName}`}
                  subtitle="Cochez les accès qui doivent être donnés automatiquement à toute personne affectée à ce rôle."
                  actions={
                    <div className="panel-actions accreditation-role-actions">
                      <button
                        className="button button--secondary button--small"
                        type="button"
                        onClick={() => setRoleZoneSelection(selectedRole.id, sortedZones.map((zone) => zone.id), "Toutes les zones ont été attribuées au rôle.")}
                      >
                        Tout cocher
                      </button>
                      <button
                        className="button button--secondary button--small"
                        type="button"
                        onClick={() => setRoleZoneSelection(selectedRole.id, [], "Toutes les zones par défaut ont été retirées du rôle.")}
                      >
                        Vider
                      </button>
                    </div>
                  }
                >
                  <div className="accreditation-person-summary">
                    <div className="team-summary-pill">
                      <strong>{selectedRoleZoneIds.length}</strong>
                      <span>Zone(s) attribuée(s)</span>
                    </div>
                    <div className="team-summary-pill">
                      <strong>{sortedZones.length - selectedRoleZoneIds.length}</strong>
                      <span>Zone(s) non attribuée(s)</span>
                    </div>
                    <div className="team-summary-pill">
                      <strong>{roles.findIndex((role) => role.id === selectedRole.id) + 1}</strong>
                      <span>Position dans la liste des rôles</span>
                    </div>
                  </div>
                  <label className="accreditation-role-category">
                    <span>Catégorie du badge</span>
                    <select
                      value={roleBadgeCategories[selectedRole.id] || DEFAULT_ROLE_BADGE_CATEGORY}
                      onChange={(event) => setRoleBadgeCategory(selectedRole.id, event.target.value)}
                    >
                      {BADGE_CATEGORIES.filter((category) => ["volunteer", "organisation", "technical"].includes(category.key)).map((category) => (
                        <option key={category.key} value={category.key}>{category.label}</option>
                      ))}
                    </select>
                    <i style={{ background: BADGE_CATEGORIES.find((category) => category.key === (roleBadgeCategories[selectedRole.id] || DEFAULT_ROLE_BADGE_CATEGORY))?.color }} />
                    <small>Couleur de la bande sur le badge ; le nom du rôle s'écrit dessous.</small>
                  </label>
                  <div className="choice-grid choice-grid--2">
                    {sortedZones.map((zone) => (
                      <label key={zone.id} className="selection-card selection-card--compact accreditation-zone-option">
                        <input
                          type="checkbox"
                          checked={selectedRoleZoneIds.includes(zone.id)}
                          onChange={() => toggleRoleZone(selectedRole.id, zone.id)}
                        />
                        <div>
                          <div className="accreditation-zone-option__top">
                            <strong>{formatZoneLabel(zone)}</strong>
                            <span className={`accreditation-tag ${selectedRoleZoneIds.includes(zone.id) ? "accreditation-tag--active" : ""}`}>
                              {selectedRoleZoneIds.includes(zone.id) ? "Attribuée" : "Inactive"}
                            </span>
                          </div>
                          <p>Accès hérité automatiquement pour toute personne affectée à ce rôle.</p>
                        </div>
                      </label>
                    ))}
                  </div>
                </Panel>

                <Panel title="Résumé du rôle" subtitle="Vue rapide de la configuration actuellement enregistrée.">
                  <div className="accreditation-role-summary">
                    <div className="accreditation-inline-panel">
                      <strong>Rôle sélectionné</strong>
                      <div className="accreditation-role-summary__stats">
                        <div>
                          <span>Nom</span>
                          <strong>{selectedRole.roleName}</strong>
                        </div>
                        <div>
                          <span>Zones actives</span>
                          <strong>{selectedRoleZoneIds.length}</strong>
                        </div>
                      </div>
                    </div>
                    <div className="accreditation-inline-panel">
                      <strong>Zones attribuées</strong>
                      {selectedRoleZoneLabels.length ? (
                        <div className="accreditation-tag-list">
                          {selectedRoleZoneLabels.map((label) => (
                            <span key={label} className="accreditation-tag accreditation-tag--active">
                              {label}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <p className="panel-note accreditation-role-summary__empty">Aucune zone par défaut définie pour ce rôle.</p>
                      )}
                    </div>
                  </div>
                </Panel>
              </div>
            ) : null}
          </section>
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
      ) : canOperatePrinting && activeAccreditationTab === "people" ? (
        <section className="admin-stack">
          <div className="acc-type-switch" role="tablist" aria-label="Type d’accréditation">
            {[
              { id: "volunteers", label: "Bénévoles & staff", count: printableVolunteers.length },
              { id: "judges", label: "Juges", count: activeJudges.length },
              { id: "press", label: "Presse", count: acceptedPressRegistrations.length },
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
                <span className="acc-people-filter__count">{type.count}</span>
              </button>
            ))}
            <span className="acc-type-switch__hint">VIP : module VIP · badges non nominatifs : onglet Impression</span>
          </div>

          {peopleType === "volunteers" ? (
          <>
          <Panel
            title="Personnes"
            subtitle="Cliquez sur une ligne pour modifier ses zones. « À traiter » : badge modifié (Vu) ou badge imprimé à détruire (Détruit)."
          >
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
                    <th>Personne</th>
                    <th>Rôle badge</th>
                    <th>Zones</th>
                    <th>Statut</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {visiblePrintableVolunteers.map((volunteer) => {
                    const override = getVolunteerOverride(volunteer.id);
                    const rowState = getPeopleRowState(volunteer);
                    const isSelected = effectiveSelectedVolunteerId === volunteer.id;
                    const isInvalid = isVolunteerAccreditationInvalid(volunteer);
                    const canDestroyBadge = override.printStatus === "Imprimé à détruire";
                    const canQueueBadge = !canDestroyBadge && !isInvalid && override.printStatus !== "Dans la file";
                    const isConfirmed =
                      getConfirmedAccreditationRoleNames(volunteer, normalizeComparableValue).length > 0;
                    const zoneLabels = getFinalZoneLabels(volunteer);
                    return (
                      <tr
                        key={volunteer.id}
                        className={`accreditation-people-row${isSelected ? " row--selected" : ""}${
                          rowState.bucket === "attention" ? " row--warning" : ""
                        }`}
                        onClick={() => setSelectedVolunteerId(volunteer.id)}
                      >
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
                            <span
                              className={getAccreditationStatusClass(override.printStatus)}
                              title={override.warningMessage || undefined}
                            >
                              {override.printStatus}
                            </span>
                            {rowState.flag ? (
                              <span className="accreditation-status-flag" title={override.warningMessage}>
                                {rowState.flag}
                              </span>
                            ) : null}
                          </span>
                        </td>
                        <td className="acc-people-actions" onClick={(event) => event.stopPropagation()}>
                          {canDestroyBadge ? (
                            <button
                              className="button button--ghost-danger button--small"
                              type="button"
                              title="Le badge imprimé a été récupéré ou détruit"
                              onClick={() => markBadgeDestroyed(volunteer)}
                            >
                              Détruit
                            </button>
                          ) : null}
                          {rowState.flag === "Modifié" ? (
                            <button
                              className="button button--ghost button--small"
                              type="button"
                              title="Modification vue : retirer l'alerte (le badge reste à réimprimer)"
                              onClick={() => acknowledgeVolunteerWarning(volunteer)}
                            >
                              Vu
                            </button>
                          ) : null}
                          {canQueueBadge ? (
                            <button
                              className="button button--secondary button--small"
                              type="button"
                              onClick={() => addVolunteerToPrintQueue(volunteer)}
                            >
                              + File
                            </button>
                          ) : null}
                          {override.printStatus === "Dans la file" ? (
                            <span className="acc-people-muted">en file</span>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                  {!filteredPrintableVolunteers.length ? (
                    <tr>
                      <td colSpan="5" className="acc-people-empty">
                        {printableVolunteers.length
                          ? "Aucune personne dans ce filtre."
                          : "Aucune personne n'a encore été affectée à un rôle."}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
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

              <div className="accreditation-person-summary">
                <div className="team-summary-pill">
                  <strong>{getRoleTableLabel(selectedVolunteer)}</strong>
                  <span>Rôle affiché</span>
                </div>
                <div className="team-summary-pill">
                  <strong>{selectedVolunteerOverride.printStatus}</strong>
                  <span>Statut impression</span>
                </div>
                <div className="team-summary-pill">
                  <strong>{getFinalZoneIds(selectedVolunteer).length}</strong>
                  <span>Zones finales</span>
                </div>
              </div>

              <div className="field-grid">
                <AuthFormField label="Texte affiché sur l'accréditation">
                  <input
                    value={selectedVolunteerOverride.badgeLabel}
                    placeholder={buildAccreditationRoleLabel(selectedVolunteer.assignedRoles)}
                    onChange={(event) => updateVolunteerBadgeLabel(selectedVolunteer, event.target.value)}
                  />
                </AuthFormField>
                <AuthFormField label="Statut d'impression">
                  <select
                    value={selectedVolunteerOverride.printStatus}
                    onChange={(event) => updateVolunteerPrintStatus(selectedVolunteer, event.target.value)}
                  >
                    {ACCREDITATION_PRINT_STATUS_OPTIONS.map((status) => (
                      <option key={status}>{status}</option>
                    ))}
                  </select>
                </AuthFormField>
              </div>

              <div className="field-grid">
                <div className="accreditation-inline-panel">
                  <strong>Zones héritées</strong>
                  <div className="accreditation-tag-list">
                    {inheritedZoneIds.length ? (
                      sortedZones
                        .filter((zone) => inheritedZoneIds.includes(zone.id))
                        .map((zone) => <span key={zone.id} className="accreditation-tag">{formatZoneLabel(zone)}</span>)
                    ) : (
                      <p className="panel-note">Aucune zone héritée.</p>
                    )}
                  </div>
                </div>

                <div className="accreditation-inline-panel">
                  <strong>Zones ajoutées</strong>
                  <div className="accreditation-tag-list">
                    {selectedVolunteerOverride.addZoneIds.length ? (
                      sortedZones
                        .filter((zone) => selectedVolunteerOverride.addZoneIds.includes(zone.id))
                        .map((zone) => (
                          <span key={zone.id} className="accreditation-tag accreditation-tag--active">
                            {formatZoneLabel(zone)}
                          </span>
                        ))
                    ) : (
                      <p className="panel-note">Aucun ajout manuel.</p>
                    )}
                  </div>
                </div>

                <div className="accreditation-inline-panel">
                  <strong>Zones retirées</strong>
                  <div className="accreditation-tag-list">
                    {selectedVolunteerOverride.removeZoneIds.length ? (
                      sortedZones
                        .filter((zone) => selectedVolunteerOverride.removeZoneIds.includes(zone.id))
                        .map((zone) => <span key={zone.id} className="accreditation-tag">{formatZoneLabel(zone)}</span>)
                    ) : (
                      <p className="panel-note">Aucun retrait manuel.</p>
                    )}
                  </div>
                </div>
              </div>

              <Panel
                title="Ajustements individuels"
                subtitle="Ajoutez des accès supplémentaires ou retirez des accès hérités pour cette personne seulement."
              >
                <div className="field-grid">
                  <div className="field">
                    <span>Zones à ajouter</span>
                    <div className="choice-grid choice-grid--2">
                      {addableZones.length ? (
                        addableZones.map((zone) => (
                          <label key={zone.id} className="selection-card selection-card--compact">
                            <input
                              type="checkbox"
                              checked={selectedVolunteerOverride.addZoneIds.includes(zone.id)}
                              onChange={() => updateVolunteerOverride(selectedVolunteer, "addZoneIds", zone.id)}
                            />
                            <div>
                              <strong>{formatZoneLabel(zone)}</strong>
                              <p>Ajout manuel pour cette personne</p>
                            </div>
                          </label>
                        ))
                      ) : (
                        <p className="panel-note">Toutes les zones existantes sont déjà héritées par ce rôle.</p>
                      )}
                    </div>
                  </div>

                  <div className="field">
                    <span>Zones à retirer</span>
                    <div className="choice-grid choice-grid--2">
                      {removableInheritedZones.length ? (
                        removableInheritedZones.map((zone) => (
                          <label key={zone.id} className="selection-card selection-card--compact">
                            <input
                              type="checkbox"
                              checked={selectedVolunteerOverride.removeZoneIds.includes(zone.id)}
                              onChange={() => updateVolunteerOverride(selectedVolunteer, "removeZoneIds", zone.id)}
                            />
                            <div>
                              <strong>{formatZoneLabel(zone)}</strong>
                              <p>Retrait manuel de l'héritage du rôle</p>
                            </div>
                          </label>
                        ))
                      ) : (
                        <p className="panel-note">Aucune zone héritée à retirer pour cette personne.</p>
                      )}
                    </div>
                  </div>
                </div>
              </Panel>
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
                <span><strong>{judges.filter((judge) => judge.printStatus === "Non-imprimé" && !judge.destroyedAt).length}</strong> à imprimer</span>
                <span><strong>{queuedJudges.length}</strong> en file</span>
                <span><strong>{judges.filter((judge) => judge.printStatus === "Imprimé" && !judge.destroyedAt).length}</strong> imprimé(s)</span>
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
                    <th>Juge</th>
                    <th>Libellé badge</th>
                    <th>Zones</th>
                    <th>Statut</th>
                    <th>Retrait</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {visibleActiveJudges.map((judge) => {
                    const judgeTrackingStatus = getJudgeTrackingStatus(judge);
                    const judgeLocation = getJudgeStorageLocation(judge.id);
                    const canQueueJudge =
                      judge.printStatus !== "Dans la file" && judgeTrackingStatus !== "Imprimé à détruire";
                    const canPickLocation =
                      judgeTrackingStatus === "Imprimé non rangé" || judgeTrackingStatus === "Rangé";
                    const zoneLabels = sortedZones
                      .filter((zone) => judge.assignedZones.includes(zone.id))
                      .map((zone) => formatZoneLabel(zone));
                    const zonesOpen = editingJudgeZonesId === judge.id;

                    return (
                      <Fragment key={judge.id}>
                        <tr className={zonesOpen ? "row--selected" : ""}>
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
                            <span
                              className={
                                judgeTrackingStatus === "Rangé" || judgeTrackingStatus === "Imprimé non rangé"
                                  ? getAccreditationStatusClass("Imprimé")
                                  : getAccreditationStatusClass(judgeTrackingStatus)
                              }
                            >
                              {judgeTrackingStatus}
                            </span>
                          </td>
                          <td>
                            {canPickLocation ? (
                              <select
                                className="acc-cell-select"
                                value={judgeLocation}
                                onChange={(event) => updateJudgeBadgeStorageLocation(judge.id, event.target.value)}
                              >
                                <option value="">À ranger…</option>
                                {allStorageLocations.map((loc) => (
                                  <option key={`${judge.id}-${loc}`} value={loc}>{loc}</option>
                                ))}
                              </select>
                            ) : (
                              <span className="acc-people-muted">—</span>
                            )}
                          </td>
                          <td className="acc-people-actions">
                            {judgeTrackingStatus === "Imprimé à détruire" ? (
                              <button
                                className="button button--ghost-danger button--small"
                                type="button"
                                onClick={() => markJudgeBadgeDestroyed(judge)}
                              >
                                Détruit
                              </button>
                            ) : null}
                            {judge.printStatus === "Dans la file" ? <span className="acc-people-muted">en file</span> : null}
                            {canQueueJudge ? (
                              <button
                                className="button button--secondary button--small"
                                type="button"
                                onClick={() => addJudgeToPrintQueue(judge)}
                              >
                                + File
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
                <span><strong>{queuedPress.length}</strong> en file</span>
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
                    <th>Personne</th>
                    <th>Média</th>
                    <th>Zones</th>
                    <th>Statut</th>
                    <th>Retrait</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {visibleAcceptedPress.map((registration) => {
                    const pressTrackingStatus = getPressTrackingStatus(registration);
                    const pressLocation = getPressStorageLocation(registration.id);
                    const canQueuePress =
                      registration.printStatus !== "Dans la file" && pressTrackingStatus !== "Imprimé à détruire";
                    const canPickLocation =
                      pressTrackingStatus === "Imprimé non rangé" || pressTrackingStatus === "Rangé";
                    const zoneLabels = sortedZones
                      .filter((zone) => (registration.zoneIds || []).includes(zone.id))
                      .map((zone) => formatZoneLabel(zone));

                    return (
                      <tr key={registration.id}>
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
                          <span
                            className={
                              pressTrackingStatus === "Rangé" || pressTrackingStatus === "Imprimé non rangé"
                                ? getAccreditationStatusClass("Imprimé")
                                : getAccreditationStatusClass(pressTrackingStatus)
                            }
                          >
                            {pressTrackingStatus}
                          </span>
                        </td>
                        <td>
                          {canPickLocation ? (
                            <select
                              className="acc-cell-select"
                              value={pressLocation}
                              onChange={(event) => updatePressBadgeStorageLocation(registration.id, event.target.value)}
                            >
                              <option value="">À ranger…</option>
                              {allStorageLocations.map((loc) => (
                                <option key={`${registration.id}-${loc}`} value={loc}>{loc}</option>
                              ))}
                            </select>
                          ) : (
                            <span className="acc-people-muted">—</span>
                          )}
                        </td>
                        <td className="acc-people-actions">
                          {pressTrackingStatus === "Imprimé à détruire" ? (
                            <button
                              className="button button--ghost-danger button--small"
                              type="button"
                              onClick={() => markPressBadgeDestroyed(registration)}
                            >
                              Détruit
                            </button>
                          ) : null}
                          {registration.printStatus === "Dans la file" ? (
                            <span className="acc-people-muted">en file</span>
                          ) : null}
                          {canQueuePress ? (
                            <button
                              className="button button--secondary button--small"
                              type="button"
                              onClick={() => addPressToPrintQueue(registration)}
                            >
                              + File
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
      ) : canOperatePrinting && activeAccreditationTab === "print" ? (
        <section className="panel-grid panel-grid--2">
          <Panel
            title="Bénévoles & staff"
            subtitle="2 PDF par lot : les badges et la liste des badges imprimés."
          >
            <div className="table-wrap">
              <table className="data-table data-table--admin">
                <thead>
                  <tr>
                    <th>Personne</th>
                    <th>Rôle badge</th>
                    <th>Zones</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleQueuedVolunteers.map((volunteer) => (
                    <tr key={`queue-${volunteer.id}`}>
                      <td>{`${volunteer.firstName} ${volunteer.lastName}`.trim() || volunteer.email}</td>
                      <td>{getBadgeRoleLabel(volunteer, getVolunteerOverride(volunteer.id), normalizeComparableValue) || "-"}</td>
                      <td>{getFinalZoneLabels(volunteer).join(", ") || "Aucune zone"}</td>
                      <td>
                        <button
                          className="button button--ghost-danger button--small"
                          type="button"
                          onClick={() => updateVolunteerPrintStatus(volunteer, "Non-imprimé")}
                        >
                          Retirer
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!queuedVolunteers.length ? (
                    <tr>
                      <td colSpan="4">Aucune personne n'est actuellement dans la file d'impression.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            {canShowMoreListItems("queued-volunteers", queuedVolunteers) ? (
              <div className="list-progressive-actions">
                <button
                  className="button button--secondary button--small"
                  type="button"
                  onClick={() => showMoreListItems("queued-volunteers")}
                >
                  Afficher 10 de plus
                </button>
              </div>
            ) : null}

            <div className="table-actions table-actions--inline">
              <button
                className="button button--secondary"
                type="button"
                onClick={openSampleAccreditation}
              >
                Badge témoin
              </button>
              <button
                className="button button--primary"
                type="button"
                onClick={finalizePrintQueue}
                disabled={!queuedVolunteers.length}
              >
                Générer les 2 PDF ({queuedVolunteers.length})
              </button>
            </div>

          </Panel>

          <Panel
            title="Juges"
            subtitle="Mise en file depuis Personnes › Juges."
          >
            <div className="table-wrap">
              <table className="data-table data-table--admin">
                <thead>
                  <tr>
                    <th>Juge</th>
                    <th>Libellé badge</th>
                    <th>Zones</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleQueuedJudges.map((judge) => (
                    <tr key={`judge-queue-${judge.id}`}>
                      <td>{`${judge.firstName} ${judge.lastName}`.trim() || "Juge sans nom"}</td>
                      <td>{judge.badgeLabel || "Judge"}</td>
                      <td>
                        {sortedZones
                          .filter((zone) => judge.assignedZones.includes(zone.id))
                          .map((zone) => formatZoneLabel(zone))
                          .join(", ") || "Aucune zone"}
                      </td>
                      <td>
                        <button
                          className="button button--ghost-danger button--small"
                          type="button"
                          onClick={() => updateJudgePrintStatus(judge, "Non-imprimé")}
                        >
                          Retirer
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!queuedJudges.length ? (
                    <tr>
                      <td colSpan="4">Aucun juge n'est actuellement dans la file d'impression.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            {canShowMoreListItems("queued-judges", queuedJudges) ? (
              <div className="list-progressive-actions">
                <button
                  className="button button--secondary button--small"
                  type="button"
                  onClick={() => showMoreListItems("queued-judges")}
                >
                  Afficher 10 de plus
                </button>
              </div>
            ) : null}

            <div className="table-actions table-actions--inline">
              <button
                className="button button--primary"
                type="button"
                onClick={finalizeJudgePrintQueue}
                disabled={!queuedJudges.length}
              >
                Générer les 2 PDF ({queuedJudges.length})
              </button>
            </div>
          </Panel>

          <Panel
            title="Presse"
            subtitle="Mise en file depuis Personnes › Presse."
          >
            <div className="table-wrap">
              <table className="data-table data-table--admin">
                <thead>
                  <tr>
                    <th>Personne</th>
                    <th>Type</th>
                    <th>Zones</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleQueuedPress.map((registration) => (
                    <tr key={`press-queue-${registration.id}`}>
                      <td>{`${registration.firstName || ""} ${registration.lastName || ""}`.trim() || registration.media || "—"}</td>
                      <td>{PRESS_REQUEST_TYPE_LABELS[registration.requestType] || registration.requestType}</td>
                      <td>
                        {sortedZones
                          .filter((zone) => (registration.zoneIds || []).includes(zone.id))
                          .map((zone) => formatZoneLabel(zone))
                          .join(", ") || "Aucune zone"}
                      </td>
                      <td>
                        <button
                          className="button button--ghost-danger button--small"
                          type="button"
                          onClick={() => updatePressPrintStatus(registration, "Non-imprimé")}
                        >
                          Retirer
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!queuedPress.length ? (
                    <tr>
                      <td colSpan="4">Aucun accrédité presse n'est actuellement dans la file d'impression.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            {canShowMoreListItems("queued-press", queuedPress) ? (
              <div className="list-progressive-actions">
                <button
                  className="button button--secondary button--small"
                  type="button"
                  onClick={() => showMoreListItems("queued-press")}
                >
                  Afficher 10 de plus
                </button>
              </div>
            ) : null}

            <div className="table-actions table-actions--inline">
              <button
                className="button button--primary"
                type="button"
                onClick={finalizePressPrintQueue}
                disabled={!queuedPress.length}
              >
                Générer les 2 PDF ({queuedPress.length})
              </button>
            </div>
          </Panel>

          <Panel
            title="VIP"
            subtitle="8 badges par A4, +1 pour l’accompagnant nommé. Mise en file ici ou dans VIP › Inscrits."
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

          <Panel
            title="Badges non nominatifs"
            subtitle="Coachs ou athlètes, zones par défaut, sans nom. Gardés dans l’historique."
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

        </section>
      ) : canOperatePrinting && activeAccreditationTab === "plans" ? (
        <CoquePlanEditor currentUserLabel={getCurrentOperatorLabel()} />
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
      ) : canOperatePrinting && activeAccreditationTab === "tracking" ? (
        <section className="admin-stack">
          <div className="tracking-counters">
            <div className="tracking-counter">
              <strong>{printableVolunteers.length}</strong>
              <span>Total</span>
            </div>
            <div className="tracking-counter tracking-counter--unprinted">
              <strong>{trackingCountByStatus["Non imprimé"] ?? 0}</strong>
              <span>Non imprimé</span>
            </div>
            <div className="tracking-counter tracking-counter--unstored">
              <strong>{trackingCountByStatus["Imprimé non rangé"] ?? 0}</strong>
              <span>Imprimé non rangé</span>
            </div>
            <div className="tracking-counter tracking-counter--stored">
              <strong>{trackingCountByStatus["Rangé"] ?? 0}</strong>
              <span>Rangé</span>
            </div>
            <div className="tracking-counter tracking-counter--handed-over">
              <strong>{trackingCountByStatus["Remis"] ?? 0}</strong>
              <span>Remis</span>
            </div>
          </div>

          <Panel title="Suivi des badges" subtitle="Recherchez une personne, filtrez par statut ou point de retrait.">
            <div className="admin-toolbar">
              <label className="field">
                <span>Rechercher</span>
                <input
                  placeholder="Nom ou prénom..."
                  value={trackingSearch}
                  onChange={(event) => setTrackingSearch(event.target.value)}
                />
              </label>
              <label className="field">
                <span>Statut</span>
                <select value={trackingStatusFilter} onChange={(event) => setTrackingStatusFilter(event.target.value)}>
                  <option>Tous</option>
                  <option>Non imprimé</option>
                  <option>Imprimé non rangé</option>
                  <option>Rangé</option>
                  <option>Remis</option>
                  <option>Annulé</option>
                  <option>Imprimé à détruire</option>
                </select>
              </label>
              <label className="field">
                <span>Point de retrait</span>
                <select value={trackingLocationFilter} onChange={(event) => setTrackingLocationFilter(event.target.value)}>
                  <option>Tous</option>
                  <option value="Non rangé">Non rangé</option>
                  {trackingUsedLocations.map((loc) => <option key={loc}>{loc}</option>)}
                </select>
              </label>
            </div>

            <div className="table-wrap">
              <table className="data-table data-table--admin">
                <thead>
                  <tr>
                    <th>Nom</th>
                    <th>Rôle badge</th>
                    <th>Statut</th>
                    <th>Point de retrait</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleTrackingVolunteers.map((volunteer) => {
                    const status = getBadgeTrackingStatus(volunteer);
                    const location = getBadgeStorageLocation(volunteer.id);
                    const pickerOpen = Boolean(storagePickerOpenById[volunteer.id]);
                    const override = getVolunteerOverride(volunteer.id);
                    const hasWarning = Boolean(override.warningMessage);
                    const statusClass =
                      status === "Rangé" || status === "Imprimé non rangé"
                        ? getAccreditationStatusClass("Imprimé")
                        : getAccreditationStatusClass(status);

                    return (
                      <tr key={`track-${volunteer.id}`}>
                        <td className="accreditation-people-name">
                          {`${volunteer.firstName} ${volunteer.lastName}`.trim() || volunteer.email}
                        </td>
                        <td>{getBadgeRoleLabel(volunteer, getVolunteerOverride(volunteer.id), normalizeComparableValue) || "—"}</td>
                        <td>
                          <div className="accreditation-status-inline">
                            <span className={statusClass}>{status}</span>
                            {hasWarning ? (
                              <span className="accreditation-status-flag" title={override.warningMessage}>
                                Modifiee
                              </span>
                            ) : null}
                          </div>
                        </td>
                        <td>
                          {status === "Non imprimé" ? (
                            <span className="panel-note">—</span>
                          ) : status === "Annulé" || status === "Imprimé à détruire" ? (
                            <span className="panel-note">Pas de retrait</span>
                          ) : status === "Remis" ? (
                            <span className="panel-note">{location || "Remis directement"}</span>
                          ) : pickerOpen ? (
                            <div className="tracking-location-picker">
                              <select
                                defaultValue={location}
                                autoFocus
                                onChange={(event) => updateBadgeStorageLocation(volunteer.id, event.target.value)}
                                onBlur={() => setStoragePickerOpenById((current) => ({ ...current, [volunteer.id]: false }))}
                              >
                                <option value="">Choisir un point de retrait...</option>
                                {allStorageLocations.map((loc) => (
                                  <option key={loc} value={loc}>{loc}</option>
                                ))}
                              </select>
                            </div>
                          ) : status === "Imprimé non rangé" ? (
                            <button
                              className="button button--primary button--small"
                              type="button"
                              onClick={() => setStoragePickerOpenById((current) => ({ ...current, [volunteer.id]: true }))}
                            >
                              Définir le point de retrait
                            </button>
                          ) : (
                            <div className="tracking-location-display">
                              <span>{location}</span>
                              <button
                                className="button button--ghost button--small"
                                type="button"
                                onClick={() => setStoragePickerOpenById((current) => ({ ...current, [volunteer.id]: true }))}
                              >
                                Modifier
                              </button>
                            </div>
                          )}
                        </td>
                        <td>
                          {status === "Imprimé à détruire" ? (
                            <button
                              className="button button--ghost-danger button--small"
                              type="button"
                              onClick={() => markBadgeDestroyed(volunteer)}
                            >
                              Destruction effectuée
                            </button>
                          ) : status === "Imprimé non rangé" || status === "Rangé" ? (
                            <button
                              className="button button--secondary button--small"
                              type="button"
                              onClick={() => markBadgeHandedOver(volunteer)}
                            >
                              Marquer comme remis
                            </button>
                          ) : (
                            <span className="panel-note">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {!trackingVolunteers.length ? (
                    <tr>
                      <td colSpan="5">
                        {printableVolunteers.length
                          ? "Aucun résultat pour ces filtres."
                          : "Aucune personne n'a encore été affectée à un rôle."}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            {canShowMoreListItems("tracking-volunteers", trackingVolunteers) ? (
              <div className="list-progressive-actions">
                <button
                  className="button button--secondary button--small"
                  type="button"
                  onClick={() => showMoreListItems("tracking-volunteers")}
                >
                  Afficher 10 de plus
                </button>
              </div>
            ) : null}
          </Panel>

          <Panel
            title="Points de retrait"
            subtitle="Gérez les emplacements de rangement disponibles lors de la remise des badges."
          >
            <div className="accreditation-zone-list">
              {customStorageLocations.length === 0 ? (
                <p className="panel-note">Aucun point de retrait défini. Ajoutez-en un ci-dessous.</p>
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
                <span>Nouveau point de retrait</span>
                <input
                  placeholder="Ex: Bureau chronométrage"
                  value={newStorageLocationName}
                  onChange={(event) => setNewStorageLocationName(event.target.value)}
                  onKeyDown={(event) => { if (event.key === "Enter") addCustomStorageLocation(); }}
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
        </section>
      ) : null}
    </div>
  );
}

export { AccreditationsPage };
