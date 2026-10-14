// Module Communication (porté de myFLA, lib/communication/partners.ts) :
// partenaires et contreparties.
//
// Dans myclim, les partenaires existent déjà : ce sont les sponsors du site
// (siteSponsors, lecture publique : nom, logo, site, catégorie). Les infos
// réservées à l'organisation (compte à mentionner, contact, contrat, notes)
// vivent dans com_partner_details/{sponsorId}, avec le même identifiant.
import { addDays, daysBetween, parseYmd, ymd } from "./com-dates.js";
import { occurrenceId, occurs, ruleAt } from "./com-recurrence.js";

export const PARTNER_CATEGORIES = ["social", "terrain", "newsletter", "print", "hospitalite"];
export const PARTNER_CATEGORY_LABELS = {
  social: "Réseaux sociaux",
  terrain: "Terrain et événements",
  newsletter: "Newsletter / e-mailing",
  print: "Print (programme, affiches)",
  hospitalite: "Invitations",
};

export const OBLIGATION_MODES = ["publications", "rubrique", "evenements", "livrable", "quantite"];
export const OBLIGATION_MODE_LABELS = {
  publications: {
    label: "Automatique · publications",
    help: "Compte les publications du calendrier qui mentionnent le partenaire et sont publiées pendant le contrat. En catégorie Newsletter : seules les newsletters comptent.",
  },
  rubrique: {
    label: "Automatique · rubrique",
    help: "Compte chaque occurrence publiée d'une rubrique récurrente pendant le contrat.",
  },
  evenements: {
    label: "Par événement",
    help: "Liste d'événements à cocher une fois la contrepartie réalisée (ex. banderole, beach flags).",
  },
  livrable: {
    label: "Livrable",
    help: "Suivi par étapes avec une échéance (ex. logo dans le programme ou sur l'affiche).",
  },
  quantite: { label: "Quantité", help: "Simple compteur (ex. invitations)." },
};

// Mode proposé par défaut selon la catégorie de contrepartie.
export const DEFAULT_MODE_BY_CATEGORY = {
  social: "publications",
  terrain: "evenements",
  newsletter: "publications",
  print: "livrable",
  hospitalite: "quantite",
};

export const LIVRABLE_ETAPES = ["Fichier à recevoir", "Fichier reçu", "BAT validé", "Publié / imprimé"];

export const OBLIGATION_STATUTS = ["late", "risk", "ontrack", "done"];
export const OBLIGATION_STATUT_LABELS = {
  late: "En retard",
  risk: "À risque",
  ontrack: "Dans les temps",
  done: "Terminé",
};

export const EMPTY_PARTNER_DETAILS = {
  handle: "",
  contact: "",
  notes: "",
  contratDebut: "",
  contratFin: "",
  contratLien: "",
};

// Fiche partenaire du module : sponsor du site + infos privées.
export function buildComPartner(sponsor, details = {}, categoryLabel = "") {
  return {
    id: sponsor.id,
    nom: String(sponsor.name || ""),
    niveau: categoryLabel || String(sponsor.category || ""),
    logoUrl: sponsor.logoUrl || "",
    website: sponsor.website || "",
    active: sponsor.active !== false,
    ...EMPTY_PARTNER_DETAILS,
    ...Object.fromEntries(Object.keys(EMPTY_PARTNER_DETAILS).map((key) => [key, String(details?.[key] ?? "")])),
    hasDetails: Boolean(details && Object.keys(details).length),
  };
}

export function normalizeObligation(raw = {}) {
  return {
    id: raw.id,
    partnerId: String(raw.partnerId || ""),
    categorie: PARTNER_CATEGORIES.includes(raw.categorie) ? raw.categorie : "social",
    libelle: String(raw.libelle || ""),
    mode: OBLIGATION_MODES.includes(raw.mode) ? raw.mode : "quantite",
    cible: Math.max(0, Number(raw.cible) || 0),
    rubriqueId: raw.rubriqueId || null,
    items: Array.isArray(raw.items) ? raw.items : [],
    echeance: raw.echeance || null,
    etape: Math.max(0, Number(raw.etape) || 0),
    fait: Math.max(0, Number(raw.fait) || 0),
    dejaRealise: Math.max(0, Number(raw.dejaRealise) || 0),
  };
}

