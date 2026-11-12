import { getDoc, serverTimestamp, setDoc, doc } from "firebase/firestore";
import { TEAM_CONFIGURATION_DOC_PATH, defaultTeamRoleOptions, roleConfigurationSeed, supportTaskDayOptions, supportTaskOptions } from "./seed-data.js";

function normalizeSubRoles(subRoles) {
  if (!Array.isArray(subRoles)) return [];

  const seen = new Set();

  return subRoles
    .map((subRole) => String(subRole || "").trim())
    .filter((subRole) => {
      if (!subRole) return false;
      const normalizedSubRole = subRole.toLowerCase();
      if (seen.has(normalizedSubRole)) return false;
      seen.add(normalizedSubRole);
      return true;
    });
}

function normalizeTeamRoleConfig(role, index = 0) {
  const fallbackRole = roleConfigurationSeed[index] ?? roleConfigurationSeed[0] ?? {};
  const normalizedNeededCount = Number(role?.neededCount);
  const normalizedExpectedLeadCount = Number(role?.expectedLeadCount);

  return {
    id: String(role?.id || fallbackRole.id || `role-${index + 1}`),
    roleName: String(role?.roleName || fallbackRole.roleName || `Équipe ${index + 1}`),
    neededCount: Number.isFinite(normalizedNeededCount) && normalizedNeededCount >= 0 ? normalizedNeededCount : 0,
    expectedLeadCount:
      Number.isFinite(normalizedExpectedLeadCount) && normalizedExpectedLeadCount >= 0
        ? normalizedExpectedLeadCount
        : 1,
    requiredLanguages: Array.isArray(role?.requiredLanguages) ? role.requiredLanguages : [],
    briefingTime: String(role?.briefingTime || ""),
    setupTime: String(role?.setupTime || ""),
    shiftTime: String(role?.shiftTime || ""),
    leaderName: String(role?.leaderName || ""),
    leaderContact: String(role?.leaderContact || ""),
    allowLeaderDocuments: Boolean(role?.allowLeaderDocuments),
    teamInfo: String(role?.teamInfo || ""),
    teamInfoPlaceholder: String(
      role?.teamInfoPlaceholder ||
        fallbackRole.teamInfoPlaceholder ||
        "Décrivez ici les consignes, missions et informations utiles pour cette équipe.",
    ),
    documents: Array.isArray(role?.documents) ? role.documents : [],
    subRoles: normalizeSubRoles(role?.subRoles),
  };
}

function buildDefaultTeamRoles() {
  return roleConfigurationSeed.map((role, index) =>
    normalizeTeamRoleConfig(
      {
        ...role,
        expectedLeadCount: role.leaderName ? 1 : 0,
      },
      index,
    ),
  );
}

function normalizeTeamAssignment(member, roles) {
  const roleById = new Map(roles.map((role) => [role.id, role]));
  const roleIdByName = new Map(roles.map((role) => [role.roleName.trim().toLowerCase(), role.id]));
  const resolvedRoleId =
    roleById.get(member?.assignedRoleId)?.id ||
    roleIdByName.get(String(member?.assignedRole || "").trim().toLowerCase()) ||
    "";
  const resolvedRole = roleById.get(resolvedRoleId);

  return {
    assignmentEntryId:
      String(member?.assignmentEntryId || "").trim() ||
      (String(member?.id || "").trim() && resolvedRoleId
        ? `${String(member?.id || "").trim()}::${resolvedRoleId}`
        : ""),
    id: String(member?.id || ""),
    firstName: String(member?.firstName || ""),
    lastName: String(member?.lastName || ""),
    email: String(member?.email || ""),
    phone: String(member?.phone || ""),
    languages: Array.isArray(member?.languages) ? member.languages : [],
    workflowStatus: String(member?.workflowStatus || ""),
    assignedRoleId: resolvedRoleId,
    assignedRole: resolvedRole?.roleName || String(member?.assignedRole || ""),
    teamRole: String(member?.teamRole || "Bénévole"),
  };
}

function normalizeTeamConfigurationPayload(data) {
  const rolesSource = Array.isArray(data?.roles) && data.roles.length > 0 ? data.roles : buildDefaultTeamRoles();
  const roles = rolesSource.map((role, index) => normalizeTeamRoleConfig(role, index));
  const assignmentsSource =
    Array.isArray(data?.teamAssignments) && data.teamAssignments.length > 0
      ? data.teamAssignments
      : [];
  const supportTasks =
    Array.isArray(data?.supportTasks) && data.supportTasks.length > 0
      ? data.supportTasks.map((task, index) => ({
          id: String(task?.id || `support-task-${index + 1}`),
          day:
            task?.day === undefined || task?.day === null
              ? String(supportTaskDayOptions[0] || "")
              : String(task.day),
          startTime:
            task?.startTime === undefined || task?.startTime === null ? "" : String(task.startTime),
          endTime:
            task?.endTime === undefined || task?.endTime === null ? "" : String(task.endTime),
          taskLabel:
            task?.taskLabel === undefined || task?.taskLabel === null
              ? String(supportTaskOptions[0] || "")
              : String(task.taskLabel),
        }))
      : [
          {
            id: "support-task-1",
            day: "Vendredi",
            startTime: "14:00",
            endTime: "18:00",
            taskLabel: "Préparation logistique",
          },
          {
            id: "support-task-2",
            day: "Lundi",
            startTime: "09:00",
            endTime: "12:00",
            taskLabel: "Démontage",
          },
        ];

  return {
    roles,
    teamAssignments: assignmentsSource.map((member) => normalizeTeamAssignment(member, roles)),
    supportTasks,
  };
}

