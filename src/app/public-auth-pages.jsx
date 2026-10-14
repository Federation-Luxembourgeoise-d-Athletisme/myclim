import { useEffect, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/auth-context";
import preprogrammeHomeImage from "../assets/preprogramme-home.jpg";
import portePanierHomeImage from "../assets/porte-panier-home.jpg";
import { AuthFormField, AuthLayout, PhoneInput } from "./form-components";
import { isPreprogramOpenForEdition, useActiveEdition, useVolunteerRoleOptions } from "./edition";
import { useLanguage } from "./language-context";
import { formatVolunteerSupportAvailabilityOption } from "./volunteer-helpers";
import {
  VOLUNTEER_LANGUAGE_OPTIONS,
  getAgeFromBirthDate,
  getU14CategoryFromBirthDate,
  getVolunteerLanguageOptionLabel,
  readRememberMePreference,
} from "./utils";
import {
  getPreProgramSubmissionErrorMessage,
  getU14AllowedEvents,
  getValidRequestedEventForCategory,
  luxCompetitionClubs,
} from "./u14-helpers";

const REMEMBER_ME_STORAGE_KEY = "myclim-remember-me";
const VOLUNTEER_SUPPORT_AVAILABILITY_OPTIONS = [
  "Avant-meeting - vendredi matin",
  "Avant-meeting - vendredi après-midi",
  "Avant-meeting - samedi matin",
  "Avant-meeting - samedi après-midi",
  "Après-meeting - lundi 9h-12h",
];

function getVolunteerApplicationSubmissionErrorMessage(error, t) {
  switch (error?.code) {
    case "underage-volunteer":
      return t("under14Body");
    case "volunteer/users-write-failed":
    case "volunteer/application-write-failed":
      return error.message;
    case "auth/email-already-in-use":
      return t("errEmailInUse");
    case "auth/invalid-email":
      return t("errInvalidEmail");
    case "auth/missing-password":
      return t("errMissingPassword");
    case "auth/weak-password":
      return t("errWeakPassword");
    case "auth/network-request-failed":
      return t("errNetworkFailed");
    case "permission-denied":
    case "firestore/permission-denied":
      return t("errPermissionDenied");
    case "unavailable":
    case "firestore/unavailable":
      return t("errServiceUnavailable");
    default:
      return error?.message
        ? t("errGenericWithMessage").replace("{message}", error.message)
        : t("errGenericNoMessage");
  }
}

function LoginPage() {
  const { login, requestPasswordReset } = useAuth();
  const { t } = useLanguage();
  const location = useLocation();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(readRememberMePreference);
  const [error, setError] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isResetSubmitting, setIsResetSubmitting] = useState(false);

  useEffect(() => {
    window.localStorage.setItem(REMEMBER_ME_STORAGE_KEY, String(rememberMe));
  }, [rememberMe]);

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setStatusMessage("");
    setIsSubmitting(true);

    try {
      await login(email, password, rememberMe);
      const requestedPath = location.state?.from?.pathname;
      const requestedSearch = location.state?.from?.search || "";
      navigate(requestedPath ? `${requestedPath}${requestedSearch}` : "/app", { replace: true });
    } catch {
      setError(t("loginError"));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleForgotPassword() {
    setError("");
    setStatusMessage("");

    if (!String(email || "").trim()) {
      setError(t("loginResetEmailRequired"));
      return;
    }

    setIsResetSubmitting(true);

    try {
      await requestPasswordReset(email);
      setStatusMessage(t("loginResetSuccess"));
    } catch {
      setError(t("loginResetError"));
    } finally {
      setIsResetSubmitting(false);
    }
  }

  return (
    <AuthLayout title={t("loginPageTitle")} subtitle={t("loginPageSubtitle")}>
      <form className="auth-form" onSubmit={handleSubmit}>
        <div>
          <p className="eyebrow">{t("loginEyebrow")}</p>
          <h2>{t("loginHeading")}</h2>
        </div>
        <AuthFormField label={t("loginEmailLabel")}>
          <input autoComplete="email" placeholder="prenom.nom@email.com" type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
        </AuthFormField>
        <AuthFormField label={t("loginPasswordLabel")}>
          <input autoComplete="current-password" placeholder="••••••••" type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
        </AuthFormField>
        <div className="auth-links">
          <button className="button button--secondary" type="button" disabled={isResetSubmitting} onClick={handleForgotPassword}>
            {isResetSubmitting ? t("loginForgotPasswordLoading") : t("loginForgotPassword")}
          </button>
        </div>
        <label className="selection-card selection-card--compact">
          <input checked={rememberMe} type="checkbox" onChange={(event) => setRememberMe(event.target.checked)} />
          <div>
            <strong>{t("loginRememberMe")}</strong>
            <p>{t("loginRememberMeDescription")}</p>
          </div>
        </label>
        {error ? <p className="form-error">{error}</p> : null}
        {statusMessage ? <p className="panel-note panel-note--success">{statusMessage}</p> : null}
        <button className="button button--primary" disabled={isSubmitting} type="submit">
          {isSubmitting ? t("loginLoading") : t("loginButton")}
        </button>
        <div className="auth-links">
          <NavLink to="/benevoles">{t("loginVolunteerLink")}</NavLink>
          <NavLink to="/pre-programme">{t("loginPreprogramLink")}</NavLink>
        </div>
      </form>
    </AuthLayout>
  );
}

function VolunteerAccessPage() {
  const { login, createVolunteerApplication } = useAuth();
  const { t, language } = useLanguage();
  const navigate = useNavigate();
  const volunteerRoleOptions = useVolunteerRoleOptions();
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [rememberLogin] = useState(readRememberMePreference);
  const [loginError, setLoginError] = useState("");
  const [isLoginSubmitting, setIsLoginSubmitting] = useState(false);
  const [applicationError, setApplicationError] = useState("");
  const [isApplicationSubmitting, setIsApplicationSubmitting] = useState(false);
  const [formData, setFormData] = useState({ firstName: "", lastName: "", gender: "", email: "", phone: "", password: "", confirmPassword: "", birthDate: "", languages: [], otherLanguage: "", tshirtSize: "M", lunexStudent: "non", lunexProgram: "", occupation: "", cmcmExperience: "", volunteerExperience: "", healthSafetyInfo: "", certificateNeeded: false, retainForNextYear: false, imageConsent: false, availability: [], meetingDayConfirmed: false, missionPreferences: [], guardianFirstName: "", guardianLastName: "", guardianEmail: "", guardianPhone: "" });
  const volunteerAge = getAgeFromBirthDate(formData.birthDate);
  const isUnder14Volunteer = volunteerAge !== null && volunteerAge < 14;
  const isMinorVolunteer = volunteerAge !== null && volunteerAge >= 14 && volunteerAge < 18;

  async function handleLoginSubmit(event) { event.preventDefault(); setLoginError(""); setIsLoginSubmitting(true); try { await login(loginEmail, loginPassword, rememberLogin); navigate("/app"); } catch { setLoginError(t("loginError")); } finally { setIsLoginSubmitting(false); } }
  function handleApplicationChange(event) { const { name, type, checked, value } = event.target; setFormData((current) => ({ ...current, [name]: type === "checkbox" ? checked : value })); }
  function toggleAvailabilityOption(option) { setFormData((current) => ({ ...current, availability: current.availability.includes(option) ? current.availability.filter((item) => item !== option) : [...current.availability, option] })); }
  function toggleLanguageOption(option) { setFormData((current) => ({ ...current, languages: current.languages.includes(option) ? current.languages.filter((item) => item !== option) : [...current.languages, option], otherLanguage: option === "Autre" && current.languages.includes(option) ? "" : current.otherLanguage })); }
  function toggleMissionPreferenceOption(option) { setFormData((current) => ({ ...current, missionPreferences: current.missionPreferences.includes(option) ? current.missionPreferences.filter((item) => item !== option) : [...current.missionPreferences, option] })); }

  async function handleApplicationSubmit(event) {
    event.preventDefault(); setApplicationError("");
    if (formData.password !== formData.confirmPassword) { setApplicationError(t("errorPasswordMismatch")); return; }
    if (!formData.meetingDayConfirmed) { setApplicationError(t("errorSundayConfirmRequired")); return; }
    if (!formData.imageConsent) { setApplicationError(t("errorImageConsentRequired")); return; }
    if (isUnder14Volunteer) { setApplicationError(t("under14Body")); return; }
    setIsApplicationSubmitting(true);
    try { await createVolunteerApplication(formData); navigate("/app"); }
    catch (submissionError) {
      console.error("Volunteer application submission failed", submissionError);
      if (submissionError?.code === "auth/email-already-in-use") {
        setLoginEmail(formData.email);
      }
      setApplicationError(getVolunteerApplicationSubmissionErrorMessage(submissionError, t));
    } finally { setIsApplicationSubmitting(false); }
  }

  const loginHeader = (
    <form className="login-inline" onSubmit={handleLoginSubmit}>
      <AuthFormField label={t("fieldEmail")}><input autoComplete="email" placeholder="prenom.nom@email.com" type="email" value={loginEmail} onChange={(event) => setLoginEmail(event.target.value)} /></AuthFormField>
      <AuthFormField label={t("fieldPassword")}><input autoComplete="current-password" placeholder="••••••••" type="password" value={loginPassword} onChange={(event) => setLoginPassword(event.target.value)} /></AuthFormField>
      <button className="button button--secondary" disabled={isLoginSubmitting} type="submit">{isLoginSubmitting ? t("loginLoading") : t("loginButton")}</button>
      {loginError ? <p className="form-error" style={{ margin: 0 }}>{loginError}</p> : null}
    </form>
  );

  return (
    <AuthLayout
      title={t("volunteerPageTitle")}
      subtitle={t("volunteerPageSubtitle")}
      headerContent={loginHeader}
      languages={["en", "fr", "de"]}
    >
      <div className="stacked-entry">
        <section className="entry-card">
          <div className="entry-card__header"><div><p className="eyebrow">{t("volunteerApplyEyebrow")}</p><h2>{t("volunteerApplyTitle")}</h2></div></div>
          <form className="auth-form auth-form--long" onSubmit={handleApplicationSubmit}>
            <div className="field-grid"><AuthFormField label={t("fieldFirstName")}><input name="firstName" required value={formData.firstName} onChange={handleApplicationChange} /></AuthFormField><AuthFormField label={t("fieldLastName")}><input name="lastName" required value={formData.lastName} onChange={handleApplicationChange} /></AuthFormField></div>
            <div className="field-grid"><AuthFormField label={t("fieldGender")}><select name="gender" value={formData.gender} onChange={handleApplicationChange}><option value="">{t("fieldSelectPlaceholder")}</option><option value="femme">{t("genderFemale")}</option><option value="homme">{t("genderMale")}</option><option value="autre">{t("otherLabel")}</option></select></AuthFormField><AuthFormField label={t("fieldTshirtSize")}><select name="tshirtSize" value={formData.tshirtSize} onChange={handleApplicationChange}><option>S</option><option>M</option><option>L</option><option>XL</option></select></AuthFormField></div>
            <div className="field-grid"><AuthFormField label={t("fieldEmail")}><input name="email" required type="email" value={formData.email} onChange={handleApplicationChange} /></AuthFormField><AuthFormField label={t("fieldPhone")}><PhoneInput name="phone" required value={formData.phone} onChange={handleApplicationChange} /></AuthFormField></div>
            <div className="field-grid"><AuthFormField label={t("fieldPassword")}><input name="password" required type="password" value={formData.password} onChange={handleApplicationChange} /></AuthFormField><AuthFormField label={t("fieldConfirmPassword")}><input name="confirmPassword" required type="password" value={formData.confirmPassword} onChange={handleApplicationChange} /></AuthFormField></div>
            <div className="field-grid"><AuthFormField label={t("fieldBirthDate")}><input name="birthDate" required type="date" value={formData.birthDate} onChange={handleApplicationChange} /></AuthFormField></div>
            {volunteerAge !== null ? <div className={`notice-card${isUnder14Volunteer ? " notice-card--danger" : isMinorVolunteer ? " notice-card--warn" : " notice-card--ok"}`}><strong>{isUnder14Volunteer ? t("under14Title") : isMinorVolunteer ? t("minorTitle") : t("adultTitle")}</strong><p>{isUnder14Volunteer ? t("under14Body") : isMinorVolunteer ? t("minorBody") : t("adultBody")}</p>{isUnder14Volunteer ? <div className="auth-links"><NavLink className="button button--secondary button-link" to="/pre-programme">{t("createParentAccountLink")}</NavLink></div> : null}</div> : null}
            {isMinorVolunteer ? <section className="minor-guardian-card"><div className="form-section-head"><p className="eyebrow">{t("guardianEyebrow")}</p><h3>{t("guardianHeading")}</h3></div><div className="field-grid"><AuthFormField label={t("guardianFirstNameLabel")}><input name="guardianFirstName" required={isMinorVolunteer} value={formData.guardianFirstName} onChange={handleApplicationChange} /></AuthFormField><AuthFormField label={t("guardianLastNameLabel")}><input name="guardianLastName" required={isMinorVolunteer} value={formData.guardianLastName} onChange={handleApplicationChange} /></AuthFormField></div><div className="field-grid"><AuthFormField label={t("guardianEmailLabel")}><input name="guardianEmail" required={isMinorVolunteer} type="email" value={formData.guardianEmail} onChange={handleApplicationChange} /></AuthFormField><AuthFormField label={t("guardianPhoneLabel")}><PhoneInput name="guardianPhone" required={isMinorVolunteer} value={formData.guardianPhone} onChange={handleApplicationChange} /></AuthFormField></div></section> : null}
            <div className="field-grid"><div className="language-card"><div className="form-section-head"><p className="eyebrow">{t("languagesEyebrow")}</p><h3>{t("languagesHeading")}</h3></div><div className="choice-grid">{VOLUNTEER_LANGUAGE_OPTIONS.map((option) => (<label key={option} className="selection-card selection-card--compact"><input checked={formData.languages.includes(option)} type="checkbox" onChange={() => toggleLanguageOption(option)} /><div><strong>{getVolunteerLanguageOptionLabel(option, language)}</strong></div></label>))}</div>{formData.languages.includes("Autre") ? <AuthFormField label={t("otherLanguageLabel")}><input name="otherLanguage" value={formData.otherLanguage} onChange={handleApplicationChange} /></AuthFormField> : null}</div><div className="lunex-card"><div className="form-section-head"><p className="eyebrow">{t("lunexEyebrow")}</p><h3>{t("lunexHeading")}</h3></div><div className="lunex-choice-row"><label className="selection-card selection-card--inline"><input checked={formData.lunexStudent === "oui"} name="lunexStudent" type="radio" value="oui" onChange={handleApplicationChange} /><div><strong>{t("yesLabel")}</strong></div></label><label className="selection-card selection-card--inline"><input checked={formData.lunexStudent === "non"} name="lunexStudent" type="radio" value="non" onChange={handleApplicationChange} /><div><strong>{t("noLabel")}</strong></div></label></div>{formData.lunexStudent === "oui" ? <AuthFormField label={t("lunexProgramLabel")}><input name="lunexProgram" value={formData.lunexProgram} onChange={handleApplicationChange} /></AuthFormField> : null}</div></div>
            <AuthFormField label={t("occupationLabel")}><input name="occupation" value={formData.occupation} onChange={handleApplicationChange} /></AuthFormField>
            <AuthFormField label={t("cmcmExperienceLabel")}><textarea name="cmcmExperience" rows="3" value={formData.cmcmExperience} onChange={handleApplicationChange} /></AuthFormField>
            <AuthFormField label={t("otherVolunteerExperienceLabel")}><textarea name="volunteerExperience" rows="3" value={formData.volunteerExperience} onChange={handleApplicationChange} /></AuthFormField>
            <div className="availability-card"><div className="form-section-head"><p className="eyebrow">{t("availabilityEyebrow")}</p><h3>{t("availabilityHeading")}</h3></div><p className="availability-lead">{t("availabilityIntro")}</p><div className="notice-card notice-card--warn"><strong>{t("mandatorySundayTitle")}</strong><p>{t("mandatorySundayBody")}</p></div><label className="selection-card availability-confirm-card"><input checked={formData.meetingDayConfirmed} name="meetingDayConfirmed" type="checkbox" onChange={handleApplicationChange} /><div><strong>{t("confirmSundayLabel")}</strong><p>{t("confirmSundayBody")}</p></div></label><p className="availability-subnote">{t("availabilitySubnote")}</p><div className="availability-options">{VOLUNTEER_SUPPORT_AVAILABILITY_OPTIONS.map((option) => (<label key={option} className="selection-card"><input checked={formData.availability.includes(option)} type="checkbox" onChange={() => toggleAvailabilityOption(option)} /><div><strong>{formatVolunteerSupportAvailabilityOption(option, t)}</strong></div></label>))}</div></div>
            <div className="language-card">
              <div className="form-section-head">
                <p className="eyebrow">{t("missionPreferencesEyebrow")}</p>
                <h3>{t("missionPreferencesLabel")}</h3>
                <p className="availability-lead">{t("missionPreferencesHint")}</p>
              </div>
              {volunteerRoleOptions.length ? (
                <div className="choice-grid">
                  {volunteerRoleOptions.map((option) => (
                    <label key={option} className="selection-card selection-card--compact">
                      <input
                        checked={formData.missionPreferences.includes(option)}
                        type="checkbox"
                        onChange={() => toggleMissionPreferenceOption(option)}
                      />
                      <div><strong>{option}</strong></div>
                    </label>
                  ))}
                </div>
              ) : (
                <p className="availability-lead">{t("missionPreferencesUnavailable")}</p>
              )}
            </div>
            <AuthFormField label={t("healthSafetyLabel")}><textarea name="healthSafetyInfo" rows="3" value={formData.healthSafetyInfo} onChange={handleApplicationChange} /></AuthFormField>
            <div className="selection-card-group"><label className="selection-card"><input checked={formData.retainForNextYear} name="retainForNextYear" onChange={handleApplicationChange} type="checkbox" /><div><strong>{t("nextEditionTitle")}</strong><p>{t("nextEditionBody")}</p></div></label><label className="selection-card"><input checked={formData.imageConsent} name="imageConsent" onChange={handleApplicationChange} type="checkbox" /><div><strong>{t("imageRightsTitle")}</strong><p>{t("imageRightsBody")}</p></div></label></div>
            {applicationError ? <p className="form-error">{applicationError}</p> : null}
            <p className="panel-note">{t("rgpdDisclaimer")}</p>
            <button className="button button--primary" disabled={isApplicationSubmitting} type="submit">{isApplicationSubmitting ? t("submittingLabel") : t("submitApplicationButton")}</button>
          </form>
        </section>
      </div>
    </AuthLayout>
  );
}

function U14AccessPage() {
  const { createU14PreProgramRegistration } = useAuth();
  const { t, language } = useLanguage();
  const { activeEditionId, preprogramOpeningByEdition, preprogramOpeningDate } = useActiveEdition();
  const navigate = useNavigate();
  const [now, setNow] = useState(() => Date.now());
  const [includeSecondChild, setIncludeSecondChild] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [formData, setFormData] = useState({ parentFirstName: "", parentLastName: "", parentEmail: "", parentPhone: "", password: "", confirmPassword: "", children: [{ firstName: "", lastName: "", birthDate: "", category: "", club: "", bibNumber: "", gender: "", requestType: "preprogram", requestedEvent: "60 m", notes: "", imageConsent: false }, { firstName: "", lastName: "", birthDate: "", category: "", club: "", bibNumber: "", gender: "", requestType: "preprogram", requestedEvent: "60 m", notes: "", imageConsent: false }] });
  const isPreprogramOpen = isPreprogramOpenForEdition(
    activeEditionId,
    now,
    typeof window !== "undefined" ? window.location.hostname : "",
    preprogramOpeningByEdition,
  );
  useEffect(() => { if (isPreprogramOpen) return undefined; const interval = window.setInterval(() => { setNow(Date.now()); }, 30000); return () => window.clearInterval(interval); }, [isPreprogramOpen]);
  function handleParentChange(event) { const { name, value } = event.target; setFormData((current) => ({ ...current, [name]: value })); }
  function handleChildChange(index, event) { const { name, type, checked, value } = event.target; setFormData((current) => ({ ...current, children: current.children.map((child, childIndex) => childIndex === index ? { ...(() => { const nextValue = type === "checkbox" ? checked : value; const nextCategory = name === "birthDate" ? getU14CategoryFromBirthDate(value) : child.category; const nextChild = { ...child, [name]: nextValue, ...(name === "birthDate" ? { category: nextCategory } : {}) }; return { ...nextChild, requestedEvent: getValidRequestedEventForCategory(nextCategory, name === "requestedEvent" ? value : nextChild.requestedEvent) }; })() } : child) })); }
  async function handleSubmit(event) { event.preventDefault(); setError(""); if (formData.password !== formData.confirmPassword) { setError(t("errorPasswordMismatch")); return; } const children = includeSecondChild ? formData.children : [formData.children[0]]; if (children.some((child) => child.firstName && child.lastName && child.birthDate && !getU14CategoryFromBirthDate(child.birthDate))) { setError(t("u14ErrorBirthYears")); return; } if (children.some((child) => child.firstName && child.lastName && child.birthDate && (!luxCompetitionClubs.includes(child.club) || !child.bibNumber.trim()))) { setError(t("u14ErrorClubLicence")); return; } if (children.some((child) => child.firstName && child.lastName && child.birthDate && child.requestType !== "porte_panier" && !getU14AllowedEvents(child.category).includes(child.requestedEvent))) { setError(t("u14ErrorU12Event")); return; } if (children.some((child) => child.firstName && child.lastName && child.birthDate && !child.imageConsent)) { setError(t("u14ErrorImageConsent")); return; } setIsSubmitting(true); try { await createU14PreProgramRegistration({ ...formData, children }); navigate("/app"); } catch (submissionError) { setError(getPreProgramSubmissionErrorMessage(submissionError, t)); } finally { setIsSubmitting(false); } }
  if (!isPreprogramOpen) {
    return <AuthLayout title={t("preprogramPageTitle")} subtitle={t("preprogramPageSubtitle")}><div className="placeholder-card placeholder-card--u14"><div className="u14-closed-layout"><div className="u14-closed-layout__content"><div className="u14-hero__copy"><p className="eyebrow">{t("preprogramIntroEyebrow")}</p><h2>{t("preprogramClosedTitle")}</h2><p>{t("preprogramClosedDescription")}</p><p className="panel-note">{t("u14ActiveEditionNote").replace("{edition}", activeEditionId)}{preprogramOpeningDate ? t("u14OpeningOn").replace("{date}", preprogramOpeningDate.toLocaleString(`${language}-LU`)) : ""}</p></div><div className="feature-card-grid"><div className="mini-feature"><strong>{t("preprogramClosedCardTitle")}</strong><span>{t("preprogramClosedCardBody")}</span></div><div className="mini-feature"><strong>{t("preprogramClosedTimingTitle")}</strong><span>{t("preprogramClosedTimingBody")}</span></div></div></div><div className="u14-closed-layout__aside"><div className="u14-hero__media"><div className="u14-hero__image u14-hero__image--large"><img alt={t("u14ImageAltPreprogram")} src={preprogrammeHomeImage} /></div><div className="u14-hero__image u14-hero__image--small"><img alt={t("u14ImageAltBasket")} src={portePanierHomeImage} /></div></div></div></div></div></AuthLayout>;
  }
  return <AuthLayout title={t("preprogramPageTitle")} subtitle={t("preprogramPageSubtitle")}><form className="auth-form auth-form--long u14-form" onSubmit={handleSubmit}><div className="u14-intro-card"><div className="u14-hero"><div className="u14-hero__copy"><p className="eyebrow">{t("preprogramIntroEyebrow")}</p><h2>{t("preprogramIntroTitle")}</h2><p>{t("preprogramIntroDescription")}</p></div><div className="u14-hero__media"><div className="u14-hero__image u14-hero__image--large"><img alt={t("u14ImageAltPreprogram")} src={preprogrammeHomeImage} /></div><div className="u14-hero__image u14-hero__image--small"><img alt={t("u14ImageAltBasket")} src={portePanierHomeImage} /></div></div></div></div><div className="notice-card"><strong>{t("preprogramClosedCardTitle")}</strong><p>{t("preprogramClosedCardBody")}</p></div><div className="notice-card notice-card--warn"><strong>{t("u14ClubsNoticeTitle")}</strong><p>{t("u14ClubsNoticeBody")}</p></div><section className="form-section-card"><div className="form-section-head"><p className="eyebrow">{t("u14Block").replace("{number}", 1)}</p><h3>{t("u14ParentInfoHeading")}</h3></div><div className="field-grid"><AuthFormField label={t("u14ParentFirstName")}><input name="parentFirstName" required value={formData.parentFirstName} onChange={handleParentChange} /></AuthFormField><AuthFormField label={t("u14ParentLastName")}><input name="parentLastName" required value={formData.parentLastName} onChange={handleParentChange} /></AuthFormField></div><div className="field-grid"><AuthFormField label={t("u14ParentEmail")}><input name="parentEmail" required type="email" value={formData.parentEmail} onChange={handleParentChange} /></AuthFormField><AuthFormField label={t("u14ParentPhone")}><PhoneInput name="parentPhone" required value={formData.parentPhone} onChange={handleParentChange} /></AuthFormField></div><div className="field-grid"><AuthFormField label={t("fieldPassword")} hint={t("u14PasswordHint")}><input name="password" required type="password" value={formData.password} onChange={handleParentChange} /></AuthFormField><AuthFormField label={t("fieldConfirmPassword")}><input name="confirmPassword" required type="password" value={formData.confirmPassword} onChange={handleParentChange} /></AuthFormField></div></section>{[0, ...(includeSecondChild ? [1] : [])].map((childIndex) => (<section key={childIndex} className="form-section-card"><div className="form-section-head"><p className="eyebrow">{t("u14Block").replace("{number}", childIndex + 2)}</p><h3>{childIndex === 0 ? t("u14FirstChild") : t("u14SecondChild")}</h3></div><div className="field-grid"><AuthFormField label={t("u14ChildFirstName")}><input name="firstName" required value={formData.children[childIndex].firstName} onChange={(event) => handleChildChange(childIndex, event)} /></AuthFormField><AuthFormField label={t("u14ChildLastName")}><input name="lastName" required value={formData.children[childIndex].lastName} onChange={(event) => handleChildChange(childIndex, event)} /></AuthFormField></div><div className="field-grid"><AuthFormField label={t("fieldBirthDate")} hint={t("u14BirthDateHint")}><input name="birthDate" required type="date" value={formData.children[childIndex].birthDate} onChange={(event) => handleChildChange(childIndex, event)} /></AuthFormField><AuthFormField label={t("u14CategoryLabel")}><input readOnly name="category" placeholder={t("u14CategoryPlaceholder")} required value={formData.children[childIndex].category} /></AuthFormField></div>{formData.children[childIndex].birthDate && !formData.children[childIndex].category ? <div className="notice-card notice-card--danger"><strong>{t("u14NotEligibleTitle")}</strong><p>{t("u14NotEligibleBody")}</p></div> : null}<div className="field-grid"><AuthFormField label={t("fieldGender")}><select name="gender" value={formData.children[childIndex].gender} onChange={(event) => handleChildChange(childIndex, event)}><option value="">{t("fieldSelectPlaceholder")}</option><option value="fille">{t("u14GenderGirl")}</option><option value="garcon">{t("u14GenderBoy")}</option></select></AuthFormField><AuthFormField label={t("u14ClubLabel")} hint={t("u14ClubHint")}><select name="club" required value={formData.children[childIndex].club} onChange={(event) => handleChildChange(childIndex, event)}><option value="">{t("u14SelectClub")}</option>{luxCompetitionClubs.map((club) => (<option key={club} value={club}>{club}</option>))}</select></AuthFormField></div><AuthFormField label={t("u14LicenceLabel")} hint={t("u14LicenceHint")}><input name="bibNumber" required placeholder={t("u14LicencePlaceholder")} value={formData.children[childIndex].bibNumber} onChange={(event) => handleChildChange(childIndex, event)} /></AuthFormField><AuthFormField label={t("u14RequestTypeLabel")} hint={t("u14RequestTypeHint")}><select name="requestType" value={formData.children[childIndex].requestType} onChange={(event) => handleChildChange(childIndex, event)}><option value="preprogram">{t("u14TypePreprogram")}</option><option value="porte_panier">{t("u14TypeBasket")}</option><option value="preprogram_ou_porte_panier">{t("u14TypeEither")}</option></select></AuthFormField>{formData.children[childIndex].requestType !== "porte_panier" ? <AuthFormField label={t("u14EventLabel")} hint={t("u14EventHint")}><select name="requestedEvent" value={formData.children[childIndex].requestedEvent} onChange={(event) => handleChildChange(childIndex, event)}>{getU14AllowedEvents(formData.children[childIndex].category).map((eventOption) => (<option key={eventOption} value={eventOption}>{eventOption}</option>))}</select></AuthFormField> : <div className="notice-card notice-card--ok"><strong>{t("u14TypeBasket")}</strong><p>{t("u14BasketNoticeBody")}</p></div>}<AuthFormField label={t("u14NotesLabel")}><textarea name="notes" rows="3" placeholder={t("u14NotesPlaceholder")} value={formData.children[childIndex].notes} onChange={(event) => handleChildChange(childIndex, event)} /></AuthFormField><label className="selection-card"><input checked={formData.children[childIndex].imageConsent} name="imageConsent" type="checkbox" onChange={(event) => handleChildChange(childIndex, event)} /><div><strong>{t("u14ImageConsentTitle")}</strong><p>{t("u14ImageConsentBody")}</p></div></label></section>))}<button className="button button--secondary" type="button" onClick={() => setIncludeSecondChild((current) => !current)}>{includeSecondChild ? t("u14RemoveSecondChild") : t("u14AddSecondChild")}</button>{error ? <p className="form-error">{error}</p> : null}<p className="panel-note">{t("rgpdDisclaimer")}</p><div className="u14-submit-bar"><div><strong>{t("u14SubmitBarTitle")}</strong><p>{t("u14SubmitBarBody")}</p></div><button className="button button--primary" disabled={isSubmitting} type="submit">{isSubmitting ? t("u14Submitting") : t("u14SubmitButton")}</button></div></form></AuthLayout>;
}

function VipAccessPage() {
  return <AuthLayout title="Inscription VIP" subtitle="Cette page sera l'entree dediee aux invitations et inscriptions VIP du CMCM Luxembourg Indoor Meeting." sideCard={<><h3>Module VIP</h3><p>Le formulaire d'inscription VIP sera ajoute plus tard. On garde deja une entree separee pour structurer le parcours public.</p><div className="auth-links auth-links--stack"><NavLink to="/">Retour a l'accueil</NavLink></div></>}><div className="placeholder-card"><p className="eyebrow">A venir</p><h2>Page VIP en preparation</h2><p>Le parcours VIP sera branche ici avec le formulaire, la confirmation d'inscription et les informations pratiques.</p><div className="auth-links"><NavLink to="/">Retour accueil</NavLink></div></div></AuthLayout>;
}

export { LoginPage, U14AccessPage, VipAccessPage, VolunteerAccessPage };
