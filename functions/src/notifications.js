// ── Notifications de l'équipe : cloche dans l'app, push et e-mail ──────────
// Une notification part vers une liste de personnes (uid). Pour chacune, on
// regarde ses préférences (users/{uid}.notificationPrefs[type]) :
//   - cloche  → users/{uid}/notifications/{id} (lu / non lu, lien)
//   - push    → chaque appareil enregistré dans users/{uid}/pushTokens (FCM)
//   - e-mail  → via le service mail Netlify, le même que les autres e-mails
//     de l'app (la file mailQueue n'a jamais été branchée en production).
// Les types et leurs valeurs par défaut sont repris côté app dans
// src/app/notifications/notification-types.js : garder les deux alignés.
/* global process */

import admin from "firebase-admin";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { logger } from "firebase-functions";

const REGION = "europe-west1";
const DEFAULT_APP_BASE_URL = "https://cmcm-luxembourg-indoor-meeting.lu";
const ADMIN_ROLES = ["admin", "gestionnaire"];

// Canaux actifs par défaut, tant que la personne n'a rien réglé.
export const NOTIFICATION_DEFAULTS = {
  com_validation: { inApp: true, push: true, email: true },
  press_registration: { inApp: true, push: true, email: false },
  vip_registration: { inApp: true, push: true, email: false },
  volunteer_application: { inApp: true, push: true, email: false },
  u14_request: { inApp: true, push: true, email: false },
  physio_booking: { inApp: true, push: true, email: false },
  athlete_guests: { inApp: true, push: true, email: false },
  announcement: { inApp: true, push: true, email: true },
  test: { inApp: true, push: true, email: false },
};

const firestore = () => admin.firestore();

function appBaseUrl() {
  return String(process.env.APP_BASE_URL || DEFAULT_APP_BASE_URL).replace(/\/$/, "");
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const fullName = (data = {}) => [data.firstName, data.lastName].filter(Boolean).join(" ").trim();

// Seuls les vrais comptes de connexion (id du document = uid Auth), actifs.
function activeAccounts(snapshot) {
  return snapshot.docs
    .filter((entry) => !entry.data().uid || entry.data().uid === entry.id)
    .filter((entry) => entry.data().accountStatus !== "disabled")
    .map((entry) => ({ ...entry.data(), uid: entry.id }));
}

export async function usersWithRoles(roles) {
  const snapshot = await firestore().collection("users").where("userTypes", "array-contains-any", roles.slice(0, 30)).get();
  return activeAccounts(snapshot);
}

// Toute l'équipe : tout compte qui a un autre rôle que « parent U14 ».
async function wholeTeam() {
  const snapshot = await firestore().collection("users").get();
  return activeAccounts(snapshot).filter((user) => (user.userTypes || []).some((role) => role !== "parent_u14"));
}

function channelsFor(user, type) {
  return { ...(NOTIFICATION_DEFAULTS[type] || NOTIFICATION_DEFAULTS.announcement), ...(user.notificationPrefs?.[type] || {}) };
}

async function sendPush(user, notification, url) {
  const tokensRef = firestore().collection("users").doc(user.uid).collection("pushTokens");
  const tokens = (await tokensRef.get()).docs;
  await Promise.all(
    tokens.map(async (entry) => {
      const { token, lang } = entry.data();
      if (!token) return;
      const language = lang === "fr" ? "fr" : "en";
      try {
        await admin.messaging().send({
          token,
          webpush: {
            notification: {
              title: notification.title[language],
              body: notification.body[language],
              icon: "/icons/icon-192.png",
              tag: notification.id,
            },
            fcmOptions: { link: url },
          },
          data: { url },
        });
      } catch (error) {
        // Appareil désinscrit (app supprimée, autorisation retirée) : on l'oublie.
        if (["messaging/registration-token-not-registered", "messaging/invalid-registration-token"].includes(error?.code)) {
          await entry.ref.delete();
          return;
        }
        logger.error("Push send failed", { uid: user.uid, code: error?.code, reason: error?.message });
      }
    }),
  );
}

// E-mail bilingue (anglais puis français) : l'équipe ne parle pas toujours français.
async function sendEmail(user, notification, url) {
  if (!user.email) return;
  const { title, body } = notification;
  const text = [title.en, body.en, `Open in myCLIM: ${url}`, "—", title.fr, body.fr, `Ouvrir dans myCLIM : ${url}`].join("\n\n");
  const html = [
    `<p><strong>${escapeHtml(title.en)}</strong></p>`,
    `<p>${escapeHtml(body.en).replace(/\n/g, "<br>")}</p>`,
    `<p><a href="${escapeHtml(url)}">Open in myCLIM</a></p>`,
    `<hr><p lang="fr"><strong>${escapeHtml(title.fr)}</strong></p>`,
    `<p lang="fr">${escapeHtml(body.fr).replace(/\n/g, "<br>")}</p>`,
    `<p lang="fr"><a href="${escapeHtml(url)}">Ouvrir dans myCLIM</a></p>`,
  ].join("");
  const subject = title.en === title.fr ? title.en : `${title.en} / ${title.fr}`;
  const response = await fetch(`${appBaseUrl()}/.netlify/functions/send-transactional-mail`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to: user.email, subject, body: text, html }),
  });
  if (!response.ok) throw new Error(`Mail service answered ${response.status}: ${await response.text()}`);
}

