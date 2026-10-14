// Calendrier éditorial (porté de myFLA : app/communication/page.tsx,
// publication-drawer.tsx, new-publication-dialog.tsx, move-dialog.tsx).
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../../context/auth-context";
import { cancelOccurrence, createPublication, deletePublication, moveSeries, updateItem } from "./com-actions.js";
import { useComPartners, useCommunicationTeam, useEvenements, usePublications, useRubriques, memberName } from "./com-data.js";
import { JOURS, JOURS_GRILLE, MOIS, addDays, fmtLong, monthGridDays, parseYmd, todayYmd, ymd } from "./com-dates.js";
import { CANAUX, CANAL_LABELS, PUB_TYPES, PUB_TYPE_LABELS, STATUTS, STATUT_LABELS } from "./com-domain.js";
import { buildCalendarItems, movedRule, ruleAt, ruleLabel } from "./com-recurrence.js";
import { Avatar, Dialog, StatusPill, Toast, Toggle, TypeTag, ValidationBadge, typeColor, useEscape, useToast } from "./com-ui.jsx";

export function ComCalendarPage() {
  const { currentUser } = useAuth();
  const uid = currentUser?.uid || "";
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const today = todayYmd();
  const now = new Date();

  // Lien d'un e-mail ou d'une autre page (?pub=…&date=…) : ouvre le mois et l'aperçu.
  const [linked] = useState(() => {
    const date = searchParams.get("date") || "";
    return { pub: searchParams.get("pub"), date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null };
  });
  const [month, setMonth] = useState(() =>
    linked.date ? { y: Number(linked.date.slice(0, 4)), m: Number(linked.date.slice(5, 7)) - 1 } : { y: now.getFullYear(), m: now.getMonth() },
  );
  // Vue liste par défaut sur téléphone (le glisser-déposer n'y fonctionne pas).
  const [mode, setMode] = useState(() => (window.innerWidth < 760 ? "liste" : "mois"));
  const [filters, setFilters] = useState({ type: "", canal: "", personne: "", partenaire: "", recurrentes: true });
  const [openId, setOpenId] = useState(linked.pub);
  const [newDate, setNewDate] = useState(null);
  const [moveReq, setMoveReq] = useState(null);
  const [dragOver, setDragOver] = useState(null);
  const [toast, setToast] = useToast();

  useEffect(() => {
    if (linked.pub) setSearchParams({}, { replace: true });
  }, [linked.pub, setSearchParams]);

  const days = useMemo(() => monthGridDays(month.y, month.m), [month]);
  const start = ymd(days[0]);
  const end = ymd(days[days.length - 1]);

  const { rubriques, loading: loadingRubriques } = useRubriques();
  const team = useCommunicationTeam();
  const publications = usePublications(start, end);
  const events = useEvenements();
  const { partners } = useComPartners();

  // Un événement sur plusieurs jours apparaît sur chacun de ses jours.
  const eventsByDate = useMemo(() => {
    const map = new Map();
    for (const ev of events) {
      if (!ev.dateDebut) continue;
      const last = ev.dateFin && ev.dateFin > ev.dateDebut ? ev.dateFin : ev.dateDebut;
      for (let d = parseYmd(ev.dateDebut); ymd(d) <= last; d = addDays(d, 1)) {
        const ds = ymd(d);
        if (ds >= start && ds <= end) map.set(ds, [...(map.get(ds) || []), ev]);
      }
    }
    return map;
  }, [events, start, end]);
  const teamById = useMemo(() => new Map(team.map((u) => [u.uid, u])), [team]);
  const rubriqueById = useMemo(() => new Map(rubriques.map((r) => [r.id, r])), [rubriques]);

  const items = useMemo(
    () =>
      buildCalendarItems({ rubriques, publications, start, end, today }).filter(
        (i) =>
          (!filters.type || i.type === filters.type) &&
          (!filters.canal || i.canaux.includes(filters.canal)) &&
          (!filters.personne || i.assigneUids.includes(filters.personne)) &&
          (!filters.partenaire || i.partnerIds.includes(filters.partenaire)) &&
          (filters.recurrentes || !i.rubriqueId),
      ),
    [rubriques, publications, start, end, today, filters],
  );
  const byDate = useMemo(() => {
    const map = new Map();
    items.forEach((i) => map.set(i.date, [...(map.get(i.date) || []), i]));
    return map;
  }, [items]);
  const openItem = openId ? items.find((i) => i.id === openId) : undefined;

  async function run(action, success) {
    try {
      await action();
      if (success) setToast(success);
    } catch (error) {
      console.error(error);
      setToast("L'enregistrement a échoué. Réessaie.");
    }
  }

  // Page de la publication : une occurrence de rubrique y est enregistrée avant d'être ouverte.
  function openPage(item) {
    run(() => (item.materialized ? Promise.resolve() : updateItem(item, {}, uid))).then(() =>
      navigate(`/app/communication/publication/${item.id}`),
    );
  }

  // Glisser-déposer : une occurrence demande « cette date » ou « toute la série ».
  function requestMove(item, to) {
    if (to === item.date) return;
    if (item.rubriqueId && rubriqueById.has(item.rubriqueId)) {
      setMoveReq({ item, to });
      return;
    }
    run(() => updateItem(item, { date: to }, uid), `Déplacée au ${fmtLong(to)}`);
  }

  const goMonth = (delta) =>
    setMonth(({ y, m }) => {
      const d = new Date(y, m + delta, 1);
      return { y: d.getFullYear(), m: d.getMonth() };
    });
  const setFilter = (key, value) => setFilters((current) => ({ ...current, [key]: value }));

  return (
    <>
      <div className="com-page-header">
        <div className="com-row">
          <button type="button" className="button button--secondary button--small" onClick={() => goMonth(-1)} aria-label="Mois précédent">
            ‹
          </button>
          <h1 className="com-month-title">
            {MOIS[month.m]} {month.y}
          </h1>
          <button type="button" className="button button--secondary button--small" onClick={() => goMonth(1)} aria-label="Mois suivant">
            ›
          </button>
          <button type="button" className="com-btn-ghost" onClick={() => setMonth({ y: now.getFullYear(), m: now.getMonth() })}>
            Aujourd'hui
          </button>
        </div>
        <div className="com-row">
          <div className="com-segmented">
            {["mois", "liste"].map((m) => (
              <button key={m} type="button" onClick={() => setMode(m)} className={mode === m ? "is-on" : ""}>
                {m}
              </button>
            ))}
          </div>
          <button type="button" className="button button--primary button--small" onClick={() => setNewDate(today)}>
            + Publication
          </button>
        </div>
      </div>

      {!loadingRubriques && rubriques.length === 0 ? (
        <p className="com-empty">
          Aucune rubrique récurrente pour l'instant.{" "}
          <Link to="/app/communication/rubriques" className="com-link">
            Créer une rubrique
          </Link>{" "}
          (ex. compte à rebours chaque lundi) pour remplir le calendrier automatiquement.
        </p>
      ) : null}

      <div className="com-row">
        <select aria-label="Type" className="com-input is-auto" value={filters.type} onChange={(e) => setFilter("type", e.target.value)}>
          <option value="">Tous les types</option>
          {PUB_TYPES.map((t) => (
            <option key={t} value={t}>
              {PUB_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
        <select aria-label="Canal" className="com-input is-auto" value={filters.canal} onChange={(e) => setFilter("canal", e.target.value)}>
          <option value="">Tous les canaux</option>
          {CANAUX.map((c) => (
            <option key={c} value={c}>
              {CANAL_LABELS[c].label}
            </option>
          ))}
        </select>
        <select aria-label="Personne" className="com-input is-auto" value={filters.personne} onChange={(e) => setFilter("personne", e.target.value)}>
          <option value="">Toute l'équipe</option>
          {team.map((u) => (
            <option key={u.uid} value={u.uid}>
              {memberName(u)}
            </option>
          ))}
        </select>
        {partners.length ? (
          <select aria-label="Partenaire" className="com-input is-auto" value={filters.partenaire} onChange={(e) => setFilter("partenaire", e.target.value)}>
            <option value="">Tous les partenaires</option>
            {partners.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nom}
              </option>
            ))}
          </select>
        ) : null}
        <label className="com-row com-muted">
          <input type="checkbox" checked={filters.recurrentes} onChange={(e) => setFilter("recurrentes", e.target.checked)} />
          Afficher les rubriques récurrentes
        </label>
      </div>

      <div className="com-legend">
        {PUB_TYPES.map((t) => (
          <span key={t} style={typeColor(t)}>
            <span className="com-swatch" aria-hidden="true" />
            {PUB_TYPE_LABELS[t]}
          </span>
        ))}
        <span>↻ récurrent</span>
        <span>★ partenaire</span>
        {STATUTS.map((s) => (
          <span key={s}>
            <span className={`com-st ${s}`} aria-hidden="true" />
            {STATUT_LABELS[s]}
          </span>
        ))}
        {mode === "mois" ? <span>Glisse une publication sur un autre jour pour la déplacer.</span> : null}
      </div>

      {mode === "mois" ? (
        <div className="com-calendar">
          {JOURS_GRILLE.map((j) => (
            <div key={j} className="com-calendar__head">
              {j}
            </div>
          ))}
          {days.map((d) => {
            const ds = ymd(d);
            const out = d.getMonth() !== month.m;
            const weekend = d.getDay() === 0 || d.getDay() === 6;
            return (
              <div
                key={ds}
                onClick={() => setNewDate(ds)}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  if (dragOver !== ds) setDragOver(ds);
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget)) setDragOver((o) => (o === ds ? null : o));
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(null);
                  const item = items.find((i) => i.id === e.dataTransfer.getData("text/plain"));
                  if (item) requestMove(item, ds);
                }}
                className={`com-calendar__day ${out ? "is-out" : weekend ? "is-weekend" : ""} ${dragOver === ds ? "is-over" : ""}`}
              >
                <span className={`com-calendar__num ${ds === today ? "is-today" : ""}`}>{d.getDate()}</span>
                {(eventsByDate.get(ds) || []).map((ev) => (
                  <span key={ev.id} title={ev.titre} className="com-event-band">
                    ◆ {ev.titre}
                  </span>
                ))}
                {(byDate.get(ds) || []).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/plain", item.id);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpenId(item.id);
                    }}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      openPage(item);
                    }}
                    title={`${item.titre} · ${STATUT_LABELS[item.statut]}`}
                    className={`com-chip ${item.date < today ? "is-past" : ""}`}
                    style={typeColor(item.type)}
                  >
                    <span className={`com-st ${item.statut}`} aria-hidden="true" />
                    <span className="com-chip__title">{item.titre}</span>
                    <ValidationBadge validation={item.validation} compact />
                    {item.partnerIds.length ? <span className="com-star" aria-label="mentionne un partenaire">★</span> : null}
                    {item.rubriqueId ? <span className="com-rec" aria-label="récurrent">↻</span> : null}
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="com-list">
          {days
            .filter((d) => d.getMonth() === month.m && (byDate.has(ymd(d)) || eventsByDate.has(ymd(d)) || ymd(d) === today))
            .map((d) => {
              const ds = ymd(d);
              return (
                <div key={ds} className={`com-list__day ${ds === today ? "is-today" : ""}`}>
                  <div className="com-list__date">
                    <strong>{d.getDate()}</strong>
                    <span>{JOURS[d.getDay()].slice(0, 3)}.</span>
                  </div>
                  <div className="com-stack" style={{ gap: 6 }}>
                    {(eventsByDate.get(ds) || []).map((ev) => (
                      <span key={ev.id} className="com-event-band" style={{ width: "fit-content" }}>
                        ◆ {ev.titre}
                      </span>
                    ))}
                    {(byDate.get(ds) || []).map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setOpenId(item.id)}
                        onDoubleClick={() => openPage(item)}
                        style={typeColor(item.type)}
                        className="com-list__item"
                      >
                        <b>{item.titre}</b>
                        <span className="com-avatars">
                          {item.assigneUids.map((id) => (
                            <Avatar key={id} user={teamById.get(id)} />
                          ))}
                        </span>
                        <span className="com-list__meta">
                          <TypeTag type={item.type} />
                          {item.canaux.map((c) => (
                            <span key={c} className="com-canal">
                              {CANAL_LABELS[c].short}
                            </span>
                          ))}
                          {item.rubriqueId ? <span>↻ récurrent</span> : null}
                          {item.partnerIds.length ? <span className="com-star">★ partenaire</span> : null}
                          <ValidationBadge validation={item.validation} />
                        </span>
                        <StatusPill statut={item.statut} />
                      </button>
                    ))}
                    {!byDate.has(ds) && !eventsByDate.has(ds) ? <span className="com-muted">Rien de prévu aujourd'hui.</span> : null}
                  </div>
                </div>
              );
            })}
        </div>
      )}

      {openItem ? (
        <PublicationDrawer
          key={openItem.id}
          item={openItem}
          rubrique={openItem.rubriqueId ? rubriqueById.get(openItem.rubriqueId) : undefined}
          team={team}
          partners={partners}
          onOpen={() => openPage(openItem)}
          onStatut={(statut) => run(() => updateItem(openItem, { statut }, uid))}
          onRename={(titre) => run(() => updateItem(openItem, { titre }, uid), "Titre modifié")}
          onRemove={() => {
            setOpenId(null);
            if (openItem.rubriqueId) run(() => cancelOccurrence(openItem, uid), "Date retirée du calendrier");
            else run(() => deletePublication(openItem.id), "Publication supprimée");
          }}
          onClose={() => setOpenId(null)}
        />
      ) : null}

      {newDate ? (
        <NewPublicationDialog
          date={newDate}
          team={team}
          events={events}
          partners={partners}
          onClose={() => setNewDate(null)}
          onCreate={async (data) => {
            await run(() => createPublication({ ...data, statut: "todo", notes: "" }, uid), "Publication ajoutée au calendrier");
            setNewDate(null);
          }}
        />
      ) : null}

      {moveReq && rubriqueById.get(moveReq.item.rubriqueId) ? (
        <MoveDialog
          item={moveReq.item}
          rubrique={rubriqueById.get(moveReq.item.rubriqueId)}
          to={moveReq.to}
          onClose={() => setMoveReq(null)}
          onOnly={() => {
            const { item, to } = moveReq;
            setMoveReq(null);
            run(() => updateItem(item, { date: to }, uid), `Déplacée au ${fmtLong(to)}, cette date seulement`);
          }}
          onSeries={() => {
            const { item, to } = moveReq;
            setMoveReq(null);
            setOpenId(null);
            run(() => moveSeries(item, rubriqueById.get(item.rubriqueId), to, uid), "Récurrence déplacée à partir de cette date");
          }}
        />
      ) : null}

      <Toast message={toast} />
    </>
  );
}

