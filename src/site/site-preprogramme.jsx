import { NavLink } from "react-router-dom";
import { useSiteEditionYear } from "../app/edition";
import { useMeetingEditions } from "../app/meeting-history-hooks";
import business1 from "../assets/site-gallery/preprog-business-1.jpg";
import business2 from "../assets/site-gallery/preprog-business-2.jpg";
import influencer from "../assets/site-gallery/preprog-influencer.jpg";
import influencerGodart from "../assets/site-gallery/preprog-gforster.jpg";
import specialOlympics1 from "../assets/site-gallery/preprog-specialolympics-1.jpg";
import specialOlympics2 from "../assets/site-gallery/preprog-specialolympics-2.jpg";
import kids1 from "../assets/site-gallery/preprog-kids-1.jpg";
import kids2 from "../assets/site-gallery/preprog-kids-2.jpg";
import kids3 from "../assets/site-gallery/preprog-kids-3.jpg";
import national60m from "../assets/site-gallery/preprog-national-60m.jpg";
import national800mMen from "../assets/site-gallery/preprog-national-800m-men.jpg";
import national800mWomen from "../assets/site-gallery/preprog-national-800m-women.jpg";

function SectionTitle({ eyebrow, title, lead, center }) {
  return (
    <div className={`site-section-header${center ? " site-section-header--center" : ""}`}>
      <span className="site-eyebrow">{eyebrow}</span>
      <h2 className="site-heading site-heading--sm">{title}</h2>
      {lead && <p className="site-lead">{lead}</p>}
    </div>
  );
}

function CheckItem({ children, color = "var(--site-red)" }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 10 }}>
      <span style={{ color, fontWeight: 700, marginTop: 1, flexShrink: 0 }}>✓</span>
      <span style={{ fontSize: "0.875rem", color: "var(--site-text-muted)", lineHeight: 1.5 }}>{children}</span>
    </div>
  );
}

