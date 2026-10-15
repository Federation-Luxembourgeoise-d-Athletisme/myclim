// Calendrier éditorial (porté de myFLA : app/communication/page.tsx,
// publication-drawer.tsx, new-publication-dialog.tsx, move-dialog.tsx).
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../../context/auth-context";
import { cancelOccurrence, createPublication, deletePublication, moveSeries, updateItem } from "./com-actions.js";
import { useComPartners, useCommunicationTeam, useEvenements, usePublications, useRubriques, memberName } from "./com-data.js";
import { addDays, dayName, fmtLong, gridDayNames, monthGridDays, monthName, parseYmd, todayYmd, ymd } from "./com-dates.js";
import { CANAUX, CANAL_LABELS, PUB_TYPES, PUB_TYPE_LABELS, STATUTS, STATUT_LABELS } from "./com-domain.js";
import { pick, useComLang } from "./com-i18n.js";
import { buildCalendarItems, movedRule, ruleAt, ruleLabel } from "./com-recurrence.js";
import { Avatar, Dialog, StatusPill, Toast, Toggle, TypeTag, ValidationBadge } from "./com-ui.jsx";
import { typeColor, useEscape, useToast } from "./com-ui-helpers.js";
import { PostStats } from "./com-social-panel.jsx";
import { useSocialPosts } from "./com-social.js";

