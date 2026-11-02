// Types de notifications réglables par chacun. Les valeurs par défaut doivent
// rester alignées sur NOTIFICATION_DEFAULTS (functions/src/notifications.js).
// roles : qui voit ce type dans ses réglages (celles et ceux qui le reçoivent).

const MANAGERS = ["admin", "gestionnaire"];

export const NOTIFICATION_TYPES = [
  {
    id: "com_validation",
    label: { fr: "Validation des publications", en: "Publication approvals" },
    hint: { fr: "Quand on te demande une validation, ou qu'on répond à la tienne.", en: "When someone asks for your approval, or answers your request." },
    roles: MANAGERS,
    defaults: { inApp: true, push: true, email: true },
  },
  {
    id: "press_registration",
    label: { fr: "Demandes presse", en: "Press requests" },
    roles: MANAGERS,
    defaults: { inApp: true, push: true, email: false },
  },
  {
    id: "vip_registration",
    label: { fr: "Inscriptions VIP", en: "VIP registrations" },
    roles: MANAGERS,
    defaults: { inApp: true, push: true, email: false },
  },
  {
    id: "volunteer_application",
    label: { fr: "Inscriptions bénévoles", en: "Volunteer sign-ups" },
    roles: MANAGERS,
    defaults: { inApp: true, push: true, email: false },
  },
  {
    id: "u14_request",
    label: { fr: "Inscriptions U12 / U14 et porte-panier", en: "U12 / U14 and basket carrier sign-ups" },
    roles: MANAGERS,
    defaults: { inApp: true, push: true, email: false },
  },
  {
    id: "physio_booking",
    label: { fr: "Réservations kiné", en: "Physio bookings" },
    roles: ["kine", ...MANAGERS],
    defaults: { inApp: true, push: true, email: false },
  },
  {
    id: "athlete_guests",
    label: { fr: "Invités des athlètes", en: "Athlete guests" },
    roles: ["admin"],
    defaults: { inApp: true, push: true, email: false },
  },
  {
    id: "announcement",
    label: { fr: "Messages de l'organisation", en: "Messages from the organisers" },
    hint: { fr: "Annonces envoyées par un administrateur (ex. le jour J).", en: "Announcements sent by an administrator (e.g. on meeting day)." },
    roles: null,
    defaults: { inApp: true, push: true, email: true },
  },
];

export const NOTIFICATION_CHANNELS = [
  { id: "inApp", label: { fr: "Cloche", en: "Bell" } },
  { id: "push", label: { fr: "Push", en: "Push" } },
  { id: "email", label: { fr: "E-mail", en: "Email" } },
];

// Groupes possibles pour un message manuel (sendTeamAnnouncement).
export const ANNOUNCEMENT_GROUPS = [
  { id: "team", label: { fr: "Toute l'équipe", en: "Whole team" } },
  { id: "admin", label: { fr: "Admins", en: "Admins" } },
  { id: "gestionnaire", label: { fr: "Gestionnaires", en: "Managers" } },
  { id: "chef_equipe", label: { fr: "Chefs d'équipe", en: "Team leads" } },
  { id: "benevole", label: { fr: "Bénévoles", en: "Volunteers" } },
  { id: "kine", label: { fr: "Kinés", en: "Physios" } },
  { id: "chef_transport_athletes", label: { fr: "Chef transport athlètes", en: "Athlete transport lead" } },
  { id: "benevole_transport_athletes", label: { fr: "Bénévoles transport athlètes", en: "Athlete transport volunteers" } },
  { id: "gestionnaire_site", label: { fr: "Gestionnaires du site", en: "Website managers" } },
  { id: "budget", label: { fr: "Budget", en: "Budget" } },
];

export function visibleNotificationTypes(roles = []) {
  return NOTIFICATION_TYPES.filter((type) => !type.roles || type.roles.some((role) => roles.includes(role)));
}

export function channelsFor(prefs, type) {
  return { ...type.defaults, ...(prefs?.[type.id] || {}) };
}
