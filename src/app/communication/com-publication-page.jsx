// Page d'une publication (porté de myFLA : app/communication/publication/[id]/page.tsx,
// mini-calendar.tsx, post-text-editor.tsx, post-preview.tsx, validation-panel.tsx,
// site-link-panel.tsx). Sans Mailchimp ; statistiques et photos : étape 2.
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../../context/auth-context";
import cmcmLogo from "../../assets/cmcm-logo.png";
import { VISUEL_TYPES, cancelOccurrence, deletePublication, isVideo, moveSeries, publicationHandlers, updateItem } from "./com-actions.js";
import { memberName, useComPartners, useCommunicationTeam, useEvenements, usePublicationItem, usePublications, useRubriques } from "./com-data.js";
import { addDays, dayName, fmtLong, fmtShort, gridDayNames, monthGridDays, monthName, parseYmd, todayYmd, ymd } from "./com-dates.js";
import { CANAUX, CANAL_LABELS, MAX_LIENS, STATUTS, STATUT_LABELS, TEXT_LIMITS, VALIDATION_ETAT_LABELS, linkLabel } from "./com-domain.js";
import { buildCalendarItems, movedRule, occurrenceId, ruleAt, ruleLabel } from "./com-recurrence.js";
import { Avatar, Dialog, Toast, Toggle, TypeTag, ValidationBadge } from "./com-ui.jsx";
import { typeColor, useToast } from "./com-ui-helpers.js";
import { PhotosPanel } from "./com-gallery.jsx";
import { pick, useComLang } from "./com-i18n.js";
import { SocialPanel } from "./com-social-panel.jsx";
import { creditLine, facebookStats, formatCount, instagramStats, useSocialPosts } from "./com-social.js";

// Hashtags insérés par le bouton « Hashtags du meeting » (à ajuster ici si besoin).
const MEETING_HASHTAGS = "#CMCMLuxembourgIndoorMeeting #Letzmakeithappen #WorldIndoorTour #athletics";
const ACCOUNT_NAME = "CMCM Luxembourg Indoor Meeting";
const ACCOUNT_HANDLE = "cmcm_lux_indoor_meet";
const CAL_PREF = "com-mini-calendar";

export function ComPublicationPage() {
  const { id = "" } = useParams();
  const { item, loading } = usePublicationItem(id);
  const { tr } = useComLang();
  if (loading) return <p className="com-muted">{tr("Chargement…", "Loading…")}</p>;
  // Une occurrence annulée garde son document (annulee: true) mais n'existe plus dans le calendrier.
  if (!item || item.annulee) {
    return (
      <>
        <Link to="/app/communication" className="com-link">
          ← {tr("Calendrier éditorial", "Editorial calendar")}
        </Link>
        <div className="com-page-header">
          <div>
            <h1>{tr("Publication introuvable", "Publication not found")}</h1>
            <p className="com-muted">
              {tr(
                "Elle a peut-être été supprimée ou déplacée. Ouvre-la depuis le calendrier éditorial.",
                "It may have been deleted or moved. Open it from the editorial calendar.",
              )}
            </p>
          </div>
        </div>
      </>
    );
  }
  return <PublicationPage key={item.id} item={item} />;
}

