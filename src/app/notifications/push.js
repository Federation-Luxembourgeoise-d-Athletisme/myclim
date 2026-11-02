// Notifications push sur cet appareil (Firebase Cloud Messaging).
// Chaque appareil activé est rangé dans users/{uid}/pushTokens/{token}, avec la
// langue de l'app au moment de l'activation : le serveur envoie le push dans
// cette langue.
import { getApp } from "firebase/app";
import { deleteDoc, doc, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "../../services/firebase";

const VAPID_KEY = String(import.meta.env.VITE_FIREBASE_VAPID_KEY || "").trim();
const TOKEN_STORAGE_KEY = "myclim-push-token";

export function isIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

export function isStandalone() {
  return window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

// "unsupported" | "install" (iPhone : ajouter d'abord à l'écran d'accueil) |
// "unconfigured" (clé VAPID manquante) | "denied" | "granted" | "default"
export async function getPushStatus() {
  if (isIos() && !isStandalone()) return "install";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "unsupported";
  const { isSupported } = await import("firebase/messaging");
  if (!(await isSupported())) return "unsupported";
  if (!VAPID_KEY) return "unconfigured";
  return Notification.permission;
}

export function storedPushToken() {
  try {
    return window.localStorage.getItem(TOKEN_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

function rememberToken(token) {
  try {
    if (token) window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
    else window.localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // Stockage indisponible (navigation privée) : on redemandera le jeton.
  }
}

async function messagingWithWorker() {
  const { getMessaging } = await import("firebase/messaging");
  const registration = await navigator.serviceWorker.register("/firebase-messaging-sw.js");
  await navigator.serviceWorker.ready;
  return { messaging: getMessaging(getApp()), registration };
}

// Demande l'autorisation (doit suivre un clic sur iPhone) et enregistre l'appareil.
export async function enablePush(uid, lang) {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission;
  const { getToken } = await import("firebase/messaging");
  const { messaging, registration } = await messagingWithWorker();
  const token = await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: registration });
  if (!token) throw new Error("No push token");
  await setDoc(doc(db, "users", uid, "pushTokens", token), {
    token,
    lang: lang === "fr" ? "fr" : "en",
    userAgent: navigator.userAgent.slice(0, 300),
    createdAt: serverTimestamp(),
  });
  rememberToken(token);
  return "granted";
}

export async function disablePush(uid) {
  const token = storedPushToken();
  if (token) await deleteDoc(doc(db, "users", uid, "pushTokens", token)).catch(() => {});
  try {
    const { deleteToken } = await import("firebase/messaging");
    const { messaging } = await messagingWithWorker();
    await deleteToken(messaging);
  } catch {
    // Le jeton est déjà invalide : rien d'autre à faire.
  }
  rememberToken("");
}

// Pastille sur l'icône de l'app (iPhone 16.4+, Android, ordinateur).
export function setAppBadge(count) {
  if (!("setAppBadge" in navigator)) return;
  (count ? navigator.setAppBadge(count) : navigator.clearAppBadge()).catch(() => {});
}
