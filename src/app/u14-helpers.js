import { doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { db } from "../services/firebase";

const U14_DEFAULT_RACE_CAPACITY = 14;
const U14_RESERVED_SLOTS_PER_RACE = 3;
const U14_RESERVED_SLOTS_COLLECTION = "u14ProtectedEntries";
const U14_PRACTICAL_INFO_DOC_PATH = ["appSettings", "u14PracticalInfo"];
const U14_RACE_DEFINITIONS = [
  { code: "U12F60", label: "U12 Filles - 60 m", category: "U12", gender: "fille", event: "60 m", totalCapacity: 14 },
  { code: "U12M60", label: "U12 Garçons - 60 m", category: "U12", gender: "garcon", event: "60 m", totalCapacity: 14 },
  { code: "U14F60", label: "U14 Filles - 60 m", category: "U14", gender: "fille", event: "60 m", totalCapacity: 14 },
  { code: "U14M60", label: "U14 Garçons - 60 m", category: "U14", gender: "garcon", event: "60 m", totalCapacity: 14 },
  { code: "U14F1000", label: "U14 Filles - 1000 m", category: "U14", gender: "fille", event: "1000 m", totalCapacity: 14 },
  { code: "U14M1000", label: "U14 Garçons - 1000 m", category: "U14", gender: "garcon", event: "1000 m", totalCapacity: 14 },
];
const U14_RACE_DEFINITION_MAP = new Map(U14_RACE_DEFINITIONS.map((definition) => [definition.code, definition]));
const U14_REQUESTABLE_EVENTS_BY_CATEGORY = {
  U12: ["60 m"],
  U14: ["60 m", "1000 m"],
};
const luxCompetitionClubs = [
  "CAB",
  "CAD",
  "CAPA",
  "CSL",
  "CELTIC",
  "LIAL",
  "CAEG",
  "CAFOLA",
  "CAS",
  "Karibu",
  "Trispeed",
  "RBUAP",
  "CSN Clervaux",
  "Triathlon Luxembourg",
  "Team X3M Snooze",
];

function normalizeComparableValue(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function normalizeBibNumber(value) {
  return normalizeComparableValue(value).replace(/\s+/g, "");
}

function getTimestampMs(value) {
  if (!value) return 0;
  if (typeof value?.toMillis === "function") return value.toMillis();

  const date = new Date(value);
  const timestamp = date.getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function formatDateForDisplay(value) {
  if (!value) return "Non définie";

  const timestamp = getTimestampMs(value);
  const date = timestamp ? new Date(timestamp) : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  return new Intl.DateTimeFormat("fr-LU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function formatDateTimeForDisplay(value) {
  if (!value) return "Non définie";

  const timestamp = getTimestampMs(value);
  const date = timestamp ? new Date(timestamp) : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  return new Intl.DateTimeFormat("fr-LU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function getU14EventCode(requestedEvent) {
  const normalizedEvent = normalizeComparableValue(requestedEvent);
  if (normalizedEvent.includes("1000")) return "1000";
  if (normalizedEvent.includes("60")) return "60";
  return "";
}

function getU14GenderCode(gender) {
  const normalizedGender = normalizeComparableValue(gender);
  if (normalizedGender.startsWith("f")) return "F";
  if (normalizedGender.startsWith("g") || normalizedGender.startsWith("m")) return "M";
  return "";
}

function getU14RaceCode({ category, gender, requestedEvent }) {
  const normalizedCategory = String(category || "").trim().toUpperCase();
  const genderCode = getU14GenderCode(gender);
  const eventCode = getU14EventCode(requestedEvent);

  if (!normalizedCategory || !genderCode || !eventCode) return "";
  return `${normalizedCategory}${genderCode}${eventCode}`;
}

function getU14RaceDefinition(raceCode) {
  return U14_RACE_DEFINITION_MAP.get(String(raceCode || "").trim()) || null;
}

function getU14RaceLabel(raceCode) {
  return getU14RaceDefinition(raceCode)?.label || "Course à confirmer";
}

function getU14AllowedEvents(category) {
  const normalizedCategory = String(category || "").trim().toUpperCase();
  return U14_REQUESTABLE_EVENTS_BY_CATEGORY[normalizedCategory] || ["60 m"];
}

function getValidRequestedEventForCategory(category, requestedEvent) {
  const allowedEvents = getU14AllowedEvents(category);
  return allowedEvents.includes(requestedEvent) ? requestedEvent : allowedEvents[0];
}

function getPreProgramSubmissionErrorMessage(error) {
  switch (error?.code) {
    case "preprogram/users-write-failed":
    case "preprogram/child-write-failed":
    case "preprogram/request-write-failed":
      return error.message;
    case "auth/email-already-in-use":
      return "Un compte existe déjà avec cette adresse email.";
    case "auth/invalid-email":
      return "L'adresse email du parent n'est pas valide.";
    case "auth/missing-password":
      return "Le mot de passe est manquant.";
    case "auth/weak-password":
      return "Le mot de passe doit contenir au moins 6 caractères.";
    case "auth/network-request-failed":
      return "La création du compte a échoué à cause d'un problème réseau. Réessaie dans un instant.";
    case "permission-denied":
    case "firestore/permission-denied":
      return "La création du compte a été refusée par les règles d'accès.";
    case "unavailable":
    case "firestore/unavailable":
      return "Le service d'inscription est momentanément indisponible. Réessaie plus tard.";
    default:
      return error?.message
        ? `La création du compte a échoué : ${error.message}`
        : "La création du compte a échoué pour une raison inconnue.";
  }
}

function getProtectedSlotStatusLabel(status) {
  switch (normalizeComparableValue(status)) {
    case "invited":
      return "Invitation envoyée";
    case "matched":
      return "Matchée";
    case "released":
      return "Libérée";
    default:
      return "À configurer";
  }
}

function getParentDecisionLabel(status) {
  switch (normalizeComparableValue(status)) {
    case "confirmed":
      return "Validé";
    case "declined":
      return "Désisté";
    default:
      return "En attente parent";
  }
}

function getAdminApprovalLabel(status) {
  switch (normalizeComparableValue(status)) {
    case "approved":
      return "Retenu";
    case "pending":
      return "En attente admin";
    default:
      return "Non concerné";
  }
}

function formatU14RequestStatusLabel(status) {
  switch (String(status || "").trim().toLowerCase()) {
    case "submitted":
      return "Demande reçue";
    case "confirmed":
      return "Retenue";
    case "waitlisted":
      return "Liste d'attente";
    case "declined":
      return "Désisté";
    case "rejected":
      return "Non retenue";
    default:
      return String(status || "À confirmer");
  }
}

function getU14WorkflowStatusLabel(requestLike) {
  const requestStatus = normalizeComparableValue(requestLike?.status);
  const adminStatus = normalizeComparableValue(requestLike?.adminApprovalStatus);
  const parentStatus = normalizeComparableValue(requestLike?.parentDecisionStatus);

  if (parentStatus === "confirmed") return "Validé";
  if (requestStatus === "declined" || parentStatus === "declined") return "Désisté";
  if (requestStatus === "confirmed" && adminStatus === "approved") return "Retenu";
  if (requestStatus === "submitted") return "Demande enregistrée";
  if (requestStatus === "waitlisted") return "Liste d'attente";
  if (requestStatus === "rejected") return "Non retenue";
  return formatU14RequestStatusLabel(requestLike?.status);
}

function getU14ParentStatusLabel(requestLike) {
  const requestStatus = normalizeComparableValue(requestLike?.status);
  const adminStatus = normalizeComparableValue(requestLike?.adminApprovalStatus);
  const parentStatus = normalizeComparableValue(requestLike?.parentDecisionStatus);

  if (requestStatus === "declined" || parentStatus === "declined") return "Désisté";
  if (requestStatus === "rejected") return "Non retenue";
  if (requestStatus === "waitlisted") return "Liste d'attente";
  if (adminStatus !== "approved") return "Demande enregistrée";
  if (parentStatus === "confirmed") return "Validé";
  if (requestStatus === "confirmed" && adminStatus === "approved") return "Retenu";
  return "Demande enregistrée";
}

function getU14ParentStatusPillClass(status) {
  switch (normalizeComparableValue(status)) {
    case "valide":
      return "status-pill status-pill--ok";
    case "retenu":
      return "status-pill status-pill--accent";
    case "liste d'attente":
      return "status-pill status-pill--warn";
    case "desiste":
    case "non retenue":
      return "status-pill status-pill--danger";
    default:
      return "status-pill";
  }
}

function getU14PracticalRoleKey(requestLike) {
  const allocationMode = normalizeComparableValue(requestLike?.allocationMode);
  const requestType = normalizeComparableValue(requestLike?.requestType);

  if (allocationMode === "porte_panier" || requestType === "porte_panier") {
    return "porte_panier";
  }

  return "preprogram";
}

function isU14RequestInactive(status) {
  return ["declined", "cancelled", "rejected"].includes(normalizeComparableValue(status));
}

function isProtectedSlotActive(slot) {
  return normalizeComparableValue(slot?.status) !== "released";
}

function buildU14RequestRecord(request, child) {
  const childFirstName = request.childFirstName || child?.firstName || "";
  const childLastName = request.childLastName || child?.lastName || "";
  const childName = [childFirstName, childLastName].filter(Boolean).join(" ").trim() || "Enfant";
  const parentName =
    [request.parentFirstName, request.parentLastName].filter(Boolean).join(" ").trim() || "Responsable";
  const raceCode =
    request.raceCode ||
    getU14RaceCode({
      category: request.category || child?.category,
      gender: request.gender || child?.gender,
      requestedEvent: request.requestedEvent,
    });

  return {
    ...request,
    child,
    childFirstName,
    childLastName,
    childName,
    parentName,
    parentEmail: request.parentEmail || "",
    category: request.category || child?.category || "",
    club: request.club || child?.club || "",
    bibNumber: request.bibNumber || child?.bibNumber || "",
    gender: request.gender || child?.gender || "",
    raceCode,
    raceLabel: getU14RaceLabel(raceCode),
    submittedAtMs: getTimestampMs(request.submittedAt),
  };
}

function doesProtectedSlotMatchRequest(slot, request) {
  if (!slot || !request) return false;
  if (slot.raceCode !== request.raceCode) return false;

  const slotBib = normalizeBibNumber(slot.bibNumber);
  const requestBib = normalizeBibNumber(request.bibNumber);
  if (slotBib && requestBib) return slotBib === requestBib;

  return (
    normalizeComparableValue(slot.firstName) === normalizeComparableValue(request.childFirstName) &&
    normalizeComparableValue(slot.lastName) === normalizeComparableValue(request.childLastName) &&
    normalizeComparableValue(slot.club) === normalizeComparableValue(request.club)
  );
}

function buildU14AllocationSnapshot({ requests, children, protectedEntries }) {
  const childrenById = children.reduce((accumulator, child) => {
    accumulator.set(child.id, child);
    return accumulator;
  }, new Map());

  const requestRecords = requests.map((request) => buildU14RequestRecord(request, childrenById.get(request.childId)));
  const requestStatusMap = new Map();
  const raceSummaries = U14_RACE_DEFINITIONS.map((definition) => {
    const activeProtectedEntries = protectedEntries
      .filter((entry) => entry.raceCode === definition.code && isProtectedSlotActive(entry))
      .sort((left, right) => Number(left.slotNumber || 0) - Number(right.slotNumber || 0));
    const matchedProtectedRequestIds = new Set(
      activeProtectedEntries
        .map((entry) => String(entry.matchedRequestId || "").trim())
        .filter(Boolean),
    );
    const matchedProtectedRequests = requestRecords.filter((request) => matchedProtectedRequestIds.has(request.id));
    const generalCandidates = requestRecords
      .filter(
        (request) =>
          request.raceCode === definition.code &&
          request.requestType !== "porte_panier" &&
          !isU14RequestInactive(request.status) &&
          !matchedProtectedRequestIds.has(request.id),
      )
      .sort((left, right) => {
        if (left.submittedAtMs !== right.submittedAtMs) return left.submittedAtMs - right.submittedAtMs;
        return left.childName.localeCompare(right.childName, "fr");
      });

    const generalCapacity = Math.max(
      (definition.totalCapacity || U14_DEFAULT_RACE_CAPACITY) - activeProtectedEntries.length,
      0,
    );
    const confirmedGeneralRequests = generalCandidates.slice(0, generalCapacity);
    const waitlistedRequests = generalCandidates.slice(generalCapacity);
    const protectedPendingEntries = activeProtectedEntries.filter(
      (entry) => normalizeComparableValue(entry.status) !== "matched",
    );
    const totalPlaces = definition.totalCapacity || U14_DEFAULT_RACE_CAPACITY;
    const takenPlaces = activeProtectedEntries.length + confirmedGeneralRequests.length;

    activeProtectedEntries.forEach((entry) => {
      const matchedRequestId = String(entry.matchedRequestId || "").trim();
      if (!matchedRequestId) return;

      requestStatusMap.set(matchedRequestId, {
        status: "confirmed",
        allocationMode: "protected",
        protectedSlotId: entry.id,
        acceptedPosition: Number(entry.slotNumber || 0) || null,
        waitlistPosition: null,
        queuePosition: Number(entry.slotNumber || 0) || null,
        parentDecisionRequired: false,
      });
    });

    confirmedGeneralRequests.forEach((request, index) => {
      requestStatusMap.set(request.id, {
        status: "confirmed",
        allocationMode: "platform",
        protectedSlotId: null,
        acceptedPosition: index + 1,
        waitlistPosition: null,
        queuePosition: index + 1,
        parentDecisionRequired: false,
      });
    });

    waitlistedRequests.forEach((request, index) => {
      requestStatusMap.set(request.id, {
        status: "waitlisted",
        allocationMode: "platform",
        protectedSlotId: null,
        acceptedPosition: null,
        waitlistPosition: index + 1,
        queuePosition: generalCapacity + index + 1,
        parentDecisionRequired: false,
      });
    });

    return {
      ...definition,
      protectedEntries: activeProtectedEntries,
      matchedProtectedRequests,
      confirmedGeneralRequests,
      waitlistedRequests,
      protectedPendingEntries,
      generalCapacity,
      totalPlaces,
      protectedPlaces: activeProtectedEntries.length,
      takenPlaces,
      remainingPlaces: Math.max(totalPlaces - takenPlaces, 0),
      availableProtectedSlots: Math.max(U14_RESERVED_SLOTS_PER_RACE - activeProtectedEntries.length, 0),
    };
  });

  return { requestRecords, requestStatusMap, raceSummaries };
}

async function syncU14RaceAllocations({ requests, children, protectedEntries }) {
  const { requestRecords, requestStatusMap } = buildU14AllocationSnapshot({
    requests,
    children,
    protectedEntries,
  });

  for (const request of requestRecords) {
    if (request.requestType === "porte_panier" || !request.raceCode || isU14RequestInactive(request.status)) {
      continue;
    }

    const nextState = requestStatusMap.get(request.id);
    if (!nextState) continue;

    const currentStatus = normalizeComparableValue(request.status);
    const nextStatus = normalizeComparableValue(nextState.status);
    const currentAllocationMode = normalizeComparableValue(request.allocationMode);
    const nextAllocationMode = normalizeComparableValue(nextState.allocationMode);
    const currentAcceptedPosition = Number(request.acceptedPosition || 0) || null;
    const currentWaitlistPosition = Number(request.waitlistPosition || 0) || null;

    if (
      currentStatus === nextStatus &&
      currentAllocationMode === nextAllocationMode &&
      currentAcceptedPosition === nextState.acceptedPosition &&
      currentWaitlistPosition === nextState.waitlistPosition &&
      String(request.protectedSlotId || "") === String(nextState.protectedSlotId || "")
    ) {
      continue;
    }

    await updateDoc(doc(db, "u14Requests", request.id), {
      status: nextState.status,
      allocationMode: nextState.allocationMode,
      protectedSlotId: nextState.protectedSlotId,
      acceptedPosition: nextState.acceptedPosition,
      waitlistPosition: nextState.waitlistPosition,
      queuePosition: nextState.queuePosition,
      parentDecisionRequired:
        nextState.status === "confirmed"
          ? normalizeComparableValue(request.adminApprovalStatus) === "approved"
          : nextState.parentDecisionRequired,
      adminApprovalStatus:
        nextState.status === "confirmed"
          ? currentStatus === "confirmed" && normalizeComparableValue(request.adminApprovalStatus) === "approved"
            ? "approved"
            : "pending"
          : null,
      parentDecisionStatus:
        nextState.status === "confirmed"
          ? currentStatus === "confirmed" &&
            normalizeComparableValue(request.parentDecisionStatus) === "confirmed" &&
            normalizeComparableValue(request.adminApprovalStatus) === "approved"
            ? "confirmed"
            : null
          : null,
      allocationUpdatedAt: serverTimestamp(),
    });
  }
}

function createEmptyParentU14ChildForm() {
  return {
    firstName: "",
    lastName: "",
    birthDate: "",
    category: "",
    gender: "",
    club: "",
    bibNumber: "",
    requestType: "preprogram",
    requestedEvent: "60 m",
    notes: "",
    imageConsent: false,
  };
}

export {
  U14_PRACTICAL_INFO_DOC_PATH,
  U14_RACE_DEFINITIONS,
  U14_RESERVED_SLOTS_COLLECTION,
  U14_RESERVED_SLOTS_PER_RACE,
  buildU14AllocationSnapshot,
  buildU14RequestRecord,
  createEmptyParentU14ChildForm,
  doesProtectedSlotMatchRequest,
  formatDateForDisplay,
  formatDateTimeForDisplay,
  formatU14RequestStatusLabel,
  getAdminApprovalLabel,
  getParentDecisionLabel,
  getPreProgramSubmissionErrorMessage,
  getProtectedSlotStatusLabel,
  getTimestampMs,
  getU14AllowedEvents,
  getU14ParentStatusLabel,
  getU14ParentStatusPillClass,
  getU14PracticalRoleKey,
  getU14RaceCode,
  getU14RaceLabel,
  getU14WorkflowStatusLabel,
  getValidRequestedEventForCategory,
  isProtectedSlotActive,
  luxCompetitionClubs,
  normalizeComparableValue,
  syncU14RaceAllocations,
};
