import { useEffect, useMemo, useRef, useState } from "react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { signInWithCustomToken } from "firebase/auth";
import { httpsCallable } from "firebase/functions";
import { NavLink, useParams } from "react-router-dom";
import { auth, db, functions } from "../services/firebase";
import { getActiveEditionId } from "./edition";
import { AuthFormField, AuthLayout, PhoneInput } from "./form-components";
import { useLanguage } from "./language-context";
import {
  VIP_TOUR_OPTIONS,
  buildVipRegistrationPayload,
  createEmptyVipFormData,
  getVipPartnerPortalLabel,
} from "./vip-helpers";

function getVipRgpdDisclaimer(language) {
  if (language === "de") {
    return "Mit dem Absenden dieses Formulars stimmen Sie zu, dass Ihre personenbezogenen Daten vom luxemburgischen Leichtathletikverband ausschließlich zur Verwaltung Ihrer Anmeldung, Ihrer Teilnahme am CMCM Luxembourg Indoor Meeting und der damit verbundenen Kommunikation verarbeitet werden.";
  }

  if (language === "en") {
    return "By submitting this form, you agree that your personal data may be processed by the Luxembourg Athletics Federation solely for managing your registration, your participation in the CMCM Luxembourg Indoor Meeting and related communications.";
  }

  return "En envoyant ce formulaire, vous acceptez que vos données personnelles soient traitées par la Fédération Luxembourgeoise d'Athlétisme uniquement dans le cadre de votre inscription, de votre participation au CMCM Luxembourg Indoor Meeting et des communications associées.";
}

