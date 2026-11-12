// File d'impression des accréditations : entrer dans la file et en ressortir
// sans perdre l'état d'avant (Margot, 12/11/2026 : « on doit pouvoir supprimer
// des accréditations de la file si on s'est trompé »). Règles pures, testées
// dans tests/accreditation-queue.test.js.

const QUEUED = "Dans la file";
const MODIFIED_MESSAGE =
  "Attention modification : le contenu de cette accréditation a changé depuis la dernière impression.";

// En entrant dans la file, on garde le statut et l'alerte d'avant.
function enterQueue(override) {
  if (override.printStatus === QUEUED) return override;
  return {
    ...override,
    printStatus: QUEUED,
    queuedFrom: override.printStatus || "Non-imprimé",
    queuedWarning: override.warningMessage || "",
    warningMessage: "",
    lastQueuedAt: new Date().toISOString(),
  };
}

function sameList(left = [], right = []) {
  return [...left].sort().join("|") === [...right].sort().join("|");
}

// Retirer de la file : on revient au statut d'avant. Un badge imprimé dont le
// contenu a changé entre-temps (zones, libellé) n'est plus valable : il
// redevient « à imprimer » avec l'alerte « modifié ».
function leaveQueue(override, current = {}) {
  if (override.printStatus !== QUEUED) return override;
  let printStatus = override.queuedFrom || "Non-imprimé";
  let warningMessage = override.queuedWarning || "";
  if (printStatus === "Imprimé") {
    const snapshot = override.printedSnapshot || {};
    const zonesChanged = current.zoneIds && !sameList(snapshot.zoneIds || [], current.zoneIds);
    const labelChanged = current.roleLabel !== undefined && snapshot.roleLabel && snapshot.roleLabel !== current.roleLabel;
    if (zonesChanged || labelChanged) {
      printStatus = "Non-imprimé";
      warningMessage = MODIFIED_MESSAGE;
    }
  }
  return { ...override, printStatus, warningMessage, queuedFrom: "", queuedWarning: "", lastQueuedAt: null };
}

// Juges et presse : pas d'alerte « modifié » ; un badge déjà imprimé reste imprimé.
function leaveQueueSimple(record) {
  if (record.printStatus !== QUEUED) return {};
  return { printStatus: record.lastPrintedAt && !record.destroyedAt ? "Imprimé" : "Non-imprimé" };
}

export { MODIFIED_MESSAGE, QUEUED, enterQueue, leaveQueue, leaveQueueSimple };