function PublicationPage({ item }) {
  const { currentUser } = useAuth();
  const uid = currentUser?.uid || "";
  const navigate = useNavigate();
  const { lang, tr, locale } = useComLang();
  const team = useCommunicationTeam();
  const { rubriques } = useRubriques();
  const events = useEvenements();
  const { partners } = useComPartners();
  const [toast, setToast] = useToast();
  const [titre, setTitre] = useState(item.titre);
  const [notes, setNotes] = useState(item.notes);
  const [moveTo, setMoveTo] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [calOpen, setCalOpen] = useState(() => {
    try {
      return window.localStorage.getItem(CAL_PREF) !== "hidden";
    } catch {
      return true;
    }
  });
  const showCalendar = (open) => {
    setCalOpen(open);
    try {
      window.localStorage.setItem(CAL_PREF, open ? "shown" : "hidden");
    } catch {
      // Stockage indisponible : la préférence ne dure que pour cette page.
    }
  };

  const h = publicationHandlers(item, uid, setToast, lang);
  const rubrique = item.rubriqueId ? rubriques.find((r) => r.id === item.rubriqueId) : undefined;
  const isOccurrence = Boolean(item.rubriqueId);
  const teamById = useMemo(() => new Map(team.map((u) => [u.uid, u])), [team]);
  const selectedPartners = partners.filter((p) => item.partnerIds.includes(p.id));
  const mentions = selectedPartners.map((p) => (p.handle ? (p.handle.startsWith("@") ? p.handle : `@${p.handle}`) : p.nom));
  const previewImages = [item.visuelUrl, ...item.photos.map((p) => p.largeUrl)].filter(Boolean);
  const facebook = useSocialPosts("facebook", item.canaux.includes("fb") || Boolean(item.facebookPostId), lang, [item.facebookPostId]);
  const instagram = useSocialPosts("instagram", item.canaux.includes("ig") || Boolean(item.instagramMediaId), lang, [item.instagramMediaId]);
  // Règle de récurrence en minuscule dans une phrase (en anglais, les jours gardent leur majuscule).
  const ruleText = (rule) => {
    const label = ruleLabel(rule, lang);
    return lang === "fr" ? label.toLowerCase() : label.charAt(0).toLowerCase() + label.slice(1);
  };

  const toggle = (key, value) => {
    const list = item[key];
    h.update({ [key]: list.includes(value) ? list.filter((v) => v !== value) : [...list, value] });
  };

  // Une occurrence de rubrique demande « cette date seulement » ou « toute la série ».
  function changeDate(to) {
    if (!to || to === item.date) return;
    if (isOccurrence && rubrique) setMoveTo(to);
    else h.update({ date: to }, tr(`Déplacée au ${fmtLong(to, lang)}`, `Moved to ${fmtLong(to, lang)}`));
  }

  function remove() {
    h.run(() => (item.rubriqueId ? cancelOccurrence(item, uid) : deletePublication(item.id))).then(() => navigate("/app/communication"));
  }

  const meta = [
    `${fmtLong(item.date, lang)}${item.heure ? ` ${tr("à", "at")} ${item.heure}` : ""}`,
    item.canaux.map((c) => pick(CANAL_LABELS[c].label, lang)).join(", "),
    item.assigneUids.map((uidValue) => (teamById.get(uidValue) ? memberName(teamById.get(uidValue)) : "")).filter(Boolean).join(", "),
  ].filter(Boolean);

  return (
    <div className="com-stack" style={{ gap: 20 }}>
      <Link to="/app/communication" className="com-link">
        ← {tr("Calendrier éditorial", "Editorial calendar")}
      </Link>

      <header className="com-page-header">
        <div className="com-stack" style={{ gap: 8, flex: "1 1 520px" }}>
          <div className="com-row">
            <TypeTag type={item.type} />
            {rubrique ? (
              <Link to="/app/communication/rubriques" className="com-toggle">
                ↻ {tr("Rubrique", "Series")} « {rubrique.titre} » · {ruleText(ruleAt(rubrique, item.occurrenceDate || item.date))}
              </Link>
            ) : null}
          </div>
          <input
            aria-label={tr("Titre", "Title")}
            className="com-title-input"
            style={{ fontSize: "1.9rem" }}
            maxLength={200}
            value={titre}
            onChange={(e) => setTitre(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            onBlur={(e) => {
              const value = e.currentTarget.value.trim();
              if (value && value !== item.titre) h.update({ titre: value });
              else setTitre(item.titre);
            }}
          />
          <p className="com-muted">{meta.join(" · ")}</p>
        </div>
        <div className="com-row">
          <a href="#validation" className="button button--secondary button--small">
            {item.validation ? pick(VALIDATION_ETAT_LABELS[item.validation.etat], lang) : tr("Demander la validation", "Request approval")}
          </a>
          {item.statut !== "done" ? (
            <button type="button" className="button button--primary button--small" onClick={() => h.update({ statut: "done" }, tr("Publication marquée comme publiée", "Publication marked as published"))}>
              {tr("Marquer comme publié", "Mark as published")}
            </button>
          ) : null}
        </div>
      </header>

      <div role="group" aria-label={tr("Statut", "Status")} className="com-segmented" style={{ width: "fit-content", maxWidth: "100%", flexWrap: "wrap" }}>
        {STATUTS.map((s) => (
          <button key={s} type="button" aria-pressed={item.statut === s} className={item.statut === s ? "is-on" : ""} onClick={() => item.statut !== s && h.update({ statut: s })}>
            <span className={`com-st ${s}`} aria-hidden="true" /> {pick(STATUT_LABELS[s], lang)}
          </button>
        ))}
      </div>

      <div className={`com-pub-layout ${calOpen ? "" : "no-mini"}`}>
        {calOpen ? (
          <MiniCalendar current={item} uid={uid} onHide={() => showCalendar(false)} />
        ) : null}

        <div className="com-stack" style={{ gap: 20 }}>
          {!calOpen ? (
            <button type="button" className="com-btn-ghost com-mini-toggle" style={{ alignSelf: "flex-start" }} onClick={() => showCalendar(true)}>
              « {tr("Afficher le mini-calendrier", "Show mini calendar")}
            </button>
          ) : null}
          <PostTextEditor value={item.texte} canaux={item.canaux} credit={creditLine(item.photos, lang)} mentions={mentions} onSave={(texte) => h.update({ texte })} onToast={setToast} />
          <PhotosPanel photos={item.photos} hasVisuel={Boolean(item.visuelUrl)} onChange={(photos) => h.update({ photos })} />
          <section className="com-card">
            <VisuelPanel
              canvaUrl={item.canvaUrl}
              visuelUrl={item.visuelUrl}
              onCanva={(url) => h.update({ canvaUrl: url })}
              onUpload={h.uploadVisuel}
              onRemove={h.removeVisuel}
            />
          </section>
          <PostPreview texte={item.texte} canaux={item.canaux} images={previewImages} date={item.date} />
        </div>

        <aside className="com-stack" style={{ gap: 16 }}>
          <section className="com-card com-stack">
            <h2 className="com-section-title">{tr("Planification", "Scheduling")}</h2>
            <div className="com-grid-2">
              <label className="com-field">
                {tr("Date", "Date")}
                <input type="date" className="com-input" value={item.date} onChange={(e) => changeDate(e.target.value)} />
              </label>
              <label className="com-field">
                {tr("Heure", "Time")}
                <input
                  type="time"
                  className="com-input"
                  value={item.heure || ""}
                  onChange={(e) => (e.target.value || null) !== item.heure && h.update({ heure: e.target.value || null })}
                />
              </label>
            </div>
            <span className="com-field">{tr("Canaux", "Channels")}</span>
            <div className="com-row">
              {CANAUX.map((c) => (
                <Toggle key={c} on={item.canaux.includes(c)} onClick={() => toggle("canaux", c)}>
                  {pick(CANAL_LABELS[c].label, lang)}
                </Toggle>
              ))}
            </div>
          </section>

          <section id="validation" className="com-card com-stack">
            <h2 className="com-section-title">{tr("Équipe et validation", "Team and approval")}</h2>
            <div className="com-row">
              {team.map((u) => (
                <Toggle key={u.uid} on={item.assigneUids.includes(u.uid)} onClick={() => toggle("assigneUids", u.uid)}>
                  <Avatar user={u} />
                  {memberName(u)}
                </Toggle>
              ))}
            </div>
            <ValidationPanel validation={item.validation} uid={uid} team={team} onRequest={h.requestValidation} onAnswer={h.answerValidation} />
          </section>

          {partners.length ? (
            <section className="com-card com-stack">
              <h2 className="com-section-title">{tr("Partenaires", "Partners")}</h2>
              <div className="com-row">
                {partners.map((p) => (
                  <Toggle key={p.id} on={item.partnerIds.includes(p.id)} onClick={() => toggle("partnerIds", p.id)}>
                    ★ {p.nom}
                  </Toggle>
                ))}
              </div>
              {selectedPartners.length ? (
                <div className="com-stack" style={{ gap: 6, fontSize: "0.88rem" }}>
                  {selectedPartners.flatMap((p) =>
                    ["logo", "mention"].map((k) => (
                      <label key={p.id + k} className="com-row">
                        <input
                          type="checkbox"
                          checked={Boolean(item.checks[`${p.id}:${k}`])}
                          onChange={(e) => h.update({ checks: { ...item.checks, [`${p.id}:${k}`]: e.target.checked } })}
                        />
                        {k === "logo"
                          ? tr(`Logo ${p.nom} présent sur le visuel`, `${p.nom} logo on the visual`)
                          : tr(`Mention ${p.handle || p.nom} dans le texte`, `${p.handle || p.nom} mentioned in the text`)}
                      </label>
                    )),
                  )}
                  <span className="com-muted" style={{ fontSize: "0.75rem" }}>
                    {tr(
                      "Une fois publiée, cette publication compte dans les contreparties du partenaire.",
                      "Once published, this publication counts towards the partner's benefits.",
                    )}
                  </span>
                </div>
              ) : null}
            </section>
          ) : null}

          <section className="com-card com-stack">
            <h2 className="com-section-title">{tr("Liens et notes", "Links and notes")}</h2>
            <label className="com-field">
              {tr("Événement", "Event")}
              <select className="com-input" value={item.eventId || ""} onChange={(e) => h.update({ eventId: e.target.value || null })}>
                <option value="">{tr("Aucun", "None")}</option>
                {events.map((ev) => (
                  <option key={ev.id} value={ev.id}>
                    {ev.titre}
                  </option>
                ))}
              </select>
            </label>
            <LinksPanel liens={item.liens} onChange={(liens) => h.update({ liens })} />
            <label className="com-field">
              {tr("Notes internes", "Internal notes")}
              <textarea
                className="com-input"
                maxLength={5000}
                placeholder={tr("Consignes, lien Drive… (non publié)", "Instructions, Drive link… (not published)")}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                onBlur={(e) => e.currentTarget.value !== item.notes && h.update({ notes: e.currentTarget.value })}
              />
            </label>
          </section>

          <section className="com-card com-stack">
            <h2 className="com-section-title">{tr("Après publication", "After publishing")}</h2>
            {item.canaux.includes("fb") || item.facebookPostId ? (
              <SocialPanel
                label="Facebook"
                account={tr("la page Facebook du meeting", "the meeting's Facebook page")}
                state={facebook}
                date={item.date}
                postId={item.facebookPostId}
                stats={(p) => facebookStats(p, lang)}
                extra={(p) =>
                  p.linkClicks
                    ? tr(`dont ${formatCount(p.linkClicks, locale)} clics sur le lien`, `incl. ${formatCount(p.linkClicks, locale)} link clicks`)
                    : null
                }
                // Un post lié est déjà en ligne : la publication passe en « Publié ».
                onLink={(id) => h.update(id ? { facebookPostId: id, statut: "done" } : { facebookPostId: null })}
              />
            ) : null}
            {item.canaux.includes("ig") || item.instagramMediaId ? (
              <SocialPanel
                label="Instagram"
                account="@cmcm_lux_indoor_meet"
                state={instagram}
                date={item.date}
                postId={item.instagramMediaId}
                stats={(p) => instagramStats(p, lang)}
                extra={(p) => (p.kind === "REELS" ? "Reel" : p.kind === "CAROUSEL_ALBUM" ? tr("Carrousel", "Carousel") : null)}
                onLink={(id) => h.update(id ? { instagramMediaId: id, statut: "done" } : { instagramMediaId: null })}
              />
            ) : null}
            <SiteLinkPanel siteUrl={item.siteUrl} onChange={(url) => h.update(url ? { siteUrl: url, statut: "done" } : { siteUrl: null })} />
          </section>

          {confirming ? (
            <div className="com-row">
              {isOccurrence ? tr("Retirer cette date du calendrier ?", "Remove this date from the calendar?") : tr("Supprimer définitivement ?", "Delete permanently?")}
              <button type="button" className="button button--danger-soft button--small" onClick={remove}>
                {tr("Confirmer", "Confirm")}
              </button>
              <button type="button" className="com-btn-ghost" onClick={() => setConfirming(false)}>
                {tr("Garder", "Keep")}
              </button>
            </div>
          ) : (
            <button type="button" className="button button--danger-soft button--small" style={{ alignSelf: "flex-start" }} onClick={() => setConfirming(true)}>
              {isOccurrence ? tr("Annuler cette date", "Cancel this date") : tr("Supprimer la publication", "Delete publication")}
            </button>
          )}
        </aside>
      </div>

      {moveTo && rubrique ? (
        <Dialog title={tr("Déplacer une rubrique récurrente", "Move a recurring series")} onClose={() => setMoveTo(null)}>
          <p style={{ margin: 0 }}>
            {lang === "fr" ? (
              <>
                <strong>{item.titre}</strong> passe du <strong>{fmtLong(item.date, lang)}</strong> au <strong>{fmtLong(moveTo, lang)}</strong>.
              </>
            ) : (
              <>
                <strong>{item.titre}</strong> moves from <strong>{fmtLong(item.date, lang)}</strong> to <strong>{fmtLong(moveTo, lang)}</strong>.
              </>
            )}
          </p>
          <button
            type="button"
            className="com-choice"
            onClick={() => {
              const to = moveTo;
              setMoveTo(null);
              h.update({ date: to }, tr(`Déplacée au ${fmtLong(to, lang)}, cette date seulement`, `Moved to ${fmtLong(to, lang)}, this date only`));
            }}
          >
            <strong>{tr("Seulement cette date", "This date only")}</strong>
            <span>
              {tr("Les autres dates restent :", "The other dates stay:")} {ruleText(ruleAt(rubrique, item.occurrenceDate || item.date))}.
            </span>
          </button>
          <button
            type="button"
            className="com-choice"
            onClick={() => {
              const to = moveTo;
              setMoveTo(null);
              // L'occurrence est réenregistrée sous l'identifiant de sa nouvelle date.
              h.run(() => moveSeries(item, rubrique, to, uid), tr("Récurrence déplacée à partir de cette date", "Series moved from this date on")).then(() =>
                navigate(`/app/communication/publication/${occurrenceId(rubrique.id, to)}`, { replace: true }),
              );
            }}
          >
            <strong>{tr("Toute la récurrence, à partir de cette date", "The whole series, from this date on")}</strong>
            <span>
              {tr("Nouveau rythme :", "New pattern:")}{" "}
              {ruleText(movedRule(ruleAt(rubrique, item.occurrenceDate || item.date), parseYmd(item.occurrenceDate || item.date), parseYmd(moveTo)))}
              {tr(". Les dates passées ne bougent pas.", ". Past dates stay as they are.")}
            </span>
          </button>
        </Dialog>
      ) : null}

      <Toast message={toast} />
    </div>
  );
}

/* ---------- Mini-calendrier ---------- */

function MiniCalendar({ current, uid, onHide }) {
  const navigate = useNavigate();
  const { lang, tr } = useComLang();
  const today = todayYmd();
  const [month, setMonth] = useState(() => ({ y: parseYmd(current.date).getFullYear(), m: parseYmd(current.date).getMonth() }));
  const [selected, setSelected] = useState(current.date);
  const [opening, setOpening] = useState(null);

  const days = useMemo(() => monthGridDays(month.y, month.m), [month]);
  const gridStart = ymd(days[0]);
  const gridEnd = ymd(days[days.length - 1]);
  const soon = ymd(addDays(parseYmd(today), 30));
  const start = gridStart < today ? gridStart : today;
  const end = gridEnd > soon ? gridEnd : soon;

  const { rubriques } = useRubriques();
  const publications = usePublications(start, end);
  const items = useMemo(() => buildCalendarItems({ rubriques, publications, start, end, today }), [rubriques, publications, start, end, today]);
  const byDate = useMemo(() => {
    const map = new Map();
    items.forEach((i) => map.set(i.date, [...(map.get(i.date) || []), i]));
    return map;
  }, [items]);
  const upcoming = items.filter((i) => i.date >= today && i.statut !== "done" && i.id !== current.id).slice(0, 5);
  const dayItems = byDate.get(selected) || [];

  async function open(item) {
    if (item.id === current.id) return;
    setOpening(item.id);
    try {
      if (!item.materialized) await updateItem(item, {}, uid);
      navigate(`/app/communication/publication/${item.id}`);
    } catch (error) {
      console.error(error);
      setOpening(null);
    }
  }

  const shift = (delta) => setMonth(({ y, m }) => ({ y: m + delta < 0 ? y - 1 : m + delta > 11 ? y + 1 : y, m: (m + delta + 12) % 12 }));
  const sel = parseYmd(selected);

  const row = (item, withDate) => (
    <button
      key={item.id}
      type="button"
      onClick={() => open(item)}
      aria-current={item.id === current.id ? "page" : undefined}
      disabled={opening !== null}
      className={`com-mini__row ${item.id === current.id ? "is-current" : ""}`}
    >
      {withDate ? <span className="com-mini__date">{fmtShort(item.date, lang)}</span> : null}
      <span className="com-dot" style={typeColor(item.type)} aria-hidden="true" />
      <span className="com-chip__title">{item.titre}</span>
      {withDate ? null : <span className="com-muted" style={{ fontSize: 11 }}>{pick(STATUT_LABELS[item.statut], lang)}</span>}
    </button>
  );

  return (
    <aside aria-label={tr("Mini-calendrier", "Mini calendar")} className="com-mini">
      <section className="com-card com-stack" style={{ gap: 8, padding: 12 }}>
        <div className="com-row" style={{ justifyContent: "space-between" }}>
          <button type="button" className="com-btn-ghost" onClick={() => shift(-1)} aria-label={tr("Mois précédent", "Previous month")}>
            ‹
          </button>
          <strong style={{ textTransform: "capitalize", fontSize: "0.9rem" }}>
            {monthName(month.m, lang)} {month.y}
          </strong>
          <button type="button" className="com-btn-ghost" onClick={() => shift(1)} aria-label={tr("Mois suivant", "Next month")}>
            ›
          </button>
        </div>
        <div className="com-mini__grid" aria-hidden="true">
          {gridDayNames(lang).map((j, i) => (
            <span key={i} className="com-mini__dow">
              {j.charAt(0)}
            </span>
          ))}
        </div>
        <div className="com-mini__grid">
          {days.map((d) => {
            const ds = ymd(d);
            const dayList = byDate.get(ds) || [];
            return (
              <button
                key={ds}
                type="button"
                onClick={() => setSelected(ds)}
                aria-pressed={ds === selected}
                aria-label={`${d.getDate()} ${monthName(d.getMonth(), lang)}, ${dayList.length} publication${dayList.length > 1 ? "s" : ""}`}
                className={`com-mini__day ${ds === selected ? "is-selected" : ds === today ? "is-today" : d.getMonth() !== month.m ? "is-out" : ""}`}
              >
                {d.getDate()}
                <span className="com-mini__dots">
                  {dayList.slice(0, 3).map((i) => (
                    <span key={i.id} style={typeColor(i.type)} />
                  ))}
                </span>
              </button>
            );
          })}
        </div>
        <button type="button" className="com-btn-ghost" style={{ alignSelf: "flex-start", fontSize: "0.75rem" }} onClick={onHide}>
          « {tr("Masquer le calendrier", "Hide calendar")}
        </button>
      </section>

      <section className="com-card com-stack" style={{ gap: 4, padding: 12 }}>
        <h2 className="com-section-title">
          {dayName(sel.getDay(), lang)} {sel.getDate()} {monthName(sel.getMonth(), lang)}
        </h2>
        {dayItems.length ? dayItems.map((i) => row(i, false)) : <p className="com-muted">{tr("Rien de prévu ce jour-là.", "Nothing planned that day.")}</p>}
      </section>

      <section className="com-card com-stack" style={{ gap: 4, padding: 12 }}>
        <h2 className="com-section-title">{tr("À préparer", "Coming up")}</h2>
        {upcoming.length ? upcoming.map((i) => row(i, true)) : <p className="com-muted">{tr("Tout est publié pour les 30 prochains jours.", "Everything is published for the next 30 days.")}</p>}
      </section>
    </aside>
  );
}

/* ---------- Texte du post ---------- */

// Enregistré automatiquement pendant la frappe (après une courte pause) et à la sortie du champ.
function PostTextEditor({ value, canaux, credit, mentions, onSave, onToast }) {
  const { lang, tr, locale } = useComLang();
  const [text, setText] = useState(value);
  // Dernière version reçue : si le texte n'a pas été modifié ici depuis, une version enregistrée
  // ailleurs (autre personne, autre onglet) la remplace.
  const [received, setReceived] = useState(value);
  if (value !== received) {
    setReceived(value);
    if (text === received) setText(value);
  }
  const saved = useRef(value);
  const area = useRef(null);
  const timer = useRef(null);
  const onSaveRef = useRef(onSave);
  const cursor = useRef(null);

  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);

  useEffect(() => {
    saved.current = value;
  }, [value]);

  function save(next) {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
    if (next === saved.current) return;
    saved.current = next;
    onSaveRef.current(next);
  }

  function change(next) {
    setText(next);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => save(next), 1200);
  }

  // Changement de page ou fermeture avant la fin de la pause : on enregistre quand même.
  useEffect(() => {
    const flush = () => timer.current && save(area.current?.value ?? "");
    window.addEventListener("beforeunload", flush);
    return () => {
      window.removeEventListener("beforeunload", flush);
      flush();
    };
  }, []);

  // Insère sur sa propre ligne, au curseur si on était dans le texte, sinon à la fin.
  function insert(snippet) {
    const el = area.current;
    const start = cursor.current?.start ?? text.length;
    const end = cursor.current?.end ?? text.length;
    const before = text.slice(0, start);
    const after = text.slice(end);
    const sep = before && !before.endsWith("\n") ? "\n" : "";
    const sepAfter = after && !after.startsWith("\n") ? "\n" : "";
    const next = before + sep + snippet + sepAfter + after;
    cursor.current = null;
    change(next);
    window.requestAnimationFrame(() => {
      const pos = (before + sep + snippet).length;
      el?.focus();
      el?.setSelectionRange(pos, pos);
    });
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      onToast(tr("Texte copié", "Text copied"));
    } catch {
      onToast(tr("Copie impossible", "Couldn't copy"));
    }
  }

  const counters = canaux.filter((c) => TEXT_LIMITS[c]).map((c) => ({ label: pick(CANAL_LABELS[c].label, lang), max: TEXT_LIMITS[c] }));

  return (
    <section className="com-card com-stack com-text-editor">
      <div className="com-row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
        <label htmlFor="post-texte">
          <strong style={{ fontSize: "1.1rem" }}>{tr("Texte du post", "Post text")}</strong>
        </label>
        <span className="com-counter">
          {counters.length
            ? counters.map((limit, i) => (
                <span key={limit.label} className={text.length > limit.max ? "com-counter is-over" : ""}>
                  {i ? " · " : ""}
                  {limit.label} {text.length.toLocaleString(locale)} / {limit.max.toLocaleString(locale)}
                </span>
              ))
            : `${text.length.toLocaleString(locale)} ${tr("caractères", text.length === 1 ? "character" : "characters")}`}
        </span>
      </div>
      <textarea
        id="post-texte"
        ref={area}
        rows={10}
        className="com-input"
        maxLength={10000}
        placeholder={tr("Le texte tel qu'il sera publié…", "The text exactly as it will be published…")}
        value={text}
        onChange={(e) => change(e.target.value)}
        onBlur={(e) => {
          cursor.current = { start: e.currentTarget.selectionStart, end: e.currentTarget.selectionEnd };
          save(e.currentTarget.value);
        }}
      />
      <div className="com-row">
        <span className="com-muted">{tr("Insérer :", "Insert:")}</span>
        <button type="button" className="com-toggle" disabled={!credit} onClick={() => credit && insert(credit)} title={credit || tr("Choisis d'abord des photos de la galerie", "Pick gallery photos first")}>
          {tr("Crédit photo", "Photo credit")}
        </button>
        <button
          type="button"
          className="com-toggle"
          disabled={!mentions.length}
          onClick={() => insert(mentions.join(" "))}
          title={mentions.length ? mentions.join(" ") : tr("Aucun partenaire coché", "No partner selected")}
        >
          {tr("Mentions des partenaires", "Partner mentions")}
        </button>
        <button type="button" className="com-toggle" onClick={() => insert(MEETING_HASHTAGS)} title={MEETING_HASHTAGS}>
          {tr("Hashtags du meeting", "Meeting hashtags")}
        </button>
        <button type="button" className="com-toggle" disabled={!text} onClick={copy}>
          {tr("Copier le texte", "Copy text")}
        </button>
      </div>
    </section>
  );
}