const VIP_COPY = {
  fr: {
    publicTitle: "Invitation VIP",
    publicSubtitle:
      "La Fédération Luxembourgeoise d'Athlétisme est heureuse de vous inviter au CMCM Luxembourg Indoor Meeting.",
    publicIntroEyebrow: "CMCM Luxembourg Indoor Meeting",
    publicIntroTitle: "Nous serions ravis de vous accueillir parmi nos invités VIP",
    publicIntroBody:
      "La Fédération Luxembourgeoise d'Athlétisme a le plaisir de vous inviter à la prochaine édition du CMCM Luxembourg Indoor Meeting, qui se tiendra le 18 janvier 2026 à la Coque.",
    publicIntroBodyTwo:
      "Au cœur du World Athletics Indoor Tour Silver, cette invitation vous donne accès à un accueil privilégié, aux informations pratiques du meeting et, selon votre choix, à une découverte exclusive de la Coque ou des coulisses de l'événement.",
    publicIntroBodyThree:
      "Merci de compléter un formulaire par personne invitée. Si vous souhaitez venir accompagné(e), vous pouvez ajouter cette personne dans le même formulaire.",
    highlightOneTitle: "Accès VIP au meeting",
    highlightOneBody: "Un accueil réservé à votre arrivée et un parcours pensé pour vos invités.",
    highlightTwoTitle: "Visite exclusive à 14h15",
    highlightTwoBody: "Choisissez entre la découverte de la Coque ou les coulisses du meeting.",
    highlightThreeTitle: "Hospitality et infos pratiques",
    highlightThreeBody: "Toutes les informations utiles pour profiter pleinement de votre venue.",
    detailsTitle: "Informations pratiques",
    detailsBody:
      "Nous nous réjouissons de vous accueillir pour ce moment dédié à l'athlétisme indoor de haut niveau. Merci de confirmer votre présence via le formulaire ci-dessous.",
    practicalWebsiteLabel: "Site internet",
    practicalDoors: "Ouverture des portes à partir de 14h00",
    practicalTours: "Visites à 14h15, durée approximative de 40 min",
    practicalPreprogram: "Pré-programme vers 15h00",
    practicalInternational: "Programme international à 16h00",
    formTitle: "Confirmation de présence",
    formSubtitle:
      "Les champs marqués d'un astérisque sont obligatoires. L'e-mail de l'accompagnant reste facultatif.",
    partnerTitle: "Portail partenaire VIP",
    partnerSubtitle: "Page dédiée pour gérer directement la liste des invités de votre organisation.",
    partnerIntro:
      "Cette page est réservée à l'organisation indiquée dans le lien. Les personnes disposant du lien peuvent ajouter ou retirer des invités de cette liste.",
    partnerListTitle: "Invités enregistrés",
    partnerListEmpty: "La liste est encore vide pour cette organisation.",
    partnerAddSuccess: "La personne a bien été ajoutée à la liste partenaire.",
    publicAddSuccess: "Votre inscription VIP a bien été enregistrée.",
    addButton: "Enregistrer l'inscription VIP",
    addPartnerButton: "Ajouter à la liste",
    adding: "Enregistrement...",
    addingPartner: "Ajout en cours...",
    deleteButton: "Supprimer",
    loadError: "Impossible de charger la liste partenaire.",
    publicError: "L'inscription VIP n'a pas pu être enregistrée. Merci de réessayer.",
    partnerError: "Impossible d'ajouter cette personne à la liste pour le moment.",
    partnerDeleteError: "Impossible de supprimer cette personne de la liste.",
    partnerPortalEyebrow: "Portail partenaire",
    partnerAddTitle: "Ajouter un invité",
    partnerListEyebrow: "Liste actuelle",
    publicBackLink: "Retour à l'accueil",
    partnerPasswordTitle: "Accès protégé",
    partnerPasswordBody: "Cette page est protégée par un mot de passe communiqué à votre organisation.",
    partnerPasswordLabel: "Mot de passe",
    partnerPasswordAction: "Accéder à la liste",
    partnerPasswordError: "Mot de passe incorrect.",
    partnerContactTitle: "Contact organisation",
  },
  en: {
    publicTitle: "VIP Invitation",
    publicSubtitle:
      "The Luxembourg Athletics Federation is delighted to invite you to the CMCM Luxembourg Indoor Meeting.",
    publicIntroEyebrow: "CMCM Luxembourg Indoor Meeting",
    publicIntroTitle: "We would be delighted to welcome you as one of our VIP guests",
    publicIntroBody:
      "The Luxembourg Athletics Federation is pleased to invite you to the next edition of the CMCM Luxembourg Indoor Meeting, taking place on January 18, 2026 at the Coque.",
    publicIntroBodyTwo:
      "As part of the World Athletics Indoor Tour Silver, this invitation gives you access to dedicated hospitality, practical event information and, depending on your choice, an exclusive visit of the Coque or a behind-the-scenes tour of the meeting.",
    publicIntroBodyThree:
      "Please complete one form per invited guest. If you wish to come with a companion, you can add that person within the same form.",
    highlightOneTitle: "VIP access to the meeting",
    highlightOneBody: "A dedicated welcome on arrival and a smooth experience for your guests.",
    highlightTwoTitle: "Exclusive tour at 2:15 PM",
    highlightTwoBody: "Choose between discovering the Coque or the behind-the-scenes areas of the meeting.",
    highlightThreeTitle: "Hospitality and practical info",
    highlightThreeBody: "Everything you need to make the most of your visit.",
    detailsTitle: "Practical information",
    detailsBody:
      "We look forward to welcoming you for this special moment dedicated to top-level indoor athletics. Please confirm your attendance using the form below.",
    practicalWebsiteLabel: "Website",
    practicalDoors: "Doors open from 2:00 PM",
    practicalTours: "Tours start at 2:15 PM and last around 40 minutes",
    practicalPreprogram: "Pre-programme around 3:00 PM",
    practicalInternational: "International programme at 4:00 PM",
    formTitle: "Attendance confirmation",
    formSubtitle:
      "Fields marked with an asterisk are required. The companion's email remains optional.",
    partnerTitle: "VIP partner portal",
    partnerSubtitle: "Dedicated page to manage your organisation's guest list directly.",
    partnerIntro:
      "This page is reserved for the organisation identified in the link. Anyone with the link can add or remove guests from this list.",
    partnerListTitle: "Registered guests",
    partnerListEmpty: "This organisation's list is still empty.",
    partnerAddSuccess: "The guest has been added to the partner list.",
    publicAddSuccess: "Your VIP registration has been recorded.",
    addButton: "Submit VIP registration",
    addPartnerButton: "Add to the list",
    adding: "Saving...",
    addingPartner: "Adding...",
    deleteButton: "Delete",
    loadError: "Unable to load the partner list.",
    publicError: "The VIP registration could not be saved. Please try again.",
    partnerError: "Unable to add this guest to the list right now.",
    partnerDeleteError: "Unable to remove this guest from the list.",
    partnerPortalEyebrow: "Partner portal",
    partnerAddTitle: "Add a guest",
    partnerListEyebrow: "Current list",
    publicBackLink: "Back to home",
    partnerPasswordTitle: "Protected access",
    partnerPasswordBody: "This page is protected by a password shared with your organisation.",
    partnerPasswordLabel: "Password",
    partnerPasswordAction: "Access the list",
    partnerPasswordError: "Incorrect password.",
    partnerContactTitle: "Organisation contact",
  },
  de: {
    publicTitle: "VIP-Einladung",
    publicSubtitle:
      "Der Luxemburger Leichtathletikverband freut sich, Sie zum CMCM Luxembourg Indoor Meeting einzuladen.",
    publicIntroEyebrow: "CMCM Luxembourg Indoor Meeting",
    publicIntroTitle: "Wir würden uns sehr freuen, Sie als VIP-Gast begrüßen zu dürfen",
    publicIntroBody:
      "Der Luxemburger Leichtathletikverband freut sich, Sie zur nächsten Ausgabe des CMCM Luxembourg Indoor Meeting einzuladen, das am 18. Januar 2026 in der Coque stattfindet.",
    publicIntroBodyTwo:
      "Im Rahmen der World Athletics Indoor Tour Silver bietet Ihnen diese Einladung einen bevorzugten Empfang, praktische Informationen zum Meeting und je nach Auswahl eine exklusive Entdeckung der Coque oder einen Blick hinter die Kulissen der Veranstaltung.",
    publicIntroBodyThree:
      "Bitte füllen Sie pro eingeladener Person ein Formular aus. Wenn Sie mit einer Begleitperson kommen möchten, können Sie diese im selben Formular hinzufügen.",
    highlightOneTitle: "VIP-Zugang zum Meeting",
    highlightOneBody: "Ein reservierter Empfang bei Ihrer Ankunft und ein angenehmer Ablauf für Ihre Gäste.",
    highlightTwoTitle: "Exklusive Führung um 14:15 Uhr",
    highlightTwoBody: "Wählen Sie zwischen einer Entdeckung der Coque oder einem Blick hinter die Kulissen des Meetings.",
    highlightThreeTitle: "Hospitality und praktische Infos",
    highlightThreeBody: "Alle nützlichen Informationen, damit Sie Ihren Besuch voll genießen können.",
    detailsTitle: "Praktische Informationen",
    detailsBody:
      "Wir freuen uns darauf, Sie zu diesem besonderen Moment rund um die Hallen-Leichtathletik auf höchstem Niveau begrüßen zu dürfen. Bitte bestätigen Sie Ihre Teilnahme über das untenstehende Formular.",
    practicalWebsiteLabel: "Website",
    practicalDoors: "Einlass ab 14:00 Uhr",
    practicalTours: "Führungen ab 14:15 Uhr, Dauer etwa 40 Minuten",
    practicalPreprogram: "Vorprogramm gegen 15:00 Uhr",
    practicalInternational: "Internationales Programm ab 16:00 Uhr",
    formTitle: "Teilnahme bestätigen",
    formSubtitle:
      "Felder mit einem Stern sind Pflichtfelder. Die E-Mail der Begleitperson bleibt optional.",
    partnerTitle: "VIP-Partnerportal",
    partnerSubtitle: "Eigene Seite zur direkten Verwaltung der Gästeliste Ihrer Organisation.",
    partnerIntro:
      "Diese Seite ist für die im Link angegebene Organisation reserviert. Jede Person mit dem Link kann Gäste zu dieser Liste hinzufügen oder entfernen.",
    partnerListTitle: "Registrierte Gäste",
    partnerListEmpty: "Die Liste dieser Organisation ist noch leer.",
    partnerAddSuccess: "Die Person wurde zur Partnerliste hinzugefügt.",
    publicAddSuccess: "Ihre VIP-Anmeldung wurde gespeichert.",
    addButton: "VIP-Anmeldung absenden",
    addPartnerButton: "Zur Liste hinzufügen",
    adding: "Wird gespeichert...",
    addingPartner: "Wird hinzugefügt...",
    deleteButton: "Löschen",
    loadError: "Die Partnerliste konnte nicht geladen werden.",
    publicError: "Die VIP-Anmeldung konnte nicht gespeichert werden. Bitte versuchen Sie es erneut.",
    partnerError: "Diese Person konnte derzeit nicht zur Liste hinzugefügt werden.",
    partnerDeleteError: "Diese Person konnte nicht aus der Liste entfernt werden.",
    partnerPortalEyebrow: "Partnerportal",
    partnerAddTitle: "Gast hinzufügen",
    partnerListEyebrow: "Aktuelle Liste",
    publicBackLink: "Zur Startseite",
    partnerPasswordTitle: "Geschützter Zugang",
    partnerPasswordBody: "Diese Seite ist durch ein Passwort geschützt, das Ihrer Organisation mitgeteilt wurde.",
    partnerPasswordLabel: "Passwort",
    partnerPasswordAction: "Zur Liste",
    partnerPasswordError: "Falsches Passwort.",
    partnerContactTitle: "Kontakt Organisation",
  },
};

