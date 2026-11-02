import { useEffect, useRef, useState } from "react";
import { NavLink, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../context/auth-context";
import preprogrammeHomeImage from "../assets/preprogramme-home.jpg";
import portePanierHomeImage from "../assets/porte-panier-home.jpg";
import { AuthFormField, AuthLayout, PhoneInput } from "./form-components";
import { isPreprogramOpenForEdition, useActiveEdition } from "./edition";
import { useLanguage } from "./language-context";
import { getAgeFromBirthDate, getU14CategoryFromBirthDate, readRememberMePreference } from "./utils";
import {
  getPreProgramSubmissionErrorMessage,
  getU14AllowedEvents,
  getValidRequestedEventForCategory,
  luxCompetitionClubs,
} from "./u14-helpers";
import {
  NATIONAL_RACE_ADULT_AGE,
  NATIONAL_RACE_DEFINITIONS,
  NATIONAL_RACE_EVENTS,
  NATIONAL_RACE_MIN_AGE,
  createEmptyNationalRaceForm,
  parsePerformanceToSeconds,
} from "./national-races-helpers";

const PATH_YOUTH = "jeunes";
const PATH_NATIONAL = "courses-nationales";
const MIN_PASSWORD_LENGTH = 6;

function createEmptyChild() {
  return {
    firstName: "",
    lastName: "",
    birthDate: "",
    category: "",
    club: "",
    bibNumber: "",
    gender: "",
    requestType: "preprogram",
    requestedEvent: "60 m",
    notes: "",
    imageConsent: false,
  };
}

function RuleList({ items }) {
  return (
    <ul className="compact-list">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

// Connexion / compte déjà ouvert : en première année, la plupart des familles
// et des athlètes n'ont pas encore de compte, mais un bénévole ou un parent
// qui s'inscrit doit pouvoir réutiliser le sien au lieu de tomber sur
// « adresse déjà utilisée » en bas du formulaire.
function AccountBar({ loginEmailHint }) {
  const { currentUser, login, userProfile } = useAuth();
  const { t } = useLanguage();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (!loginEmailHint) return;
    setEmail(loginEmailHint);
    setIsOpen(true);
  }, [loginEmailHint]);

  if (currentUser) {
    const name = [userProfile?.firstName, userProfile?.lastName].filter(Boolean).join(" ") || currentUser.email;
    return (
      <div className="notice-card notice-card--ok">
        <strong>{t("ppLoggedInAs").replace("{name}", name)}</strong>
        <p>{t("ppLoggedInBody")}</p>
        <div className="auth-links">
          <NavLink to="/app">{t("ppOpenMySpace")}</NavLink>
        </div>
      </div>
    );
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);
    try {
      await login(email, password, readRememberMePreference());
    } catch {
      setError(t("loginError"));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="notice-card">
      <strong>{t("ppHaveAccountTitle")}</strong>
      <p>{t("ppHaveAccountBody")}</p>
      {isOpen ? (
        <form className="login-inline" onSubmit={handleSubmit}>
          <AuthFormField label={t("fieldEmail")}>
            <input autoComplete="email" required type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
          </AuthFormField>
          <AuthFormField label={t("fieldPassword")}>
            <input autoComplete="current-password" required type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
          </AuthFormField>
          <button className="button button--secondary" disabled={isSubmitting} type="submit">
            {isSubmitting ? t("loginLoading") : t("loginButton")}
          </button>
          {error ? <p className="form-error" style={{ margin: 0 }}>{error}</p> : null}
        </form>
      ) : (
        <div className="auth-links">
          <button className="button button--secondary" type="button" onClick={() => setIsOpen(true)}>
            {t("ppLoginButton")}
          </button>
        </div>
      )}
    </div>
  );
}

function PathChoice({ value, onChange }) {
  const { t } = useLanguage();
  const options = [
    { id: PATH_YOUTH, title: t("ppPathYouthTitle"), body: t("ppPathYouthBody") },
    { id: PATH_NATIONAL, title: t("ppPathNationalTitle"), body: t("ppPathNationalBody") },
  ];

  return (
    <section className="form-section-card">
      <div className="form-section-head">
        <p className="eyebrow">{t("ppPathEyebrow")}</p>
        <h3>{t("ppPathHeading")}</h3>
      </div>
      <div className="choice-grid preprogramme-path-grid">
        {options.map((option) => (
          <label key={option.id} className={`selection-card preprogramme-path-card${value === option.id ? " preprogramme-path-card--active" : ""}`}>
            <input checked={value === option.id} name="preprogrammePath" type="radio" value={option.id} onChange={() => onChange(option.id)} />
            <div>
              <strong>{option.title}</strong>
              <p>{option.body}</p>
            </div>
          </label>
        ))}
      </div>
    </section>
  );
}

function PasswordFields({ formData, onChange }) {
  const { t } = useLanguage();
  return (
    <div className="field-grid">
      <AuthFormField label={t("fieldPassword")} hint={t("ppPasswordHint").replace("{min}", MIN_PASSWORD_LENGTH)} required>
        <input autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH} name="password" required type="password" value={formData.password} onChange={onChange} />
      </AuthFormField>
      <AuthFormField label={t("fieldConfirmPassword")} required>
        <input autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH} name="confirmPassword" required type="password" value={formData.confirmPassword} onChange={onChange} />
      </AuthFormField>
    </div>
  );
}

