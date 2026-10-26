// Module Communication : écritures Firestore (porté de myFLA, lib/communication/actions.ts,
// publication-handlers.ts et validation.ts). Sans Mailchimp ni newsletter.
import { deleteObject, ref as storageRef } from "firebase/storage";
import { addDoc, collection, deleteDoc, doc, serverTimestamp, setDoc, updateDoc, writeBatch } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { auth, db, functions, storage, STORAGE_UPLOAD_ENDPOINT } from "../../services/firebase";
import { parseYmd } from "./com-dates.js";
import { COM_COLLECTIONS } from "./com-domain.js";
import { movedRule, occurrenceId, ruleAt } from "./com-recurrence.js";

const PUBLICATION_FIELDS = [
  "titre",
  "date",
  "type",
  "canaux",
  "statut",
  "assigneUids",
  "notes",
  "rubriqueId",
  "occurrenceDate",
  "eventId",
  "partnerIds",
  "checks",
  "facebookPostId",
  "instagramMediaId",
  "siteUrl",
  "texte",
  "heure",
  "canvaUrl",
  "visuelUrl",
  "visuelPath",
  "photos",
  "liens",
];

const toData = (item) => ({
  ...Object.fromEntries(PUBLICATION_FIELDS.map((key) => [key, item[key] ?? null])),
  annulee: false,
});

