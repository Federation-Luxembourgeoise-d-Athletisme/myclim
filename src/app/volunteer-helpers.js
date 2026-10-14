import { serverTimestamp } from "firebase/firestore";
import { platformRoleOptions } from "./seed-data";
import {
  VOLUNTEER_LANGUAGE_OPTIONS,
  VOLUNTEER_MEETING_DAY_LABEL,
  getAgeBracketFromAge,
  getAgeFromBirthDate,
  normalizeRole,
} from "./utils";

function normalizeSubRoleList(subRoles) {
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

function getRoleLabel(role) {
  const normalizedRole = normalizeRole(role);
  return (
    platformRoleOptions.find((option) => option.value === normalizedRole)?.label ||
    normalizedRole.replace(/_/g, " ")
  );
}

const ROLE_LABEL_KEYS = {
  admin: "roleLabelAdmin",
  budget: "roleLabelBudget",
  gestionnaire: "roleLabelManager",
  chef_equipe: "roleLabelTeamLead",
  benevole: "roleLabelVolunteer",
  parent_u14: "roleLabelParentU14",
  gestionnaire_site: "roleLabelWebsiteManager",
  chef_transport_athletes: "roleLabelAthleteTransportLead",
  benevole_transport_athletes: "roleLabelAthleteTransportVolunteer",
  meeting_director: "roleLabelMeetingDirector",
  kine: "roleLabelPhysio",
};

function formatRoleLabel(role, t) {
  const labelKey = ROLE_LABEL_KEYS[role];
  return labelKey ? t(labelKey) : String(role || "").replaceAll("_", " ");
}

// Availability values are stored in French; these keys translate them for display.
const VOLUNTEER_SUPPORT_AVAILABILITY_LABEL_KEYS = {
  "Avant-meeting - vendredi matin": "availabilityFridayMorning",
  "Avant-meeting - vendredi après-midi": "availabilityFridayAfternoon",
  "Avant-meeting - samedi matin": "availabilitySaturdayMorning",
  "Avant-meeting - samedi après-midi": "availabilitySaturdayAfternoon",
  "Après-meeting - lundi 9h-12h": "availabilityMondayAfterMeeting",
};

function formatVolunteerSupportAvailabilityOption(option, t) {
  const labelKey = VOLUNTEER_SUPPORT_AVAILABILITY_LABEL_KEYS[option];
  return labelKey ? t(labelKey) : option;
}

function normalizeVolunteerYesNoValue(value) {
  return String(value || "").trim().toLowerCase() === "oui" ? "oui" : "non";
}

function createEmptyVolunteerProfileFormData() {
  return {
    firstName: "",
    lastName: "",
    phone: "",
    birthDate: "",
    gender: "",
    tshirtSize: "M",
    languages: [],
    otherLanguage: "",
    occupation: "",
    cmcmExperience: "",
    volunteerExperience: "",
    availability: [],
    meetingDayConfirmed: false,
    missionPreferences: [],
    healthSafetyInfo: "",
    lunexStudent: "non",
    lunexProgram: "",
    certificateNeeded: false,
    retainForNextYear: false,
    imageConsent: false,
    guardianFirstName: "",
    guardianLastName: "",
    guardianEmail: "",
    guardianPhone: "",
  };
}

function createVolunteerProfileFormData(application, userProfile) {
  const nextFormData = createEmptyVolunteerProfileFormData();
  const savedLanguages = Array.isArray(application?.languages) ? application.languages : [];
  const standardLanguageOptions = VOLUNTEER_LANGUAGE_OPTIONS.filter((option) => option !== "Autre");
  const selectedLanguages = standardLanguageOptions.filter((option) => savedLanguages.includes(option));
  const otherLanguages = savedLanguages.filter((option) => !standardLanguageOptions.includes(option));
  const savedAvailability = Array.isArray(application?.availability) ? application.availability : [];

  return {
    ...nextFormData,
    firstName: application?.firstName || userProfile?.firstName || "",
    lastName: application?.lastName || userProfile?.lastName || "",
    phone: application?.phone || userProfile?.phone || "",
    birthDate: application?.birthDate || userProfile?.birthDate || "",
    gender: String(application?.gender || "").trim().toLowerCase(),
    tshirtSize: application?.tshirtSize || "M",
    languages: otherLanguages.length ? [...selectedLanguages, "Autre"] : selectedLanguages,
    otherLanguage: otherLanguages.join(", "),
    occupation: application?.occupation || "",
    cmcmExperience: application?.cmcmExperience || "",
    volunteerExperience: application?.volunteerExperience || "",
    availability: savedAvailability.filter((option) => option !== VOLUNTEER_MEETING_DAY_LABEL),
    meetingDayConfirmed: savedAvailability.includes(VOLUNTEER_MEETING_DAY_LABEL),
    missionPreferences: Array.isArray(application?.missionPreferences) ? application.missionPreferences : [],
    healthSafetyInfo: application?.healthSafetyInfo || "",
    lunexStudent: normalizeVolunteerYesNoValue(application?.lunexStudent),
    lunexProgram: application?.lunexProgram || "",
    certificateNeeded: Boolean(application?.certificateNeeded),
    retainForNextYear:
      application?.retainForNextYear === undefined ? false : Boolean(application?.retainForNextYear),
    imageConsent: Boolean(application?.imageConsent),
    guardianFirstName: application?.legalGuardian?.firstName || "",
    guardianLastName: application?.legalGuardian?.lastName || "",
    guardianEmail: application?.legalGuardian?.email || "",
    guardianPhone: application?.legalGuardian?.phone || "",
  };
}

function buildVolunteerApplicationPayload({ currentUser, formData, status }) {
  const age = getAgeFromBirthDate(formData.birthDate);
  const legalGuardianRequired = age !== null && age < 18;
  const applicationStatus = legalGuardianRequired ? "pending_guardian_approval" : status || "candidature_recue";

  const languages = [
    ...formData.languages.filter((option) => option !== "Autre"),
    ...(formData.languages.includes("Autre")
      ? formData.otherLanguage
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
      : []),
  ];

  return {
    age,
    applicationStatus,
    legalGuardianRequired,
    applicationPayload: {
      uid: currentUser.uid,
      firstName: formData.firstName.trim(),
      lastName: formData.lastName.trim(),
      email: currentUser.email || "",
      phone: formData.phone.trim(),
      gender: formData.gender,
      birthDate: formData.birthDate,
      age,
      languages,
      tshirtSize: formData.tshirtSize,
      ageBracket: getAgeBracketFromAge(age),
      lunexStudent: formData.lunexStudent,
      lunexProgram: formData.lunexProgram.trim(),
      occupation: formData.occupation.trim(),
      cmcmExperience: formData.cmcmExperience.trim(),
      volunteerExperience: formData.volunteerExperience.trim(),
      healthSafetyInfo: formData.healthSafetyInfo.trim(),
      certificateNeeded: Boolean(formData.certificateNeeded),
      retainForNextYear: formData.retainForNextYear,
      imageConsent: formData.imageConsent,
      availability: [
        ...(formData.meetingDayConfirmed ? [VOLUNTEER_MEETING_DAY_LABEL] : []),
        ...formData.availability,
      ],
      missionPreferences: Array.isArray(formData.missionPreferences)
        ? formData.missionPreferences
        : String(formData.missionPreferences || "")
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean),
      legalGuardianRequired,
      legalGuardian: legalGuardianRequired
        ? {
            firstName: formData.guardianFirstName.trim(),
            lastName: formData.guardianLastName.trim(),
            email: formData.guardianEmail.trim(),
            phone: formData.guardianPhone.trim(),
            status: "pending",
          }
        : null,
      status: applicationStatus,
      updatedAt: serverTimestamp(),
    },
  };
}

