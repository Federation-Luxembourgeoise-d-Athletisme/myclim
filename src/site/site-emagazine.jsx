import { useEffect, useMemo, useRef, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useSiteEditionYear } from "../app/edition";
import { useAthleteRegistry, useAthletes } from "../app/athlete-portal-hooks";
import { useMeetingEditions, useMeetingRecords } from "../app/meeting-history-hooks";
import { useSponsors } from "./site-hooks";
import { sponsorCategoryLabel } from "./sponsor-utils";
import heroImage from "../assets/partner-stories/cmcm-athlete-moment.jpg";
import venueImage from "../assets/site-gallery/Coque2026.jpg";
import {
  athleteDisplayName,
  athleteParticipationSummary,
  athleteStats,
  athleteSubtitle,
  buildAthleteLookup,
  buildOfficialStartlistGroups,
  buildSpecialRaceStartlistGroups,
  disciplineSortIndex,
  findMeetingRecord,
  normalizeEmagazineConfig,
} from "./site-emagazine-shared";

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

function sortTimetable(entries = []) {
  return [...entries].sort((a, b) => {
    if (a.type === "header" && b.type !== "header") return -1;
    if (a.type !== "header" && b.type === "header") return 1;
    return 0;
  });
}

function StartlistEntryRow({ entry }) {
  const sb = entry.waIndoorSbCurrent || entry.waIndoorSb || entry.sb || "";
  const pb = entry.waPbIndoor || entry.pbIndoor || entry.pb || "";
  return (
    <tr>
      <td>{entry.heat || "—"}</td>
      <td>{entry.lane || "—"}</td>
      <td>
        <strong>{athleteDisplayName(entry)}</strong>
      </td>
      <td>{entry.nationality || "—"}</td>
      <td>{sb || "—"}</td>
      <td>{pb || "—"}</td>
    </tr>
  );
}