function useScrollToError(error) {
  const errorRef = useRef(null);
  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [error]);
  return errorRef;
}

function YouthRegistrationForm({ onEmailInUse }) {
  const { createU14PreProgramRegistration, currentUser, userProfile } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const isLoggedIn = Boolean(currentUser);
  const [formData, setFormData] = useState({ parentFirstName: "", parentLastName: "", parentEmail: "", parentPhone: "", password: "", confirmPassword: "" });
  const [children, setChildren] = useState([createEmptyChild()]);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const errorRef = useScrollToError(error);

  useEffect(() => {
    if (!currentUser) return;
    setFormData((current) => ({
      ...current,
      parentFirstName: current.parentFirstName || userProfile?.firstName || "",
      parentLastName: current.parentLastName || userProfile?.lastName || "",
      parentEmail: currentUser.email || "",
      parentPhone: current.parentPhone || userProfile?.phone || "",
    }));
  }, [currentUser, userProfile]);

  function handleParentChange(event) {
    const { name, value } = event.target;
    setFormData((current) => ({ ...current, [name]: value }));
  }

  function handleChildChange(index, event) {
    const { name, type, checked, value } = event.target;
    setChildren((current) =>
      current.map((child, childIndex) => {
        if (childIndex !== index) return child;
        const nextChild = { ...child, [name]: type === "checkbox" ? checked : value };
        if (name === "birthDate") nextChild.category = getU14CategoryFromBirthDate(value);
        nextChild.requestedEvent = getValidRequestedEventForCategory(nextChild.category, nextChild.requestedEvent);
        return nextChild;
      }),
    );
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    if (!isLoggedIn && formData.password !== formData.confirmPassword) {
      setError(t("errorPasswordMismatch"));
      return;
    }
    if (children.some((child) => !child.category)) {
      setError(t("u14ErrorBirthYears"));
      return;
    }
    if (children.some((child) => child.requestType !== "porte_panier" && !getU14AllowedEvents(child.category).includes(child.requestedEvent))) {
      setError(t("u14ErrorU12Event"));
      return;
    }
    setIsSubmitting(true);
    try {
      await createU14PreProgramRegistration({ ...formData, children });
      navigate("/app/mes-enfants");
    } catch (submissionError) {
      if (submissionError?.code === "auth/email-already-in-use") onEmailInUse(formData.parentEmail);
      setError(getPreProgramSubmissionErrorMessage(submissionError, t));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="auth-form auth-form--long u14-form" onSubmit={handleSubmit}>
      <div className="notice-card">
        <strong>{t("ppYouthRulesTitle")}</strong>
        <RuleList items={[t("ppYouthRule1"), t("ppYouthRule2"), t("ppYouthRule3"), t("ppYouthRule4")]} />
      </div>

      <section className="form-section-card">
        <div className="form-section-head">
          <h3>{t("u14ParentInfoHeading")}</h3>
        </div>
        <div className="field-grid">
          <AuthFormField label={t("u14ParentFirstName")} required>
            <input name="parentFirstName" required value={formData.parentFirstName} onChange={handleParentChange} />
          </AuthFormField>
          <AuthFormField label={t("u14ParentLastName")} required>
            <input name="parentLastName" required value={formData.parentLastName} onChange={handleParentChange} />
          </AuthFormField>
        </div>
        <div className="field-grid">
          <AuthFormField label={t("u14ParentEmail")} required>
            <input autoComplete="email" name="parentEmail" readOnly={isLoggedIn} required type="email" value={formData.parentEmail} onChange={handleParentChange} />
          </AuthFormField>
          <AuthFormField label={t("u14ParentPhone")} required>
            <PhoneInput name="parentPhone" required value={formData.parentPhone} onChange={handleParentChange} />
          </AuthFormField>
        </div>
        {isLoggedIn ? null : <PasswordFields formData={formData} onChange={handleParentChange} />}
      </section>

      {children.map((child, childIndex) => {
        const allowedEvents = getU14AllowedEvents(child.category);
        return (
          <section key={childIndex} className="form-section-card">
            <div className="form-section-head preprogramme-child-head">
              <h3>{t("ppChildHeading").replace("{number}", childIndex + 1)}</h3>
              {children.length > 1 ? (
                <button
                  className="button button--ghost-danger button--small"
                  type="button"
                  onClick={() => setChildren((current) => current.filter((_, index) => index !== childIndex))}
                >
                  {t("ppRemoveChild")}
                </button>
              ) : null}
            </div>
            <div className="field-grid">
              <AuthFormField label={t("u14ChildFirstName")} required>
                <input name="firstName" required value={child.firstName} onChange={(event) => handleChildChange(childIndex, event)} />
              </AuthFormField>
              <AuthFormField label={t("u14ChildLastName")} required>
                <input name="lastName" required value={child.lastName} onChange={(event) => handleChildChange(childIndex, event)} />
              </AuthFormField>
            </div>
            <div className="field-grid">
              <AuthFormField label={t("fieldBirthDate")} hint={t("u14BirthDateHint")} required>
                <input name="birthDate" required type="date" value={child.birthDate} onChange={(event) => handleChildChange(childIndex, event)} />
              </AuthFormField>
              <AuthFormField label={t("fieldGender")} required>
                <select name="gender" required value={child.gender} onChange={(event) => handleChildChange(childIndex, event)}>
                  <option value="">{t("fieldSelectPlaceholder")}</option>
                  <option value="fille">{t("u14GenderGirl")}</option>
                  <option value="garcon">{t("u14GenderBoy")}</option>
                </select>
              </AuthFormField>
            </div>
            {child.birthDate ? (
              child.category ? (
                <p className="panel-note">
                  <span className="status-pill status-pill--accent">{child.category}</span> {t("ppCategoryAssigned")}
                </p>
              ) : (
                <div className="notice-card notice-card--danger">
                  <strong>{t("u14NotEligibleTitle")}</strong>
                  <p>{t("u14NotEligibleBody")}</p>
                </div>
              )
            ) : null}
            <div className="field-grid">
              <AuthFormField label={t("u14ClubLabel")} required>
                <select name="club" required value={child.club} onChange={(event) => handleChildChange(childIndex, event)}>
                  <option value="">{t("u14SelectClub")}</option>
                  {luxCompetitionClubs.map((club) => (
                    <option key={club} value={club}>{club}</option>
                  ))}
                </select>
              </AuthFormField>
              <AuthFormField label={t("ppBibLabel")} hint={t("ppBibHint")} required>
                <input name="bibNumber" required placeholder={t("u14LicencePlaceholder")} value={child.bibNumber} onChange={(event) => handleChildChange(childIndex, event)} />
              </AuthFormField>
            </div>
            <div className="form-section-head">
              <strong>{t("u14RequestTypeLabel")}</strong>
            </div>
            <div className="choice-grid">
              {[
                { value: "preprogram", label: t("u14TypePreprogram"), body: t("ppTypePreprogramBody") },
                { value: "porte_panier", label: t("u14TypeBasket"), body: t("ppTypeBasketBody") },
                { value: "preprogram_ou_porte_panier", label: t("u14TypeEither"), body: t("ppTypeEitherBody") },
              ].map((option) => (
                <label key={option.value} className="selection-card selection-card--compact">
                  <input
                    checked={child.requestType === option.value}
                    name="requestType"
                    type="radio"
                    value={option.value}
                    onChange={(event) => handleChildChange(childIndex, event)}
                  />
                  <div>
                    <strong>{option.label}</strong>
                    <p>{option.body}</p>
                  </div>
                </label>
              ))}
            </div>
            {child.requestType !== "porte_panier" && child.category ? (
              allowedEvents.length > 1 ? (
                <AuthFormField label={t("u14EventLabel")} hint={t("u14EventHint")} required>
                  <select name="requestedEvent" value={child.requestedEvent} onChange={(event) => handleChildChange(childIndex, event)}>
                    {allowedEvents.map((eventOption) => (
                      <option key={eventOption} value={eventOption}>{eventOption}</option>
                    ))}
                  </select>
                </AuthFormField>
              ) : (
                <p className="panel-note">{t("ppSingleEventNote").replace("{event}", allowedEvents[0]).replace("{category}", child.category)}</p>
              )
            ) : null}
            <AuthFormField label={t("u14NotesLabel")}>
              <textarea name="notes" rows="2" placeholder={t("u14NotesPlaceholder")} value={child.notes} onChange={(event) => handleChildChange(childIndex, event)} />
            </AuthFormField>
            <label className="selection-card">
              <input checked={child.imageConsent} name="imageConsent" required type="checkbox" onChange={(event) => handleChildChange(childIndex, event)} />
              <div>
                <strong>{t("u14ImageConsentTitle")} <span className="field-required" aria-hidden="true">*</span></strong>
                <p>{t("u14ImageConsentBody")}</p>
              </div>
            </label>
          </section>
        );
      })}

      <button className="button button--secondary" type="button" onClick={() => setChildren((current) => [...current, createEmptyChild()])}>
        {t("ppAddChild")}
      </button>

      {error ? <p ref={errorRef} className="form-error">{error}</p> : null}
      <p className="panel-note">{t("rgpdDisclaimer")}</p>
      <div className="u14-submit-bar">
        <div>
          <strong>{isLoggedIn ? t("ppSubmitLoggedInTitle") : t("u14SubmitBarTitle")}</strong>
          <p>{t("u14SubmitBarBody")}</p>
        </div>
        <button className="button button--primary" disabled={isSubmitting} type="submit">
          {isSubmitting ? t("u14Submitting") : t("u14SubmitButton")}
        </button>
      </div>
    </form>
  );
}

function NationalRaceRegistrationForm({ onEmailInUse, onSwitchToYouth }) {
  const { createNationalRaceRegistration, currentUser, userProfile } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const isLoggedIn = Boolean(currentUser);
  const [formData, setFormData] = useState(createEmptyNationalRaceForm);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const errorRef = useScrollToError(error);
  const age = getAgeFromBirthDate(formData.birthDate);
  const isTooYoung = age !== null && age < NATIONAL_RACE_MIN_AGE;
  const isMinor = age !== null && age >= NATIONAL_RACE_MIN_AGE && age < NATIONAL_RACE_ADULT_AGE;
  const isLuxLicensed = formData.isLuxLicensed === "oui";

  useEffect(() => {
    if (!currentUser) return;
    setFormData((current) => ({
      ...current,
      firstName: current.firstName || userProfile?.firstName || "",
      lastName: current.lastName || userProfile?.lastName || "",
      email: currentUser.email || "",
      phone: current.phone || userProfile?.phone || "",
    }));
  }, [currentUser, userProfile]);

  function handleChange(event) {
    const { name, type, checked, value } = event.target;
    setFormData((current) => ({ ...current, [name]: type === "checkbox" ? checked : value }));
  }

  function handleEventChange(eventName, field, value) {
    setFormData((current) => ({
      ...current,
      events: { ...current.events, [eventName]: { ...current.events[eventName], [field]: value } },
    }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    if (!isLoggedIn && formData.password !== formData.confirmPassword) {
      setError(t("errorPasswordMismatch"));
      return;
    }
    if (isTooYoung) {
      setError(t("natTooYoungBody"));
      return;
    }
    const selectedEvents = NATIONAL_RACE_EVENTS.filter((eventName) => formData.events[eventName].selected);
    if (!selectedEvents.length) {
      setError(t("natErrorNoEvent"));
      return;
    }
    if (selectedEvents.some((eventName) => parsePerformanceToSeconds(formData.events[eventName].personalBest) === null)) {
      setError(t("natErrorPerformance"));
      return;
    }
    setIsSubmitting(true);
    try {
      await createNationalRaceRegistration({ ...formData, isMinor });
      navigate("/app/mon-inscription");
    } catch (submissionError) {
      if (submissionError?.code === "auth/email-already-in-use") onEmailInUse(formData.email);
      setError(getPreProgramSubmissionErrorMessage(submissionError, t));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="auth-form auth-form--long u14-form" onSubmit={handleSubmit}>
      <div className="notice-card">
        <strong>{t("natRulesTitle")}</strong>
        <RuleList
          items={[
            t("natRule1")
              .replace("{quota60}", NATIONAL_RACE_DEFINITIONS.find((race) => race.event === "60 m").quota)
              .replace("{quota800}", NATIONAL_RACE_DEFINITIONS.find((race) => race.event === "800 m").quota),
            t("natRule2"),
            t("natRule3"),
          ]}
        />
      </div>

      <section className="form-section-card">
        <div className="form-section-head">
          <h3>{t("natIdentityHeading")}</h3>
        </div>
        <div className="field-grid">
          <AuthFormField label={t("fieldFirstName")} required>
            <input name="firstName" required value={formData.firstName} onChange={handleChange} />
          </AuthFormField>
          <AuthFormField label={t("fieldLastName")} required>
            <input name="lastName" required value={formData.lastName} onChange={handleChange} />
          </AuthFormField>
        </div>
        <div className="field-grid">
          <AuthFormField label={t("fieldBirthDate")} required>
            <input name="birthDate" required type="date" value={formData.birthDate} onChange={handleChange} />
          </AuthFormField>
          <AuthFormField label={t("natGenderLabel")} hint={t("natGenderHint")} required>
            <select name="gender" required value={formData.gender} onChange={handleChange}>
              <option value="">{t("fieldSelectPlaceholder")}</option>
              <option value="femme">{t("natGenderWomen")}</option>
              <option value="homme">{t("natGenderMen")}</option>
            </select>
          </AuthFormField>
        </div>
        {isTooYoung ? (
          <div className="notice-card notice-card--danger">
            <strong>{t("natTooYoungTitle")}</strong>
            <p>{t("natTooYoungBody")}</p>
            <div className="auth-links">
              <button className="button button--secondary" type="button" onClick={onSwitchToYouth}>{t("ppPathYouthTitle")}</button>
            </div>
          </div>
        ) : null}
        <div className="field-grid">
          <AuthFormField label={t("fieldEmail")} required>
            <input autoComplete="email" name="email" readOnly={isLoggedIn} required type="email" value={formData.email} onChange={handleChange} />
          </AuthFormField>
          <AuthFormField label={t("fieldPhone")} required>
            <PhoneInput name="phone" required value={formData.phone} onChange={handleChange} />
          </AuthFormField>
        </div>
        {isLoggedIn ? null : <PasswordFields formData={formData} onChange={handleChange} />}
      </section>

      {isMinor ? (
        <section className="minor-guardian-card">
          <div className="form-section-head">
            <p className="eyebrow">{t("guardianEyebrow")}</p>
            <h3>{t("natGuardianHeading")}</h3>
            <p className="availability-lead">{t("natGuardianIntro")}</p>
          </div>
          <div className="field-grid">
            <AuthFormField label={t("guardianFirstNameLabel")} required>
              <input name="guardianFirstName" required value={formData.guardianFirstName} onChange={handleChange} />
            </AuthFormField>
            <AuthFormField label={t("guardianLastNameLabel")} required>
              <input name="guardianLastName" required value={formData.guardianLastName} onChange={handleChange} />
            </AuthFormField>
          </div>
          <div className="field-grid">
            <AuthFormField label={t("guardianEmailLabel")} required>
              <input name="guardianEmail" required type="email" value={formData.guardianEmail} onChange={handleChange} />
            </AuthFormField>
            <AuthFormField label={t("guardianPhoneLabel")} required>
              <PhoneInput name="guardianPhone" required value={formData.guardianPhone} onChange={handleChange} />
            </AuthFormField>
          </div>
          <label className="selection-card">
            <input checked={formData.guardianConsent} name="guardianConsent" required type="checkbox" onChange={handleChange} />
            <div>
              <strong>{t("natGuardianConsentTitle")} <span className="field-required" aria-hidden="true">*</span></strong>
              <p>{t("natGuardianConsentBody")}</p>
            </div>
          </label>
        </section>
      ) : null}

      <section className="form-section-card">
        <div className="form-section-head">
          <h3>{t("natLicenceHeading")}</h3>
        </div>
        <div className="lunex-choice-row">
          <label className="selection-card selection-card--inline">
            <input checked={isLuxLicensed} name="isLuxLicensed" type="radio" value="oui" onChange={handleChange} />
            <div><strong>{t("natLicenceLux")}</strong></div>
          </label>
          <label className="selection-card selection-card--inline">
            <input checked={!isLuxLicensed} name="isLuxLicensed" type="radio" value="non" onChange={handleChange} />
            <div><strong>{t("natLicenceForeign")}</strong></div>
          </label>
        </div>
        {isLuxLicensed ? (
          <div className="field-grid">
            <AuthFormField label={t("u14ClubLabel")} required>
              <select name="club" required value={formData.club} onChange={handleChange}>
                <option value="">{t("u14SelectClub")}</option>
                {luxCompetitionClubs.map((club) => (
                  <option key={club} value={club}>{club}</option>
                ))}
              </select>
            </AuthFormField>
            <AuthFormField label={t("ppBibLabel")} hint={t("ppBibHint")} required>
              <input name="bibNumber" required placeholder={t("u14LicencePlaceholder")} value={formData.bibNumber} onChange={handleChange} />
            </AuthFormField>
          </div>
        ) : (
          <>
            <p className="panel-note">{t("natForeignNote")}</p>
            <div className="field-grid">
              <AuthFormField label={t("natForeignCountry")} required>
                <input name="foreignCountry" required value={formData.foreignCountry} onChange={handleChange} />
              </AuthFormField>
              <AuthFormField label={t("natForeignClub")} required>
                <input name="foreignClub" required value={formData.foreignClub} onChange={handleChange} />
              </AuthFormField>
            </div>
            <AuthFormField label={t("natForeignLicence")} hint={t("natForeignLicenceHint")} required>
              <input name="foreignLicenceNumber" required value={formData.foreignLicenceNumber} onChange={handleChange} />
            </AuthFormField>
          </>
        )}
      </section>

      <section className="form-section-card">
        <div className="form-section-head">
          <h3>{t("natEventsHeading")}</h3>
          <p className="availability-lead">{t("natEventsIntro")}</p>
        </div>
        {NATIONAL_RACE_EVENTS.map((eventName) => {
          const entry = formData.events[eventName];
          const placeholder = eventName === "800 m" ? "2:05.30" : "7.45";
          const personalBestInvalid = entry.personalBest && parsePerformanceToSeconds(entry.personalBest) === null;
          return (
            <div key={eventName} className="preprogramme-event-block">
              <label className="selection-card selection-card--compact">
                <input checked={entry.selected} type="checkbox" onChange={(event) => handleEventChange(eventName, "selected", event.target.checked)} />
                <div><strong>{eventName}</strong></div>
              </label>
              {entry.selected ? (
                <>
                  <div className="field-grid">
                    <AuthFormField label={t("natPersonalBest")} hint={t("natPerformanceFormat").replace("{example}", placeholder)} required>
                      <input inputMode="decimal" placeholder={placeholder} required value={entry.personalBest} onChange={(event) => handleEventChange(eventName, "personalBest", event.target.value)} />
                    </AuthFormField>
                    <AuthFormField label={t("natSeasonBest")} hint={t("natSeasonBestHint")}>
                      <input inputMode="decimal" placeholder={placeholder} value={entry.seasonBest} onChange={(event) => handleEventChange(eventName, "seasonBest", event.target.value)} />
                    </AuthFormField>
                  </div>
                  {personalBestInvalid ? <p className="form-error">{t("natErrorPerformance")}</p> : null}
                  <AuthFormField label={t("natPerformanceContext")} hint={t("natPerformanceContextHint")}>
                    <input value={entry.performanceContext} onChange={(event) => handleEventChange(eventName, "performanceContext", event.target.value)} />
                  </AuthFormField>
                </>
              ) : null}
            </div>
          );
        })}
      </section>

      <AuthFormField label={t("u14NotesLabel")}>
        <textarea name="notes" rows="2" value={formData.notes} onChange={handleChange} />
      </AuthFormField>
      <label className="selection-card">
        <input checked={formData.imageConsent} name="imageConsent" required type="checkbox" onChange={handleChange} />
        <div>
          <strong>{t("imageRightsTitle")} <span className="field-required" aria-hidden="true">*</span></strong>
          <p>{t("natImageConsentBody")}</p>
        </div>
      </label>

      {error ? <p ref={errorRef} className="form-error">{error}</p> : null}
      <p className="panel-note">{t("rgpdDisclaimer")}</p>
      <div className="u14-submit-bar">
        <div>
          <strong>{isLoggedIn ? t("ppSubmitLoggedInTitle") : t("natSubmitBarTitle")}</strong>
          <p>{t("natSubmitBarBody")}</p>
        </div>
        <button className="button button--primary" disabled={isSubmitting || isTooYoung} type="submit">
          {isSubmitting ? t("u14Submitting") : t("u14SubmitButton")}
        </button>
      </div>
    </form>
  );
}

function PreProgrammeAccessPage() {
  const { t, language } = useLanguage();
  const { activeEditionId, preprogramOpeningByEdition, preprogramOpeningDate } = useActiveEdition();
  const [searchParams, setSearchParams] = useSearchParams();
  const [now, setNow] = useState(() => Date.now());
  const [loginEmailHint, setLoginEmailHint] = useState("");
  const requestedPath = searchParams.get("parcours");
  const path = requestedPath === PATH_YOUTH || requestedPath === PATH_NATIONAL ? requestedPath : "";
  const isPreprogramOpen = isPreprogramOpenForEdition(
    activeEditionId,
    now,
    typeof window !== "undefined" ? window.location.hostname : "",
    preprogramOpeningByEdition,
  );

  useEffect(() => {
    if (isPreprogramOpen) return undefined;
    const interval = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(interval);
  }, [isPreprogramOpen]);

  function selectPath(nextPath) {
    setSearchParams(nextPath ? { parcours: nextPath } : {}, { replace: true });
  }

  function handleEmailInUse(email) {
    setLoginEmailHint(email);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (!isPreprogramOpen) {
    return (
      <AuthLayout title={t("preprogramPageTitle")} subtitle={t("preprogramPageSubtitle")}>
        <div className="placeholder-card placeholder-card--u14">
          <div className="u14-closed-layout">
            <div className="u14-closed-layout__content">
              <div className="u14-hero__copy">
                <p className="eyebrow">{t("preprogramIntroEyebrow")}</p>
                <h2>{t("preprogramClosedTitle")}</h2>
                <p>{t("preprogramClosedDescription")}</p>
                <p className="panel-note">
                  {t("u14ActiveEditionNote").replace("{edition}", activeEditionId)}
                  {preprogramOpeningDate ? t("u14OpeningOn").replace("{date}", preprogramOpeningDate.toLocaleString(`${language}-LU`)) : ""}
                </p>
              </div>
              <div className="feature-card-grid">
                <div className="mini-feature">
                  <strong>{t("ppPathYouthTitle")}</strong>
                  <RuleList items={[t("ppYouthRule1"), t("ppYouthRule2"), t("ppYouthRule3")]} />
                </div>
                <div className="mini-feature">
                  <strong>{t("ppPathNationalTitle")}</strong>
                  <RuleList items={[t("natRule2"), t("natRule3")]} />
                </div>
              </div>
            </div>
            <div className="u14-closed-layout__aside">
              <div className="u14-hero__media">
                <div className="u14-hero__image u14-hero__image--large">
                  <img alt={t("u14ImageAltPreprogram")} src={preprogrammeHomeImage} />
                </div>
                <div className="u14-hero__image u14-hero__image--small">
                  <img alt={t("u14ImageAltBasket")} src={portePanierHomeImage} />
                </div>
              </div>
            </div>
          </div>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title={t("preprogramPageTitle")} subtitle={t("preprogramPageSubtitle")}>
      <div className="auth-form auth-form--long u14-form">
        <AccountBar loginEmailHint={loginEmailHint} />
        <PathChoice value={path} onChange={selectPath} />
        {path === PATH_YOUTH ? <YouthRegistrationForm onEmailInUse={handleEmailInUse} /> : null}
        {path === PATH_NATIONAL ? (
          <NationalRaceRegistrationForm onEmailInUse={handleEmailInUse} onSwitchToYouth={() => selectPath(PATH_YOUTH)} />
        ) : null}
      </div>
    </AuthLayout>
  );
}

export { PreProgrammeAccessPage };
