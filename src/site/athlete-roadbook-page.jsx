import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { doc, onSnapshot } from "firebase/firestore";
import QRCode from "qrcode";
import { db } from "../services/firebase";
import { buildAppUrl } from "../services/app-url";
import { useSiteEditionYear } from "../app/edition";
import { inferEditionDisplayNumber } from "../app/meeting-edition-utils";
import meetingEditionsSeed from "../data/meetingEditions.json";
import { useMeetingEditions } from "../app/meeting-history-hooks";
import {
  CALL_TIME_COLUMNS,
  ROADBOOK_COLLECTION,
  formatScheduleDay,
  getScheduleIconEmoji,
  normalizeRoadbook,
  pickText,
  splitLines,
} from "../app/athlete-roadbook-shared";
import cmcmLogo from "../assets/cmcm-logo.png";
import waLogo from "../assets/wa-indoor-tour-silver.png";
import accreditationPlanUrl from "../assets/accreditation-plan.png";
import { AthleteHubSections } from "./athlete-hub-sections";
import "./athlete-roadbook.css";

const COPY = {
  en: {
    title: "Athletes roadbook",
    titleLead: "Athletes",
    titleAccent: "roadbook",
    eyebrow: "Athletes information",
    edition: "Edition",
    loading: "Loading the roadbook…",
    unavailable: "The roadbook for this edition is not available yet.",
    draftBanner: "Draft preview: athletes can't see this page until it's published.",
    print: "Print / save as PDF",
    emergency: "Emergency contact",
    sections: {
      arrival: ["Travel", "Arrival & departure"],
      schedule: ["Your stay", "Athlete schedule"],
      competition: ["Rules", "Competition information"],
      venue: ["Venue", "The Coque"],
      timetable: ["Competition day", "Timetable"],
      calltimes: ["Call room", "Call times"],
      links: ["Follow the meeting", "Photos & links"],
    },
    nav: {
      arrival: "Arrival & departure",
      schedule: "Athlete schedule",
      competition: "Competition info",
      venue: "The Coque",
      timetable: "Timetable",
      calltimes: "Call times",
      links: "Photos & links",
    },
    fromAirport: "From Findel Airport",
    toAirport: "To Findel Airport",
    tramHours: "Tram hours",
    fromTrainStation: "From the train station",
    toTrainStation: "To the train station",
    day: (offset) => (offset === 0 ? "Competition day" : `Day ${offset > 0 ? "+" : "−"}${Math.abs(offset)}`),
    accessZones: "Access zones",
    timetableEmpty: "The timetable will be published soon.",
    callTimesEmpty: "Call times will be published soon.",
    filters: { all: "All events", women: "Women", men: "Men" },
    livePhotos: "Live photos",
    emagazine: "E-magazine",
    liveResults: "Live results",
    open: { photos: "Open the gallery →", emagazine: "Read online →", results: "Follow live →" },
    women: "Women",
    men: "Men",
    field: "Field",
  },
  fr: {
    title: "Roadbook athlètes",
    titleLead: "Roadbook",
    titleAccent: "athlètes",
    eyebrow: "Informations athlètes",
    edition: "Édition",
    loading: "Chargement du roadbook…",
    unavailable: "Le roadbook de cette édition n'est pas encore disponible.",
    draftBanner: "Aperçu du brouillon : les athlètes ne voient pas cette page tant qu'elle n'est pas publiée.",
    print: "Imprimer / enregistrer en PDF",
    emergency: "Contact d'urgence",
    sections: {
      arrival: ["Voyage", "Arrivée & départ"],
      schedule: ["Ton séjour", "Programme des athlètes"],
      competition: ["Règlement", "Informations compétition"],
      venue: ["Le lieu", "La Coque"],
      timetable: ["Jour de compétition", "Horaire"],
      calltimes: ["Chambre d'appel", "Call times"],
      links: ["Suivre le meeting", "Photos & liens"],
    },
    nav: {
      arrival: "Arrivée & départ",
      schedule: "Programme",
      competition: "Compétition",
      venue: "La Coque",
      timetable: "Horaire",
      calltimes: "Call times",
      links: "Photos & liens",
    },
    fromAirport: "Depuis l'aéroport du Findel",
    toAirport: "Vers l'aéroport du Findel",
    tramHours: "Horaires du tram",
    fromTrainStation: "Depuis la gare",
    toTrainStation: "Vers la gare",
    day: (offset) => (offset === 0 ? "Jour de compétition" : `J${offset > 0 ? "+" : "−"}${Math.abs(offset)}`),
    accessZones: "Zones d'accès",
    timetableEmpty: "L'horaire sera publié prochainement.",
    callTimesEmpty: "Les call times seront publiés prochainement.",
    filters: { all: "Toutes les épreuves", women: "Femmes", men: "Hommes" },
    livePhotos: "Photos en direct",
    emagazine: "E-magazine",
    liveResults: "Résultats en direct",
    open: { photos: "Voir la galerie →", emagazine: "Lire en ligne →", results: "Suivre en direct →" },
    women: "Femmes",
    men: "Hommes",
    field: "Concours",
  },
};

