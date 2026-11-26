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
import { NavLink, useLocation, useParams } from "react-router-dom";
import { auth, db, functions } from "../services/firebase";
import { getActiveEditionId, useActiveEdition } from "./edition";
import { useMeetingEditions } from "./meeting-history-hooks";
import { AuthFormField, AuthLayout, PhoneInput } from "./form-components";
import { useLanguage } from "./language-context";
import portalPhoto from "../assets/site-gallery/ambiance-1.jpg";
import businessRacePhoto from "../assets/site-gallery/preprog-business-1.jpg";
import { BoxToggle, BusinessRaceBillingSection, BusinessRaceSteps, BusinessRaceTeamsSection, BusinessRaceWelcome } from "./business-race-portal";
import { useCollapsedState } from "./collapsible-state";
import { getBusinessRaceCopy } from "./business-race-copy";
import { RUNNER_VIP_SOURCE, isBusinessRacePortal } from "./business-race-helpers";
import {
  VIP_TOUR_OPTIONS,
  buildVipFullName,
  buildVipRegistrationPayload,
  computeVipPortalPlaces,
  computeVipMissingPlaces,
  vipEntryHasCompanion,
  vipPortalAllowsCompanions,
  createEmptyVipFormData,
  getVipEntryPlaceType,
  getVipPartnerPortalLabel,
  createEmptyVipPortalContact,
  getVipPortalContacts,
  getVipPortalMeetingContact,
  getVipPortalPlaceTypes,
  getVipPortalCaps,
  normalizeVipPortalContacts,
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
    introEvent:
      "Le CMCM Luxembourg Indoor Meeting est le grand rendez-vous de l'athlétisme en salle au Luxembourg : une après-midi de compétition avec des athlètes internationaux de haut niveau, étape du circuit World Athletics Indoor Tour Silver.",
    introInvite: "En tant que partenaire, vous pouvez y inviter les personnes de votre choix. Deux types de places existent :",
    offerVip: "accueil réservé, espace VIP et, au choix, visite exclusive à 14h15 de la Coque ou des coulisses du meeting.",
    offerStandard: "entrée au meeting en tribune, sans les prestations VIP ni la visite.",
    introHow:
      "Ajoutez vos invités un par un ci-dessous (le prénom et le nom suffisent, l'e-mail est facultatif). La liste est enregistrée au fur et à mesure : revenez la compléter ou la corriger quand vous voulez avec ce même lien. Besoin de plus de places ? Faites-en la demande en bas du formulaire.",
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
    contacts: "Vos contacts",
    meetingContact: "Votre contact au meeting",
    orgContacts: "Vos personnes de contact",
    editContacts: "Modifier",
    addContacts: "+ Ajouter vos contacts",
    addContact: "+ Ajouter une personne",
    contactsIntro: "Les personnes de votre organisation que l'équipe du meeting peut joindre au sujet de cette liste.",
    contactsRequired: "Indiquez au moins une personne (prénom ou nom).",
    contactsError: "Impossible d'enregistrer les contacts pour le moment.",
    placeType: "Type de place",
    placeVip: "VIP",
    placeStandard: "Normale",
    kpiPlacesVip: "Invitations VIP",
    kpiPlacesStandard: "Invitations normales",
    kpiPlacesVipPeople: "Places VIP",
    kpiPlacesStandardPeople: "Places normales",
    peopleNote: "personnes, +1 compris",
    colPlace: "Place",
    unlimited: "sans limite",
    onRequest: "sur demande",
    tourVipOnly: "Visite réservée aux places VIP",
    typeNotOffered: "Votre organisation n'a pas encore de places {type}. Vous pouvez en demander : l'équipe du meeting vous répond rapidement.",
    typeInText: { vip: "VIP", standard: "normales" },
    remaining: "{n} restante(s)",
    quotaReached: "Votre quota d'invitations {type} est atteint ({used} / {cap}). Pour ajouter d'autres invités, demandez des places supplémentaires.",
    companionUnnamed: "+1 (nom non communiqué)",
    companionHint: "Les badges VIP étant nominatifs, merci d'indiquer autant que possible le prénom et le nom de l'accompagnant. S'il n'est pas encore connu, laissez vide : vous pourrez le compléter plus tard.",
    withCompanion: "Avec accompagnant",
    introCompanion: "Chaque invitation donne droit à 1 accompagnant. Les badges VIP étant nominatifs, merci d'indiquer autant que possible son prénom et son nom.",
    introCompanionIncluded: "Chaque invité peut venir avec 1 accompagnant, qui compte dans vos places : un invité avec accompagnant prend 2 places. Les badges VIP étant nominatifs, merci d'indiquer autant que possible son prénom et son nom.",
    quotaReachedPeople: "Plus assez de places {type} ({used} / {cap} personnes, accompagnants compris ; un invité avec accompagnant prend 2 places). Pour ajouter d'autres invités, demandez des places supplémentaires.",
    seatsNote: "{n} pers. avec accompagnants",
    requestPlaces: "Demander des places supplémentaires",
    requestTitle: "Demande de places supplémentaires",
    requestIntro: "Votre demande est envoyée à l'équipe du meeting, et son statut s'affiche sur cette page. Une fois acceptée, les places s'ajoutent automatiquement à votre quota.",
    requestCount: "Nombre de places",
    requestFirstName: "Votre prénom",
    requestLastName: "Votre nom",
    requestEmail: "Votre e-mail",
    requestMessage: "Message (facultatif)",
    requestSend: "Envoyer la demande",
    requestSending: "Envoi…",
    requestSent: "Votre demande a bien été envoyée.",
    requestError: "Impossible d'envoyer la demande pour le moment.",
    requestsTitle: "Vos demandes",
    requestStatus: { pending: "En attente", accepted: "Acceptée", refused: "Refusée" },
  },
  en: {
    eyebrow: "VIP partner portal",
    introEvent:
      "The CMCM Luxembourg Indoor Meeting is Luxembourg's major indoor athletics event: an afternoon of competition with top international athletes, part of the World Athletics Indoor Tour Silver.",
    introInvite: "As a partner, you can invite the people of your choice. There are two types of places:",
    offerVip: "dedicated welcome, VIP area and, if they wish, an exclusive 2:15 pm tour of the Coque or behind the scenes of the meeting.",
    offerStandard: "entry to the meeting in the stands, without the VIP services or the tour.",
    introHow:
      "Add your guests one by one below (first and last name are enough, the e-mail is optional). The list is saved as you go: come back with this same link to complete or correct it at any time. Need more places? Request them at the bottom of the form.",
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
    contacts: "Your contacts",
    meetingContact: "Your contact at the meeting",
    orgContacts: "Your contact persons",
    editContacts: "Edit",
    addContacts: "+ Add your contacts",
    addContact: "+ Add a person",
    contactsIntro: "The people in your organisation the meeting team can reach about this list.",
    contactsRequired: "Enter at least one person (first or last name).",
    contactsError: "Unable to save the contacts right now.",
    placeType: "Place type",
    placeVip: "VIP",
    placeStandard: "Standard",
    kpiPlacesVip: "VIP invitations",
    kpiPlacesStandard: "Standard invitations",
    kpiPlacesVipPeople: "VIP places",
    kpiPlacesStandardPeople: "Standard places",
    peopleNote: "people, +1 included",
    colPlace: "Place",
    unlimited: "no limit",
    onRequest: "on request",
    tourVipOnly: "Tour reserved for VIP places",
    typeInText: { vip: "VIP", standard: "standard" },
    typeNotOffered: "No {type} places are planned for your organisation yet. You can request some: the meeting team will get back to you quickly.",
    remaining: "{n} left",
    quotaReached: "Your {type} invitation quota is reached ({used} / {cap}). To add more guests, request extra places.",
    companionUnnamed: "+1 (name not given)",
    companionHint: "VIP badges are personal: please give the companion's first and last name whenever possible. If not known yet, leave it empty and complete it later.",
    withCompanion: "With a companion",
    introCompanion: "Each invitation includes 1 companion. VIP badges are personal, so please give their first and last name whenever possible.",
    introCompanionIncluded: "Each guest may bring 1 companion, who counts towards your places: a guest with a companion takes 2 places. VIP badges are personal, so please give their first and last name whenever possible.",
    quotaReachedPeople: "Not enough {type} places left ({used} / {cap} people, companions included; a guest with a companion takes 2 places). To add more guests, request extra places.",
    seatsNote: "{n} people with companions",
    requestPlaces: "Request extra places",
    requestTitle: "Request for extra places",
    requestIntro: "Your request is sent to the meeting team, and its status shows on this page. Once accepted, the places are added to your quota automatically.",
    requestCount: "Number of places",
    requestFirstName: "Your first name",
    requestLastName: "Your last name",
    requestEmail: "Your e-mail",
    requestMessage: "Message (optional)",
    requestSend: "Send the request",
    requestSending: "Sending…",
    requestSent: "Your request has been sent.",
    requestError: "Unable to send the request right now.",
    requestsTitle: "Your requests",
    requestStatus: { pending: "Pending", accepted: "Accepted", refused: "Refused" },
  },
  de: {
    eyebrow: "VIP-Partnerportal",
    introEvent:
      "Das CMCM Luxembourg Indoor Meeting ist das große Hallenleichtathletik-Event in Luxemburg: ein Nachmittag Spitzensport mit internationalen Athletinnen und Athleten, Etappe der World Athletics Indoor Tour Silver.",
    introInvite: "Als Partner können Sie Personen Ihrer Wahl einladen. Es gibt zwei Arten von Plätzen:",
    offerVip: "eigener Empfang, VIP-Bereich und auf Wunsch eine exklusive Führung um 14:15 durch die Coque oder hinter die Kulissen des Meetings.",
    offerStandard: "Eintritt zum Meeting auf der Tribüne, ohne VIP-Leistungen und ohne Führung.",
    introHow:
      "Tragen Sie Ihre Gäste unten einzeln ein (Vor- und Nachname genügen, die E-Mail ist optional). Die Liste wird laufend gespeichert: Mit demselben Link können Sie sie jederzeit ergänzen oder korrigieren. Mehr Plätze nötig? Fragen Sie sie unten im Formular an.",
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
    contacts: "Ihre Kontakte",
    meetingContact: "Ihr Kontakt beim Meeting",
    orgContacts: "Ihre Ansprechpersonen",
    editContacts: "Bearbeiten",
    addContacts: "+ Ansprechpersonen hinzufügen",
    addContact: "+ Person hinzufügen",
    contactsIntro: "Die Personen Ihrer Organisation, die das Meeting-Team zu dieser Liste erreichen kann.",
    contactsRequired: "Geben Sie mindestens eine Person an (Vor- oder Nachname).",
    contactsError: "Die Kontakte konnten derzeit nicht gespeichert werden.",
    placeType: "Platzart",
    placeVip: "VIP",
    placeStandard: "Normal",
    kpiPlacesVip: "VIP-Einladungen",
    kpiPlacesStandard: "Normale Einladungen",
    kpiPlacesVipPeople: "VIP-Plätze",
    kpiPlacesStandardPeople: "Normale Plätze",
    peopleNote: "Personen, inkl. Begleitung",
    colPlace: "Platz",
    unlimited: "ohne Limit",
    onRequest: "auf Anfrage",
    tourVipOnly: "Führung nur für VIP-Plätze",
    typeInText: { vip: "VIP-", standard: "normalen " },
    typeNotOffered: "Für Ihre Organisation sind derzeit keine {type}Plätze vorgesehen. Sie können welche anfragen: Das Meeting-Team meldet sich schnell bei Ihnen.",
    remaining: "{n} übrig",
    quotaReached: "Ihr Kontingent an {type}Einladungen ist erreicht ({used} / {cap}). Um weitere Gäste einzutragen, fragen Sie zusätzliche Plätze an.",
    companionUnnamed: "+1 (Name nicht angegeben)",
    companionHint: "VIP-Badges sind personalisiert: Bitte geben Sie nach Möglichkeit Vor- und Nachnamen der Begleitperson an. Ist er noch nicht bekannt, leer lassen und später ergänzen.",
    withCompanion: "Mit Begleitperson",
    introCompanion: "Jede Einladung gilt für 1 Begleitperson. Da die VIP-Badges personalisiert sind, geben Sie bitte nach Möglichkeit Vor- und Nachnamen an.",
    introCompanionIncluded: "Jeder Gast kann 1 Begleitperson mitbringen, die auf Ihre Plätze angerechnet wird: Ein Gast mit Begleitung belegt 2 Plätze. Da die VIP-Badges personalisiert sind, geben Sie bitte nach Möglichkeit Vor- und Nachnamen an.",
    quotaReachedPeople: "Nicht mehr genug {type}Plätze frei ({used} / {cap} Personen inkl. Begleitung; ein Gast mit Begleitung belegt 2 Plätze). Um weitere Gäste einzutragen, fragen Sie zusätzliche Plätze an.",
    seatsNote: "{n} Pers. mit Begleitung",
    requestPlaces: "Zusätzliche Plätze anfragen",
    requestTitle: "Anfrage für zusätzliche Plätze",
    requestIntro: "Ihre Anfrage geht an das Meeting-Team, der Status wird auf dieser Seite angezeigt. Nach der Annahme werden die Plätze automatisch Ihrem Kontingent hinzugefügt.",
    requestCount: "Anzahl Plätze",
    requestFirstName: "Ihr Vorname",
    requestLastName: "Ihr Name",
    requestEmail: "Ihre E-Mail",
    requestMessage: "Nachricht (optional)",
    requestSend: "Anfrage senden",
    requestSending: "Wird gesendet…",
    requestSent: "Ihre Anfrage wurde gesendet.",
    requestError: "Die Anfrage konnte derzeit nicht gesendet werden.",
    requestsTitle: "Ihre Anfragen",
    requestStatus: { pending: "Ausstehend", accepted: "Angenommen", refused: "Abgelehnt" },
  },
};

