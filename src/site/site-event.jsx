import { NavLink } from "react-router-dom";
import { useSiteEditionYear } from "../app/edition";
import {
  createPrizeMoneySystemsDraft,
  formatPrizeMoneyAmount,
} from "../app/prize-money-utils";
import { useMeetingEditions } from "../app/meeting-history-hooks";
import volontaire1 from "../assets/site-gallery/volontaire-1.jpg";
import coque1 from "../assets/site-gallery/Coque2026.jpg";
import coque2 from "../assets/site-gallery/Coque2026-2.jpg";
import coque3 from "../assets/site-gallery/Coque2026-3.jpg";
import coque4 from "../assets/site-gallery/Coque2026-4.jpg";
import vip1 from "../assets/site-gallery/vip-1.jpg";
import vip2 from "../assets/site-gallery/vip-2.jpg";
import vip3 from "../assets/site-gallery/vip-3.jpg";
import vip4 from "../assets/site-gallery/vip-4.jpeg";
import vip5 from "../assets/site-gallery/vip-5.jpeg";
import vip6 from "../assets/site-gallery/vip-6.jpeg";
import ticketAmbiance1 from "../assets/site-gallery/ticket-ambiance-1.jpg";
import ticketAmbiance2 from "../assets/site-gallery/ticket-ambiance-2.jpg";
import ticketAmbiance3 from "../assets/site-gallery/ticket-ambiance-3.jpg";
import ticketFan1 from "../assets/site-gallery/ticket-fan-1.jpg";
import ticketPublic4 from "../assets/site-gallery/ticket-public-4.jpg";
import ticketPublic5 from "../assets/site-gallery/ticket-public-5.jpg";
import { TICKET_PRICING } from "./ticket-pricing-config";

const ACCESS_CARD = {
  icon: "🚌",
  title: "Access",
  content: "Bus lines 2, 18, 30",
  sub: "Free public transport on competition day",
};

function InfoCard({ icon, title, content, sub }) {
  return (
    <div className="site-event-info-card">
      <div className="site-event-info-card__icon">{icon}</div>
      <h3>{title}</h3>
      <p>{content}</p>
      {sub && <p style={{ fontSize: "0.82rem", marginTop: 4, color: "var(--site-text-dim)" }}>{sub}</p>}
    </div>
  );
}