function VipFormFields({ formData, onChange, organizationLocked = false }) {
  const { language } = useLanguage();
  const copy = VIP_COPY[language] || VIP_COPY.en;

  return (
    <>
      <div className="field-grid">
        <AuthFormField label={language === "fr" ? "Nom" : language === "de" ? "Name" : "Last name"} required>
          <input name="lastName" required value={formData.lastName} onChange={onChange} />
        </AuthFormField>
        <AuthFormField label={language === "fr" ? "Prénom" : language === "de" ? "Vorname" : "First name"} required>
          <input name="firstName" required value={formData.firstName} onChange={onChange} />
        </AuthFormField>
      </div>
      <div className="field-grid">
        <AuthFormField
          label={
            language === "fr"
              ? "Organisation / partenaire"
              : language === "de"
                ? "Organisation / Partner"
                : "Organisation / partner"
          }
          required
        >
          <input
            name="organization"
            readOnly={organizationLocked}
            required
            value={formData.organization}
            onChange={onChange}
          />
        </AuthFormField>
        <AuthFormField label="E-mail" required>
          <input name="email" required type="email" value={formData.email} onChange={onChange} />
        </AuthFormField>
      </div>
      <div className="field-grid">
        <AuthFormField
          label={language === "fr" ? "Téléphone" : language === "de" ? "Telefon" : "Phone"}
          hint={
            language === "fr"
              ? "Facultatif, utile si nous devons vous recontacter rapidement."
              : language === "de"
                ? "Optional, hilfreich, falls wir Sie schnell kontaktieren müssen."
                : "Optional, useful if we need to contact you quickly."
          }
        >
          <PhoneInput name="phone" value={formData.phone} onChange={onChange} />
        </AuthFormField>
        <AuthFormField
          label={
            language === "fr"
              ? "Tour VIP souhaité"
              : language === "de"
                ? "Gewünschte VIP-Führung"
                : "Preferred VIP tour"
          }
          required
        >
          <select name="vipTourChoice" value={formData.vipTourChoice} onChange={onChange}>
            {VIP_TOUR_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </AuthFormField>
      </div>
      <section className="form-section-card">
        <div className="form-section-head">
          <p className="eyebrow">
            {language === "fr" ? "Accompagnant" : language === "de" ? "Begleitperson" : "Companion"}
          </p>
          <h3>
            {language === "fr"
              ? "Invité additionnel dans le même formulaire"
              : language === "de"
                ? "Zusätzlicher Gast im selben Formular"
                : "Additional guest in the same form"}
          </h3>
        </div>
        <div className="field-grid">
          <AuthFormField
            label={
              language === "fr"
                ? "Nom de l'accompagnant"
                : language === "de"
                  ? "Name der Begleitperson"
                  : "Companion last name"
            }
          >
            <input name="guestLastName" value={formData.guestLastName} onChange={onChange} />
          </AuthFormField>
          <AuthFormField
            label={
              language === "fr"
                ? "Prénom de l'accompagnant"
                : language === "de"
                  ? "Vorname der Begleitperson"
                  : "Companion first name"
            }
          >
            <input name="guestFirstName" value={formData.guestFirstName} onChange={onChange} />
          </AuthFormField>
        </div>
        <AuthFormField
          label={
            language === "fr"
              ? "E-mail de l'accompagnant"
              : language === "de"
                ? "E-Mail der Begleitperson"
                : "Companion email"
          }
          hint={copy.formSubtitle}
        >
          <input name="guestEmail" type="email" value={formData.guestEmail} onChange={onChange} />
        </AuthFormField>
      </section>
      <AuthFormField
        label={language === "fr" ? "Remarques utiles" : language === "de" ? "Nützliche Hinweise" : "Useful notes"}
      >
        <textarea
          name="notes"
          rows="3"
          placeholder={
            language === "fr"
              ? "Informations pratiques, contraintes, remarques ou besoins particuliers"
              : language === "de"
                ? "Praktische Hinweise, Einschränkungen, Bemerkungen oder besondere Bedürfnisse"
                : "Practical information, constraints, notes or special requirements"
          }
          value={formData.notes}
          onChange={onChange}
        />
      </AuthFormField>
    </>
  );
}

function VipAccessPage({ loadMailQueueModule }) {
  const { language, t } = useLanguage();
  const copy = VIP_COPY[language] || VIP_COPY.en;
  const [formData, setFormData] = useState(() => createEmptyVipFormData());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  function handleChange(event) {
    const { name, value } = event.target;
    setFormData((current) => ({ ...current, [name]: value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setSuccessMessage("");
    setIsSubmitting(true);

    try {
      const activeEditionId = await getActiveEditionId();
      await addDoc(
        collection(db, "vipPublicRegistrations"),
        buildVipRegistrationPayload(formData, {
          editionId: activeEditionId,
          source: "public_form",
          status: "submitted",
          submittedLanguage: language,
          submittedAt: serverTimestamp(),
        }),
      );

      if (String(formData.email || "").trim()) {
        const { buildVipRegistrationConfirmationMail, enqueueTransactionalMail } = await loadMailQueueModule();
        await enqueueTransactionalMail(
          buildVipRegistrationConfirmationMail({
            email: formData.email,
            firstName: formData.firstName,
            language,
          }),
        );
      }

      setFormData(createEmptyVipFormData());
      setSuccessMessage(copy.publicAddSuccess);
    } catch (submissionError) {
      console.error("VIP registration failed", submissionError);
      setError(copy.publicError);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <AuthLayout title={copy.publicTitle} subtitle={copy.publicSubtitle}>
      <div className="stacked-entry">
        <section className="entry-card vip-entry-card">
          <div className="vip-intro-card">
            <p className="eyebrow">{copy.publicIntroEyebrow}</p>
            <h2>{copy.publicIntroTitle}</h2>
            <p>{copy.publicIntroBody}</p>
            <p>{copy.publicIntroBodyTwo}</p>
            <p>{copy.publicIntroBodyThree}</p>
          </div>
          <div className="vip-highlight-grid">
            <article className="vip-highlight-card">
              <strong>{copy.highlightOneTitle}</strong>
              <p>{copy.highlightOneBody}</p>
            </article>
            <article className="vip-highlight-card">
              <strong>{copy.highlightTwoTitle}</strong>
              <p>{copy.highlightTwoBody}</p>
            </article>
            <article className="vip-highlight-card">
              <strong>{copy.highlightThreeTitle}</strong>
              <p>{copy.highlightThreeBody}</p>
            </article>
          </div>
          <div className="notice-card notice-card--ok">
            <strong>{copy.detailsTitle}</strong>
            <p>{copy.detailsBody}</p>
            <ul className="vip-practical-list">
              <li>{copy.practicalDoors}</li>
              <li>{copy.practicalTours}</li>
              <li>{copy.practicalPreprogram}</li>
              <li>{copy.practicalInternational}</li>
              <li>
                {copy.practicalWebsiteLabel}:{" "}
                <a href="https://www.cmcm-luxembourg-indoor-meeting.lu" target="_blank" rel="noreferrer">
                  www.cmcm-luxembourg-indoor-meeting.lu
                </a>
              </li>
            </ul>
          </div>
        </section>
        <form className="auth-form auth-form--long vip-form-card" onSubmit={handleSubmit}>
          <div>
            <p className="eyebrow">{copy.publicTitle}</p>
            <h2>{copy.formTitle}</h2>
            <p>{copy.formSubtitle}</p>
          </div>
        <VipFormFields formData={formData} onChange={handleChange} />
        {error ? <p className="form-error">{error}</p> : null}
        {successMessage ? <p className="panel-note panel-note--success">{successMessage}</p> : null}
        <p className="panel-note">{getVipRgpdDisclaimer(language)}</p>
        <button className="button button--primary" disabled={isSubmitting} type="submit">
          {isSubmitting ? copy.adding : copy.addButton}
        </button>
        <div className="auth-links">
          <NavLink to="/">{t("returnHome") || copy.publicBackLink}</NavLink>
        </div>
        </form>
      </div>
    </AuthLayout>
  );
}

function getVipPortalUid(portalId) {
  return `vip-portal-${portalId}`;
}

// Textes du portail partenaire (version pratique, novembre 2026).
const PORTAL_COPY = {
  fr: {
    eyebrow: "Portail partenaire VIP",
    intro: "Ajoutez ici vos invités au CMCM Luxembourg Indoor Meeting. La liste est enregistrée au fur et à mesure : vous pouvez revenir la compléter ou la corriger à tout moment avec ce lien.",
    contact: "Votre contact",
    kpiGuests: "Invités",
    kpiCompanions: "Accompagnants",
    kpiTotal: "Places au total",
    addTitle: "Ajouter un invité",
    firstName: "Prénom",
    lastName: "Nom",
    email: "E-mail",
    phone: "Téléphone",
    tour: "Visite 14h15",
    addCompanion: "+ Accompagnant",
    removeCompanion: "Retirer l'accompagnant",
    companionFirstName: "Prénom accompagnant",
    companionLastName: "Nom accompagnant",
    companionEmail: "E-mail accompagnant",
    addNote: "+ Remarque",
    notes: "Remarque",
    notesPlaceholder: "Régime alimentaire, accès PMR, arrivée tardive…",
    submit: "Ajouter",
    adding: "Ajout…",
    added: "{name} a été ajouté(e) à la liste.",
    listTitle: "Vos invités",
    search: "Rechercher un invité…",
    colGuest: "Invité",
    colTour: "Visite 14h15",
    colCompanion: "Accompagnant",
    noCompanion: "—",
    edit: "Modifier",
    save: "Enregistrer",
    cancel: "Annuler",
    remove: "Supprimer",
    confirmRemove: "Retirer {name} de la liste ?",
    empty: "Aucun invité pour le moment. Ajoutez le premier avec le formulaire ci-dessus.",
    noMatch: "Aucun invité ne correspond à la recherche.",
    loading: "Chargement de la liste…",
    checking: "Vérification de l'accès…",
    tourShort: { coque: "14h15 · La Coque", coulisses: "14h15 · Les coulisses", none: "Pas de visite" },
  },
  en: {
    eyebrow: "VIP partner portal",
    intro: "Add your guests to the CMCM Luxembourg Indoor Meeting here. The list is saved as you go: come back with this link at any time to complete or correct it.",
    contact: "Your contact",
    kpiGuests: "Guests",
    kpiCompanions: "Companions",
    kpiTotal: "Total seats",
    addTitle: "Add a guest",
    firstName: "First name",
    lastName: "Last name",
    email: "E-mail",
    phone: "Phone",
    tour: "2:15 pm tour",
    addCompanion: "+ Companion",
    removeCompanion: "Remove companion",
    companionFirstName: "Companion first name",
    companionLastName: "Companion last name",
    companionEmail: "Companion e-mail",
    addNote: "+ Note",
    notes: "Note",
    notesPlaceholder: "Dietary needs, reduced mobility, late arrival…",
    submit: "Add",
    adding: "Adding…",
    added: "{name} has been added to the list.",
    listTitle: "Your guests",
    search: "Search a guest…",
    colGuest: "Guest",
    colTour: "2:15 pm tour",
    colCompanion: "Companion",
    noCompanion: "—",
    edit: "Edit",
    save: "Save",
    cancel: "Cancel",
    remove: "Remove",
    confirmRemove: "Remove {name} from the list?",
    empty: "No guests yet. Add the first one with the form above.",
    noMatch: "No guest matches your search.",
    loading: "Loading the list…",
    checking: "Checking access…",
    tourShort: { coque: "2:15 pm · The Coque", coulisses: "2:15 pm · Behind the scenes", none: "No tour" },
  },
  de: {
    eyebrow: "VIP-Partnerportal",
    intro: "Tragen Sie hier Ihre Gäste für das CMCM Luxembourg Indoor Meeting ein. Die Liste wird laufend gespeichert: Mit diesem Link können Sie sie jederzeit ergänzen oder korrigieren.",
    contact: "Ihr Kontakt",
    kpiGuests: "Gäste",
    kpiCompanions: "Begleitpersonen",
    kpiTotal: "Plätze insgesamt",
    addTitle: "Gast hinzufügen",
    firstName: "Vorname",
    lastName: "Name",
    email: "E-Mail",
    phone: "Telefon",
    tour: "Führung 14:15",
    addCompanion: "+ Begleitperson",
    removeCompanion: "Begleitperson entfernen",
    companionFirstName: "Vorname Begleitperson",
    companionLastName: "Name Begleitperson",
    companionEmail: "E-Mail Begleitperson",
    addNote: "+ Hinweis",
    notes: "Hinweis",
    notesPlaceholder: "Ernährung, Barrierefreiheit, spätere Ankunft…",
    submit: "Hinzufügen",
    adding: "Wird hinzugefügt…",
    added: "{name} wurde zur Liste hinzugefügt.",
    listTitle: "Ihre Gäste",
    search: "Gast suchen…",
    colGuest: "Gast",
    colTour: "Führung 14:15",
    colCompanion: "Begleitperson",
    noCompanion: "—",
    edit: "Bearbeiten",
    save: "Speichern",
    cancel: "Abbrechen",
    remove: "Entfernen",
    confirmRemove: "{name} von der Liste entfernen?",
    empty: "Noch keine Gäste. Fügen Sie den ersten mit dem Formular oben hinzu.",
    noMatch: "Kein Gast entspricht der Suche.",
    loading: "Liste wird geladen…",
    checking: "Zugriff wird überprüft…",
    tourShort: { coque: "14:15 · Die Coque", coulisses: "14:15 · Hinter den Kulissen", none: "Keine Führung" },
  },
};

const fullName = (first, last) => `${first || ""} ${last || ""}`.trim();

function VipPartnerPortalPage() {
  const { language } = useLanguage();
  const copy = VIP_COPY[language] || VIP_COPY.en;
  const { portalId = "" } = useParams();
  const fallbackPortalLabel = useMemo(() => getVipPartnerPortalLabel(portalId), [portalId]);
  const [formData, setFormData] = useState(() => createEmptyVipFormData({ organization: fallbackPortalLabel }));
  const [portalMeta, setPortalMeta] = useState(null);
  const [portalMetaLoading, setPortalMetaLoading] = useState(true);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [passwordInput, setPasswordInput] = useState("");
  const [accessGranted, setAccessGranted] = useState(false);
  const [verifyingAccess, setVerifyingAccess] = useState(false);
  const p = PORTAL_COPY[language] || PORTAL_COPY.en;
  const [showCompanion, setShowCompanion] = useState(false);
  const [showNote, setShowNote] = useState(false);
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState("");
  const [editDraft, setEditDraft] = useState(null);
  const firstNameRef = useRef(null);

  const portalLabel = String(portalMeta?.organizationName || "").trim() || fallbackPortalLabel;
  const requiresPassword = Boolean(portalMeta?.hasPassword);

  useEffect(() => {
    setFormData(createEmptyVipFormData({ organization: portalLabel }));
  }, [portalLabel]);

  useEffect(() => {
    if (!portalId) return undefined;

    // Any already-authenticated session (a real platform login, or this browser's
    // pseudo-session for this or another portal) is treated as already resolved:
    // we never call signInWithCustomToken here, since that would silently replace
    // a real login. Firestore rules are the actual gatekeeper (admins pass via
    // isAdminOrManager(), everyone else via the matching vipPortalId claim) -- a
    // mismatch simply surfaces as a permission error from the entries listener below.
    const unsubscribeAuth = auth.onAuthStateChanged((user) => {
      setAccessGranted(Boolean(user));
    });

    return unsubscribeAuth;
  }, [portalId]);

  useEffect(() => {
    if (!portalId) {
      setPortalMeta(null);
      setPortalMetaLoading(false);
      return undefined;
    }

    const unsubscribeMeta = onSnapshot(
      doc(db, "vipPartnerPortals", portalId),
      (snapshot) => {
        setPortalMeta(snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null);
        setPortalMetaLoading(false);
      },
      (snapshotError) => {
        console.error("VIP partner portal meta load failed", snapshotError);
        setPortalMeta(null);
        setPortalMetaLoading(false);
      },
    );

    return unsubscribeMeta;
  }, [portalId]);

  async function requestPortalAccess(password) {
    setError("");
    setVerifyingAccess(true);

    try {
      const verifyPortalAccess = httpsCallable(functions, "verifyVipPortalAccess");
      const response = await verifyPortalAccess({ portalId, password });
      const token = response?.data?.token;
      if (!token) throw new Error("missing-token");

      await signInWithCustomToken(auth, token);
      return true;
    } catch (accessError) {
      console.error("VIP portal access verification failed", accessError);

      if (accessError?.code === "functions/permission-denied") {
        setError(copy.partnerPasswordError);
      } else {
        setError(
          language === "fr"
            ? "Le service de vérification est momentanément indisponible. Merci de réessayer dans un instant."
            : language === "de"
              ? "Der Überprüfungsdienst ist derzeit nicht verfügbar. Bitte versuchen Sie es gleich noch einmal."
              : "The verification service is temporarily unavailable. Please try again in a moment.",
        );
      }

      return false;
    } finally {
      setVerifyingAccess(false);
    }
  }

  useEffect(() => {
    if (portalMetaLoading || !portalId || accessGranted || requiresPassword) return;
    // Never mint/sign in a portal session if this browser already has any Firebase
    // session (real login or another portal's pseudo-session) -- see the comment
    // on the auth-state effect above.
    if (auth.currentUser) return;
    requestPortalAccess("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [portalMetaLoading, portalId, accessGranted, requiresPassword]);

  useEffect(() => {
    if (!accessGranted || !portalId) {
      setEntries([]);
      setLoading(accessGranted === false && requiresPassword);
      return undefined;
    }

    setLoading(true);
    const unsubscribe = onSnapshot(
      collection(db, "vipPartnerPortals", portalId, "entries"),
      (snapshot) => {
        const nextEntries = snapshot.docs
          .map((entry) => ({ id: entry.id, ...entry.data() }))
          .sort((left, right) => {
            const leftMs = left?.createdAt?.toMillis?.() || 0;
            const rightMs = right?.createdAt?.toMillis?.() || 0;
            return rightMs - leftMs;
          });
        setEntries(nextEntries);
        setLoading(false);
        setError("");
      },
      (snapshotError) => {
        console.error("VIP partner portal load failed", snapshotError);
        setEntries([]);
        setLoading(false);
        setError(copy.loadError);
      },
    );

    return unsubscribe;
  }, [accessGranted, portalId, requiresPassword]);

  function handleChange(event) {
    const { name, value } = event.target;
    setFormData((current) => ({ ...current, [name]: value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setSuccessMessage("");
    setIsSubmitting(true);

    try {
      const activeEditionId = await getActiveEditionId();
      await addDoc(
        collection(db, "vipPartnerPortals", portalId, "entries"),
        buildVipRegistrationPayload(formData, {
          editionId: activeEditionId,
          portalId,
          source: "partner_portal",
          createdAt: serverTimestamp(),
        }),
      );
      const addedName = fullName(formData.firstName, formData.lastName);
      // On garde le choix de visite pour enchaîner les saisies d'un même groupe.
      setFormData(createEmptyVipFormData({ organization: portalLabel, vipTourChoice: formData.vipTourChoice }));
      setShowCompanion(false);
      setShowNote(false);
      setSuccessMessage(p.added.replace("{name}", addedName));
      firstNameRef.current?.focus();
    } catch (submissionError) {
      console.error("VIP partner portal submission failed", submissionError);
      setError(copy.partnerError);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleEntryUpdate(entryId, patch) {
    setError("");
    try {
      await updateDoc(doc(db, "vipPartnerPortals", portalId, "entries", entryId), { ...patch, updatedAt: serverTimestamp() });
      return true;
    } catch (updateError) {
      console.error("VIP partner portal update failed", updateError);
      setError(copy.partnerError);
      return false;
    }
  }

  function startEdit(entry) {
    setEditingId(entry.id);
    setEditDraft({
      firstName: entry.firstName || "",
      lastName: entry.lastName || "",
      email: entry.email || "",
      phone: entry.phone || "",
      guestFirstName: entry.guestFirstName || "",
      guestLastName: entry.guestLastName || "",
      guestEmail: entry.guestEmail || "",
      notes: entry.notes || "",
    });
  }

  async function saveEdit(event) {
    event.preventDefault();
    const trimmed = Object.fromEntries(Object.entries(editDraft).map(([key, value]) => [key, String(value || "").trim()]));
    trimmed.email = trimmed.email.toLowerCase();
    trimmed.guestEmail = trimmed.guestEmail.toLowerCase();
    if (await handleEntryUpdate(editingId, trimmed)) {
      setEditingId("");
      setEditDraft(null);
    }
  }

  async function handleDelete(entryId) {
    const entry = entries.find((item) => item.id === entryId);
    if (!window.confirm(p.confirmRemove.replace("{name}", fullName(entry?.firstName, entry?.lastName) || "?"))) return;
    setError("");
    setSuccessMessage("");

    try {
      await deleteDoc(doc(db, "vipPartnerPortals", portalId, "entries", entryId));
    } catch (deleteError) {
      console.error("VIP partner portal deletion failed", deleteError);
      setError(copy.partnerDeleteError);
    }
  }

  async function handlePasswordSubmit(event) {
    event.preventDefault();
    const granted = await requestPortalAccess(passwordInput);
    if (granted) {
      setPasswordInput("");
    }
  }

  const companionCount = entries.filter((entry) => fullName(entry.guestFirstName, entry.guestLastName)).length;
  const tourCounts = VIP_TOUR_OPTIONS.filter((option) => option.value !== "none").map((option) => ({
    value: option.value,
    count:
      entries.filter((entry) => entry.vipTourChoice === option.value).length +
      entries.filter((entry) => entry.vipTourChoice === option.value && fullName(entry.guestFirstName, entry.guestLastName)).length,
  }));
  const query = search.trim().toLowerCase();
  const visibleEntries = query
    ? entries.filter((entry) =>
        [entry.firstName, entry.lastName, entry.email, entry.guestFirstName, entry.guestLastName]
          .join(" ")
          .toLowerCase()
          .includes(query),
      )
    : entries;
  const hasContact = portalMeta?.contactName || portalMeta?.contactEmail || portalMeta?.contactPhone;
  const tourLabel = (value) => p.tourShort[value || "none"] || p.tourShort.none;
  const editChange = (event) => setEditDraft((current) => ({ ...current, [event.target.name]: event.target.value }));

  return (
    <AuthLayout title={p.eyebrow} subtitle="CMCM Luxembourg Indoor Meeting">
      <div className="vip-portal">
        <section className="vip-portal-head">
          <div className="vip-portal-head__main">
            <h2>{portalLabel}</h2>
            <p>{p.intro}</p>
          </div>
          {hasContact ? (
            <div className="vip-portal-contact">
              <span className="vip-portal-eyebrow">{p.contact}</span>
              {portalMeta?.contactName ? <strong>{portalMeta.contactName}</strong> : null}
              {portalMeta?.contactEmail ? <a href={`mailto:${portalMeta.contactEmail}`}>{portalMeta.contactEmail}</a> : null}
              {portalMeta?.contactPhone ? <a href={`tel:${portalMeta.contactPhone.replace(/\s+/g, "")}`}>{portalMeta.contactPhone}</a> : null}
            </div>
          ) : null}
        </section>

        {requiresPassword && !accessGranted ? (
          <section className="vip-portal-card vip-portal-card--narrow">
            <h3>{copy.partnerPasswordTitle}</h3>
            <p className="vip-portal-muted">{copy.partnerPasswordBody}</p>
            <form className="vip-portal-password" onSubmit={handlePasswordSubmit}>
              <input
                aria-label={copy.partnerPasswordLabel}
                placeholder={copy.partnerPasswordLabel}
                name="portalPassword"
                required
                type="password"
                value={passwordInput}
                onChange={(event) => setPasswordInput(event.target.value)}
              />
              <button className="vip-portal-btn vip-portal-btn--primary" disabled={verifyingAccess} type="submit">
                {verifyingAccess ? "…" : copy.partnerPasswordAction}
              </button>
            </form>
            {error ? <p className="form-error">{error}</p> : null}
          </section>
        ) : null}

        {!requiresPassword && !accessGranted && !portalMetaLoading ? (
          <section className="vip-portal-card vip-portal-card--narrow">
            {error ? <p className="form-error">{error}</p> : <p className="vip-portal-muted">{p.checking}</p>}
          </section>
        ) : null}

        {accessGranted ? (
          <>
            <dl className="vip-portal-kpis">
              <div><dt>{p.kpiGuests}</dt><dd>{entries.length}</dd></div>
              <div><dt>{p.kpiCompanions}</dt><dd>{companionCount}</dd></div>
              <div className="is-strong"><dt>{p.kpiTotal}</dt><dd>{entries.length + companionCount}</dd></div>
              {tourCounts.map((tour) => (
                <div key={tour.value}><dt>{tourLabel(tour.value)}</dt><dd>{tour.count}</dd></div>
              ))}
            </dl>

            <section className="vip-portal-card">
              <h3>{p.addTitle}</h3>
              <form className="vip-portal-form" onSubmit={handleSubmit}>
                <div className="vip-portal-grid">
                  <label className="vip-portal-field">
                    <span>{p.firstName} *</span>
                    <input ref={firstNameRef} name="firstName" required autoComplete="off" value={formData.firstName} onChange={handleChange} />
                  </label>
                  <label className="vip-portal-field">
                    <span>{p.lastName} *</span>
                    <input name="lastName" required autoComplete="off" value={formData.lastName} onChange={handleChange} />
                  </label>
                  <label className="vip-portal-field">
                    <span>{p.email} *</span>
                    <input name="email" required type="email" autoComplete="off" value={formData.email} onChange={handleChange} />
                  </label>
                  <label className="vip-portal-field">
                    <span>{p.tour}</span>
                    <select name="vipTourChoice" value={formData.vipTourChoice} onChange={handleChange}>
                      {VIP_TOUR_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value} title={option.label}>{tourLabel(option.value)}</option>
                      ))}
                    </select>
                  </label>
                  <label className="vip-portal-field">
                    <span>{p.phone}</span>
                    <input name="phone" type="tel" autoComplete="off" value={formData.phone} onChange={handleChange} />
                  </label>
                </div>

                {showCompanion ? (
                  <div className="vip-portal-grid vip-portal-grid--sub">
                    <label className="vip-portal-field">
                      <span>{p.companionFirstName}</span>
                      <input name="guestFirstName" autoComplete="off" value={formData.guestFirstName} onChange={handleChange} />
                    </label>
                    <label className="vip-portal-field">
                      <span>{p.companionLastName}</span>
                      <input name="guestLastName" autoComplete="off" value={formData.guestLastName} onChange={handleChange} />
                    </label>
                    <label className="vip-portal-field">
                      <span>{p.companionEmail}</span>
                      <input name="guestEmail" type="email" autoComplete="off" value={formData.guestEmail} onChange={handleChange} />
                    </label>
                  </div>
                ) : null}
                {showNote ? (
                  <label className="vip-portal-field vip-portal-field--wide">
                    <span>{p.notes}</span>
                    <input name="notes" placeholder={p.notesPlaceholder} value={formData.notes} onChange={handleChange} />
                  </label>
                ) : null}

                <div className="vip-portal-form__bar">
                  <button
                    type="button"
                    className="vip-portal-link"
                    onClick={() => {
                      if (showCompanion) setFormData((current) => ({ ...current, guestFirstName: "", guestLastName: "", guestEmail: "" }));
                      setShowCompanion(!showCompanion);
                    }}
                  >
                    {showCompanion ? p.removeCompanion : p.addCompanion}
                  </button>
                  {showNote ? null : (
                    <button type="button" className="vip-portal-link" onClick={() => setShowNote(true)}>{p.addNote}</button>
                  )}
                  <button className="vip-portal-btn vip-portal-btn--primary" disabled={isSubmitting} type="submit">
                    {isSubmitting ? p.adding : p.submit}
                  </button>
                </div>
                {error ? <p className="form-error">{error}</p> : null}
                {successMessage ? <p className="vip-portal-success" role="status">✓ {successMessage}</p> : null}
                <p className="vip-portal-legal">{getVipRgpdDisclaimer(language)}</p>
              </form>
            </section>

            <section className="vip-portal-card">
              <div className="vip-portal-card__head">
                <h3>{p.listTitle} <span className="vip-portal-count">{entries.length}</span></h3>
                {entries.length > 6 ? (
                  <input
                    type="search"
                    className="vip-portal-search"
                    placeholder={p.search}
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                ) : null}
              </div>
              {loading ? (
                <p className="vip-portal-muted">{p.loading}</p>
              ) : entries.length === 0 ? (
                <p className="vip-portal-empty">{p.empty}</p>
              ) : visibleEntries.length === 0 ? (
                <p className="vip-portal-empty">{p.noMatch}</p>
              ) : (
                <div className="vip-portal-table-wrap">
                  <table className="vip-portal-table">
                    <thead>
                      <tr>
                        <th>{p.colGuest}</th>
                        <th>{p.colTour}</th>
                        <th>{p.colCompanion}</th>
                        <th aria-label="Actions" />
                      </tr>
                    </thead>
                    <tbody>
                      {visibleEntries.map((entry) =>
                        editingId === entry.id && editDraft ? (
                          <tr key={entry.id} className="is-editing">
                            <td colSpan={4}>
                              <form className="vip-portal-edit" onSubmit={saveEdit}>
                                <div className="vip-portal-grid">
                                  <label className="vip-portal-field"><span>{p.firstName} *</span><input name="firstName" required value={editDraft.firstName} onChange={editChange} /></label>
                                  <label className="vip-portal-field"><span>{p.lastName} *</span><input name="lastName" required value={editDraft.lastName} onChange={editChange} /></label>
                                  <label className="vip-portal-field"><span>{p.email} *</span><input name="email" type="email" required value={editDraft.email} onChange={editChange} /></label>
                                  <label className="vip-portal-field"><span>{p.phone}</span><input name="phone" type="tel" value={editDraft.phone} onChange={editChange} /></label>
                                  <label className="vip-portal-field"><span>{p.companionFirstName}</span><input name="guestFirstName" value={editDraft.guestFirstName} onChange={editChange} /></label>
                                  <label className="vip-portal-field"><span>{p.companionLastName}</span><input name="guestLastName" value={editDraft.guestLastName} onChange={editChange} /></label>
                                  <label className="vip-portal-field"><span>{p.companionEmail}</span><input name="guestEmail" type="email" value={editDraft.guestEmail} onChange={editChange} /></label>
                                  <label className="vip-portal-field"><span>{p.notes}</span><input name="notes" value={editDraft.notes} onChange={editChange} /></label>
                                </div>
                                <div className="vip-portal-form__bar">
                                  <button type="button" className="vip-portal-btn" onClick={() => { setEditingId(""); setEditDraft(null); }}>{p.cancel}</button>
                                  <button type="submit" className="vip-portal-btn vip-portal-btn--primary">{p.save}</button>
                                </div>
                              </form>
                            </td>
                          </tr>
                        ) : (
                          <tr key={entry.id}>
                            <td>
                              <strong>{fullName(entry.firstName, entry.lastName) || "—"}</strong>
                              <span className="vip-portal-sub" title={entry.email || ""}>{entry.email || "—"}</span>
                              {entry.notes ? <span className="vip-portal-sub vip-portal-sub--note" title={entry.notes}>“{entry.notes}”</span> : null}
                            </td>
                            <td>
                              <select
                                aria-label={p.colTour}
                                value={entry.vipTourChoice || "none"}
                                onChange={(event) => handleEntryUpdate(entry.id, { vipTourChoice: event.target.value })}
                              >
                                {VIP_TOUR_OPTIONS.map((option) => (
                                  <option key={option.value} value={option.value}>{tourLabel(option.value)}</option>
                                ))}
                              </select>
                            </td>
                            <td>{fullName(entry.guestFirstName, entry.guestLastName) || <span className="vip-portal-muted">{p.noCompanion}</span>}</td>
                            <td className="vip-portal-actions">
                              <button type="button" className="vip-portal-btn vip-portal-btn--small" onClick={() => startEdit(entry)}>{p.edit}</button>
                              <button type="button" className="vip-portal-btn vip-portal-btn--small vip-portal-btn--danger" onClick={() => handleDelete(entry.id)}>{p.remove}</button>
                            </td>
                          </tr>
                        ),
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        ) : null}
      </div>
    </AuthLayout>
  );
}

export { VipAccessPage, VipPartnerPortalPage };