function MagazinePage({ theme = "light", eyebrow, title, subtitle, headerExtra, children, className = "" }) {
  return (
    <section className={`site-emag-page site-emag-page--${theme} ${className}`.trim()}>
      <div className="site-emag-page__frame">
        {(eyebrow || title || subtitle || headerExtra) ? (
          <header className="site-emag-page__header">
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

function CoverPage({ edition, officialGroupsCount, imageUrl }) {
  if (imageUrl) {
    return <ImportedPage imageUrl={imageUrl} title="Cover" />;
  }

  return (
    <MagazinePage theme="cover" className="site-emag-page--cover">
      <div className="site-emag-cover" style={{ backgroundImage: `linear-gradient(135deg, rgba(7, 24, 54, 0.76), rgba(193, 26, 52, 0.58)), url(${heroImage})` }}>
        <div className="site-emag-cover__copy">
          <p className="site-emag-cover__kicker">Official e-magazine</p>
          <h1>CMCM Luxembourg Indoor Meeting</h1>
          <p className="site-emag-cover__meta">
            {formatEditionDate(edition?.date)} • {edition?.venue || "Coque, Luxembourg"}
          </p>
          <p className="site-emag-cover__lead">
            Start lists, highlights, partner stories and the full editorial build-up to this year’s meeting.
          </p>
          <div className="site-emag-cover__chips">
            <span>{officialGroupsCount} official start lists</span>
            <span>Live sync from MyCLIM</span>
            <span>English edition</span>
          </div>
        </div>
        <div className="site-emag-cover__aside">
          <div className="site-emag-cover__card">
            <span>World Athletics Indoor Tour</span>
            <strong>Silver Label</strong>
          </div>
          <div className="site-emag-cover__card">
            <span>Edition</span>
            <strong>{edition?.year || "Current"}</strong>
          </div>
        </div>
      </div>
    </MagazinePage>
  );
}

function WelcomePage({ edition, config }) {
  const body = config.body || buildDefaultWelcomeBody(edition, Array.isArray(edition?.disciplines) ? edition.disciplines.length : 0);
  return (
    <MagazinePage
      eyebrow="Welcome"
      title={config.title || `Welcome to the ${edition?.year || ""} edition`}
      subtitle={config.intro || "An editable message from the organising team."}
    >
      <div className="site-emag-welcome">
        <div className="site-emag-welcome__photo">
          <img src={config.photoUrl || venueImage} alt={config.personName || "Welcome portrait"} />
        </div>
        <div className="site-emag-welcome__text">
          {body.split(/\n{2,}/).map((paragraph, index) => (
            <p key={`welcome-paragraph-${index}`}>{paragraph}</p>
          ))}
          <div className="site-emag-signoff">
            <strong>{config.personName || "President"}</strong>
            <span>{config.personTitle || "CMCM Luxembourg Indoor Meeting"}</span>
          </div>
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
      subtitle="Programme extracted automatically from the current edition settings."
    >
      <div className="site-emag-timetable">
        {rows.length === 0 ? (
          <p className="site-emag-empty">The timetable has not been configured yet.</p>
        ) : (
          <table className="site-emag-table site-emag-table--timetable">
            <tbody>
              {sortTimetable(rows).map((row) => (
                row.type === "header" ? (
                  <tr key={row.id} className="site-emag-timetable__header-row">
                    <td colSpan={3}>{row.label}</td>
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

function SponsorsPage({ sponsors }) {
  const groups = useMemo(() => groupSponsorsByCategory(sponsors), [sponsors]);

  return (
    <MagazinePage
      eyebrow="Partners"
      title="The brands behind the meeting"
      subtitle="A live selection of active sponsors configured on the public site."
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
                    <img src={sponsor.logoUrl} alt={sponsor.name || "Sponsor"} />
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

function SpecialRacePage({ race }) {
  return (
    <MagazinePage
      theme="accent"
      eyebrow="Pre-programme"
      title={race.title}
      subtitle={race.subtitle || `${race.entries.length} participants`}
    >
      <div className="site-emag-special-race">
        <div className="site-emag-special-race__intro">
          <span>{race.discipline}</span>
          <strong>{race.entries.length} participants</strong>
        </div>
        {race.entries.length === 0 ? (
          <p className="site-emag-empty">Participants have not been entered yet.</p>
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

function HighlightPage({ page, athletes }) {
  const title = page.title || HIGHLIGHT_TITLES[page.type] || "Athlete spotlight";
  const isMulti = athletes.length > 1;
  const heroAthlete = athletes[0];
  const heroPhoto = heroAthlete ? (page.athletePhotos?.[heroAthlete._docId] || heroAthlete.photoUrl) : "";

  return (
    <MagazinePage
      theme="highlight"
      eyebrow="Highlights"
      title={title}
      subtitle={page.subtitle || "Auto-filled from the athlete database and editable in the admin."}
    >
      <div
        className={`site-emag-highlight ${isMulti ? "site-emag-highlight--multi" : "site-emag-highlight--single"}`}
        style={!isMulti ? { backgroundImage: `linear-gradient(180deg, rgba(0,0,0,0.15), rgba(0,0,0,0.75)), url(${heroPhoto || page.imageUrl || heroImage})` } : undefined}
      >
        <div className="site-emag-highlight__content">
          {page.body ? <p className="site-emag-highlight__body">{page.body}</p> : null}
          <div className="site-emag-highlight__grid" data-count={athletes.length}>
            {athletes.map((athlete, index) => (
              <article key={athlete._docId} className="site-emag-athlete-card" data-accent={index % 2 === 0 ? "red" : "blue"}>
                {isMulti ? (
                  <div className="site-emag-athlete-card__photo">
                    {(page.athletePhotos?.[athlete._docId] || athlete.photoUrl) ? (
                      <img src={page.athletePhotos?.[athlete._docId] || athlete.photoUrl} alt={athleteDisplayName(athlete)} />
                    ) : (
                      <span className="site-emag-athlete-card__photo-placeholder" aria-hidden="true" />
                    )}
                  </div>
                ) : null}
                <div>
                  <h3>{athleteDisplayName(athlete) || "Athlete to be announced"}</h3>
                  <p>{athleteSubtitle(athlete) || "Profile loading from database"}</p>
                </div>
                <div className="site-emag-athlete-card__stats">
                  {athleteStats(athlete).map((stat) => (
                    <span key={`${athlete._docId}-${stat.label}`}>
                      <small>{stat.label}</small>
                      <strong>{stat.value}</strong>
                    </span>
                  ))}
                </div>
                {athleteParticipationSummary(athlete).length > 0 ? (
                  <div className="site-emag-athlete-card__history">
                    <small>Meeting history</small>
                    <ul>
                      {athleteParticipationSummary(athlete).map((entry) => (
                        <li key={`${athlete._docId}-${entry.year}-${entry.discipline}`}>
                          {entry.year} • {entry.discipline} • {entry.result || "—"}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </article>
            ))}
            {athletes.length === 0 ? <p className="site-emag-empty">Select athletes in the admin to generate this page.</p> : null}
          </div>
        </div>
      </div>
    </MagazinePage>
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

function MeetingRecordBanner({ record }) {
  if (!record) return null;
  return (
    <div className="site-emag-record-banner">
      <span>Meeting record (MR)</span>
      <strong>{record.mark}</strong>
      <span className="site-emag-record-banner__holder">
        {[record.fullName, record.noc].filter(Boolean).join(" · ")}
        {record.year ? ` · ${record.year}` : ""}
      </span>
    </div>
  );
}

function OfficialStartlistPage({ group }) {
  const groupedHeats = group.entries.reduce((accumulator, entry) => {
    const heatKey = entry.heat || "Main list";
    if (!accumulator.has(heatKey)) accumulator.set(heatKey, []);
    accumulator.get(heatKey).push(entry);
    return accumulator;
  }, new Map());

  return (
    <MagazinePage
      theme="record"
      eyebrow="Start list"
      title={group.title}
      subtitle="Live entries from the Athlete Portal. This page updates automatically as data is imported."
      headerExtra={<MeetingRecordBanner record={group.meetingRecord} />}
    >
      <div className="site-emag-startlist">
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
                    <th>Heat</th>
                    <th>Lane</th>
                    <th>Athlete</th>
                    <th>Nation</th>
                    <th>SB</th>
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

export function SiteEmagazine() {
  const swipeStateRef = useRef({ startX: 0, pointerId: null });
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const location = useLocation();
  const { siteEditionYear } = useSiteEditionYear();
  const { editions, loading: editionsLoading } = useMeetingEditions();
  const { records: meetingRecords } = useMeetingRecords();
  const { athletes, loading: athletesLoading } = useAthletes(true);
  const { registry, loading: registryLoading } = useAthleteRegistry(true);
  const { sponsors, loading: sponsorsLoading } = useSponsors(true);

  const currentEdition = useMemo(() => {
    const latestEdition = editions[0] || null;
    const configuredEdition = siteEditionYear
      ? editions.find((edition) => Number(edition.year || edition.id) === Number(siteEditionYear)) || null
      : null;
    return configuredEdition || latestEdition || null;
  }, [editions, siteEditionYear]);

  const previewMode = useMemo(
    () => new URLSearchParams(location.search).get("preview") === "1",
    [location.search],
  );

  const emagazinePublished = (currentEdition?.emagazineStatus || "published") === "published";

  const emagazine = useMemo(
    () => normalizeEmagazineConfig(currentEdition?.emagazine, currentEdition),
    [currentEdition],
  );

  const athleteLookup = useMemo(
    () => buildAthleteLookup(registry, athletes),
    [registry, athletes],
  );

  const officialStartlists = useMemo(
    () => buildOfficialStartlistGroups(currentEdition?.disciplines || [], athletes).map((group) => ({
      ...group,
      meetingRecord: findMeetingRecord(meetingRecords, group.discipline, group.gender),
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
          title: "Cover",
          element: <CoverPage edition={currentEdition} officialGroupsCount={officialStartlists.length} imageUrl={emagazine.cover.imageUrl} />,
        }];
      }
      if (pageId === "welcome") {
        return [{
          key: "welcome",
          title: emagazine.welcome.title || `Welcome to the ${currentEdition?.year || ""} edition`,
          element: <WelcomePage edition={currentEdition} config={emagazine.welcome} />,
        }];
      }
      if (pageId === "timetable") {
        return [{
          key: "timetable",
          title: "Timetable",
          element: <TimetablePage edition={currentEdition} />,
        }];
      }
      if (pageId === "sponsors") {
        if (emagazine.sponsorPages.length > 0) {
          return emagazine.sponsorPages.map((page) => ({
            key: `sponsor-page-${page.id}`,
            title: page.title || "Sponsors",
            element: <ImportedPage imageUrl={page.imageUrl} title={page.title || "Sponsors"} />,
          }));
        }
        return [{
          key: "sponsors",
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
            title: group.title,
            element: <OfficialStartlistPage group={group} />,
          }));
      }
      if (pageId.startsWith("official-startlist:")) {
        const groupId = pageId.replace("official-startlist:", "");
        const group = officialStartlists.find((entry) => entry.id === groupId);
        return group ? [{
          key: `startlist-${group.id}`,
          title: group.title,
          element: <OfficialStartlistPage group={group} />,
        }] : [];
      }
      if (pageId.startsWith("special:")) {
        const page = specialById.get(pageId.replace("special:", ""));
        return page ? [{ key: `special-${page.id}`, title: page.title, element: <SpecialRacePage race={page} /> }] : [];
      }
      if (pageId.startsWith("highlight:")) {
        const page = highlightById.get(pageId.replace("highlight:", ""));
        return page ? [{ key: `highlight-${page.id}`, title: page.title || "Highlight", element: <HighlightPage page={page} athletes={page.athletes} /> }] : [];
      }
      if (pageId.startsWith("partner:")) {
        const page = partnerById.get(pageId.replace("partner:", ""));
        return page ? [{ key: `partner-${page.id}`, title: page.headline || page.sponsor?.name || "Partner story", element: <PartnerFeaturePage page={page} sponsor={page.sponsor} /> }] : [];
      }
      return [];
    }),
    [currentEdition, emagazine, officialStartlists, highlightById, partnerById, specialById, sponsors],
  );

  useEffect(() => {
    setCurrentPageIndex(0);
  }, [currentEdition?.year, orderedMagazinePages.length]);

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

  if (editionsLoading || athletesLoading || registryLoading || sponsorsLoading) {
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
            <button type="button" className="site-btn site-btn--secondary site-btn--sm" onClick={() => window.print()}>
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

        <div className="site-emag__reader-shell">
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
                  {page.element}
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