const fullName = (first, last) => `${first || ""} ${last || ""}`.trim();

const DEMO_PORTAL = {
  meta: {
    id: "demo",
    organizationName: "Organisation démo",
    vipPlacesCap: 6,
    standardPlacesCap: 10,
    companionsAllowed: true,    contacts: [
      { firstName: "Fred", lastName: "Muller", email: "fred.muller@example.lu", phone: "+352 621 000 000" },
      { firstName: "Anne", lastName: "Weber", email: "anne.weber@example.lu", phone: "" },
    ],
  },
  entries: [
    { id: "d1", firstName: "Paul", lastName: "Schmit", email: "paul@example.lu", vipTourChoice: "coque", guestFirstName: "Lea", guestLastName: "Schmit", placeType: "vip" },
    { id: "d2", firstName: "Claire", lastName: "Hoffmann", email: "claire@example.lu", vipTourChoice: "coulisses", placeType: "vip", hasCompanion: true },
    { id: "d3", firstName: "Marc", lastName: "Kieffer", email: "marc@example.lu", vipTourChoice: "none", placeType: "standard" },
    { id: "d4", firstName: "Sophie", lastName: "Reuter", email: "sophie@example.lu", vipTourChoice: "none", guestFirstName: "Tom", guestLastName: "Reuter", placeType: "standard" },
  ],
  requests: [],
};