// Aperçu rapide d'une publication depuis le calendrier : statut, contenu en bref et ce qui manque.
function PublicationDrawer({ item, rubrique, team, partners, onOpen, onStatut, onRename, onRemove, onClose }) {
  const [titre, setTitre] = useState(item.titre);
  const [confirming, setConfirming] = useState(false);
  useEscape(onClose);
  const isOccurrence = Boolean(item.rubriqueId);
  const teamById = new Map(team.map((u) => [u.uid, u]));
  const assignees = item.assigneUids.map((id) => teamById.get(id)).filter(Boolean);
  const checks = item.partnerIds.flatMap((pid) => (partners.some((p) => p.id === pid) ? [`${pid}:logo`, `${pid}:mention`] : []));
  const checksDone = checks.filter((k) => item.checks[k]).length;
  const excerpt = (item.texte || item.notes).trim();
  const images = [item.visuelUrl, ...item.photos.map((p) => p.thumbUrl)].filter(Boolean);
  const rows = [
    ["Canaux", item.canaux.map((c) => CANAL_LABELS[c].label).join(", ") || "Aucun"],
    ["Assigné à", assignees.map(memberName).join(", ") || "Personne"],
    ["Visuel", item.visuelUrl ? "Ajouté" : <span className="com-warn-text">Manquant</span>],
    ["Validation", item.validation ? <ValidationBadge validation={item.validation} /> : "Pas encore demandée"],
    ...(checks.length ? [["Partenaires", `${checksDone} vérification${checksDone > 1 ? "s" : ""} sur ${checks.length}`]] : []),
  ];

  return (
    <>
      <div className="com-drawer__backdrop" onClick={onClose} />
      <aside role="dialog" aria-label={item.titre} className="com-drawer">
        <div className="com-drawer__top">
          <TypeTag type={item.type} />
          <button type="button" className="com-btn-ghost" onClick={onClose} aria-label="Fermer">
            ✕
          </button>
        </div>

        <div className="com-drawer__body">
          <div className="com-stack" style={{ gap: 6 }}>
            <input
              aria-label="Titre"
              className="com-title-input"
              value={titre}
              onChange={(e) => setTitre(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
              onBlur={(e) => {
                const value = e.currentTarget.value.trim();
                if (value && value !== item.titre) onRename(value);
                else setTitre(item.titre);
              }}
            />
            <p className="com-muted">
              {fmtLong(item.date)}
              {item.heure ? ` · ${item.heure}` : ""}
              {rubrique ? ` · ↻ ${rubrique.titre}` : ""}
            </p>
          </div>

          <div>
            <p className="com-section-title">Statut</p>
            <div className="com-row">
              {STATUTS.map((s) => (
                <Toggle key={s} on={item.statut === s} onClick={() => item.statut !== s && onStatut(s)}>
                  <span className={`com-st ${s}`} aria-hidden="true" />
                  {STATUT_LABELS[s]}
                </Toggle>
              ))}
            </div>
          </div>

          {images.length ? (
            <div className="com-thumbs">
              {images.slice(0, 3).map((src) => (
                <div key={src}>
                  <img src={src} alt="" />
                </div>
              ))}
            </div>
          ) : null}

          {excerpt ? <p className="com-excerpt">{excerpt}</p> : null}

          <dl className="com-dl">
            {rows.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="com-drawer__bottom">
          <button type="button" className="button button--primary" onClick={onOpen}>
            Ouvrir la publication →
          </button>
          {confirming ? (
            <div className="com-row" style={{ justifyContent: "center" }}>
              <span>{isOccurrence ? "Retirer cette date du calendrier ?" : "Supprimer définitivement ?"}</span>
              <button type="button" className="button button--danger-soft button--small" onClick={onRemove}>
                Confirmer
              </button>
              <button type="button" className="com-btn-ghost" onClick={() => setConfirming(false)}>
                Garder
              </button>
            </div>
          ) : (
            <div className="com-row" style={{ justifyContent: "space-between" }}>
              <span className="com-muted" style={{ fontSize: "0.75rem" }}>
                Astuce : double-clic pour ouvrir directement.
              </span>
              <button type="button" className="button button--danger-soft button--small" onClick={() => setConfirming(true)}>
                {isOccurrence ? "Annuler cette date" : "Supprimer"}
              </button>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}

export function NewPublicationDialog({ date, team, events = [], eventId = null, partners = [], onClose, onCreate }) {
  const [form, setForm] = useState({ titre: "", date, type: "post", canaux: ["fb", "ig"], assigneUids: [], eventId, partnerIds: [] });
  const [submitting, setSubmitting] = useState(false);
  const toggle = (key, value) =>
    setForm((f) => ({ ...f, [key]: f[key].includes(value) ? f[key].filter((v) => v !== value) : [...f[key], value] }));

  async function handleSubmit(event) {
    event.preventDefault();
    setSubmitting(true);
    try {
      await onCreate({ ...form, titre: form.titre.trim() });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog title="Nouvelle publication" onClose={onClose}>
      <form className="com-stack" onSubmit={handleSubmit}>
        <label className="com-field">
          Titre
          <input className="com-input" required autoFocus maxLength={200} placeholder="Ex. Annonce du plateau du 60 m" value={form.titre} onChange={(e) => setForm({ ...form, titre: e.target.value })} />
        </label>
        <div className="com-grid-2">
          <label className="com-field">
            Date
            <input type="date" className="com-input" required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          </label>
          <label className="com-field">
            Type
            <select className="com-input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              {PUB_TYPES.map((t) => (
                <option key={t} value={t}>
                  {PUB_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="com-field">
          Canaux
          <div className="com-row">
            {CANAUX.map((c) => (
              <Toggle key={c} on={form.canaux.includes(c)} onClick={() => toggle("canaux", c)}>
                {CANAL_LABELS[c].label}
              </Toggle>
            ))}
          </div>
        </div>
        <div className="com-field">
          Assigné à
          <div className="com-row">
            {team.map((u) => (
              <Toggle key={u.uid} on={form.assigneUids.includes(u.uid)} onClick={() => toggle("assigneUids", u.uid)}>
                <Avatar user={u} />
                {memberName(u)}
              </Toggle>
            ))}
          </div>
        </div>
        {partners.length ? (
          <div className="com-field">
            Partenaires mentionnés
            <div className="com-row">
              {partners.map((p) => (
                <Toggle key={p.id} on={form.partnerIds.includes(p.id)} onClick={() => toggle("partnerIds", p.id)}>
                  ★ {p.nom}
                </Toggle>
              ))}
            </div>
          </div>
        ) : null}
        {events.length ? (
          <label className="com-field">
            Événement
            <select className="com-input" value={form.eventId || ""} onChange={(e) => setForm({ ...form, eventId: e.target.value || null })}>
              <option value="">Aucun</option>
              {events.map((ev) => (
                <option key={ev.id} value={ev.id}>
                  {ev.titre}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <div className="com-row" style={{ justifyContent: "flex-end" }}>
          <button type="button" className="com-btn-ghost" onClick={onClose}>
            Annuler
          </button>
          <button type="submit" className="button button--primary button--small" disabled={submitting}>
            {submitting ? "Ajout…" : "Ajouter au calendrier"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

// Déplacement d'une occurrence : cette date seulement, ou toute la récurrence à partir de cette date.
function MoveDialog({ item, rubrique, to, onOnly, onSeries, onClose }) {
  const orig = item.occurrenceDate || item.date;
  const current = ruleAt(rubrique, orig);
  const next = movedRule(current, parseYmd(orig), parseYmd(to));

  return (
    <Dialog title="Déplacer une rubrique récurrente" onClose={onClose}>
      <p style={{ margin: 0 }}>
        <strong>{item.titre}</strong> passe du <strong>{fmtLong(item.date)}</strong> au <strong>{fmtLong(to)}</strong>.
      </p>
      <div className="com-stack" style={{ gap: 8 }}>
        <button type="button" className="com-choice" onClick={onOnly}>
          <strong>Seulement cette date</strong>
          <span>Les autres semaines restent : {ruleLabel(current).toLowerCase()}.</span>
        </button>
        <button type="button" className="com-choice" onClick={onSeries}>
          <strong>Toute la récurrence, à partir de cette date</strong>
          <span>Nouveau rythme : {ruleLabel(next).toLowerCase()}. Les dates passées ne bougent pas.</span>
        </button>
      </div>
      <div className="com-row" style={{ justifyContent: "flex-end" }}>
        <button type="button" className="com-btn-ghost" onClick={onClose}>
          Annuler
        </button>
      </div>
    </Dialog>
  );
}
