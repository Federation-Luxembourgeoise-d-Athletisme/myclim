import { useEffect, useMemo, useState } from "react";
import { useSiteEditionYear } from "../app/edition";
import { useMeetingEditions } from "../app/meeting-history-hooks";
import cmcmLogo from "../assets/cmcm-logo.png";
import waSilverLogo from "../assets/wa-indoor-tour-silver.png";
import { getNowOnTrack, isLiveDay, resolvePhotos } from "./links-page-config";
import { useLinksPageSettings, useSponsors } from "./site-hooks";
import { SponsorLogo } from "./sponsor-logo";
import "./site-links.css";

// Page « liens » grand public, derrière le QR code affiché à la Coque.
// Maquette validée : design/links/maquette-links.html.

const LANGUAGE_STORAGE_KEY = "myclim-links-language";
const CLOCK_REFRESH_MS = 30 * 1000;

const COPY = {
  fr: {
    live: "EN DIRECT",
    nowTitle: "Maintenant sur la piste",
    nextTitle: "Prochaines épreuves",
    fullTimetable: "Voir tout l'horaire →",
    results: "Résultats en direct",
    resultsSub: "Temps et classements, épreuve par épreuve",
    stream: "Regarder le direct",
    streamSub: "Le meeting en streaming",
    tickets: "Acheter des billets",
    secMeeting: "Le meeting",
    timetable: "Horaire",
    timetableSub: "Toutes les épreuves heure par heure",
    emag: "E-magazine",
    emagSub: "Athlètes, start lists, records",
    isNew: "Nouveau",
    photosCurrent: "Photos du meeting",
    photosFree: "Gratuites",
    photosCredit: "merci de créditer",
    secAccess: "Venir à la Coque",
    route: "Itinéraire",
    infos: "Infos pratiques",
    secFollow: "Nous suivre",
    secPartners: "Nos partenaires",
    contact: "Une question ?",
    site: "Site complet du meeting →",
    dateTbc: "Date à confirmer",
  },
  en: {
    live: "LIVE",
    nowTitle: "Now on the track",
    nextTitle: "Coming up",
    fullTimetable: "Full timetable →",
    results: "Live results",
    resultsSub: "Times and rankings, event by event",
    stream: "Watch live",
    streamSub: "The meeting on livestream",
    tickets: "Buy tickets",
    secMeeting: "The meeting",
    timetable: "Timetable",
    timetableSub: "Every event, hour by hour",
    emag: "E-magazine",
    emagSub: "Athletes, start lists, records",
    isNew: "New",
    photosCurrent: "Meeting photos",
    photosFree: "Free to use",
    photosCredit: "please credit",
    secAccess: "Getting to the Coque",
    route: "Directions",
    infos: "Practical info",
    secFollow: "Follow us",
    secPartners: "Our partners",
    contact: "Any question?",
    site: "Full meeting website →",
    dateTbc: "Date to be confirmed",
  },
};

function readInitialLanguage() {
  try {
    const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (stored === "fr" || stored === "en") return stored;
  } catch {
    // Stockage indisponible : on suit la langue du téléphone.
  }
  const browserLanguage = typeof navigator !== "undefined" ? String(navigator.language || "") : "";
  return browserLanguage.toLowerCase().startsWith("fr") ? "fr" : "en";
}

function formatEditionDate(value, language) {
  if (!value) return "";
  const date = value?.toDate ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(language === "fr" ? "fr-LU" : "en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Luxembourg",
  });
}

function eventLabel(entry) {
  return [entry.gender, entry.event, entry.round].filter(Boolean).join(" · ");
}

