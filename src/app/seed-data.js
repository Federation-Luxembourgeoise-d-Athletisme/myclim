const teamNeeds = [
  { team: "Transport", needed: 18, assigned: 14, leader: "Sofia Da Costa" },
  { team: "Warm-up", needed: 10, assigned: 10, leader: "Tom Weber" },
  { team: "VIP", needed: 12, assigned: 8, leader: "Anne Pinto" },
  { team: "Call room", needed: 16, assigned: 13, leader: "Joao Martins" },
];

const assignmentRows = [
  {
    person: "Mia Fernandes",
    role: "Benevole",
    team: "Transport",
    shift: "Sam 08:00 - 13:00",
    status: "Confirme",
    accreditation: "Transport + Arrivees",
  },
  {
    person: "Noah Schmit",
    role: "Chef d'equipe",
    team: "Warm-up",
    shift: "Sam 07:30 - 15:00",
    status: "Confirme",
    accreditation: "Terrain + Warm-up",
  },
  {
    person: "Emma Dupont",
    role: "Remplacante",
    team: "VIP",
    shift: "Sam 12:00 - 18:00",
    status: "En attente",
    accreditation: "VIP",
  },
];

const volunteerAdminSeed = [
  {
    id: "vol-001",
    firstName: "Mia",
    lastName: "Fernandes",
    age: 22,
    email: "mia.fernandes@email.com",
    phone: "+352 621 400 118",
    languages: ["Français", "Anglais", "Luxembourgeois"],
    workflowStatus: "Candidature reçue",
    assignedRole: "",
    assignmentStatus: "En attente",
    teamRole: "Bénévole",
    shift: "Dimanche 09:30 - 19:00",
    sundayAvailability: "Oui, disponible dimanche 17/01/2027 de 09h30 à 19h00",
    supportAvailability: "Samedi après-midi, lundi 09h00 - 12h00",
    supportTasks: {
      "Samedi après-midi": "",
      "lundi 09h00 - 12h00": "",
    },
    notes: "Disponible toute la journée, certificat demandé.",
    accountEmailSent: true,
    teamEmailSent: false,
  },
  {
    id: "vol-002",
    firstName: "Noah",
    lastName: "Schmit",
    age: 24,
    email: "noah.schmit@email.com",
    phone: "+352 691 221 814",
    languages: ["Français", "Allemand", "Anglais"],
    workflowStatus: "Confirmé",
    assignedRole: "Warm-up",
    assignmentStatus: "Confirmé",
    teamRole: "Chef d'équipe",
    shift: "Dimanche 09:30 - 16:00",
    sundayAvailability: "Oui, disponible dimanche 17/01/2027 de 09h30 à 19h00",
    supportAvailability: "Pas d'aide complémentaire indiquée",
    supportTasks: {},
    notes: "Profil chef d'équipe potentiel.",
    accountEmailSent: true,
    teamEmailSent: true,
  },
  {
    id: "vol-003",
    firstName: "Emma",
    lastName: "Dupont",
    age: 17,
    email: "emma.dupont@email.com",
    phone: "+352 661 114 550",
    languages: ["Français", "Anglais"],
    workflowStatus: "Affecté",
    assignedRole: "VIP",
    assignmentStatus: "Proposé",
    teamRole: "Bénévole",
    shift: "Dimanche 12:00 - 19:00",
    sundayAvailability: "Oui, disponible dimanche 17/01/2027 de 09h30 à 19h00",
    supportAvailability: "Pas d'aide complémentaire indiquée",
    supportTasks: {},
    notes: "À éviter si mineure, vérification en cours.",
    accountEmailSent: true,
    teamEmailSent: false,
  },
  {
    id: "vol-004",
    firstName: "Ibrahim",
    lastName: "Saidi",
    age: 29,
    email: "ibrahim.saidi@email.com",
    phone: "+352 691 998 440",
    languages: ["Anglais", "Français", "Autre"],
    workflowStatus: "Informé",
    assignedRole: "Call room",
    assignmentStatus: "Proposé",
    teamRole: "Bénévole",
    shift: "Dimanche 11:00 - 19:00",
    sundayAvailability: "Oui, disponible dimanche 17/01/2027 de 09h30 à 19h00",
    supportAvailability: "Vendredi après-midi",
    supportTasks: {
      "Vendredi après-midi": "Préparation logistique",
    },
    notes: "Très bon niveau anglais, utile sur postes internationaux.",
    accountEmailSent: true,
    teamEmailSent: true,
  },
  {
    id: "vol-005",
    firstName: "Claire",
    lastName: "Becker",
    age: 20,
    email: "claire.becker@email.com",
    phone: "+352 691 004 771",
    languages: ["Français", "Anglais"],
    workflowStatus: "Candidature reçue",
    assignedRole: "",
    assignmentStatus: "En attente",
    teamRole: "Bénévole",
    shift: "",
    sundayAvailability: "Oui, disponible dimanche 17/01/2027 de 09h30 à 19h00",
    supportAvailability: "Vendredi après-midi",
    supportTasks: {
      "Vendredi après-midi": "",
    },
    notes: "Parle bien anglais, expérience accueil.",
    accountEmailSent: true,
    teamEmailSent: false,
  },
];

