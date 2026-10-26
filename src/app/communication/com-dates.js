// Module Communication (porté de myFLA, lib/communication/dates.ts).
// Dates manipulées en chaînes locales « AAAA-MM-JJ » : pas de fuseau horaire,
// tri lexicographique = tri chronologique.

export const pad = (n) => String(n).padStart(2, "0");
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseYmd = (s) => {
  const [y, m, d] = String(s).split("-").map(Number);
  return new Date(y, m - 1, d);
};
export const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
export const todayYmd = () => ymd(new Date());
export const isYmd = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));

export const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
export const MOIS_COURTS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
// Indexé comme Date.getDay() : 0 = dimanche.
export const JOURS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
export const JOURS_GRILLE = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

// Anglais (lang = "en"), mêmes index.
const MONTHS_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS_EN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const GRID_EN = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export const monthName = (m, lang = "fr") => (lang === "fr" ? MOIS : MONTHS_EN)[m];
export const dayName = (dow, lang = "fr") => (lang === "fr" ? JOURS : DAYS_EN)[dow];
export const gridDayNames = (lang = "fr") => (lang === "fr" ? JOURS_GRILLE : GRID_EN);

const jourNum = (d) => (d.getDate() === 1 ? "1er" : String(d.getDate()));
export const fmtLong = (s, lang = "fr") => {
  const d = parseYmd(s);
  if (lang !== "fr") return `${DAYS_EN[d.getDay()]} ${d.getDate()} ${MONTHS_EN[d.getMonth()]}`;
  return `${JOURS[d.getDay()]} ${jourNum(d)} ${MOIS[d.getMonth()]}`;
};
export const fmtShort = (s, lang = "fr") => {
  const d = parseYmd(s);
  if (lang !== "fr") return `${d.getDate()} ${MONTHS_EN[d.getMonth()].slice(0, 3)}`;
  return `${jourNum(d)} ${MOIS_COURTS[d.getMonth()]}`;
};

// Jours affichés dans la grille d'un mois : semaines complètes, du lundi au dimanche.
export function monthGridDays(year, month) {
  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const weeks = Math.ceil((offset + daysInMonth) / 7);
  const start = addDays(first, -offset);
  return Array.from({ length: weeks * 7 }, (_, i) => addDays(start, i));
}

export const daysBetween = (a, b) => Math.round((parseYmd(b).getTime() - parseYmd(a).getTime()) / 86_400_000);
