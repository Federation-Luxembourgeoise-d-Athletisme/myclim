import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import cmcmLogo from "../assets/cmcm-logo.png";
import waLogo from "../assets/wa-indoor-tour-silver.png";
import { useAuth } from "../context/auth-context";
import { useSiteEditionYear } from "../app/edition";
import { useMeetingEditions } from "../app/meeting-history-hooks";
import "./site.css";

const BASE_NAV_LINKS = [
  { to: "/", label: "Home", end: true },
  { to: "/event", label: "Event" },
  { to: "/programme", label: "Pre-Programme" },
  { to: "/statistics", label: "Results & Statistics" },
  { to: "/press", label: "Press" },
  { to: "/partners", label: "Partners" },
];

function SocialIcon({ type }) {
  const paths = {
    instagram: "M7.75 2h8.5A5.75 5.75 0 0 1 22 7.75v8.5A5.75 5.75 0 0 1 16.25 22h-8.5A5.75 5.75 0 0 1 2 16.25v-8.5A5.75 5.75 0 0 1 7.75 2Zm0 1.5A4.25 4.25 0 0 0 3.5 7.75v8.5A4.25 4.25 0 0 0 7.75 20.5h8.5A4.25 4.25 0 0 0 20.5 16.25v-8.5A4.25 4.25 0 0 0 16.25 3.5h-8.5ZM12 7a5 5 0 1 1 0 10A5 5 0 0 1 12 7Zm0 1.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm5.25-2.5a1 1 0 1 1 0 2 1 1 0 0 1 0-2Z",
    facebook: "M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z",
    twitter: "M23 3a10.9 10.9 0 0 1-3.14 1.53 4.48 4.48 0 0 0-7.86 3v1A10.66 10.66 0 0 1 3 4s-4 9 5 13a11.64 11.64 0 0 1-7 2c9 5 20 0 20-11.5a4.5 4.5 0 0 0-.08-.83A7.72 7.72 0 0 0 23 3z",
  };
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
      <path d={paths[type]} />
    </svg>
  );
}

function ChevronDown() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
      strokeLinecap="round" strokeLinejoin="round" width="10" height="10">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

