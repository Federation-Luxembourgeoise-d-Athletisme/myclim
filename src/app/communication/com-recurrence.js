// Module Communication (porté de myFLA, lib/communication/recurrence.ts) :
// rubriques récurrentes et éléments du calendrier.
// Règle : { kind: "weekly", dow } | { kind: "monthly", dow, nth: [1..5] } | { kind: "last", dow }
// (dow : 0 = dimanche, comme Date.getDay()).
import { addDays, dayName, JOURS, parseYmd, ymd } from "./com-dates.js";
import { normalizePublication } from "./com-domain.js";

const ORD = ["", "1er", "2e", "3e", "4e", "5e"];

export function occurs(rule, d) {
  if (!rule || d.getDay() !== rule.dow) return false;
  if (rule.kind === "weekly") return true;
  if (rule.kind === "monthly") return (rule.nth || []).includes(Math.ceil(d.getDate() / 7));
  return addDays(d, 7).getMonth() !== d.getMonth();
}

// Règle en vigueur à une date donnée (les anciennes règles restent valables pour le passé).
export function ruleAt(rubrique, ds) {
  const old = [...(rubrique.history || [])].sort((a, b) => a.until.localeCompare(b.until)).find((h) => ds < h.until);
  return old ? old.rule : rubrique.rule;
}

// Nouvelle règle quand une occurrence passe de `from` à `to` pour toute la série.
export function movedRule(rule, from, to) {
  const n0 = Math.ceil(from.getDate() / 7);
  const n1 = Math.ceil(to.getDate() / 7);
  if (rule.kind === "monthly") {
    return { ...rule, dow: to.getDay(), nth: [...new Set(rule.nth.map((n) => (n === n0 ? n1 : n)))].sort() };
  }
  return { ...rule, dow: to.getDay() };
}

const ORD_EN = ["", "1st", "2nd", "3rd", "4th", "5th"];

export function ruleLabel(rule, lang = "fr") {
  if (lang !== "fr") {
    const day = dayName(rule.dow, "en");
    if (rule.kind === "weekly") return `Every ${day}`;
    if (rule.kind === "monthly") return `${rule.nth.map((n) => ORD_EN[n]).join(" and ")} ${day} of the month`;
    return `Last ${day} of the month`;
  }
  if (rule.kind === "weekly") return `Chaque ${JOURS[rule.dow]}`;
  if (rule.kind === "monthly") return `${rule.nth.map((n) => ORD[n]).join(" et ")} ${JOURS[rule.dow]} du mois`;
  return `Dernier ${JOURS[rule.dow]} du mois`;
}

export const occurrenceId = (rubriqueId, ds) => `r_${rubriqueId}_${ds}`;

const fromPublication = (p) => ({ ...normalizePublication(p), materialized: true });

// Les occurrences des rubriques sont calculées à l'affichage ; seules celles qu'on a modifiées,
// déplacées ou annulées existent dans com_publications, avec un identifiant déterministe.
export function buildCalendarItems({ rubriques, publications, start, end, today }) {
  const byId = new Map(publications.map((p) => [p.id, p]));
  const emitted = new Set();
  const items = [];

  for (let d = parseYmd(start); ymd(d) <= end; d = addDays(d, 1)) {
    const ds = ymd(d);
    for (const r of rubriques) {
      if (!r.active || !occurs(ruleAt(r, ds), d)) continue;
      const id = occurrenceId(r.id, ds);
      const saved = byId.get(id);
      if (saved) {
        emitted.add(id);
        if (!saved.annulee && saved.date === ds) items.push(fromPublication(saved));
        // Déplacée : elle sera ajoutée à sa nouvelle date si celle-ci est visible.
        if (saved.date !== ds) emitted.delete(id);
        continue;
      }
      items.push({
        ...normalizePublication({
          id,
          rubriqueId: r.id,
          occurrenceDate: ds,
          date: ds,
          titre: r.titre,
          type: r.type,
          canaux: r.canaux,
          // Par convention, une occurrence passée jamais modifiée est considérée comme publiée.
          statut: ds < today ? "done" : "todo",
          assigneUids: r.responsableUid ? [r.responsableUid] : [],
        }),
        materialized: false,
      });
    }
  }

  // Publications ponctuelles, occurrences déplacées et occurrences personnalisées dont la règle a changé.
  for (const p of publications) {
    if (p.annulee || emitted.has(p.id) || p.date < start || p.date > end) continue;
    items.push(fromPublication(p));
  }

  return items.sort((a, b) => a.date.localeCompare(b.date) || Number(Boolean(b.rubriqueId)) - Number(Boolean(a.rubriqueId)));
}
