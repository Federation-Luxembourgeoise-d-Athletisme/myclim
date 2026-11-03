import { useState } from "react";
import { NavLink } from "react-router-dom";
import { isPreprogramOpenForEdition, useActiveEdition, useSiteEditionYear } from "../app/edition";
import { useLanguage } from "../app/language-context";
import { useMeetingEditions } from "../app/meeting-history-hooks";
import business1 from "../assets/site-gallery/preprog-business-1.jpg";
import business2 from "../assets/site-gallery/preprog-business-2.jpg";
import influencer from "../assets/site-gallery/preprog-influencer.jpg";
import specialOlympics1 from "../assets/site-gallery/preprog-specialolympics-1.jpg";
import kids1 from "../assets/site-gallery/preprog-kids-1.jpg";
import national60m from "../assets/site-gallery/preprog-national-60m.jpg";
import { getSitePreprogrammeCopy } from "./site-preprogramme-copy";

const INSTAGRAM_URL = "https://www.instagram.com/cmcm_lux_indoor_meet/";
const BUSINESS_EMAIL = "communication@fla.lu";
const YOUTH_REGISTRATION_PATH = "/pre-programme?parcours=jeunes";
const NATIONAL_REGISTRATION_PATH = "/pre-programme?parcours=courses-nationales";

function fill(text, values) {
  return Object.entries(values).reduce((result, [key, value]) => result.split(`{${key}}`).join(value ?? ""), String(text || ""));
}

