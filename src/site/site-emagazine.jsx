import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useActiveEdition, useSiteEditionYear } from "../app/edition";
import { useAthleteRegistry, useAthletes } from "../app/athlete-portal-hooks";
import { useMeetingEditions, useMeetingRecords } from "../app/meeting-history-hooks";
import { useSponsors } from "./site-hooks";
import { normalizeSponsorCategory, sponsorCategoryLabel } from "./sponsor-utils";
// Same key visual as the website home hero: default visual of the cover.
import coverVisual from "../assets/hero-banner.jpg";
import meetingLogo from "../assets/cmcm-logo.png";
import waSilverLogo from "../assets/wa-indoor-tour-silver.png";
import venueImage from "../assets/site-gallery/Coque2026.jpg";
// Race in front of a full stand (website gallery): banner of the timetable page.
import timetablePhoto from "../assets/site-gallery/ambiance-1.jpg";
import preprogInfluencer from "../assets/site-gallery/preprog-influencer.jpg";
import preprogGforster from "../assets/site-gallery/preprog-gforster.jpg";
import preprogNational60m from "../assets/site-gallery/preprog-national-60m.jpg";
import preprogBusiness1 from "../assets/site-gallery/preprog-business-1.jpg";
import preprogBusiness2 from "../assets/site-gallery/preprog-business-2.jpg";
// Photo booth in front of the partners' wall: banner of the sponsor page.
import sponsorsPhoto from "../assets/site-gallery/gallery-memories.jpg";
import flaLogo from "../assets/fla-logo.png";
// Volunteers on the track: default photo of the closing "Thank you" page.
import thanksPhoto from "../assets/site-gallery/gallery-volunteers.jpg";
import flaClubsQr from "../assets/fla-clubs-qr.png";
import flaClubs from "../data/flaClubs.json";
import { SponsorLogo } from "./sponsor-logo";
import {
  athleteDisplayName,
  buildAthleteLookup,
  buildOfficialStartlistGroups,
  buildSpecialRaceStartlistGroups,
  disciplineSortIndex,
  findMeetingRecord,
  normalizeEmagazineConfig,
  parseEventField,
} from "./site-emagazine-shared";
import {
  PAGE_VIEW_DELAY_MS,
  trackEmagazineOpen,
  trackEmagazinePageView,
  trackEmagazinePrint,
} from "./emagazine-stats";
import { nationFlagUrl } from "./nation-flags";
import europeanRecords from "../data/europeanRecords.json";

// Every page is laid out on a real A4 sheet (210 × 297 mm at 96 dpi, the size
// used when printing) and scaled down as a whole to fit the screen, so the
// magazine keeps the exact same A4 proportions on every device.
const A4_PAGE_WIDTH = 794;
const A4_PAGE_HEIGHT = 1123;

function useA4PageScale(shellNode) {
  const [scale, setScale] = useState(0.5);

  useEffect(() => {
    if (!shellNode) return undefined;
    const compact = window.matchMedia("(max-width: 960px)");
    function measure() {
      // Desktop: fit the reader height and leave room for the side arrows.
      // Compact: the page follows the width and the reader scrolls.
      const availableWidth = shellNode.clientWidth - (compact.matches ? 0 : 120);
      const availableHeight = compact.matches ? Infinity : shellNode.clientHeight - 64;
      setScale(Math.max(0.2, Math.min(availableWidth / A4_PAGE_WIDTH, availableHeight / A4_PAGE_HEIGHT, 1.25)));
    }
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(shellNode);
    compact.addEventListener("change", measure);
    return () => {
      observer.disconnect();
      compact.removeEventListener("change", measure);
    };
  }, [shellNode]);

  return scale;
}

function formatEditionDate(value) {
  if (!value) return "To be confirmed";
  const date = value?.toDate ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) return "To be confirmed";
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function buildDefaultWelcomeBody(edition, disciplinesCount) {
  const date = formatEditionDate(edition?.date);
  const venue = edition?.venue || "Coque, Luxembourg";
  return `Welcome to the CMCM Luxembourg Indoor Meeting ${edition?.year || ""}. This edition brings together a strong international field in ${disciplinesCount} official disciplines at ${venue} on ${date}. The e-magazine will keep growing automatically as start lists are updated in MyCLIM, so athletes, partners and spectators always see the latest version of the competition story.`;
}

function groupSponsorsByCategory(sponsors) {
  const map = new Map();
  sponsors.forEach((sponsor) => {
    const key = sponsor.category || "supplier";
    if (!map.has(key)) {
      map.set(key, { key, label: sponsorCategoryLabel(key), sponsors: [] });
    }
    map.get(key).sponsors.push(sponsor);
  });
  return [...map.values()];
}

function NationCell({ noc }) {
  if (!noc) return "—";
  const flagUrl = nationFlagUrl(noc);
  return (
    <span className="site-emag-nation">
      {flagUrl ? <img src={flagUrl} alt="" className="site-emag-nation__flag" loading="lazy" /> : null}
      {noc}
    </span>
  );
}

function StartlistEntryRow({ entry }) {
  // SB = previous indoor season (2026 for the 2027 meeting): World Athletics
  // value when the profile is linked ("7.21 @ Venue" → "7.21"), else the Excel.
  const sb = String(entry.waIndoorSb || entry.sb || "").split(" @ ")[0];
  const pb = entry.waPbIndoor || entry.pbIndoor || entry.pb || "";
  return (
    <tr>
      <td className="site-emag-table__lane">{entry.lane || "—"}</td>
      <td>
        <strong>{athleteDisplayName(entry)}</strong>
      </td>
      <td><NationCell noc={entry.nationality} /></td>
      <td>{sb || "—"}</td>
      <td>{pb || "—"}</td>
    </tr>
  );
}

