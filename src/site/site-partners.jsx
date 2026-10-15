import { NavLink } from "react-router-dom";
import { SponsorLogo } from "./sponsor-logo";
import { useSponsorCategories, useSponsors } from "./site-hooks";
import { sponsorCategoryLabel } from "./sponsor-utils";
import cmcmPressConference from "../assets/partner-stories/cmcm-press-conference.jpg";
import villeWinnerBoard from "../assets/partner-stories/ville-winner-board.jpg";
import raceActionTrack from "../assets/partner-stories/race-action-track.jpg";
import cmcmAthleteMoment from "../assets/partner-stories/cmcm-athlete-moment.jpg";
import luxembourgWinnerBoard from "../assets/partner-stories/luxembourg-winner-board.jpg";
import ambiance1 from "../assets/site-gallery/ambiance-1.jpg";
import ambiance2 from "../assets/site-gallery/ambiance-2.jpg";
import galleryWinner from "../assets/site-gallery/gallery-winner.jpg";

const MAIN_PARTNERS = [
  {
    key: "cmcm",
    name: "CMCM",
    matchers: ["cmcm"],
    sectionLabel: "Title partner",
    subtitle: "Luxembourg's trusted mutual health partner",
    paragraphs: [
      "As Title Partner of the CMCM Luxembourg Indoor Meeting, CMCM is Luxembourg's leading health mutual. For more than 70 years, it has supported individuals and families in Luxembourg and the Greater Region through complementary health protection built on solidarity, accessibility and mutual support.",
      "CMCM places prevention, health and families at the heart of its mission. By making complementary health protection more accessible while encouraging healthier, more active lifestyles.",
    ],
    meetingLink:
      "By supporting the CMCM Luxembourg Indoor Meeting, CMCM reinforces its long-standing commitment to health, prevention, sport and inclusion. Built on shared values of excellence, solidarity and commitment, this partnership supports one of Luxembourg's flagship sporting events while promoting healthier, more active lifestyles. Bringing together world-class athletes, Luxembourg's top athletes and thousands of spectators, the meeting celebrates sporting excellence, diversity and inclusion.",
    values: ["Solidarity", "Health", "Prevention", "Families", "Accessibility", "Inclusion"],
    highlights: [
      { label: "Foundation", text: "A trusted health mutual for Luxembourg and the Greater Region." },
      { label: "Mission", text: "Making complementary health protection more human, accessible and durable." },
      { label: "Impact", text: "Helping people live healthier lives through prevention, solidarity and accessible healthcare." },
    ],
    buttonLabel: "Discover CMCM",
    siteUrl: "https://www.cmcm.lu/fr",
    videoUrl: "https://www.youtube.com/embed/gytMuNsX5DA",
    videoTitle: "CMCM official video",
    mediaPosition: "right",
    backdropUrl: ambiance1,
    photoPosition: "center 18%",
    photoUrl: cmcmPressConference,
    photoAlt: "Athletes and organisers during the 2026 CMCM Luxembourg Indoor Meeting press conference",
    photoCaption: "A moment from the 2026 CMCM Luxembourg Indoor Meeting press conference.",
  },
  {
    key: "ville",
    name: "Ville de Luxembourg",
    matchers: ["ville de luxembourg"],
    sectionLabel: "Title partner",
    subtitle: "A dynamic, open and sporting capital city",
    paragraphs: [
      "Capital of the Grand Duchy, the City of Luxembourg is a European city recognised for its quality of life, cultural diversity and dynamism. Modern, international and forward-looking, it plays an essential role in the development of sport, culture and major events.",
      "The City of Luxembourg supports many initiatives that contribute to the capital's attractiveness and the country's visibility. Its commitment to sport helps create the right conditions for clubs, federations, athletes and spectators to experience top-level events.",
    ],
    meetingLink:
      "Through its support of the CMCM Luxembourg Indoor Meeting, the City of Luxembourg helps promote athletics, encourages sport among younger generations and contributes to positioning the capital as a recognised stage for international sporting events.",
    values: ["Sport", "Capital city", "Diversity", "Quality of life", "Inclusion", "International reach"],
    highlights: [
      { label: "Capital", text: "A vibrant European city, open and well suited to major international events." },
      { label: "Sport", text: "Structural support for clubs, federations, athletes and top-level competitions." },
      { label: "Youth", text: "A momentum that encourages sporting practice and inspires new generations." },
    ],
    buttonLabel: "Visit the City website",
    siteUrl: "https://www.vdl.lu/fr",
    embedType: "site",
    embedUrl: "https://maps.vdl.lu/portal/apps/sites/#/topo",
    embedTitle: "Ville de Luxembourg interactive map",
    mediaPosition: "left",
    backdropUrl: galleryWinner,
    photoUrl: villeWinnerBoard,
    photoAlt: "Winners ceremony with the City of Luxembourg",
    photoCaption: "The meeting brings international athletics into the life of the capital.",
  },
  {
    key: "lmih",
    name: "Luxembourg - Let's Make It Happen",
    matchers: ["luxembourg let's make it happen", "luxembourg - let's make it happen"],
    sectionLabel: "Title partner",
    subtitle: "Promoting Luxembourg on the international stage",
    paragraphs: [
      "Luxembourg - Let's Make It Happen is the national initiative dedicated to promoting the image of Luxembourg. Its mission is to strengthen the country's positive perception, move beyond stereotypes and reveal Luxembourg in all its richness: its authenticity, history, heritage, values, talents and the people who embody them.",
      "The initiative brings together and supports the people and organisations that help showcase Luxembourg beyond its borders. It highlights a country that is open, reliable, creative, dynamic and deeply international.",
    ],
    meetingLink:
      "The CMCM Luxembourg Indoor Meeting fully reflects this ambition. By bringing together athletes from around the world, committed volunteers, institutional partners and a passionate audience, the event becomes a showcase for Luxembourgish know-how and actively contributes to the country's international sporting profile.",
    values: ["Openness", "Dynamism", "Creativity", "Diversity", "Reliability", "Promoting Luxembourg"],
    highlights: [
      { label: "Country image", text: "An initiative that modernises and enriches the perception of Luxembourg internationally." },
      { label: "Network", text: "A link between institutions, talents, events and people who help the country shine." },
      { label: "Showcase", text: "The meeting becomes an ideal stage to present an ambitious and welcoming Luxembourg." },
    ],
    buttonLabel: "Discover Luxembourg - Let's Make It Happen",
    siteUrl: "https://lmih.lu",
    videoUrl: "https://www.youtube.com/embed/JCwLPcrv3Ls",
    videoTitle: "Luxembourg - Let's Make It Happen official video",
    mediaPosition: "right",
    backdropUrl: ambiance2,
    photoUrl: luxembourgWinnerBoard,
    photoAlt: "Patrizia Van der Weken and Madame la Ministre Martine Hansen with Luxembourg - Let's Make It Happen",
    photoCaption: "Patrizia Van der Weken and Madame la Ministre Martine Hansen representing Luxembourg - Let's Make It Happen.",
    photoPosition: "center top",
    photoAspectRatio: "4 / 5",
  },
];