function toDate(value) {
  const date = value?.toDate?.() || (value ? new Date(value) : null);
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

// Catégories du meeting : âge atteint au 31 décembre de l'année de l'édition
// (U12 = 10-11 ans, U14 = 12-13 ans).
function getYouthBirthYears(editionYear) {
  const year = Number(editionYear);
  if (!year) return { u12: "", u14: "" };
  return { u12: `${year - 11}/${year - 10}`, u14: `${year - 13}/${year - 12}` };
}

function useCurrentEdition() {
  const { siteEditionYear } = useSiteEditionYear();
  const { editions } = useMeetingEditions();
  const edition =
    (siteEditionYear && editions.find((entry) => Number(entry.year || entry.id) === Number(siteEditionYear))) ||
    editions[0] ||
    null;
  return { edition, year: edition?.year || siteEditionYear };
}

function StatusPill({ tone = "neutral", children }) {
  return <span className={`pp-pill pp-pill--${tone}`}>{children}</span>;
}

function ProfileCard({ title, body, status, extra, cta }) {
  return (
    <article className="pp-profile">
      <h3>{title}</h3>
      <p>{body}</p>
      <div className="pp-profile__status">
        {status}
        {extra}
      </div>
      {cta}
    </article>
  );
}

function EventCard({ id, image, title, body, facts, cta }) {
  return (
    <article className="pp-event" id={id}>
      <div className="pp-event__media">
        <img alt="" src={image} />
      </div>
      <div className="pp-event__body">
        <h3>{title}</h3>
        <p>{body}</p>
        <ul>
          {facts.map((fact) => (
            <li key={fact}>{fact}</li>
          ))}
        </ul>
        {cta}
      </div>
    </article>
  );
}

function BusinessRequestForm({ copy, year }) {
  const packs = [copy.pack2Title, copy.pack1Title];
  const [company, setCompany] = useState("");
  const [contact, setContact] = useState("");
  const [pack, setPack] = useState(packs[0]);
  const [error, setError] = useState("");

  function handleSubmit(event) {
    event.preventDefault();
    if (!company.trim() || !contact.trim()) {
      setError(copy.formError);
      return;
    }
    const values = { year, company: company.trim(), contact: contact.trim(), pack };
    const subject = encodeURIComponent(fill(copy.mailSubject, values));
    const body = encodeURIComponent(fill(copy.mailBody, values));
    window.location.href = `mailto:${BUSINESS_EMAIL}?subject=${subject}&body=${body}`;
  }

  return (
    <form className="pp-business-form" noValidate onSubmit={handleSubmit}>
      <strong>{copy.formTitle}</strong>
      <div className="pp-business-form__fields">
        <label>
          <span>{copy.formCompany}</span>
          <input value={company} onChange={(event) => { setCompany(event.target.value); setError(""); }} />
        </label>
        <label>
          <span>{copy.formContact}</span>
          <input value={contact} onChange={(event) => { setContact(event.target.value); setError(""); }} />
        </label>
        <label>
          <span>{copy.formPack}</span>
          <select value={pack} onChange={(event) => setPack(event.target.value)}>
            {packs.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </label>
        <button className="site-btn site-btn--primary site-btn--sm" type="submit">{copy.formSubmit} →</button>
      </div>
      {error ? <p className="pp-business-form__error">{error}</p> : <p className="pp-muted">{copy.formHint}</p>}
    </form>
  );
}

export function SitePreProgramme() {
  const { language } = useLanguage();
  const copy = getSitePreprogrammeCopy(language);
  const locale = language === "fr" ? "fr-LU" : "en-GB";
  const { edition, year } = useCurrentEdition();
  const { activeEditionId, preprogramOpeningByEdition, preprogramOpeningDate } = useActiveEdition();
  const [now] = useState(() => Date.now());
  const isRegistrationOpen = isPreprogramOpenForEdition(
    activeEditionId,
    now,
    typeof window !== "undefined" ? window.location.hostname : "",
    preprogramOpeningByEdition,
  );
  const birthYears = getYouthBirthYears(year);
  const eventDate = toDate(edition?.date);
  const venue = edition?.venue || "Coque, Luxembourg";
  const schedule = (Array.isArray(edition?.preprogrammeSchedule) ? edition.preprogrammeSchedule : [])
    .filter((line) => line?.visible !== false && (line.labelEn || line.labelFr))
    .map((line) => ({ time: line.time, label: (language === "fr" ? line.labelFr : line.labelEn) || line.labelEn || line.labelFr }));
  const firstTime = schedule.find((line) => line.time)?.time;
  const openingLabel = preprogramOpeningDate
    ? preprogramOpeningDate.toLocaleString(locale, { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })
    : "";
  const registrationStatus = isRegistrationOpen ? (
    <StatusPill tone="ok">{copy.statusOpen}</StatusPill>
  ) : (
    <StatusPill tone="warn">{fill(copy.statusOpensOn, { date: openingLabel })}</StatusPill>
  );

  return (
    <>
      {/* ── En-tête ─────────────────────────────────────── */}
      <section className="pp-hero">
        <div className="site-container">
          <span className="site-eyebrow" style={{ color: "var(--site-red)" }}>{copy.heroEyebrow}</span>
          <h1 className="site-heading" style={{ color: "#fff" }}>{copy.heroTitle}</h1>
          <div className="pp-hero__facts">
            <span>{eventDate ? eventDate.toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long", year: "numeric" }) : copy.dateTbc}</span>
            {firstTime ? <span>{fill(copy.heroFrom, { time: firstTime })}</span> : null}
            <span>{venue}</span>
          </div>
          <p className="site-lead" style={{ color: "rgba(255,255,255,0.75)", maxWidth: 640 }}>{copy.heroLead}</p>
          <div className="pp-actions">
            <a href="#participer" className="site-btn site-btn--primary">{copy.heroRegister} →</a>
            {schedule.length ? <a href="#deroule" className="site-btn site-btn--secondary">{copy.heroSchedule}</a> : null}
          </div>
        </div>
      </section>

      {/* ── Je veux participer ──────────────────────────── */}
      <section className="site-section" id="participer">
        <div className="site-container">
          <h2 className="site-heading site-heading--sm">{copy.profilesTitle}</h2>
          <div className="pp-profiles">
            <ProfileCard
              title={copy.youthTitle}
              body={fill(copy.youthBody, birthYears)}
              status={registrationStatus}
              extra={<StatusPill tone="ok">+ {copy.freeEntryYouth}</StatusPill>}
              cta={<NavLink to={YOUTH_REGISTRATION_PATH} className="site-btn site-btn--primary site-btn--sm">{copy.youthCta}</NavLink>}
            />
            <ProfileCard
              title={copy.athleteTitle}
              body={copy.athleteBody}
              status={registrationStatus}
              extra={<StatusPill tone="ok">+ {copy.freeEntryAthlete}</StatusPill>}
              cta={<NavLink to={NATIONAL_REGISTRATION_PATH} className="site-btn site-btn--primary site-btn--sm">{copy.athleteCta}</NavLink>}
            />
            <ProfileCard
              title={copy.companyTitle}
              body={copy.companyBody}
              status={<StatusPill>{copy.companyStatus}</StatusPill>}
              cta={<a href="#business-race" className="site-btn site-btn--secondary site-btn--sm">{copy.companyCta}</a>}
            />
            <ProfileCard
              title={copy.spectatorTitle}
              body={copy.spectatorBody}
              status={<StatusPill tone="ok">{copy.spectatorStatus}</StatusPill>}
              cta={<NavLink to="/event#tickets" className="site-btn site-btn--secondary site-btn--sm">{copy.spectatorCta}</NavLink>}
            />
          </div>
        </div>
      </section>

      {/* ── Déroulé (lignes visibles, réglées dans l'admin) ── */}
      {schedule.length ? (
        <section className="site-section site-section--alt" id="deroule">
          <div className="site-container">
            <h2 className="site-heading site-heading--sm">{copy.scheduleTitle}</h2>
            <ol className="pp-schedule">
              {schedule.map((line, index) => (
                <li key={`${line.time}-${index}`}>
                  <span className="pp-schedule__time">{line.time || "·"}</span>
                  <span>{line.label}</span>
                </li>
              ))}
            </ol>
            <p className="pp-muted">{copy.scheduleNote}</p>
          </div>
        </section>
      ) : null}

      {/* ── Les courses ─────────────────────────────────── */}
      <section className="site-section">
        <div className="site-container">
          <h2 className="site-heading site-heading--sm">{copy.eventsTitle}</h2>
          <div className="pp-events">
            <EventCard
              id="youth"
              image={kids1}
              title={copy.youthEventTitle}
              body={copy.youthEventBody}
              facts={[fill(copy.youthEventAges, birthYears), ...copy.youthEventFacts]}
              cta={<NavLink to={YOUTH_REGISTRATION_PATH} className="pp-link">{copy.youthCta} →</NavLink>}
            />
            <EventCard
              id="national-races"
              image={national60m}
              title={copy.nationalEventTitle}
              body={copy.nationalEventBody}
              facts={copy.nationalEventFacts}
              cta={<NavLink to={NATIONAL_REGISTRATION_PATH} className="pp-link">{copy.athleteCta} →</NavLink>}
            />
            <EventCard
              id="special-olympics"
              image={specialOlympics1}
              title={copy.specialOlympicsTitle}
              body={copy.specialOlympicsBody}
              facts={copy.specialOlympicsFacts}
            />
            <EventCard
              id="influencer-race"
              image={influencer}
              title={copy.influencerTitle}
              body={copy.influencerBody}
              facts={copy.influencerFacts}
              cta={<a href={INSTAGRAM_URL} target="_blank" rel="noreferrer" className="pp-link">{copy.influencerCta} →</a>}
            />
          </div>
        </div>
      </section>

      {/* ── Business Race ───────────────────────────────── */}
      <section className="site-section site-section--alt" id="business-race">
        <div className="site-container">
          <span className="site-eyebrow">{copy.businessEyebrow}</span>
          <h2 className="site-heading site-heading--sm">{copy.businessTitle}</h2>
          <p className="site-lead">{copy.businessLead}</p>
          <div className="pp-business">
            <div className="pp-business__media">
              <img alt="" src={business1} />
              <img alt="" src={business2} />
            </div>
            <div>
              <p className="pp-business__format">{copy.businessFormat}</p>
              <p className="pp-muted">{copy.businessWinner}</p>
              <div className="pp-packs">
                <article className="pp-pack">
                  <h3>{copy.pack1Title}</h3>
                  <strong className="pp-pack__price">{copy.pack1Price}</strong>
                  <ul>{copy.pack1Items.map((item) => <li key={item}>{item}</li>)}</ul>
                </article>
                <article className="pp-pack pp-pack--featured">
                  <h3>{copy.pack2Title}</h3>
                  <strong className="pp-pack__price">{copy.pack2Price}</strong>
                  <span className="pp-muted">{copy.pack2Note}</span>
                  <ul>{copy.pack2Items.map((item) => <li key={item}>{item}</li>)}</ul>
                </article>
              </div>
            </div>
          </div>
          <BusinessRequestForm copy={copy} year={year} />
        </div>
      </section>

      {/* ── FAQ ─────────────────────────────────────────── */}
      <section className="site-section">
        <div className="site-container">
          <h2 className="site-heading site-heading--sm">{copy.faqTitle}</h2>
          <div className="pp-faq">
            {copy.faq.map((item) => (
              <details key={item.q}>
                <summary>{item.q}</summary>
                <p>{fill(item.a, birthYears)}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ── Appels à l'action finaux ────────────────────── */}
      <section className="site-section site-section--alt">
        <div className="site-container" style={{ textAlign: "center" }}>
          <h2 className="site-heading site-heading--sm">{copy.finalTitle}</h2>
          <div className="pp-actions pp-actions--center">
            <NavLink to={YOUTH_REGISTRATION_PATH} className="site-btn site-btn--primary">{copy.finalYouth}</NavLink>
            <NavLink to={NATIONAL_REGISTRATION_PATH} className="site-btn site-btn--primary">{copy.finalNational}</NavLink>
            <a href="#business-race" className="site-btn site-btn--secondary">{copy.finalBusiness}</a>
          </div>
        </div>
      </section>
    </>
  );
}
