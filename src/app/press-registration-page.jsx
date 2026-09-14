import { useState } from "react";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { NavLink } from "react-router-dom";
import { db } from "../services/firebase";
import { getActiveEditionId } from "./edition";
import { AuthFormField, AuthLayout, PhoneInput } from "./form-components";
import { useLanguage } from "./language-context";

const PRESS_COPY = {
  fr: {
    title: "Accréditation presse",
    subtitle: "CMCM Luxembourg Indoor Meeting — Demande d'accréditation pour journalistes et photographes.",
    eyebrow: "CMCM Luxembourg Indoor Meeting",
    introTitle: "Demande d'accréditation presse",
    introBody:
      "La Fédération Luxembourgeoise d'Athlétisme propose des accréditations presse pour le CMCM Luxembourg Indoor Meeting. Merci de compléter ce formulaire pour soumettre votre demande.",
    introBodyTwo:
      "Votre demande sera examinée par notre équipe. Vous recevrez un email de confirmation à réception, puis une réponse dans les prochains jours.",
    highlightPressTitle: "Presse",
    highlightPressBody: "Accès à la Mixed Zone.",
    highlightPhotographerTitle: "Photographe",
    highlightPhotographerBody: "Accès à la Mixed Zone et à l'Infield.",
    formTitle: "Informations de la demande",
    formSubtitle: "Les champs marqués d'un astérisque (*) sont obligatoires.",
    firstNameLabel: "Prénom",
    lastNameLabel: "Nom",
    mediaLabel: "Média / organisation",
    roleLabel: "Fonction",
    emailLabel: "E-mail",
    phoneLabel: "Téléphone",
    phoneHint: "Facultatif, utile si nous devons vous recontacter rapidement.",
    requestTypeLabel: "Type de demande",
    requestTypePress: "Presse — Mixed Zone",
    requestTypePhotographer: "Photographe — Mixed Zone + Infield",
    commentLabel: "Commentaire ou informations complémentaires",
    commentPlaceholder: "Nom du média, liens vers des publications, informations utiles...",
    rgpdDisclaimer:
      "En envoyant ce formulaire, vous acceptez que vos données personnelles soient traitées par la Fédération Luxembourgeoise d'Athlétisme uniquement dans le cadre de votre demande d'accréditation presse et des communications associées.",
    privacyLabel: "J'accepte que mes données personnelles soient utilisées dans le cadre de la gestion des accréditations presse du CMCM Luxembourg Indoor Meeting.",
    submitButton: "Envoyer ma demande",
    submitting: "Envoi en cours...",
    successTitle: "Demande envoyée",
    successMessage:
      "Votre demande d'accréditation presse a bien été reçue. Vous recevrez un email de confirmation et une réponse dans les prochains jours.",
    errorMessage: "La demande n'a pas pu être envoyée. Merci de réessayer.",
    backLink: "Retour à l'accueil",
    privacyRequired: "Vous devez accepter la politique de confidentialité pour soumettre votre demande.",
  },
  en: {
    title: "Press accreditation",
    subtitle: "CMCM Luxembourg Indoor Meeting — Accreditation request for journalists and photographers.",
    eyebrow: "CMCM Luxembourg Indoor Meeting",
    introTitle: "Press accreditation request",
    introBody:
      "The Luxembourg Athletics Federation offers press accreditations for the CMCM Luxembourg Indoor Meeting. Please complete this form to submit your request.",
    introBodyTwo:
      "Your request will be reviewed by our team. You will receive a confirmation email upon receipt, then a response within the next few days.",
    highlightPressTitle: "Press",
    highlightPressBody: "Access to the Mixed Zone.",
    highlightPhotographerTitle: "Photographer",
    highlightPhotographerBody: "Access to the Mixed Zone and Infield.",
    formTitle: "Request information",
    formSubtitle: "Fields marked with an asterisk (*) are required.",
    firstNameLabel: "First name",
    lastNameLabel: "Last name",
    mediaLabel: "Media / organisation",
    roleLabel: "Role / function",
    emailLabel: "E-mail",
    phoneLabel: "Phone",
    phoneHint: "Optional, useful if we need to contact you quickly.",
    requestTypeLabel: "Request type",
    requestTypePress: "Press — Mixed Zone",
    requestTypePhotographer: "Photographer — Mixed Zone + Infield",
    commentLabel: "Comment or additional information",
    commentPlaceholder: "Media name, links to publications, useful information...",
    rgpdDisclaimer:
      "By submitting this form, you agree that your personal data may be processed by the Luxembourg Athletics Federation solely for your press accreditation request and related communications.",
    privacyLabel:
      "I agree that my personal data may be used for the management of press accreditations for the CMCM Luxembourg Indoor Meeting.",
    submitButton: "Submit my request",
    submitting: "Submitting...",
    successTitle: "Request submitted",
    successMessage:
      "Your press accreditation request has been received. You will receive a confirmation email and a response within the next few days.",
    errorMessage: "The request could not be submitted. Please try again.",
    backLink: "Back to home",
    privacyRequired: "You must accept the privacy policy to submit your request.",
  },
};

function createEmptyPressFormData() {
  return {
    firstName: "",
    lastName: "",
    media: "",
    role: "",
    email: "",
    phone: "",
    requestType: "press",
    comment: "",
    privacyAccepted: false,
  };
}

