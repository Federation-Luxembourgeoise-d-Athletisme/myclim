// Partenaires et contreparties (porté de myFLA : app/communication/partenaires/*,
// obligation-card.tsx, obligation-dialog.tsx, partner-dialog.tsx, use-partner-data.ts).
// Les partenaires viennent des sponsors du site (Site web → Partenaires) : ici on
// ajoute seulement leurs infos privées et leurs contreparties.
import { useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { createObligation, deleteObligation, savePartnerDetails, updateObligation } from "./com-actions.js";
import { useComPartners, useObligations, usePartnerPublications, useRubriquePublications, useRubriques } from "./com-data.js";
import { addDays, daysBetween, fmtLong, fmtShort, parseYmd, todayYmd, ymd } from "./com-dates.js";
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
import { ComPageHeader, Dialog, StatusPill, Toast } from "./com-ui.jsx";
import { useToast } from "./com-ui-helpers.js";

const STATUT_TONE = { late: "danger", risk: "warn", ontrack: "info", done: "ok" };

export function ObligationStatusPill({ statut }) {
  return <span className={`com-badge com-badge--${STATUT_TONE[statut]}`}>{OBLIGATION_STATUT_LABELS[statut]}</span>;
}

const fullDate = (value) => (value ? `${fmtShort(value)} ${value.slice(0, 4)}` : "");
const contractText = (partner) =>
  partner.contratDebut && partner.contratFin ? `contrat du ${fullDate(partner.contratDebut)} au ${fullDate(partner.contratFin)}` : "dates du contrat à saisir";

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
      .map(({ partner, o }) => ({ partner, date: o.echeance, text: `${o.libelle} (${LIVRABLE_ETAPES[o.etape]?.toLowerCase()})` })),
  ].sort((a, b) => a.date.localeCompare(b.date));

  // Partenaires regroupés par catégorie de sponsor du site.
  const groups = [...new Set(partners.map((p) => p.niveau || "Autres partenaires"))].map((title) => ({
    title,
    list: partners.filter((p) => (p.niveau || "Autres partenaires") === title),
  }));

  const tiles = [
    { value: late.length, label: "contreparties en retard", tone: "is-late" },
    { value: risk.length, label: "contreparties à risque", tone: "is-risk" },
    { value: renew.length, label: "contrats à renouveler (moins de 60 jours)", tone: "" },
    { value: partners.length, label: "partenaires", tone: "" },
  ];

  return (
    <>
      <ComPageHeader
        title="Partenaires"
        description="Contreparties prévues aux contrats et leur avancement. Les publications du calendrier qui mentionnent un partenaire sont comptées automatiquement."
        actions={
          <Link to="/app/website/sponsors" className="button button--secondary button--small">
            Gérer la liste des partenaires (site web)
          </Link>
        }
      />

      {!loading && !partners.length ? (
        <p className="com-empty" style={{ textAlign: "center" }}>
          Aucun partenaire pour l'instant. Ajoute-les dans Site web → Partenaires : ils apparaîtront ici automatiquement.
        </p>
      ) : (
        <>
          <div className="com-tiles">
            {tiles.map((t) => (
              <div key={t.label} className={`com-tile ${t.tone}`}>
                <strong>{t.value}</strong>
                <span>{t.label}</span>
              </div>
            ))}
          </div>

          <section className="com-stack" style={{ gap: 8 }}>
            <h2 className="com-section-title">À traiter en priorité</h2>
            <div className="com-list">
              {![...late, ...risk].length ? (
                <p className="com-muted" style={{ padding: 20, textAlign: "center" }}>
                  Toutes les contreparties sont dans les temps.
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
                        {partner.nom} · {progressText(o, g)}
                        {g.attendu !== null && o.mode !== "livrable" ? ` · attendu à ce jour : ${g.attendu}` : ""}
                        {g.prevus ? ` · ${g.prevus} prévu(s)` : ""}
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
              <h2 className="com-section-title">Prochaines échéances · 45 jours</h2>
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
                    <strong>{fmtShort(u.date)}</strong>
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
                            {contractText(p)}
                            {p.active ? "" : " · masqué sur le site"}
                          </span>
                        </span>
                      </span>
                      <span className="com-stack" style={{ gap: 4 }}>
                        <span className="com-muted" style={{ fontSize: "0.75rem" }}>
                          {Math.round(pct * 100)} % des contreparties réalisées
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
                            Aucune contrepartie saisie.
                          </span>
                        ) : null}
                      </span>
                      {left !== null && left >= 0 && left <= 60 ? (
                        <span className="com-badge com-badge--warn">Contrat à renouveler : fin dans {left} jours</span>
                      ) : left !== null && left < 0 ? (
                        <span className="com-badge com-badge--info">Contrat terminé</span>
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
      setToast("L'enregistrement a échoué. Réessaie.");
    }
  }

  if (loading) return <p className="com-muted">Chargement…</p>;
  if (!partner) {
    return (
      <>
        <ComPageHeader title="Partenaire introuvable" description="Il a peut-être été supprimé de la liste des partenaires du site." />
        <Link to="/app/communication/partenaires" className="com-link">
          ← Tous les partenaires
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
        ← Tous les partenaires
      </Link>
      <ComPageHeader
        title={partner.nom}
        description={`${partner.niveau ? `${partner.niveau} · ` : ""}${contractText(partner)}${elapsed !== null ? ` · ${Math.round(elapsed * 100)} % de la période écoulée` : ""}`}
        actions={
          <>
            <button type="button" className="button button--secondary button--small" onClick={() => setEditingDetails(true)}>
              Infos et contrat
            </button>
            <button type="button" className="button button--secondary button--small" onClick={() => setBilan(true)}>
              Bilan partenaire
            </button>
            <button type="button" className="button button--primary button--small" onClick={() => setEditingOb("new")}>
              + Contrepartie
            </button>
          </>
        }
      />

      <div className="com-row com-muted">
        {partner.handle ? <span>Compte à mentionner : {partner.handle}</span> : <span>Aucun compte à mentionner saisi.</span>}
        {partner.contact ? <span>· Contact : {partner.contact}</span> : null}
        {partner.contratLien ? (
          <a href={partner.contratLien} target="_blank" rel="noreferrer" className="com-link">
            · Contrat signé ↗
          </a>
        ) : null}
        {partner.website ? (
          <a href={partner.website} target="_blank" rel="noreferrer" className="com-link">
            · Site ↗
          </a>
        ) : null}
      </div>
      {partner.notes ? <p className="com-empty">{partner.notes}</p> : null}

      {!hasContract ? (
        <p className="com-empty">
          <strong>Dates du contrat manquantes :</strong> sans elles, le rythme attendu des contreparties n'est pas calculé. Renseigne-les dans « Infos et contrat ».
        </p>
      ) : left >= 0 && left <= 60 ? (
        <p className="com-empty" style={{ background: "#fff8e6", borderColor: "#f4c35a" }}>
          <strong>Contrat à renouveler :</strong> il se termine dans {left} jours. Le bilan partenaire aide à préparer le rendez-vous.
        </p>
      ) : null}

      {!own.length ? (
        <p className="com-empty" style={{ textAlign: "center" }}>
          Aucune contrepartie saisie. Ajoute celles prévues au contrat avec « + Contrepartie ».
        </p>
      ) : (
        PARTNER_CATEGORIES.map((cat) => {
          const list = own.filter((o) => o.categorie === cat);
          if (!list.length) return null;
          return (
            <section key={cat} className="com-stack" style={{ gap: 8 }}>
              <h2 className="com-section-title">{PARTNER_CATEGORY_LABELS[cat]}</h2>
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
            await run(() => savePartnerDetails(partner.id, data), "Infos du partenaire enregistrées");
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
            if (editingOb === "new") await run(() => createObligation(data), "Contrepartie ajoutée");
            else await run(() => updateObligation(editingOb.id, data), "Contrepartie mise à jour");
            setEditingOb(null);
          }}
          onDelete={
            editingOb === "new"
              ? undefined
              : async () => {
                  await run(() => deleteObligation(editingOb.id), "Contrepartie supprimée");
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
    <Dialog title={`Infos et contrat · ${partner.nom}`} onClose={onClose} wide>
      <form className="com-stack" onSubmit={handleSubmit}>
        <p className="com-muted">Ces informations restent internes : elles ne sont jamais affichées sur le site.</p>
        <div className="com-grid-2">
          <label className="com-field">
            Compte à mentionner (@…)
            <input className="com-input" placeholder="@partenaire" value={form.handle} onChange={(e) => setForm({ ...form, handle: e.target.value })} />
          </label>
          <label className="com-field">
            Contact
            <input className="com-input" placeholder="Nom, e-mail, téléphone" value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} />
          </label>
          <label className="com-field">
            Début du contrat
            <input type="date" className="com-input" value={form.contratDebut} onChange={(e) => setForm({ ...form, contratDebut: e.target.value })} />
          </label>
          <label className="com-field">
            Fin du contrat
            <input type="date" className="com-input" value={form.contratFin} onChange={(e) => setForm({ ...form, contratFin: e.target.value })} />
          </label>
        </div>
        {endBeforeStart ? <p className="com-error">La fin du contrat doit être après son début.</p> : null}
        <label className="com-field">
          Lien vers le contrat signé
          <input type="url" className="com-input" placeholder="https://… (OneDrive, Drive)" value={form.contratLien} onChange={(e) => setForm({ ...form, contratLien: e.target.value })} />
        </label>
        <label className="com-field">
          Notes
          <textarea className="com-input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </label>
        <p className="com-muted" style={{ fontSize: "0.78rem" }}>
          Le nom, le logo, le site et la catégorie se modifient dans Site web → Partenaires.
        </p>
        <div className="com-row" style={{ justifyContent: "flex-end" }}>
          <button type="button" className="com-btn-ghost" onClick={onClose}>
            Annuler
          </button>
          <button type="submit" className="button button--primary button--small" disabled={saving}>
            {saving ? "Enregistrement…" : "Enregistrer"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function ObligationCard({ ob, progress: g, rubriques, today, open, onToggle, onUpdate, onEdit }) {
  const pct = g.cible ? Math.min(1, g.fait / g.cible) : 0;
  const rubrique = ob.rubriqueId ? rubriques.find((r) => r.id === ob.rubriqueId) : undefined;

  return (
    <div className={`com-ob-card ${g.statut}`}>
      <button type="button" onClick={onToggle} aria-expanded={open} className="com-btn-ghost" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 160px auto", gap: 12, alignItems: "center", textAlign: "left", color: "inherit", padding: 0 }}>
        <span className="com-stack" style={{ gap: 2 }}>
          <b>{ob.libelle}</b>
          <span className="com-muted" style={{ fontSize: "0.75rem" }}>
            {OBLIGATION_MODE_LABELS[ob.mode].label}
          </span>
        </span>
        <span className="com-stack" style={{ gap: 4, fontSize: "0.75rem" }}>
          <span>
            {progressText(ob, g)}
            {g.attendu !== null && ob.mode !== "livrable" && g.cible ? ` · attendu ${g.attendu}` : ""}
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
              {ob.dejaRealise > 0 ? <p className="com-muted">{ob.dejaRealise} publication(s) réalisée(s) avant l'outil.</p> : null}
              {g.publications.length ? (
                <ul className="com-ob-items">
                  {g.publications.map((p) => (
                    <li key={p.id}>
                      <span className="com-mini__date">{fmtShort(p.date)}</span>
                      <Link to={`/app/communication/publication/${p.id}`} className="com-chip__title" style={{ color: "inherit" }}>
                        {p.titre}
                      </Link>
                      <StatusPill statut={p.statut} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="com-muted">Aucune publication ne mentionne encore ce partenaire. Coche-le dans une publication du calendrier.</p>
              )}
            </>
          ) : null}

          {ob.mode === "rubrique" ? (
            <p className="com-muted">
              {rubrique ? (
                <>
                  Compté automatiquement : chaque occurrence publiée de <strong>{rubrique.titre}</strong> ({ruleLabel(rubrique.rule).toLowerCase()}) pendant le contrat. {g.prevus} à venir.
                </>
              ) : (
                "La rubrique suivie n'existe plus : modifie la contrepartie pour en choisir une autre."
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
                      aria-label={`${item.label} réalisé`}
                      checked={item.fait}
                      onChange={(e) => onUpdate({ items: ob.items.map((x) => (x.id === item.id ? { ...x, fait: e.target.checked } : x)) })}
                    />
                    <span className="com-mini__date">{item.date ? fmtShort(item.date) : "—"}</span>
                    <span>
                      {item.label}
                      {!item.fait && item.date && item.date < today ? <strong style={{ color: "#9f2020", marginLeft: 8 }}>Manqué</strong> : null}
                    </span>
                    {item.fait ? (
                      <input
                        aria-label="Preuve"
                        className="com-input is-auto"
                        placeholder="Preuve : lien photo, remarque…"
                        defaultValue={item.preuve}
                        onBlur={(e) => e.currentTarget.value !== item.preuve && onUpdate({ items: ob.items.map((x) => (x.id === item.id ? { ...x, preuve: e.currentTarget.value } : x)) })}
                      />
                    ) : null}
                  </div>
                ))}
              {g.cible > ob.items.length ? <p className="com-muted">{g.cible - ob.items.length} événement(s) encore à choisir avec le partenaire.</p> : null}
            </>
          ) : null}

          {ob.mode === "livrable" ? (
            <>
              <p className="com-muted">{ob.echeance ? `Échéance : ${fmtLong(ob.echeance)}` : "Pas d'échéance définie."}</p>
              <div className="com-steps">
                {LIVRABLE_ETAPES.map((etape, k) => (
                  <button key={etape} type="button" className={`com-toggle ${k <= ob.etape ? "is-on" : ""}`} onClick={() => onUpdate({ etape: k })}>
                    {etape}
                  </button>
                ))}
              </div>
            </>
          ) : null}

          {ob.mode === "quantite" ? (
            <div className="com-row">
              <button type="button" className="button button--secondary button--small" aria-label="Retirer" onClick={() => onUpdate({ fait: Math.max(0, ob.fait - 1) })}>
                −
              </button>
              <strong style={{ fontSize: "1.1rem" }}>
                {ob.fait} / {ob.cible}
              </strong>
              <button type="button" className="button button--secondary button--small" aria-label="Ajouter" onClick={() => onUpdate({ fait: ob.fait + 1 })}>
                +
              </button>
            </div>
          ) : null}

          <button type="button" className="com-btn-ghost" style={{ alignSelf: "flex-start" }} onClick={onEdit}>
            Modifier la contrepartie
          </button>
        </div>
      ) : null}
    </div>
  );
}

const newItemId = () => Math.random().toString(36).slice(2, 10);

function ObligationDialog({ partnerId, obligation, rubriques, onClose, onSave, onDelete }) {
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
    <Dialog title={obligation ? "Modifier la contrepartie" : "Nouvelle contrepartie"} onClose={onClose} wide>
      <form className="com-stack" onSubmit={handleSubmit}>
        <label className="com-field">
          Contrepartie prévue au contrat
          <input className="com-input" required autoFocus placeholder="Ex. 6 publications avec mention du partenaire" value={form.libelle} onChange={(e) => set("libelle", e.target.value)} />
        </label>
        <div className="com-grid-2">
          <label className="com-field">
            Catégorie
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
                  {PARTNER_CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
          </label>
          <label className="com-field">
            Suivi
            <select className="com-input" value={form.mode} onChange={(e) => set("mode", e.target.value)}>
              {OBLIGATION_MODES.map((m) => (
                <option key={m} value={m}>
                  {OBLIGATION_MODE_LABELS[m].label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="com-empty" style={{ background: "#f4f8fb" }}>
          {OBLIGATION_MODE_LABELS[form.mode].help}
        </p>

        {["publications", "quantite", "evenements"].includes(form.mode) ? (
          <div className="com-grid-2">
            <label className="com-field">
              Objectif sur la durée du contrat
              <input type="number" min={0} className="com-input" value={form.cible} onChange={(e) => set("cible", Number(e.target.value))} />
            </label>
            {form.mode === "publications" ? (
              <label className="com-field">
                Déjà réalisées avant l'outil
                <input type="number" min={0} className="com-input" value={form.dejaRealise} onChange={(e) => set("dejaRealise", Math.max(0, Number(e.target.value)))} />
              </label>
            ) : null}
            {form.mode === "quantite" ? (
              <label className="com-field">
                Déjà réalisé
                <input type="number" min={0} className="com-input" value={form.fait} onChange={(e) => set("fait", Math.max(0, Number(e.target.value)))} />
              </label>
            ) : null}
          </div>
        ) : null}

        {form.mode === "rubrique" ? (
          <label className="com-field">
            Rubrique récurrente suivie
            <select className="com-input" value={form.rubriqueId || ""} onChange={(e) => set("rubriqueId", e.target.value || null)}>
              <option value="">Choisir une rubrique</option>
              {rubriques.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.titre}
                </option>
              ))}
            </select>
            {missingRubrique ? <span className="com-error">Choisis la rubrique à compter.</span> : null}
          </label>
        ) : null}

        {form.mode === "livrable" ? (
          <label className="com-field">
            Échéance
            <input type="date" className="com-input" value={form.echeance || ""} onChange={(e) => set("echeance", e.target.value || null)} />
          </label>
        ) : null}

        {form.mode === "evenements" ? (
          <div className="com-field">
            Événements concernés
            {form.items.map((item) => (
              <div key={item.id} className="com-row" style={{ flexWrap: "nowrap" }}>
                <input aria-label="Événement" className="com-input" placeholder="Ex. Banderole jour J" value={item.label} onChange={(e) => setItem(item.id, { label: e.target.value })} />
                <input aria-label="Date" type="date" className="com-input is-auto" value={item.date} onChange={(e) => setItem(item.id, { date: e.target.value })} />
                <button type="button" className="com-btn-ghost" aria-label="Retirer" onClick={() => set("items", form.items.filter((i) => i.id !== item.id))}>
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
              + Ajouter un événement
            </button>
          </div>
        ) : null}

        <div className="com-row" style={{ justifyContent: "space-between" }}>
          {onDelete ? (
            confirmDelete ? (
              <span className="com-row">
                Supprimer cette contrepartie ?
                <button type="button" className="button button--danger-soft button--small" onClick={onDelete}>
                  Confirmer
                </button>
                <button type="button" className="com-btn-ghost" onClick={() => setConfirmDelete(false)}>
                  Garder
                </button>
              </span>
            ) : (
              <button type="button" className="button button--danger-soft button--small" onClick={() => setConfirmDelete(true)}>
                Supprimer
              </button>
            )
          ) : (
            <span />
          )}
          <div className="com-row">
            <button type="button" className="com-btn-ghost" onClick={onClose}>
              Annuler
            </button>
            <button type="submit" className="button button--primary button--small" disabled={saving}>
              {saving ? "Enregistrement…" : "Enregistrer"}
            </button>
          </div>
        </div>
      </form>
    </Dialog>
  );
}

// Récapitulatif des réalisations, à présenter au partenaire.
function BilanDialog({ partner, obligations, ctx, onClose }) {
  return (
    <Dialog title={`Bilan · ${partner.nom}`} onClose={onClose} wide>
      <p className="com-muted">
        {contractText(partner)} · état au {fmtLong(ctx.today)}
      </p>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Contrepartie</th>
              <th>Réalisé</th>
              <th>Statut</th>
            </tr>
          </thead>
          <tbody>
            {[...obligations]
              .sort((a, b) => PARTNER_CATEGORIES.indexOf(a.categorie) - PARTNER_CATEGORIES.indexOf(b.categorie))
              .map((o) => {
                const g = obligationProgress(partner, o, ctx);
                const details =
                  o.mode === "publications"
                    ? g.publications.filter((p) => p.statut === "done").map((p) => `${fmtShort(p.date)} : ${p.titre}`)
                    : o.mode === "evenements"
                      ? o.items.filter((i) => i.fait).map((i) => `${i.date ? fmtShort(i.date) : "—"} : ${i.label}${i.preuve ? ` (${i.preuve})` : ""}`)
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
                    <td style={{ whiteSpace: "nowrap" }}>{progressText(o, g)}</td>
                    <td>
                      <ObligationStatusPill statut={g.statut} />
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
      <div className="com-row" style={{ justifyContent: "flex-end" }}>
        <button type="button" className="button button--secondary button--small" onClick={onClose}>
          Fermer
        </button>
      </div>
    </Dialog>
  );
}