// notifyUsers({ users | uids, type, title: { fr, en }, body: { fr, en }, path, exceptUid })
// path : lien dans l'app, ex. "/app/presse". Retourne le nombre de personnes prévenues.
export async function notifyUsers({ users, uids, type, title, body, path = "/app", exceptUid = "", data = {} }) {
  let recipients = users;
  if (!recipients) {
    const snapshots = await Promise.all([...new Set(uids || [])].map((uid) => firestore().collection("users").doc(uid).get()));
    recipients = snapshots.filter((entry) => entry.exists).map((entry) => ({ ...entry.data(), uid: entry.id }));
  }
  recipients = recipients.filter((user) => user.uid && user.uid !== exceptUid);
  const url = `${appBaseUrl()}${path}`;

  await Promise.all(
    recipients.map(async (user) => {
      const channels = channelsFor(user, type);
      const ref = firestore().collection("users").doc(user.uid).collection("notifications").doc();
      const notification = { id: ref.id, title, body };
      const work = [];
      if (channels.inApp) {
        work.push(
          ref.set({ type, title, body, path, data, read: false, createdAt: admin.firestore.FieldValue.serverTimestamp() }),
        );
      }
      if (channels.push) work.push(sendPush(user, notification, url));
      if (channels.email) work.push(sendEmail(user, notification, url));
      const results = await Promise.allSettled(work);
      results
        .filter((result) => result.status === "rejected")
        .forEach((result) => logger.error("Notification channel failed", { uid: user.uid, type, reason: result.reason?.message }));
    }),
  );

  logger.info("Notification sent", { type, recipients: recipients.length });
  return recipients.length;
}

// ── Nouvelles inscriptions : préviennent les rôles qui gèrent le module ─────

export const notifyPressRegistration = onDocumentCreated({ document: "pressRegistrations/{id}", region: REGION }, async (event) => {
  const entry = event.data?.data();
  if (!entry) return;
  const name = fullName(entry);
  const media = entry.media ? ` (${entry.media})` : "";
  await notifyUsers({
    users: await usersWithRoles(ADMIN_ROLES),
    type: "press_registration",
    title: { fr: "Nouvelle demande presse", en: "New press request" },
    body: { fr: `${name}${media} demande une accréditation.`, en: `${name}${media} is asking for accreditation.` },
    path: "/app/presse",
  });
});

async function notifyVip(entry) {
  const name = fullName(entry) || entry.organization || "";
  const organization = entry.organization && name !== entry.organization ? ` — ${entry.organization}` : "";
  await notifyUsers({
    users: await usersWithRoles(ADMIN_ROLES),
    type: "vip_registration",
    title: { fr: "Nouvelle inscription VIP", en: "New VIP registration" },
    body: { fr: `${name}${organization} s'est inscrit(e).`, en: `${name}${organization} has registered.` },
    path: "/app/vip",
  });
}

export const notifyVipRegistration = onDocumentCreated({ document: "vipPublicRegistrations/{id}", region: REGION }, async (event) => {
  const entry = event.data?.data();
  if (entry) await notifyVip(entry);
});

// Les fiches ajoutées par l'équipe elle-même dans un portail partenaire ne notifient pas.
export const notifyVipPartnerEntry = onDocumentCreated(
  { document: "vipPartnerPortals/{portalId}/entries/{id}", region: REGION },
  async (event) => {
    const entry = event.data?.data();
    if (entry?.source === "partner_portal") await notifyVip(entry);
  },
);

export const notifyVolunteerApplication = onDocumentCreated({ document: "volunteerApplications/{id}", region: REGION }, async (event) => {
  const entry = event.data?.data();
  if (!entry) return;
  const name = fullName(entry);
  await notifyUsers({
    users: await usersWithRoles(ADMIN_ROLES),
    type: "volunteer_application",
    title: { fr: "Nouveau bénévole", en: "New volunteer" },
    body: { fr: `${name} vient de s'inscrire comme bénévole.`, en: `${name} just signed up as a volunteer.` },
    path: "/app/benevoles",
  });
});