const SECTION_IDS = ["arrival", "schedule", "competition", "venue", "timetable", "calltimes", "links"];
const HUB_SECTION_IDS = ["physio", "tickets"];

function LineList({ text, className = "" }) {
  const lines = splitLines(text);
  if (!lines.length) return null;
  if (lines.length === 1) return <p className={className}>{lines[0]}</p>;
  return (
    <ul className={className}>
      {lines.map((line) => (
        <li key={line}>{line}</li>
      ))}
    </ul>
  );
}

function useQrDataUrl(url) {
  const [generated, setGenerated] = useState({ url: "", dataUrl: "" });
  useEffect(() => {
    if (!url) return undefined;
    let cancelled = false;
    QRCode.toDataURL(url, { margin: 1, width: 240 })
      .then((dataUrl) => !cancelled && setGenerated({ url, dataUrl }))
      .catch(() => !cancelled && setGenerated({ url, dataUrl: "" }));
    return () => {
      cancelled = true;
    };
  }, [url]);
  return generated.url === url ? generated.dataUrl : "";
}

function QrLink({ url, emoji, label, action }) {
  const qr = useQrDataUrl(url);
  if (!url) return null;
  return (
    <a className="rb-link" href={url} target="_blank" rel="noreferrer">
      {qr ? <img className="rb-link__qr" src={qr} alt="" /> : <span className="rb-link__qr" />}
      <b>{emoji} {label}</b>
      <span>{action}</span>
    </a>
  );
}

function SectionHead({ index, eyebrow, title }) {
  return (
    <div className="rb-sh">
      <p className="rb-eyebrow">{String(index + 1).padStart(2, "0")} · {eyebrow}</p>
      <h2>{title}</h2>
    </div>
  );
}

