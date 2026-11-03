import { formatDateForDisplay, getTimestampMs, normalizeComparableValue } from "./u14-helpers";
import { U14_ADMIN_COPY, fillU14Copy as fill } from "./u14-admin-copy";

// Un seul statut par enfant, du point de vue de l'équipe, à la place des trois
// colonnes « statut / validation admin / décision parent ». Le parcours :
// Demande reçue → À retenir → Attend le parent (10 jours) → Confirmé, avec à
// côté Liste d'attente, Sans réponse, Désisté et Non retenu.
// `labels` : copy.stages de u14-admin-copy.js (français par défaut).
function getU14ChildStage(request, now = Date.now(), labels = U14_ADMIN_COPY.fr.stages) {
  const status = normalizeComparableValue(request?.status);
  const approval = normalizeComparableValue(request?.adminApprovalStatus);
  const decision = normalizeComparableValue(request?.parentDecisionStatus);
  const isBasket = normalizeComparableValue(request?.requestType) === "porte_panier";
  const deadlineMs = getTimestampMs(request?.confirmationDeadline);

  const date = (value) => formatDateForDisplay(value);

  if (["declined", "cancelled"].includes(status) || decision === "declined") {
    const who = request?.declinedByAdmin ? labels.withdrawnByTeam : labels.withdrawnByParent;
    const when = request?.parentDecisionAt ? ` ${fill(labels.onDate, { date: date(request.parentDecisionAt) })}` : "";
    return { key: "withdrawn", label: labels.withdrawn, tone: "danger", detail: `${who}${when}` };
  }
  if (status === "rejected") return { key: "rejected", label: labels.rejected, tone: "danger", detail: "" };
  if (approval === "approved" && decision === "confirmed") {
    return {
      key: "confirmed",
      label: labels.confirmed,
      tone: "ok",
      detail: request?.parentDecisionAt ? fill(labels.onDate, { date: date(request.parentDecisionAt) }) : "",
    };
  }
  if (approval === "approved") {
    if (deadlineMs && deadlineMs < now) {
      return { key: "overdue", label: labels.overdue, tone: "danger", detail: fill(labels.overdueDetail, { date: date(request.confirmationDeadline) }) };
    }
    return {
      key: "waiting-parent",
      label: labels.waitingParent,
      tone: "warn",
      detail: deadlineMs ? fill(labels.untilDate, { date: date(request.confirmationDeadline) }) : labels.mailSent,
    };
  }
  if (status === "waitlisted") {
    return {
      key: "waitlist",
      label: fill(labels.waitlist, { position: request?.waitlistPosition || request?.queuePosition || "?" }),
      tone: "warn",
      detail: labels.waitlistDetail,
    };
  }
  if (isBasket) return { key: "to-decide", label: labels.toDecide, tone: "neutral", detail: labels.toDecideDetail };
  if (status === "confirmed") {
    return {
      key: "to-retain",
      label: labels.toRetain,
      tone: "accent",
      detail: request?.promotedFromWaitlistAt ? fill(labels.promotedDetail, { date: date(request.promotedFromWaitlistAt) }) : labels.placeAvailable,
    };
  }
  return { key: "received", label: labels.received, tone: "neutral", detail: labels.receivedDetail };
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

export { U14_STAGE_ORDER, getU14ChildStage };
