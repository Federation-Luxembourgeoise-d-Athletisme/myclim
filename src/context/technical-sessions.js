// Sessions techniques ouvertes par jeton personnalisé (Cloud Functions) :
// ordinateurs de caisse (openCashPostSession) et portails partenaires VIP
// (verifyVipPortalAccess). Ce ne sont pas des personnes : pas de profil
// users/{uid}, pas d'accès à l'espace /app.
const CASH_POST_UID_PREFIX = "cash-post-";
const VIP_PORTAL_UID_PREFIX = "vip-portal-";

function isTechnicalSessionUid(uid) {
  const value = String(uid || "");
  return value.startsWith(CASH_POST_UID_PREFIX) || value.startsWith(VIP_PORTAL_UID_PREFIX);
}

function getCashPostIdFromUid(uid) {
  const value = String(uid || "");
  return value.startsWith(CASH_POST_UID_PREFIX) ? value.slice(CASH_POST_UID_PREFIX.length) : "";
}

export { getCashPostIdFromUid, isTechnicalSessionUid };
