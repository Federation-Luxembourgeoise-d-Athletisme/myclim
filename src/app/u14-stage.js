import { formatDateForDisplay, getTimestampMs, normalizeComparableValue } from "./u14-helpers";

// Un seul statut par enfant, du point de vue de l'équipe, à la place des trois
// colonnes « statut / validation admin / décision parent ». Le parcours :
// Demande reçue → À retenir → Attend le parent (10 jours) → Confirmé, avec à
// côté Liste d'attente, Sans réponse, Désisté et Non retenu.
const U14_STAGE_TONES = {
  neutral: "status-pill",
  accent: "status-pill status-pill--accent",
  warn: "status-pill status-pill--warn",
  ok: "status-pill status-pill--ok",
  danger: "status-pill status-pill--danger",
};

function getU14ChildStage(request, now = Date.now()) {
  const status = normalizeComparableValue(request?.status);
  const approval = normalizeComparableValue(request?.adminApprovalStatus);
  const decision = normalizeComparableValue(request?.parentDecisionStatus);
  const isBasket = normalizeComparableValue(request?.requestType) === "porte_panier";
  const deadlineMs = getTimestampMs(request?.confirmationDeadline);

  if (["declined", "cancelled"].includes(status) || decision === "declined") {
    return {
      key: "withdrawn",
      label: "Désisté",
      tone: "danger",
      detail: `${request?.declinedByAdmin ? "place libérée par l'équipe" : "par le parent"}${
        request?.parentDecisionAt ? ` le ${formatDateForDisplay(request.parentDecisionAt)}` : ""
      }`,
    };
  }
  if (status === "rejected") return { key: "rejected", label: "Non retenu", tone: "danger", detail: "" };
  if (approval === "approved" && decision === "confirmed") {
    return {
      key: "confirmed",
      label: "Confirmé",
      tone: "ok",
      detail: request?.parentDecisionAt ? `le ${formatDateForDisplay(request.parentDecisionAt)}` : "",
    };
  }
  if (approval === "approved") {
    if (deadlineMs && deadlineMs < now) {
      return { key: "overdue", label: "Sans réponse", tone: "danger", detail: `délai dépassé le ${formatDateForDisplay(request.confirmationDeadline)}` };
    }
    return {
      key: "waiting-parent",
      label: "Attend le parent",
      tone: "warn",
      detail: deadlineMs ? `jusqu'au ${formatDateForDisplay(request.confirmationDeadline)}` : "mail envoyé",
    };
  }
  if (status === "waitlisted") {
    return {
      key: "waitlist",
      label: `Liste d'attente n°${request?.waitlistPosition || request?.queuePosition || "?"}`,
      tone: "warn",
      detail: "monte dès qu'une place se libère",
    };
  }
  if (isBasket) return { key: "to-decide", label: "À décider", tone: "neutral", detail: "demande porte-panier" };
  if (status === "confirmed") {
    return {
      key: "to-retain",
      label: "À retenir",
      tone: "accent",
      detail: request?.promotedFromWaitlistAt
        ? `monté de la liste d'attente le ${formatDateForDisplay(request.promotedFromWaitlistAt)}`
        : "une place est disponible",
    };
  }
  return { key: "received", label: "Demande reçue", tone: "neutral", detail: "en cours de répartition" };
}

// Ordre d'affichage dans le tableau d'une course.
const U14_STAGE_ORDER = {
  confirmed: 0,
  "waiting-parent": 1,
  overdue: 2,
  "to-retain": 3,
  received: 4,
  waitlist: 5,
  "to-decide": 6,
  rejected: 7,
  withdrawn: 8,
};

export { U14_STAGE_ORDER, U14_STAGE_TONES, getU14ChildStage };
