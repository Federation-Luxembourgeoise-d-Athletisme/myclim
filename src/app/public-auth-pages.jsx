import { useEffect, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/auth-context";
import preprogrammeHomeImage from "../assets/preprogramme-home.jpg";
import portePanierHomeImage from "../assets/porte-panier-home.jpg";
import { AuthFormField, AuthLayout, PhoneInput } from "./form-components";
import { isPreprogramOpenForEdition, useActiveEdition, useVolunteerRoleOptions } from "./edition";
import { useLanguage } from "./language-context";
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
const VOLUNTEER_SUPPORT_AVAILABILITY_LABEL_KEYS = {
  "Avant-meeting - vendredi matin": "availabilityFridayMorning",
  "Avant-meeting - vendredi après-midi": "availabilityFridayAfternoon",
  "Avant-meeting - samedi matin": "availabilitySaturdayMorning",
  "Avant-meeting - samedi après-midi": "availabilitySaturdayAfternoon",
  "Après-meeting - lundi 9h-12h": "availabilityMondayAfterMeeting",
};
const RGPD_DISCLAIMER =
  "En envoyant ce formulaire, vous acceptez que vos données personnelles soient traitées par la Fédération Luxembourgeoise d'Athlétisme uniquement dans le cadre de votre inscription, de votre participation au CMCM Luxembourg Indoor Meeting et des communications associées.";

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
            <div className="availability-card"><div className="form-section-head"><p className="eyebrow">{t("availabilityEyebrow")}</p><h3>{t("availabilityHeading")}</h3></div><p className="availability-lead">{t("availabilityIntro")}</p><div className="notice-card notice-card--warn"><strong>{t("mandatorySundayTitle")}</strong><p>{t("mandatorySundayBody")}</p></div><label className="selection-card availability-confirm-card"><input checked={formData.meetingDayConfirmed} name="meetingDayConfirmed" type="checkbox" onChange={handleApplicationChange} /><div><strong>{t("confirmSundayLabel")}</strong><p>{t("confirmSundayBody")}</p></div></label><p className="availability-subnote">{t("availabilitySubnote")}</p><div className="availability-options">{VOLUNTEER_SUPPORT_AVAILABILITY_OPTIONS.map((option) => (<label key={option} className="selection-card"><input checked={formData.availability.includes(option)} type="checkbox" onChange={() => toggleAvailabilityOption(option)} /><div><strong>{t(VOLUNTEER_SUPPORT_AVAILABILITY_LABEL_KEYS[option])}</strong></div></label>))}</div></div>
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

function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [formData, setFormData] = useState({ firstName: "", lastName: "", email: "", phone: "", password: "", wantsVolunteerModule: true, wantsParentModule: false });
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  function handleChange(event) { const { name, type, checked, value } = event.target; setFormData((current) => ({ ...current, [name]: type === "checkbox" ? checked : value })); }
  async function handleSubmit(event) { event.preventDefault(); setError(""); setIsSubmitting(true); const userTypes = []; if (formData.wantsVolunteerModule) userTypes.push("benevole"); if (formData.wantsParentModule) userTypes.push("parent_u14"); try { await register(formData.email, formData.password, { firstName: formData.firstName, lastName: formData.lastName, phone: formData.phone, userTypes: userTypes.length ? userTypes : ["benevole"] }); navigate("/app"); } catch { setError("Creation de compte impossible. Cet email est peut-etre deja utilise."); } finally { setIsSubmitting(false); } }
  return (
    <AuthLayout title="Creer un compte unique et activer les bons modules" subtitle="Cree ton acces personnel puis active l'espace benevole, l'espace parent U14, ou les deux selon ton besoin." sideCard={<><h3>Creation de compte</h3><p>Ce parcours est ideal si tu veux d'abord ouvrir ton espace puis completer les modules tranquillement ensuite.</p></>}>
      <form className="auth-form" onSubmit={handleSubmit}>
        <div><p className="eyebrow">Creation de compte</p><h2>Ouvrir mon espace</h2></div>
        <div className="field-grid"><AuthFormField label="Prenom"><input name="firstName" value={formData.firstName} onChange={handleChange} /></AuthFormField><AuthFormField label="Nom"><input name="lastName" value={formData.lastName} onChange={handleChange} /></AuthFormField></div>
        <AuthFormField label="Email"><input name="email" type="email" value={formData.email} onChange={handleChange} /></AuthFormField>
        <div className="field-grid"><AuthFormField label="Telephone"><PhoneInput name="phone" value={formData.phone} onChange={handleChange} /></AuthFormField><AuthFormField label="Mot de passe"><input name="password" type="password" autoComplete="new-password" value={formData.password} onChange={handleChange} /></AuthFormField></div>
        <div className="selection-card-group"><label className="selection-card"><input checked={formData.wantsVolunteerModule} name="wantsVolunteerModule" onChange={handleChange} type="checkbox" /><div><strong>Module benevole</strong><p>Profil, disponibilites, affectations, documents et accreditation.</p></div></label><label className="selection-card"><input checked={formData.wantsParentModule} name="wantsParentModule" onChange={handleChange} type="checkbox" /><div><strong>Module parent / U14</strong><p>Ajout des enfants, demandes U14, statuts et convocations.</p></div></label></div>
        {error ? <p className="form-error">{error}</p> : null}
        <p className="panel-note">{RGPD_DISCLAIMER}</p>
        <button className="button button--primary" disabled={isSubmitting} type="submit">{isSubmitting ? "Creation..." : "Creer mon compte"}</button>
        <div className="auth-links"><NavLink to="/login">J'ai deja un compte</NavLink><NavLink to="/volunteer-apply">Je veux candidater directement</NavLink></div>
      </form>
    </AuthLayout>
  );
}

function U14AccessPage() {
  const { createU14PreProgramRegistration } = useAuth();
  const { t } = useLanguage();
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
  async function handleSubmit(event) { event.preventDefault(); setError(""); if (formData.password !== formData.confirmPassword) { setError("Les deux mots de passe ne correspondent pas."); return; } const children = includeSecondChild ? formData.children : [formData.children[0]]; if (children.some((child) => child.firstName && child.lastName && child.birthDate && !getU14CategoryFromBirthDate(child.birthDate))) { setError("Pour l'édition 2027, seuls les enfants nés en 2017/2016 (U12) et 2015/2014 (U14) peuvent être inscrits ici."); return; } if (children.some((child) => child.firstName && child.lastName && child.birthDate && (!luxCompetitionClubs.includes(child.club) || !child.bibNumber.trim()))) { setError("Pour toute demande, y compris porte-panier, merci d'indiquer un club luxembourgeois autorisé et le numéro de licence de l'enfant."); return; } if (children.some((child) => child.firstName && child.lastName && child.birthDate && child.requestType !== "porte_panier" && !getU14AllowedEvents(child.category).includes(child.requestedEvent))) { setError("Pour la catégorie U12, seule l'épreuve du 60 m peut être demandée."); return; } if (children.some((child) => child.firstName && child.lastName && child.birthDate && !child.imageConsent)) { setError("La participation au meeting implique des prises de vue photo et vidéo dans les espaces de l'événement. Sans cet accord, nous ne pourrons malheureusement pas confirmer l'inscription de l'enfant."); return; } setIsSubmitting(true); try { await createU14PreProgramRegistration({ ...formData, children }); navigate("/app"); } catch (submissionError) { setError(getPreProgramSubmissionErrorMessage(submissionError)); } finally { setIsSubmitting(false); } }
  if (!isPreprogramOpen) {
    return <AuthLayout title={t("preprogramPageTitle")} subtitle={t("preprogramPageSubtitle")}><div className="placeholder-card placeholder-card--u14"><div className="u14-closed-layout"><div className="u14-closed-layout__content"><div className="u14-hero__copy"><p className="eyebrow">{t("preprogramIntroEyebrow")}</p><h2>{t("preprogramClosedTitle")}</h2><p>{t("preprogramClosedDescription")}</p><p className="panel-note">Édition active: {activeEditionId === "test" ? "test" : activeEditionId}{preprogramOpeningDate ? ` - ouverture le ${preprogramOpeningDate.toLocaleString("fr-LU")}` : ""}</p></div><div className="feature-card-grid"><div className="mini-feature"><strong>{t("preprogramClosedCardTitle")}</strong><span>{t("preprogramClosedCardBody")}</span></div><div className="mini-feature"><strong>{t("preprogramClosedTimingTitle")}</strong><span>{t("preprogramClosedTimingBody")}</span></div></div></div><div className="u14-closed-layout__aside"><div className="u14-hero__media"><div className="u14-hero__image u14-hero__image--large"><img alt="Pré-programme U12/U14" src={preprogrammeHomeImage} /></div><div className="u14-hero__image u14-hero__image--small"><img alt="Porte-paniers" src={portePanierHomeImage} /></div></div></div></div></div></AuthLayout>;
  }
  return <AuthLayout title={t("preprogramPageTitle")} subtitle={t("preprogramPageSubtitle")}><form className="auth-form auth-form--long u14-form" onSubmit={handleSubmit}><div className="u14-intro-card"><div className="u14-hero"><div className="u14-hero__copy"><p className="eyebrow">{t("preprogramIntroEyebrow")}</p><h2>{t("preprogramIntroTitle")}</h2><p>{t("preprogramIntroDescription")}</p></div><div className="u14-hero__media"><div className="u14-hero__image u14-hero__image--large"><img alt="Pré-programme U12/U14" src={preprogrammeHomeImage} /></div><div className="u14-hero__image u14-hero__image--small"><img alt="Porte-paniers" src={portePanierHomeImage} /></div></div></div></div><div className="notice-card"><strong>{t("preprogramClosedCardTitle")}</strong><p>{t("preprogramClosedCardBody")}</p></div><div className="notice-card notice-card--warn"><strong>Courses U12/U14 réservées aux licenciés luxembourgeois</strong><p>Les courses U12/U14 sont réservées aux licenciés luxembourgeois des clubs suivants : CAB, CAD, CAPA, CSL, CELTIC, LIAL, CAEG, CAFOLA, CAS, Karibu, Trispeed, RBUAP, CSN Clervaux, Triathlon Luxembourg et Team X3M Snooze.</p></div><section className="form-section-card"><div className="form-section-head"><p className="eyebrow">Bloc 1</p><h3>Informations parentales</h3></div><div className="field-grid"><AuthFormField label="Prénom du parent"><input name="parentFirstName" required value={formData.parentFirstName} onChange={handleParentChange} /></AuthFormField><AuthFormField label="Nom du parent"><input name="parentLastName" required value={formData.parentLastName} onChange={handleParentChange} /></AuthFormField></div><div className="field-grid"><AuthFormField label="Email du parent"><input name="parentEmail" required type="email" value={formData.parentEmail} onChange={handleParentChange} /></AuthFormField><AuthFormField label="Téléphone du parent"><PhoneInput name="parentPhone" required value={formData.parentPhone} onChange={handleParentChange} /></AuthFormField></div><div className="field-grid"><AuthFormField label="Mot de passe" hint="Ce mot de passe servira pour vous reconnecter à l'espace parent après l'inscription."><input name="password" required type="password" value={formData.password} onChange={handleParentChange} /></AuthFormField><AuthFormField label="Confirmer le mot de passe"><input name="confirmPassword" required type="password" value={formData.confirmPassword} onChange={handleParentChange} /></AuthFormField></div></section>{[0, ...(includeSecondChild ? [1] : [])].map((childIndex) => (<section key={childIndex} className="form-section-card"><div className="form-section-head"><p className="eyebrow">Bloc {childIndex + 2}</p><h3>{childIndex === 0 ? "Premier enfant" : "Deuxième enfant"}</h3></div><div className="field-grid"><AuthFormField label="Prénom de l'enfant"><input name="firstName" required value={formData.children[childIndex].firstName} onChange={(event) => handleChildChange(childIndex, event)} /></AuthFormField><AuthFormField label="Nom de l'enfant"><input name="lastName" required value={formData.children[childIndex].lastName} onChange={(event) => handleChildChange(childIndex, event)} /></AuthFormField></div><div className="field-grid"><AuthFormField label="Date de naissance" hint="Pour le CMCM Luxembourg Indoor Meeting 2027 : U12 = 2017/2016, U14 = 2015/2014."><input name="birthDate" required type="date" value={formData.children[childIndex].birthDate} onChange={(event) => handleChildChange(childIndex, event)} /></AuthFormField><AuthFormField label="Catégorie attribuée"><input readOnly name="category" placeholder="Calculée automatiquement" required value={formData.children[childIndex].category} /></AuthFormField></div>{formData.children[childIndex].birthDate && !formData.children[childIndex].category ? <div className="notice-card notice-card--danger"><strong>Catégorie non éligible</strong><p>Pour cette page, l'enfant doit être né en 2017 ou 2016 pour la catégorie U12, ou en 2015 ou 2014 pour la catégorie U14.</p></div> : null}<div className="field-grid"><AuthFormField label="Genre"><select name="gender" value={formData.children[childIndex].gender} onChange={(event) => handleChildChange(childIndex, event)}><option value="">Sélectionner</option><option value="fille">Fille</option><option value="garcon">Garcon</option></select></AuthFormField><AuthFormField label="Club" hint="Obligatoire pour toute demande, y compris porte-panier. Choisissez un club luxembourgeois autorisé."><select name="club" required value={formData.children[childIndex].club} onChange={(event) => handleChildChange(childIndex, event)}><option value="">Sélectionner un club</option>{luxCompetitionClubs.map((club) => (<option key={club} value={club}>{club}</option>))}</select></AuthFormField></div><AuthFormField label="Numéro de licence" hint="Obligatoire pour toute demande, y compris porte-panier."><input name="bibNumber" required placeholder="Ex: 245" value={formData.children[childIndex].bibNumber} onChange={(event) => handleChildChange(childIndex, event)} /></AuthFormField><AuthFormField label="Type d'inscription souhaité" hint="Choisissez le Pré-programme, le rôle de porte-panier, ou une demande flexible selon les places disponibles."><select name="requestType" value={formData.children[childIndex].requestType} onChange={(event) => handleChildChange(childIndex, event)}><option value="preprogram">Pré-programme U12/U14</option><option value="porte_panier">Porte-panier</option><option value="preprogram_ou_porte_panier">Pré-programme ou porte-panier</option></select></AuthFormField>{formData.children[childIndex].requestType !== "porte_panier" ? <AuthFormField label="Épreuve demandée" hint="Une seule épreuve par enfant. Le 1000 m est réservé à la catégorie U14."><select name="requestedEvent" value={formData.children[childIndex].requestedEvent} onChange={(event) => handleChildChange(childIndex, event)}>{getU14AllowedEvents(formData.children[childIndex].category).map((eventOption) => (<option key={eventOption} value={eventOption}>{eventOption}</option>))}</select></AuthFormField> : <div className="notice-card notice-card--ok"><strong>Porte-panier</strong><p>Cette demande concerne le rôle de porte-panier. Une licence reste obligatoire et l'organisation reviendra vers vous avec les modalités selon les places disponibles.</p></div>}<AuthFormField label="Informations utiles"><textarea name="notes" rows="3" placeholder="Informations complémentaires, préférences ou remarques si nécessaire" value={formData.children[childIndex].notes} onChange={(event) => handleChildChange(childIndex, event)} /></AuthFormField><label className="selection-card"><input checked={formData.children[childIndex].imageConsent} name="imageConsent" type="checkbox" onChange={(event) => handleChildChange(childIndex, event)} /><div><strong>Autorisation image</strong><p>La participation implique des prises de vue photo et vidéo dans les espaces du meeting. Sans cet accord, nous ne pourrons malheureusement pas confirmer l'inscription de votre enfant.</p></div></label></section>))}<button className="button button--secondary" type="button" onClick={() => setIncludeSecondChild((current) => !current)}>{includeSecondChild ? "Retirer le second enfant" : "Ajouter un deuxième enfant"}</button>{error ? <p className="form-error">{error}</p> : null}<p className="panel-note">{RGPD_DISCLAIMER}</p><div className="u14-submit-bar"><div><strong>Le compte parent sera créé automatiquement.</strong><p>Vous pourrez ensuite retrouver dans MyCLIM les statuts, décisions et informations pratiques pour le Pré-programme ou le porte-panier.</p></div><button className="button button--primary" disabled={isSubmitting} type="submit">{isSubmitting ? "Envoi en cours..." : "Envoyer l'inscription"}</button></div></form></AuthLayout>;
}

function VipAccessPage() {
  return <AuthLayout title="Inscription VIP" subtitle="Cette page sera l'entree dediee aux invitations et inscriptions VIP du CMCM Luxembourg Indoor Meeting." sideCard={<><h3>Module VIP</h3><p>Le formulaire d'inscription VIP sera ajoute plus tard. On garde deja une entree separee pour structurer le parcours public.</p><div className="auth-links auth-links--stack"><NavLink to="/">Retour a l'accueil</NavLink></div></>}><div className="placeholder-card"><p className="eyebrow">A venir</p><h2>Page VIP en preparation</h2><p>Le parcours VIP sera branche ici avec le formulaire, la confirmation d'inscription et les informations pratiques.</p><div className="auth-links"><NavLink to="/">Retour accueil</NavLink></div></div></AuthLayout>;
}

export { LoginPage, RegisterPage, U14AccessPage, VipAccessPage, VolunteerAccessPage };
