import { NavLink } from "react-router-dom";
import { usePublishedPressReleases } from "./site-hooks";

// Fichiers servis depuis public/press-kit (copiés depuis le dossier Communication).
const PRESS_KIT_ITEMS = [
  {
    icon: "🖼️",
    label: "Official logos",
    format: "PNG + SVG, colour and monochrome",
    links: [["ZIP", "/press-kit/cmcm-lim-logos.zip"], ["PNG", "/press-kit/logos/cmcm-lim-logo-principal.png"]],
  },
  {
    icon: "🪧",
    label: "Official poster 2027",
    format: "PDF, A5",
    links: [["EN", "/press-kit/cmcm-lim-2027-poster-en.pdf"], ["FR", "/press-kit/cmcm-lim-2027-poster-fr.pdf"]],
  },
  {
    icon: "📸",
    label: "Photo gallery",
    format: "All editions, by photographer · © FLA",
    links: [["Browse", "/gallery", false]],
  },
  { icon: "📋", label: "Meeting factsheet", format: "PDF" },
];

function formatDate(ts) {
  if (!ts) return "";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

function PressReleaseCard({ release }) {
  return (
    <div className="site-press-release-card">
      <div className="site-press-release-card__icon">📄</div>
      <div className="site-press-release-card__body">
        <div className="site-press-release-card__meta">
          <span className="site-badge site-badge--gray">{release.category || "Press release"}</span>
          {release.language && (
            <span className="site-badge site-badge--blue">{release.language.toUpperCase()}</span>
          )}
          <span style={{ fontSize: "0.78rem", color: "var(--site-text-dim)" }}>
            {formatDate(release.date)}
          </span>
        </div>
        <h3>{release.title}</h3>
        {release.fileUrl && (
          <a
            href={release.fileUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="site-btn site-btn--secondary site-btn--sm"
            style={{ marginTop: 12, display: "inline-flex" }}
          >
            ↓ Download PDF
          </a>
        )}
      </div>
    </div>
  );
}

export function SitePress() {
  const { releases, loading } = usePublishedPressReleases();

  return (
    <>
      {/* ── Hero ─────────────────────────────────────────── */}
      <section className="site-press-hero">
        <div className="site-container">
          <span className="site-eyebrow">Media & Journalists</span>
          <h1 className="site-heading">Press</h1>
          <p className="site-lead">
            All the resources and information you need to cover the CMCM Luxembourg Indoor Meeting — accreditation, press releases, media contacts and assets.
          </p>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <a href="/login" className="site-btn site-btn--primary">
              Press registration
            </a>
            <a
              href="mailto:communication@fla.lu"
              className="site-btn site-btn--secondary"
            >
              Contact press office
            </a>
          </div>
        </div>
      </section>

      {/* ── Main content ─────────────────────────────────── */}
      <section className="site-section">
        <div className="site-container">
          <div className="site-press-grid">
            {/* Left — releases + info */}
            <div>
              {/* Press info */}
              <div style={{ marginBottom: 48 }}>
                <span className="site-eyebrow">Accreditation</span>
                <h2 className="site-heading site-heading--sm" style={{ marginBottom: 20 }}>Press information</h2>

                <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                  {[
                    ["📋", "Accreditation", "Press accreditation requests must be submitted via the online form. A valid press card or editorial letter is required."],
                    ["🎫", "Media access", "Accredited journalists have access to the mixed zone, press tribune and post-race interviews."],
                    ["📷", "Photography", "Photographers must indicate equipment. Flash photography is restricted during track events."],
                    ["🎬", "Video", "Broadcast rights inquiries should be directed to the media contact below. Social media clips are permitted."],
                    ["⏰", "Deadline", "Accreditation requests close 7 days before the event. Late requests are processed on a case-by-case basis."],
                  ].map(([icon, label, text]) => (
                    <div
                      key={label}
                      style={{
                        display: "flex",
                        gap: 16,
                        padding: "20px 24px",
                        background: "var(--site-card)",
                        border: "1px solid var(--site-border)",
                        borderRadius: "var(--site-radius-sm)",
                      }}
                    >
                      <span style={{ fontSize: "1.4rem", flexShrink: 0 }}>{icon}</span>
                      <div>
                        <strong style={{ display: "block", color: "var(--site-text)", marginBottom: 4, fontSize: "0.9rem" }}>{label}</strong>
                        <p style={{ fontSize: "0.875rem", lineHeight: 1.65 }}>{text}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Press releases */}
              <div>
                <span className="site-eyebrow">Documents</span>
                <h2 className="site-heading site-heading--sm" style={{ marginBottom: 24 }}>Press releases</h2>

                {loading ? (
                  <div style={{ color: "var(--site-text-muted)", fontSize: "0.875rem" }}>Loading…</div>
                ) : releases.length === 0 ? (
                  <div
                    style={{
                      padding: "48px 32px",
                      background: "var(--site-card)",
                      border: "1px solid var(--site-border)",
                      borderRadius: "var(--site-radius)",
                      textAlign: "center",
                      color: "var(--site-text-muted)",
                    }}
                  >
                    <div style={{ fontSize: "2rem", marginBottom: 12 }}>📂</div>
                    <p style={{ fontSize: "0.875rem" }}>No press releases published yet.<br />Check back closer to the event.</p>
                  </div>
                ) : (
                  releases.map((r) => <PressReleaseCard key={r.id} release={r} />)
                )}
              </div>
            </div>

            {/* Right — sidebar */}
            <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
              {/* Press contact */}
              <div style={{
                background: "var(--site-card)",
                border: "1px solid var(--site-border)",
                borderRadius: "var(--site-radius)",
                padding: 28,
              }}>
                <h3 style={{ fontSize: "0.875rem", fontWeight: 700, marginBottom: 16 }}>Press contact</h3>
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div>
                    <span style={{ fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700, color: "var(--site-text-muted)" }}>
                      Communication
                    </span>
                    <p style={{ fontSize: "0.9rem", color: "var(--site-text)", marginTop: 4 }}>
                      Fédération Luxembourgeoise d'Athlétisme
                    </p>
                  </div>
                  <div>
                    <span style={{ fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700, color: "var(--site-text-muted)" }}>
                      Email
                    </span>
                    <a
                      href="mailto:communication@fla.lu"
                      style={{ display: "block", fontSize: "0.9rem", color: "var(--site-blue-light)", marginTop: 4 }}
                    >
                      communication@fla.lu
                    </a>
                  </div>
                </div>
                <div style={{ marginTop: 20, paddingTop: 20, borderTop: "1px solid var(--site-border)" }}>
                  <a href="/login" className="site-btn site-btn--primary site-btn--sm" style={{ width: "100%", justifyContent: "center" }}>
                    Apply for press accreditation →
                  </a>
                </div>
              </div>

              {/* Press kit */}
              <div style={{
                background: "var(--site-card)",
                border: "1px solid var(--site-border)",
                borderRadius: "var(--site-radius)",
                padding: 28,
              }}>
                <h3 style={{ fontSize: "0.875rem", fontWeight: 700, marginBottom: 16 }}>Press kit</h3>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {PRESS_KIT_ITEMS.map(({ icon, label, format, links }) => (
                    <div
                      key={label}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        padding: "12px 0",
                        borderBottom: "1px solid var(--site-border)",
                      }}
                    >
                      <span>{icon}</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: "0.875rem", color: "var(--site-text)" }}>{label}</div>
                        <div style={{ fontSize: "0.75rem", color: "var(--site-text-dim)" }}>{format}</div>
                      </div>
                      {links ? (
                        <span style={{ display: "flex", gap: 10 }}>
                          {links.map(([text, href, isDownload = true]) => (
                            <a
                              key={href}
                              href={href}
                              download={isDownload || undefined}
                              style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--site-red)", whiteSpace: "nowrap" }}
                            >
                              {text} {isDownload ? "↓" : "→"}
                            </a>
                          ))}
                        </span>
                      ) : (
                        <span style={{ fontSize: "0.72rem", color: "var(--site-text-dim)" }}>On request</span>
                      )}
                    </div>
                  ))}
                </div>
                <p style={{ fontSize: "0.8rem", color: "var(--site-text-muted)", marginTop: 16, lineHeight: 1.6 }}>
                  Logos, poster and photos are free to use for coverage of the meeting
                  (photos credited © FLA). The factsheet is sent upon accreditation approval.
                </p>
              </div>

              {/* Media articles coming in Phase 2 */}
              <div style={{
                background: "rgba(16, 102, 204, 0.05)",
                border: "1px solid rgba(16, 102, 204, 0.2)",
                borderRadius: "var(--site-radius)",
                padding: 24,
              }}>
                <h3 style={{ fontSize: "0.875rem", fontWeight: 700, marginBottom: 8, color: "var(--site-blue-light)" }}>
                  Media coverage
                </h3>
                <p style={{ fontSize: "0.82rem", lineHeight: 1.65, color: "var(--site-text-muted)" }}>
                  Articles and media coverage archive will be available soon. Contact the press office for a curated list of past coverage.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