function buildTeamAssignmentsFromVolunteer(volunteer, roles) {
  const roleIdByName = new Map(roles.map((role) => [role.roleName.trim().toLowerCase(), role.id]));
  const assignedRoles = normalizeSubRoles(
    Array.isArray(volunteer?.assignedRoles)
      ? volunteer.assignedRoles
      : volunteer?.assignedRole
        ? [volunteer.assignedRole]
        : [],
  );
  const teamRoleAssignments =
    volunteer?.teamRoleAssignments && typeof volunteer.teamRoleAssignments === "object"
      ? volunteer.teamRoleAssignments
      : {};

  return assignedRoles
    .map((assignedRole, index) => {
      const assignedRoleId = roleIdByName.get(String(assignedRole || "").trim().toLowerCase()) || "";
      if (!assignedRoleId) return null;

      return normalizeTeamAssignment(
        {
          assignmentEntryId: `${String(volunteer?.uid || volunteer?.id || "")}::${assignedRoleId}`,
          id: String(volunteer?.uid || volunteer?.id || ""),
          firstName: volunteer?.firstName,
          lastName: volunteer?.lastName,
          email: volunteer?.email,
          phone: volunteer?.phone,
          languages: volunteer?.languages,
          workflowStatus: volunteer?.workflowStatus,
          assignedRoleId,
          assignedRole,
          teamRole: String(teamRoleAssignments[assignedRole] || (index === 0 ? volunteer?.teamRole : "") || "Bénévole"),
        },
        roles,
      );
    })
    .filter(Boolean);
}

async function syncVolunteerAssignmentsToTeamConfiguration(volunteer) {
  const { db } = await import("../services/firebase.js");
  const teamsConfigurationRef = doc(db, ...TEAM_CONFIGURATION_DOC_PATH);
  const teamsSnapshot = await getDoc(teamsConfigurationRef);
  const currentConfiguration = teamsSnapshot.exists()
    ? normalizeTeamConfigurationPayload(teamsSnapshot.data())
    : {
        roles: defaultTeamRoles,
        teamAssignments: defaultTeamAssignments,
        supportTasks: normalizeTeamConfigurationPayload({}).supportTasks,
      };

  const nextAssignments = buildTeamAssignmentsFromVolunteer(volunteer, currentConfiguration.roles);
  // The volunteer's application is the source of truth: all of their entries
  // are replaced, so a team they were removed from disappears from the
  // composition too (before, only re-added teams were replaced).
  const volunteerIds = new Set([volunteer?.uid, volunteer?.id].map((value) => String(value || "")).filter(Boolean));
  const filteredAssignments = currentConfiguration.teamAssignments.filter(
    (assignment) => !volunteerIds.has(assignment.id),
  );

  await setDoc(
    teamsConfigurationRef,
    {
      roles: currentConfiguration.roles,
      teamAssignments: [...filteredAssignments, ...nextAssignments],
      supportTasks: currentConfiguration.supportTasks,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}

function getAvailableTeamRoles(role, extraRoles = []) {
  return normalizeSubRoles([
    ...defaultTeamRoleOptions,
    ...normalizeSubRoles(role?.subRoles),
    ...normalizeSubRoles(extraRoles),
  ]);
}

const defaultTeamRoles = buildDefaultTeamRoles();
const defaultTeamAssignments = [];

function getVolunteerStableId(volunteer = {}) {
  return String(volunteer?.uid || volunteer?.id || "").trim();
}

function isLegacySeedAssignment(member = {}) {
  const memberId = String(member?.id || "").trim();
  const email = String(member?.email || "").trim().toLowerCase();
  return /^vol-\d+$/i.test(memberId) && email.endsWith("@email.com");
}

export {
  buildDefaultTeamRoles,
  defaultTeamAssignments,
  defaultTeamRoles,
  getAvailableTeamRoles,
  getVolunteerStableId,
  isLegacySeedAssignment,
  normalizeSubRoles,
  normalizeTeamAssignment,
  normalizeTeamConfigurationPayload,
  syncVolunteerAssignmentsToTeamConfiguration,
};
