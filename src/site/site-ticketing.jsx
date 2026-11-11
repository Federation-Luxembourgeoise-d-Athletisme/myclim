import { NavLink } from "react-router-dom";
import ticketFan from "../assets/site-gallery/ticket-fan-1.jpg";
import ticketStubRegular from "../assets/site-gallery/ticket-stub-regular.jpg";
import ticketStubVip from "../assets/site-gallery/ticket-stub-vip.jpg";
import { getCountdownParts, showPlanVisitOnHome } from "./ticketing-utils";

const DEFAULT_PARKING = "Coque car park, or the underground car park Coque 2.";
const DEFAULT_TRANSPORT = "Public transport is free everywhere in Luxembourg. Bus lines 2, 18 and 30 stop at the Coque.";

export function BuyTicketsLink({ ticketing, className, children, infoLabel = "Ticket info" }) {
  if (!ticketing.canBuy) {
    return <NavLink to="/event#tickets" className={className}>{infoLabel}</NavLink>;
  }
  return (
    <a href={ticketing.ticketUrl} target="_blank" rel="noopener noreferrer" className={className}>
      {children}
    </a>
  );
}

function getTicketBarCopy(ticketing) {
  const { phase, editionDay, doorsTime, pricing } = ticketing;
  const where = editionDay ? `${editionDay} at the Coque` : "At the Coque";
  const { regular } = pricing;
  switch (phase) {
    case "presale":
      return {
        strong: `Tickets on sale from ${pricing.saleOpensLabel}`,
        detail: `Early-bird €${regular.earlyBird} until ${pricing.earlyBirdEndsLabel} · ${where}`,
        short: `On sale from ${pricing.saleOpensLabel}`,
      };
    case "earlyBird":
      return {
        strong: `Early-bird tickets: €${regular.earlyBird} instead of €${regular.onSite} at the door`,
        detail: `Until ${pricing.earlyBirdEndsLabel} · ${where}`,
        short: `Early-bird €${regular.earlyBird} instead of €${regular.onSite}`,
      };
    case "eventDay":
      return {
        strong: `Today at the Coque · doors open at ${doorsTime}`,
        detail: `Tickets €${regular.online} online, €${regular.onSite} at the door`,
        short: `Today · doors open ${doorsTime}`,
      };
    default:
      return {
        strong: `Tickets €${regular.online} online instead of €${regular.onSite} at the door`,
        detail: where,
        short: `€${regular.online} online instead of €${regular.onSite}`,
      };
  }
}

// Red bar above the menu, on every page of the public site.
export function TicketBar({ ticketing }) {
  if (ticketing.phase === "past") return null;
  const copy = getTicketBarCopy(ticketing);
  return (
    <div className="site-ticket-bar">
      <div className="site-ticket-bar__inner">
        <strong className="site-ticket-bar__strong">{copy.strong}</strong>
        <span className="site-ticket-bar__short">{copy.short}</span>
        <span className="site-ticket-bar__detail">{copy.detail}</span>
        <BuyTicketsLink ticketing={ticketing} className="site-ticket-bar__button">
          Buy tickets →
        </BuyTicketsLink>
      </div>
    </div>
  );
}

// Phone only: the ticket button stays at the bottom of the screen.
export function MobileTicketButton({ ticketing }) {
  if (ticketing.phase === "past") return null;
  const { regular } = ticketing.pricing;
  const fromPrice = ticketing.phase === "earlyBird" || ticketing.phase === "presale" ? regular.earlyBird : regular.online;
  return (
    <div className="site-mobile-ticket">
      <BuyTicketsLink ticketing={ticketing} className="site-mobile-ticket__button" infoLabel={`Tickets from €${fromPrice}`}>
        Buy tickets · from €{fromPrice}
      </BuyTicketsLink>
    </div>
  );
}