// Modifie une publication ; une occurrence calculée est enregistrée à sa première modification.
export async function updateItem(item, patch, uid) {
  const ref = doc(db, COM_COLLECTIONS.publications, item.id);
  if (item.materialized) {
    await updateDoc(ref, { ...patch, updatedAt: serverTimestamp() });
  } else {
    await setDoc(ref, { ...toData(item), ...patch, createdBy: uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  }
}

export async function createPublication(data, uid) {
  const ref = await addDoc(collection(db, COM_COLLECTIONS.publications), {
    eventId: null,
    partnerIds: [],
    checks: {},
    notes: "",
    texte: "",
    ...data,
    rubriqueId: null,
    occurrenceDate: null,
    annulee: false,
    createdBy: uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export const deletePublication = (id) => deleteDoc(doc(db, COM_COLLECTIONS.publications, id));

export const cancelOccurrence = (item, uid) => updateItem(item, { annulee: true }, uid);

// « Toute la série à partir de cette date » : la règle est découpée à la plus proche des deux dates,
// l'ancienne règle reste valable pour le passé.
export async function moveSeries(item, rubrique, to, uid) {
  const orig = item.occurrenceDate || item.date;
  const cut = orig < to ? orig : to;
  const current = ruleAt(rubrique, orig);
  const batch = writeBatch(db);

  batch.update(doc(db, COM_COLLECTIONS.rubriques, rubrique.id), {
    history: [...(rubrique.history || []).filter((h) => h.until <= cut), { until: cut, rule: current }],
    rule: movedRule(current, parseYmd(orig), parseYmd(to)),
    updatedAt: serverTimestamp(),
  });

  // Une occurrence déjà personnalisée suit la série à sa nouvelle date.
  if (item.materialized) {
    batch.delete(doc(db, COM_COLLECTIONS.publications, item.id));
    batch.set(doc(db, COM_COLLECTIONS.publications, occurrenceId(rubrique.id, to)), {
      ...toData(item),
      date: to,
      occurrenceDate: to,
      createdBy: uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  await batch.commit();
}

/* ---------- Rubriques ---------- */

export const createRubrique = (data) =>
  addDoc(collection(db, COM_COLLECTIONS.rubriques), { ...data, history: [], createdAt: serverTimestamp(), updatedAt: serverTimestamp() });

// Un changement de rythme s'applique à partir d'aujourd'hui : les dates passées gardent l'ancien rythme.
export async function updateRubrique(rubrique, data, today) {
  const ruleChanged = JSON.stringify(rubrique.rule) !== JSON.stringify(data.rule);
  const history = ruleChanged
    ? [...(rubrique.history || []).filter((h) => h.until <= today), { until: today, rule: rubrique.rule }]
    : rubrique.history || [];
  await updateDoc(doc(db, COM_COLLECTIONS.rubriques, rubrique.id), { ...data, history, updatedAt: serverTimestamp() });
}

export const setRubriqueActive = (id, active) => updateDoc(doc(db, COM_COLLECTIONS.rubriques, id), { active, updatedAt: serverTimestamp() });
export const deleteRubrique = (id) => deleteDoc(doc(db, COM_COLLECTIONS.rubriques, id));

/* ---------- Événements et tâches ---------- */

export const createEvenement = (data, uid) =>
  addDoc(collection(db, COM_COLLECTIONS.events), { ...data, createdBy: uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
export const updateEvenement = (id, data) => updateDoc(doc(db, COM_COLLECTIONS.events, id), { ...data, updatedAt: serverTimestamp() });
// Les publications et tâches de l'événement restent, simplement sans événement.
export const deleteEvenement = (id) => deleteDoc(doc(db, COM_COLLECTIONS.events, id));

export const createTask = (data, uid) =>
  addDoc(collection(db, COM_COLLECTIONS.tasks), { ...data, createdBy: uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
export const updateTask = (id, data) => updateDoc(doc(db, COM_COLLECTIONS.tasks, id), { ...data, updatedAt: serverTimestamp() });
export const deleteTask = (id) => deleteDoc(doc(db, COM_COLLECTIONS.tasks, id));

/* ---------- Partenaires et contreparties ---------- */

// Les infos privées sont rangées sous l'identifiant du sponsor du site.
export const savePartnerDetails = (sponsorId, data) =>
  setDoc(doc(db, COM_COLLECTIONS.partnerDetails, sponsorId), { ...data, updatedAt: serverTimestamp() }, { merge: true });

export const createObligation = (data) =>
  addDoc(collection(db, COM_COLLECTIONS.obligations), { ...data, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
export const updateObligation = (id, data) => updateDoc(doc(db, COM_COLLECTIONS.obligations, id), { ...data, updatedAt: serverTimestamp() });
export const deleteObligation = (id) => deleteDoc(doc(db, COM_COLLECTIONS.obligations, id));

/* ---------- Validation (Cloud Function, qui prévient par e-mail) ---------- */

// action : "demande" (avec demandeeA = uids), "validee" ou "a_revoir".
export async function sendValidation(publicationId, action, message, demandeeA) {
  const callable = httpsCallable(functions, "comPublicationValidation");
  const response = await callable({ publicationId, action, message, demandeeA });
  return response?.data?.validation || null;
}

/* ---------- Visuel final (export Canva) ---------- */

export const VISUEL_MAX_BYTES = 15 * 1024 * 1024;
export const VISUEL_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp", "video/mp4", "video/quicktime"];

// Dépose le visuel via la fonction d'envoi existante (com-visuels/{publication}/…) et renvoie son adresse.
export async function uploadVisuel(publicationId, file) {
  if (!VISUEL_TYPES.includes(file.type)) throw new Error("Format accepté : image (PNG, JPEG, GIF, WebP) ou vidéo (MP4, MOV).");
  if (file.size > VISUEL_MAX_BYTES) throw new Error("Fichier trop lourd (15 Mo maximum).");
  const user = auth.currentUser;
  if (!user) throw new Error("Session expirée : reconnecte-toi.");
  const response = await fetch(STORAGE_UPLOAD_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${await user.getIdToken()}`,
      "Content-Type": file.type,
      "X-Upload-Path": `com-visuels/${publicationId}`,
      "X-File-Name": encodeURIComponent(file.name),
    },
    body: file,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.url) throw new Error(payload?.message || "L'envoi du visuel a échoué.");
  return { url: payload.url, path: payload.filePath };
}

// Suppression de l'ancien fichier : sans conséquence si elle échoue (fichier déjà supprimé).
export const deleteVisuel = (path) => deleteObject(storageRef(storage, path)).catch(() => undefined);

export const isVideo = (url) => /\.(mp4|mov)(\?|$)/i.test(decodeURIComponent(String(url || "")));

// Actions communes sur une publication (aperçu du calendrier et page de la publication).
// notify(message) affiche une confirmation ou une erreur.
export function publicationHandlers(item, uid, notify) {
  async function run(action, success) {
    try {
      await action();
      if (success) notify(success);
    } catch (error) {
      console.error(error);
      notify(error?.message && !String(error.message).startsWith("FirebaseError") ? error.message : "L'enregistrement a échoué. Réessaie.");
    }
  }

  return {
    run,
    update: (patch, success) => run(() => updateItem(item, patch, uid), success),
    // Le serveur travaille sur la publication enregistrée : une occurrence calculée l'est d'abord.
    requestValidation: (demandeeA, message) =>
      run(async () => {
        if (!item.materialized) await updateItem(item, {}, uid);
        await sendValidation(item.id, "demande", message, demandeeA);
      }, "Demande de validation envoyée"),
    answerValidation: (verdict, comment) =>
      run(() => sendValidation(item.id, verdict, comment), verdict === "validee" ? "Publication validée 👍" : "Renvoyée pour corrections 👎"),
    uploadVisuel: (file) =>
      run(async () => {
        const previous = item.visuelPath;
        const { url, path } = await uploadVisuel(item.id, file);
        await updateItem(item, { visuelUrl: url, visuelPath: path }, uid);
        if (previous) await deleteVisuel(previous);
      }, "Visuel enregistré"),
    removeVisuel: () =>
      run(async () => {
        const previous = item.visuelPath;
        await updateItem(item, { visuelUrl: null, visuelPath: null }, uid);
        if (previous) await deleteVisuel(previous);
      }),
  };
}
