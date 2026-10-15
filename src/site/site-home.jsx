import { useEffect, useMemo, useRef, useState } from "react";
import { NavLink } from "react-router-dom";
import { useSiteEditionYear } from "../app/edition";
import { formatEditionLabel, getEditionDisplayNumber } from "../app/meeting-edition-utils";
import { useMeetingEditions, useMeetingResultsForYear } from "../app/meeting-history-hooks";
import { SponsorLogo } from "./sponsor-logo";
import { usePublishedNews, useSponsorCategories, useSponsors } from "./site-hooks";
import { sponsorCategoryLabel } from "./sponsor-utils";
import cmcmLogo from "../assets/cmcm-logo.png";
import heroPhoto from "../assets/hero-photo.jpg";
import waLogo from "../assets/wa-indoor-tour-silver.png";
import galleryDaemen from "../assets/site-gallery/gallery-daemen.jpg";
import galleryWinner from "../assets/site-gallery/gallery-winner.jpg";
import galleryMemories from "../assets/site-gallery/gallery-memories.jpg";
import galleryAutographs from "../assets/site-gallery/gallery-autographs.jpg";
import galleryVolunteers from "../assets/site-gallery/gallery-volunteers.jpg";
import ambiance1 from "../assets/site-gallery/ambiance-1.jpg";
import ambiance2 from "../assets/site-gallery/ambiance-2.jpg";
import ambiance3 from "../assets/site-gallery/ambiance-3.jpg";
import aboutVdw from "../assets/site-gallery/about-vdw.jpg";
import coqueWide from "../assets/site-gallery/Coque2026.jpg";
import meetingEditionsSeed from "../data/meetingEditions.json";

/* ── Animated counter ──────────────────────────────────── */
function AnimatedNumber({ target, suffix = "", prefix = "" }) {
  const [value, setValue] = useState(0);
  const ref = useRef(null);
  const started = useRef(false);

  useEffect(() => {
    if (!target) return;
    const el = ref.current;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !started.current) {
          started.current = true;
          const duration = 1400;
          const steps = 60;
          const step = target / steps;
          let current = 0;
          const interval = setInterval(() => {
            current = Math.min(current + step, target);
            setValue(Math.round(current));
            if (current >= target) clearInterval(interval);
          }, duration / steps);
        }
      },
      { threshold: 0.3 },
    );
    if (el) observer.observe(el);
    return () => observer.disconnect();
  }, [target]);

  return (
    <span ref={ref}>
      {prefix}{value.toLocaleString()}{suffix}
    </span>
  );
}

/* ── Highlights data ────────────────────────────────────── */
const HIGHLIGHTS = [
  {
    icon: "🏃",
    colorClass: "site-highlight-card__icon--red",
    title: "International Elite Athletes",
    description: "World-class athletes from across the globe, competing at the highest level of indoor athletics on European soil.",
  },
  {
    icon: "📊",
    colorClass: "site-highlight-card__icon--blue",
    title: "Live Results",
    description: "Real-time results and rankings updated throughout the competition, accessible to fans worldwide.",
  },
  {
    icon: "📈",
    colorClass: "site-highlight-card__icon--gold",
    title: "Dynamic Statistics",
    description: "Deep historical data, meeting records, winners history and performance analytics across all editions.",
  },
  {
    icon: "🥂",
    colorClass: "site-highlight-card__icon--red",
    title: "Premium VIP Experience",
    description: "Exclusive hospitality packages at Coque Luxembourg — unmatched views and premium access to elite athletics.",
  },
  {
    icon: "🌱",
    colorClass: "site-highlight-card__icon--blue",
    title: "Sustainability Commitment",
    description: "Committed to reducing our environmental footprint through responsible event management and green initiatives.",
  },
  {
    icon: "📺",
    colorClass: "site-highlight-card__icon--gold",
    title: "International Media Coverage",
    description: "Broadcast to audiences worldwide with press accreditation and full media support for journalists.",
  },
];

