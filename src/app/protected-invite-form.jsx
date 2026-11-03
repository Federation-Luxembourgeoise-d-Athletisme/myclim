import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { useAuth } from "../context/auth-context";
import { db, functions } from "../services/firebase";
import { AuthFormField, PhoneInput } from "./form-components";
import { useActiveEdition } from "./edition";
import { useLanguage } from "./language-context";
import { useMeetingEditions } from "./meeting-history-hooks";
import { getU14CategoryFromBirthDate } from "./utils";
import {
  U14_PRACTICAL_INFO_DOC_PATH,
  formatDateForDisplay,
  getPreProgramSubmissionErrorMessage,
  getU14AllowedEvents,
  getU14RaceLabel,
} from "./u14-helpers";
import { U14_PROTECTED_INVITES_COLLECTION, getU14ProtectedInviteStatus } from "./u14-protected";

const MIN_PASSWORD_LENGTH = 6;

function buildRaceCode(category, gender, event) {
  return `${String(category || "").toUpperCase()}${String(gender || "").startsWith("f") ? "F" : "M"}${String(event || "").includes("1000") ? "1000" : "60"}`;
}

// Inscription d'un enfant invité sur une place protégée : enfant, club et
// dossard viennent de l'invitation ; la famille choisit la course, complète
// ses coordonnées, et l'envoi confirme la place (claimU14ProtectedInvite).
function ProtectedInviteForm({ token, accountBar }) {
  const { createU14PreProgramRegistration, currentUser, userProfile } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { activeEditionId } = useActiveEdition();
  const { editions } = useMeetingEditions();
  const [invite, setInvite] = useState(null);
  const [loadState, setLoadState] = useState("loading");
  const [now] = useState(() => Date.now());
  const [formData, setFormData] = useState({
    parentFirstName: "",
    parentLastName: "",
    parentEmail: "",
    parentPhone: "",
    password: "",
    confirmPassword: "",
    birthDate: "",
    gender: "",
    requestedEvent: "60 m",
    notes: "",
    imageConsent: false,
  });
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isLoggedIn = Boolean(currentUser);
  const yearMismatch = Boolean(invite?.birthYear && formData.birthDate && formData.birthDate.slice(0, 4) !== String(invite.birthYear));
  const category = yearMismatch ? "" : getU14CategoryFromBirthDate(formData.birthDate);
  const allowedEvents = getU14AllowedEvents(category);

  useEffect(() => {
    let cancelled = false;
    getDoc(doc(db, U14_PROTECTED_INVITES_COLLECTION, token))
      .then((snapshot) => {
        if (cancelled) return;
        if (!snapshot.exists()) {
          setLoadState("not-found");
          return;
        }
        const data = { id: snapshot.id, ...snapshot.data() };
        setInvite(data);
        setFormData((current) => ({ ...current, parentEmail: current.parentEmail || data.parentEmail || "", gender: data.gender || current.gender }));
        setLoadState("ready");
      })
      .catch(() => {
        if (!cancelled) setLoadState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    if (!currentUser) return;
    setFormData((current) => ({
      ...current,
      parentFirstName: current.parentFirstName || userProfile?.firstName || "",
      parentLastName: current.parentLastName || userProfile?.lastName || "",
      parentEmail: currentUser.email || current.parentEmail,
      parentPhone: current.parentPhone || userProfile?.phone || "",
    }));
  }, [currentUser, userProfile]);

  function handleChange(event) {
    const { name, type, checked, value } = event.target;
    setFormData((current) => {
      const next = { ...current, [name]: type === "checkbox" ? checked : value };
      const nextAllowed = getU14AllowedEvents(getU14CategoryFromBirthDate(next.birthDate));
      if (!nextAllowed.includes(next.requestedEvent)) next.requestedEvent = nextAllowed[0];
      return next;
    });
    setError("");
  }

  async function sendConfirmedMail(raceCode) {
    try {
      const [{ buildU14ParticipationConfirmedMail, enqueueTransactionalMail }, practicalSnapshot] = await Promise.all([
        import("../services/mailQueue"),
        getDoc(doc(db, ...U14_PRACTICAL_INFO_DOC_PATH)).catch(() => null),
      ]);
      const edition = editions.find((entry) => String(entry.year || entry.id) === String(activeEditionId)) || null;
      await enqueueTransactionalMail(
        buildU14ParticipationConfirmedMail({
          parentEmail: formData.parentEmail,
          parentFirstName: formData.parentFirstName,
          childName: `${invite.firstName} ${invite.lastName}`,
          raceLabel: getU14RaceLabel(raceCode),
          eventDate: edition?.date || null,
          venue: edition?.venue || "",
          editionYear: edition?.year || activeEditionId,
          practicalInfo: practicalSnapshot?.exists?.() ? practicalSnapshot.data()?.preprogram || "" : "",
        }),
      );
    } catch (mailError) {
      console.error("Protected place confirmation email could not be sent", mailError);
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    if (!isLoggedIn && formData.password !== formData.confirmPassword) {
      setError(t("errorPasswordMismatch"));
      return;
    }
    if (yearMismatch) {
      setError(t("ppInvYearMismatch").replace("{year}", invite.birthYear));
      return;
    }
    if (!category) {
      setError(t("u14ErrorBirthYears"));
      return;
    }
    setIsSubmitting(true);
    try {
      const { requestIds } = await createU14PreProgramRegistration({
        parentFirstName: formData.parentFirstName,
        parentLastName: formData.parentLastName,
        parentEmail: formData.parentEmail,
        parentPhone: formData.parentPhone,
        password: formData.password,
        skipConfirmationMail: true,
        children: [
          {
            firstName: invite.firstName,
            lastName: invite.lastName,
            birthDate: formData.birthDate,
            category,
            club: invite.club,
            bibNumber: invite.bibNumber,
            gender: formData.gender,
            requestType: "preprogram",
            requestedEvent: formData.requestedEvent,
            notes: formData.notes,
            imageConsent: formData.imageConsent,
          },
        ],
      });
      const requestId = requestIds?.[0];
      try {
        const claim = httpsCallable(functions, "claimU14ProtectedInvite");
        const { data } = await claim({ token, requestId });
        await sendConfirmedMail(data?.raceCode || buildRaceCode(category, formData.gender, formData.requestedEvent));
        navigate("/app/mes-enfants", { state: { protectedPlaceConfirmed: true } });
      } catch (claimError) {
        // La demande existe : elle suit le circuit normal, l'équipe est prévenue.
        setError(t("ppInvClaimFailed").replace("{message}", claimError?.message || ""));
      }
    } catch (submissionError) {
      setError(getPreProgramSubmissionErrorMessage(submissionError, t));
    } finally {
      setIsSubmitting(false);
    }
  }

  if (loadState === "loading") return <p className="panel-note">{t("ppInvLoading")}</p>;
  if (loadState !== "ready") {
    return (
      <div className="notice-card notice-card--danger">
        <strong>{t("ppInvNotFoundTitle")}</strong>
        <p>{t("ppInvNotFoundBody")}</p>
      </div>
    );
  }

  const status = getU14ProtectedInviteStatus(invite, now);
  if (status !== "invited") {
    return (
      <div className={`notice-card ${status === "claimed" ? "notice-card--ok" : "notice-card--danger"}`}>
        <strong>{status === "claimed" ? t("ppInvClaimedTitle") : t("ppInvExpiredTitle")}</strong>
        <p>{status === "claimed" ? t("ppInvClaimedBody") : t("ppInvExpiredBody")}</p>
      </div>
    );
  }

  return (
    <form className="auth-form auth-form--long u14-form" onSubmit={handleSubmit}>
      <div className="notice-card notice-card--ok">
        <strong>{t("ppInvTitle").replace("{name}", `${invite.firstName} ${invite.lastName}`)}</strong>
        <p>
          {t("ppInvBody")
            .replace("{club}", invite.club || "-")
            .replace("{bib}", invite.bibNumber || "-")
            .replace("{date}", formatDateForDisplay(invite.deadline))}
        </p>
      </div>
      {accountBar}

      <section className="form-section-card">
        <div className="form-section-head">
          <h3>{t("ppInvChildHeading")}</h3>
        </div>
        <div className="field-grid">
          <AuthFormField label={t("fieldBirthDate")} hint={t("u14BirthDateHint")} required>
            <input name="birthDate" required type="date" value={formData.birthDate} onChange={handleChange} />
          </AuthFormField>
          <AuthFormField label={t("fieldGender")} required>
            <select disabled={Boolean(invite.gender)} name="gender" required value={formData.gender} onChange={handleChange}>
              <option value="">{t("fieldSelectPlaceholder")}</option>
              <option value="fille">{t("u14GenderGirl")}</option>
              <option value="garcon">{t("u14GenderBoy")}</option>
            </select>
          </AuthFormField>
        </div>
        {yearMismatch ? (
          <div className="notice-card notice-card--danger">
            <p>{t("ppInvYearMismatch").replace("{year}", invite.birthYear)}</p>
          </div>
        ) : null}
        {formData.birthDate && !category && !yearMismatch ? (
          <div className="notice-card notice-card--danger">
            <strong>{t("u14NotEligibleTitle")}</strong>
            <p>{t("u14NotEligibleBody")}</p>
          </div>
        ) : null}
        {category ? (
          <>
            <div className="form-section-head">
              <strong>{t("ppInvRaceLabel")}</strong>
            </div>
            <div className="choice-grid">
              {allowedEvents.map((eventOption) => (
                <label key={eventOption} className="selection-card selection-card--compact">
                  <input
                    checked={formData.requestedEvent === eventOption}
                    name="requestedEvent"
                    type="radio"
                    value={eventOption}
                    onChange={handleChange}
                  />
                  <div>
                    <strong>{eventOption}</strong>
                    <p>{category}</p>
                  </div>
                </label>
              ))}
            </div>
          </>
        ) : null}
        <AuthFormField label={t("u14NotesLabel")}>
          <textarea name="notes" rows="2" value={formData.notes} onChange={handleChange} />
        </AuthFormField>
        <label className="selection-card">
          <input checked={formData.imageConsent} name="imageConsent" required type="checkbox" onChange={handleChange} />
          <div>
            <strong>{t("u14ImageConsentTitle")} <span className="field-required" aria-hidden="true">*</span></strong>
            <p>{t("u14ImageConsentBody")}</p>
          </div>
        </label>
      </section>

      <section className="form-section-card">
        <div className="form-section-head">
          <h3>{t("u14ParentInfoHeading")}</h3>
        </div>
        <div className="field-grid">
          <AuthFormField label={t("u14ParentFirstName")} required>
            <input name="parentFirstName" required value={formData.parentFirstName} onChange={handleChange} />
          </AuthFormField>
          <AuthFormField label={t("u14ParentLastName")} required>
            <input name="parentLastName" required value={formData.parentLastName} onChange={handleChange} />
          </AuthFormField>
        </div>
        <div className="field-grid">
          <AuthFormField label={t("u14ParentEmail")} required>
            <input autoComplete="email" name="parentEmail" readOnly={isLoggedIn} required type="email" value={formData.parentEmail} onChange={handleChange} />
          </AuthFormField>
          <AuthFormField label={t("u14ParentPhone")} required>
            <PhoneInput name="parentPhone" required value={formData.parentPhone} onChange={handleChange} />
          </AuthFormField>
        </div>
        {isLoggedIn ? null : (
          <div className="field-grid">
            <AuthFormField label={t("fieldPassword")} hint={t("ppPasswordHint").replace("{min}", MIN_PASSWORD_LENGTH)} required>
              <input autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH} name="password" required type="password" value={formData.password} onChange={handleChange} />
            </AuthFormField>
            <AuthFormField label={t("fieldConfirmPassword")} required>
              <input autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH} name="confirmPassword" required type="password" value={formData.confirmPassword} onChange={handleChange} />
            </AuthFormField>
          </div>
        )}
      </section>

      {error ? <p className="form-error">{error}</p> : null}
      <p className="panel-note">{t("rgpdDisclaimer")}</p>
      <div className="u14-submit-bar">
        <div>
          <strong>{t("ppInvSubmitTitle")}</strong>
          <p>{t("ppInvSubmitBody")}</p>
        </div>
        <button className="button button--primary" disabled={isSubmitting || !category} type="submit">
          {isSubmitting ? t("u14Submitting") : t("ppInvSubmitButton")}
        </button>
      </div>
    </form>
  );
}

export { ProtectedInviteForm };