function MagazinePage({ theme = "light", eyebrow, title, subtitle, headerExtra, headerImage, children, className = "" }) {
  return (
    <section className={`site-emag-page site-emag-page--${theme} ${className}`.trim()}>
      <div className="site-emag-page__frame">
        {(eyebrow || title || subtitle || headerExtra) ? (
          <header
            className={`site-emag-page__header${headerImage ? " site-emag-page__header--photo" : ""}`}
            style={headerImage
              ? { backgroundImage: `linear-gradient(180deg, rgba(0, 0, 0, 0.1) 0%, rgba(0, 0, 0, 0.72) 100%), url(${headerImage})` }
              : undefined}
          >
            {eyebrow ? <p className="site-emag-page__eyebrow">{eyebrow}</p> : null}
            {title ? <h2>{title}</h2> : null}
            {subtitle ? <p className="site-emag-page__subtitle">{subtitle}</p> : null}
            {headerExtra}
          </header>
        ) : null}
        <div className="site-emag-page__body">{children}</div>
      </div>
    </section>
  );
}

function ImportedPage({ imageUrl, title }) {
  return (
    <section className="site-emag-page site-emag-page--imported">
      <img src={imageUrl} alt={title || "Magazine page"} />
    </section>
  );
}

function CoverPage({ edition, officialGroupsCount, imageUrl, visualUrl, mainPartners = [] }) {
  if (imageUrl) {
    return <ImportedPage imageUrl={imageUrl} title="Cover" />;
  }

  return (
    <MagazinePage theme="cover" className="site-emag-page--cover">
      <div className="site-emag-cover">
        <header className="site-emag-cover__head">
          <h1 style={{ margin: 0 }}>
            <img src={meetingLogo} alt="CMCM Luxembourg Indoor Meeting" className="site-emag-cover__logo" />
          </h1>
          <p className="site-emag-cover__kicker">
            Official e-magazine <span>{edition?.year || ""}</span>
          </p>
        </header>
        <div className="site-emag-cover__visual">
          <img src={visualUrl || coverVisual} alt="" />
        </div>
        <footer className="site-emag-cover__foot">
          <div>
            <p className="site-emag-cover__meta">
              {formatEditionDate(edition?.date)}
              <span>{edition?.venue || "Coque, Luxembourg"}</span>
            </p>
            <p className="site-emag-cover__lead">
              Start lists, highlights, partner stories and the full build-up to this year’s meeting.
            </p>
          </div>
          <div className="site-emag-cover__labels">
            <img src={waSilverLogo} alt="World Athletics Indoor Tour Silver" className="site-emag-cover__label" />
            {mainPartners.length > 0 ? (
              <div className="site-emag-cover__partners">
                {mainPartners.map((sponsor) => (
                  <img key={sponsor.id} src={sponsor.logoUrl} alt={sponsor.name || "Main partner"} />
                ))}
              </div>
            ) : null}
          </div>
          <div className="site-emag-cover__chips">
            <span>{officialGroupsCount} official start lists</span>
            <span>English edition</span>
          </div>
        </footer>
      </div>
    </MagazinePage>
  );
}