function formatEditionDate(value, language) {
  const date = value?.toDate?.() || (value ? new Date(value) : null);
  if (!date || Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(language === "fr" ? "fr-LU" : "en-GB", { day: "numeric", month: "long", year: "numeric" });
}

function callTimeMatchesFilter(row, filter) {
  if (filter === "all") return true;
  const event = ` ${String(row.event || "").toLowerCase()} `;
  const isWomen = /\b(women|woman|femmes?|w)\b/.test(event);
  const isMen = /\b(men|man|hommes?|m)\b/.test(event);
  return filter === "women" ? isWomen : isMen && !isWomen;
}

function AthleteRoadbookPage() {
  const location = useLocation();
  // Le roadbook est en anglais (athlètes internationaux).
  const language = "en";
  const { siteEditionYear, loading: siteYearLoading } = useSiteEditionYear();
  const { editions, loading: editionsLoading } = useMeetingEditions();
  // { editionId, data, exists } du dernier snapshot reçu ; l'état affiché en est déduit.
  const [snapshotState, setSnapshotState] = useState(null);
  const [activeSection, setActiveSection] = useState(SECTION_IDS[0]);
  const [callTimeFilter, setCallTimeFilter] = useState("all");
  const copy = COPY.en;

  const edition = useMemo(() => {
    const configured = siteEditionYear
      ? editions.find((candidate) => Number(candidate.year || candidate.id) === Number(siteEditionYear))
      : null;
    return configured || editions[0] || null;
  }, [editions, siteEditionYear]);

  const editionId = edition ? String(edition.id) : "";

  useEffect(() => {
    if (!editionId) return undefined;
    const unsubscribe = onSnapshot(
      doc(db, ROADBOOK_COLLECTION, editionId),
      (snapshot) => setSnapshotState({ editionId, data: snapshot.exists() ? snapshot.data() : null }),
      // Brouillon non publié et visiteur non gestionnaire : refusé par les règles.
      () => setSnapshotState({ editionId, data: null }),
    );
    return unsubscribe;
  }, [editionId]);

  const storedRoadbook = snapshotState?.editionId === editionId ? snapshotState.data : null;
  let roadbookState = "loading";
  if (!siteYearLoading && !editionsLoading) {
    if (!editionId) roadbookState = "missing";
    else if (snapshotState?.editionId === editionId) roadbookState = storedRoadbook ? "ready" : "missing";
  }
  const previewMode = new URLSearchParams(location.search).get("preview") === "1";
  // En développement local seulement : ?preview=1 sans roadbook enregistré
  // affiche le contenu par défaut, pour travailler la mise en page.
  if (roadbookState === "missing" && previewMode && import.meta.env.DEV) roadbookState = "ready";

  const roadbook = useMemo(() => normalizeRoadbook(storedRoadbook), [storedRoadbook]);
  const labels = roadbook.labels;
  const pageTitle = `${labels.titleLead} ${labels.titleAccent}`.trim() || copy.title;

  // Sections affichées, dans l'ordre : sections fixes visibles, puis sections
  // libres juste avant « Photos & links ».
  const visibleSections = useMemo(() => {
    const fixed = SECTION_IDS.filter((id) => roadbook.sections[id]?.visible !== false).map((id) => ({
      id,
      kind: "fixed",
      eyebrow: roadbook.sections[id].eyebrow,
      title: roadbook.sections[id].title,
      nav: roadbook.sections[id].nav || roadbook.sections[id].title,
    }));
    const extras = roadbook.extraSections
      .filter((section) => section.visible !== false && (section.title || section.text))
      .map((section) => ({ ...section, kind: "extra", nav: section.title }));
    const linksIndex = fixed.findIndex((section) => section.id === "links");
    if (linksIndex < 0) return [...fixed, ...extras];
    return [...fixed.slice(0, linksIndex), ...extras, ...fixed.slice(linksIndex)];
  }, [roadbook]);

  useEffect(() => {
    document.title = `${pageTitle} · CMCM Luxembourg Indoor Meeting`;
  }, [pageTitle]);

  // Menu de gauche : la partie en cours de lecture s'allume pendant le défilement.
  useEffect(() => {
    if (roadbookState !== "ready") return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) setActiveSection(entry.target.id);
        });
      },
      { rootMargin: "-35% 0px -60% 0px" },
    );
    [...visibleSections.map((section) => section.id), ...HUB_SECTION_IDS].forEach((id) => {
      const element = document.getElementById(id);
      if (element) observer.observe(element);
    });
    return () => observer.disconnect();
  }, [roadbookState, visibleSections]);

  // Lien direct vers une réservation (/roadbook#physio) : on y descend une
  // fois la page affichée (le contenu arrive après le premier rendu).
  useEffect(() => {
    if (roadbookState !== "ready" || !location.hash) return undefined;
    const timer = window.setTimeout(() => {
      document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 150);
    return () => window.clearTimeout(timer);
  }, [roadbookState, location.hash]);

  const isDraft = roadbook.status !== "published";
  const t = (value) => pickText(value, language);

  if (roadbookState === "loading") {
    return (
      <div className="rb-empty">
        <p>{copy.loading}</p>
      </div>
    );
  }

  if (roadbookState === "missing" || (isDraft && !previewMode)) {
    return (
      <div className="rb-empty">
        <img src={cmcmLogo} alt="CMCM Luxembourg Indoor Meeting" />
        <h1>{copy.title}</h1>
        <p>{copy.unavailable}</p>
      </div>
    );
  }

  const editionNumber = inferEditionDisplayNumber(edition, [...editions, ...meetingEditionsSeed]);
  const editionDate = formatEditionDate(edition?.date, language);
  const timetable = Array.isArray(edition?.timetable) ? edition.timetable : [];
  const liveResultsUrl = roadbook.links.liveResultsUrl || edition?.resultsUrl || "";
  const emagazineUrl = roadbook.links.emagazineUrl || buildAppUrl("/e-magazine");
  const emergencyHref = roadbook.emergency.phone ? `tel:${roadbook.emergency.phone.replace(/[^\d+]/g, "")}` : "";
  const emergencyLabel = t(roadbook.emergency.label) || labels.emergency;
  const zones = splitLines(t(roadbook.venue.zones));
  // Plan : celui du dos des badges d'accréditation (zones numérotées 1 à 6),
  // sauf si un plan propre au roadbook a été choisi.
  const planUrl = roadbook.venue.source === "custom" ? roadbook.venue.planImageUrl : accreditationPlanUrl;
  const callTimes = roadbook.callTimes.filter((row) => callTimeMatchesFilter(row, callTimeFilter));
  const extraTicketsUrl = roadbook.bookings.extraTicketsUrl;
  const head = (section, index) => <SectionHead index={index} eyebrow={section.eyebrow} title={section.title} />;

  function renderSection(section, index) {
    switch (section.id) {
      case "arrival":
        return (
          <section key={section.id} id="arrival" className="rb-section">
            {head(section, index)}
            {t(roadbook.arrival.meetingPoint) ? <p className="rb-lead">{t(roadbook.arrival.meetingPoint)}</p> : null}
            {roadbook.arrival.airportMapUrl ? <img className="rb-map" src={roadbook.arrival.airportMapUrl} alt="" /> : null}
            <div className="rb-grid">
              <article className="rb-card">
                <h3><span className="rb-ico">✈️</span>{labels.fromAirport}</h3>
                <LineList text={t(roadbook.arrival.fromAirport)} />
              </article>
              <article className="rb-card rb-card--dark">
                <h3><span className="rb-ico">🚊</span>{labels.tramHours}</h3>
                <LineList text={t(roadbook.arrival.tramHours)} />
              </article>
              <article className="rb-card">
                <h3><span className="rb-ico">✈️</span>{labels.toAirport}</h3>
                <LineList text={t(roadbook.arrival.toAirport)} />
              </article>
            </div>
            {roadbook.arrival.trainStationMapUrl ? <img className="rb-map" src={roadbook.arrival.trainStationMapUrl} alt="" /> : null}
            <div className="rb-grid">
              <article className="rb-card">
                <h3><span className="rb-ico">🚆</span>{labels.fromTrainStation}</h3>
                <LineList text={t(roadbook.arrival.fromTrainStation)} />
              </article>
              <article className="rb-card">
                <h3><span className="rb-ico">🚆</span>{labels.toTrainStation}</h3>
                <LineList text={t(roadbook.arrival.toTrainStation)} />
              </article>
            </div>
          </section>
        );
      case "schedule":
        return (
          <section key={section.id} id="schedule" className="rb-section">
            {head(section, index)}
            <div className="rb-days">
              {roadbook.schedule.map((day) => (
                <article key={day.id} className={`rb-day ${day.highlight ? "rb-day--comp" : ""}`}>
                  <div className="rb-day__head">
                    <p className="rb-eyebrow">{copy.day(day.offsetDays)}</p>
                    <strong>{formatScheduleDay(edition?.date, day.offsetDays, language)}</strong>
                    {t(day.access) ? <p className="rb-day__access">🚪 {t(day.access)}</p> : null}
                  </div>
                  <ul className="rb-day__items">
                    {day.items.map((item) => (
                      <li key={item.id}>
                        <span className="rb-ico" aria-hidden="true">{getScheduleIconEmoji(item.icon)}</span>
                        <div>
                          <b>{t(item.title)}</b>
                          <LineList text={t(item.lines)} className="rb-day__lines" />
                        </div>
                      </li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          </section>
        );
      case "competition":
        return (
          <section key={section.id} id="competition" className="rb-section">
            {head(section, index)}
            <dl className="rb-rules">
              {roadbook.competitionInfo.map((entry) => (
                <div key={entry.id} className="rb-rule">
                  <dt>{t(entry.event)}</dt>
                  <dd>{t(entry.rule)}</dd>
                </div>
              ))}
            </dl>
          </section>
        );
      case "venue":
        return (
          <section key={section.id} id="venue" className="rb-section">
            {head(section, index)}
            {t(roadbook.venue.intro) ? <LineList text={t(roadbook.venue.intro)} className="rb-lead" /> : null}
            <div className={`rb-venue ${planUrl ? "" : "rb-venue--noplan"}`}>
              {zones.length ? (
                <div className="rb-zones">
                  <h3>{labels.accessZones}</h3>
                  <ol>
                    {zones.map((zone) => (
                      <li key={zone}>{zone}</li>
                    ))}
                  </ol>
                </div>
              ) : null}
              {planUrl ? <img className="rb-plan" src={planUrl} alt={section.title} /> : null}
            </div>
          </section>
        );
      case "timetable":
        return (
          <section key={section.id} id="timetable" className="rb-section rb-section--break">
            {head(section, index)}
            {timetable.length && edition?.timetableNote ? <p className="rb-muted">{edition.timetableNote}</p> : null}
            {timetable.length ? (
              <table className="rb-table rb-timetable">
                <tbody>
                  {timetable.map((row) =>
                    row.type === "header" ? (
                      <tr key={row.id} className="rb-table__head">
                        {row.time ? <td>{row.time}</td> : null}
                        <td colSpan={row.time ? 2 : 3}>{row.label}</td>
                      </tr>
                    ) : (
                      <tr key={row.id}>
                        <td className="rb-timetable__time">{row.time || "—"}</td>
                        <td className="rb-timetable__gender">
                          {row.gender === "WOMEN" ? copy.women : row.gender === "MEN" ? copy.men : row.gender || ""}
                        </td>
                        <td>
                          {row.type === "info" ? <i>{row.label}</i> : row.isField ? <b>{row.event}</b> : row.event}
                          {row.round ? ` ${row.round}` : ""}
                          {row.isField ? <span className="rb-tag">{copy.field}</span> : null}
                        </td>
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            ) : (
              <p className="rb-muted">{labels.timetableEmpty}</p>
            )}
          </section>
        );
      case "calltimes":
        return (
          <section key={section.id} id="calltimes" className="rb-section rb-section--break">
            {head(section, index)}
            {roadbook.callTimes.length ? (
              <>
                <div className="rb-filters" role="group">
                  {Object.entries(copy.filters).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      className={callTimeFilter === value ? "rb-filters--on" : ""}
                      aria-pressed={callTimeFilter === value}
                      onClick={() => setCallTimeFilter(value)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="rb-table-wrap">
                  <table className="rb-table rb-calltimes">
                    <thead>
                      <tr>
                        {CALL_TIME_COLUMNS.map((column) => (
                          <th key={column.key}>{column.label.en}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {callTimes.map((row) => (
                        <tr key={row.id || row.event}>
                          {CALL_TIME_COLUMNS.map((column) => (
                            <td
                              key={column.key}
                              className={column.key === "officialCall" || column.key === "start" ? "rb-calltimes__key" : ""}
                            >
                              {column.key === "event" ? <b>{row.event}</b> : row[column.key] || ""}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <p className="rb-muted">{labels.callTimesEmpty}</p>
            )}
          </section>
        );
      case "links":
        return (
          <section key={section.id} id="links" className="rb-section">
            {head(section, index)}
            {t(roadbook.photos.text) ? <p>{t(roadbook.photos.text)}</p> : null}
            <div className="rb-links">
              <QrLink url={roadbook.photos.url} emoji="📸" label={labels.livePhotos} action={copy.open.photos} />
              <QrLink url={emagazineUrl} emoji="📖" label={labels.emagazine} action={copy.open.emagazine} />
              <QrLink url={liveResultsUrl} emoji="⏱️" label={labels.liveResults} action={copy.open.results} />
              {emergencyHref ? (
                <a className="rb-link" href={emergencyHref}>
                  <span className="rb-link__sos" aria-hidden="true">🆘</span>
                  <b>{emergencyLabel}</b>
                  <span>
                    {roadbook.emergency.name ? `${roadbook.emergency.name} · ` : ""}
                    {roadbook.emergency.phone}
                  </span>
                </a>
              ) : null}
            </div>
          </section>
        );
      default:
        // Section libre ajoutée dans le back office.
        return (
          <section key={section.id} id={section.id} className="rb-section">
            {head(section, index)}
            <LineList text={section.text} className="rb-lead" />
            {section.imageUrl ? <img className="rb-map" src={section.imageUrl} alt="" /> : null}
            {section.linkUrl ? (
              <p>
                <a className="rb-quick__btn" href={section.linkUrl} target="_blank" rel="noreferrer">
                  {section.linkLabel || section.linkUrl} →
                </a>
              </p>
            ) : null}
          </section>
        );
    }
  }

  return (
    <div className="rb" lang={language}>
      <aside className="rb-side">
        <div className="rb-brand">
          <img src={cmcmLogo} alt="CMCM Luxembourg Indoor Meeting" />
          <p>{pageTitle}</p>
        </div>
        <nav className="rb-nav" aria-label={pageTitle}>
          <ol>
            {visibleSections.map((section, index) => (
              <li key={section.id}>
                <a href={`#${section.id}`} className={activeSection === section.id ? "rb-nav--active" : ""}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  {section.nav}
                </a>
              </li>
            ))}
          </ol>
          <p className="rb-nav__group">{labels.bookingsEyebrow}</p>
          <ol>
            {HUB_SECTION_IDS.map((id) => (
              <li key={id}>
                <a href={`#${id}`} className={activeSection === id ? "rb-nav--active" : ""}>
                  <span aria-hidden="true">{id === "physio" ? "💆" : "🎟️"}</span>
                  {id === "physio" ? labels.physioTitle : labels.ticketsTitle}
                </a>
              </li>
            ))}
          </ol>
        </nav>
        <div className="rb-side__foot">
          <button type="button" className="rb-print" onClick={() => window.print()}>
            🖨️ {copy.print}
          </button>
          {emergencyHref ? (
            <a className="rb-sos" href={emergencyHref}>
              <span aria-hidden="true">🆘</span>
              <div>
                <small>{emergencyLabel}</small>
                <strong>{roadbook.emergency.phone}</strong>
              </div>
            </a>
          ) : null}
        </div>
      </aside>

      <main className="rb-main">
        {isDraft ? <p className="rb-draft">{copy.draftBanner}</p> : null}

        <header className="rb-hero">
          <div>
            <p className="rb-eyebrow">
              {labels.heroEyebrow}
              {editionNumber ? ` · ${copy.edition} ${editionNumber}` : ""}
            </p>
            <h1>
              {labels.titleLead} <em>{labels.titleAccent}</em>
            </h1>
            {t(roadbook.intro) ? <p className="rb-hero__sub">{t(roadbook.intro)}</p> : null}
            <div className="rb-hero__meta">
              {editionDate ? <span>📅 {editionDate}</span> : null}
              {edition?.venue ? <span>📍 {edition.venue}</span> : null}
              {roadbook.hotel ? <span>🏨 {roadbook.hotel}</span> : null}
            </div>
            {/* Accès directs aux réservations (kiné, places invités, places en plus). */}
            <div className="rb-quick">
              <a className="rb-quick__btn rb-quick__btn--primary" href="#physio">💆 {labels.quickPhysio}</a>
              <a className="rb-quick__btn" href="#tickets">🎟️ {labels.quickTickets}</a>
              {extraTicketsUrl ? (
                <a className="rb-quick__btn" href={extraTicketsUrl} target="_blank" rel="noreferrer">
                  ➕ {roadbook.bookings.extraTicketsLabel || extraTicketsUrl}
                </a>
              ) : null}
            </div>
          </div>
          <img className="rb-hero__wa" src={waLogo} alt="World Athletics Indoor Tour Silver" />
        </header>

        {visibleSections.map((section, index) => renderSection(section, index))}

        <AthleteHubSections
          language={language}
          indexOffset={visibleSections.length}
          overrides={{ eyebrow: labels.bookingsEyebrow, physioTitle: labels.physioTitle, ticketsTitle: labels.ticketsTitle }}
        />
        {extraTicketsUrl ? (
          <p className="rb-extra-tickets">
            <a className="rb-quick__btn" href={extraTicketsUrl} target="_blank" rel="noreferrer">
              ➕ {roadbook.bookings.extraTicketsLabel || extraTicketsUrl}
            </a>
          </p>
        ) : null}
      </main>
    </div>
  );
}

export { AthleteRoadbookPage };