export function ComCalendarPage() {
  const { currentUser } = useAuth();
  const uid = currentUser?.uid || "";
  const { lang, tr } = useComLang();
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
  // Statistiques de l'aperçu : posts chargés seulement si la publication ouverte en a un de relié.
  const facebook = useSocialPosts("facebook", Boolean(openItem?.facebookPostId), lang);
  const instagram = useSocialPosts("instagram", Boolean(openItem?.instagramMediaId), lang);

  async function run(action, success) {
    try {
      await action();
      if (success) setToast(success);
    } catch (error) {
      console.error(error);
      setToast(tr("L'enregistrement a échoué. Réessaie.", "Saving failed. Please try again."));
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
    run(() => updateItem(item, { date: to }, uid), tr(`Déplacée au ${fmtLong(to)}`, `Moved to ${fmtLong(to, lang)}`));
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
          <button type="button" className="button button--secondary button--small" onClick={() => goMonth(-1)} aria-label={tr("Mois précédent", "Previous month")}>
            ‹
          </button>
          <h1 className="com-month-title">
            {monthName(month.m, lang)} {month.y}
          </h1>
          <button type="button" className="button button--secondary button--small" onClick={() => goMonth(1)} aria-label={tr("Mois suivant", "Next month")}>
            ›
          </button>
          <button type="button" className="com-btn-ghost" onClick={() => setMonth({ y: now.getFullYear(), m: now.getMonth() })}>
            {tr("Aujourd'hui", "Today")}
          </button>
        </div>
        <div className="com-row">
          <div className="com-segmented">
            {["mois", "liste"].map((m) => (
              <button key={m} type="button" onClick={() => setMode(m)} className={mode === m ? "is-on" : ""}>
                {m === "mois" ? tr("mois", "month") : tr("liste", "list")}
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
          {tr("Aucune rubrique récurrente pour l'instant.", "No recurring series yet.")}{" "}
          <Link to="/app/communication/rubriques" className="com-link">
            {tr("Créer une rubrique", "Create a series")}
          </Link>{" "}
          {tr(
            "(ex. compte à rebours chaque lundi) pour remplir le calendrier automatiquement.",
            "(e.g. a countdown every Monday) to fill the calendar automatically.",
          )}
        </p>
      ) : null}

      <div className="com-row">
        <select aria-label="Type" className="com-input is-auto" value={filters.type} onChange={(e) => setFilter("type", e.target.value)}>
          <option value="">{tr("Tous les types", "All types")}</option>
          {PUB_TYPES.map((t) => (
            <option key={t} value={t}>
              {pick(PUB_TYPE_LABELS[t], lang)}
            </option>
          ))}
        </select>
        <select aria-label={tr("Canal", "Channel")} className="com-input is-auto" value={filters.canal} onChange={(e) => setFilter("canal", e.target.value)}>
          <option value="">{tr("Tous les canaux", "All channels")}</option>
          {CANAUX.map((c) => (
            <option key={c} value={c}>
              {pick(CANAL_LABELS[c].label, lang)}
            </option>
          ))}
        </select>
        <select aria-label={tr("Personne", "Person")} className="com-input is-auto" value={filters.personne} onChange={(e) => setFilter("personne", e.target.value)}>
          <option value="">{tr("Toute l'équipe", "Whole team")}</option>
          {team.map((u) => (
            <option key={u.uid} value={u.uid}>
              {memberName(u)}
            </option>
          ))}
        </select>
        {partners.length ? (
          <select aria-label={tr("Partenaire", "Partner")} className="com-input is-auto" value={filters.partenaire} onChange={(e) => setFilter("partenaire", e.target.value)}>
            <option value="">{tr("Tous les partenaires", "All partners")}</option>
            {partners.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nom}
              </option>
            ))}
          </select>
        ) : null}
        <label className="com-row com-muted">
          <input type="checkbox" checked={filters.recurrentes} onChange={(e) => setFilter("recurrentes", e.target.checked)} />
          {tr("Afficher les rubriques récurrentes", "Show recurring series")}
        </label>
      </div>

      <div className="com-legend">
        {PUB_TYPES.map((t) => (
          <span key={t} style={typeColor(t)}>
            <span className="com-swatch" aria-hidden="true" />
            {pick(PUB_TYPE_LABELS[t], lang)}
          </span>
        ))}
        <span>{tr("↻ récurrent", "↻ recurring")}</span>
        <span>{tr("★ partenaire", "★ partner")}</span>
        {STATUTS.map((s) => (
          <span key={s}>
            <span className={`com-st ${s}`} aria-hidden="true" />
            {pick(STATUT_LABELS[s], lang)}
          </span>
        ))}
        {mode === "mois" ? <span>{tr("Glisse une publication sur un autre jour pour la déplacer.", "Drag a publication onto another day to move it.")}</span> : null}
      </div>

      {mode === "mois" ? (
        <div className="com-calendar">
          {gridDayNames(lang).map((j) => (
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
                    title={`${item.titre} · ${pick(STATUT_LABELS[item.statut], lang)}`}
                    className={`com-chip ${item.date < today ? "is-past" : ""}`}
                    style={typeColor(item.type)}
                  >
                    <span className={`com-st ${item.statut}`} aria-hidden="true" />
                    <span className="com-chip__title">{item.titre}</span>
                    <ValidationBadge validation={item.validation} compact />
                    {item.partnerIds.length ? <span className="com-star" aria-label={tr("mentionne un partenaire", "mentions a partner")}>★</span> : null}
                    {item.rubriqueId ? <span className="com-rec" aria-label={tr("récurrent", "recurring")}>↻</span> : null}
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
                    <span>
                      {dayName(d.getDay(), lang).slice(0, 3)}
                      {lang === "fr" ? "." : ""}
                    </span>
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
                              {pick(CANAL_LABELS[c].short, lang)}
                            </span>
                          ))}
                          {item.rubriqueId ? <span>{tr("↻ récurrent", "↻ recurring")}</span> : null}
                          {item.partnerIds.length ? <span className="com-star">{tr("★ partenaire", "★ partner")}</span> : null}
                          <ValidationBadge validation={item.validation} />
                        </span>
                        <StatusPill statut={item.statut} />
                      </button>
                    ))}
                    {!byDate.has(ds) && !eventsByDate.has(ds) ? <span className="com-muted">{tr("Rien de prévu aujourd'hui.", "Nothing planned today.")}</span> : null}
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
          facebook={facebook}
          instagram={instagram}
          rubrique={openItem.rubriqueId ? rubriqueById.get(openItem.rubriqueId) : undefined}
          team={team}
          partners={partners}
          onOpen={() => openPage(openItem)}
          onStatut={(statut) => run(() => updateItem(openItem, { statut }, uid))}
          onRename={(titre) => run(() => updateItem(openItem, { titre }, uid), tr("Titre modifié", "Title updated"))}
          onRemove={() => {
            setOpenId(null);
            if (openItem.rubriqueId) run(() => cancelOccurrence(openItem, uid), tr("Date retirée du calendrier", "Date removed from the calendar"));
            else run(() => deletePublication(openItem.id), tr("Publication supprimée", "Publication deleted"));
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
            await run(() => createPublication({ ...data, statut: "todo", notes: "" }, uid), tr("Publication ajoutée au calendrier", "Publication added to the calendar"));
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
            run(() => updateItem(item, { date: to }, uid), tr(`Déplacée au ${fmtLong(to)}, cette date seulement`, `Moved to ${fmtLong(to, lang)}, this date only`));
          }}
          onSeries={() => {
            const { item, to } = moveReq;
            setMoveReq(null);
            setOpenId(null);
            run(() => moveSeries(item, rubriqueById.get(item.rubriqueId), to, uid), tr("Récurrence déplacée à partir de cette date", "Series moved from this date onwards"));
          }}
        />
      ) : null}

      <Toast message={toast} />
    </>
  );
}