function VipPartnerPortalPage() {
  const { language } = useLanguage();
  const copy = VIP_COPY[language] || VIP_COPY.en;
  const { portalId = "" } = useParams();
  const location = useLocation();
  const isDemoPortal = import.meta.env.DEV && portalId === "demo";
  // Démo Business Race : /business-race/demo (npm run dev).
  const isBusinessRaceDemo = isDemoPortal && location.pathname.startsWith("/business-race/");
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
  const [placeType, setPlaceType] = useState("vip");
  const [placeRequests, setPlaceRequests] = useState([]);
  const [showRequestForm, setShowRequestForm] = useState(false);
  const [requestForm, setRequestForm] = useState({ placeType: "vip", requestedPlaces: "1", firstName: "", lastName: "", email: "", message: "" });
  const [requestSubmitting, setRequestSubmitting] = useState(false);
  const [requestFeedback, setRequestFeedback] = useState("");
  const [contactsDraft, setContactsDraft] = useState(null);
  const [contactsSaving, setContactsSaving] = useState(false);
  const [contactsError, setContactsError] = useState("");
  const firstNameRef = useRef(null);
  const requestFormRef = useRef(null);

  const portalLabel = String(portalMeta?.organizationName || "").trim() || fallbackPortalLabel;
  const requiresPassword = Boolean(portalMeta?.hasPassword);
  const placeTypes = useMemo(() => getVipPortalPlaceTypes(portalMeta || {}), [portalMeta]);
  const places = useMemo(() => computeVipPortalPlaces(portalMeta || {}, entries), [portalMeta, entries]);
  const placeTypeLabel = (type) => (type === "standard" ? p.placeStandard : p.placeVip);
  const companionsAllowed = vipPortalAllowsCompanions(portalMeta || {});
  const placeTypesKey = placeTypes.join("|");
  const { activeEditionId } = useActiveEdition();
  const { editions } = useMeetingEditions();
  const edition = editions.find((entry) => String(entry.year || entry.id) === String(activeEditionId)) || null;

  // Type proposé par défaut : le premier disponible (l'organisation peut
  // choisir l'autre, même sans quota, pour en faire la demande).
  useEffect(() => {
    setPlaceType(placeTypesKey.split("|")[0] || "vip");
  }, [placeTypesKey]);

  // Aperçu local (npm run dev, /vip/orga/demo) : portail fictif avec places
  // VIP et normales, rien n'est lu ni écrit dans Firestore.
  useEffect(() => {
    if (!isDemoPortal) return;
    setPortalMeta(
      isBusinessRaceDemo
        ? { ...DEMO_PORTAL.meta, organizationName: "Entreprise démo", vipPartner: true, vipPlacesCap: 6, standardPlacesCap: 2, businessRace: true, businessRaceTeams: 2, businessRaceVipCap: 4, businessRaceStandardCap: 8, companionsAllowed: false }
        : DEMO_PORTAL.meta,
    );
    setPortalMetaLoading(false);
    setEntries(DEMO_PORTAL.entries);
    setPlaceRequests(DEMO_PORTAL.requests);
    setLoading(false);
    setAccessGranted(true);
  }, [isDemoPortal, isBusinessRaceDemo]);

  useEffect(() => {
    setFormData(createEmptyVipFormData({ organization: portalLabel }));
  }, [portalLabel]);

  useEffect(() => {
    if (!portalId || isDemoPortal) return undefined;

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
    if (isDemoPortal) return undefined;
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
  }, [portalId, isDemoPortal]);

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
    if (isDemoPortal || portalMetaLoading || !portalId || accessGranted || requiresPassword) return;
    // Never mint/sign in a portal session if this browser already has any Firebase
    // session (real login or another portal's pseudo-session) -- see the comment
    // on the auth-state effect above.
    if (auth.currentUser) return;
    requestPortalAccess("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [portalMetaLoading, portalId, accessGranted, requiresPassword]);

  useEffect(() => {
    if (isDemoPortal) return undefined;
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
  }, [accessGranted, portalId, requiresPassword, isDemoPortal]);

  useEffect(() => {
    if (isDemoPortal) return undefined;
    if (!accessGranted || !portalId) {
      setPlaceRequests([]);
      return undefined;
    }
    return onSnapshot(
      collection(db, "vipPartnerPortals", portalId, "placeRequests"),
      (snapshot) => {
        setPlaceRequests(
          snapshot.docs
            .map((entry) => ({ id: entry.id, ...entry.data() }))
            .sort((left, right) => (right.createdAt?.toMillis?.() || 0) - (left.createdAt?.toMillis?.() || 0)),
        );
      },
      (snapshotError) => {
        console.error("VIP place requests load failed", snapshotError);
        setPlaceRequests([]);
      },
    );
  }, [accessGranted, portalId, isDemoPortal]);

  // Places manquantes pour ajouter une fiche d'un type donné (0 quand elle tient
  // dans le quota). Le quota compte les invitations, ou les personnes quand les +1
  // y sont compris. `excludeId` : fiche modifiée, déjà comptée.
  function missingPlaces(type, entry, excludeId = "") {
    return computeVipMissingPlaces(portalMeta || {}, entries, type, entry, excludeId);
  }

  function quotaReachedText(type) {
    const template = places.unit === "people" ? p.quotaReachedPeople : p.quotaReached;
    return template.replace("{type}", p.typeInText[type]).replace("{used}", places.used[type]).replace("{cap}", places.caps[type]);
  }

  function openRequestForm(type, count) {
    setRequestFeedback("");
    setRequestForm((current) => ({ ...current, placeType: type, requestedPlaces: String(Math.max(1, count || 1)) }));
    setShowRequestForm(true);
    // Fenêtre au premier plan : on place le curseur sur le nombre de places.
    window.setTimeout(() => requestFormRef.current?.querySelector('input[type="number"]')?.focus(), 0);
  }

  function quotaMessage(type, entry, excludeId) {
    const missing = missingPlaces(type, entry, excludeId);
    if (!missing) return "";
    const typeName = p.typeInText[type];
    if (!placeTypes.includes(type)) return p.typeNotOffered.replace("{type}", typeName);
    return quotaReachedText(type);
  }

  async function handleRequestSubmit(event) {
    event.preventDefault();
    setRequestFeedback("");
    setRequestSubmitting(true);
    try {
      const activeEditionId = isDemoPortal ? "demo" : await getActiveEditionId();
      const writeRequest = isDemoPortal
        ? async (data) => setPlaceRequests((current) => [{ ...data, id: `r${Date.now()}`, createdAt: null }, ...current])
        : (data) => addDoc(collection(db, "vipPartnerPortals", portalId, "placeRequests"), data);
      await writeRequest({
        editionId: activeEditionId,
        portalId,
        organization: portalLabel,
        placeType: requestForm.placeType === "standard" ? "standard" : "vip",
        requestedPlaces: Math.max(1, Math.floor(Number(requestForm.requestedPlaces) || 1)),
        firstName: requestForm.firstName.trim(),
        lastName: requestForm.lastName.trim(),
        email: requestForm.email.trim().toLowerCase(),
        message: requestForm.message.trim(),
        status: "pending",
        createdAt: serverTimestamp(),
      });
      setRequestForm((current) => ({ ...current, requestedPlaces: "1", message: "" }));
      setShowRequestForm(false);
      setRequestFeedback(p.requestSent);
    } catch (requestError) {
      console.error("VIP place request failed", requestError);
      setRequestFeedback(p.requestError);
    } finally {
      setRequestSubmitting(false);
    }
  }

  function handleChange(event) {
    const { name, value } = event.target;
    setFormData((current) => ({ ...current, [name]: value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setSuccessMessage("");
    // Visite de 14h15 réservée aux places VIP.
    const guestData = placeType === "vip" ? formData : { ...formData, vipTourChoice: "none" };
    const missing = missingPlaces(placeType, formData);
    if (missing) {
      setError(quotaMessage(placeType, formData));
      openRequestForm(placeType, missing);
      return;
    }
    setIsSubmitting(true);

    try {
      if (isDemoPortal) {
        setEntries((current) => [
          { id: `d${Date.now()}`, ...buildVipRegistrationPayload(guestData, { placeType }) },
          ...current,
        ]);
      } else {
        const activeEditionId = await getActiveEditionId();
        await addDoc(
          collection(db, "vipPartnerPortals", portalId, "entries"),
          buildVipRegistrationPayload(guestData, {
            editionId: activeEditionId,
            portalId,
            placeType,
            source: "partner_portal",
            createdAt: serverTimestamp(),
          }),
        );
      }
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
    if (isDemoPortal) {
      setEntries((current) => current.map((entry) => (entry.id === entryId ? { ...entry, ...patch } : entry)));
      return true;
    }
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
      hasCompanion: vipEntryHasCompanion(entry),
    });
  }

  async function saveEdit(event) {
    event.preventDefault();
    const { hasCompanion, ...textFields } = editDraft;
    const trimmed = Object.fromEntries(Object.entries(textFields).map(([key, value]) => [key, String(value || "").trim()]));
    trimmed.email = trimmed.email.toLowerCase();
    trimmed.guestEmail = trimmed.guestEmail.toLowerCase();
    // Décocher l'accompagnant efface aussi son nom.
    trimmed.hasCompanion = Boolean(hasCompanion) && companionsAllowed;
    if (!trimmed.hasCompanion) Object.assign(trimmed, { guestFirstName: "", guestLastName: "", guestEmail: "" });
    const editedEntry = entries.find((item) => item.id === editingId);
    const editedType = getVipEntryPlaceType(editedEntry);
    const missing = missingPlaces(editedType, trimmed, editingId);
    if (missing) {
      setError(quotaMessage(editedType, trimmed, editingId));
      openRequestForm(editedType, missing);
      return;
    }
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
    if (isDemoPortal) {
      setEntries((current) => current.filter((item) => item.id !== entryId));
      return;
    }

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

  const companionCount = entries.filter((entry) => vipEntryHasCompanion(entry)).length;
  const vipEntries = entries.filter((entry) => getVipEntryPlaceType(entry) === "vip");
  const tourCounts = VIP_TOUR_OPTIONS.filter((option) => option.value !== "none").map((option) => ({
    value: option.value,
    count:
      vipEntries.filter((entry) => entry.vipTourChoice === option.value).length +
      vipEntries.filter((entry) => entry.vipTourChoice === option.value && vipEntryHasCompanion(entry)).length,
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
  const portalContacts = getVipPortalContacts(portalMeta || {});
  const meetingContact = getVipPortalMeetingContact(portalMeta || {});

  function startContactsEdit() {
    setContactsError("");
    setContactsDraft(portalContacts.length ? portalContacts : [createEmptyVipPortalContact()]);
  }

  function changeContact(index, event) {
    const { name, value } = event.target;
    setContactsDraft((current) => current.map((contact, itemIndex) => (itemIndex === index ? { ...contact, [name]: value } : contact)));
  }

  // L'organisation met à jour ses propres personnes de contact (les règles
  // Firestore ne lui laissent modifier que ces champs-là du portail).
  async function saveContacts(event) {
    event.preventDefault();
    const contacts = normalizeVipPortalContacts(contactsDraft).slice(0, 10);
    if (!contacts.some((contact) => contact.firstName || contact.lastName)) {
      setContactsError(p.contactsRequired);
      return;
    }
    if (isDemoPortal) {
      setPortalMeta((current) => ({ ...current, contacts }));
      setContactsDraft(null);
      return;
    }
    setContactsSaving(true);
    setContactsError("");
    try {
      const mainContact = contacts[0];
      await updateDoc(doc(db, "vipPartnerPortals", portalId), {
        contacts,
        contactName: buildVipFullName(mainContact),
        contactEmail: mainContact.email,
        contactPhone: mainContact.phone,
        updatedAt: serverTimestamp(),
      });
      setContactsDraft(null);
    } catch (saveError) {
      console.error("VIP portal contacts update failed", saveError);
      setContactsError(p.contactsError);
    } finally {
      setContactsSaving(false);
    }
  }
  const showPlaceColumn = placeTypes.length > 1 || entries.some((entry) => getVipEntryPlaceType(entry) === "standard");
  const selectedTypeFull = places.caps[placeType] !== null && places.remaining[placeType] === 0;
  const selectedTypeOffered = placeTypes.includes(placeType);
  const eventDate = edition?.date?.toDate?.() || (edition?.date ? new Date(edition.date) : null);
  const eventDateLabel =
    eventDate && !Number.isNaN(eventDate.getTime())
      ? eventDate.toLocaleDateString(language === "fr" ? "fr-LU" : language === "de" ? "de-LU" : "en-GB", {
          weekday: "long",
          day: "numeric",
          month: "long",
          year: "numeric",
        })
      : "";
  const venueLabel = edition?.venue || "Coque, Luxembourg";
  const tourLabel = (value) => p.tourShort[value || "none"] || p.tourShort.none;
  const editChange = (event) => setEditDraft((current) => ({ ...current, [event.target.name]: event.target.value }));
  // Entreprise de la Business Race : accueil dédié et équipes de relais avant les invités.
  const isBusinessRace = isBusinessRacePortal(portalMeta || {});
  // Grandes cases repliables (accordéon), mémorisées par portail dans ce navigateur.
  const [collapsedBoxes, toggleBox] = useCollapsedState(`portal-collapsed-${portalId}`);
  // Partenariat VIP + Business Race sur le même portail : places cumulées.
  const portalCaps = getVipPortalCaps(portalMeta || {});
  // Session de l'organisation (vrai compte, pas la session technique du portail) :
  // peut encore modifier les équipes après la date limite.
  const isStaffSession = Boolean(auth.currentUser) && !String(auth.currentUser.uid).startsWith("vip-portal-");
  const businessCopy = getBusinessRaceCopy(language);
  const offerList = (
    <ul className="vip-portal-offer">
      <li><strong>{p.placeVip}</strong> — {p.offerVip}</li>
      <li><strong>{p.placeStandard}</strong> — {p.offerStandard}</li>
    </ul>
  );

  return (
    <AuthLayout title={isBusinessRace ? businessCopy.eyebrow : p.eyebrow} subtitle="CMCM Luxembourg Indoor Meeting">
      <div className="vip-portal">
        <img className="vip-portal-photo" src={isBusinessRace ? businessRacePhoto : portalPhoto} alt="" loading="lazy" />
        <section className="vip-portal-head">
          <div className="vip-portal-head__main">
            <h2>{portalLabel}</h2>
            {isBusinessRace && portalCaps.hasVip ? (
              <p className="vip-portal-modules">
                <span className="vip-portal-module vip-portal-module--vip">★ {businessCopy.modVip}</span>
                <span className="vip-portal-module vip-portal-module--race">🏃 {businessCopy.modRace}</span>
              </p>
            ) : null}
            <p className="vip-portal-facts">
              {[eventDateLabel, venueLabel, "World Athletics Indoor Tour Silver"].filter(Boolean).join(" · ")}
            </p>
            {isBusinessRace ? (
              <BusinessRaceWelcome language={language} portal={portalMeta} />
            ) : (
              <>
                <p>{p.introEvent}</p>
                <p>{p.introInvite}</p>
                {offerList}
                {companionsAllowed ? <p>{places.unit === "people" ? p.introCompanionIncluded : p.introCompanion}</p> : null}
                <p>{p.introHow}</p>
              </>
            )}
          </div>
          {portalMeta ? (
            <div className="vip-portal-contact">
              <span className="vip-portal-eyebrow">{p.meetingContact}</span>
              <div className="vip-portal-contact__person">
                {buildVipFullName(meetingContact) ? <strong>{buildVipFullName(meetingContact)}</strong> : null}
                {meetingContact.email ? <a href={`mailto:${meetingContact.email}`}>{meetingContact.email}</a> : null}
                {meetingContact.phone ? (
                  <a href={`tel:${meetingContact.phone.replace(/\s+/g, "")}`}>{meetingContact.phone}</a>
                ) : null}
              </div>
            </div>
          ) : null}
          {portalContacts.length || accessGranted ? (
            <div className="vip-portal-contact">
              <span className="vip-portal-eyebrow">{p.orgContacts}</span>
              {portalContacts.map((contact, index) => (
                <div className="vip-portal-contact__person" key={index}>
                  {buildVipFullName(contact) ? <strong>{buildVipFullName(contact)}</strong> : null}
                  {contact.email ? <span>{contact.email}</span> : null}
                  {contact.phone ? <span>{contact.phone}</span> : null}
                </div>
              ))}
              {accessGranted && !contactsDraft ? (
                <button type="button" className="vip-portal-link vip-portal-contact__edit" onClick={startContactsEdit}>
                  {portalContacts.length ? p.editContacts : p.addContacts}
                </button>
              ) : null}
            </div>
          ) : null}
        </section>

        {isBusinessRace ? (
          <BusinessRaceSteps language={language} offer={offerList} portal={portalMeta} collapsed={Boolean(collapsedBoxes.steps)} onToggle={() => toggleBox("steps")} />
        ) : null}

        {accessGranted && contactsDraft ? (
          <section className="vip-portal-card">
            <h3>{p.orgContacts}</h3>
            <form className="vip-portal-form" onSubmit={saveContacts}>
              <p className="vip-portal-muted">{p.contactsIntro}</p>
              {contactsDraft.map((contact, index) => (
                <div className="vip-portal-grid vip-portal-contacts-row" key={index}>
                  <label className="vip-portal-field">
                    <span>{p.firstName}{index === 0 ? " *" : ""}</span>
                    <input name="firstName" required={index === 0} value={contact.firstName} onChange={(event) => changeContact(index, event)} />
                  </label>
                  <label className="vip-portal-field">
                    <span>{p.lastName}</span>
                    <input name="lastName" value={contact.lastName} onChange={(event) => changeContact(index, event)} />
                  </label>
                  <label className="vip-portal-field">
                    <span>{p.email}</span>
                    <input name="email" type="email" value={contact.email} onChange={(event) => changeContact(index, event)} />
                  </label>
                  <label className="vip-portal-field">
                    <span>{p.phone}</span>
                    <input name="phone" type="tel" value={contact.phone} onChange={(event) => changeContact(index, event)} />
                  </label>
                  <button
                    type="button"
                    className="vip-portal-btn vip-portal-btn--small vip-portal-btn--danger"
                    aria-label={p.remove}
                    title={p.remove}
                    onClick={() => setContactsDraft((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                  >
                    ×
                  </button>
                </div>
              ))}
              <div className="vip-portal-form__bar">
                <button
                  type="button"
                  className="vip-portal-link"
                  onClick={() => setContactsDraft((current) => [...current, createEmptyVipPortalContact()])}
                >
                  {p.addContact}
                </button>
                <button type="button" className="vip-portal-btn" onClick={() => setContactsDraft(null)}>{p.cancel}</button>
                <button type="submit" className="vip-portal-btn vip-portal-btn--primary" disabled={contactsSaving}>{p.save}</button>
              </div>
              {contactsError ? <p className="form-error">{contactsError}</p> : null}
            </form>
          </section>
        ) : null}

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
            {isBusinessRace ? (
              <>
                <BusinessRaceTeamsSection
                  language={language}
                  portalId={portalId}
                  portal={portalMeta}
                  organization={portalLabel}
                  entries={entries}
                  isStaff={isStaffSession}
                  onDemoEntries={(teamNumber, runnerEntries) =>
                    setEntries((current) => [
                      ...runnerEntries,
                      ...current.filter((entry) => !String(entry.id).startsWith(`br-runner-${teamNumber}-`)),
                    ])
                  }
                  isDemo={isDemoPortal}
                  collapsed={Boolean(collapsedBoxes.teams)}
                  onToggle={() => toggleBox("teams")}
                />
                <BusinessRaceBillingSection
                  language={language}
                  portalId={portalId}
                  isDemo={isDemoPortal}
                  collapsed={Boolean(collapsedBoxes.billing)}
                  onToggle={() => toggleBox("billing")}
                />
                <h2 className="vip-portal-section-title">{businessCopy.guestsTitle}</h2>
              </>
            ) : null}
            <dl className="vip-portal-kpis">
              <div><dt>{p.kpiGuests}</dt><dd>{entries.length}</dd></div>
              <div><dt>{p.kpiCompanions}</dt><dd>{companionCount}</dd></div>
              {["vip", "standard"].map((type) => (
                <div
                  key={type}
                  className={`is-strong${places.caps[type] !== null && places.remaining[type] === 0 ? " is-full" : ""}`}
                >
                  <dt>
                    {places.unit === "people"
                      ? type === "standard" ? p.kpiPlacesStandardPeople : p.kpiPlacesVipPeople
                      : type === "standard" ? p.kpiPlacesStandard : p.kpiPlacesVip}
                  </dt>
                  <dd>
                    {places.used[type]}
                    <small> / {places.caps[type] === null ? p.unlimited : places.caps[type]}</small>
                  </dd>
                  <span className="vip-portal-kpis__note">
                    {places.caps[type] === null
                      ? p.unlimited
                      : places.caps[type] === 0 && !places.used[type]
                        ? p.onRequest
                        : p.remaining.replace("{n}", places.remaining[type])}
                  </span>
                  {portalCaps.hasVip && portalCaps.hasBusinessRace ? (
                    <span className="vip-portal-kpis__note">
                      {businessCopy.capsSplit
                        .replace("{a}", portalCaps.partner[type] === null ? p.unlimited : portalCaps.partner[type])
                        .replace("{b}", portalCaps.businessRace[type])}
                    </span>
                  ) : null}
                  {places.unit === "people" && places.caps[type] !== 0 ? (
                    <span className="vip-portal-kpis__note">{p.peopleNote}</span>
                  ) : null}
                  {companionsAllowed && places.seats[type] > places.used[type] ? (
                    <span className="vip-portal-kpis__note">{p.seatsNote.replace("{n}", places.seats[type])}</span>
                  ) : null}
                </div>
              ))}
              {tourCounts.map((tour) => (
                <div key={tour.value}><dt>{tourLabel(tour.value)}</dt><dd>{tour.count}</dd></div>
              ))}
            </dl>

            <section className={`vip-portal-card${collapsedBoxes.add ? " is-collapsed" : ""}`}>
              <BoxToggle open={!collapsedBoxes.add} onToggle={() => toggleBox("add")} label={businessCopy.toggleBox} title={p.addTitle} />
              <div className="br-box-body" hidden={Boolean(collapsedBoxes.add)}>
              {selectedTypeFull ? (
                <div className="vip-portal-quota">
                  <p>
                    {selectedTypeOffered
                      ? quotaReachedText(placeType)
                      : p.typeNotOffered.replace("{type}", p.typeInText[placeType])}
                  </p>
                  <button type="button" className="vip-portal-btn vip-portal-btn--primary" onClick={() => openRequestForm(placeType, 1)}>
                    {p.requestPlaces}
                  </button>
                </div>
              ) : null}
              <form className="vip-portal-form" onSubmit={handleSubmit}>
                  <div className="vip-portal-placetype" role="radiogroup" aria-label={p.placeType}>
                    <span>{p.placeType}</span>
                    {["vip", "standard"].map((type) => (
                      <label key={type} className={`vip-portal-placetype__option${placeType === type ? " is-active" : ""}`}>
                        <input
                          type="radio"
                          name="placeType"
                          value={type}
                          checked={placeType === type}
                          onChange={() => setPlaceType(type)}
                        />
                        {placeTypeLabel(type)}
                        <small>
                          {places.caps[type] === null
                            ? p.unlimited
                            : !placeTypes.includes(type)
                              ? p.onRequest
                              : p.remaining.replace("{n}", places.remaining[type])}
                        </small>
                      </label>
                    ))}
                  </div>
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
                    <span>{p.email}</span>
                    <input name="email" type="email" autoComplete="off" value={formData.email} onChange={handleChange} />
                  </label>
                  <label className="vip-portal-field">
                    <span>{p.phone}</span>
                    <input name="phone" type="tel" autoComplete="off" value={formData.phone} onChange={handleChange} />
                  </label>
                  {placeType === "vip" ? (
                  <label className="vip-portal-field">
                    <span>{p.tour}</span>
                    <select name="vipTourChoice" value={formData.vipTourChoice} onChange={handleChange}>
                      {VIP_TOUR_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value} title={option.label}>{tourLabel(option.value)}</option>
                      ))}
                    </select>
                  </label>
                  ) : null}
                </div>

                {showCompanion ? (
                  <div className="vip-portal-grid vip-portal-grid--sub">
                    <p className="vip-portal-sub-hint">{p.companionHint}</p>
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
                  {companionsAllowed ? (
                    <button
                      type="button"
                      className="vip-portal-link"
                      onClick={() => {
                        setFormData((current) =>
                          showCompanion
                            ? { ...current, hasCompanion: false, guestFirstName: "", guestLastName: "", guestEmail: "" }
                            : { ...current, hasCompanion: true },
                        );
                        setShowCompanion(!showCompanion);
                      }}
                    >
                      {showCompanion ? p.removeCompanion : p.addCompanion}
                    </button>
                  ) : null}
                  {showNote ? null : (
                    <button type="button" className="vip-portal-link" onClick={() => setShowNote(true)}>{p.addNote}</button>
                  )}
                  {!selectedTypeFull ? (
                    <button type="button" className="vip-portal-link" onClick={() => openRequestForm(placeType, 1)}>
                      {p.requestPlaces}
                    </button>
                  ) : null}
                  <button className="vip-portal-btn vip-portal-btn--primary" disabled={isSubmitting || selectedTypeFull} type="submit">
                    {isSubmitting ? p.adding : p.submit}
                  </button>
                </div>
                {error ? <p className="form-error">{error}</p> : null}
                {successMessage ? <p className="vip-portal-success" role="status">✓ {successMessage}</p> : null}
                <p className="vip-portal-legal">{getVipRgpdDisclaimer(language)}</p>
              </form>
              </div>
            </section>

            {showRequestForm ? (
              <div
                className="vip-portal-modal"
                role="presentation"
                onMouseDown={(event) => {
                  if (event.target === event.currentTarget) setShowRequestForm(false);
                }}
              >
                <section
                  className="vip-portal-card vip-portal-modal__card"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="vip-request-title"
                  ref={requestFormRef}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") setShowRequestForm(false);
                  }}
                >
                  <div className="vip-portal-modal__head">
                    <h3 id="vip-request-title">{p.requestTitle}</h3>
                    <button type="button" className="vip-portal-modal__close" aria-label={p.cancel} onClick={() => setShowRequestForm(false)}>×</button>
                  </div>
                  <form className="vip-portal-form" onSubmit={handleRequestSubmit}>
                    <p className="vip-portal-muted">{p.requestIntro}</p>
                    <div className="vip-portal-grid vip-portal-grid--two">
                        <label className="vip-portal-field">
                          <span>{p.placeType}</span>
                          <select
                            value={requestForm.placeType}
                            onChange={(event) => setRequestForm((current) => ({ ...current, placeType: event.target.value }))}
                          >
                            {["vip", "standard"].map((type) => (
                              <option key={type} value={type}>{placeTypeLabel(type)}</option>
                            ))}
                          </select>
                        </label>
                      <label className="vip-portal-field">
                        <span>{p.requestCount} *</span>
                        <input
                          type="number"
                          min="1"
                          step="1"
                          required
                          value={requestForm.requestedPlaces}
                          onChange={(event) => setRequestForm((current) => ({ ...current, requestedPlaces: event.target.value }))}
                        />
                      </label>
                    </div>
                    <div className="vip-portal-grid vip-portal-grid--three">
                      <label className="vip-portal-field">
                        <span>{p.requestFirstName} *</span>
                        <input
                          required
                          value={requestForm.firstName}
                          onChange={(event) => setRequestForm((current) => ({ ...current, firstName: event.target.value }))}
                        />
                      </label>
                      <label className="vip-portal-field">
                        <span>{p.requestLastName} *</span>
                        <input
                          required
                          value={requestForm.lastName}
                          onChange={(event) => setRequestForm((current) => ({ ...current, lastName: event.target.value }))}
                        />
                      </label>
                      <label className="vip-portal-field">
                        <span>{p.requestEmail} *</span>
                        <input
                          type="email"
                          required
                          value={requestForm.email}
                          onChange={(event) => setRequestForm((current) => ({ ...current, email: event.target.value }))}
                        />
                      </label>
                    </div>
                    <label className="vip-portal-field vip-portal-field--wide">
                      <span>{p.requestMessage}</span>
                      <input
                        value={requestForm.message}
                        onChange={(event) => setRequestForm((current) => ({ ...current, message: event.target.value }))}
                      />
                    </label>
                    <div className="vip-portal-form__bar">
                      <button type="button" className="vip-portal-btn" onClick={() => setShowRequestForm(false)}>{p.cancel}</button>
                      <button type="submit" className="vip-portal-btn vip-portal-btn--primary" disabled={requestSubmitting}>
                        {requestSubmitting ? p.requestSending : p.requestSend}
                      </button>
                    </div>
                  </form>
                </section>
              </div>
            ) : null}

            {placeRequests.length || requestFeedback ? (
              <section className="vip-portal-card">
                <h3>{p.requestsTitle}</h3>
                {requestFeedback ? <p className="vip-portal-success" role="status">{requestFeedback}</p> : null}
                {placeRequests.length ? (
                  <ul className="vip-portal-requests">
                    {placeRequests.map((request) => (
                      <li key={request.id}>
                        <span>
                          +{request.requestedPlaces} {placeTypeLabel(request.placeType)}
                          {request.createdAt?.toDate ? ` · ${request.createdAt.toDate().toLocaleDateString(language)}` : ""}
                        </span>
                        <span className={`vip-portal-status vip-portal-status--${request.status || "pending"}`}>
                          {p.requestStatus[request.status || "pending"] || p.requestStatus.pending}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </section>
            ) : null}

            <section className={`vip-portal-card${collapsedBoxes.list ? " is-collapsed" : ""}`}>
              <BoxToggle
                open={!collapsedBoxes.list}
                onToggle={() => toggleBox("list")}
                label={businessCopy.toggleBox}
                title={<>{p.listTitle} <span className="vip-portal-count">{entries.length}</span></>}
              >
                {entries.length > 6 && !collapsedBoxes.list ? (
                  <input
                    type="search"
                    className="vip-portal-search"
                    placeholder={p.search}
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                ) : null}
              </BoxToggle>
              <div className="br-box-body" hidden={Boolean(collapsedBoxes.list)}>
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
                        {showPlaceColumn ? <th>{p.colPlace}</th> : null}
                        <th>{p.colTour}</th>
                        <th>{p.colCompanion}</th>
                        <th aria-label="Actions" />
                      </tr>
                    </thead>
                    <tbody>
                      {visibleEntries.map((entry) =>
                        editingId === entry.id && editDraft ? (
                          <tr key={entry.id} className="is-editing">
                            <td colSpan={showPlaceColumn ? 5 : 4}>
                              <form className="vip-portal-edit" onSubmit={saveEdit}>
                                <div className="vip-portal-grid">
                                  <label className="vip-portal-field"><span>{p.firstName} *</span><input name="firstName" required value={editDraft.firstName} onChange={editChange} /></label>
                                  <label className="vip-portal-field"><span>{p.lastName} *</span><input name="lastName" required value={editDraft.lastName} onChange={editChange} /></label>
                                  <label className="vip-portal-field"><span>{p.email}</span><input name="email" type="email" value={editDraft.email} onChange={editChange} /></label>
                                  <label className="vip-portal-field"><span>{p.phone}</span><input name="phone" type="tel" value={editDraft.phone} onChange={editChange} /></label>
                                  {companionsAllowed ? (
                                    <label className="vip-portal-check">
                                      <input
                                        type="checkbox"
                                        checked={Boolean(editDraft.hasCompanion)}
                                        onChange={(event) => setEditDraft((current) => ({ ...current, hasCompanion: event.target.checked }))}
                                      />
                                      {p.withCompanion}
                                    </label>
                                  ) : null}
                                  {companionsAllowed && editDraft.hasCompanion ? (
                                    <>
                                      <p className="vip-portal-sub-hint">{p.companionHint}</p>
                                      <label className="vip-portal-field"><span>{p.companionFirstName}</span><input name="guestFirstName" value={editDraft.guestFirstName} onChange={editChange} /></label>
                                      <label className="vip-portal-field"><span>{p.companionLastName}</span><input name="guestLastName" value={editDraft.guestLastName} onChange={editChange} /></label>
                                      <label className="vip-portal-field"><span>{p.companionEmail}</span><input name="guestEmail" type="email" value={editDraft.guestEmail} onChange={editChange} /></label>
                                    </>
                                  ) : null}
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
                            {showPlaceColumn ? (
                              <td>
                                <span className={`vip-portal-place vip-portal-place--${getVipEntryPlaceType(entry)}`}>
                                  {placeTypeLabel(getVipEntryPlaceType(entry))}
                                </span>
                              </td>
                            ) : null}
                            <td>
                            {getVipEntryPlaceType(entry) === "vip" ? (
                              <select
                                aria-label={p.colTour}
                                value={entry.vipTourChoice || "none"}
                                onChange={(event) => handleEntryUpdate(entry.id, { vipTourChoice: event.target.value })}
                              >
                                {VIP_TOUR_OPTIONS.map((option) => (
                                  <option key={option.value} value={option.value}>{tourLabel(option.value)}</option>
                                ))}
                              </select>
                            ) : (
                              <span className="vip-portal-muted" title={p.tourVipOnly}>—</span>
                            )}
                            </td>
                            <td>{fullName(entry.guestFirstName, entry.guestLastName) || (entry.hasCompanion ? <span className="vip-portal-muted">{p.companionUnnamed}</span> : <span className="vip-portal-muted">{p.noCompanion}</span>)}</td>
                            <td className="vip-portal-actions">
                              {entry.source === RUNNER_VIP_SOURCE ? (
                                <span className="vip-portal-muted" title={businessCopy.runnerManaged}>{businessCopy.runnerTag}</span>
                              ) : (
                                <>
                                  <button type="button" className="vip-portal-btn vip-portal-btn--small" onClick={() => startEdit(entry)}>{p.edit}</button>
                                  <button type="button" className="vip-portal-btn vip-portal-btn--small vip-portal-btn--danger" onClick={() => handleDelete(entry.id)}>{p.remove}</button>
                                </>
                              )}
                            </td>
                          </tr>
                        ),
                      )}
                    </tbody>
                  </table>
                </div>
              )}
              </div>
            </section>
          </>
        ) : null}
      </div>
    </AuthLayout>
  );
}

export { VipAccessPage, VipPartnerPortalPage };