/* ---------- Visuel ---------- */

function VisuelPanel({ canvaUrl, visuelUrl, onCanva, onUpload, onRemove }) {
  const { tr } = useComLang();
  const [draft, setDraft] = useState(canvaUrl || "");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const input = useRef(null);

  function saveCanva(value) {
    const url = value.trim();
    if (url === (canvaUrl || "")) return setError(null);
    if (url && !/^https:\/\/\S+$/i.test(url)) return setError(tr("Colle le lien de partage complet (https://www.canva.com/…).", "Paste the full share link (https://www.canva.com/…)."));
    setError(null);
    return onCanva(url || null);
  }

  async function upload(file) {
    setBusy(true);
    setError(null);
    try {
      await onUpload(file);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="com-stack" style={{ gap: 10 }}>
      <h2 className="com-section-title">{tr("Visuel", "Visual")}</h2>
      <label className="com-field">
        {tr("Lien Canva", "Canva link")}
        <span className="com-row" style={{ flexWrap: "nowrap" }}>
          <input
            className="com-input"
            placeholder="https://www.canva.com/design/…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={(e) => saveCanva(e.currentTarget.value)}
          />
          {canvaUrl ? (
            <a href={canvaUrl} target="_blank" rel="noreferrer" className="button button--secondary button--small" style={{ whiteSpace: "nowrap" }}>
              {tr("Ouvrir ↗", "Open ↗")}
            </a>
          ) : null}
        </span>
      </label>

      {visuelUrl ? (
        <div className="com-visuel-preview">
          <a href={visuelUrl} target="_blank" rel="noreferrer">
            {isVideo(visuelUrl) ? <video src={visuelUrl} muted playsInline /> : <img src={visuelUrl} alt={tr("Visuel final", "Final visual")} />}
          </a>
          <div className="com-stack" style={{ gap: 4, alignItems: "flex-start" }}>
            <span className="com-muted">{tr("Visuel final", "Final visual")}</span>
            <button type="button" className="com-btn-ghost" disabled={busy} onClick={() => input.current?.click()}>
              {busy ? tr("Envoi…", "Uploading…") : tr("Remplacer", "Replace")}
            </button>
            <button type="button" className="com-btn-ghost is-danger" onClick={onRemove}>
              {tr("Retirer", "Remove")}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          disabled={busy}
          className="com-visuel-drop"
          onClick={() => input.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const file = e.dataTransfer.files[0];
            if (file) upload(file);
          }}
        >
          {busy
            ? tr("Envoi…", "Uploading…")
            : tr("Glisse ici le visuel exporté de Canva, ou clique pour le choisir", "Drop the visual exported from Canva here, or click to choose it")}
        </button>
      )}
      <input
        ref={input}
        type="file"
        accept={VISUEL_TYPES.join(",")}
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) upload(file);
        }}
      />
      {error ? <p className="com-error">{error}</p> : null}
    </div>
  );
}

