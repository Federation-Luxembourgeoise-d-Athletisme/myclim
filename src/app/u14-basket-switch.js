// Passer en porte-panier un enfant inscrit « course ou porte-panier » (demande
// preprogram_ou_porte_panier) : sa place dans la course est libérée et il est
// retenu en porte-panier ; la famille reçoit le mail porte-panier et a le même
// délai pour confirmer. Sans Firebase, testé dans tests/u14-basket-switch.test.js.

const INACTIVE_STATUSES = ["declined", "cancelled", "rejected"];

function clean(value) {
  return String(value ?? "").trim().toLowerCase();
}

// Seulement les demandes « course ou porte-panier » encore actives, et pas les
// places protégées (enfant invité) : celles-là se gèrent avec l'invitation.
function canSwitchU14RequestToBasket(request = {}, invite = null) {
  if (clean(request.requestType) !== "preprogram_ou_porte_panier") return false;
  if (INACTIVE_STATUSES.includes(clean(request.status))) return false;
  if (invite || clean(request.allocationMode) === "protected") return false;
  return true;
}

// Champs à écrire sur la demande. La course d'origine est gardée pour l'historique.
function buildU14SwitchToBasketFields(request = {}, confirmationDeadline) {
  return {
    requestType: "porte_panier",
    previousRequestType: request.requestType || "",
    previousRaceCode: request.raceCode || "",
    previousRaceLabel: request.raceLabel || "",
    status: "confirmed",
    allocationMode: "porte_panier",
    acceptedPosition: null,
    waitlistPosition: null,
    queuePosition: null,
    protectedSlotId: null,
    adminApprovalStatus: "approved",
    parentDecisionRequired: true,
    parentDecisionStatus: "pending",
    confirmationDeadline,
  };
}

export { buildU14SwitchToBasketFields, canSwitchU14RequestToBasket };