export const notifyU14Request = onDocumentCreated({ document: "u14Requests/{id}", region: REGION }, async (event) => {
  const entry = event.data?.data();
  if (!entry?.parentUserId) return;
  const child = [entry.childFirstName, entry.childLastName].filter(Boolean).join(" ");
  const basket = entry.requestType === "porte_panier";
  await notifyUsers({
    users: await usersWithRoles(ADMIN_ROLES),
    type: "u14_request",
    title: basket
      ? { fr: "Nouvelle demande porte-panier", en: "New basket carrier request" }
      : { fr: "Nouvelle inscription U12 / U14", en: "New U12 / U14 registration" },
    body: { fr: `${child} a été inscrit(e) par ${fullName({ firstName: entry.parentFirstName, lastName: entry.parentLastName })}.`, en: `${child} was registered by ${fullName({ firstName: entry.parentFirstName, lastName: entry.parentLastName })}.` },
    path: basket ? "/app/u14/porte-panier" : "/app/u14",
  });
});

// ── Kiné et invités des athlètes (appelés depuis athlete-hub.js) ────────────

export async function notifyPhysioBooking(booking, action) {
  const athlete = fullName({ firstName: booking.athleteFirstName, lastName: booking.athleteLastName });
  const when = `${booking.date} ${booking.start}`;
  const cancelled = action === "cancelled";
  await notifyUsers({
    users: await usersWithRoles(["kine", ...ADMIN_ROLES]),
    type: "physio_booking",
    title: cancelled ? { fr: "Créneau kiné annulé", en: "Physio slot cancelled" } : { fr: "Nouveau créneau kiné", en: "New physio booking" },
    body: cancelled
      ? { fr: `${athlete} a annulé son créneau du ${when}.`, en: `${athlete} cancelled the ${when} slot.` }
      : { fr: `${athlete} a réservé le ${when}${booking.physioName ? ` avec ${booking.physioName}` : ""}.`, en: `${athlete} booked ${when}${booking.physioName ? ` with ${booking.physioName}` : ""}.` },
    path: "/app/kine",
  });
}

export async function notifyAthleteGuests(athlete, guests) {
  const names = guests.map(fullName).filter(Boolean);
  const athleteName = fullName(athlete);
  await notifyUsers({
    users: await usersWithRoles(["admin"]),
    type: "athlete_guests",
    title: { fr: "Invités d'un athlète", en: "Athlete guests" },
    body: names.length
      ? { fr: `${athleteName} a inscrit : ${names.join(", ")}.`, en: `${athleteName} added: ${names.join(", ")}.` }
      : { fr: `${athleteName} a retiré ses invités.`, en: `${athleteName} removed their guests.` },
    path: "/app/caisse",
  });
}

// ── Message manuel d'un admin, et notification de test ──────────────────────

const ANNOUNCEMENT_GROUPS = ["team", "admin", "gestionnaire", "chef_equipe", "benevole", "kine", "gestionnaire_site", "benevole_transport_athletes", "chef_transport_athletes", "budget"];

export const sendTeamAnnouncement = onCall({ region: REGION }, async (request) => {
  const tr = (fr, en) => (request.data?.lang === "fr" ? fr : en);
  const uid = String(request.auth?.uid || "");
  if (!uid) throw new HttpsError("unauthenticated", tr("Authentification requise.", "Sign-in required."));
  const requester = await firestore().collection("users").doc(uid).get();
  if (!(requester.data()?.userTypes || []).includes("admin")) {
    throw new HttpsError("permission-denied", tr("Réservé aux administrateurs.", "Reserved for administrators."));
  }

  const groups = (Array.isArray(request.data?.groups) ? request.data.groups : []).filter((group) => ANNOUNCEMENT_GROUPS.includes(group));
  const title = String(request.data?.title || "").trim().slice(0, 120);
  const message = String(request.data?.message || "").trim().slice(0, 1000);
  const path = String(request.data?.path || "").startsWith("/app") ? String(request.data.path).slice(0, 200) : "/app";
  if (!groups.length || !title || !message) {
    throw new HttpsError("invalid-argument", tr("Choisis au moins un groupe et écris un titre et un message.", "Choose at least one group and write a title and a message."));
  }

  const roles = groups.filter((group) => group !== "team");
  const lists = await Promise.all([groups.includes("team") ? wholeTeam() : [], roles.length ? usersWithRoles(roles) : []]);
  const users = [...new Map(lists.flat().map((user) => [user.uid, user])).values()];
  // Le message est écrit dans une seule langue : il est affiché tel quel.
  const count = await notifyUsers({ users, type: "announcement", title: { fr: title, en: title }, body: { fr: message, en: message }, path });
  return { count };
});

export const sendTestNotification = onCall({ region: REGION }, async (request) => {
  const uid = String(request.auth?.uid || "");
  if (!uid) throw new HttpsError("unauthenticated", "Sign-in required.");
  await notifyUsers({
    uids: [uid],
    type: "test",
    title: { fr: "Notifications activées", en: "Notifications are on" },
    body: { fr: "Tout fonctionne : tu recevras ici les nouvelles de myCLIM.", en: "All set: you'll get myCLIM updates here." },
    path: "/app/notifications",
  });
  return { ok: true };
});
