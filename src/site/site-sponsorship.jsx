import { NavLink } from "react-router-dom";
import { SponsorLogo } from "./sponsor-logo";
import { useSponsors } from "./site-hooks";
import heroPhoto from "../assets/hero-photo.jpg";
import galleryWinner from "../assets/site-gallery/gallery-winner.jpg";
import galleryDaemen from "../assets/site-gallery/gallery-daemen.jpg";
import galleryVolunteers from "../assets/site-gallery/gallery-volunteers.jpg";
import vip1 from "../assets/site-gallery/vip-1.jpg";
import preprogBusiness1 from "../assets/site-gallery/preprog-business-1.jpg";
import preprogBusiness2 from "../assets/site-gallery/preprog-business-2.jpg";
import coqueWide from "../assets/site-gallery/Coque2026.jpg";

const HERO_STATS = [
  { value: "2,497", label: "spectators" },
  { value: "158", label: "athletes" },
  { value: "41", label: "countries represented" },
  { value: "Silver", label: "World Athletics Indoor Tour" },
];

const WHY_PARTNER_ITEMS = [
  {
    eyebrow: "Visibility",
    title: "National and international exposure",
    description:
      "Associate your brand with a World Athletics Indoor Tour Silver event supported by national media, social platforms and streaming coverage.",
    bullets: ["World Athletics Indoor Tour Silver", "National and international media", "Social media and streaming reach"],
    image: galleryWinner,
    imageAlt: "Celebration at the CMCM Luxembourg Indoor Meeting",
  },
  {
    eyebrow: "Networking",
    title: "VIP experience and business connections",
    description:
      "Create high-value moments around the meeting through hospitality, public relations and direct connections with athletes, guests and decision-makers.",
    bullets: ["VIP invitations", "Public relations opportunities", "Athlete and partner networking"],
    image: vip1,
    imageAlt: "VIP hospitality atmosphere at the meeting",
  },
  {
    eyebrow: "Values",
    title: "A platform driven by meaning",
    description:
      "Join an event that brings together excellence, performance, youth, inclusion and sustainability in a premium international setting.",
    bullets: ["Excellence and performance", "Youth and inclusion", "Sustainability commitment"],
    image: galleryVolunteers,
    imageAlt: "Volunteers and event team at the CMCM Luxembourg Indoor Meeting",
  },
];

const KEY_FIGURES = [
  { value: "2,497", label: "Spectators" },
  { value: "158", label: "Athletes" },
  { value: "41", label: "Countries" },
  { value: "195", label: "Volunteers" },
  { value: "6", label: "World leading performances" },
  { value: "630+", label: "Instagram followers gained" },
  { value: "1.2M", label: "Instagram views" },
  { value: "64,000+", label: "Streaming views" },
];

const ACTIVATIONS = [
  {
    title: "Business Race",
    description: "Corporate relay or business race activations staged in the heart of the meeting environment.",
    image: preprogBusiness1,
    imageAlt: "Business activation during the CMCM Luxembourg Indoor Meeting",
  },
  {
    title: "Athlete@Work",
    description: "Bring elite athletes into your company for talks, inspiration sessions and internal engagement.",
    image: galleryDaemen,
    imageAlt: "Athlete portrait and event storytelling",
  },
  {
    title: "Winner Cards",
    description: "Official prize-giving moments where your brand is directly associated with the athletes' achievements.",
    image: galleryWinner,
    imageAlt: "Winner celebration at the CMCM Luxembourg Indoor Meeting",
  },
  {
    title: "On-site visibility",
    description: "Advertising boards, beach flags, media backdrops and VIP-zone presence tailored to your objectives.",
    image: preprogBusiness2,
    imageAlt: "Premium event setting inside Coque Luxembourg",
  },
];

const OFFER_PACKAGES = [
  {
    tier: "Bronze",
    price: "€5,000",
    features: ["Entry-level visibility package", "On-site brand presence", "Digital visibility relay"],
  },
  {
    tier: "Silver",
    price: "€15,000",
    features: ["Enhanced branding and hospitality", "Premium guest invitations", "Stronger media association"],
    featured: true,
  },
  {
    tier: "Gold",
    price: "€25,000",
    features: ["High-impact partnership format", "Top-tier visibility moments", "Expanded activation possibilities"],
  },
];

const SUSTAINABILITY_ITEMS = [
  "No single-use plastic",
  "Sustainable mobility",
  "Water distribution points",
  "An international-standard sustainability approach",
];