// Avancement d'une contrepartie. Sans dates de contrat, le rythme attendu
// n'est pas calculé (seul l'objectif compte).
export function obligationProgress(partner, ob, ctx) {
  const hasContract = Boolean(partner.contratDebut && partner.contratFin);
  const debut = partner.contratDebut || "0000-01-01";
  const fin = partner.contratFin || "9999-12-31";
  const total = hasContract ? Math.max(1, daysBetween(debut, fin)) : 1;
  const frac = hasContract ? Math.min(1, Math.max(0, daysBetween(debut, ctx.today) / total)) : 0;
  let fait = 0;
  let cible = Math.max(0, ob.cible || 0);
  let attendu = null;
  let prevus = 0;
  let publications = [];

  if (ob.mode === "publications") {
    publications = ctx.partnerPublications
      .filter((p) => !p.annulee && (p.partnerIds || []).includes(partner.id) && p.date >= debut && p.date <= fin)
      .filter((p) => ob.categorie !== "newsletter" || p.type === "newsletter")
      .sort((a, b) => a.date.localeCompare(b.date));
    const done = publications.filter((p) => p.statut === "done").length;
    fait = (ob.dejaRealise || 0) + done;
    prevus = publications.length - done;
    attendu = hasContract ? Math.floor(cible * frac) : null;
  } else if (ob.mode === "rubrique") {
    const r = ctx.rubriques.find((x) => x.id === ob.rubriqueId);
    cible = 0;
    attendu = 0;
    if (r && hasContract) {
      const saved = new Map(ctx.rubriquePublications.map((p) => [p.id, p]));
      for (let d = parseYmd(debut); ymd(d) <= fin; d = addDays(d, 1)) {
        const ds = ymd(d);
        if (!occurs(ruleAt(r, ds), d)) continue;
        const pub = saved.get(occurrenceId(r.id, ds));
        if (pub?.annulee) continue;
        cible += 1;
        const date = pub?.date ?? ds;
        // Même convention que le calendrier : une occurrence passée jamais modifiée est considérée comme publiée.
        const statut = pub?.statut ?? (date < ctx.today ? "done" : "todo");
        if (date < ctx.today) {
          attendu += 1;
          if (statut === "done") fait += 1;
        } else prevus += 1;
      }
    }
  } else if (ob.mode === "evenements") {
    fait = ob.items.filter((i) => i.fait).length;
    attendu = ob.items.filter((i) => i.date && i.date < ctx.today).length;
    prevus = ob.items.filter((i) => !i.fait && (!i.date || i.date >= ctx.today)).length;
  } else if (ob.mode === "livrable") {
    cible = 1;
    fait = ob.etape >= LIVRABLE_ETAPES.length - 1 ? 1 : 0;
    attendu = ob.echeance && ob.echeance < ctx.today ? 1 : 0;
  } else {
    fait = ob.fait || 0;
  }

  let statut = "ontrack";
  if (cible > 0 && fait >= cible) statut = "done";
  else if (attendu !== null && fait < attendu) statut = "late";
  else if (hasContract && daysBetween(ctx.today, fin) <= 60) statut = "risk";
  else if (ob.mode === "livrable" && ob.echeance && daysBetween(ctx.today, ob.echeance) <= 45 && ob.etape < 2) statut = "risk";

  return { fait, cible, attendu, prevus, statut, publications };
}

export function partnerCompletion(partner, obligations, ctx) {
  const own = obligations.filter((o) => o.partnerId === partner.id);
  if (!own.length) return 0;
  const sum = own.reduce((acc, o) => {
    const g = obligationProgress(partner, o, ctx);
    return acc + (g.cible ? Math.min(1, g.fait / g.cible) : 0);
  }, 0);
  return sum / own.length;
}

export const progressText = (ob, g) =>
  ob.mode === "livrable" ? (g.fait ? "Livré" : LIVRABLE_ETAPES[ob.etape] ?? LIVRABLE_ETAPES[0]) : `${g.fait} / ${g.cible}`;