function deriveVolunteerWorkflowStatus(application = {}) {
  const explicitWorkflowStatus = String(application?.workflowStatus || "").trim();
  if (explicitWorkflowStatus) return explicitWorkflowStatus;

  const normalizedStatus = normalizeRole(application?.status);
  if (normalizedStatus === "annule") return "Annulé";
  if (normalizedStatus === "confirme") return "Confirmé";
  if (normalizedStatus === "informe") return "Informé";
  if (normalizedStatus === "affecte") return "Affecté";

  const assignedRoles = normalizeSubRoleList(
    Array.isArray(application?.assignedRoles)
      ? application.assignedRoles
      : application?.assignedRole
        ? [application.assignedRole]
        : [],
  );

  if (assignedRoles.length > 0) {
    return "Affecté";
  }

  return "Candidature reçue";
}

function buildVolunteerSupportAvailabilityLabel(availability = []) {
  const supportSlots = availability.filter((slot) => slot !== VOLUNTEER_MEETING_DAY_LABEL);
  return supportSlots.length ? supportSlots.join(", ") : "Pas d'aide complémentaire indiquée";
}

function buildVolunteerAdminNotes(application = {}) {
  const notes = [
    application?.healthSafetyInfo,
    application?.volunteerExperience,
    application?.cmcmExperience,
    application?.certificateNeeded ? "Certificat demandé." : "",
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);

  return notes.join(" | ") || "Aucune note renseignée.";
}