export function SiteLayout() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const mobileRef = useRef(null);
  const { currentUser } = useAuth();
  const { siteEditionYear } = useSiteEditionYear();
  const { editions } = useMeetingEditions();
  const isEmagazinePage = location.pathname === "/e-magazine";
  const showFooterCta = location.pathname !== "/become-a-partner";
  const latestEdition = editions[0] || null;
  const configuredEdition = siteEditionYear
    ? editions.find((edition) => Number(edition.year || edition.id) === Number(siteEditionYear)) || null
    : null;
  const currentEdition = configuredEdition || latestEdition || null;
  const emagazinePublished = (currentEdition?.emagazineStatus || "published") === "published";
  const navLinks = emagazinePublished
    ? [...BASE_NAV_LINKS.slice(0, 4), { to: "/e-magazine", label: "E-Magazine" }, ...BASE_NAV_LINKS.slice(4)]
    : BASE_NAV_LINKS;
  const pageClassName = [
    "site-page",
    isEmagazinePage ? "site-page--emagazine" : "",
    location.pathname === "/partners" ? "site-page--partners" : "",
    location.pathname === "/become-a-partner" ? "site-page--sponsorship" : "",
  ]
    .filter(Boolean)
    .join(" ");

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    document.body.style.overflow = mobileOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [mobileOpen]);

  return (
    <div className={pageClassName}>
      {/* ── Navigation ─────────────────────────────────── */}
      <nav className={`site-nav${scrolled || mobileOpen ? " site-nav--scrolled" : ""}`}>
        <div className="site-nav__inner">
          <NavLink to="/" className="site-nav__logo">
            <img src={cmcmLogo} alt="CMCM Luxembourg Indoor Meeting" />
            <div className="site-nav__logo-text">
              <span className="site-nav__logo-name">CMCM Luxembourg Indoor Meeting</span>
              <span className="site-nav__wa-text">World Athletics Indoor Tour Silver</span>
            </div>
          </NavLink>

          <ul className="site-nav__links">
            {navLinks.map((link) => (
              <li key={link.to}>
                <NavLink
                  to={link.to}
                  end={link.end}
                  className={({ isActive }) =>
                    `site-nav__link${isActive ? " site-nav__link--active" : ""}`
                  }
                >
                  {link.label}
                </NavLink>
              </li>
            ))}
          </ul>

          <div className="site-nav__actions">
            <NavLink to="/become-a-partner" className="site-nav__partner">
              Partner with us
            </NavLink>
            {currentUser ? (
              <a href="/app" className="site-nav__login site-nav__login--myspace">
                Mon espace →
              </a>
            ) : (
              <NavLink to="/login" className="site-nav__login">
                Login
              </NavLink>
            )}
            <button
              className="site-nav__burger"
              aria-label={mobileOpen ? "Close menu" : "Open menu"}
              onClick={() => setMobileOpen((o) => !o)}
            >
              <span style={mobileOpen ? { transform: "rotate(45deg) translate(5px, 5px)" } : {}} />
              <span style={mobileOpen ? { opacity: 0 } : {}} />
              <span style={mobileOpen ? { transform: "rotate(-45deg) translate(5px, -5px)" } : {}} />
            </button>
          </div>
        </div>
      </nav>

      {/* ── Mobile nav ──────────────────────────────────── */}
      <div ref={mobileRef} className={`site-nav__mobile${mobileOpen ? " site-nav__mobile--open" : ""}`}>
        {navLinks.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            end={link.end}
            className={({ isActive }) =>
              `site-nav__mobile-link${isActive ? " site-nav__mobile-link--active" : ""}`
            }
          >
            {link.label}
          </NavLink>
        ))}
        <NavLink to="/become-a-partner" className="site-nav__mobile-partner">
          Partner with us
        </NavLink>
        {currentUser ? (
          <a href="/app" className="site-nav__mobile-login">Mon espace →</a>
        ) : (
          <NavLink to="/login" className="site-nav__mobile-login">Login →</NavLink>
        )}
      </div>

      {/* ── Page content ────────────────────────────────── */}
      <main>
        <Outlet />
      </main>

      {/* ── Footer ──────────────────────────────────────── */}
      {!isEmagazinePage ? (
      <footer className="site-footer">
        <div className="site-container">
          {showFooterCta && (
            <div className="site-footer__cta">
              <div className="site-footer__cta-copy">
                <span className="site-footer__cta-eyebrow">Partnership opportunities</span>
                <h2>Become a partner of the CMCM Luxembourg Indoor Meeting</h2>
                <p>
                  Join an international athletics event that combines visibility, hospitality, business relationships and Luxembourg-wide reach.
                </p>
              </div>
              <div className="site-footer__cta-actions">
                <NavLink to="/become-a-partner" className="site-btn site-btn--primary">
                  Sponsorship opportunities
                </NavLink>
                <a
                  href="mailto:events@fla.lu?subject=Partnership%20inquiry%20%E2%80%93%20CMCM%20Luxembourg%20Indoor%20Meeting"
                  className="site-btn site-btn--secondary"
                >
                  Contact us
                </a>
              </div>
            </div>
          )}

          <div className="site-footer__grid">
            <div className="site-footer__brand">
              <img src={cmcmLogo} alt="CMCM Luxembourg Indoor Meeting" />
              <img src={waLogo} alt="World Athletics Indoor Tour Silver" className="site-footer__wa-logo" />
              <p>
                Luxembourg's premier international indoor athletics event, part of the World Athletics Indoor Tour Silver circuit, held annually at Coque Luxembourg.
              </p>
              <div className="site-footer__social">
                <a
                  href="https://www.instagram.com/cmcm_lux_indoor_meet/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="site-footer__social-link"
                  aria-label="Instagram"
                >
                  <SocialIcon type="instagram" />
                </a>
                <a
                  href="https://www.facebook.com/search/top?q=cmcm%20luxembourg%20indoor%20meeting"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="site-footer__social-link"
                  aria-label="Facebook"
                >
                  <SocialIcon type="facebook" />
                </a>
              </div>
            </div>

            <div>
              <p className="site-footer__col-title">Navigation</p>
              <ul className="site-footer__col-links">
                {navLinks.map((link) => (
                  <li key={link.to}>
                    <NavLink to={link.to} end={link.end}>{link.label}</NavLink>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <p className="site-footer__col-title">Information</p>
              <ul className="site-footer__col-links">
                <li><NavLink to="/event">Venue & Access</NavLink></li>
                <li><NavLink to="/event#tickets">Tickets</NavLink></li>
                <li><NavLink to="/programme">Pre-Programme</NavLink></li>
                {emagazinePublished ? <li><NavLink to="/e-magazine">E-Magazine</NavLink></li> : null}
                <li><NavLink to="/programme#business-race">Business Race</NavLink></li>
                <li><NavLink to="/event#volunteer">Become a Volunteer</NavLink></li>
                <li><NavLink to="/press">Press Accreditation</NavLink></li>
                <li><NavLink to="/statistics">Meeting Records</NavLink></li>
              </ul>
            </div>

            <div>
              <p className="site-footer__col-title">Contact</p>
              <ul className="site-footer__col-links">
                <li>
                  <a href="mailto:events@fla.lu">
                    events@fla.lu
                  </a>
                </li>
                <li><a href="https://fla.lu" target="_blank" rel="noopener noreferrer">Fédération Luxembourgeoise d'Athlétisme</a></li>
                <li><NavLink to="/partners">Our Partners</NavLink></li>
                <li><NavLink to="/login">Admin Login</NavLink></li>
              </ul>
            </div>
          </div>

          <div className="site-footer__bottom">
            <span className="site-footer__copy">
              © {new Date().getFullYear()} CMCM Luxembourg Indoor Meeting · Fédération Luxembourgeoise d'Athlétisme
            </span>
            <div className="site-footer__legal">
              <a href="/legal">Legal notice</a>
              <a href="/privacy">Privacy policy</a>
              <a href="/accessibility">Accessibility</a>
            </div>
          </div>
        </div>
      </footer>
      ) : null}
    </div>
  );
}
