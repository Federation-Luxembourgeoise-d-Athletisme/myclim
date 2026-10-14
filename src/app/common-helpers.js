import { getDisplayName, normalizeRole } from "./utils.js";

function getDocumentUploadErrorMessage(error) {
  const code = error?.code || "";

  if (code === "permission-denied") {
    return "Écriture Firestore refusée. Vérifiez les règles Firestore pour la collection documents.";
  }

  return error?.message || "L'enregistrement du document a échoué.";
}

function formatVolunteerApplicationStatus(status, t) {
  switch (String(status || "").trim().toLowerCase()) {
    case "candidature_recue":
      return t ? t("statusReceived") : "Candidature reçue";
    case "pending_guardian_approval":
      return t ? t("statusPendingGuardianApproval") : "Accord parental attendu";
    default:
      return String(status || (t ? t("dashboardToComplete") : "À compléter"));
  }
}

function buildUserIdentitySet(userProfile, currentUser) {
  return new Set(
    [
      currentUser?.uid,
      currentUser?.email,
      userProfile?.uid,
      userProfile?.email,
      getDisplayName(userProfile, currentUser?.email),
      [userProfile?.firstName, userProfile?.lastName].filter(Boolean).join(" "),
    ]
      .map((value) => String(value || "").trim().toLowerCase())
      .filter(Boolean),
  );
}

function getAssignedTeamNames(userProfile) {
  return [
    userProfile?.assignedRole,
    userProfile?.teamName,
    ...(Array.isArray(userProfile?.assignedTeams) ? userProfile.assignedTeams : []),
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
}

function isTeamLeadAssignment(assignment) {
  const normalizedTeamRole = normalizeRole(assignment?.teamRole)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalizedTeamRole === "chef_d_equipe" || normalizedTeamRole === "chef_equipe";
}

function getWorkflowStatusClass(status) {
  switch (status) {
    case "Annulé":
      return "workflow-pill workflow-pill--cancelled";
    case "Affecté":
      return "workflow-pill workflow-pill--assigned";
    case "Informé":
      return "workflow-pill workflow-pill--informed";
    case "Confirmé":
      return "workflow-pill workflow-pill--confirmed";
    default:
      return "workflow-pill workflow-pill--received";
  }
}

export {
  buildUserIdentitySet,
  formatVolunteerApplicationStatus,
  getAssignedTeamNames,
  getDocumentUploadErrorMessage,
  getWorkflowStatusClass,
  isTeamLeadAssignment,
};