function PhotoGrid({ photos }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
      {photos.map((src, i) => (
        <div
          key={i}
          style={{
            overflow: "hidden",
            borderRadius: "var(--site-radius-sm)",
            aspectRatio: i === 0 && photos.length > 2 ? "16/9" : "4/3",
            gridColumn: i === 0 && photos.length > 2 ? "1 / 3" : "auto",
          }}
        >
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
  );
}

export function SitePreProgramme() {
  const { siteEditionYear } = useSiteEditionYear();
  const { editions } = useMeetingEditions();
  const latestEdition = editions[0] || null;
  const configuredEdition = siteEditionYear
    ? editions.find((edition) => Number(edition.year || edition.id) === Number(siteEditionYear)) || null
    : null;
  const currentEdition = configuredEdition || latestEdition || null;
  const nationalRacesRegistrationUrl = String(currentEdition?.preprogrammeNationalRacesUrl || "").trim();
  const nationalRaces = [
    { event: "60m Women", icon: "⚡" },
    { event: "60m Men", icon: "⚡" },
    { event: "800m Women", icon: "🏃" },
    { event: "800m Men", icon: "🏃" },
  ];
  const programmeHighlights = [
    { id: "influencer-race", label: "Influencer Race", image: influencer },
    { id: "business-race", label: "Business Race", image: business1 },
    { id: "national-races", label: "National Races", image: national60m },
    { id: "youth", label: "Youth Programme", image: kids1 },
  ];

  return (
    <>
      {/* ── Hero ─────────────────────────────────────────── */}
      <section
        style={{
          background: "linear-gradient(135deg, #0a0a1a 0%, #1a1a3e 60%, #0d0d2b 100%)",
          paddingTop: "calc(var(--site-nav-h) + 80px)",
          paddingBottom: 80,
          color: "#fff",
        }}
      >
        <div className="site-container">
          <span className="site-eyebrow" style={{ color: "var(--site-red)" }}>Before the main show</span>
          <h1 className="site-heading" style={{ color: "#fff" }}>Pre-Programme</h1>
          <p className="site-lead" style={{ color: "rgba(255,255,255,0.7)", maxWidth: 640 }}>
            Before the elite programme kicks off, the CMCM Luxembourg Indoor Meeting offers a dynamic and entertaining pre-programme open to the public — featuring corporate relay races, youth athletics, influencer challenges and an inclusive Special Olympics race.
          </p>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 32 }}>
            <a href="#business-race" className="site-btn site-btn--primary">
              Business Race →
            </a>
            <a href="#youth" className="site-btn site-btn--secondary">
              Youth Programme
            </a>
          </div>
        </div>
      </section>

      {/* ── Photo strip ─────────────────────────────────── */}
      <div className="site-programme-highlights">
        {programmeHighlights.map(({ id, label, image }) => (
          <div key={id} style={{ display: "grid", gap: 10 }}>
            <div style={{ height: 250, overflow: "hidden", borderRadius: "var(--site-radius-sm)" }}>
              <img
                src={image}
                alt={label}
                style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", transition: "transform 0.5s ease" }}
                onMouseEnter={e => e.currentTarget.style.transform = "scale(1.04)"}
                onMouseLeave={e => e.currentTarget.style.transform = "scale(1)"}
              />
            </div>
            <a
              href={`#${id}`}
              className="site-btn site-btn--secondary site-btn--sm"
              style={{ justifyContent: "center", width: "100%" }}
            >
              {label} ↓
            </a>
          </div>
        ))}
      </div>

      {/* ── Influencer Race ────────────────────────────── */}
      <section className="site-section" id="influencer-race">
        <div className="site-container">
          <div className="site-split" style={{ alignItems: "center" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {[influencer, influencerGodart].map((src, i) => (
                <div key={i} style={{ overflow: "hidden", borderRadius: "var(--site-radius-sm)", aspectRatio: "4/3" }}>
                  <img
                    src={src}
                    alt=""
                    style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", transition: "transform 0.4s ease" }}
                    onMouseEnter={e => e.currentTarget.style.transform = "scale(1.05)"}
                    onMouseLeave={e => e.currentTarget.style.transform = "scale(1)"}
                  />
                </div>
              ))}
            </div>
            <div>
              <span className="site-eyebrow">Opening act</span>
              <h2 className="site-heading site-heading--sm">
                🔥 Influencer Race<br />
                <span style={{ fontSize: "1.1rem", fontWeight: 500, color: "var(--site-text-muted)" }}>against Lux Stars</span>
              </h2>
              <p style={{ color: "var(--site-text-muted)", lineHeight: 1.75, marginBottom: 20 }}>
                Two spectacular 60m races set the stage — one for women, one for men. Luxembourg influencers will go head-to-head against local sports stars in an explosive duel at the heart of La Coque.
              </p>
              <p style={{ color: "var(--site-text-muted)", lineHeight: 1.75, marginBottom: 28 }}>
                The concept blends elite sport, social media and pure entertainment, putting Luxembourg athletes in the spotlight in a fun, competitive atmosphere that's made to be shared.
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {[
                  { icon: "👩", label: "Women's race", value: "60m — influencers vs. Lux stars" },
                  { icon: "👨", label: "Men's race", value: "60m — influencers vs. Lux stars" },
                ].map(({ icon, label, value }) => (
                  <div
                    key={label}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 16,
                      padding: "14px 20px",
                      background: "var(--site-card)",
                      border: "1px solid var(--site-border)",
                      borderRadius: "var(--site-radius-sm)",
                    }}
                  >
                    <span style={{ fontSize: "1.4rem" }}>{icon}</span>
                    <div>
                      <strong style={{ fontSize: "0.85rem", display: "block", color: "var(--site-text)" }}>{label}</strong>
                      <span style={{ fontSize: "0.8rem", color: "var(--site-text-muted)" }}>{value}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Business Race ─────────────────────────────── */}
      <section className="site-section site-section--alt" id="business-race">
        <div className="site-container">
          <SectionTitle
            eyebrow="Corporate experience"
            title="💼 Business Race"
            lead="Six Luxembourg companies compete side by side on the track at La Coque, in front of the meeting's audience. A unique opportunity to combine team spirit, sport and a premium brand experience."
          />

          {/* Format */}
          <div className="site-split" style={{ alignItems: "start", marginBottom: 64 }}>
            <div>
              <h3 style={{ fontSize: "1rem", fontWeight: 700, marginBottom: 20, color: "var(--site-text)" }}>
                🏃 Race Format — Mixed 4 × 200m Relay
              </h3>
              <p style={{ color: "var(--site-text-muted)", lineHeight: 1.75, marginBottom: 20 }}>
                Each team must include 2 women and 2 men. Teams compete in a relay format with an official presentation, baton passing, final ranking and a podium ceremony.
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {[
                  "Official team presentation in the arena",
                  "Relay race on the track (4 × 200m)",
                  "Final ranking and Business Race podium",
                  "Speaker announcement and crowd atmosphere",
                ].map(item => <CheckItem key={item}>{item}</CheckItem>)}
              </div>
              <div style={{
                marginTop: 24,
                padding: "16px 20px",
                background: "rgba(16,102,204,0.07)",
                border: "1px solid rgba(16,102,204,0.2)",
                borderRadius: "var(--site-radius-sm)",
              }}>
                <strong style={{ display: "block", fontSize: "0.85rem", color: "var(--site-text)", marginBottom: 4 }}>🏆 Winning company bonus</strong>
                <p style={{ fontSize: "0.825rem", color: "var(--site-text-muted)", margin: 0, lineHeight: 1.6 }}>
                  The winning company's representative will hand out a <em>Winner Card</em> during the main programme — your brand on the international stage.
                </p>
              </div>
            </div>

            <PhotoGrid photos={[business1, business2, influencerGodart]} />
          </div>

          {/* Packs */}
          <h3 style={{ fontSize: "1rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--site-text-muted)", marginBottom: 28 }}>
            Company Packages
          </h3>
          <div className="site-split site-split--tight">
            {/* Pack 1 */}
            <div className="site-card" style={{ padding: 36 }}>
              <div style={{ width: 48, height: 4, background: "var(--site-red)", borderRadius: 2, marginBottom: 24 }} />
              <h3 style={{ fontSize: "0.9rem", fontWeight: 700, color: "var(--site-text)", marginBottom: 6 }}>Pack 1 — Business Race Experience</h3>
              <div style={{ fontSize: "2.2rem", fontWeight: 900, color: "var(--site-red)", marginBottom: 20, lineHeight: 1 }}>
                €250
              </div>
              <div style={{ marginBottom: 24 }}>
                <CheckItem>1 team in the mixed 4 × 200m relay</CheckItem>
                <CheckItem>Baton-passing training (week before, Saturday or morning of the event)</CheckItem>
                <CheckItem>Option to organise a lunch before the event</CheckItem>
                <CheckItem>4 VIP places</CheckItem>
                <CheckItem>8 standard places for participants</CheckItem>
              </div>
              <a href="mailto:communication@fla.lu" className="site-btn site-btn--secondary site-btn--sm">
                Register your team →
              </a>
            </div>

            {/* Pack 2 */}
            <div
              className="site-card"
              style={{
                padding: 36,
                background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)",
                border: "1px solid rgba(255,255,255,0.1)",
              }}
            >
              <div style={{ width: 48, height: 4, background: "#c9a227", borderRadius: 2, marginBottom: 24 }} />
              <h3 style={{ fontSize: "0.9rem", fontWeight: 700, color: "#fff", marginBottom: 6 }}>Pack 2 — Business Team Building Experience</h3>
              <div style={{ fontSize: "2.2rem", fontWeight: 900, color: "#c9a227", marginBottom: 4, lineHeight: 1 }}>
                From €1,500
              </div>
              <p style={{ fontSize: "0.78rem", color: "rgba(255,255,255,0.5)", marginBottom: 20 }}>From 15 participants · ~15 days before the meeting</p>
              <div style={{ marginBottom: 24 }}>
                {[
                  "1 team in the mixed 4 × 200m relay",
                  "Team-building session with a FLA elite athlete",
                  "Interactive conference: performance, motivation, leadership, stress management, cohesion or personal challenge",
                  "10 VIP places during the meeting",
                  "Immersive 'inside athletics' experience",
                ].map(item => (
                  <div key={item} style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 10 }}>
                    <span style={{ color: "#c9a227", fontWeight: 700, marginTop: 1, flexShrink: 0 }}>✓</span>
                    <span style={{ fontSize: "0.875rem", color: "rgba(255,255,255,0.65)", lineHeight: 1.5 }}>{item}</span>
                  </div>
                ))}
              </div>
              <a
                href="mailto:communication@fla.lu"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  background: "#c9a227",
                  color: "#fff",
                  fontWeight: 700,
                  fontSize: "0.8rem",
                  padding: "10px 20px",
                  borderRadius: "var(--site-radius-sm)",
                  textDecoration: "none",
                }}
              >
                Request a quote →
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ── Youth Programme ────────────────────────────── */}
      <section className="site-section" id="youth">
        <div className="site-container">
          <SectionTitle
            eyebrow="Young athletes"
            title="👧 Youth Pre-Programme"
            lead="Luxembourg's youngest licensed athletes compete on the same track as the elite — a memorable experience for young runners."
          />

          {/* Photo strip */}
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 8, marginBottom: 48, height: 280, overflow: "hidden" }}>
            {[kids1, kids2, kids3].map((src, i) => (
              <div key={i} style={{ overflow: "hidden", borderRadius: "var(--site-radius-sm)" }}>
                <img
                  src={src}
                  alt=""
                  style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", transition: "transform 0.4s ease" }}
                  onMouseEnter={e => e.currentTarget.style.transform = "scale(1.05)"}
                  onMouseLeave={e => e.currentTarget.style.transform = "scale(1)"}
                />
              </div>
            ))}
          </div>

          <div className="site-split" style={{ alignItems: "start" }}>
            <div>
              <div style={{ marginBottom: 32 }}>
                {[
                  { event: "60m U12", icon: "⚡" },
                  { event: "60m U14", icon: "⚡" },
                  { event: "1000m U14", icon: "🏃" },
                ].map(({ event, icon }) => (
                  <div
                    key={event}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 16,
                      padding: "14px 20px",
                      background: "var(--site-card)",
                      border: "1px solid var(--site-border)",
                      borderRadius: "var(--site-radius-sm)",
                      marginBottom: 8,
                    }}
                  >
                    <span style={{ fontSize: "1.4rem" }}>{icon}</span>
                    <strong style={{ color: "var(--site-text)", fontSize: "0.9rem" }}>{event}</strong>
                  </div>
                ))}
              </div>
              <div style={{
                padding: "20px 24px",
                background: "rgba(16,102,204,0.06)",
                border: "1px solid rgba(16,102,204,0.2)",
                borderRadius: "var(--site-radius-sm)",
                marginBottom: 24,
              }}>
                <p style={{ fontSize: "0.875rem", color: "var(--site-text-muted)", margin: 0, lineHeight: 1.7 }}>
                  <strong style={{ color: "var(--site-text)", display: "block", marginBottom: 4 }}>Participation conditions</strong>
                  Reserved for licensed athletes from Luxembourg clubs · One race per child · Limited places · First come, first served
                </p>
              </div>
              <div style={{
                padding: "20px 24px",
                background: "var(--site-card)",
                border: "1px solid var(--site-border)",
                borderRadius: "var(--site-radius-sm)",
                marginBottom: 16,
              }}>
                <p style={{ fontSize: "0.875rem", color: "var(--site-text-muted)", margin: 0, lineHeight: 1.7 }}>
                  <strong style={{ color: "var(--site-text)", display: "block", marginBottom: 4 }}>Also possible: basket carrier</strong>
                  Young athletes can also apply to be a basket carrier during the meeting. This option is available in the same form as the youth races.
                </p>
              </div>
              <div style={{
                padding: "20px 24px",
                background: "var(--site-card)",
                border: "1px solid var(--site-border)",
                borderRadius: "var(--site-radius-sm)",
                marginBottom: 24,
              }}>
                <strong style={{ color: "var(--site-text)", display: "block", marginBottom: 10 }}>How the registration form works</strong>
                <div style={{ display: "grid", gap: 10 }}>
                  {[
                    "A parent account is created during registration.",
                    "For each child, you fill in birth date, club and licence number.",
                    "You can choose Youth Pre-Programme, Basket Carrier, or accept either option depending on availability.",
                    "Each child can only be confirmed for one activity on meeting day, and the final status is then tracked in the parent portal.",
                  ].map((item) => (
                    <div key={item} style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                      <span style={{ color: "var(--site-red)", fontWeight: 700, marginTop: 1, flexShrink: 0 }}>•</span>
                      <span style={{ fontSize: "0.86rem", color: "var(--site-text-muted)", lineHeight: 1.6 }}>{item}</span>
                    </div>
                  ))}
                </div>
              </div>
              <a href="/pre-programme" className="site-btn site-btn--primary site-btn--sm">
                Register (athlete access) →
              </a>

              <div
                id="national-races"
                style={{
                marginTop: 24,
                padding: "20px 24px",
                background: "var(--site-card)",
                border: "1px solid var(--site-border)",
                borderRadius: "var(--site-radius-sm)",
              }}>
                <div style={{ marginBottom: 16 }}>
                  <span className="site-eyebrow" style={{ marginBottom: 8, display: "block" }}>National races</span>
                  <h3 style={{ margin: 0, fontSize: "2rem", lineHeight: 1.05, color: "var(--site-text)", fontWeight: 800 }}>
                    🏁 National Races
                  </h3>
                  <p style={{ margin: "8px 0 0", fontSize: "1rem", color: "var(--site-text-muted)" }}>
                    60m & 800m registrations via SELTEC
                  </p>
                </div>
                <p style={{ fontSize: "0.875rem", color: "var(--site-text-muted)", lineHeight: 1.7, marginTop: 0, marginBottom: 16 }}>
                  National races will also be held before the main programme, with dedicated entries for women and men on 60m and 800m.
                </p>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 16 }}>
                  {nationalRaces.map(({ event, icon }) => (
                    <div
                      key={event}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        padding: "12px 14px",
                        borderRadius: "var(--site-radius-sm)",
                        background: "#f8fafc",
                        border: "1px solid #e2e8f0",
                      }}
                    >
                      <span style={{ fontSize: "1.2rem" }}>{icon}</span>
                      <strong style={{ color: "var(--site-text)", fontSize: "0.84rem" }}>{event}</strong>
                    </div>
                  ))}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 1fr", gap: 8, marginBottom: 16 }}>
                  {[national60m, national800mMen, national800mWomen].map((src, index) => (
                    <div key={src} style={{ overflow: "hidden", borderRadius: "var(--site-radius-sm)", aspectRatio: index === 0 ? "16/10" : "4/5" }}>
                      <img
                        src={src}
                        alt=""
                        style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", transition: "transform 0.4s ease" }}
                        onMouseEnter={e => e.currentTarget.style.transform = "scale(1.05)"}
                        onMouseLeave={e => e.currentTarget.style.transform = "scale(1)"}
                      />
                    </div>
                  ))}
                </div>
                {nationalRacesRegistrationUrl ? (
                  <a
                    href={nationalRacesRegistrationUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="site-btn site-btn--secondary site-btn--sm"
                  >
                    Register on SELTEC →
                  </a>
                ) : (
                  <p style={{ margin: 0, fontSize: "0.78rem", color: "var(--site-text-dim)" }}>
                    Registration link will be published here as soon as it is available.
                  </p>
                )}
              </div>
            </div>

            {/* Special Olympics */}
            <div>
              <SectionTitle
                center={false}
                eyebrow="Inclusive sport"
                title="❤️ Special Olympics Race"
              />
              <p style={{ color: "var(--site-text-muted)", lineHeight: 1.75, marginBottom: 24 }}>
                The pre-programme also features a dedicated race for Special Olympics athletes, celebrating inclusion, personal achievement and the values of sport for all — in front of the full meeting audience.
              </p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 24 }}>
                {[specialOlympics1, specialOlympics2].map((src, i) => (
                  <div key={i} style={{ overflow: "hidden", borderRadius: "var(--site-radius-sm)", aspectRatio: "4/3" }}>
                    <img
                      src={src}
                      alt=""
                      style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", transition: "transform 0.4s ease" }}
                      onMouseEnter={e => e.currentTarget.style.transform = "scale(1.05)"}
                      onMouseLeave={e => e.currentTarget.style.transform = "scale(1)"}
                    />
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {[
                  ["🤝", "Promoting inclusion in high-level sport"],
                  ["🌟", "Celebrating every athlete's achievement"],
                  ["💪", "Sport for all — at the heart of the meeting"],
                ].map(([icon, label]) => (
                  <div key={label} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <span style={{ fontSize: "1.2rem" }}>{icon}</span>
                    <span style={{ fontSize: "0.875rem", color: "var(--site-text-muted)" }}>{label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Contact CTA ───────────────────────────────── */}
      <section className="site-section site-section--alt">
        <div className="site-container">
          <div style={{ textAlign: "center" }}>
            <h2 className="site-heading site-heading--sm" style={{ marginBottom: 16 }}>
              Interested in the Business Race?
            </h2>
            <p className="site-lead" style={{ margin: "0 auto 32px" }}>
              Contact our team to secure your company's spot and choose your package. Places are limited to 6 companies.
            </p>
            <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
              <a href="mailto:communication@fla.lu" className="site-btn site-btn--primary">
                Contact us →
              </a>
              <NavLink to="/event" className="site-btn site-btn--secondary">
                Back to Event info
              </NavLink>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