function ExternalLink({ href, className, children }) {
  return (
    <a className={className} href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

function LinkRow({ href, external = false, emoji, title, subtitle, tag }) {
  const content = (
    <>
      <span className="lk-row__icon" aria-hidden="true">{emoji}</span>
      <span className="lk-row__text">
        <b>{title}</b>
        {subtitle ? <small>{subtitle}</small> : null}
      </span>
      {tag ? <span className="lk-row__tag">{tag}</span> : <span className="lk-row__go" aria-hidden="true">›</span>}
    </>
  );
  return external ? (
    <ExternalLink className="lk-row" href={href}>{content}</ExternalLink>
  ) : (
    <a className="lk-row" href={href}>{content}</a>
  );
}

function HeroLink({ href, emoji, title, subtitle, dark = false }) {
  return (
    <ExternalLink className={`lk-hero-link ${dark ? "lk-hero-link--dark" : ""}`} href={href}>
      <span className="lk-hero-link__icon" aria-hidden="true">{emoji}</span>
      <span>
        <b>{title}</b>
        {subtitle ? <small>{subtitle}</small> : null}
      </span>
      <span className="lk-hero-link__go" aria-hidden="true">›</span>
    </ExternalLink>
  );
}

export function SiteLinks() {
  const { editions } = useMeetingEditions();
  const { siteEditionYear } = useSiteEditionYear();
  const { settings } = useLinksPageSettings();
  const { sponsors } = useSponsors(true);
  const [language, setLanguage] = useState(readInitialLanguage);
  const [now, setNow] = useState(() => new Date());
  const copy = COPY[language];
  const pick = (localized) => localized?.[language] || localized?.fr || localized?.en || "";

  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), CLOCK_REFRESH_MS);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    document.documentElement.lang = language;
    try {
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
    } catch {
      // Pas de stockage : la langue reste choisie pour cette visite.
    }
  }, [language]);

  const edition =
    (siteEditionYear && editions.find((item) => Number(item.year || item.id) === Number(siteEditionYear))) || editions[0] || null;
  const blocks = settings.blocks;
  const liveDay = isLiveDay(settings, edition, now);
  const resultsUrl = String(edition?.resultsUrl || "").trim();
  const streamUrl = String(edition?.streamingUrl || "").trim();
  const timetableVisible = edition?.timetableStatus === "visible" && Array.isArray(edition?.timetable) && edition.timetable.length > 0;
  const emagazinePublished = Boolean(edition) && (edition.emagazineStatus || "published") === "published";
  const photos = resolvePhotos(settings.photos);
  const nowOnTrack = useMemo(
    () => (liveDay && timetableVisible ? getNowOnTrack(edition.timetable, now) : null),
    [edition, liveDay, now, timetableVisible],
  );
  const showNow = blocks.now && nowOnTrack && (nowOnTrack.current || nowOnTrack.upcoming.length > 0);
  const venue = String(edition?.venue || "").trim() || "Coque, Luxembourg";
  const dateLabel = formatEditionDate(edition?.date, language) || copy.dateTbc;
  const partnerLogos = sponsors.filter((sponsor) => sponsor.logoUrl).slice(0, 12);
  const socialLinks = [
    { key: "instagram", emoji: "📷", label: "Instagram", url: settings.social.instagram },
    { key: "facebook", emoji: "👍", label: "Facebook", url: settings.social.facebook },
  ].filter((link) => link.url);
  const accessLines = [
    { emoji: "🚪", value: pick(settings.access.doors), strong: true },
    { emoji: "🚌", value: pick(settings.access.transport) },
    { emoji: "🅿️", value: pick(settings.access.parking) },
  ].filter((line) => line.value);

  return (
    <div className="lk-page">
      <div className={`lk-phone ${liveDay ? "lk-phone--live" : ""}`}>
        <header className="lk-header">
          <div className="lk-header__top">
            {liveDay ? (
              <span className="lk-live-pill">
                <i aria-hidden="true" />
                {copy.live}
              </span>
            ) : (
              <span />
            )}
            <div className="lk-lang" role="group" aria-label="Langue / Language">
              {["fr", "en"].map((code) => (
                <button
                  key={code}
                  type="button"
                  className={language === code ? "is-active" : ""}
                  aria-pressed={language === code}
                  onClick={() => setLanguage(code)}
                >
                  {code.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
          <div className="lk-brand">
            <div className="lk-brand__logo">
              <img src={cmcmLogo} alt="CMCM Luxembourg Indoor Meeting" />
            </div>
            <h1>
              CMCM Luxembourg
              <br />
              Indoor Meeting
            </h1>
            <p>
              {dateLabel} · {venue}
            </p>
          </div>
        </header>

        <main className="lk-main">
          {showNow ? (
            <section className="lk-card lk-now" aria-live="polite">
              <p className="lk-now__label">{nowOnTrack.current ? copy.nowTitle : copy.nextTitle}</p>
              <ul>
                {[nowOnTrack.current, ...nowOnTrack.upcoming].filter(Boolean).map((entry, index) => (
                  <li key={entry.id || `${entry.time}-${index}`} className={nowOnTrack.current && index === 0 ? "is-current" : ""}>
                    <b>{entry.time}</b>
                    <span>{eventLabel(entry)}</span>
                  </li>
                ))}
              </ul>
              <a href="/event#timetable">{copy.fullTimetable}</a>
            </section>
          ) : null}

          <div className="lk-hero-links">
            {liveDay && blocks.results && resultsUrl ? (
              <HeroLink href={resultsUrl} emoji="⏱️" title={copy.results} subtitle={copy.resultsSub} />
            ) : null}
            {liveDay && blocks.stream && streamUrl ? (
              <HeroLink href={streamUrl} emoji="📺" title={copy.stream} subtitle={copy.streamSub} dark />
            ) : null}
            {!liveDay && blocks.tickets && settings.tickets.url ? (
              <HeroLink href={settings.tickets.url} emoji="🎟️" title={copy.tickets} subtitle={pick(settings.tickets.note)} />
            ) : null}
          </div>

          {(blocks.timetable && timetableVisible) ||
          (blocks.emagazine && emagazinePublished) ||
          (blocks.photos && photos) ||
          (liveDay && blocks.tickets && settings.tickets.url) ? (
            <>
              <h2 className="lk-section-title">{copy.secMeeting}</h2>
              <div className="lk-list">
                {blocks.timetable && timetableVisible ? (
                  <LinkRow href="/event#timetable" emoji="🕒" title={copy.timetable} subtitle={copy.timetableSub} />
                ) : null}
                {blocks.emagazine && emagazinePublished ? (
                  <LinkRow href="/e-magazine" emoji="📖" title={copy.emag} subtitle={copy.emagSub} tag={copy.isNew} />
                ) : null}
                {blocks.photos && photos ? (
                  <LinkRow
                    href={photos.url}
                    external
                    emoji="📸"
                    title={photos.kind === "current" ? copy.photosCurrent : pick(settings.photos.previousLabel)}
                    subtitle={
                      photos.kind === "current" && photos.credit
                        ? `${copy.photosFree} — ${copy.photosCredit} ${photos.credit}`
                        : copy.photosFree
                    }
                  />
                ) : null}
                {liveDay && blocks.tickets && settings.tickets.url ? (
                  <LinkRow href={settings.tickets.url} external emoji="🎟️" title={copy.tickets} subtitle={pick(settings.tickets.dayNote)} />
                ) : null}
              </div>
            </>
          ) : null}

          {blocks.access && (accessLines.length || settings.access.mapsUrl || settings.access.infoUrl) ? (
            <>
              <h2 className="lk-section-title">{copy.secAccess}</h2>
              <section className="lk-card lk-access">
                {accessLines.map((line) => (
                  <p key={line.emoji}>
                    <span aria-hidden="true">{line.emoji}</span>
                    {line.strong ? <b>{line.value}</b> : <span>{line.value}</span>}
                  </p>
                ))}
                <div className="lk-access__buttons">
                  {settings.access.mapsUrl ? (
                    <ExternalLink className="lk-pill-button lk-pill-button--primary" href={settings.access.mapsUrl}>
                      {copy.route}
                    </ExternalLink>
                  ) : null}
                  {settings.access.infoUrl ? (
                    <a className="lk-pill-button" href={settings.access.infoUrl}>
                      {copy.infos}
                    </a>
                  ) : null}
                </div>
              </section>
            </>
          ) : null}

          {blocks.social && socialLinks.length ? (
            <>
              <h2 className="lk-section-title">{copy.secFollow}</h2>
              <div className="lk-social">
                {socialLinks.map((link) => (
                  <ExternalLink key={link.key} href={link.url}>
                    <span aria-hidden="true">{link.emoji}</span>
                    {link.label}
                  </ExternalLink>
                ))}
              </div>
            </>
          ) : null}

          {blocks.partners && partnerLogos.length ? (
            <>
              <h2 className="lk-section-title">{copy.secPartners}</h2>
              <section className="lk-card lk-partners">
                {partnerLogos.map((sponsor) => {
                  const logo = <SponsorLogo sponsor={sponsor} />;
                  return sponsor.website ? (
                    <ExternalLink key={sponsor.id} className="lk-partners__logo" href={sponsor.website}>
                      {logo}
                    </ExternalLink>
                  ) : (
                    <div key={sponsor.id} className="lk-partners__logo">
                      {logo}
                    </div>
                  );
                })}
              </section>
            </>
          ) : null}

          <footer className="lk-footer">
            {settings.contactEmail ? (
              <p>
                {copy.contact} <a href={`mailto:${settings.contactEmail}`}>{settings.contactEmail}</a>
              </p>
            ) : null}
            <a href="/">{copy.site}</a>
            <img src={waSilverLogo} alt="World Athletics Indoor Tour Silver" />
          </footer>
        </main>
      </div>
    </div>
  );
}
