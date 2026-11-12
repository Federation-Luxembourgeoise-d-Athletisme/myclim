// Accréditations simplifiées (maquette design/accreditation/maquette-simple.html,
// validée par Margot le 12/11/2026) : plus de file d'impression. Un badge passe
// par 3 étapes — À imprimer → Imprimé → Remis — plus « À traiter » quand il faut
// agir (réimprimer un badge modifié, récupérer un badge d'une personne qui n'est
// plus affectée). Les étapes sont calculées à partir des statuts déjà
// enregistrés (printStatus, warningMessage, handedOverAt, destroyedAt) : aucune
// donnée n'est migrée. Règles pures, testées dans tests/accreditation-steps.test.js.

const STEP_IDS = ["todo", "done", "given", "attn"];

const STEP_LABELS = {
  todo: { fr: "À imprimer", en: "To print" },
  done: { fr: "Imprimé", en: "Printed" },
  given: { fr: "Remis", en: "Handed over" },
  attn: { fr: "À traiter", en: "To handle" },
};

// record : { printStatus, warningMessage, handedOverAt, destroyedAt }
// Renvoie { step, reason } ; step null = le badge ne s'affiche plus (annulé
// sans avoir été imprimé, ou ancien badge détruit).
function getBadgeStep(record = {}) {
  const status = String(record.printStatus || "Non-imprimé");
  if (record.destroyedAt) return { step: null, reason: "" };
  if (status === "Annulé") return { step: null, reason: "" };
  if (status === "Imprimé à détruire") {
    return { step: "attn", reason: "recover" };
  }
  if (status === "Imprimé") {
    return { step: record.handedOverAt ? "given" : "done", reason: "" };
  }
  // Non-imprimé, ou « Dans la file » d'avant la simplification : à imprimer.
  if (record.warningMessage) return { step: "attn", reason: "modified" };
  return { step: "todo", reason: "" };
}

const REASON_LABELS = {
  modified: {
    fr: "Modifié depuis l'impression : réimprimer et détruire l'ancien badge.",
    en: "Changed since printing: reprint and destroy the old badge.",
  },
  recover: {
    fr: "N'est plus affecté : récupérer et détruire le badge imprimé.",
    en: "No longer assigned: collect and destroy the printed badge.",
  },
};

// Peut-on imprimer ce badge maintenant ? (À imprimer, ou à réimprimer.)
function canPrintStep({ step, reason } = {}) {
  return step === "todo" || (step === "attn" && reason === "modified");
}

function countSteps(records = []) {
  const counts = { todo: 0, done: 0, given: 0, attn: 0 };
  records.forEach((record) => {
    const { step } = getBadgeStep(record);
    if (step) counts[step] += 1;
  });
  return counts;
}

export { REASON_LABELS, STEP_IDS, STEP_LABELS, canPrintStep, countSteps, getBadgeStep };