function SectionTitle({ eyebrow, title, lead }) {
  return (
    <div className="site-section-header">
      <span className="site-eyebrow">{eyebrow}</span>
      <h2 className="site-heading site-heading--sm">{title}</h2>
      {lead && <p className="site-lead">{lead}</p>}
    </div>
  );
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

export function SiteEvent() {
  const { siteEditionYear } = useSiteEditionYear();
  const { editions } = useMeetingEditions();
  const latestEdition = editions[0] || null;
  const configuredEdition = siteEditionYear
    ? editions.find((edition) => Number(edition.year || edition.id) === Number(siteEditionYear)) || null
    : null;
  const currentEdition = configuredEdition || latestEdition || null;

  const infoCards = [
    {
      icon: "📅",
      title: "Date",
      content: formatEditionDate(currentEdition?.date),
      sub: "Doors open at 12:00",
    },
    {
      icon: "🏟️",
      title: "Venue",
      content: currentEdition?.venue || "To be confirmed",
      sub: "Luxembourg",
    },
    ACCESS_CARD,
  ];

  const timetable = Array.isArray(currentEdition?.timetable) ? currentEdition.timetable : [];
  const timetableVisible = currentEdition?.timetableStatus === "visible";
  const disciplines = Array.isArray(currentEdition?.disciplines) ? currentEdition.disciplines : [];
  const prizeMoneySystems = createPrizeMoneySystemsDraft(currentEdition?.prizeMoneySystems);
  const usedPrizeSystemKeys = Array.from(
    new Set(
      disciplines.flatMap((discipline) => [discipline.womenPrize, discipline.menPrize]).filter(Boolean),
    ),
  );

  return (
    <>
      {/* ── Hero ─────────────────────────────────────────── */}
      <section className="site-event-hero">
        <div className="site-container">
          <span className="site-eyebrow">Practical information</span>
          <h1 className="site-heading">The Event</h1>
          <p className="site-lead">
            Everything you need to know to attend, participate or follow the CMCM Luxembourg Indoor Meeting — your complete guide to the event.
          </p>

          <div className="site-event-info-grid">
            {infoCards.map((card) => (
              <InfoCard key={card.title} {...card} />
            ))}
          </div>
        </div>
      </section>

      {/* ── Venue photo strip ─────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", height: 280, overflow: "hidden" }}>
        {[coque1, coque2, coque3, coque4].map((src, i) => (
          <div key={i} style={{ overflow: "hidden" }}>
            <img
              src={src}
              alt=""
              style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", transition: "transform 0.4s ease" }}
              onMouseEnter={e => e.currentTarget.style.transform = "scale(1.04)"}
              onMouseLeave={e => e.currentTarget.style.transform = "scale(1)"}
            />
          </div>
        ))}
      </div>

      {/* ── About ────────────────────────────────────────── */}
      <section className="site-section">
        <div className="site-container">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 64, alignItems: "start" }}>
            <div>
              <SectionTitle
                eyebrow="About the event"
                title="World-class athletics in the heart of Europe"
                lead="The CMCM Luxembourg Indoor Meeting gathers elite track and field athletes for a full day of international competition at one of Europe's finest indoor athletics venues."
              />
              <p style={{ color: "var(--site-text-muted)", lineHeight: 1.75, marginBottom: 16 }}>
                Since 2003, the meeting has established itself as a key stop on the European indoor athletics circuit. Held at Coque — Luxembourg's national sports and culture centre — the event offers both elite athletes and spectators an exceptional experience.
              </p>
              <p style={{ color: "var(--site-text-muted)", lineHeight: 1.75, marginBottom: 32 }}>
                The meeting holds a World Athletics Indoor Tour Silver label, placing it among the top indoor athletics events on the continent.
              </p>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <NavLink to="/statistics" className="site-btn site-btn--primary site-btn--sm">
                  View results &amp; records
                </NavLink>
                <a
                  href="https://www.worldathletics.org/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="site-btn site-btn--secondary site-btn--sm"
                >
                  World Athletics
                </a>
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {[
                ["Competition format", "Heats and finals across all disciplines in a single day"],
                ["Athletes", "International elite athletes + national champions"],
                ["Broadcast", "Livestream available — check our social media for links"],
                ["Officials", "World Athletics certified technical officials"],
              ].map(([label, value]) => (
                <div
                  key={label}
                  style={{
                    padding: "20px 24px",
                    background: "var(--site-card)",
                    border: "1px solid var(--site-border)",
                    borderRadius: "var(--site-radius-sm)",
                    display: "grid",
                    gridTemplateColumns: "140px 1fr",
                    gap: 16,
                    alignItems: "center",
                  }}
                >
                  <span style={{ fontSize: "0.78rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--site-text-muted)" }}>
                    {label}
                  </span>
                  <span style={{ fontSize: "0.9rem", color: "var(--site-text)", lineHeight: 1.5 }}>
                    {value}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Disciplines ───────────────────────────────────── */}
      {disciplines.length > 0 && (
        <section className="site-section" id="disciplines">
          <div className="site-container">
            <SectionTitle
              eyebrow="Programme"
              title="Events & prize money for this edition"
            />
            <div style={{ display: "grid", gridTemplateColumns: usedPrizeSystemKeys.length > 0 ? "minmax(0, 1.5fr) minmax(300px, 0.9fr)" : "minmax(0, 1fr)", gap: 24, alignItems: "start" }}>
              <div className="site-card" style={{ overflow: "hidden", maxWidth: 760 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.88rem" }}>
                  <thead>
                    <tr style={{ background: "#1e3a5f", color: "#fff" }}>
                      <th style={{ padding: "10px 20px", textAlign: "center", width: "30%", fontWeight: 700, fontSize: "0.78rem", letterSpacing: "0.08em" }}>WOMEN</th>
                      <th style={{ padding: "10px 20px", textAlign: "center", fontWeight: 700, fontSize: "0.78rem", letterSpacing: "0.08em" }}>EVENT</th>
                      <th style={{ padding: "10px 20px", textAlign: "center", width: "30%", fontWeight: 700, fontSize: "0.78rem", letterSpacing: "0.08em" }}>MEN</th>
                    </tr>
                  </thead>
                  <tbody>
                    {disciplines.map((d, i) => (
                      <tr key={d.event} style={{ borderBottom: "1px solid var(--site-border)", background: i % 2 === 0 ? "var(--site-card)" : "#f8fafc" }}>
                        <td style={{ padding: "10px 20px", textAlign: "center", color: d.womenPrize ? "var(--site-text-muted)" : "#d1d5db", fontSize: "0.8rem" }}>
                          {d.womenPrize ? `Prize ${d.womenPrize}` : ""}
                        </td>
                        <td style={{ padding: "10px 20px", textAlign: "center", fontWeight: 700, color: "var(--site-text)" }}>{d.event}</td>
                        <td style={{ padding: "10px 20px", textAlign: "center", color: d.menPrize ? "var(--site-text-muted)" : "#d1d5db", fontSize: "0.8rem" }}>
                          {d.menPrize ? `Prize ${d.menPrize}` : ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {usedPrizeSystemKeys.length > 0 && (
                <div style={{ display: "grid", gap: 16 }}>
                  {usedPrizeSystemKeys.map((systemKey) => {
                    const rows = prizeMoneySystems[systemKey] || [];
                    return (
                      <div key={systemKey} className="site-card" style={{ padding: "24px 24px 18px" }}>
                        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, marginBottom: 14 }}>
                          <div>
                            <div className="site-eyebrow" style={{ marginBottom: 6 }}>Prize money</div>
                            <h3 style={{ margin: 0, fontSize: "1.1rem", color: "var(--site-text)" }}>System {systemKey}</h3>
                          </div>
                          <span style={{ fontSize: "0.74rem", color: "var(--site-text-muted)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                            EUR
                          </span>
                        </div>

                        {rows.length > 0 ? (
                          <div style={{ display: "grid", gap: 8 }}>
                            {rows.map((row) => (
                              <div
                                key={`${systemKey}-${row.place}`}
                                style={{
                                  display: "grid",
                                  gridTemplateColumns: "1fr auto",
                                  gap: 12,
                                  alignItems: "center",
                                  padding: "10px 0",
                                  borderTop: "1px solid var(--site-border)",
                                }}
                              >
                                <span style={{ fontSize: "0.88rem", color: "var(--site-text)" }}>{row.place}</span>
                                <strong style={{ fontSize: "0.9rem", color: "var(--site-red)" }}>
                                  {formatPrizeMoneyAmount(row.amount, row.currency)}
                                </strong>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p style={{ margin: 0, color: "var(--site-text-muted)", fontSize: "0.88rem", lineHeight: 1.6 }}>
                            Prize money details for system {systemKey} will be published soon.
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* ── Timetable ─────────────────────────────────────── */}
      <section className="site-section site-section--alt" id="timetable">
        <div className="site-container">
          <SectionTitle
            eyebrow="Programme"
            title="Event timetable"
            lead="Approximate schedule for competition day. Times may be adjusted — please check the official programme closer to the event."
          />

          {timetableVisible && timetable.length > 0 ? (
            <div style={{ overflow: "hidden", borderRadius: "var(--site-radius)", border: "1px solid var(--site-border)" }}>
              {timetable.map((entry, i) =>
                entry.type === "header" ? (
                  <div
                    key={entry.id || i}
                    style={{
                      padding: "10px 24px",
                      background: entry.label === "PRE-PROGRAM" ? "var(--site-red)" : "#1e3a5f",
                      color: "#fff",
                      fontWeight: 800,
                      fontSize: "0.8rem",
                      letterSpacing: "0.1em",
                      textTransform: "uppercase",
                    }}
                  >
                    {entry.label}
                  </div>
                ) : (
                  <div
                    key={entry.id || i}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "80px 100px 1fr auto",
                      alignItems: "center",
                      borderBottom: "1px solid var(--site-border)",
                      background: entry.isField ? "#1e3a8a" : "var(--site-card)",
                    }}
                  >
                    <div style={{
                      padding: "14px 16px",
                      fontWeight: 700,
                      fontSize: "0.875rem",
                      color: entry.isField ? "#93c5fd" : "var(--site-blue-dark)",
                      fontVariantNumeric: "tabular-nums",
                      borderRight: `2px solid ${entry.isField ? "#3b82f6" : "var(--site-blue)"}`,
                    }}>
                      {entry.time}
                    </div>
                    <div style={{
                      padding: "14px 12px",
                      fontSize: "0.78rem",
                      fontWeight: 700,
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                      color: entry.isField ? "#bfdbfe" : "var(--site-text-muted)",
                      borderRight: "1px solid var(--site-border)",
                    }}>
                      {entry.gender || ""}
                    </div>
                    <div style={{
                      padding: "14px 20px",
                      fontWeight: 600,
                      fontSize: "0.9rem",
                      color: entry.isField ? "#fff" : "var(--site-text)",
                    }}>
                      {entry.event}
                    </div>
                    {entry.round && (
                      <div style={{
                        padding: "14px 16px",
                        fontSize: "0.75rem",
                        fontWeight: 500,
                        color: entry.isField ? "rgba(255,255,255,0.6)" : "var(--site-text-muted)",
                        whiteSpace: "nowrap",
                      }}>
                        {entry.round}
                      </div>
                    )}
                  </div>
                )
              )}
            </div>
          ) : (
            <div style={{
              textAlign: "center",
              padding: "48px 32px",
              background: "var(--site-card)",
              border: "1px solid var(--site-border)",
              borderRadius: "var(--site-radius)",
              color: "var(--site-text-muted)",
            }}>
              <div style={{ fontSize: "2rem", marginBottom: 12 }}>📋</div>
              <p style={{ fontSize: "0.9rem" }}>Le programme détaillé sera disponible prochainement.</p>
            </div>
          )}
        </div>
      </section>

      {/* ── Tickets ───────────────────────────────────────── */}
      <section className="site-section" id="tickets">
        <div className="site-container">
          <SectionTitle
            eyebrow="Ticket sale"
            title="Tickets &amp; access"
            lead="Secure your place at the CMCM Luxembourg Indoor Meeting 2027."
          />

          {/* Atmosphere photo strip */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "2fr 1fr 1fr 1fr",
            gap: 6,
            height: 220,
            overflow: "hidden",
            borderRadius: "var(--site-radius)",
            marginBottom: 48,
          }}>
            {[ticketPublic5, ticketFan1, ticketPublic4, ticketAmbiance2].map((src, i) => (
              <div key={i} style={{ overflow: "hidden" }}>
                <img
                  src={src}
                  alt=""
                  style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", transition: "transform 0.5s ease" }}
                  onMouseEnter={e => e.currentTarget.style.transform = "scale(1.06)"}
                  onMouseLeave={e => e.currentTarget.style.transform = "scale(1)"}
                />
              </div>
            ))}
          </div>

          {/* Ticket cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 20, marginBottom: 32 }}>

            {/* Under 18 */}
            <div className="site-card" style={{ padding: "36px 32px", display: "flex", flexDirection: "column" }}>
              <div style={{ width: 40, height: 3, background: "var(--site-blue)", borderRadius: 2, marginBottom: 28 }} />
              <div style={{ fontSize: "0.72rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--site-text-muted)", marginBottom: 8 }}>Under 18</div>
              <div style={{ fontSize: "3rem", fontWeight: 900, color: "var(--site-blue)", lineHeight: 1, marginBottom: 6 }}>Free</div>
              <p style={{ fontSize: "0.85rem", color: "var(--site-text-muted)", lineHeight: 1.6, marginBottom: 28 }}>
                Free entrance for all spectators under 18 years old.
              </p>
              <div style={{ borderTop: "1px solid var(--site-border)", paddingTop: 20, marginTop: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
                {["Full day access to the stands", "Pre-programme + main programme"].map(item => (
                  <div key={item} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                    <span style={{ color: "var(--site-blue)", fontWeight: 700, fontSize: "0.9rem", marginTop: 1 }}>✓</span>
                    <span style={{ fontSize: "0.82rem", color: "var(--site-text-muted)", lineHeight: 1.5 }}>{item}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Regular — highlighted */}
            <div style={{
              padding: "36px 32px",
              background: "var(--site-card)",
              border: "2px solid var(--site-red)",
              borderRadius: "var(--site-radius)",
              display: "flex",
              flexDirection: "column",
              position: "relative",
              boxShadow: "0 8px 32px rgba(232,0,28,0.12)",
            }}>
              <div style={{
                position: "absolute",
                top: -13,
                left: "50%",
                transform: "translateX(-50%)",
                background: "var(--site-red)",
                color: "#fff",
                fontSize: "0.7rem",
                fontWeight: 800,
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                padding: "4px 16px",
                borderRadius: 20,
                whiteSpace: "nowrap",
              }}>Most popular</div>
              <div style={{ width: 40, height: 3, background: "var(--site-red)", borderRadius: 2, marginBottom: 28 }} />
              <div style={{ fontSize: "0.72rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--site-text-muted)", marginBottom: 8 }}>Regular Ticket</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 6 }}>
                <span style={{ fontSize: "3rem", fontWeight: 900, color: "var(--site-red)", lineHeight: 1 }}>€{TICKET_PRICING.regular.online}</span>
                <span style={{ background: "rgba(232,0,28,0.08)", color: "var(--site-red)", fontSize: "0.72rem", fontWeight: 700, padding: "3px 10px", borderRadius: 20 }}>
                  Early-bird €{TICKET_PRICING.regular.earlyBird} until {TICKET_PRICING.earlyBirdDeadlineLabel}
                </span>
              </div>
              <p style={{ fontSize: "0.78rem", color: "var(--site-text-muted)", marginBottom: 6 }}>
                €{TICKET_PRICING.regular.onSite} on-site
              </p>
              <p style={{ fontSize: "0.85rem", color: "var(--site-text-muted)", lineHeight: 1.6, marginBottom: 28 }}>
                Live the atmosphere from the stands, from the pre-programme to the final.
              </p>
              <div style={{ borderTop: "1px solid rgba(232,0,28,0.15)", paddingTop: 20, marginBottom: 24, display: "flex", flexDirection: "column", gap: 8 }}>
                {[
                  "Full day access to the stands",
                  "Pre-programme + main programme",
                  "Live international athletics",
                ].map(item => (
                  <div key={item} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                    <span style={{ color: "var(--site-red)", fontWeight: 700, fontSize: "0.9rem", marginTop: 1 }}>✓</span>
                    <span style={{ fontSize: "0.82rem", color: "var(--site-text-muted)", lineHeight: 1.5 }}>{item}</span>
                  </div>
                ))}
              </div>
              <a
                href="https://www.ticket-regional.lu/"
                target="_blank"
                rel="noopener noreferrer"
                className="site-btn site-btn--primary site-btn--sm"
                style={{ marginTop: "auto", textAlign: "center" }}
              >
                Buy ticket →
              </a>
            </div>

            {/* VIP */}
            <div style={{
              padding: "36px 32px",
              background: "linear-gradient(150deg, #1a1a2e 0%, #16213e 100%)",
              border: "1px solid rgba(201,162,39,0.3)",
              borderRadius: "var(--site-radius)",
              display: "flex",
              flexDirection: "column",
            }}>
              <div style={{ width: 40, height: 3, background: "#c9a227", borderRadius: 2, marginBottom: 28 }} />
              <div style={{ fontSize: "0.72rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "rgba(255,255,255,0.4)", marginBottom: 8 }}>VIP Ticket</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 6 }}>
                <span style={{ fontSize: "3rem", fontWeight: 900, color: "#c9a227", lineHeight: 1 }}>€{TICKET_PRICING.vip.online}</span>
                <span style={{ background: "rgba(201,162,39,0.15)", color: "#c9a227", fontSize: "0.72rem", fontWeight: 700, padding: "3px 10px", borderRadius: 20 }}>
                  Early-bird €{TICKET_PRICING.vip.earlyBird} until {TICKET_PRICING.earlyBirdDeadlineLabel}
                </span>
              </div>
              <p style={{ fontSize: "0.78rem", color: "rgba(255,255,255,0.55)", marginBottom: 6 }}>
                €{TICKET_PRICING.vip.onSite} on-site
              </p>
              <p style={{ fontSize: "0.85rem", color: "rgba(255,255,255,0.55)", lineHeight: 1.6, marginBottom: 28 }}>
                Premium seating, unlimited catering and an exclusive backstage tour. Limited places.
              </p>
              <div style={{ borderTop: "1px solid rgba(201,162,39,0.2)", paddingTop: 20, marginBottom: 24, display: "flex", flexDirection: "column", gap: 8 }}>
                {[
                  "Premium seating in the VIP area",
                  "Unlimited food & drinks",
                  "Exclusive 30-min VIP tour (14:15)",
                  "Choice: backstage or Coque guided visit",
                ].map(item => (
                  <div key={item} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                    <span style={{ color: "#c9a227", fontWeight: 700, fontSize: "0.9rem", marginTop: 1 }}>✓</span>
                    <span style={{ fontSize: "0.82rem", color: "rgba(255,255,255,0.55)", lineHeight: 1.5 }}>{item}</span>
                  </div>
                ))}
              </div>
              <a
                href="https://www.ticket-regional.lu/"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  marginTop: "auto",
                  display: "block",
                  textAlign: "center",
                  background: "#c9a227",
                  color: "#fff",
                  fontWeight: 700,
                  fontSize: "0.82rem",
                  padding: "11px 20px",
                  borderRadius: "var(--site-radius-sm)",
                  textDecoration: "none",
                }}
              >
                Buy VIP ticket →
              </a>
            </div>
          </div>

          {/* Bottom banner */}
          <div style={{
            padding: "20px 28px",
            background: "rgba(16,102,204,0.06)",
            border: "1px solid rgba(16,102,204,0.2)",
            borderRadius: "var(--site-radius-sm)",
            display: "flex",
            alignItems: "center",
            gap: 16,
            flexWrap: "wrap",
          }}>
            <span style={{ fontSize: "0.875rem", color: "var(--site-text-muted)", flex: 1 }}>
              On sale from <strong style={{ color: "var(--site-text)" }}>17 November 2026 at 10:00</strong> on ticket-regional.lu
            </span>
            <a href="https://www.ticket-regional.lu/" target="_blank" rel="noopener noreferrer" className="site-btn site-btn--primary site-btn--sm">
              Access ticketing →
            </a>
          </div>
        </div>
      </section>

      {/* ── VIP Experience ────────────────────────────────── */}
      <section className="site-section site-section--alt" id="vip">
        <div className="site-container">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 64, alignItems: "start" }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 4 }}>
                <span className="site-eyebrow" style={{ color: "#b08c1e", margin: 0 }}>VIP visits available!</span>
                <span style={{
                  background: "#1a1a2e",
                  color: "#c9a227",
                  fontSize: "0.72rem",
                  fontWeight: 700,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  padding: "3px 10px",
                  borderRadius: 20,
                  border: "1px solid rgba(201,162,39,0.4)",
                }}>
                  VIP ticket required
                </span>
              </div>
              <h2 className="site-heading site-heading--sm">Discover the Meeting Like Never Before</h2>
              <p style={{ color: "var(--site-text-muted)", lineHeight: 1.75, marginBottom: 24 }}>
                Join our exclusive VIP Tour and step behind the scenes of the CMCM Luxembourg Indoor Meeting 2026. Experience the excitement from a whole new perspective — walk through the athletes' warm-up area, feel the energy trackside, and explore the heart of the event.
              </p>

              <div style={{ marginBottom: 28 }}>
                <h4 style={{ fontSize: "0.82rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--site-text-muted)", marginBottom: 16 }}>
                  Choose your tour
                </h4>
                {[
                  { icon: "🎽", title: "Backstage tour", desc: "See where the action really happens — athlete warm-up areas, mixed zone, and behind the scenes." },
                  { icon: "🏛️", title: "La Coque guided visit", desc: "Discover Luxembourg's iconic sports complex, home to world-class facilities and innovation in sport." },
                ].map(({ icon, title, desc }) => (
                  <div
                    key={title}
                    style={{
                      display: "flex",
                      gap: 16,
                      marginBottom: 16,
                      padding: "16px 20px",
                      background: "var(--site-card)",
                      border: "1px solid var(--site-border)",
                      borderRadius: "var(--site-radius-sm)",
                    }}
                  >
                    <span style={{ fontSize: "1.5rem", flexShrink: 0, marginTop: 2 }}>{icon}</span>
                    <div>
                      <strong style={{ fontSize: "0.9rem", display: "block", marginBottom: 4, color: "var(--site-text)" }}>{title}</strong>
                      <span style={{ fontSize: "0.82rem", color: "var(--site-text-muted)", lineHeight: 1.5 }}>{desc}</span>
                    </div>
                  </div>
                ))}
              </div>

              <div style={{
                padding: "16px 20px",
                background: "rgba(201,162,39,0.1)",
                border: "1px solid rgba(201,162,39,0.3)",
                borderRadius: "var(--site-radius-sm)",
                marginBottom: 24,
              }}>
                <p style={{ fontSize: "0.875rem", color: "var(--site-text-muted)", margin: 0, lineHeight: 1.6 }}>
                  Exclusively reserved for <strong style={{ color: "#c9a227" }}>VIP ticket holders</strong>. <strong style={{ color: "var(--site-text)" }}>Both tours start at 14:15</strong> in the VIP area and last approximately 30 minutes. Participation is optional. <strong style={{ color: "var(--site-text)" }}>Places are limited</strong> — don't miss your chance!
                </p>
              </div>

              <a
                href="mailto:communication@fla.lu"
                className="site-btn site-btn--primary site-btn--sm"
              >
                Contact us for more info →
              </a>
            </div>

            {/* VIP photo grid */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              {[vip1, vip2, vip3, vip4, vip5, vip6].map((src, i) => (
                <div
                  key={i}
                  style={{
                    overflow: "hidden",
                    borderRadius: "var(--site-radius-sm)",
                    aspectRatio: "1",
                    gridColumn: i === 0 ? "1 / 3" : "auto",
                    gridRow: i === 0 ? "1 / 2" : "auto",
                  }}
                >
                  <img
                    src={src}
                    alt=""
                    style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", transition: "transform 0.4s ease" }}
                    onMouseEnter={e => e.currentTarget.style.transform = "scale(1.06)"}
                    onMouseLeave={e => e.currentTarget.style.transform = "scale(1)"}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Livestream ────────────────────────────────────── */}
      <section className="site-section" id="livestream">
        <div className="site-container">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 64, alignItems: "center" }}>
            <div>
              <SectionTitle
                eyebrow="Aftermovie · 2025 Edition"
                title="Relive the meeting"
                lead="Watch the aftermovie of the last edition. Livestream of the next edition will be available on competition day."
              />
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <a
                  href="https://www.youtube.com/@LuxembourgIndoorMeeting"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="site-btn site-btn--primary site-btn--sm"
                >
                  ▶ YouTube channel
                </a>
                <NavLink to="/statistics" className="site-btn site-btn--secondary site-btn--sm">
                  Results &amp; records
                </NavLink>
              </div>
            </div>
            <div style={{
              position: "relative",
              borderRadius: "var(--site-radius-lg)",
              overflow: "hidden",
              border: "1px solid var(--site-border)",
              aspectRatio: "16/9",
              boxShadow: "0 16px 48px rgba(0,0,0,0.5)",
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
          </div>
        </div>
      </section>

      {/* ── Volunteer ─────────────────────────────────────── */}
      <section className="site-section site-section--alt" id="volunteer">
        <div className="site-container">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 64, alignItems: "center" }}>
            <div style={{
              borderRadius: "var(--site-radius-lg)",
              overflow: "hidden",
              aspectRatio: "4/3",
              boxShadow: "0 8px 32px rgba(0,0,0,0.12)",
            }}>
              <img
                src={volontaire1}
                alt="CMCM Luxembourg Indoor Meeting volunteers"
                style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "center 25%" }}
              />
            </div>
            <div>
              <SectionTitle
                eyebrow="Get involved"
                title="Become a volunteer"
                lead="Join our team of volunteers and contribute to making the CMCM Luxembourg Indoor Meeting an unforgettable event."
              />
              <p style={{ color: "var(--site-text-muted)", lineHeight: 1.75, marginBottom: 24 }}>
                Each year, over 100 volunteers ensure the smooth running of the event — from athlete escort to timing, accreditation, hospitality and media support. It's an incredible experience and a great way to contribute to Luxembourg athletics.
              </p>
              <a href="/volunteer-apply" className="site-btn site-btn--primary site-btn--sm">
                Apply to volunteer →
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ── Sustainability ────────────────────────────────── */}
      <section className="site-section">
        <div className="site-container">
          <div style={{ maxWidth: 760, margin: "0 auto", textAlign: "center" }}>
            <span className="site-eyebrow">Our commitment</span>
            <h2 className="site-heading site-heading--sm">Sustainability</h2>
            <p style={{ color: "var(--site-text-muted)", fontSize: "1.05rem", lineHeight: 1.75, marginTop: 16 }}>
              The CMCM Luxembourg Indoor Meeting is committed to reducing its environmental impact. We work with partners and suppliers who share our values, encourage public transport use, minimise single-use plastics and offset unavoidable emissions. Sport has a role to play in building a more sustainable future — and we take that responsibility seriously.
            </p>
            <div style={{
              display: "flex",
              justifyContent: "center",
              gap: 32,
              marginTop: 40,
              flexWrap: "wrap",
            }}>
              {[
                ["🚌", "Public transport encouraged"],
                ["♻️", "Zero single-use plastic"],
                ["🌱", "Carbon offset programme"],
                ["💧", "Water station on site"],
              ].map(([icon, label]) => (
                <div key={label} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
                  <div style={{ fontSize: "2rem" }}>{icon}</div>
                  <span style={{ fontSize: "0.82rem", color: "var(--site-text-muted)", fontWeight: 600, textAlign: "center", maxWidth: 120 }}>
                    {label}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Contact CTA ───────────────────────────────────── */}
      <section className="site-section site-section--alt">
        <div className="site-container">
          <div style={{ textAlign: "center" }}>
            <h2 className="site-heading site-heading--sm" style={{ marginBottom: 16 }}>
              Any questions?
            </h2>
            <p className="site-lead" style={{ margin: "0 auto 32px" }}>
              Our team is happy to help with any questions about tickets, accreditation, volunteering or partnerships.
            </p>
            <a
              href="mailto:contact@luxembourg-indoor-meeting.lu"
              className="site-btn site-btn--primary"
            >
              Contact the organisation
            </a>
          </div>
        </div>
      </section>
    </>
  );
}