function mapVolunteerApplicationToAdminVolunteer(application = {}) {
  const availability = Array.isArray(application?.availability) ? application.availability : [];
  const assignedRoles = normalizeSubRoleList(
    Array.isArray(application?.assignedRoles)
      ? application.assignedRoles
      : application?.assignedRole
        ? [application.assignedRole]
        : [],
  );
  const primaryAssignedRole = assignedRoles[0] || "";
  const rawTeamRoleAssignments =
    application?.teamRoleAssignments && typeof application.teamRoleAssignments === "object"
      ? application.teamRoleAssignments
      : {};
  const teamRoleAssignments = assignedRoles.reduce((accumulator, assignedRole, index) => {
    accumulator[assignedRole] = String(
      rawTeamRoleAssignments[assignedRole] || (index === 0 ? application?.teamRole : "") || "Bénévole",
    );
    return accumulator;
  }, {});

  return {
    id: String(application?.id || ""),
    uid: String(application?.uid || ""),
    firstName: String(application?.firstName || ""),
    lastName: String(application?.lastName || ""),
    age: Number.isFinite(Number(application?.age)) ? Number(application.age) : null,
    email: String(application?.email || ""),
    phone: String(application?.phone || ""),
    languages: Array.isArray(application?.languages) ? application.languages : [],
    workflowStatus: deriveVolunteerWorkflowStatus(application),
    assignedRole: primaryAssignedRole,
    assignedRoles,
    assignmentStatus: String(application?.assignmentStatus || (primaryAssignedRole ? "Proposé" : "En attente")),
    teamRole: String(application?.teamRole || teamRoleAssignments[primaryAssignedRole] || "Bénévole"),
    teamRoleAssignments,
    shift: String(application?.shift || ""),
    sundayAvailability: availability.includes(VOLUNTEER_MEETING_DAY_LABEL)
      ? "Oui, disponible dimanche 17/01/2027 de 09h30 à 19h00"
      : "Non confirmé",
    supportAvailability: buildVolunteerSupportAvailabilityLabel(availability),
    supportTasks:
      application?.supportTasks && typeof application.supportTasks === "object" ? application.supportTasks : {},
    notes: buildVolunteerAdminNotes(application),
    missionPreferences: Array.isArray(application?.missionPreferences) ? application.missionPreferences : [],
    accountEmailSent: application?.accountEmailSent === undefined ? Boolean(application?.uid) : Boolean(application?.accountEmailSent),
    teamEmailSent: Boolean(application?.teamEmailSent),
    firstAssignedRole: String(application?.firstAssignedRole || ""),
    firstAssignedAt: application?.firstAssignedAt || null,
    lastMailSentRole: String(application?.lastMailSentRole || ""),
    lastMailSentTeamRole: String(application?.lastMailSentTeamRole || ""),
    lastMailSentAt: application?.lastMailSentAt || null,
  };
}

export {
  buildVolunteerAdminNotes,
  buildVolunteerApplicationPayload,
  buildVolunteerSupportAvailabilityLabel,
  createEmptyVolunteerProfileFormData,
  createVolunteerProfileFormData,
  formatRoleLabel,
  formatVolunteerSupportAvailabilityOption,
  getRoleLabel,
  mapVolunteerApplicationToAdminVolunteer,
};
