// ── Répartition des places U12 / U14, côté serveur ──────────────────────────
// Même calcul que buildU14AllocationSnapshot / syncU14RaceAllocations
// (src/app/u14-helpers.js) : garder les deux alignés. Il tourne ici pour que
// la liste d'attente avance toute seule quand une place se libère
// (désistement d'un parent, place protégée confirmée ou expirée). Un enfant
// qui monte passe « retenu » mais reste à valider par l'équipe : c'est la
// validation qui envoie le mail d'acceptation et ouvre le délai de 10 jours.

import admin from "firebase-admin";
import { onDocumentCreated, onDocumentUpdated } from "firebase-functions/v2/firestore";
import { logger } from "firebase-functions";
import { notifyUsers, usersWithRoles } from "./notifications.js";

const REGION = "europe-west1";
const TIME_ZONE = "Europe/Luxembourg";
const DEFAULT_EDITION = "test";
const DEFAULT_POOLS = { U12F: 3, U12M: 3, U14F: 6, U14M: 6 };
const ADMIN_ROLES = ["admin", "gestionnaire"];
const RACES = [
  { code: "U12F60", label: "U12 Filles - 60 m", category: "U12", gender: "fille", capacity: 14 },
  { code: "U12M60", label: "U12 Garçons - 60 m", category: "U12", gender: "garcon", capacity: 14 },
  { code: "U14F60", label: "U14 Filles - 60 m", category: "U14", gender: "fille", capacity: 14 },
  { code: "U14M60", label: "U14 Garçons - 60 m", category: "U14", gender: "garcon", capacity: 14 },
  { code: "U14F1000", label: "U14 Filles - 1000 m", category: "U14", gender: "fille", capacity: 14 },
  { code: "U14M1000", label: "U14 Garçons - 1000 m", category: "U14", gender: "garcon", capacity: 14 },
];

const firestore = () => admin.firestore();

function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
}

function editionOf(record) {
  return normalize(record?.editionId || DEFAULT_EDITION).replace(/\s+/g, "-") || DEFAULT_EDITION;
}

function poolKeyFor(category, gender) {
  const normalizedCategory = String(category || "").trim().toUpperCase();
  if (!["U12", "U14"].includes(normalizedCategory)) return "";
  const normalizedGender = normalize(gender);
  if (normalizedGender.startsWith("f")) return `${normalizedCategory}F`;
  if (normalizedGender.startsWith("g") || normalizedGender.startsWith("m")) return `${normalizedCategory}M`;
  return "";
}

function isInactive(status) {
  return ["declined", "cancelled", "rejected"].includes(normalize(status));
}