// Shrinks the text step by step until the two columns hold the whole message
// (they overflow sideways into extra columns), down to 72 % of the size.
function useFitColumns(ref, deps) {
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    function fit() {
      let scale = 1;
      element.style.fontSize = "1rem";
      while (element.scrollWidth > element.clientWidth + 1 && scale > 0.72) {
        scale -= 0.04;
        element.style.fontSize = `${scale}rem`;
      }
    }
    fit();
    // Web fonts arriving later change the text length: measure again.
    document.fonts?.ready.then(fit);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

function WelcomePage({ edition, config }) {
  const body = config.body || buildDefaultWelcomeBody(edition, Array.isArray(edition?.disciplines) ? edition.disciplines.length : 0);
  const columnsRef = useRef(null);
  useFitColumns(columnsRef, [body, config.photoUrl, config.personName, config.personTitle]);

  return (
    <MagazinePage
      eyebrow="Welcome"
      title={config.title || `Welcome to the ${edition?.year || ""} edition`}
      subtitle={config.intro}
    >
      <div className="site-emag-welcome" ref={columnsRef}>
        <div className="site-emag-welcome__photo">
          <img src={config.photoUrl || venueImage} alt={config.personName || "Welcome portrait"} />
        </div>
        {body.split(/\n{2,}/).map((paragraph, index) => (
          <p key={`welcome-paragraph-${index}`}>{paragraph}</p>
        ))}
        <div className="site-emag-signoff">
          <strong>{config.personName || "President"}</strong>
          <span>{config.personTitle || "CMCM Luxembourg Indoor Meeting"}</span>
        </div>
      </div>
    </MagazinePage>
  );
}

function TimetablePage({ edition }) {
  const rows = Array.isArray(edition?.timetable) ? edition.timetable : [];

  return (
    <MagazinePage
      theme="accent"
      eyebrow="Competition day"
      title="Timetable"
      subtitle={edition?.timetableNote || "Times are indicative and subject to change."}
      headerImage={timetablePhoto}
      className="site-emag-page--timetable"
    >
      <div className="site-emag-timetable">
        {rows.length === 0 ? (
          <p className="site-emag-empty">The timetable has not been configured yet.</p>
        ) : (
          // A full meeting day (25+ rows) only fits on one A4 page with tighter rows.
          <table className={`site-emag-table site-emag-table--timetable${rows.length > 16 ? " site-emag-table--timetable-compact" : ""}`}>
            <tbody>
              {rows.map((row) => (
                row.type === "header" ? (
                  <tr key={row.id} className="site-emag-timetable__header-row">
                    <td colSpan={3}>{row.label}</td>
                  </tr>
                ) : row.type === "info" ? (
                  <tr key={row.id} className="site-emag-timetable__info-row">
                    <td>{row.time || "—"}</td>
                    <td />
                    <td>{row.label}</td>
                  </tr>
                ) : (
                  <tr key={row.id}>
                    <td>{row.time || "—"}</td>
                    <td>{row.gender === "WOMEN" ? "Women" : row.gender === "MEN" ? "Men" : row.gender || "Open"}</td>
                    <td>{row.event}{row.round ? ` ${String(row.round).toUpperCase()}` : ""}</td>
                  </tr>
                )
              ))}
            </tbody>
          </table>
        )}
      </div>
    </MagazinePage>
  );
}

// "Want to discover athletics?" — the FLA clubs page of the 2026 e-magazine.
function ClubsPage() {
  return (
    <section className="site-emag-page site-emag-clubs">
      <div className="site-emag-clubs__head">
        <h2>Want to discover athletics?</h2>
        <img src={flaLogo} alt="Fédération Luxembourgeoise d'Athlétisme" />
      </div>
      <div className="site-emag-clubs__join">
        <p>Join one of our competitive athletics clubs!</p>
        <figure>
          <img src={flaClubsQr} alt="QR code to the list of FLA clubs" />
          <figcaption>Scan me!</figcaption>
        </figure>
      </div>
      <div className="site-emag-clubs__list">
      <table className="site-emag-clubs__table">
        <thead>
          <tr>
            <th>Club</th>
            <th>Email address</th>
            <th>Website</th>
            <th>Telephone</th>
          </tr>
        </thead>
        <tbody>
          {flaClubs.clubs.map((club) => (
            <tr key={club.name}>
              <td>{club.name}</td>
              <td>{club.email}</td>
              <td>{club.website ? <a href={`https://${club.website}`} target="_blank" rel="noopener noreferrer">{club.website}</a> : null}</td>
              <td>{club.phone}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </section>
  );
}

// Closing page: everything is edited in Admin → E-magazine → Thank you.
function ThanksPage({ edition, config, sponsors }) {
  const logos = sponsors.filter((sponsor) => sponsor.logoUrl);
  return (
    <section className="site-emag-page site-emag-thanks">
      <div className="site-emag-thanks__hero" style={{ backgroundImage: `url(${config.photoUrl || thanksPhoto})` }}>
        <p>CMCM Luxembourg Indoor Meeting {edition?.year || ""}</p>
        <h2>{config.title}</h2>
      </div>
      <div className="site-emag-thanks__body">
        {config.intro ? <p className="site-emag-thanks__intro">{config.intro}</p> : null}
        {config.names.length ? (
          <ul className="site-emag-thanks__names">
            {config.names.map((name) => <li key={name}>{name}</li>)}
          </ul>
        ) : null}
        {config.closing ? <blockquote className="site-emag-thanks__closing">{config.closing}</blockquote> : null}
      </div>
      {logos.length ? (
        <div className="site-emag-thanks__logos">
          {logos.map((sponsor) => (
            <span key={sponsor.id} className="site-emag-thanks__logo">
              <SponsorLogo sponsor={sponsor} />
            </span>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function SponsorsPage({ sponsors }) {
  const groups = useMemo(() => groupSponsorsByCategory(sponsors), [sponsors]);

  return (
    <MagazinePage
      eyebrow="Partners"
      title="The brands behind the meeting"
      subtitle="Thank you to the partners who make the meeting possible."
      headerImage={sponsorsPhoto}
      className="site-emag-page--sponsors"
    >
      <div className="site-emag-sponsors">
        {groups.map((group) => (
          <div key={group.key} className="site-emag-sponsors__group">
            <h3>{group.label}</h3>
            <div className="site-emag-sponsors__logos">
              {group.sponsors.map((sponsor) => (
                <a
                  key={sponsor.id}
                  href={sponsor.website || "#"}
                  target={sponsor.website ? "_blank" : undefined}
                  rel={sponsor.website ? "noopener noreferrer" : undefined}
                  className="site-emag-sponsors__logo"
                >
                  {sponsor.logoUrl ? (
                    <SponsorLogo sponsor={sponsor} alt={sponsor.name || "Sponsor"} />
                  ) : (
                    <span>{sponsor.name || "Sponsor"}</span>
                  )}
                </a>
              ))}
            </div>
          </div>
        ))}
      </div>
    </MagazinePage>
  );
}

// What each pre-programme race is, told with the photos and words of the
// website's Pre-Programme page.
const SPECIAL_RACE_STORIES = {
  influencerRace: {
    eyebrow: "Opening act",
    banner: preprogInfluencer,
    photos: [preprogGforster, preprogNational60m],
    text: "Two spectacular 60m races set the stage — one for women, one for men. Luxembourg influencers go head-to-head against local sports stars in an explosive duel at the heart of the Coque.",
    facts: [
      ["Women's race", "60m — influencers vs. Lux stars"],
      ["Men's race", "60m — influencers vs. Lux stars"],
      ["When", "Pre-programme, before the elite session"],
    ],
  },
  businessRace: {
    eyebrow: "Corporate experience",
    banner: preprogBusiness2,
    photos: [preprogBusiness1],
    text: "Luxembourg companies compete side by side on the track, in front of the meeting's audience: a unique mix of team spirit, sport and a premium brand experience.",
    facts: [
      ["Format", "Relay race on the track (4 × 200m)"],
      ["On stage", "Official team presentation in the arena"],
      ["At the finish", "Final ranking and Business Race podium"],
    ],
  },
};

function SpecialRacePage({ race }) {
  const story = SPECIAL_RACE_STORIES[race.id];
  return (
    <MagazinePage
      theme="accent"
      eyebrow={story?.eyebrow || "Pre-programme"}
      title={race.title}
      subtitle={race.subtitle || `${race.entries.length} participants`}
      headerImage={story?.banner}
      className="site-emag-page--special"
    >
      <div className="site-emag-special-race">
        {story ? (
          <div className="site-emag-special-race__story">
            <div className="site-emag-special-race__about">
              <p>{story.text}</p>
              <dl>
                {story.facts.map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <div className="site-emag-special-race__photos">
              {story.photos.map((src) => <img key={src} src={src} alt="" />)}
            </div>
          </div>
        ) : null}
        <div className="site-emag-special-race__intro">
          <span>{race.discipline}</span>
          <strong>{race.entries.length ? `${race.entries.length} participants` : "Line-up"}</strong>
        </div>
        {race.entries.length === 0 ? (
          <p className="site-emag-empty">The line-up will be announced closer to the meeting.</p>
        ) : (
          <table className="site-emag-table">
            <thead>
              <tr>
                <th>Photo</th>
                <th>Lane</th>
                <th>Name</th>
                <th>Nation</th>
                <th>Instagram / Team</th>
                <th>Profile</th>
              </tr>
            </thead>
            <tbody>
              {race.entries.map((entry) => (
                <tr key={entry.id}>
                  <td>
                    {entry.photoUrl ? (
                      <img
                        src={entry.photoUrl}
                        alt={entry.name || "Participant"}
                        style={{ width: 52, height: 52, objectFit: "cover", borderRadius: 12, display: "block" }}
                      />
                    ) : "—"}
                  </td>
                  <td>{entry.lane || "—"}</td>
                  <td><strong>{entry.name}</strong></td>
                  <td>{entry.nationality || "—"}</td>
                  <td>{entry.instagram || entry.team || "—"}</td>
                  <td>{entry.description || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </MagazinePage>
  );
}

const HIGHLIGHT_TITLES = {
  quatuor: "Four athletes to watch",
  trio: "Three athletes to watch",
  duel: "A duel to watch",
};

const FIELD_EVENT_RE = /jump|vault|put|throw/i;

// "Long Jump Men" from the athletes' Event column ("Long Jump M").
function highlightEventTitle(athletes) {
  const parsed = parseEventField(athletes.find((athlete) => athlete.event)?.event);
  if (!parsed.discipline) return "";
  const gender = parsed.gender === "W" ? "Women" : parsed.gender === "M" ? "Men" : "";
  return `${parsed.discipline} ${gender}`.trim();
}

// "8.25 (2024)" → "8.25M" for field events, "6.55" for running events.
function highlightPb(athlete, eventTitle) {
  const mark = String(athlete.waPbIndoor || athlete.pbIndoor || athlete.pb || "").replace(/\s*\(.*\)\s*$/, "").trim();
  if (!mark) return "";
  return FIELD_EVENT_RE.test(eventTitle) && /^\d+([.,]\d+)?$/.test(mark) ? `${mark}M` : mark;
}

// Duel / trio / quatuor / spotlight, in the 2026 e-magazine style: full-height
// photos side by side, the event on top, "VS" in the middle of a duel, and
// name, flag and PB on a blue gradient at the bottom.
function HighlightPage({ page, athletes }) {
  const eventTitle = highlightEventTitle(athletes);
  const title = page.title || eventTitle || HIGHLIGHT_TITLES[page.type] || "Athlete spotlight";
  const count = Math.max(1, athletes.length);

  return (
    <section className="site-emag-page site-emag-duel" data-count={count}>
      <div className="site-emag-duel__photos">
        {athletes.length === 0 ? (
          <div className="site-emag-duel__photo">
            {page.imageUrl ? <img src={page.imageUrl} alt="" /> : null}
          </div>
        ) : athletes.map((athlete, index) => {
          const photo = page.athletePhotos?.[athlete._docId] || athlete.photoUrl || (count === 1 ? page.imageUrl : "");
          return (
            <div key={athlete._docId} className="site-emag-duel__photo" data-side={index % 2 === 0 ? "red" : "blue"}>
              {photo ? <img src={photo} alt={athleteDisplayName(athlete)} /> : null}
            </div>
          );
        })}
      </div>

      <h2 className="site-emag-duel__title">{title}</h2>
      {page.subtitle ? <p className="site-emag-duel__subtitle">{page.subtitle}</p> : null}
      {count === 2 ? <span className="site-emag-duel__vs" aria-hidden="true">VS</span> : null}

      <div className="site-emag-duel__footer">
        {page.body && count === 1 ? <p className="site-emag-duel__body">{page.body}</p> : null}
        <div className="site-emag-duel__athletes">
          {athletes.map((athlete) => {
            const pb = highlightPb(athlete, eventTitle || title);
            const flagUrl = nationFlagUrl(athlete.nationality);
            return (
              <div key={athlete._docId} className="site-emag-duel__athlete">
                <strong>
                  <span>{athlete.firstName}</span>
                  <span>{athlete.lastName}</span>
                </strong>
                {flagUrl ? <img src={flagUrl} alt={athlete.nationality} className="site-emag-duel__flag" /> : null}
                {pb ? <span className="site-emag-duel__pb">PB: {pb}</span> : null}
              </div>
            );
          })}
          {athletes.length === 0 ? (
            <p className="site-emag-duel__empty">Select the athletes of this page in the e-magazine admin.</p>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function PartnerFeaturePage({ page, sponsor }) {
  const title = page.headline || sponsor?.name || "Partner page";
  return (
    <MagazinePage theme="accent" eyebrow="Partner story" title={title} subtitle={sponsor?.tagline || sponsor?.category || ""}>
      <div className="site-emag-partner-feature">
        <div className="site-emag-partner-feature__visual">
          <img src={page.imageUrl || sponsor?.logoUrl || venueImage} alt={title} />
        </div>
        <div className="site-emag-partner-feature__copy">
          {sponsor?.logoUrl ? (
            <div className="site-emag-partner-feature__logo">
              <img src={sponsor.logoUrl} alt={sponsor.name || title} />
            </div>
          ) : null}
          <p>{page.body || sponsor?.description || "Add a partner story or visual to complete this page."}</p>
          {(page.ctaUrl || sponsor?.website) ? (
            <a href={page.ctaUrl || sponsor?.website} target="_blank" rel="noopener noreferrer" className="site-btn site-btn--primary site-btn--sm">
              {page.ctaLabel || "Visit partner website"}
            </a>
          ) : null}
        </div>
      </div>
    </MagazinePage>
  );
}

function RecordCard({ label, record, variant }) {
  const year = record.year || String(record.date || "").slice(0, 4);
  return (
    <div className={`site-emag-record-banner site-emag-record-banner--${variant}`}>
      <div className="site-emag-record-banner__top">
        <span>{label}</span>
        <strong>{record.mark}{record.pending ? "*" : ""}</strong>
      </div>
      <span className="site-emag-record-banner__holder">
        {record.fullName}
        {record.noc ? <> · <NationCell noc={record.noc} /></> : null}
        {year ? ` · ${year}` : ""}
      </span>
    </div>
  );
}

function RecordBanners({ meetingRecord, europeanRecord }) {
  if (!meetingRecord && !europeanRecord) return null;
  return (
    <div className="site-emag-records">
      {meetingRecord ? <RecordCard label="Meeting record (MR)" record={meetingRecord} variant="meeting" /> : null}
      {europeanRecord ? <RecordCard label="European record (ER)" record={europeanRecord} variant="european" /> : null}
    </div>
  );
}

function OfficialStartlistPage({ group, sbSeason, photoUrl }) {
  const groupedHeats = group.entries.reduce((accumulator, entry) => {
    const heatKey = entry.heat || "Main list";
    if (!accumulator.has(heatKey)) accumulator.set(heatKey, []);
    accumulator.get(heatKey).push(entry);
    return accumulator;
  }, new Map());
  const heatCount = [...groupedHeats.keys()].filter((heat) => heat !== "Main list").length;
  // Up to three heats of 8 must fit on one A4 page: tighter rows past one
  // heat, and past two heats the photo band shrinks to the title area.
  const isCompact = group.entries.length > 8;
  const isFull = group.entries.length > 16;

  return (
    <MagazinePage
      theme="record"
      eyebrow="Start list"
      title={group.title}
      subtitle={group.entries.length
        ? `${group.entries.length} athletes${heatCount > 1 ? ` · ${heatCount} heats` : ""}`
        : ""}
      headerExtra={<RecordBanners meetingRecord={group.meetingRecord} europeanRecord={group.europeanRecord} />}
      headerImage={photoUrl}
      className={isFull ? "site-emag-page--full" : ""}
    >
      <div className={`site-emag-startlist${isCompact ? " site-emag-startlist--compact" : ""}`}>
        {group.entries.length === 0 ? (
          <div className="site-emag-startlist__placeholder">
            <p>Start list not available yet.</p>
            <span>The structure is already ready for this discipline and will fill itself as soon as athletes are imported.</span>
          </div>
        ) : (
          [...groupedHeats.entries()].map(([heat, entries]) => (
            <div key={`${group.id}-${heat}`} className="site-emag-startlist__heat">
              <div className="site-emag-startlist__heat-head">
                <strong>{heat === "Main list" ? "Entries" : `Heat ${heat}`}</strong>
                <span>{entries.length} athletes</span>
              </div>
              <table className="site-emag-table">
                <thead>
                  <tr>
                    <th>Lane</th>
                    <th>Athlete</th>
                    <th>Nation</th>
                    <th>{sbSeason ? `SB ${sbSeason}` : "SB"}</th>
                    <th>PB</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => <StartlistEntryRow key={entry.id} entry={entry} />)}
                </tbody>
              </table>
            </div>
          ))
        )}
      </div>
    </MagazinePage>
  );
}

// Builds every magazine page of the site edition. The admin preview frame
// passes the unsaved draft (and the edition year being edited) as overrides.
function useMagazinePages({ editionYear = null, configOverride = null } = {}) {
  const { siteEditionYear } = useSiteEditionYear();
  const { activeEditionId } = useActiveEdition();
  const { editions, loading: editionsLoading } = useMeetingEditions();
  const { records: meetingRecords } = useMeetingRecords();
  // Never shows athletes imported into a test edition for a live-import
  // rehearsal — only the app's configured "current" edition ever reaches the
  // public e-magazine.
  const { athletes, loading: athletesLoading } = useAthletes(true, activeEditionId);
  const { registry, loading: registryLoading } = useAthleteRegistry(true);
  const { sponsors, loading: sponsorsLoading } = useSponsors(true);

  const currentEdition = useMemo(() => {
    const latestEdition = editions[0] || null;
    const wantedYear = editionYear ?? siteEditionYear;
    const configuredEdition = wantedYear
      ? editions.find((edition) => Number(edition.year || edition.id) === Number(wantedYear)) || null
      : null;
    return configuredEdition || latestEdition || null;
  }, [editions, siteEditionYear, editionYear]);

  // Start lists show the SB of the previous indoor season (2026 for 2027).
  const sbSeason = currentEdition?.year ? Number(currentEdition.year) - 1 : null;

  const emagazine = useMemo(
    () => normalizeEmagazineConfig(configOverride ?? currentEdition?.emagazine, currentEdition),
    [currentEdition, configOverride],
  );

  const athleteLookup = useMemo(
    () => buildAthleteLookup(registry, athletes),
    [registry, athletes],
  );

  const officialStartlists = useMemo(
    () => buildOfficialStartlistGroups(currentEdition?.disciplines || [], athletes).map((group) => ({
      ...group,
      meetingRecord: findMeetingRecord(meetingRecords, group.discipline, group.gender),
      europeanRecord: findMeetingRecord(europeanRecords.records, group.discipline, group.gender),
    })),
    [currentEdition?.disciplines, athletes, meetingRecords],
  );

  const specialRaceStartlists = useMemo(
    () => buildSpecialRaceStartlistGroups(emagazine),
    [emagazine],
  );

  const highlightPages = useMemo(
    () => emagazine.highlightPages.map((page) => ({
      ...page,
      athletes: page.athleteIds.map((id) => athleteLookup.get(id)).filter(Boolean),
    })),
    [emagazine.highlightPages, athleteLookup],
  );

  const partnerPages = useMemo(
    () => emagazine.partnerPages.map((page) => ({
      ...page,
      sponsor: sponsors.find((sponsor) => sponsor.id === page.sponsorId) || null,
    })),
    [emagazine.partnerPages, sponsors],
  );

  const highlightById = useMemo(
    () => new Map(highlightPages.map((page) => [page.id, page])),
    [highlightPages],
  );

  const partnerById = useMemo(
    () => new Map(partnerPages.map((page) => [page.id, page])),
    [partnerPages],
  );

  const specialById = useMemo(
    () => new Map(specialRaceStartlists.map((page) => [page.id, page])),
    [specialRaceStartlists],
  );

  const orderedMagazinePages = useMemo(
    () => emagazine.pageOrder.flatMap((pageId) => {
      if (pageId === "cover") {
        return [{
          key: "cover",
          pageId,
          title: "Cover",
          element: (
            <CoverPage
              edition={currentEdition}
              officialGroupsCount={officialStartlists.length}
              imageUrl={emagazine.cover.imageUrl}
              visualUrl={emagazine.cover.visualUrl}
              mainPartners={sponsors.filter((sponsor) => normalizeSponsorCategory(sponsor.category) === "main" && sponsor.logoUrl)}
            />
          ),
        }];
      }
      if (pageId === "welcome") {
        return [{
          key: "welcome",
          pageId,
          title: emagazine.welcome.title || `Welcome to the ${currentEdition?.year || ""} edition`,
          element: <WelcomePage edition={currentEdition} config={emagazine.welcome} />,
        }];
      }
      if (pageId === "thanks") {
        return [{
          key: "thanks",
          pageId,
          title: emagazine.thanks.title,
          element: <ThanksPage edition={currentEdition} config={emagazine.thanks} sponsors={sponsors} />,
        }];
      }
      if (pageId === "clubs") {
        return [{
          key: "clubs",
          pageId,
          title: "Athletics clubs",
          element: <ClubsPage />,
        }];
      }
      if (pageId === "timetable") {
        return [{
          key: "timetable",
          pageId,
          title: "Timetable",
          element: <TimetablePage edition={currentEdition} />,
        }];
      }
      if (pageId === "sponsors") {
        if (emagazine.sponsorPages.length > 0) {
          return emagazine.sponsorPages.map((page) => ({
            key: `sponsor-page-${page.id}`,
            pageId,
            title: page.title || "Sponsors",
            element: <ImportedPage imageUrl={page.imageUrl} title={page.title || "Sponsors"} />,
          }));
        }
        return [{
          key: "sponsors",
          pageId,
          title: "Sponsor overview",
          element: <SponsorsPage sponsors={sponsors} />,
        }];
      }
      if (pageId === "official-startlists") {
        return officialStartlists
          .slice()
          .sort((a, b) => disciplineSortIndex(a.discipline) - disciplineSortIndex(b.discipline) || a.title.localeCompare(b.title))
          .map((group) => ({
            key: `startlist-${group.id}`,
            pageId: `official-startlist:${group.id}`,
            title: group.title,
            element: <OfficialStartlistPage group={group} sbSeason={sbSeason} photoUrl={emagazine.startlistPhotos[group.id]} />,
          }));
      }
      if (pageId.startsWith("official-startlist:")) {
        const groupId = pageId.replace("official-startlist:", "");
        const group = officialStartlists.find((entry) => entry.id === groupId);
        return group ? [{
          key: `startlist-${group.id}`,
          pageId,
          title: group.title,
          element: <OfficialStartlistPage group={group} sbSeason={sbSeason} photoUrl={emagazine.startlistPhotos[group.id]} />,
        }] : [];
      }
      if (pageId.startsWith("special:")) {
        const page = specialById.get(pageId.replace("special:", ""));
        return page ? [{ key: `special-${page.id}`, pageId, title: page.title, element: <SpecialRacePage race={page} /> }] : [];
      }
      if (pageId.startsWith("highlight:")) {
        const page = highlightById.get(pageId.replace("highlight:", ""));
        return page ? [{ key: `highlight-${page.id}`, pageId, title: page.title || "Highlight", element: <HighlightPage page={page} athletes={page.athletes} /> }] : [];
      }
      if (pageId.startsWith("partner:")) {
        const page = partnerById.get(pageId.replace("partner:", ""));
        return page ? [{ key: `partner-${page.id}`, pageId, title: page.headline || page.sponsor?.name || "Partner story", element: <PartnerFeaturePage page={page} sponsor={page.sponsor} /> }] : [];
      }
      return [];
    }),
    [currentEdition, emagazine, officialStartlists, highlightById, partnerById, specialById, sponsors, sbSeason],
  );

  return {
    loading: editionsLoading || athletesLoading || registryLoading || sponsorsLoading,
    currentEdition,
    orderedMagazinePages,
  };
}

export function SiteEmagazine() {
  const swipeStateRef = useRef({ startX: 0, pointerId: null });
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [readerShellNode, setReaderShellNode] = useState(null);
  const pageScale = useA4PageScale(readerShellNode);
  const location = useLocation();
  const { loading, currentEdition, orderedMagazinePages } = useMagazinePages();

  const previewMode = useMemo(
    () => new URLSearchParams(location.search).get("preview") === "1",
    [location.search],
  );

  const emagazinePublished = (currentEdition?.emagazineStatus || "published") === "published";

  useEffect(() => {
    setCurrentPageIndex(0);
  }, [currentEdition?.year, orderedMagazinePages.length]);

  // Audience for the sponsors: never counts the admin preview.
  const statsYear = emagazinePublished && !previewMode ? currentEdition?.year : null;
  const currentPageKey = orderedMagazinePages[currentPageIndex]?.key;
  const currentPageTitle = orderedMagazinePages[currentPageIndex]?.title;

  useEffect(() => {
    if (statsYear) trackEmagazineOpen(statsYear);
  }, [statsYear]);

  useEffect(() => {
    if (!statsYear || !currentPageKey) return undefined;
    const timer = window.setTimeout(
      () => trackEmagazinePageView(statsYear, currentPageKey, currentPageTitle),
      PAGE_VIEW_DELAY_MS,
    );
    return () => window.clearTimeout(timer);
  }, [statsYear, currentPageKey, currentPageTitle]);

  function handlePrint() {
    if (statsYear) trackEmagazinePrint(statsYear);
    window.print();
  }

  function goToPage(index) {
    const nextIndex = Math.max(0, Math.min(orderedMagazinePages.length - 1, index));
    setCurrentPageIndex(nextIndex);
  }

  function handlePointerDown(event) {
    swipeStateRef.current = {
      startX: event.clientX,
      pointerId: event.pointerId,
    };
  }

  function handlePointerUp(event) {
    if (swipeStateRef.current.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - swipeStateRef.current.startX;
    swipeStateRef.current = { startX: 0, pointerId: null };
    if (Math.abs(deltaX) < 60) return;
    if (deltaX < 0) {
      goToPage(currentPageIndex + 1);
    } else {
      goToPage(currentPageIndex - 1);
    }
  }

  if (loading) {
    return (
      <section className="site-section">
        <div className="site-container">
          <div className="site-card" style={{ padding: 32 }}>
            <p className="site-eyebrow">E-magazine</p>
            <h1 className="site-heading site-heading--sm">Preparing the digital magazine</h1>
            <p className="site-lead">We are loading the current edition, athletes and sponsor data.</p>
          </div>
        </div>
      </section>
    );
  }

  if (!currentEdition) {
    return (
      <section className="site-section">
        <div className="site-container">
          <div className="site-card" style={{ padding: 32 }}>
            <p className="site-eyebrow">E-magazine</p>
            <h1 className="site-heading site-heading--sm">No edition configured yet</h1>
            <p className="site-lead">Set a current edition in the admin before generating the e-magazine.</p>
          </div>
        </div>
      </section>
    );
  }

  if (!emagazinePublished && !previewMode) {
    return (
      <section className="site-section">
        <div className="site-container">
          <div className="site-card" style={{ padding: 32 }}>
            <p className="site-eyebrow">E-magazine</p>
            <h1 className="site-heading site-heading--sm">E-magazine not published yet</h1>
            <p className="site-lead">
              This edition’s digital magazine is currently offline. Please check back later once it has been published.
            </p>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <NavLink to="/" className="site-btn site-btn--secondary site-btn--sm">
                Back to home
              </NavLink>
              <NavLink to="/statistics" className="site-btn site-btn--primary site-btn--sm">
                Results & Statistics
              </NavLink>
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <div className="site-emag">
      <section className="site-section site-emag__intro">
        <div className="site-container site-emag__intro-bar">
          <div>
            <p className="site-eyebrow">Digital publication</p>
            <h1 className="site-heading site-heading--sm">E-magazine {currentEdition.year}</h1>
          </div>
          <div className="site-emag__actions">
            <button type="button" className="site-btn site-btn--secondary site-btn--sm" onClick={handlePrint}>
              Print / Save as PDF
            </button>
            <NavLink to="/statistics" className="site-btn site-btn--primary site-btn--sm">
              Results & Statistics
            </NavLink>
          </div>
        </div>
      </section>

      <div className="site-container site-emag__book">
        <div className="site-emag__reader-meta">
          <div>
            <p className="site-emag__reader-kicker">Interactive preview</p>
            <strong>{orderedMagazinePages[currentPageIndex]?.title || "Magazine page"}</strong>
          </div>
          <div className="site-emag__reader-status">
            <span>Swipe or use the arrows</span>
            <strong>
              {currentPageIndex + 1} / {orderedMagazinePages.length}
            </strong>
          </div>
        </div>

        <div className="site-emag__reader-shell" ref={setReaderShellNode}>
          <button
            type="button"
            className="site-emag__nav site-emag__nav--prev"
            onClick={() => goToPage(currentPageIndex - 1)}
            disabled={currentPageIndex === 0}
            aria-label="Previous page"
          >
            ←
          </button>

          <div
            className="site-emag__reader"
            onPointerDown={handlePointerDown}
            onPointerUp={handlePointerUp}
          >
            <div
              className="site-emag__track"
              style={{ transform: `translateX(-${currentPageIndex * 100}%)` }}
            >
              {orderedMagazinePages.map((page, index) => (
                <div
                  key={page.key}
                  className="site-emag__sheet"
                  aria-label={`Page ${index + 1}: ${page.title}`}
                >
                  <div
                    className="site-emag__a4"
                    style={{ width: A4_PAGE_WIDTH * pageScale, height: A4_PAGE_HEIGHT * pageScale }}
                  >
                    <div className="site-emag__a4-page" style={{ transform: `scale(${pageScale})` }}>
                      {page.element}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <button
            type="button"
            className="site-emag__nav site-emag__nav--next"
            onClick={() => goToPage(currentPageIndex + 1)}
            disabled={currentPageIndex === orderedMagazinePages.length - 1}
            aria-label="Next page"
          >
            →
          </button>
        </div>

        <div className="site-emag__pager" aria-label="Magazine pages">
          {orderedMagazinePages.map((page, index) => (
            <button
              key={`${page.key}-dot`}
              type="button"
              className={`site-emag__pager-dot${index === currentPageIndex ? " site-emag__pager-dot--active" : ""}`}
              onClick={() => goToPage(index)}
              aria-label={`Go to page ${index + 1}: ${page.title}`}
              title={`${index + 1}. ${page.title}`}
            >
              <span>{index + 1}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function useFrameWidthScale(node) {
  const [scale, setScale] = useState(0.4);

  useEffect(() => {
    if (!node) return undefined;
    function measure() {
      setScale(Math.max(0.1, node.clientWidth / A4_PAGE_WIDTH));
    }
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);

  return scale;
}

// Live preview embedded in Admin → E-magazine: shows one page built from the
// unsaved draft the configurator posts here. Never counted in the audience.
export function SiteEmagazineFrame() {
  const location = useLocation();
  const initialPageId = new URLSearchParams(location.search).get("page") || "cover";
  const [draft, setDraft] = useState(null);
  const [frameNode, setFrameNode] = useState(null);
  const scale = useFrameWidthScale(frameNode);

  useEffect(() => {
    function handleMessage(event) {
      if (event.origin !== window.location.origin || event.data?.type !== "emag-draft") return;
      setDraft({ year: event.data.year, config: event.data.config, pageId: event.data.pageId });
    }
    window.addEventListener("message", handleMessage);
    window.parent?.postMessage({ type: "emag-frame-ready" }, window.location.origin);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  const { loading, orderedMagazinePages } = useMagazinePages({
    editionYear: draft?.year ?? null,
    configOverride: draft?.config ?? null,
  });
  const pageId = draft?.pageId || initialPageId;
  const page = orderedMagazinePages.find((entry) => entry.pageId === pageId);

  let message = "";
  if (loading || !draft) message = "Loading the preview…";
  else if (!page) message = "This page is hidden or has nothing to show yet.";

  return (
    <div className="site-emag-frame" ref={setFrameNode}>
      {message ? (
        <p className="site-emag-frame__message">{message}</p>
      ) : (
        <div className="site-emag__a4" style={{ width: A4_PAGE_WIDTH * scale, height: A4_PAGE_HEIGHT * scale }}>
          <div className="site-emag__a4-page" style={{ transform: `scale(${scale})` }}>
            {page.element}
          </div>
        </div>
      )}
    </div>
  );
}