function PressRegistrationPage({ loadMailQueueModule }) {
  const { language } = useLanguage();
  const copy = PRESS_COPY[language] || PRESS_COPY.fr;
  const [formData, setFormData] = useState(() => createEmptyPressFormData());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  function handleChange(event) {
    const { name, value, type, checked } = event.target;
    setFormData((current) => ({
      ...current,
      [name]: type === "checkbox" ? checked : value,
    }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");

    if (!formData.privacyAccepted) {
      setError(copy.privacyRequired);
      return;
    }

    setIsSubmitting(true);

    try {
      const editionId = await getActiveEditionId();
      const zoneIds =
        formData.requestType === "photographer"
          ? ["zone-infield", "zone-mixed"]
          : ["zone-mixed"];

      await addDoc(collection(db, "pressRegistrations"), {
        firstName: String(formData.firstName).trim(),
        lastName: String(formData.lastName).trim(),
        media: String(formData.media).trim(),
        role: String(formData.role).trim(),
        email: String(formData.email).trim(),
        phone: String(formData.phone || "").trim(),
        requestType: formData.requestType,
        comment: String(formData.comment || "").trim(),
        privacyAccepted: true,
        status: "pending_review",
        zoneIds,
        printStatus: "Non-imprimé",
        editionId,
        submittedAt: serverTimestamp(),
      });

      const emailAddress = String(formData.email).trim();
      if (emailAddress && loadMailQueueModule) {
        // The registration is already saved at this point — a confirmation e-mail
        // failing to send must never be reported to the applicant as "your request
        // failed", or they may resubmit and create a duplicate.
        try {
          const { buildPressRegistrationConfirmationMail, enqueueTransactionalMail } =
            await loadMailQueueModule();
          await enqueueTransactionalMail(
            buildPressRegistrationConfirmationMail({
              email: emailAddress,
              firstName: formData.firstName,
              requestType: formData.requestType,
            }),
          );
        } catch (mailError) {
          console.error("Press registration confirmation email failed", mailError);
        }
      }

      setSuccess(true);
      setFormData(createEmptyPressFormData());
    } catch (submissionError) {
      console.error("Press registration failed", submissionError);
      setError(copy.errorMessage);
    } finally {
      setIsSubmitting(false);
    }
  }

  if (success) {
    return (
      <AuthLayout title={copy.title} subtitle={copy.subtitle}>
        <div className="stacked-entry">
          <section className="entry-card">
            <div className="vip-intro-card">
              <p className="eyebrow">{copy.eyebrow}</p>
              <h2>{copy.successTitle}</h2>
              <p>{copy.successMessage}</p>
            </div>
            <div className="auth-links">
              <NavLink to="/">{copy.backLink}</NavLink>
            </div>
          </section>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title={copy.title} subtitle={copy.subtitle}>
      <div className="stacked-entry">
        <section className="entry-card vip-entry-card">
          <div className="vip-intro-card">
            <p className="eyebrow">{copy.eyebrow}</p>
            <h2>{copy.introTitle}</h2>
            <p>{copy.introBody}</p>
            <p>{copy.introBodyTwo}</p>
          </div>
          <div className="vip-highlight-grid">
            <article className="vip-highlight-card">
              <strong>{copy.highlightPressTitle}</strong>
              <p>{copy.highlightPressBody}</p>
            </article>
            <article className="vip-highlight-card">
              <strong>{copy.highlightPhotographerTitle}</strong>
              <p>{copy.highlightPhotographerBody}</p>
            </article>
          </div>
        </section>

        <form className="auth-form auth-form--long vip-form-card" onSubmit={handleSubmit}>
          <div>
            <p className="eyebrow">{copy.title}</p>
            <h2>{copy.formTitle}</h2>
            <p>{copy.formSubtitle}</p>
          </div>

          <div className="field-grid">
            <AuthFormField label={copy.firstNameLabel} required>
              <input name="firstName" required value={formData.firstName} onChange={handleChange} />
            </AuthFormField>
            <AuthFormField label={copy.lastNameLabel} required>
              <input name="lastName" required value={formData.lastName} onChange={handleChange} />
            </AuthFormField>
          </div>

          <div className="field-grid">
            <AuthFormField label={copy.mediaLabel} required>
              <input name="media" required value={formData.media} onChange={handleChange} />
            </AuthFormField>
            <AuthFormField label={copy.roleLabel} required>
              <input name="role" required value={formData.role} onChange={handleChange} />
            </AuthFormField>
          </div>

          <div className="field-grid">
            <AuthFormField label={copy.emailLabel} required>
              <input name="email" required type="email" value={formData.email} onChange={handleChange} />
            </AuthFormField>
            <AuthFormField label={copy.phoneLabel} hint={copy.phoneHint}>
              <PhoneInput name="phone" value={formData.phone} onChange={handleChange} />
            </AuthFormField>
          </div>

          <AuthFormField label={copy.requestTypeLabel} required>
            <select name="requestType" value={formData.requestType} onChange={handleChange}>
              <option value="press">{copy.requestTypePress}</option>
              <option value="photographer">{copy.requestTypePhotographer}</option>
            </select>
          </AuthFormField>

          <AuthFormField label={copy.commentLabel}>
            <textarea
              name="comment"
              rows="3"
              placeholder={copy.commentPlaceholder}
              value={formData.comment}
              onChange={handleChange}
            />
          </AuthFormField>

          <p className="panel-note">{copy.rgpdDisclaimer}</p>

          <label className="selection-card">
            <input
              name="privacyAccepted"
              type="checkbox"
              checked={formData.privacyAccepted}
              onChange={handleChange}
            />
            <div>
              <p>{copy.privacyLabel}</p>
            </div>
          </label>

          {error ? <p className="form-error">{error}</p> : null}

          <button className="button button--primary" disabled={isSubmitting} type="submit">
            {isSubmitting ? copy.submitting : copy.submitButton}
          </button>

          <div className="auth-links">
            <NavLink to="/">{copy.backLink}</NavLink>
          </div>
        </form>
      </div>
    </AuthLayout>
  );
}

export { PressRegistrationPage };
