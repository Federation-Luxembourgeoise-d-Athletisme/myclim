import { useEffect, useMemo, useState } from "react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
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
  getVipTourChoiceLabel,
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
      setFormData(createEmptyVipFormData({ organization: portalLabel }));
      setSuccessMessage(copy.partnerAddSuccess);
    } catch (submissionError) {
      console.error("VIP partner portal submission failed", submissionError);
      setError(copy.partnerError);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDelete(entryId) {
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

  return (
    <AuthLayout
      title={`${copy.partnerTitle} - ${portalLabel}`}
      subtitle={copy.partnerSubtitle}
    >
      <div className="stacked-entry">
        <section className="entry-card">
          <div className="vip-intro-card vip-intro-card--compact">
            <p className="eyebrow">{copy.partnerPortalEyebrow}</p>
            <h2>{portalLabel}</h2>
            <p>{copy.partnerIntro}</p>
            {portalMeta?.contactName || portalMeta?.contactEmail || portalMeta?.contactPhone ? (
              <div className="vip-partner-contact">
                <strong>{copy.partnerContactTitle}</strong>
                {portalMeta?.contactName ? <span>{portalMeta.contactName}</span> : null}
                {portalMeta?.contactEmail ? <span>{portalMeta.contactEmail}</span> : null}
                {portalMeta?.contactPhone ? <span>{portalMeta.contactPhone}</span> : null}
              </div>
            ) : null}
          </div>
        </section>

        {requiresPassword && !accessGranted ? (
          <section className="entry-card">
            <div className="entry-card__header">
              <div>
                <p className="eyebrow">{copy.partnerPortalEyebrow}</p>
                <h2>{copy.partnerPasswordTitle}</h2>
                <p>{copy.partnerPasswordBody}</p>
              </div>
            </div>
            <form className="auth-form auth-form--compact" onSubmit={handlePasswordSubmit}>
              <AuthFormField label={copy.partnerPasswordLabel} required>
                <input
                  name="portalPassword"
                  required
                  type="password"
                  value={passwordInput}
                  onChange={(event) => setPasswordInput(event.target.value)}
                />
              </AuthFormField>
              {error ? <p className="form-error">{error}</p> : null}
              <button className="button button--primary" disabled={verifyingAccess} type="submit">
                {verifyingAccess ? copy.adding : copy.partnerPasswordAction}
              </button>
            </form>
          </section>
        ) : null}

        {!requiresPassword && !accessGranted && !portalMetaLoading ? (
          <section className="entry-card">
            {error ? (
              <p className="form-error">{error}</p>
            ) : (
              <p>
                {language === "fr"
                  ? "Vérification de l'accès en cours..."
                  : language === "de"
                    ? "Zugriff wird überprüft..."
                    : "Checking access..."}
              </p>
            )}
          </section>
        ) : null}

        {accessGranted ? (
        <section className="entry-card">
          <div className="entry-card__header">
            <div>
              <p className="eyebrow">{copy.partnerPortalEyebrow}</p>
              <h2>{copy.partnerAddTitle}</h2>
            </div>
          </div>
          <form className="auth-form auth-form--long" onSubmit={handleSubmit}>
            <VipFormFields formData={formData} onChange={handleChange} organizationLocked />
            {error ? <p className="form-error">{error}</p> : null}
            {successMessage ? <p className="panel-note panel-note--success">{successMessage}</p> : null}
            <p className="panel-note">{getVipRgpdDisclaimer(language)}</p>
            <button className="button button--primary" disabled={isSubmitting} type="submit">
              {isSubmitting ? copy.addingPartner : copy.addPartnerButton}
            </button>
          </form>
        </section>
        ) : null}

        {accessGranted ? (
        <section className="entry-card">
          <div className="entry-card__header">
            <div>
              <p className="eyebrow">{copy.partnerListEyebrow}</p>
              <h2>{copy.partnerListTitle}</h2>
            </div>
          </div>
          {loading ? (
            <p>{language === "fr" ? "Chargement de la liste..." : language === "de" ? "Liste wird geladen..." : "Loading the list..."}</p>
          ) : entries.length === 0 ? (
            <div className="placeholder-card">
              <p className="eyebrow">{language === "fr" ? "Aucun inscrit" : language === "de" ? "Noch kein Eintrag" : "No registration yet"}</p>
              <h2>{copy.partnerListEmpty}</h2>
              <p>
                {language === "fr"
                  ? `Ajoutez ici les invités de ${portalLabel} à mesure que votre organisation confirme ses présences.`
                  : language === "de"
                    ? `Fügen Sie hier die Gäste von ${portalLabel} hinzu, sobald Ihre Organisation ihre Teilnahmen bestätigt.`
                    : `Add ${portalLabel} guests here as your organisation confirms attendance.`}
              </p>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Nom</th>
                    <th>E-mail</th>
                    <th>Tour VIP</th>
                    <th>Accompagnant</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => (
                    <tr key={entry.id}>
                      <td>{`${entry.firstName || ""} ${entry.lastName || ""}`.trim() || "—"}</td>
                      <td>{entry.email || "—"}</td>
                      <td>{getVipTourChoiceLabel(entry.vipTourChoice)}</td>
                      <td>
                        {`${entry.guestFirstName || ""} ${entry.guestLastName || ""}`.trim() ||
                          "Sans accompagnant"}
                      </td>
                      <td>
                        <button
                          className="button button--secondary"
                          type="button"
                          onClick={() => handleDelete(entry.id)}
                        >
                          {copy.deleteButton}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        ) : null}
      </div>
    </AuthLayout>
  );
}

export { VipAccessPage, VipPartnerPortalPage };