function normalizeName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/\s+/g, " ");
}

function resolvePartnerSponsor(partner, sponsors) {
  return sponsors.find((sponsor) => {
    const sponsorName = normalizeName(sponsor.name);
    return partner.matchers.some((matcher) => {
      const normalizedMatcher = normalizeName(matcher);
      return sponsorName === normalizedMatcher || sponsorName.includes(normalizedMatcher);
    });
  }) || null;
}

function PartnerLogo({ sponsor, fallbackName, compact = false }) {
  return (
    <div className={`site-main-partner-logo${compact ? " site-main-partner-logo--compact" : ""}`}>
      {sponsor?.logoUrl ? (
        <div className="site-main-partner-logo__media">
          <SponsorLogo sponsor={sponsor} alt={fallbackName} />
        </div>
      ) : (
        <span>{fallbackName}</span>
      )}
    </div>
  );
}

function HeroLogoStrip({ entries }) {
  return (
    <div className="site-main-partners-hero__logos">
      {entries.map(({ partner, sponsor }) => (
        <div key={partner.key} className="site-main-partners-hero__logo-card">
          <PartnerLogo sponsor={sponsor} fallbackName={partner.name} compact />
          <div>
            <strong>{partner.name}</strong>
            <span>{partner.sectionLabel}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function SponsorLogoCard({ sponsor }) {
  const inner = (
    <div className="site-main-partners-sponsor-card" title={sponsor.name}>
      {sponsor.logoUrl ? (
        <div className="site-main-partners-sponsor-card__media">
          <SponsorLogo sponsor={sponsor} />
        </div>
      ) : (
        <span className="site-main-partners-sponsor-card__name">{sponsor.name}</span>
      )}
    </div>
  );

  if (sponsor.website) {
    return (
      <a href={sponsor.website} target="_blank" rel="noopener noreferrer" className="site-main-partners-sponsor-link">
        {inner}
      </a>
    );
  }

  return inner;
}

function PartnerSection({ partner, sponsor }) {
  const websiteUrl = sponsor?.website || partner.siteUrl;
  const sectionStyle = partner.backdropUrl
    ? { "--partner-story-backdrop": `url(${partner.backdropUrl})` }
    : undefined;

  return (
    <section
      className={`site-main-partner-section${partner.mediaPosition === "left" ? " site-main-partner-section--media-left" : ""}`}
      style={sectionStyle}
    >
      <div className="site-main-partner-section__content">
        <div className="site-main-partner-section__header">
          <PartnerLogo sponsor={sponsor} fallbackName={partner.name} />
          <div>
            <p className="site-main-partner-section__eyebrow">{partner.sectionLabel}</p>
            <h2>{partner.name}</h2>
            <p className="site-main-partner-section__subtitle">{partner.subtitle}</p>
          </div>
        </div>

        <div className="site-main-partner-section__copy">
          {partner.paragraphs.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </div>

        <div className="site-main-partner-section__highlight-grid">
          {partner.highlights.map((item) => (
            <div key={item.label} className="site-main-partner-section__highlight-card">
              <span>{item.label}</span>
              <p>{item.text}</p>
            </div>
          ))}
        </div>

        <div className="site-main-partner-section__meeting-link">
          <span>Connection to the CMCM Luxembourg Indoor Meeting</span>
          <p>{partner.meetingLink}</p>
        </div>

        <div className="site-main-partner-section__values">
          {partner.values.map((value) => (
            <span key={value} className="site-main-partner-section__value">
              {value}
            </span>
          ))}
        </div>
      </div>

      <div className="site-main-partner-section__media">
        <div className="site-main-partner-section__video-shell">
          <div className="site-main-partner-section__video-ratio">
            {partner.embedType === "site" ? (
              <iframe
                src={partner.embedUrl}
                title={partner.embedTitle}
                loading="lazy"
                referrerPolicy="strict-origin-when-cross-origin"
              />
            ) : (
              <iframe
                src={partner.videoUrl}
                title={partner.videoTitle}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
              />
            )}
          </div>
        </div>

        <figure className="site-main-partner-section__photo">
          <img
            src={partner.photoUrl}
            alt={partner.photoAlt}
            style={{
              ...(partner.photoPosition ? { objectPosition: partner.photoPosition } : {}),
              ...(partner.photoAspectRatio ? { aspectRatio: partner.photoAspectRatio } : {}),
            }}
          />
          <figcaption>{partner.photoCaption}</figcaption>
        </figure>

        <a
          href={websiteUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="site-btn site-btn--primary site-main-partner-section__cta"
        >
          {partner.buttonLabel}
        </a>
      </div>
    </section>
  );
}

export function SitePartners() {
  const { categories: sponsorCategories } = useSponsorCategories();
  const { sponsors, loading } = useSponsors(true);
  const partnerSponsors = MAIN_PARTNERS.map((partner) => ({
    partner,
    sponsor: resolvePartnerSponsor(partner, sponsors),
  }));

  const sponsorsByCategory = sponsors.reduce((acc, sponsor) => {
    const category = sponsor.category || "supplier";
    if (!acc[category]) acc[category] = [];
    acc[category].push(sponsor);
    return acc;
  }, {});

  Object.values(sponsorsByCategory).forEach((entries) => entries.sort((left, right) => (left.order ?? 99) - (right.order ?? 99)));

const categoryOrder = [
    ...sponsorCategories.map((category) => category.key),
    ...Object.keys(sponsorsByCategory).filter((category) => !sponsorCategories.some((entry) => entry.key === category)),
  ];

  return (
    <div className="site-partners-page">
      <section className="site-partners-hero">
        <div className="site-container site-main-partners-hero">
          <div className="site-main-partners-hero__copy">
            <span className="site-eyebrow">Title partners</span>
            <h1 className="site-heading">Our title partners</h1>
            <p className="site-lead">
              The CMCM Luxembourg Indoor Meeting is proud to rely on major partners who contribute to the development of sport, the promotion of health, the profile of the capital and Luxembourg's international visibility. Their commitment allows the event to keep growing, welcome top-level athletes and offer spectators a truly distinctive sporting experience.
            </p>
            <HeroLogoStrip entries={partnerSponsors} />
            <div className="site-main-partners-hero__facts">
              <div className="site-main-partners-hero__fact">
                <strong>3</strong>
                <span>title partners in focus</span>
              </div>
              <div className="site-main-partners-hero__fact">
                <strong>1</strong>
                <span>international meeting as a shared showcase</span>
              </div>
              <div className="site-main-partners-hero__fact">
                <strong>2026</strong>
                <span>an edition carrying sport, health and Luxembourg's image</span>
              </div>
            </div>
          </div>

          <div className="site-main-partners-hero__visual">
            <div className="site-main-partners-hero__visual-main">
              <img src={cmcmAthleteMoment} alt="Atmospheric moment between athletes at the CMCM Luxembourg Indoor Meeting" />
            </div>
            <div className="site-main-partners-hero__visual-stack">
              <div className="site-main-partners-hero__visual-card">
                <img src={raceActionTrack} alt="Race action on the CMCM Luxembourg Indoor Meeting track" />
              </div>
              <div className="site-main-partners-hero__visual-note">
                <span className="site-eyebrow">International event</span>
                <p>A meeting where sporting performance, Luxembourg's image and major partners move forward together.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="site-section site-main-partners-section">
        <div className="site-container">
          <div className="site-main-partners-section__stack">
            {partnerSponsors.map(({ partner, sponsor }) => (
              <PartnerSection key={partner.key} partner={partner} sponsor={sponsor} />
            ))}
          </div>
        </div>
      </section>

      <section className="site-section site-section--alt site-main-partners-ecosystem">
        <div className="site-container">
          <div className="site-section-header site-section-header--center">
            <span className="site-eyebrow">Partner ecosystem</span>
            <h2 className="site-heading site-heading--sm">All our sponsors</h2>
            <p className="site-lead">
              Alongside our featured partners, many other organisations also support the CMCM Luxembourg Indoor Meeting and contribute to the overall quality of the event.
            </p>
          </div>

          {loading ? (
            <div className="site-main-partners-sponsor-loading">Loading sponsors...</div>
          ) : sponsors.length === 0 ? (
            <div className="site-main-partners-sponsor-loading">Sponsors will appear here soon.</div>
          ) : (
            <div className="site-main-partners-sponsor-groups">
              {categoryOrder.filter((category) => sponsorsByCategory[category]?.length).map((category) => (
                <section key={category} className="site-main-partners-sponsor-group">
                  <div className="site-main-partners-sponsor-group__header">
                    <p className="site-main-partners-sponsor-group__eyebrow">{sponsorCategoryLabel(category, sponsorCategories)}</p>
                  </div>
                  <div className="site-main-partners-sponsor-grid">
                    {sponsorsByCategory[category].map((sponsor) => (
                      <SponsorLogoCard key={sponsor.id} sponsor={sponsor} />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="site-section site-section--alt site-main-partners-cta-section">
        <div className="site-container">
          <div className="site-main-partners-cta-panel">
            <div className="site-main-partners-cta-panel__copy">
              <span className="site-eyebrow">Become a partner</span>
              <h2 className="site-heading site-heading--sm">Become a partner</h2>
              <p className="site-lead">
                Associating your brand with the CMCM Luxembourg Indoor Meeting means strong visibility, a premium setting and a fast-growing international sporting event.
              </p>
              <NavLink to="/become-a-partner" className="site-btn site-btn--primary">
                Explore sponsorship opportunities
              </NavLink>
            </div>

            <div className="site-partnership-cta-grid">
              {[
                ["International visibility", "Exposure to spectators, media and athletes coming from many different countries."],
                ["Premium positioning", "A presence associated with a recognised meeting on the international indoor circuit."],
                ["Tailor-made partnerships", "Activation formats adaptable to your goals, audiences and budget."],
              ].map(([title, description]) => (
                <div
                  key={title}
                  className="site-partnership-cta-card"
                >
                  <h3 style={{ fontSize: "0.95rem", fontWeight: 700, marginBottom: 8 }}>{title}</h3>
                  <p style={{ fontSize: "0.84rem", lineHeight: 1.65 }}>{description}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