/* ---------- Aperçu Instagram / Facebook ---------- */

function PostPreview({ texte, canaux, images, date }) {
  const { tr, locale } = useComLang();
  const networks = ["ig", "fb"].filter((c) => canaux.includes(c));
  const [chosen, setChosen] = useState(networks[0] || "ig");
  const tab = networks.includes(chosen) ? chosen : networks[0];
  if (!tab) return null;

  const caption = texte.trim() || tr("Le texte du post apparaîtra ici.", "The post text will appear here.");
  const day = new Date(`${date}T12:00:00`).toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long" });
  const media = images[0] ? (
    isVideo(images[0]) ? <video src={images[0]} muted playsInline /> : <img src={images[0]} alt="" />
  ) : (
    <span>{tr("Aucun visuel", "No visual")}</span>
  );

  return (
    <section className="com-card com-stack">
      <div className="com-row" style={{ justifyContent: "space-between" }}>
        <strong style={{ fontSize: "1.1rem" }}>{tr("Aperçu", "Preview")}</strong>
        {networks.length > 1 ? (
          <div className="com-segmented" role="group" aria-label={tr("Réseau", "Network")}>
            {networks.map((n) => (
              <button key={n} type="button" aria-pressed={tab === n} className={tab === n ? "is-on" : ""} onClick={() => setChosen(n)}>
                {n === "ig" ? "Instagram" : "Facebook"}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="com-post-preview" style={{ margin: "0 auto", width: "100%" }}>
        <div className="com-post-preview__head">
          <img className="com-post-preview__logo" src={cmcmLogo} alt="" />
          <span>
            {tab === "ig" ? ACCOUNT_HANDLE : ACCOUNT_NAME}
            {tab === "fb" ? (
              <span className="com-muted" style={{ display: "block", fontSize: "0.75rem", fontWeight: 400 }}>
                {day}
              </span>
            ) : null}
          </span>
        </div>
        {tab === "fb" ? <p className="com-post-preview__text">{caption}</p> : null}
        <div className="com-post-preview__media" style={tab === "fb" ? { aspectRatio: "1 / 1" } : undefined}>
          {media}
        </div>
        {tab === "ig" ? (
          <p className="com-post-preview__text">
            <strong>{ACCOUNT_HANDLE}</strong> {caption}
          </p>
        ) : null}
      </div>
      <p className="com-muted" style={{ textAlign: "center", fontSize: "0.75rem" }}>
        {tr("Aperçu indicatif : le rendu final dépend du réseau.", "Approximate preview: the final look depends on the network.")}
      </p>
    </section>
  );
}

/* ---------- Validation ---------- */

const fmtWhen = (ms, locale) => new Date(ms).toLocaleString(locale, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const ACTION_LABELS = {
  demande: { fr: "a demandé la validation", en: "requested approval" },
  validee: { fr: "a validé 👍", en: "approved 👍" },
  a_revoir: { fr: "demande de revoir 👎", en: "requested changes 👎" },
};

function ValidationPanel({ validation, uid, team, onRequest, onAnswer }) {
  const { lang, tr, locale } = useComLang();
  const admins = team.filter((u) => (u.userTypes || []).includes("admin") && u.uid !== uid);
  const others = team.filter((u) => u.uid !== uid);
  const [asking, setAsking] = useState(false);
  const [target, setTarget] = useState(admins.length ? "" : others[0]?.uid || "");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const teamById = new Map(team.map((u) => [u.uid, u]));
  const names = (uids) => uids.map((id) => (teamById.get(id) ? memberName(teamById.get(id)) : "?")).join(", ");
  const pending = validation?.etat === "demandee";
  const canAnswer = pending && validation.demandeeA.includes(uid);

  async function submit(action) {
    setBusy(true);
    try {
      await action();
      setText("");
      setAsking(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="com-stack" style={{ gap: 10 }}>
      <p className="com-section-title" style={{ margin: 0 }}>
        {tr("Validation", "Approval")}
      </p>
      {validation ? (
        <div className="com-row">
          <ValidationBadge validation={validation} />
          {pending ? <span className="com-muted">{tr("en attente de", "waiting for")} {names(validation.demandeeA)}</span> : null}
        </div>
      ) : null}

      {validation?.history?.length ? (
        <ol className="com-history">
          {validation.history.map((entry, i) => (
            <li key={i}>
              <strong>{entry.nom}</strong> {pick(ACTION_LABELS[entry.action], lang)}
              <span className="com-muted"> · {fmtWhen(entry.at, locale)}</span>
              {entry.message ? <p>« {entry.message} »</p> : null}
            </li>
          ))}
        </ol>
      ) : null}

      {canAnswer ? (
        <div className="com-validation-box is-answer">
          <textarea className="com-input" placeholder={tr("Commentaire (facultatif)", "Comment (optional)")} value={text} onChange={(e) => setText(e.target.value)} />
          <div className="com-row">
            <button type="button" disabled={busy} className="button button--secondary button--small" onClick={() => submit(() => onAnswer("validee", text))}>
              👍 {tr("Valider", "Approve")}
            </button>
            <button type="button" disabled={busy} className="button button--danger-soft button--small" onClick={() => submit(() => onAnswer("a_revoir", text))}>
              👎 {tr("À revoir", "Needs changes")}
            </button>
          </div>
        </div>
      ) : asking ? (
        <div className="com-validation-box">
          <label className="com-field">
            {tr("Demander à", "Ask")}
            <select className="com-input" value={target} onChange={(e) => setTarget(e.target.value)}>
              {admins.length ? <option value="">{`${tr("Administrateurs", "Admins")} (${admins.map(memberName).join(", ")})`}</option> : null}
              {others.map((u) => (
                <option key={u.uid} value={u.uid}>
                  {memberName(u)}
                </option>
              ))}
            </select>
          </label>
          <textarea className="com-input" placeholder={tr("Message (facultatif)", "Message (optional)")} value={text} onChange={(e) => setText(e.target.value)} />
          <div className="com-row">
            <button
              type="button"
              disabled={busy || (!target && !admins.length)}
              className="button button--primary button--small"
              onClick={() => submit(() => onRequest(target ? [target] : [], text))}
            >
              {busy ? tr("Envoi…", "Sending…") : tr("Envoyer la demande", "Send request")}
            </button>
            <button type="button" className="com-btn-ghost" onClick={() => setAsking(false)}>
              {tr("Annuler", "Cancel")}
            </button>
          </div>
          <span className="com-muted" style={{ fontSize: "0.75rem" }}>
            {tr("La personne reçoit un e-mail avec le lien de la publication.", "They'll get an email with a link to the publication.")}
          </span>
        </div>
      ) : (
        <button type="button" className="button button--secondary button--small" style={{ alignSelf: "flex-start" }} onClick={() => setAsking(true)}>
          {validation
            ? pending
              ? tr("Relancer la demande", "Send a reminder")
              : tr("Redemander la validation", "Request approval again")
            : tr("Demander la validation", "Request approval")}
        </button>
      )}
    </div>
  );
}

/* ---------- Liens de travail (visuels, SharePoint…) ---------- */

function LinksPanel({ liens, onChange }) {
  const { tr } = useComLang();
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [error, setError] = useState(null);

  function add(e) {
    e.preventDefault();
    const clean = url.trim();
    if (!/^https?:\/\/\S+$/i.test(clean)) return setError(tr("Colle l'adresse complète (https://…).", "Paste the full address (https://…)."));
    if (liens.some((l) => l.url === clean)) return setError(tr("Ce lien est déjà dans la liste.", "This link is already in the list."));
    setError(null);
    onChange([...liens, { label: label.trim().slice(0, 100) || linkLabel(clean), url: clean }]);
    setUrl("");
    setLabel("");
  }

  return (
    <div className="com-stack" style={{ gap: 8 }}>
      <span className="com-field">{tr("Liens (visuels, SharePoint, Drive…)", "Links (visuals, SharePoint, Drive…)")}</span>
      {liens.length ? (
        <ul className="com-links">
          {liens.map((l) => (
            <li key={l.url}>
              <a href={l.url} target="_blank" rel="noreferrer" className="com-link" title={l.url}>
                {l.label || linkLabel(l.url)} ↗
              </a>
              <button type="button" className="com-btn-ghost is-danger" aria-label={`${tr("Retirer le lien", "Remove link")} ${l.label}`} onClick={() => onChange(liens.filter((x) => x.url !== l.url))}>
                {tr("Retirer", "Remove")}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {liens.length < MAX_LIENS ? (
        <form className="com-stack" style={{ gap: 6 }} onSubmit={add}>
          <input className="com-input" type="url" placeholder="https://…" aria-label={tr("Adresse du lien", "Link address")} value={url} onChange={(e) => setUrl(e.target.value)} />
          <span className="com-row" style={{ flexWrap: "nowrap" }}>
            <input className="com-input" placeholder={tr("Libellé (facultatif)", "Label (optional)")} aria-label={tr("Libellé du lien", "Link label")} maxLength={100} value={label} onChange={(e) => setLabel(e.target.value)} />
            <button type="submit" className="button button--secondary button--small" disabled={!url.trim()}>
              {tr("Ajouter", "Add")}
            </button>
          </span>
        </form>
      ) : null}
      {error ? <p className="com-error">{error}</p> : null}
    </div>
  );
}

/* ---------- Lien de l'article publié ---------- */

function SiteLinkPanel({ siteUrl, onChange }) {
  const { tr } = useComLang();
  const [draft, setDraft] = useState(siteUrl || "");
  const [error, setError] = useState(null);

  function save() {
    const url = draft.trim();
    if (url === (siteUrl || "")) return;
    if (url && !/^https?:\/\/\S+$/i.test(url)) {
      setError(tr("Colle l'adresse complète (https://…).", "Paste the full address (https://…)."));
      return;
    }
    setError(null);
    onChange(url || null);
  }

  return (
    <div className="com-stack" style={{ gap: 6 }}>
      <label className="com-field">
        {tr("Lien de la publication en ligne (site, article…)", "Link to the live publication (website, article…)")}
        <span className="com-row" style={{ flexWrap: "nowrap" }}>
          <input className="com-input" placeholder="https://…" value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={save} />
          {siteUrl ? (
            <a href={siteUrl} target="_blank" rel="noreferrer" className="button button--secondary button--small">
              {tr("Ouvrir ↗", "Open ↗")}
            </a>
          ) : null}
        </span>
      </label>
      <span className="com-muted" style={{ fontSize: "0.75rem" }}>
        {tr("Ajouter un lien fait passer la publication en « Publié ».", 'Adding a link switches the publication to "Published".')}
      </span>
      {error ? <p className="com-error">{error}</p> : null}
    </div>
  );
}