/* ── Category badge colour map ──────────────────────────── */
function categoryBadge(category) {
  const map = {
    news: "site-badge--blue",
    press: "site-badge--gray",
    event: "site-badge--red",
    athletes: "site-badge--gold",
    results: "site-badge--gold",
  };
  return map[category] || "site-badge--gray";
}

function formatNewsDate(ts) {
  if (!ts) return "";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function formatEditionDate(value) {
  if (!value) return "Date to be confirmed";
  const date = value?.toDate ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) return "Date to be confirmed";
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/* ── Main component ─────────────────────────────────────── */
export function SiteHome() {
  const { editions } = useMeetingEditions();
  const { siteEditionYear } = useSiteEditionYear();
  const { news } = usePublishedNews(4);
  const { categories: sponsorCategories } = useSponsorCategories();
  const { sponsors, loading: sponsorsLoading } = useSponsors(true);

  const latestEdition = editions[0] || null;
  const configuredSiteEdition = siteEditionYear
    ? editions.find((edition) => Number(edition.year || edition.id) === Number(siteEditionYear)) || null
    : null;
  // Hero/timetable/live links/prize money always reflect the current (upcoming) edition being organised.
  const heroEdition = configuredSiteEdition || latestEdition || null;
  const latestYear = latestEdition ? Number(latestEdition.year || latestEdition.id) || null : null;
  const heroEditionYear = heroEdition ? Number(heroEdition.year || heroEdition.id) || null : null;
  const seededLatestEdition = meetingEditionsSeed[meetingEditionsSeed.length - 1] || null;
  const fallbackEdition = heroEditionYear
    ? meetingEditionsSeed.find((edition) => Number(edition.year) === heroEditionYear) || seededLatestEdition
    : seededLatestEdition;
  const displayEdition = heroEdition || fallbackEdition;
  // "Key numbers" reflect the last COMPLETED edition (final athlete/country/spectator counts only exist
  // once the meeting happened and was closed), not the current/upcoming one being promoted above.
  const lastClosedEdition = editions.find((edition) => edition.isClosed) || null;
  const statsEdition = lastClosedEdition || fallbackEdition;
  const statsEditionNumber = getEditionDisplayNumber(statsEdition) || 23;
  const statsEditionYear = Number(statsEdition?.year) || null;

  const { results: latestResults } = useMeetingResultsForYear(latestYear);
  const { results: statsResults } = useMeetingResultsForYear(statsEditionYear);

  // Derive key stats from the athlete registry / results of the stats edition
  const totalAthletes = useMemo(() => {
    const athleteKeys = new Set(
      statsResults.map((result) =>
        [result.lastName, result.firstName, result.noc]
          .map((value) => String(value || "").trim().toLowerCase())
          .join("|"),
      ),
    );
    return athleteKeys.size;
  }, [statsResults]);
  const totalCountries = useMemo(() => {
    const countryCodes = new Set(
      statsResults.map((result) => String(result.noc || "").trim().toUpperCase()).filter(Boolean),
    );
    return countryCodes.size;
  }, [statsResults]);
  // Manually entered per edition in Website admin > Édition (meetingEditions/{year}).
  const totalSpectators = Number.isFinite(statsEdition?.spectatorCount) ? statsEdition.spectatorCount : 0;
  const worldLeadingPerformances = Number.isFinite(statsEdition?.worldLeadCount) ? statsEdition.worldLeadCount : 0;

  // Next edition info from back office
  const nextDate = formatEditionDate(displayEdition?.date || fallbackEdition?.date);
  const nextVenue = displayEdition?.venue || fallbackEdition?.venue || "Coque, Luxembourg";

  // Group sponsors by category for display
  const sponsorsByCategory = sponsors.reduce((acc, s) => {
    const cat = s.category || "supplier";
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(s);
    return acc;
  }, {});

  const categoryOrder = [
    ...sponsorCategories.map((category) => category.key),
    ...Object.keys(sponsorsByCategory).filter((cat) => !sponsorCategories.some((category) => category.key === cat)),
  ];

  // Winners of the latest edition — from meetingWinners collection, fallback to rank=1 from results
  const DISCIPLINE_ORDER = [
    "60 m", "60 m hurdles", "200 m", "400 m", "800 m", "1000 m", "1500 m", "3000 m", "5000 m",
  ];
  const normDiscipline = (d) => (d || "").replace(/(\d)\s+(m\b)/gi, "$1$2").replace(/Hurdles/g, "hurdles").trim();
  const keyOf = (d) => {
    const nd = normDiscipline(d);
    const i = DISCIPLINE_ORDER.indexOf(nd);
    return i !== -1 ? `0_${String(i).padStart(3, "0")}` : `1_${nd}`;
  };
  const latestWinners = latestYear
    ? (() => {
        const seen = new Set();
        return [...latestResults]
          .filter((r) => Number(r.rank) === 1)
          .sort((a, b) => {
            const dc = keyOf(a.discipline || "").localeCompare(keyOf(b.discipline || ""));
            if (dc !== 0) return dc;
            return (a.gender === "W" ? -1 : 1) - (b.gender === "W" ? -1 : 1);
          })
          .filter((r) => {
            const key = `${normDiscipline(r.discipline)}_${r.gender}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          })
          .slice(0, 14);
      })()
    : [];

  return (
    <>
      {/* ════════════════════════════════════════════════
          HERO
      ════════════════════════════════════════════════ */}
      <section className="site-hero">
        <div className="site-hero__bg" style={{ backgroundImage: `url(${heroPhoto})` }} />
        <div className="site-hero__bg-grid" />

        <div className="site-hero__label">
          <img src={waLogo} alt="World Athletics Indoor Tour Silver" className="site-hero__label-wa" />
        </div>

        <div className="site-hero__content">
          <div className="site-hero__eyebrow">Luxembourg · Indoor Athletics</div>
          <h1 className="site-hero__title">
            CMCM Luxembourg<br />
            <span>Indoor Meeting</span>
          </h1>

          <div className="site-hero__date">
            <div className="site-hero__date-item">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
                strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
                <rect x="3" y="4" width="18" height="18" rx="2" />
                <path d="M16 2v4M8 2v4M3 10h18" />
              </svg>
              {nextDate}
            </div>
            <div className="site-hero__date-sep" />
            <div className="site-hero__date-item">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
                strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
                <path d="M12 21s-5.5-5.7-5.5-10A5.5 5.5 0 1 1 17.5 11C17.5 15.3 12 21 12 21Zm0-7.5a2.5 2.5 0 1 0-2.5-2.5 2.5 2.5 0 0 0 2.5 2.5Z" />
              </svg>
              {nextVenue}
            </div>
            {formatEditionLabel(displayEdition) && (
              <>
                <div className="site-hero__date-sep" />
                <div className="site-hero__date-item">
                  {formatEditionLabel(displayEdition)}
                </div>
              </>
            )}
          </div>

          <div className="site-hero__ctas">
            <NavLink to="/statistics" className="site-btn site-btn--primary">
              View Results &amp; Records
            </NavLink>
            <NavLink to="/event" className="site-btn site-btn--secondary">
              Event Information
            </NavLink>
            <a
              href="#aftermovie"
              className="site-btn site-btn--secondary"
              onClick={(e) => {
                e.preventDefault();
                document.getElementById("aftermovie")?.scrollIntoView({ behavior: "smooth" });
              }}
            >
              ▶ Watch Aftermovie
            </a>
          </div>
        </div>

        <div className="site-hero__scroll" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" width="16" height="16">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </div>
      </section>

      {/* ════════════════════════════════════════════════
          KEY FIGURES
      ════════════════════════════════════════════════ */}
      <section className="site-stats-ribbon">
        <div className="site-container">
          <div className="site-stats-ribbon__intro">
            <span className="site-eyebrow">Current benchmark</span>
            <p>Key numbers from the {statsEditionYear} edition</p>
          </div>
        </div>
        <div className="site-stats-ribbon__inner">
          <div className="site-stat-item">
            <div className="site-stat-item__number">
              <AnimatedNumber target={statsEditionNumber} />
            </div>
            <div className="site-stat-item__label">Edition Number</div>
          </div>
          <div className="site-stat-item">
            <div className="site-stat-item__number site-stat-item__number--red">
              <AnimatedNumber target={totalAthletes} />
            </div>
            <div className="site-stat-item__label">Athletes</div>
          </div>
          <div className="site-stat-item">
            <div className="site-stat-item__number site-stat-item__number--blue">
              <AnimatedNumber target={totalCountries} />
            </div>
            <div className="site-stat-item__label">Countries</div>
          </div>
          <div className="site-stat-item">
            <div className="site-stat-item__number site-stat-item__number--gold">
              <AnimatedNumber target={totalSpectators} />
            </div>
            <div className="site-stat-item__label">Spectators</div>
          </div>
          <div className="site-stat-item">
            <div className="site-stat-item__number">
              <AnimatedNumber target={worldLeadingPerformances} />
            </div>
            <div className="site-stat-item__label">World Leads</div>
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════
          LIVE STREAMING (shown only when streamingUrl is set)
      ════════════════════════════════════════════════ */}
      {latestEdition?.streamingUrl && (
        <section className="site-section site-section--dark" id="live-stream" style={{ background: "#0a0a0a" }}>
          <div className="site-container" style={{ maxWidth: 960 }}>
            <div className="site-section-header site-section-header--center" style={{ marginBottom: 32 }}>
              <span className="site-eyebrow" style={{ color: "var(--site-red)" }}>● Live</span>
              <h2 className="site-heading" style={{ color: "#fff" }}>Watch Live</h2>
            </div>
            <div style={{
              position: "relative",
              paddingBottom: "56.25%",
              height: 0,
              borderRadius: "var(--site-radius-lg)",
              overflow: "hidden",
              boxShadow: "0 24px 64px rgba(0,0,0,0.6)",
            }}>
              <iframe
                src={latestEdition.streamingUrl}
                title="CMCM Luxembourg Indoor Meeting — Live Stream"
                width="100%"
                height="100%"
                style={{ position: "absolute", inset: 0, border: "none" }}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            </div>
          </div>
        </section>
      )}

      {/* ════════════════════════════════════════════════
          LIVE RESULTS (URL configurable depuis le backoffice)
      ════════════════════════════════════════════════ */}
      <section className="site-section site-section--alt" id="live-results">
        <div className="site-container">
          <div className="site-section-header site-section-header--center" style={{ marginBottom: 40 }}>
            <span className="site-eyebrow" style={{ color: "var(--site-red)" }}>● Live</span>
            <h2 className="site-heading">Live Results &amp; Live Streaming</h2>
            {latestEdition?.resultsUrl && (
              <p className="site-lead">
                Follow the competition in real time. Results are updated live throughout the day.
              </p>
            )}
          </div>
          {latestEdition?.resultsUrl ? (
            <>
              <div style={{
                borderRadius: "var(--site-radius-lg)",
                overflow: "hidden",
                border: "1px solid var(--site-border)",
                boxShadow: "0 8px 32px rgba(0,0,0,0.08)",
                background: "#fff",
              }}>
                <iframe
                  src={latestEdition.resultsUrl}
                  title="CMCM Luxembourg Indoor Meeting — Live Results"
                  width="100%"
                  height="700"
                  style={{ display: "block", border: "none" }}
                  loading="lazy"
                />
              </div>
              <div style={{ textAlign: "center", marginTop: 20 }}>
                <a
                  href={latestEdition.resultsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="site-btn site-btn--secondary site-btn--sm"
                >
                  Open full results page →
                </a>
              </div>
            </>
          ) : (
            <div style={{
              textAlign: "center",
              padding: "64px 32px",
              background: "var(--site-card)",
              border: "1px solid var(--site-border)",
              borderRadius: "var(--site-radius-lg)",
              color: "var(--site-text-muted)",
            }}>
              <div style={{ fontSize: "2.5rem", marginBottom: 16 }}>🏁</div>
              <h3 style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--site-text)", marginBottom: 8 }}>
                Coming soon
              </h3>
              <p style={{ fontSize: "0.9rem", maxWidth: 400, margin: "0 auto" }}>
                Live results will be available here on competition day.
              </p>
            </div>
          )}
        </div>
      </section>

      {/* ════════════════════════════════════════════════
          AFTERMOVIE
      ════════════════════════════════════════════════ */}
      <section className="site-section site-section--dark" id="aftermovie" style={{ position: "relative", overflow: "hidden" }}>
        <img
          src={coqueWide}
          alt=""
          aria-hidden="true"
          style={{
            position: "absolute", inset: 0,
            width: "100%", height: "100%",
            objectFit: "cover", objectPosition: "center 40%",
            opacity: 0.15,
            mixBlendMode: "luminosity",
            pointerEvents: "none",
          }}
        />
        <div className="site-container" style={{ position: "relative", zIndex: 1 }}>
          <div className="site-section-header site-section-header--center">
            <span className="site-eyebrow">2025 Edition</span>
            <h2 className="site-heading">Watch the aftermovie</h2>
            <p className="site-lead">
              Relive the best moments of the CMCM Luxembourg Indoor Meeting — elite performances, atmosphere and highlights from the Coque.
            </p>
          </div>
          <div style={{
            position: "relative",
            width: "100%",
            maxWidth: 900,
            margin: "0 auto",
            borderRadius: "var(--site-radius-lg)",
            overflow: "hidden",
            boxShadow: "0 24px 80px rgba(0,0,0,0.6)",
            border: "1px solid var(--site-border)",
            aspectRatio: "16/9",
          }}>
            <iframe
              width="100%"
              height="100%"
              src="https://www.youtube.com/embed/-SUlwo3DvcA?si=0boLsF9A59C0c5zD"
              title="CMCM Luxembourg Indoor Meeting — Aftermovie"
              frameBorder="0"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              referrerPolicy="strict-origin-when-cross-origin"
              allowFullScreen
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
            />
          </div>
          <div style={{ textAlign: "center", marginTop: 32 }}>
            <a
              href="https://www.youtube.com/@LuxembourgIndoorMeeting"
              target="_blank"
              rel="noopener noreferrer"
              className="site-btn site-btn--secondary site-btn--sm"
            >
              More videos on YouTube →
            </a>
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════
          ABOUT
      ════════════════════════════════════════════════ */}
      <section className="site-section">
        <div className="site-container">
          <div className="site-about__grid">
            <div className="site-about__visual" style={{ position: "relative" }}>
              <div style={{
                borderRadius: "var(--site-radius-lg)",
                overflow: "hidden",
                aspectRatio: "3/4",
                boxShadow: "0 16px 48px rgba(0,0,0,0.15)",
              }}>
                <img
                  src={aboutVdw}
                  alt="Elisa Van der Weken CMCM Luxembourg Indoor Meeting"
                  style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "center top" }}
                />
              </div>
              <div className="site-about__visual-badge">
                <strong>2003</strong>
                <span>First edition</span>
              </div>
            </div>

            <div className="site-about__text">
              <span className="site-eyebrow">About the meeting</span>
              <h2 className="site-heading site-heading--sm">
                Luxembourg's premier international indoor athletics event
              </h2>
              <p>
                The CMCM Luxembourg Indoor Meeting is Luxembourg's leading international indoor athletics event, bringing together elite athletes, national talents, partners, media and spectators at Coque Luxembourg.
              </p>
              <p>
                Part of the World Athletics Indoor Tour Silver circuit, the meeting attracts world-class performers across all disciplines, from sprints to field events, offering a unique atmosphere in the heart of Europe.
              </p>

              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 8, marginTop: 4 }}>
                {[
                  ["Coque", "Venue"],
                  ["January", "Each year"],
                  ["FLA", "Organiser"],
                  ["WA Silver", "Indoor Tour label"],
                ].map(([val, label]) => (
                  <div key={label} style={{
                    display: "flex",
                    flexDirection: "column",
                    padding: "10px 16px",
                    background: "var(--site-section-alt-bg, #f4f6f9)",
                    borderRadius: "var(--site-radius-sm)",
                    borderLeft: "3px solid var(--site-red)",
                  }}>
                    <strong style={{ fontSize: "0.9rem", fontWeight: 800, color: "var(--site-text)", lineHeight: 1.2 }}>{val}</strong>
                    <span style={{ fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--site-text-muted)", marginTop: 2 }}>{label}</span>
                  </div>
                ))}
              </div>

              <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginTop: "8px" }}>
                <NavLink to="/event" className="site-btn site-btn--primary site-btn--sm">
                  Event details
                </NavLink>
                <a
                  href="/benevoles"
                  className="site-btn site-btn--secondary site-btn--sm"
                >
                  Become a volunteer
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════
          GALLERY
      ════════════════════════════════════════════════ */}
      <section className="site-section site-section--alt site-gallery-section">
        <div className="site-container">
          <div className="site-section-header site-section-header--center" style={{ marginBottom: 40 }}>
            <span className="site-eyebrow">Edition 2026</span>
            <h2 className="site-heading">Live from the Coque</h2>
          </div>
          <div className="site-gallery-mosaic">
            <div className="site-gallery-item site-gallery-item--featured">
              <img src={galleryDaemen} alt="Athlete celebrating on stage with fireworks" />
              <div className="site-gallery-item__overlay">
                <span>Opening Ceremony</span>
              </div>
            </div>
            <div className="site-gallery-item">
              <img src={galleryWinner} alt="Winner ceremony" />
              <div className="site-gallery-item__overlay">
                <span>Winner Ceremony</span>
              </div>
            </div>
            <div className="site-gallery-item">
              <img src={galleryAutographs} alt="Athlete signing autographs for fans" />
              <div className="site-gallery-item__overlay">
                <span>Fan Moments</span>
              </div>
            </div>
            <div className="site-gallery-item">
              <img src={galleryVolunteers} alt="Volunteers on track" />
              <div className="site-gallery-item__overlay">
                <span>Our Volunteers</span>
              </div>
            </div>
            <div className="site-gallery-item">
              <img src={galleryMemories} alt="Fans with Memories 2026 frame" />
              <div className="site-gallery-item__overlay">
                <span>Memories 2026</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════
          HIGHLIGHTS
      ════════════════════════════════════════════════ */}
      <section className="site-section site-section--alt">
        <div className="site-container">
          <div className="site-section-header site-section-header--center">
            <span className="site-eyebrow">What makes it special</span>
            <h2 className="site-heading">The full meeting experience</h2>
            <p className="site-lead">
              More than just athletics — a complete international event experience combining sport, innovation, sustainability and premium hospitality.
            </p>
          </div>
          <div className="site-highlights">
            {HIGHLIGHTS.map((h) => (
              <div key={h.title} className="site-highlight-card">
                <div className={`site-highlight-card__icon ${h.colorClass}`}>
                  {h.icon}
                </div>
                <h3>{h.title}</h3>
                <p>{h.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════
          LATEST NEWS
      ════════════════════════════════════════════════ */}
      {news.length > 0 && (
        <section className="site-section">
          <div className="site-container">
            <div className="site-section-header" style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 48, flexWrap: "wrap", gap: 16 }}>
              <div>
                <span className="site-eyebrow">Latest updates</span>
                <h2 className="site-heading">News &amp; announcements</h2>
              </div>
              <NavLink to="/news" className="site-btn site-btn--secondary site-btn--sm">
                All news →
              </NavLink>
            </div>

            <div className="site-news-grid">
              {news.map((article) => (
                <NavLink key={article.id} to={`/news/${article.slug}`} className="site-news-card">
                  <div className="site-news-card__image">
                    {article.coverImageUrl ? (
                      <img src={article.coverImageUrl} alt={article.title} />
                    ) : (
                      <div className="site-news-card__image-placeholder">📰</div>
                    )}
                  </div>
                  <div className="site-news-card__body">
                    <div className="site-news-card__meta">
                      <span className={`site-badge ${categoryBadge(article.category)}`}>
                        {article.category || "News"}
                      </span>
                      <span className="site-news-card__date">
                        {formatNewsDate(article.publishedAt)}
                      </span>
                    </div>
                    <h3>{article.title}</h3>
                    <p>{article.excerpt}</p>
                    <span className="site-news-card__link">Read more →</span>
                  </div>
                </NavLink>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ════════════════════════════════════════════════
          LATEST EDITION WINNERS
      ════════════════════════════════════════════════ */}
      {latestWinners.length > 0 && (
        <section className="site-section site-section--alt">
          {/* Full-width action photo strip */}
          <div style={{ position: "relative", height: 220, overflow: "hidden" }}>
            <img
              src={ambiance1}
              alt="Race action CMCM Luxembourg Indoor Meeting"
              style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "center 30%" }}
            />
            <div style={{
              position: "absolute", inset: 0,
              background: "linear-gradient(to bottom, transparent 50%, var(--site-section-alt-bg, #f4f6f9) 100%)",
            }} />
          </div>
          {/* Title below the photo */}
          <div style={{ textAlign: "center", padding: "32px 0 40px" }}>
            <span className="site-eyebrow">Last edition · {latestYear}</span>
            <h2 className="site-heading site-heading--sm" style={{ margin: "8px 0 0" }}>Event winners</h2>
          </div>

          <div className="site-container">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 40, alignItems: "start" }}>

              {/* Side photos */}
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div style={{ borderRadius: "var(--site-radius)", overflow: "hidden", aspectRatio: "3/4" }}>
                  <img
                    src={ambiance2}
                    alt="Award ceremony CMCM Luxembourg Indoor Meeting"
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  />
                </div>
                <div style={{ borderRadius: "var(--site-radius)", overflow: "hidden", aspectRatio: "3/2" }}>
                  <img
                    src={ambiance3}
                    alt="Athlete on track CMCM Luxembourg Indoor Meeting"
                    style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "center 20%" }}
                  />
                </div>
              </div>

              {/* Table */}
              <div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
                  <p style={{ color: "var(--site-text-muted)", fontSize: "0.875rem", margin: 0 }}>
                    Final results — CMCM Luxembourg Indoor Meeting {latestYear}
                  </p>
                  <NavLink to="/statistics" className="site-btn site-btn--secondary site-btn--sm">
                    Full results →
                  </NavLink>
                </div>
                <div className="site-card">
                  <table className="site-records-table">
                    <thead>
                      <tr>
                        <th>Discipline</th>
                        <th>Athlete</th>
                        <th>Nation</th>
                        <th>Performance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {latestWinners.map((r, i) => (
                        <tr key={r.id || i}>
                          <td>
                            <span className={`site-badge ${r.gender === "W" ? "site-badge--red" : "site-badge--blue"}`} style={{ marginRight: 8 }}>
                              {r.gender === "W" ? "W" : "M"}
                            </span>
                            {normDiscipline(r.discipline)}
                          </td>
                          <td style={{ fontWeight: 600 }}>{r.firstName} {r.lastName}</td>
                          <td><span className="noc">{r.noc}</span></td>
                          <td className="mark">{r.mark || r.result}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ════════════════════════════════════════════════
          SPONSORS
      ════════════════════════════════════════════════ */}
      <section className="site-section site-section--dark">
        <div className="site-container">
          <div className="site-section-header site-section-header--center">
            <span className="site-eyebrow">Our partners</span>
            <h2 className="site-heading">They make it possible</h2>
            <p className="site-lead">
              The CMCM Luxembourg Indoor Meeting would not be possible without the trust and support of our valued partners across all sectors.
            </p>
          </div>

          {sponsors.length > 0 ? (
            categoryOrder
              .filter((cat) => sponsorsByCategory[cat]?.length)
              .map((cat) => (
                <div key={cat} className="site-sponsors__category">
                  <p className="site-sponsors__category-title">{sponsorCategoryLabel(cat, sponsorCategories)}</p>
                  <div className="site-sponsors__row">
                    {sponsorsByCategory[cat].map((s) => (
                      s.website ? (
                        <a
                          key={s.id}
                          href={s.website}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`site-sponsor-logo site-sponsor-logo--${cat}`}
                          title={s.name}
                        >
                          {s.logoUrl ? (
                            <div className="site-sponsor-logo__media">
                              <SponsorLogo sponsor={s} />
                            </div>
                          ) : (
                            <span className="site-sponsor-name">{s.name}</span>
                          )}
                        </a>
                      ) : (
                        <div
                          key={s.id}
                          className={`site-sponsor-logo site-sponsor-logo--${cat}`}
                          title={s.name}
                        >
                          {s.logoUrl ? (
                            <div className="site-sponsor-logo__media">
                              <SponsorLogo sponsor={s} />
                            </div>
                          ) : (
                            <span className="site-sponsor-name">{s.name}</span>
                          )}
                        </div>
                      )
                    ))}
                  </div>
                </div>
              ))
          ) : sponsorsLoading ? (
            <div style={{ textAlign: "center", color: "rgba(255,255,255,0.75)", fontSize: "0.95rem" }}>
              Loading partners…
            </div>
          ) : (
            /* Placeholder when no sponsors configured */
            <div style={{ textAlign: "center" }}>
              <div className="site-sponsors__category">
                <p className="site-sponsors__category-title">Title Partner</p>
                <div className="site-sponsors__row">
                  <div className="site-sponsor-logo site-sponsor-logo--title">
                    <span className="site-sponsor-name">CMCM</span>
                  </div>
                </div>
              </div>
              <div className="site-sponsors__category">
                <p className="site-sponsors__category-title">Institutional Partners</p>
                <div className="site-sponsors__row">
                  {["Ville de Luxembourg", "Gouvernement du Luxembourg", "La Coque", "FLA"].map((name) => (
                    <div key={name} className="site-sponsor-logo">
                      <span className="site-sponsor-name">{name}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div style={{ textAlign: "center", marginTop: 48 }}>
            <div className="site-home-partners__actions">
              <NavLink to="/partners" className="site-btn site-btn--secondary site-btn--sm">
                View all partners →
              </NavLink>
              <NavLink to="/become-a-partner" className="site-btn site-btn--primary site-btn--sm">
                Become a partner
              </NavLink>
            </div>
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════
          CTA BAND
      ════════════════════════════════════════════════ */}
      <section style={{
        background: "linear-gradient(135deg, var(--site-red) 0%, #9b000f 100%)",
        padding: "64px 0",
      }}>
        <div className="site-container" style={{ textAlign: "center" }}>
          <h2 style={{
            fontSize: "clamp(1.8rem, 4vw, 2.8rem)",
            fontWeight: 900,
            color: "#fff",
            marginBottom: 16,
          }}>
            Be part of the meeting
          </h2>
          <p style={{ color: "rgba(255,255,255,0.75)", fontSize: "1.05rem", marginBottom: 36, maxWidth: 520, margin: "0 auto 36px" }}>
            Join us as a volunteer, apply for press accreditation, or discover our VIP packages.
          </p>
          <div style={{ display: "flex", gap: 16, justifyContent: "center", flexWrap: "wrap" }}>
            <NavLink to="/become-a-partner" className="site-btn" style={{ background: "#fff", color: "var(--site-red)", fontWeight: 800 }}>
              Become a partner
            </NavLink>
            <a href="/benevoles" className="site-btn" style={{ background: "#fff", color: "var(--site-red)", fontWeight: 800 }}>
              Become a volunteer
            </a>
            <NavLink to="/pre-programme" className="site-btn" style={{ background: "#fff", color: "var(--site-red)", fontWeight: 800 }}>
              Pre-program inscription
            </NavLink>
            <NavLink to="/press" className="site-btn" style={{ background: "rgba(255,255,255,0.15)", color: "#fff", border: "1.5px solid rgba(255,255,255,0.35)" }}>
              Press registration
            </NavLink>
            <NavLink to="/event#vip" className="site-btn" style={{ background: "rgba(255,255,255,0.15)", color: "#fff", border: "1.5px solid rgba(255,255,255,0.35)" }}>
              VIP experience
            </NavLink>
          </div>
        </div>
      </section>
    </>
  );
}
