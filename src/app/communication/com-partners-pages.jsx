// Partenaires et contreparties (porté de myFLA : app/communication/partenaires/*,
// obligation-card.tsx, obligation-dialog.tsx, partner-dialog.tsx, use-partner-data.ts).
// Les partenaires viennent des sponsors du site (Site web → Partenaires) : ici on
// ajoute seulement leurs infos privées et leurs contreparties.
import { useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { createObligation, deleteObligation, savePartnerDetails, updateObligation } from "./com-actions.js";
import { useComPartners, useObligations, usePartnerPublications, useRubriquePublications, useRubriques } from "./com-data.js";
import { addDays, daysBetween, fmtLong, fmtShort, parseYmd, todayYmd, ymd } from "./com-dates.js";
import { pick, useComLang } from "./com-i18n.js";
import {
  DEFAULT_MODE_BY_CATEGORY,
  LIVRABLE_ETAPES,
  OBLIGATION_MODES,
  OBLIGATION_MODE_LABELS,
  OBLIGATION_STATUT_LABELS,
  PARTNER_CATEGORIES,
  PARTNER_CATEGORY_LABELS,
  obligationProgress,
  partnerCompletion,
  progressText,
} from "./com-partners.js";
import { ruleLabel } from "./com-recurrence.js";
import { CANAL_LABELS, PUB_TYPE_LABELS } from "./com-domain.js";
import { facebookStats, formatCount, instagramStats, useSocialPosts } from "./com-social.js";
import { ComPageHeader, Dialog, StatusPill, Toast } from "./com-ui.jsx";
import { useToast } from "./com-ui-helpers.js";

const STATUT_TONE = { late: "danger", risk: "warn", ontrack: "info", done: "ok" };

export function ObligationStatusPill({ statut }) {
  const { lang } = useComLang();
  return <span className={`com-badge com-badge--${STATUT_TONE[statut]}`}>{pick(OBLIGATION_STATUT_LABELS[statut], lang)}</span>;
}

const fullDate = (value, lang) => (value ? `${fmtShort(value, lang)} ${value.slice(0, 4)}` : "");
const contractText = (partner, lang) => {
  if (!partner.contratDebut || !partner.contratFin) return lang === "fr" ? "dates du contrat à saisir" : "contract dates not entered yet";
  const from = fullDate(partner.contratDebut, lang);
  const to = fullDate(partner.contratFin, lang);
  return lang === "fr" ? `contrat du ${from} au ${to}` : `contract from ${from} to ${to}`;
};
const days = (n, lang) => (lang === "fr" ? `${n} jours` : `${n} day${n === 1 ? "" : "s"}`);

// Données partagées par le tableau de bord et la fiche d'un partenaire.
function usePartnerData() {
  const today = todayYmd();
  const { partners, loading } = useComPartners();
  const obligations = useObligations();
  const { rubriques } = useRubriques();
  const partnerPublications = usePartnerPublications(partners.map((p) => p.id));
  const rubriquePublications = useRubriquePublications(obligations.filter((o) => o.mode === "rubrique" && o.rubriqueId).map((o) => o.rubriqueId));
  const ctx = useMemo(() => ({ today, rubriques, partnerPublications, rubriquePublications }), [today, rubriques, partnerPublications, rubriquePublications]);
  return { today, partners, loading, obligations, rubriques, ctx };
}

export function ComPartnersPage() {
  const { today, partners, loading, obligations, ctx } = usePartnerData();
  const { lang, tr } = useComLang();

  const rows = useMemo(
    () =>
      obligations.flatMap((o) => {
        const partner = partners.find((p) => p.id === o.partnerId);
        return partner ? [{ partner, o, g: obligationProgress(partner, o, ctx) }] : [];
      }),
    [obligations, partners, ctx],
  );
  const late = rows.filter((r) => r.g.statut === "late");
  const risk = rows.filter((r) => r.g.statut === "risk");
  const renew = partners.filter((p) => {
    if (!p.contratFin) return false;
    const d = daysBetween(today, p.contratFin);
    return d >= 0 && d <= 60;
  });
  const limit = ymd(addDays(parseYmd(today), 45));
  const upcoming = [
    ...rows.flatMap(({ partner, o }) =>
      o.mode === "evenements"
        ? o.items.filter((i) => !i.fait && i.date && i.date >= today && i.date <= limit).map((i) => ({ partner, date: i.date, text: `${o.libelle} – ${i.label}` }))
        : [],
    ),
    ...rows
      .filter(({ o }) => o.mode === "livrable" && o.etape < LIVRABLE_ETAPES.length - 1 && o.echeance && o.echeance >= today && o.echeance <= limit)
      .map(({ partner, o }) => ({ partner, date: o.echeance, text: `${o.libelle} (${pick(LIVRABLE_ETAPES[o.etape], lang)?.toLowerCase()})` })),
  ].sort((a, b) => a.date.localeCompare(b.date));

  // Partenaires regroupés par catégorie de sponsor du site.
  const otherPartners = tr("Autres partenaires", "Other partners");
  const groups = [...new Set(partners.map((p) => p.niveau || otherPartners))].map((title) => ({
    title,
    list: partners.filter((p) => (p.niveau || otherPartners) === title),
  }));

  const tiles = [
    { key: "late", value: late.length, label: tr("contreparties en retard", "late benefits"), tone: "is-late" },
    { key: "risk", value: risk.length, label: tr("contreparties à risque", "benefits at risk"), tone: "is-risk" },
    { key: "renew", value: renew.length, label: tr("contrats à renouveler (moins de 60 jours)", "contracts to renew (under 60 days)"), tone: "" },
    { key: "partners", value: partners.length, label: tr("partenaires", partners.length === 1 ? "partner" : "partners"), tone: "" },
  ];

  return (
    <>
      <ComPageHeader
        title={tr("Partenaires", "Partners")}
        description={tr(
          "Contreparties prévues aux contrats et leur avancement. Les publications du calendrier qui mentionnent un partenaire sont comptées automatiquement.",
          "Benefits promised in the contracts and how they are progressing. Calendar publications that mention a partner are counted automatically.",
        )}
        actions={
          <Link to="/app/website/sponsors" className="button button--secondary button--small">
            {tr("Gérer la liste des partenaires (site web)", "Manage the partner list (website)")}
          </Link>
        }
      />

      {!loading && !partners.length ? (
        <p className="com-empty" style={{ textAlign: "center" }}>
          {tr(
            "Aucun partenaire pour l'instant. Ajoute-les dans Site web → Partenaires : ils apparaîtront ici automatiquement.",
            "No partners yet. Add them in Website → Partners: they will show up here automatically.",
          )}
        </p>
      ) : (
        <>
          <div className="com-tiles">
            {tiles.map((t) => (
              <div key={t.key} className={`com-tile ${t.tone}`}>
                <strong>{t.value}</strong>
                <span>{t.label}</span>
              </div>
            ))}
          </div>

          <section className="com-stack" style={{ gap: 8 }}>
            <h2 className="com-section-title">{tr("À traiter en priorité", "Top priorities")}</h2>
            <div className="com-list">
              {![...late, ...risk].length ? (
                <p className="com-muted" style={{ padding: 20, textAlign: "center" }}>
                  {tr("Toutes les contreparties sont dans les temps.", "All benefits are on track.")}
                </p>
              ) : (
                [...late, ...risk].map(({ partner, o, g }) => (
                  <Link
                    key={o.id}
                    to={`/app/communication/partenaires/${partner.id}?ob=${o.id}`}
                    className="com-list__day"
                    style={{ gridTemplateColumns: "minmax(0, 1fr) auto", alignItems: "center", color: "inherit", textDecoration: "none" }}
                  >
                    <span className="com-stack" style={{ gap: 2 }}>
                      <b>{o.libelle}</b>
                      <span className="com-muted" style={{ fontSize: "0.78rem" }}>
                        {partner.nom} · {progressText(o, g, lang)}
                        {g.attendu !== null && o.mode !== "livrable" ? tr(` · attendu à ce jour : ${g.attendu}`, ` · expected by now: ${g.attendu}`) : ""}
                        {g.prevus ? tr(` · ${g.prevus} prévu(s)`, ` · ${g.prevus} scheduled`) : ""}
                      </span>
                    </span>
                    <ObligationStatusPill statut={g.statut} />
                  </Link>
                ))
              )}
            </div>
          </section>

          {upcoming.length ? (
            <section className="com-stack" style={{ gap: 8 }}>
              <h2 className="com-section-title">{tr("Prochaines échéances · 45 jours", "Upcoming deadlines · 45 days")}</h2>
              <div className="com-list">
                {upcoming.map((u, k) => (
                  <Link
                    key={k}
                    to={`/app/communication/partenaires/${u.partner.id}`}
                    className="com-list__day"
                    style={{ gridTemplateColumns: "minmax(0, 1fr) auto", alignItems: "center", color: "inherit", textDecoration: "none" }}
                  >
                    <span className="com-stack" style={{ gap: 2 }}>
                      <b>{u.text}</b>
                      <span className="com-muted" style={{ fontSize: "0.78rem" }}>
                        {u.partner.nom}
                      </span>
                    </span>
                    <strong>{fmtShort(u.date, lang)}</strong>
                  </Link>
                ))}
              </div>
            </section>
          ) : null}

          {groups.map((group) => (
            <section key={group.title} className="com-stack" style={{ gap: 8 }}>
              <h2 className="com-section-title">
                {group.title} · {group.list.length}
              </h2>
              <div className="com-partner-grid">
                {group.list.map((p) => {
                  const pct = partnerCompletion(p, obligations, ctx);
                  const statuts = rows.filter((r) => r.partner.id === p.id).map((r) => r.g.statut);
                  const left = p.contratFin ? daysBetween(today, p.contratFin) : null;
                  return (
                    <Link key={p.id} to={`/app/communication/partenaires/${p.id}`} className="com-partner-card">
                      <span className="com-partner-card__head">
                        {p.logoUrl ? <img src={p.logoUrl} alt="" /> : null}
                        <span className="com-stack" style={{ gap: 2, minWidth: 0 }}>
                          <strong style={{ fontSize: "1.05rem" }}>{p.nom}</strong>
                          <span className="com-muted" style={{ fontSize: "0.75rem" }}>
                            {contractText(p, lang)}
                            {p.active ? "" : tr(" · masqué sur le site", " · hidden on the website")}
                          </span>
                        </span>
                      </span>
                      <span className="com-stack" style={{ gap: 4 }}>
                        <span className="com-muted" style={{ fontSize: "0.75rem" }}>
                          {tr(`${Math.round(pct * 100)} % des contreparties réalisées`, `${Math.round(pct * 100)}% of benefits delivered`)}
                        </span>
                        <span className="com-progress">
                          <span style={{ width: `${pct * 100}%` }} />
                        </span>
                      </span>
                      <span className="com-row" style={{ gap: 6 }}>
                        {["late", "risk", "ontrack", "done"]
                          .filter((s) => statuts.includes(s))
                          .map((s) => (
                            <span key={s} style={{ fontSize: "0.75rem" }}>
                              <ObligationStatusPill statut={s} /> ×{statuts.filter((x) => x === s).length}
                            </span>
                          ))}
                        {!statuts.length ? (
                          <span className="com-muted" style={{ fontSize: "0.75rem" }}>
                            {tr("Aucune contrepartie saisie.", "No benefits entered.")}
                          </span>
                        ) : null}
                      </span>
                      {left !== null && left >= 0 && left <= 60 ? (
                        <span className="com-badge com-badge--warn">{tr(`Contrat à renouveler : fin dans ${days(left, lang)}`, `Contract to renew: ends in ${days(left, lang)}`)}</span>
                      ) : left !== null && left < 0 ? (
                        <span className="com-badge com-badge--info">{tr("Contrat terminé", "Contract ended")}</span>
                      ) : null}
                    </Link>
                  );
                })}
              </div>
            </section>
          ))}
        </>
      )}
    </>
  );
}

export function ComPartnerDetailPage() {
  const { id = "" } = useParams();
  const [searchParams] = useSearchParams();
  const focusOb = searchParams.get("ob");
  const { today, partners, loading, obligations, rubriques, ctx } = usePartnerData();
  const { lang, tr } = useComLang();
  const partner = partners.find((p) => p.id === id);
  const [open, setOpen] = useState(() => new Set(focusOb ? [focusOb] : []));
  const [editingDetails, setEditingDetails] = useState(false);
  const [editingOb, setEditingOb] = useState(null);
  const [bilan, setBilan] = useState(false);
  const [toast, setToast] = useToast();

  async function run(action, success) {
    try {
      await action();
      if (success) setToast(success);
    } catch (error) {
      console.error(error);
      setToast(tr("L'enregistrement a échoué. Réessaie.", "Saving failed. Please try again."));
    }
  }

  if (loading) return <p className="com-muted">{tr("Chargement…", "Loading…")}</p>;
  if (!partner) {
    return (
      <>
        <ComPageHeader
          title={tr("Partenaire introuvable", "Partner not found")}
          description={tr("Il a peut-être été supprimé de la liste des partenaires du site.", "It may have been removed from the website's partner list.")}
        />
        <Link to="/app/communication/partenaires" className="com-link">
          {tr("← Tous les partenaires", "← All partners")}
        </Link>
      </>
    );
  }

  const own = obligations.filter((o) => o.partnerId === partner.id);
  const hasContract = Boolean(partner.contratDebut && partner.contratFin);
  const left = hasContract ? daysBetween(today, partner.contratFin) : null;
  const elapsed = hasContract
    ? Math.min(1, Math.max(0, daysBetween(partner.contratDebut, today) / Math.max(1, daysBetween(partner.contratDebut, partner.contratFin))))
    : null;
  const toggle = (obId) =>
    setOpen((s) => {
      const next = new Set(s);
      if (next.has(obId)) next.delete(obId);
      else next.add(obId);
      return next;
    });

  return (
    <>
      <Link to="/app/communication/partenaires" className="com-link">
        {tr("← Tous les partenaires", "← All partners")}
      </Link>
      <ComPageHeader
        title={partner.nom}
        description={`${partner.niveau ? `${partner.niveau} · ` : ""}${contractText(partner, lang)}${
          elapsed !== null ? tr(` · ${Math.round(elapsed * 100)} % de la période écoulée`, ` · ${Math.round(elapsed * 100)}% of the period elapsed`) : ""
        }`}
        actions={
          <>
            <button type="button" className="button button--secondary button--small" onClick={() => setEditingDetails(true)}>
              {tr("Infos et contrat", "Details and contract")}
            </button>
            <button type="button" className="button button--secondary button--small" onClick={() => setBilan(true)}>
              {tr("Bilan partenaire", "Partner report")}
            </button>
            <button type="button" className="button button--primary button--small" onClick={() => setEditingOb("new")}>
              {tr("+ Contrepartie", "+ Benefit")}
            </button>
          </>
        }
      />

      <div className="com-row com-muted">
        {partner.handle ? (
          <span>
            {tr("Compte à mentionner : ", "Account to tag: ")}
            {partner.handle}
          </span>
        ) : (
          <span>{tr("Aucun compte à mentionner saisi.", "No account to tag entered.")}</span>
        )}
        {partner.contact ? (
          <span>
            {tr("· Contact : ", "· Contact: ")}
            {partner.contact}
          </span>
        ) : null}
        {partner.contratLien ? (
          <a href={partner.contratLien} target="_blank" rel="noreferrer" className="com-link">
            {tr("· Contrat signé ↗", "· Signed contract ↗")}
          </a>
        ) : null}
        {partner.website ? (
          <a href={partner.website} target="_blank" rel="noreferrer" className="com-link">
            {tr("· Site ↗", "· Website ↗")}
          </a>
        ) : null}
      </div>
      {partner.notes ? <p className="com-empty">{partner.notes}</p> : null}

      {!hasContract ? (
        <p className="com-empty">
          <strong>{tr("Dates du contrat manquantes :", "Contract dates missing:")}</strong>{" "}
          {tr(
            "sans elles, le rythme attendu des contreparties n'est pas calculé. Renseigne-les dans « Infos et contrat ».",
            "without them, the expected pace of benefits can't be calculated. Add them in “Details and contract”.",
          )}
        </p>
      ) : left >= 0 && left <= 60 ? (
        <p className="com-empty" style={{ background: "#fff8e6", borderColor: "#f4c35a" }}>
          <strong>{tr("Contrat à renouveler :", "Contract to renew:")}</strong>{" "}
          {tr(
            `il se termine dans ${days(left, lang)}. Le bilan partenaire aide à préparer le rendez-vous.`,
            `it ends in ${days(left, lang)}. The partner report helps you prepare the meeting.`,
          )}
        </p>
      ) : null}

      {!own.length ? (
        <p className="com-empty" style={{ textAlign: "center" }}>
          {tr("Aucune contrepartie saisie. Ajoute celles prévues au contrat avec « + Contrepartie ».", "No benefits entered. Add the ones in the contract with “+ Benefit”.")}
        </p>
      ) : (
        PARTNER_CATEGORIES.map((cat) => {
          const list = own.filter((o) => o.categorie === cat);
          if (!list.length) return null;
          return (
            <section key={cat} className="com-stack" style={{ gap: 8 }}>
              <h2 className="com-section-title">{pick(PARTNER_CATEGORY_LABELS[cat], lang)}</h2>
              {list.map((o) => (
                <ObligationCard
                  key={o.id}
                  ob={o}
                  progress={obligationProgress(partner, o, ctx)}
                  rubriques={rubriques}
                  today={today}
                  open={open.has(o.id)}
                  onToggle={() => toggle(o.id)}
                  onUpdate={(patch) => run(() => updateObligation(o.id, patch))}
                  onEdit={() => setEditingOb(o)}
                />
              ))}
            </section>
          );
        })
      )}

      {editingDetails ? (
        <PartnerDetailsDialog
          partner={partner}
          onClose={() => setEditingDetails(false)}
          onSave={async (data) => {
            await run(() => savePartnerDetails(partner.id, data), tr("Infos du partenaire enregistrées", "Partner details saved"));
            setEditingDetails(false);
          }}
        />
      ) : null}

      {editingOb ? (
        <ObligationDialog
          partnerId={partner.id}
          obligation={editingOb === "new" ? null : editingOb}
          rubriques={rubriques}
          onClose={() => setEditingOb(null)}
          onSave={async (data) => {
            if (editingOb === "new") await run(() => createObligation(data), tr("Contrepartie ajoutée", "Benefit added"));
            else await run(() => updateObligation(editingOb.id, data), tr("Contrepartie mise à jour", "Benefit updated"));
            setEditingOb(null);
          }}
          onDelete={
            editingOb === "new"
              ? undefined
              : async () => {
                  await run(() => deleteObligation(editingOb.id), tr("Contrepartie supprimée", "Benefit deleted"));
                  setEditingOb(null);
                }
          }
        />
      ) : null}

      {bilan ? <BilanDialog partner={partner} obligations={own} ctx={ctx} onClose={() => setBilan(false)} /> : null}
      <Toast message={toast} />
    </>
  );
}

// Infos réservées à l'organisation (com_partner_details), jamais publiées sur le site.
function PartnerDetailsDialog({ partner, onClose, onSave }) {
  const { tr } = useComLang();
  const [form, setForm] = useState({
    handle: partner.handle,
    contact: partner.contact,
    notes: partner.notes,
    contratDebut: partner.contratDebut,
    contratFin: partner.contratFin,
    contratLien: partner.contratLien,
  });
  const [saving, setSaving] = useState(false);
  const endBeforeStart = Boolean(form.contratDebut && form.contratFin && form.contratFin < form.contratDebut);

  async function handleSubmit(event) {
    event.preventDefault();
    if (endBeforeStart) return;
    setSaving(true);
    try {
      await onSave(Object.fromEntries(Object.entries(form).map(([key, value]) => [key, String(value || "").trim()])));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog title={tr(`Infos et contrat · ${partner.nom}`, `Details and contract · ${partner.nom}`)} onClose={onClose} wide>
      <form className="com-stack" onSubmit={handleSubmit}>
        <p className="com-muted">{tr("Ces informations restent internes : elles ne sont jamais affichées sur le site.", "This information stays internal: it is never shown on the website.")}</p>
        <div className="com-grid-2">
          <label className="com-field">
            {tr("Compte à mentionner (@…)", "Account to tag (@…)")}
            <input className="com-input" placeholder={tr("@partenaire", "@partner")} value={form.handle} onChange={(e) => setForm({ ...form, handle: e.target.value })} />
          </label>
          <label className="com-field">
            {tr("Contact", "Contact")}
            <input className="com-input" placeholder={tr("Nom, e-mail, téléphone", "Name, email, phone")} value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} />
          </label>
          <label className="com-field">
            {tr("Début du contrat", "Contract start")}
            <input type="date" className="com-input" value={form.contratDebut} onChange={(e) => setForm({ ...form, contratDebut: e.target.value })} />
          </label>
          <label className="com-field">
            {tr("Fin du contrat", "Contract end")}
            <input type="date" className="com-input" value={form.contratFin} onChange={(e) => setForm({ ...form, contratFin: e.target.value })} />
          </label>
        </div>
        {endBeforeStart ? <p className="com-error">{tr("La fin du contrat doit être après son début.", "The contract end must be after its start.")}</p> : null}
        <label className="com-field">
          {tr("Lien vers le contrat signé", "Link to the signed contract")}
          <input type="url" className="com-input" placeholder="https://… (OneDrive, Drive)" value={form.contratLien} onChange={(e) => setForm({ ...form, contratLien: e.target.value })} />
        </label>
        <label className="com-field">
          {tr("Notes", "Notes")}
          <textarea className="com-input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </label>
        <p className="com-muted" style={{ fontSize: "0.78rem" }}>
          {tr("Le nom, le logo, le site et la catégorie se modifient dans Site web → Partenaires.", "Name, logo, website and category are edited in Website → Partners.")}
        </p>
        <div className="com-row" style={{ justifyContent: "flex-end" }}>
          <button type="button" className="com-btn-ghost" onClick={onClose}>
            {tr("Annuler", "Cancel")}
          </button>
          <button type="submit" className="button button--primary button--small" disabled={saving}>
            {saving ? tr("Enregistrement…", "Saving…") : tr("Enregistrer", "Save")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function ObligationCard({ ob, progress: g, rubriques, today, open, onToggle, onUpdate, onEdit }) {
  const { lang, tr } = useComLang();
  const pct = g.cible ? Math.min(1, g.fait / g.cible) : 0;
  const rubrique = ob.rubriqueId ? rubriques.find((r) => r.id === ob.rubriqueId) : undefined;
  const rubriqueRule = rubrique ? (lang === "fr" ? ruleLabel(rubrique.rule, lang).toLowerCase() : ruleLabel(rubrique.rule, lang)) : "";

  return (
    <div className={`com-ob-card ${g.statut}`}>
      <button type="button" onClick={onToggle} aria-expanded={open} className="com-btn-ghost" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 160px auto", gap: 12, alignItems: "center", textAlign: "left", color: "inherit", padding: 0 }}>
        <span className="com-stack" style={{ gap: 2 }}>
          <b>{ob.libelle}</b>
          <span className="com-muted" style={{ fontSize: "0.75rem" }}>
            {pick(OBLIGATION_MODE_LABELS[ob.mode].label, lang)}
          </span>
        </span>
        <span className="com-stack" style={{ gap: 4, fontSize: "0.75rem" }}>
          <span>
            {progressText(ob, g, lang)}
            {g.attendu !== null && ob.mode !== "livrable" && g.cible ? tr(` · attendu ${g.attendu}`, ` · expected ${g.attendu}`) : ""}
          </span>
          <span className="com-progress">
            <span style={{ width: `${pct * 100}%` }} />
          </span>
        </span>
        <ObligationStatusPill statut={g.statut} />
      </button>

      {open ? (
        <div className="com-stack" style={{ gap: 10, fontSize: "0.9rem" }}>
          {ob.mode === "publications" ? (
            <>
              {ob.dejaRealise > 0 ? (
                <p className="com-muted">
                  {tr(
                    `${ob.dejaRealise} publication(s) réalisée(s) avant l'outil.`,
                    `${ob.dejaRealise} publication${ob.dejaRealise > 1 ? "s" : ""} done before this tool.`,
                  )}
                </p>
              ) : null}
              {g.publications.length ? (
                <ul className="com-ob-items">
                  {g.publications.map((p) => (
                    <li key={p.id}>
                      <span className="com-mini__date">{fmtShort(p.date, lang)}</span>
                      <Link to={`/app/communication/publication/${p.id}`} className="com-chip__title" style={{ color: "inherit" }}>
                        {p.titre}
                      </Link>
                      <StatusPill statut={p.statut} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="com-muted">
                  {tr(
                    "Aucune publication ne mentionne encore ce partenaire. Coche-le dans une publication du calendrier.",
                    "No publication mentions this partner yet. Tick it in a calendar publication.",
                  )}
                </p>
              )}
            </>
          ) : null}

          {ob.mode === "rubrique" ? (
            <p className="com-muted">
              {rubrique ? (
                lang === "fr" ? (
                  <>
                    Compté automatiquement : chaque occurrence publiée de <strong>{rubrique.titre}</strong> ({rubriqueRule}) pendant le contrat. {g.prevus} à venir.
                  </>
                ) : (
                  <>
                    Counted automatically: each published occurrence of <strong>{rubrique.titre}</strong> ({rubriqueRule}) during the contract. {g.prevus} upcoming.
                  </>
                )
              ) : (
                tr(
                  "La rubrique suivie n'existe plus : modifie la contrepartie pour en choisir une autre.",
                  "The tracked recurring series no longer exists: edit the benefit to pick another one.",
                )
              )}
            </p>
          ) : null}

          {ob.mode === "evenements" ? (
            <>
              {ob.items
                .slice()
                .sort((a, b) => String(a.date).localeCompare(String(b.date)))
                .map((item) => (
                  <div key={item.id} className="com-row">
                    <input
                      type="checkbox"
                      aria-label={tr(`${item.label} réalisé`, `${item.label} done`)}
                      checked={item.fait}
                      onChange={(e) => onUpdate({ items: ob.items.map((x) => (x.id === item.id ? { ...x, fait: e.target.checked } : x)) })}
                    />
                    <span className="com-mini__date">{item.date ? fmtShort(item.date, lang) : "—"}</span>
                    <span>
                      {item.label}
                      {!item.fait && item.date && item.date < today ? <strong style={{ color: "#9f2020", marginLeft: 8 }}>{tr("Manqué", "Missed")}</strong> : null}
                    </span>
                    {item.fait ? (
                      <input
                        aria-label={tr("Preuve", "Proof")}
                        className="com-input is-auto"
                        placeholder={tr("Preuve : lien photo, remarque…", "Proof: photo link, note…")}
                        defaultValue={item.preuve}
                        onBlur={(e) => e.currentTarget.value !== item.preuve && onUpdate({ items: ob.items.map((x) => (x.id === item.id ? { ...x, preuve: e.currentTarget.value } : x)) })}
                      />
                    ) : null}
                  </div>
                ))}
              {g.cible > ob.items.length ? (
                <p className="com-muted">
                  {tr(
                    `${g.cible - ob.items.length} événement(s) encore à choisir avec le partenaire.`,
                    `${g.cible - ob.items.length} event${g.cible - ob.items.length > 1 ? "s" : ""} still to choose with the partner.`,
                  )}
                </p>
              ) : null}
            </>
          ) : null}

          {ob.mode === "livrable" ? (
            <>
              <p className="com-muted">{ob.echeance ? tr(`Échéance : ${fmtLong(ob.echeance, lang)}`, `Deadline: ${fmtLong(ob.echeance, lang)}`) : tr("Pas d'échéance définie.", "No deadline set.")}</p>
              <div className="com-steps">
                {LIVRABLE_ETAPES.map((etape, k) => (
                  <button key={etape.fr} type="button" className={`com-toggle ${k <= ob.etape ? "is-on" : ""}`} onClick={() => onUpdate({ etape: k })}>
                    {pick(etape, lang)}
                  </button>
                ))}
              </div>
            </>
          ) : null}

          {ob.mode === "quantite" ? (
            <div className="com-row">
              <button type="button" className="button button--secondary button--small" aria-label={tr("Retirer", "Remove")} onClick={() => onUpdate({ fait: Math.max(0, ob.fait - 1) })}>
                −
              </button>
              <strong style={{ fontSize: "1.1rem" }}>
                {ob.fait} / {ob.cible}
              </strong>
              <button type="button" className="button button--secondary button--small" aria-label={tr("Ajouter", "Add")} onClick={() => onUpdate({ fait: ob.fait + 1 })}>
                +
              </button>
            </div>
          ) : null}

          <button type="button" className="com-btn-ghost" style={{ alignSelf: "flex-start" }} onClick={onEdit}>
            {tr("Modifier la contrepartie", "Edit benefit")}
          </button>
        </div>
      ) : null}
    </div>
  );
}

const newItemId = () => Math.random().toString(36).slice(2, 10);

function ObligationDialog({ partnerId, obligation, rubriques, onClose, onSave, onDelete }) {
  const { lang, tr } = useComLang();
  const [form, setForm] = useState(
    obligation
      ? {
          partnerId: obligation.partnerId,
          categorie: obligation.categorie,
          libelle: obligation.libelle,
          mode: obligation.mode,
          cible: obligation.cible,
          rubriqueId: obligation.rubriqueId,
          items: obligation.items,
          echeance: obligation.echeance,
          etape: obligation.etape,
          fait: obligation.fait,
          dejaRealise: obligation.dejaRealise,
        }
      : { partnerId, categorie: "social", libelle: "", mode: "publications", cible: 1, rubriqueId: null, items: [], echeance: null, etape: 0, fait: 0, dejaRealise: 0 },
  );
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  const setItem = (id, patch) => set("items", form.items.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  const missingRubrique = form.mode === "rubrique" && !form.rubriqueId;

  async function handleSubmit(e) {
    e.preventDefault();
    if (missingRubrique) return;
    setSaving(true);
    try {
      await onSave({
        ...form,
        libelle: form.libelle.trim(),
        cible: Math.max(0, Math.round(Number(form.cible) || 0)),
        items: form.items.filter((i) => i.label.trim()).map((i) => ({ ...i, label: i.label.trim() })),
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog title={obligation ? tr("Modifier la contrepartie", "Edit benefit") : tr("Nouvelle contrepartie", "New benefit")} onClose={onClose} wide>
      <form className="com-stack" onSubmit={handleSubmit}>
        <label className="com-field">
          {tr("Contrepartie prévue au contrat", "Benefit promised in the contract")}
          <input
            className="com-input"
            required
            autoFocus
            placeholder={tr("Ex. 6 publications avec mention du partenaire", "E.g. 6 publications mentioning the partner")}
            value={form.libelle}
            onChange={(e) => set("libelle", e.target.value)}
          />
        </label>
        <div className="com-grid-2">
          <label className="com-field">
            {tr("Catégorie", "Category")}
            <select
              className="com-input"
              value={form.categorie}
              onChange={(e) => {
                const categorie = e.target.value;
                setForm((f) => ({ ...f, categorie, mode: obligation ? f.mode : DEFAULT_MODE_BY_CATEGORY[categorie] }));
              }}
            >
              {PARTNER_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {pick(PARTNER_CATEGORY_LABELS[c], lang)}
                </option>
              ))}
            </select>
          </label>
          <label className="com-field">
            {tr("Suivi", "Tracking")}
            <select className="com-input" value={form.mode} onChange={(e) => set("mode", e.target.value)}>
              {OBLIGATION_MODES.map((m) => (
                <option key={m} value={m}>
                  {pick(OBLIGATION_MODE_LABELS[m].label, lang)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="com-empty" style={{ background: "#f4f8fb" }}>
          {pick(OBLIGATION_MODE_LABELS[form.mode].help, lang)}
        </p>

        {["publications", "quantite", "evenements"].includes(form.mode) ? (
          <div className="com-grid-2">
            <label className="com-field">
              {tr("Objectif sur la durée du contrat", "Target over the contract period")}
              <input type="number" min={0} className="com-input" value={form.cible} onChange={(e) => set("cible", Number(e.target.value))} />
            </label>
            {form.mode === "publications" ? (
              <label className="com-field">
                {tr("Déjà réalisées avant l'outil", "Already done before this tool")}
                <input type="number" min={0} className="com-input" value={form.dejaRealise} onChange={(e) => set("dejaRealise", Math.max(0, Number(e.target.value)))} />
              </label>
            ) : null}
            {form.mode === "quantite" ? (
              <label className="com-field">
                {tr("Déjà réalisé", "Already done")}
                <input type="number" min={0} className="com-input" value={form.fait} onChange={(e) => set("fait", Math.max(0, Number(e.target.value)))} />
              </label>
            ) : null}
          </div>
        ) : null}

        {form.mode === "rubrique" ? (
          <label className="com-field">
            {tr("Rubrique récurrente suivie", "Tracked recurring series")}
            <select className="com-input" value={form.rubriqueId || ""} onChange={(e) => set("rubriqueId", e.target.value || null)}>
              <option value="">{tr("Choisir une rubrique", "Choose a recurring series")}</option>
              {rubriques.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.titre}
                </option>
              ))}
            </select>
            {missingRubrique ? <span className="com-error">{tr("Choisis la rubrique à compter.", "Choose the recurring series to count.")}</span> : null}
          </label>
        ) : null}

        {form.mode === "livrable" ? (
          <label className="com-field">
            {tr("Échéance", "Deadline")}
            <input type="date" className="com-input" value={form.echeance || ""} onChange={(e) => set("echeance", e.target.value || null)} />
          </label>
        ) : null}

        {form.mode === "evenements" ? (
          <div className="com-field">
            {tr("Événements concernés", "Events covered")}
            {form.items.map((item) => (
              <div key={item.id} className="com-row" style={{ flexWrap: "nowrap" }}>
                <input
                  aria-label={tr("Événement", "Event")}
                  className="com-input"
                  placeholder={tr("Ex. Banderole jour J", "E.g. Banner on meet day")}
                  value={item.label}
                  onChange={(e) => setItem(item.id, { label: e.target.value })}
                />
                <input aria-label={tr("Date", "Date")} type="date" className="com-input is-auto" value={item.date} onChange={(e) => setItem(item.id, { date: e.target.value })} />
                <button type="button" className="com-btn-ghost" aria-label={tr("Retirer", "Remove")} onClick={() => set("items", form.items.filter((i) => i.id !== item.id))}>
                  ✕
                </button>
              </div>
            ))}
            <button
              type="button"
              className="button button--secondary button--small"
              style={{ alignSelf: "flex-start" }}
              onClick={() => set("items", [...form.items, { id: newItemId(), label: "", date: "", fait: false, preuve: "" }])}
            >
              {tr("+ Ajouter un événement", "+ Add an event")}
            </button>
          </div>
        ) : null}

        <div className="com-row" style={{ justifyContent: "space-between" }}>
          {onDelete ? (
            confirmDelete ? (
              <span className="com-row">
                {tr("Supprimer cette contrepartie ?", "Delete this benefit?")}
                <button type="button" className="button button--danger-soft button--small" onClick={onDelete}>
                  {tr("Confirmer", "Confirm")}
                </button>
                <button type="button" className="com-btn-ghost" onClick={() => setConfirmDelete(false)}>
                  {tr("Garder", "Keep")}
                </button>
              </span>
            ) : (
              <button type="button" className="button button--danger-soft button--small" onClick={() => setConfirmDelete(true)}>
                {tr("Supprimer", "Delete")}
              </button>
            )
          ) : (
            <span />
          )}
          <div className="com-row">
            <button type="button" className="com-btn-ghost" onClick={onClose}>
              {tr("Annuler", "Cancel")}
            </button>
            <button type="submit" className="button button--primary button--small" disabled={saving}>
              {saving ? tr("Enregistrement…", "Saving…") : tr("Enregistrer", "Save")}
            </button>
          </div>
        </div>
      </form>
    </Dialog>
  );
}

// Récapitulatif des réalisations, à présenter au partenaire.
function BilanDialog({ partner, obligations, ctx, onClose }) {
  const { lang, tr } = useComLang();
  return (
    <Dialog title={tr(`Bilan · ${partner.nom}`, `Report · ${partner.nom}`)} onClose={onClose} wide>
      <p className="com-muted">
        {contractText(partner, lang)} · {tr(`état au ${fmtLong(ctx.today, lang)}`, `status as of ${fmtLong(ctx.today, lang)}`)}
      </p>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>{tr("Contrepartie", "Benefit")}</th>
              <th>{tr("Réalisé", "Done")}</th>
              <th>{tr("Statut", "Status")}</th>
            </tr>
          </thead>
          <tbody>
            {[...obligations]
              .sort((a, b) => PARTNER_CATEGORIES.indexOf(a.categorie) - PARTNER_CATEGORIES.indexOf(b.categorie))
              .map((o) => {
                const g = obligationProgress(partner, o, ctx);
                const sep = lang === "fr" ? " : " : ": ";
                const details =
                  o.mode === "publications"
                    ? g.publications.filter((p) => p.statut === "done").map((p) => `${fmtShort(p.date, lang)}${sep}${p.titre}`)
                    : o.mode === "evenements"
                      ? o.items.filter((i) => i.fait).map((i) => `${i.date ? fmtShort(i.date, lang) : "—"}${sep}${i.label}${i.preuve ? ` (${i.preuve})` : ""}`)
                      : [];
                return (
                  <tr key={o.id}>
                    <td>
                      <strong>{o.libelle}</strong>
                      {details.length ? (
                        <span className="com-muted" style={{ display: "block", fontSize: "0.75rem" }}>
                          {details.join(" · ")}
                        </span>
                      ) : null}
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>{progressText(o, g, lang)}</td>
                    <td>
                      <ObligationStatusPill statut={g.statut} />
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
      <BilanVisibility partner={partner} obligations={obligations} ctx={ctx} />
      <div className="com-row" style={{ justifyContent: "flex-end" }}>
        <button type="button" className="button button--secondary button--small" onClick={onClose}>
          {tr("Fermer", "Close")}
        </button>
      </div>
    </Dialog>
  );
}

const statValue = (stats, name) => Number(stats.find(([n]) => n === name)?.[1]) || 0;
const sumStats = (stats, names) => names.reduce((acc, name) => acc + statValue(stats, name), 0);
const sumOf = (rows, key) => rows.reduce((acc, r) => acc + (r[key] || 0), 0);

// Toutes les publications publiées qui mentionnent le partenaire, avec leurs
// statistiques Facebook / Instagram, qu'elles comptent ou non pour une contrepartie.
function BilanVisibility({ partner, obligations, ctx }) {
  const pubs = ctx.partnerPublications
    .filter((p) => !p.annulee && p.statut === "done" && p.partnerIds.includes(partner.id))
    .sort((a, b) => a.date.localeCompare(b.date));
  const facebook = useSocialPosts("facebook", pubs.some((p) => p.facebookPostId));
  const instagram = useSocialPosts("instagram", pubs.some((p) => p.instagramMediaId));
  const loading = facebook.status === "loading" || instagram.status === "loading";

  // Même règle que le mode « Automatique · publications » de obligationProgress.
  const inContract = (p) => (!partner.contratDebut || p.date >= partner.contratDebut) && (!partner.contratFin || p.date <= partner.contratFin);
  const counted = (p) => inContract(p) && obligations.some((o) => o.mode === "publications" && (o.categorie !== "newsletter" || p.type === "newsletter"));

  const rows = pubs.map((p) => {
    const fb = p.facebookPostId ? facebook.posts.find((x) => x.id === p.facebookPostId) : undefined;
    const ig = p.instagramMediaId ? instagram.posts.find((x) => x.id === p.instagramMediaId) : undefined;
    const fbStats = fb ? facebookStats(fb) : [];
    const igStats = ig ? instagramStats(ig) : [];
    const hasStats = Boolean(fb || ig);
    return {
      p,
      fb,
      ig,
      counted: counted(p),
      missingStats: Boolean((p.facebookPostId && !fb) || (p.instagramMediaId && !ig)),
      vues: hasStats ? statValue(fbStats, "vues") + statValue(igStats, "vues") : null,
      touches: hasStats ? statValue(fbStats, "personnes touchées") + statValue(igStats, "comptes touchés") : null,
      interactions: hasStats
        ? sumStats(fbStats, ["réactions", "commentaires", "partages", "clics"]) + sumStats(igStats, ["j'aime", "commentaires", "partages", "enregistrements"])
        : null,
    };
  });

  return (
    <section className="com-stack" style={{ gap: 8 }}>
      <h2 className="com-section-title" style={{ margin: 0 }}>
        Visibilité : toutes les publications qui mentionnent {partner.nom}
      </h2>
      {!rows.length ? (
        <p className="com-muted">Aucune publication publiée ne mentionne ce partenaire.</p>
      ) : (
        <>
          <div className="com-stat-grid">
            {[
              ["publications", rows.length],
              ["hors contreparties", rows.filter((r) => !r.counted).length],
              ["vues", sumOf(rows, "vues")],
              ["personnes touchées", sumOf(rows, "touches")],
              ["interactions", sumOf(rows, "interactions")],
            ].map(([name, value]) => (
              <span key={name}>
                <b>{formatCount(value)}</b>
                <small>{name}</small>
              </span>
            ))}
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Publication</th>
                  <th>Vues</th>
                  <th>Touchés</th>
                  <th>Interactions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.p.id}>
                    <td>
                      <strong>{r.p.titre || "Sans titre"}</strong>
                      {!r.counted ? (
                        <span className="com-badge com-badge--info" style={{ marginLeft: 6 }}>
                          {inContract(r.p) ? "Hors contreparties" : "Hors contrat"}
                        </span>
                      ) : null}
                      <span className="com-muted" style={{ display: "block", fontSize: "0.75rem" }}>
                        {fullDate(r.p.date)} · {PUB_TYPE_LABELS[r.p.type]}
                        {r.p.canaux.length ? ` · ${r.p.canaux.map((c) => CANAL_LABELS[c].label).join(", ")}` : ""}
                        {r.fb?.permalinkUrl ? (
                          <>
                            {" · "}
                            <a href={r.fb.permalinkUrl} target="_blank" rel="noreferrer" className="com-link">
                              Facebook ↗
                            </a>
                          </>
                        ) : null}
                        {r.ig?.permalinkUrl ? (
                          <>
                            {" · "}
                            <a href={r.ig.permalinkUrl} target="_blank" rel="noreferrer" className="com-link">
                              Instagram ↗
                            </a>
                          </>
                        ) : null}
                        {r.missingStats && !loading ? " · statistiques indisponibles" : ""}
                      </span>
                    </td>
                    <td>{formatCount(r.vues)}</td>
                    <td>{formatCount(r.touches)}</td>
                    <td>{formatCount(r.interactions)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="com-muted" style={{ fontSize: "0.75rem", margin: 0 }}>
            {loading ? "Chargement des statistiques… " : ""}
            Statistiques des posts Facebook et Instagram reliés aux publications, additionnées : une même personne touchée sur les deux réseaux compte deux fois.
          </p>
        </>
      )}
    </section>
  );
}