// Aperçu rapide d'une publication depuis le calendrier : statut, contenu en bref et ce qui manque.
function PublicationDrawer({ item, rubrique, team, partners, facebook, instagram, onOpen, onStatut, onRename, onRemove, onClose }) {
  const { lang, tr } = useComLang();
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
    [tr("Canaux", "Channels"), item.canaux.map((c) => pick(CANAL_LABELS[c].label, lang)).join(", ") || tr("Aucun", "None")],
    [tr("Assigné à", "Assigned to"), assignees.map(memberName).join(", ") || tr("Personne", "Nobody")],
    [
      tr("Visuel", "Visual"),
      item.visuelUrl ? (
        tr("Ajouté", "Added")
      ) : item.photos.length ? (
        tr("Photo de la galerie", "Gallery photo")
      ) : (
        <span className="com-warn-text">{tr("Manquant", "Missing")}</span>
      ),
    ],
    ["Photos", item.photos.length ? tr(`${item.photos.length} de la galerie`, `${item.photos.length} from the gallery`) : tr("Aucune", "None")],
    [tr("Validation", "Approval"), item.validation ? <ValidationBadge validation={item.validation} /> : tr("Pas encore demandée", "Not requested yet")],
    ...(checks.length
      ? [
          [
            tr("Partenaires", "Partners"),
            tr(`${checksDone} vérification${checksDone > 1 ? "s" : ""} sur ${checks.length}`, `${checksDone} of ${checks.length} check${checks.length > 1 ? "s" : ""}`),
          ],
        ]
      : []),
  ];

  return (
    <>
      <div className="com-drawer__backdrop" onClick={onClose} />
      <aside role="dialog" aria-label={item.titre} className="com-drawer">
        <div className="com-drawer__top">
          <TypeTag type={item.type} />
          <button type="button" className="com-btn-ghost" onClick={onClose} aria-label={tr("Fermer", "Close")}>
            ✕
          </button>
        </div>

        <div className="com-drawer__body">
          <div className="com-stack" style={{ gap: 6 }}>
            <input
              aria-label={tr("Titre", "Title")}
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
              {fmtLong(item.date, lang)}
              {item.heure ? ` · ${item.heure}` : ""}
              {rubrique ? ` · ↻ ${rubrique.titre}` : ""}
            </p>
          </div>

          <div>
            <p className="com-section-title">{tr("Statut", "Status")}</p>
            <div className="com-row">
              {STATUTS.map((s) => (
                <Toggle key={s} on={item.statut === s} onClick={() => item.statut !== s && onStatut(s)}>
                  <span className={`com-st ${s}`} aria-hidden="true" />
                  {pick(STATUT_LABELS[s], lang)}
                </Toggle>
              ))}
            </div>
          </div>

          <PostStats item={item} facebook={facebook} instagram={instagram} />

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
            {tr("Ouvrir la publication →", "Open publication →")}
          </button>
          {confirming ? (
            <div className="com-row" style={{ justifyContent: "center" }}>
              <span>{isOccurrence ? tr("Retirer cette date du calendrier ?", "Remove this date from the calendar?") : tr("Supprimer définitivement ?", "Delete permanently?")}</span>
              <button type="button" className="button button--danger-soft button--small" onClick={onRemove}>
                {tr("Confirmer", "Confirm")}
              </button>
              <button type="button" className="com-btn-ghost" onClick={() => setConfirming(false)}>
                {tr("Garder", "Keep")}
              </button>
            </div>
          ) : (
            <div className="com-row" style={{ justifyContent: "space-between" }}>
              <span className="com-muted" style={{ fontSize: "0.75rem" }}>
                {tr("Astuce : double-clic pour ouvrir directement.", "Tip: double-click to open it directly.")}
              </span>
              <button type="button" className="button button--danger-soft button--small" onClick={() => setConfirming(true)}>
                {isOccurrence ? tr("Annuler cette date", "Cancel this date") : tr("Supprimer", "Delete")}
              </button>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}

export function NewPublicationDialog({ date, team, events = [], eventId = null, partners = [], onClose, onCreate }) {
  const { lang, tr } = useComLang();
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
    <Dialog title={tr("Nouvelle publication", "New publication")} onClose={onClose}>
      <form className="com-stack" onSubmit={handleSubmit}>
        <label className="com-field">
          {tr("Titre", "Title")}
          <input
            className="com-input"
            required
            autoFocus
            maxLength={200}
            placeholder={tr("Ex. Annonce du plateau du 60 m", "e.g. 60 m line-up announcement")}
            value={form.titre}
            onChange={(e) => setForm({ ...form, titre: e.target.value })}
          />
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
                  {pick(PUB_TYPE_LABELS[t], lang)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="com-field">
          {tr("Canaux", "Channels")}
          <div className="com-row">
            {CANAUX.map((c) => (
              <Toggle key={c} on={form.canaux.includes(c)} onClick={() => toggle("canaux", c)}>
                {pick(CANAL_LABELS[c].label, lang)}
              </Toggle>
            ))}
          </div>
        </div>
        <div className="com-field">
          {tr("Assigné à", "Assigned to")}
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
            {tr("Partenaires mentionnés", "Partners mentioned")}
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
            {tr("Événement", "Event")}
            <select className="com-input" value={form.eventId || ""} onChange={(e) => setForm({ ...form, eventId: e.target.value || null })}>
              <option value="">{tr("Aucun", "None")}</option>
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
            {tr("Annuler", "Cancel")}
          </button>
          <button type="submit" className="button button--primary button--small" disabled={submitting}>
            {submitting ? tr("Ajout…", "Adding…") : tr("Ajouter au calendrier", "Add to calendar")}
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
  const { lang, tr } = useComLang();
  // En français la règle se lit en minuscules au milieu de la phrase ; en anglais on garde les majuscules (« Every Monday »).
  const rule = (r) => (lang === "fr" ? ruleLabel(r).toLowerCase() : ruleLabel(r, lang));

  return (
    <Dialog title={tr("Déplacer une rubrique récurrente", "Move a recurring series")} onClose={onClose}>
      <p style={{ margin: 0 }}>
        <strong>{item.titre}</strong> {tr("passe du", "moves from")} <strong>{fmtLong(item.date, lang)}</strong> {tr("au", "to")}{" "}
        <strong>{fmtLong(to, lang)}</strong>.
      </p>
      <div className="com-stack" style={{ gap: 8 }}>
        <button type="button" className="com-choice" onClick={onOnly}>
          <strong>{tr("Seulement cette date", "This date only")}</strong>
          <span>
            {tr("Les autres semaines restent : ", "The other weeks stay the same: ")}
            {rule(current)}.
          </span>
        </button>
        <button type="button" className="com-choice" onClick={onSeries}>
          <strong>{tr("Toute la récurrence, à partir de cette date", "The whole series, from this date onwards")}</strong>
          <span>
            {tr("Nouveau rythme : ", "New schedule: ")}
            {rule(next)}. {tr("Les dates passées ne bougent pas.", "Past dates stay where they are.")}
          </span>
        </button>
      </div>
      <div className="com-row" style={{ justifyContent: "flex-end" }}>
        <button type="button" className="com-btn-ghost" onClick={onClose}>
          {tr("Annuler", "Cancel")}
        </button>
      </div>
    </Dialog>
  );
}
