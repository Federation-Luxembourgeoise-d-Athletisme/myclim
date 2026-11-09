// Billetterie sur le site public : bandeau, compte à rebours, bloc
// « Plan your visit ». Logique pure, testée dans tests/ticketing-utils.test.js.
import { luxembourgDayKey, parseTimeToMinutes } from "./links-page-config.js";

const DEFAULT_DOORS_TIME = "14:00";
// Le bloc « Plan your visit » revient sur l'accueil 10 jours avant le meeting.
const PLAN_VISIT_HOME_DAYS_BEFORE = 10;
const DAY_MS = 86400000;

function toDate(value) {
  if (!value) return null;
  const date = typeof value?.toDate === "function" ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dayKeyToUtc(dayKey) {
  const [year, month, day] = dayKey.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

// Jours entre aujourd'hui et le jour du meeting, à Luxembourg (0 = jour J,
// négatif = passé). null sans date d'édition.
function daysUntilEdition(editionDate, now = new Date()) {
  const date = toDate(editionDate);
  if (!date) return null;
  return Math.round((dayKeyToUtc(luxembourgDayKey(date)) - dayKeyToUtc(luxembourgDayKey(now))) / DAY_MS);
}

// Ouverture des portes le jour du meeting. L'heure vient du texte « Doors »
// de la page Liens (« 14:00 », « Doors open at 14h00 »…), sinon 14:00. Le
// meeting a lieu en hiver : Luxembourg est alors à UTC+1.
function getDoorsOpenDate(editionDate, doorsText = "") {
  const date = toDate(editionDate);
  if (!date) return null;
  const match = String(doorsText || "").match(/(\d{1,2})[:h.](\d{2})/);
  const minutes = parseTimeToMinutes(match ? `${match[1]}:${match[2]}` : DEFAULT_DOORS_TIME);
  const time = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  return new Date(`${luxembourgDayKey(date)}T${time}:00+01:00`);
}

function formatDoorsTime(doorsOpen) {
  if (!doorsOpen) return DEFAULT_DOORS_TIME;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Luxembourg",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(doorsOpen);
}

// presale → earlyBird → regular → eventDay → past.
function getTicketPhase(pricing, editionDate, now = new Date()) {
  const daysLeft = daysUntilEdition(editionDate, now);
  if (daysLeft !== null && daysLeft < 0) return "past";
  if (daysLeft === 0) return "eventDay";
  const saleOpensAt = toDate(pricing?.saleOpensAt);
  if (saleOpensAt && now < saleOpensAt) return "presale";
  const earlyBirdEndsAt = toDate(pricing?.earlyBirdEndsAt);
  if (earlyBirdEndsAt && now <= earlyBirdEndsAt) return "earlyBird";
  return "regular";
}

function getCountdownParts(target, now = new Date()) {
  const date = toDate(target);
  if (!date) return null;
  const left = date.getTime() - now.getTime();
  if (left <= 0) return null;
  return {
    days: Math.floor(left / DAY_MS),
    hours: Math.floor((left % DAY_MS) / 3600000),
    minutes: Math.floor((left % 3600000) / 60000),
  };
}

function showPlanVisitOnHome(editionDate, now = new Date()) {
  const daysLeft = daysUntilEdition(editionDate, now);
  return daysLeft !== null && daysLeft >= 0 && daysLeft <= PLAN_VISIT_HOME_DAYS_BEFORE;
}

export {
  DEFAULT_DOORS_TIME,
  PLAN_VISIT_HOME_DAYS_BEFORE,
  daysUntilEdition,
  formatDoorsTime,
  getCountdownParts,
  getDoorsOpenDate,
  getTicketPhase,
  showPlanVisitOnHome,
};