function timestampMs(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function todayInLuxembourg() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function childNameOf(request) {
  return [request.childFirstName, request.childLastName].filter(Boolean).join(" ").trim() || "Enfant";
}

export function computeAllocation({ requests, invites, pools, reserveReleased }) {
  const claimedInviteByRequestId = new Map(
    invites.filter((invite) => invite.status === "claimed" && invite.claimedRequestId).map((invite) => [invite.claimedRequestId, invite]),
  );
  const raceRequests = requests.filter((request) => request.requestType !== "porte_panier" && request.raceCode);
  const protectedRequests = raceRequests.filter((request) => claimedInviteByRequestId.has(request.id) && !isInactive(request.status));
  // Une invitation utilisée consomme sa place de réserve, même après un désistement.
  const claimedByPool = raceRequests
    .filter((request) => claimedInviteByRequestId.has(request.id))
    .reduce((accumulator, request) => {
      const key = poolKeyFor(request.category, request.gender);
      accumulator[key] = (accumulator[key] || 0) + 1;
      return accumulator;
    }, {});

  const nextStates = new Map();
  RACES.forEach((race) => {
    const poolKey = poolKeyFor(race.category, race.gender);
    const reserve = reserveReleased ? 0 : Math.max((pools[poolKey] ?? 0) - (claimedByPool[poolKey] || 0), 0);
    const protectedInRace = protectedRequests.filter((request) => request.raceCode === race.code);
    const general = raceRequests
      .filter((request) => request.raceCode === race.code && !isInactive(request.status) && !claimedInviteByRequestId.has(request.id))
      .sort((left, right) => timestampMs(left.submittedAt) - timestampMs(right.submittedAt) || childNameOf(left).localeCompare(childNameOf(right), "fr"));
    const capacity = Math.max(race.capacity - protectedInRace.length - reserve, 0);

    protectedInRace.forEach((request, index) => {
      nextStates.set(request.id, { status: "confirmed", allocationMode: "protected", protectedSlotId: claimedInviteByRequestId.get(request.id)?.id || null, acceptedPosition: index + 1, waitlistPosition: null, queuePosition: index + 1, parentDecisionRequired: false, raceLabel: race.label });
    });
    general.slice(0, capacity).forEach((request, index) => {
      const position = protectedInRace.length + index + 1;
      nextStates.set(request.id, { status: "confirmed", allocationMode: "platform", protectedSlotId: null, acceptedPosition: position, waitlistPosition: null, queuePosition: position, parentDecisionRequired: false, raceLabel: race.label });
    });
    general.slice(capacity).forEach((request, index) => {
      nextStates.set(request.id, { status: "waitlisted", allocationMode: "platform", protectedSlotId: null, acceptedPosition: null, waitlistPosition: index + 1, queuePosition: protectedInRace.length + capacity + index + 1, parentDecisionRequired: false, raceLabel: race.label });
    });
  });

  return nextStates;
}

// Recalcule une édition et écrit les changements ; renvoie les enfants qui
// viennent de quitter la liste d'attente.
export async function recalculateU14Edition(editionId, reason = "") {
  const db = firestore();
  const [requestsSnapshot, invitesSnapshot, settingsSnapshot] = await Promise.all([
    db.collection("u14Requests").get(),
    db.collection("u14ProtectedInvites").get(),
    db.collection("appSettings").doc("u14ProtectedSettings").get(),
  ]);
  const edition = editionOf({ editionId });
  const requests = requestsSnapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() })).filter((entry) => editionOf(entry) === edition);
  const invites = invitesSnapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() })).filter((entry) => editionOf(entry) === edition);
  const settings = settingsSnapshot.exists ? settingsSnapshot.data() : {};
  const pools = { ...DEFAULT_POOLS };
  Object.keys(pools).forEach((key) => {
    const value = Number(settings?.pools?.[key]);
    if (Number.isFinite(value) && value >= 0) pools[key] = Math.floor(value);
  });
  const reserveReleased = Boolean(settings?.deadline) && todayInLuxembourg() > settings.deadline;
  const nextStates = computeAllocation({ requests, invites, pools, reserveReleased });

  const promoted = [];
  const batch = db.batch();
  let writes = 0;
  for (const request of requests) {
    if (request.requestType === "porte_panier" || !request.raceCode || isInactive(request.status)) continue;
    const next = nextStates.get(request.id);
    if (!next) continue;
    const currentStatus = normalize(request.status);
    const unchanged =
      currentStatus === next.status &&
      normalize(request.allocationMode) === next.allocationMode &&
      (Number(request.acceptedPosition || 0) || null) === next.acceptedPosition &&
      (Number(request.waitlistPosition || 0) || null) === next.waitlistPosition &&
      String(request.protectedSlotId || "") === String(next.protectedSlotId || "");
    if (unchanged) continue;

    const wasApproved = currentStatus === "confirmed" && normalize(request.adminApprovalStatus) === "approved";
    const movedUp = currentStatus === "waitlisted" && next.status === "confirmed";
    batch.update(db.collection("u14Requests").doc(request.id), {
      status: next.status,
      allocationMode: next.allocationMode,
      protectedSlotId: next.protectedSlotId,
      acceptedPosition: next.acceptedPosition,
      waitlistPosition: next.waitlistPosition,
      queuePosition: next.queuePosition,
      parentDecisionRequired: next.status === "confirmed" ? wasApproved : next.parentDecisionRequired,
      adminApprovalStatus: next.status === "confirmed" ? (wasApproved ? "approved" : "pending") : null,
      parentDecisionStatus:
        next.status === "confirmed" && wasApproved && normalize(request.parentDecisionStatus) === "confirmed" ? "confirmed" : null,
      ...(movedUp ? { promotedFromWaitlistAt: admin.firestore.FieldValue.serverTimestamp() } : {}),
      allocationUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    writes += 1;
    if (movedUp) promoted.push(`${childNameOf(request)} (${next.raceLabel})`);
  }
  if (writes) await batch.commit();

  if (promoted.length) {
    await notifyUsers({
      users: await usersWithRoles(ADMIN_ROLES),
      type: "u14_request",
      title: { fr: "Liste d'attente : enfant(s) à valider", en: "Waiting list: child(ren) to approve" },
      body: {
        fr: `Une place s'est libérée${reason ? ` (${reason})` : ""}. À valider dans le module U12 / U14 : ${promoted.join(", ")}.`,
        en: `A place became free${reason ? ` (${reason})` : ""}. To approve in the U12 / U14 module: ${promoted.join(", ")}.`,
      },
      path: "/app/u14",
    }).catch((error) => logger.error("Waiting list notification failed", error));
  }

  logger.info("U14 allocation recalculated", { edition, writes, promoted: promoted.length, reason });
  return { writes, promoted };
}

// Désistement (parent ou équipe) : la place libérée profite tout de suite au
// premier enfant en attente. Les écritures du recalcul ne repassent jamais
// par « declined », donc pas de boucle.
export const recalculateU14OnWithdrawal = onDocumentUpdated({ document: "u14Requests/{requestId}", region: REGION }, async (event) => {
  const before = event.data?.before?.data() || {};
  const after = event.data?.after?.data() || {};
  const becameInactive = !isInactive(before.status) && isInactive(after.status);
  if (!becameInactive || after.requestType === "porte_panier") return;
  await recalculateU14Edition(after.editionId, `désistement de ${childNameOf(after)}`);
});

// Nouvelle demande de course : elle reçoit tout de suite sa place (à retenir
// par l'équipe) ou son numéro de liste d'attente, sans bouton « Recalculer ».
export const recalculateU14OnCreate = onDocumentCreated({ document: "u14Requests/{requestId}", region: REGION }, async (event) => {
  const entry = event.data?.data() || {};
  if (entry.requestType === "porte_panier" || !entry.raceCode) return;
  await recalculateU14Edition(entry.editionId);
});