export function HeroCountdown({ ticketing }) {
  const parts = getCountdownParts(ticketing.doorsOpen, ticketing.now);
  if (!parts) return null;
  const units = [
    [parts.days, parts.days === 1 ? "day" : "days"],
    [String(parts.hours).padStart(2, "0"), "hours"],
    [String(parts.minutes).padStart(2, "0"), "min"],
  ];
  return (
    <div className="site-countdown" role="timer" aria-label={`Starts in ${parts.days} days, ${parts.hours} hours and ${parts.minutes} minutes`}>
      <span className="site-countdown__label">Starts in</span>
      <div className="site-countdown__units" aria-hidden="true">
        {units.map(([value, label]) => (
          <div key={label} className="site-countdown__unit">
            <span className="site-countdown__value">{value}</span>
            <span className="site-countdown__unit-label">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function formatPrice(value) {
  return value === 0 ? "Free" : `€${value}`;
}

const TICKET_STUBS = [
  {
    key: "under18",
    name: "Under 18",
    photo: ticketFan,
    focus: "center 30%",
    stubLabel: "Under 18s",
    cta: "Get a free ticket →",
  },
  {
    key: "regular",
    name: "Regular",
    photo: ticketStubRegular,
    focus: "center 40%",
    stubLabel: "Early-bird",
    cta: "Buy tickets →",
  },
  {
    key: "vip",
    name: "VIP",
    photo: ticketStubVip,
    focus: "center 50%",
    stubLabel: "Early-bird",
    cta: "Buy VIP →",
  },
];

// Homepage ticket section: three tickets with a tear-off stub.
export function TicketStubsSection({ ticketing }) {
  const pricing = ticketing.pricing;
  const earlyBirdOver = ticketing.phase === "regular" || ticketing.phase === "eventDay";
  const regularSaving = pricing.regular.onSite - pricing.regular.earlyBird;
  const regularPriceFrom = new Date(new Date(pricing.earlyBirdEndsAt).getTime() + 1000)
    .toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Europe/Luxembourg" });
  const doorsLine = [
    ticketing.editionDay,
    "Coque",
    `Doors ${ticketing.doorsTime}`,
  ].filter(Boolean).join(" · ");

  return (
    <section className="site-section site-ticket-stubs" id="tickets">
      <div className="site-container">
        <div className="site-ticket-stubs__header">
          <div>
            <span className="site-eyebrow">Tickets</span>
            <h2 className="site-heading">Cheaper online than at the door</h2>
          </div>
          <p>
            {earlyBirdOver
              ? "Under 18s get in free."
              : `Early-bird until ${pricing.earlyBirdEndsLabel} · Under 18s get in free.`}
          </p>
        </div>

        <div className="site-ticket-stubs__list">
          {TICKET_STUBS.map((ticket) => {
            const prices = pricing[ticket.key];
            const stubPrice = earlyBirdOver ? prices.online : prices.earlyBird;
            return (
              <article key={ticket.key} className={`site-ticket-stub site-ticket-stub--${ticket.key}`}>
                <div className="site-ticket-stub__body">
                  <img
                    src={ticket.photo}
                    alt=""
                    loading="lazy"
                    className="site-ticket-stub__photo"
                    style={{ objectPosition: ticket.focus }}
                  />
                  <div className="site-ticket-stub__info">
                    <span className="site-ticket-stub__meta">
                      <span className="site-ticket-stub__meta-name">CMCM Luxembourg Indoor Meeting · </span>
                      {doorsLine}
                    </span>
                    <div className="site-ticket-stub__title">
                      <h3>{ticket.name}</h3>
                      {ticket.key === "regular" && !earlyBirdOver ? (
                        <span className="site-ticket-stub__badge">Save €{regularSaving}</span>
                      ) : null}
                    </div>
                    {ticket.key === "under18" ? (
                      <div className="site-ticket-stub__prices">
                        <span>Free entrance for all spectators under 18 years old</span>
                      </div>
                    ) : (
                    <div className="site-ticket-stub__prices">
                      {earlyBirdOver ? null : (
                        <span>Online from {regularPriceFrom} <strong>{formatPrice(prices.online)}</strong></span>
                      )}
                      <span className="site-ticket-stub__door">
                        At the door <strong>{formatPrice(prices.onSite)}</strong>
                      </span>
                    </div>
                    )}
                  </div>
                </div>
                <div className="site-ticket-stub__perforation" aria-hidden="true" />
                <div className="site-ticket-stub__stub">
                  <span className="site-ticket-stub__stub-label">{earlyBirdOver ? "Online" : ticket.stubLabel}</span>
                  <span className="site-ticket-stub__price">{formatPrice(stubPrice)}</span>
                  <BuyTicketsLink ticketing={ticketing} className="site-ticket-stub__button">
                    {ticket.cta}
                  </BuyTicketsLink>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function VisitIcon({ type }) {
  const paths = {
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    bus: <><rect x="4" y="3" width="16" height="14" rx="3" /><path d="M4 11h16M8 21l1-4M16 21l-1-4" /></>,
    parking: <><rect x="3" y="3" width="18" height="18" rx="4" /><path d="M9 17V7h4a3 3 0 0 1 0 6H9" /></>,
  };
  return (
    <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[type]}
    </svg>
  );
}

// Always on the Event page; on the homepage only in the last 10 days.
export function PlanYourVisit({ ticketing, onlyNearEvent = false }) {
  if (onlyNearEvent && !showPlanVisitOnHome(ticketing.editionDate, ticketing.now)) return null;
  const { access } = ticketing;
  const parking = access.parking.en || DEFAULT_PARKING;
  const cards = [
    {
      icon: "clock",
      title: `Doors open at ${ticketing.doorsTime}`,
      text: ticketing.editionDay ? `${ticketing.editionDay}, Coque, Luxembourg-Kirchberg.` : "Coque, Luxembourg-Kirchberg.",
    },
    { icon: "bus", title: "Free public transport", text: DEFAULT_TRANSPORT },
    { icon: "parking", title: "Parking", text: parking },
  ];
  return (
    <section className="site-section site-section--alt" id="visit">
      <div className="site-container">
        <div className="site-section-header">
          <span className="site-eyebrow">Plan your visit</span>
          <h2 className="site-heading">Getting to the Coque</h2>
        </div>
        <div className="site-visit-grid">
          {cards.map((card) => (
            <div key={card.icon} className="site-visit-card">
              <VisitIcon type={card.icon} />
              <h3>{card.title}</h3>
              <p>{card.text}</p>
            </div>
          ))}
        </div>
        {access.mapsUrl ? (
          <a href={access.mapsUrl} target="_blank" rel="noopener noreferrer" className="site-btn site-btn--secondary site-btn--sm">
            Open in Google Maps →
          </a>
        ) : null}
      </div>
    </section>
  );
}