const roleConfigurationSeed = [
  {
    id: "role-transport",
    roleName: "Transport",
    neededCount: 18,
    requiredLanguages: ["Français", "Anglais"],
    briefingTime: "09:30",
    setupTime: "10:00",
    shiftTime: "10:30 - 19:00",
    leaderName: "Sofia Da Costa",
    leaderContact: "+352 621 441 002",
    allowLeaderDocuments: true,
    teamInfo: "",
    teamInfoPlaceholder:
      "Accueil et accompagnement des athlètes, coordination des flux gare/hôtel/Coque, consignes remises le matin.",
    documents: ["Briefing transport.pdf", "Plan navettes.pdf"],
  },
  {
    id: "role-warmup",
    roleName: "Warm-up",
    neededCount: 10,
    requiredLanguages: ["Français", "Anglais", "Allemand"],
    briefingTime: "09:15",
    setupTime: "09:45",
    shiftTime: "10:00 - 18:30",
    leaderName: "Noah Schmit",
    leaderContact: "noah.schmit@email.com",
    allowLeaderDocuments: true,
    teamInfo: "",
    teamInfoPlaceholder:
      "Orientation des athlètes, contrôle des accès, relais avec le responsable de zone et rappel des consignes terrain.",
    documents: ["Plan warm-up.pdf", "Consignes accès zone.pdf"],
  },
  {
    id: "role-callroom",
    roleName: "Call room",
    neededCount: 16,
    requiredLanguages: ["Français", "Anglais"],
    briefingTime: "09:00",
    setupTime: "09:30",
    shiftTime: "10:30 - 19:00",
    leaderName: "Ibrahim Saidi",
    leaderContact: "+352 691 998 440",
    allowLeaderDocuments: false,
    teamInfo: "",
    teamInfoPlaceholder:
      "Vérification des passages, coordination avec les officiels, ponctualité stricte et informations équipe centralisées ici.",
    documents: ["Procédure call room.pdf", "Liste contacts terrain.pdf"],
  },
];

const assignmentStatusOptions = ["En attente", "Proposé", "Confirmé", "Remplaçant", "Annulé"];
const volunteerWorkflowStatusOptions = [
  "Candidature reçue",
  "Affecté",
  "Informé",
  "Confirmé",
  "Annulé",
];
const supportTaskOptions = [
  "Montage",
  "Préparation logistique",
  "Accueil bénévoles",
  "Distribution matériel",
  "Démontage",
  "Support terrain",
];
const supportTaskDayOptions = ["Vendredi", "Samedi", "Dimanche", "Lundi"];

const platformRoleOptions = [
  { value: "admin", label: "Administrateur" },
  { value: "budget", label: "Module Budget" },
  { value: "gestionnaire", label: "Gestionnaire" },
  { value: "gestionnaire_site", label: "Gestionnaire site" },
  { value: "chef_equipe", label: "Chef d'équipe" },
  { value: "benevole", label: "Bénévole" },
  { value: "parent_u14", label: "Parent U14" },
];

const TEAM_CONFIGURATION_DOC_PATH = ["appSettings", "teamsConfiguration"];
const ACCREDITATION_CONFIGURATION_DOC_PATH = ["appSettings", "accreditationConfiguration"];
const JUDGE_ROSTER_DOC_PATH = ["appSettings", "judgeRoster"];
const BUDGET_INVOICE_CONFIGURATION_DOC_PATH = ["appSettings", "budgetInvoiceConfiguration"];
const VOLUNTEER_ALERT_LOG_DOC_PATH = ["appSettings", "volunteerAlertLog"];
const CERTIFICATE_CONFIGURATION_DOC_PATH = ["appSettings", "certificateConfiguration"];
const defaultTeamRoleOptions = ["Bénévole", "Chef d'équipe", "Remplaçant"];
const PARTICIPATION_CERTIFICATE_SIGNATORY = "Responsable bénévoles";
const PARTICIPATION_CERTIFICATE_SIGNATORY_TITLE = "Head of CMCM Luxembourg Indoor Meeting";

export {
  ACCREDITATION_CONFIGURATION_DOC_PATH,
  BUDGET_INVOICE_CONFIGURATION_DOC_PATH,
  CERTIFICATE_CONFIGURATION_DOC_PATH,
  JUDGE_ROSTER_DOC_PATH,
  PARTICIPATION_CERTIFICATE_SIGNATORY,
  PARTICIPATION_CERTIFICATE_SIGNATORY_TITLE,
  TEAM_CONFIGURATION_DOC_PATH,
  VOLUNTEER_ALERT_LOG_DOC_PATH,
  assignmentRows,
  assignmentStatusOptions,
  defaultTeamRoleOptions,
  platformRoleOptions,
  roleConfigurationSeed,
  supportTaskDayOptions,
  supportTaskOptions,
  teamNeeds,
  volunteerAdminSeed,
  volunteerWorkflowStatusOptions,
};