const TRUSTED_PARTNERS = [
  "CMCM",
  "Ville de Luxembourg",
  "Luxembourg - Let's Make It Happen",
  "RTL",
  "Loterie Nationale",
  "Emile Weber",
  "CK",
  "Reka",
  "Coque",
  "Asport",
];

function normalizeName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/\s+/g, " ");
}

function resolveTrustedSponsor(name, sponsors) {
  const target = normalizeName(name);
  return sponsors.find((sponsor) => normalizeName(sponsor.name).includes(target) || target.includes(normalizeName(sponsor.name))) || null;
}

function TrustedPartnerCard({ sponsor, fallbackName }) {
  return (
    <div className="site-sponsorship-trusted__card">
      {sponsor?.logoUrl ? (
        <div className="site-sponsorship-trusted__card-media">
          <SponsorLogo sponsor={sponsor} alt={fallbackName} />
        </div>
      ) : (
        <span>{fallbackName}</span>
      )}
    </div>
  );
}

export function SiteSponsorship() {
  const { sponsors } = useSponsors(true);
  const trustedSponsors = TRUSTED_PARTNERS.map((name) => ({
    name,
    sponsor: resolveTrustedSponsor(name, sponsors),
  }));

  return (
    <div className="site-sponsorship-page">
      <section className="site-sponsorship-hero">
        <div className="site-container site-sponsorship-hero__grid">
          <div className="site-sponsorship-hero__content">
            <span className="site-eyebrow">Partnership opportunities</span>
            <h1 className="site-heading">Become a partner of the CMCM Luxembourg Indoor Meeting</h1>
            <p className="site-lead">
              Associate your company with Luxembourg&apos;s leading international indoor athletics meeting and position your brand within a premium sporting, business and media environment.
            </p>

            <div className="site-sponsorship-hero__actions">
              <a
                href="mailto:events@fla.lu?subject=Sponsorship%20deck%20request%20%E2%80%93%20CMCM%20Luxembourg%20Indoor%20Meeting"
                className="site-btn site-btn--primary"
              >
                Receive the sponsorship deck
              </a>
              <a
                href="mailto:events@fla.lu?subject=Partnership%20inquiry%20%E2%80%93%20CMCM%20Luxembourg%20Indoor%20Meeting"
                className="site-btn site-btn--secondary"
              >
                Contact us
              </a>
            </div>

            <div className="site-sponsorship-hero__stats">
              {HERO_STATS.map((item) => (
                <div key={item.label} className="site-sponsorship-hero__stat">
                  <strong>{item.value}</strong>
                  <span>{item.label}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="site-sponsorship-hero__visual">
            <img src={heroPhoto} alt="Packed arena at the CMCM Luxembourg Indoor Meeting" />
            <div className="site-sponsorship-hero__overlay-card">
              <span>International platform</span>
              <p>Sport, business visibility and premium hospitality in one flagship event.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="site-section site-sponsorship-section">
        <div className="site-container">
          <div className="site-section-header">
            <span className="site-eyebrow">Why partner with us</span>
            <h2 className="site-heading site-heading--sm">A premium platform for visibility, relationships and impact</h2>
          </div>

          <div className="site-sponsorship-why-grid">
            {WHY_PARTNER_ITEMS.map((item) => (
              <article key={item.title} className="site-sponsorship-why-card">
                <div className="site-sponsorship-why-card__image">
                  <img src={item.image} alt={item.imageAlt} />
                </div>
                <div className="site-sponsorship-why-card__content">
                  <span className="site-eyebrow">{item.eyebrow}</span>
                  <h3>{item.title}</h3>
                  <p>{item.description}</p>
                  <div className="site-sponsorship-why-card__bullets">
                    {item.bullets.map((bullet) => (
                      <span key={bullet}>{bullet}</span>
                    ))}
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="site-section site-section--alt site-sponsorship-section">
        <div className="site-container">
          <div className="site-section-header site-section-header--center">
            <span className="site-eyebrow">Key figures</span>
            <h2 className="site-heading site-heading--sm">Strong numbers for strong visibility</h2>
          </div>

          <div className="site-sponsorship-metrics">
            {KEY_FIGURES.map((item) => (
              <div key={item.label} className="site-sponsorship-metric">
                <strong>{item.value}</strong>
                <span>{item.label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="site-section site-sponsorship-section">
        <div className="site-container">
          <div className="site-section-header">
            <span className="site-eyebrow">Activation opportunities</span>
            <h2 className="site-heading site-heading--sm">Partnerships that go beyond logo visibility</h2>
          </div>

          <div className="site-sponsorship-activation-grid">
            {ACTIVATIONS.map((item) => (
              <article key={item.title} className="site-sponsorship-activation-card">
                <img src={item.image} alt={item.imageAlt} />
                <div>
                  <h3>{item.title}</h3>
                  <p>{item.description}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="site-section site-section--alt site-sponsorship-section">
        <div className="site-container">
          <div className="site-section-header site-section-header--center">
            <span className="site-eyebrow">Trusted by</span>
            <h2 className="site-heading site-heading--sm">They already support the meeting</h2>
            <p className="site-lead">
              Leading institutions and companies already trust the CMCM Luxembourg Indoor Meeting as a platform for visibility and influence.
            </p>
          </div>

          <div className="site-sponsorship-trusted">
            {trustedSponsors.map(({ name, sponsor }) => (
              <TrustedPartnerCard key={name} sponsor={sponsor} fallbackName={name} />
            ))}
          </div>
        </div>
      </section>

      <section className="site-section site-sponsorship-section">
        <div className="site-container">
          <div className="site-sponsorship-offers">
            <div className="site-sponsorship-offers__intro">
              <span className="site-eyebrow">Partnership offers</span>
              <h2 className="site-heading site-heading--sm">Structured packages, with room for bespoke builds</h2>
              <p className="site-lead">
                Choose from three headline formats or let&apos;s design a tailored partnership aligned with your marketing, HR or CSR objectives.
              </p>
            </div>

            <div className="site-sponsorship-offers__grid">
              {OFFER_PACKAGES.map((offer) => (
                <article
                  key={offer.tier}
                  className={`site-sponsorship-offer-card${offer.featured ? " site-sponsorship-offer-card--featured" : ""}`}
                >
                  <span>{offer.tier}</span>
                  <strong>{offer.price}</strong>
                  <div>
                    {offer.features.map((feature) => (
                      <p key={feature}>{feature}</p>
                    ))}
                  </div>
                </article>
              ))}
            </div>

            <div className="site-sponsorship-bespoke">
              <div>
                <span className="site-eyebrow">Tailor-made partnerships</span>
                <h3>Custom-built around your goals</h3>
                <p>
                  We also create bespoke partnerships based on your marketing ambitions, employer-branding needs, hospitality goals or CSR commitments.
                </p>
              </div>
              <a
                href="mailto:events@fla.lu?subject=Details%20about%20partnership%20offers%20%E2%80%93%20CMCM%20Luxembourg%20Indoor%20Meeting"
                className="site-btn site-btn--primary"
              >
                Request offer details
              </a>
            </div>
          </div>
        </div>
      </section>

      <section className="site-section site-section--alt site-sponsorship-section">
        <div className="site-container">
          <div className="site-sponsorship-sustainability">
            <div className="site-sponsorship-sustainability__copy">
              <span className="site-eyebrow">Sustainability</span>
              <h2 className="site-heading site-heading--sm">A partnership story aligned with responsible event standards</h2>
              <p className="site-lead">
                The meeting continues to strengthen its environmental approach with practical on-site measures and a long-term commitment to responsible growth.
              </p>
            </div>
            <div className="site-sponsorship-sustainability__list">
              {SUSTAINABILITY_ITEMS.map((item) => (
                <div key={item} className="site-sponsorship-sustainability__item">
                  <span>•</span>
                  <p>{item}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="site-section site-sponsorship-final">
        <div className="site-container">
          <div className="site-sponsorship-final__panel">
            <div className="site-sponsorship-final__image">
              <img src={coqueWide} alt="Coque Luxembourg during the CMCM Luxembourg Indoor Meeting" />
            </div>
            <div className="site-sponsorship-final__content">
              <span className="site-eyebrow">Ready to join the journey?</span>
              <h2 className="site-heading site-heading--sm">Let&apos;s discuss the right partnership format for your company</h2>
              <p>
                We would be happy to explore the sponsorship opportunities that best match your business, brand positioning and relationship goals.
              </p>
              <div className="site-sponsorship-final__contact">
                <strong>Margot Laporte</strong>
                <span>Communication &amp; development</span>
                <a href="tel:+35262152922">+352 621 52 922</a>
                <a href="mailto:events@fla.lu">events@fla.lu</a>
              </div>
              <div className="site-sponsorship-final__actions">
                <a
                  href="mailto:events@fla.lu?subject=Let%27s%20talk%20partnership%20%E2%80%93%20CMCM%20Luxembourg%20Indoor%20Meeting"
                  className="site-btn site-btn--primary"
                >
                  Contact us
                </a>
                <NavLink to="/partners" className="site-btn site-btn--secondary">
                  View current partners
                </NavLink>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
