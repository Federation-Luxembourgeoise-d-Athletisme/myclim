import { Fragment, useEffect, useMemo, useState } from "react";
import {
  addDoc,
  collection,
  collectionGroup,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { db } from "../services/firebase";
import { recordMatchesEdition, useActiveEdition } from "./edition";
import { AuthFormField, PhoneInput } from "./form-components";
import { useLanguage } from "./language-context";
import vipImport2027 from "./vip-import-2027.json";
import {
  VIP_INVITATION_CATEGORY_SUGGESTIONS,
  VIP_PICKUP_POINT_OPTIONS,
  VIP_TOUR_OPTIONS,
  VIP_TOUR_SHORT_LABEL_KEYS,
  buildVipFullName,
  buildVipPortalId,
  buildVipRegistrationPayload,
  createEmptyVipAdminRegistrationData,
  createEmptyVipInvitationData,
  createEmptyVipPartnerPortalData,
  createEmptyVipPortalContact,
  computeVipPortalPlaces,
  getVipPortalContacts,
  getVipPortalMeetingContact,
  normalizeVipPlacesCap,
  normalizeVipPortalContacts,
  parseVipPlacesCap,
  vipPortalAllowsCompanions,
  findMatchingVipInvitation,
  findMatchingVipRegistration,
  getVipTourChoiceLabel,
  normalizeVipComparableValue,
} from "./vip-helpers";
import { buildAppUrl } from "../services/app-url";

async function downloadWorkbook(workbook, filename) {
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function mapVipInvitation(snapshot) {
  return {
    id: snapshot.id,
    ...snapshot.data(),
  };
}

function mapVipPublicRegistration(snapshot) {
  return {
    id: snapshot.id,
    sourceCollection: "vipPublicRegistrations",
    sourceType: "public_form",
    ...snapshot.data(),
  };
}

function mapVipPartnerRegistration(snapshot) {
  const pathSegments = snapshot.ref.path.split("/");
  return {
    id: snapshot.id,
    portalId: pathSegments[1] || "",
    sourceCollection: "vipPartnerPortals",
    sourceType: "partner_portal",
    ...snapshot.data(),
  };
}

function mapVipAdminRegistration(snapshot) {
  return {
    id: snapshot.id,
    sourceCollection: "vipAdminRegistrations",
    sourceType: snapshot.data()?.source || "admin_manual",
    ...snapshot.data(),
  };
}

function mapVipPartnerPortal(snapshot) {
  return {
    id: snapshot.id,
    ...snapshot.data(),
  };
}

function getRegistrationDocumentRef(registration) {
  if (registration.sourceCollection === "vipInvitations") {
    return doc(db, "vipInvitations", registration.id);
  }

  if (registration.sourceCollection === "vipPublicRegistrations") {
    return doc(db, "vipPublicRegistrations", registration.id);
  }

  if (registration.sourceCollection === "vipPartnerPortals") {
    return doc(db, "vipPartnerPortals", registration.portalId, "entries", registration.id);
  }

  return doc(db, "vipAdminRegistrations", registration.id);
}

function formatMailStatus(status, t) {
  switch (String(status || "").trim().toLowerCase()) {
    case "sent":
      return t("vipMailStatusSent");
    default:
      return t("vipMailStatusNotSent");
  }
}

function formatRegistrationSource(sourceType, t) {
  switch (String(sourceType || "").trim()) {
    case "public_form":
      return t("vipSourcePublicForm");
    case "partner_portal":
      return t("vipSourcePartnerPortal");
    case "forced_from_invitation":
      return t("vipSourceForced");
    case "admin_manual":
      return t("vipSourceAdminManual");
    default:
      return "VIP";
  }
}

function matchesVipSearch(record, search) {
  const normalizedSearch = normalizeVipComparableValue(search);
  if (!normalizedSearch) return true;

  const haystack = [
    record.firstName,
    record.lastName,
    record.organization,
    record.email,
    record.category,
    record.notes,
  ]
    .map((value) => normalizeVipComparableValue(value))
    .join(" ");

  return haystack.includes(normalizedSearch);
}

function getInvitationCurrentEditionValue(invitation, activeEditionId) {
  const invitedByEdition =
    invitation?.invitedByEdition &&
    typeof invitation.invitedByEdition === "object" &&
    !Array.isArray(invitation.invitedByEdition)
      ? invitation.invitedByEdition
      : {};

  const directValue = invitedByEdition?.[activeEditionId];
  if (String(directValue || "").trim()) {
    return String(directValue).trim().toLowerCase() === "non" ? "non" : "oui";
  }

  if (String(activeEditionId || "").trim() === "2027" && String(invitation?.invitedFor2027 || "").trim()) {
    return String(invitation.invitedFor2027).trim().toLowerCase() === "non" ? "non" : "oui";
  }

  return "non";
}

function isInvitationArchived(invitation) {
  return Boolean(invitation?.archivedAt || invitation?.isArchived);
}

function getImportedInvitationEditionValue(invitation, activeEditionId) {
  const importedEditionId = String(vipImport2027?.metadata?.editionId || "").trim();
  const fallbackValue = String(invitation?.invitedFor2027 || "").trim().toLowerCase() === "non" ? "non" : "oui";

  if (importedEditionId && String(activeEditionId || "").trim() !== importedEditionId) {
    return "non";
  }

  return fallbackValue;
}

function buildVipPartnerPortalUrl(portalId) {
  return buildAppUrl(buildVipPartnerPortalPath(portalId));
}

function buildVipPartnerPortalPath(portalId) {
  return `/vip/orga/${encodeURIComponent(String(portalId || "").trim())}`;
}

function canOpenVipPartnerPortalLocally() {
  if (typeof window === "undefined") return false;
  const hostname = String(window.location?.hostname || "").trim().toLowerCase();
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "0.0.0.0";
}

function VipAdminPage({ Panel, loadMailQueueModule }) {
  const { t } = useLanguage();
  const { activeEditionId, activeEditionLabel, loading: editionLoading } = useActiveEdition(true);
  const [activeVipTab, setActiveVipTab] = useState("invitations");
  // Formulaires d'ajout repliés derrière un bouton (page plus compacte).
  const [showInvitationForm, setShowInvitationForm] = useState(false);
  const [showRegistrationForm, setShowRegistrationForm] = useState(false);
  const tourShortLabel = (value) => t(VIP_TOUR_SHORT_LABEL_KEYS[value || "none"] || "vipTourShortNone");
  const [partnerPortals, setPartnerPortals] = useState([]);
  const [partnerPortalSecrets, setPartnerPortalSecrets] = useState({});
  const [placeRequests, setPlaceRequests] = useState([]);
  const [invitations, setInvitations] = useState([]);
  const [publicRegistrations, setPublicRegistrations] = useState([]);
  const [partnerRegistrations, setPartnerRegistrations] = useState([]);
  const [adminRegistrations, setAdminRegistrations] = useState([]);
  const [invitationForm, setInvitationForm] = useState(() => createEmptyVipInvitationData());
  const [editingInvitationForm, setEditingInvitationForm] = useState(() => createEmptyVipInvitationData());
  const [registrationForm, setRegistrationForm] = useState(() => createEmptyVipAdminRegistrationData());
  const [partnerPortalForm, setPartnerPortalForm] = useState(() => createEmptyVipPartnerPortalData());
  const [editingInvitationId, setEditingInvitationId] = useState("");
  const [editingPartnerPortalId, setEditingPartnerPortalId] = useState("");
  const [invitationSearch, setInvitationSearch] = useState("");
  const [invitationArchiveFilter, setInvitationArchiveFilter] = useState("actifs");
  const [invitationMailFilter, setInvitationMailFilter] = useState("tous");
  const [registrationSearch, setRegistrationSearch] = useState("");
  const [registrationSourceFilter, setRegistrationSourceFilter] = useState("tous");
  const [registrationBadgeFilter, setRegistrationBadgeFilter] = useState("tous");
  const [registrationTourFilter, setRegistrationTourFilter] = useState("tous");
  const [selectedInvitationIds, setSelectedInvitationIds] = useState(() => new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [isExportingVip, setIsExportingVip] = useState(false);
  const allRegistrations = useMemo(
    () =>
      // Places normales des portails : pas des inscriptions VIP (ni badge, ni
      // accréditation) ; elles sont comptées dans les portails et à la caisse.
      [...publicRegistrations, ...partnerRegistrations.filter((entry) => entry.placeType !== "standard"), ...adminRegistrations].sort((left, right) => {
        const leftMs = left?.submittedAt?.toMillis?.() || left?.createdAt?.toMillis?.() || 0;
        const rightMs = right?.submittedAt?.toMillis?.() || right?.createdAt?.toMillis?.() || 0;
        return rightMs - leftMs;
      }),
    [adminRegistrations, partnerRegistrations, publicRegistrations],
  );

  useEffect(() => {
    setRegistrationForm(createEmptyVipAdminRegistrationData());
    setInvitationForm(createEmptyVipInvitationData());
    setEditingInvitationForm(createEmptyVipInvitationData());
    setPartnerPortalForm(createEmptyVipPartnerPortalData());
    setEditingInvitationId("");
    setEditingPartnerPortalId("");
    setSelectedInvitationIds(new Set());
  }, [activeEditionId]);

  useEffect(() => {
    if (editionLoading) return undefined;

    let loadedCount = 0;
    function markLoaded() {
      loadedCount += 1;
      if (loadedCount >= 6) {
        setLoading(false);
      }
    }

    const unsubPartnerPortals = onSnapshot(
      collection(db, "vipPartnerPortals"),
      (snapshot) => {
        setPartnerPortals(snapshot.docs.map(mapVipPartnerPortal));
        markLoaded();
      },
      (snapshotError) => {
        console.error("Unable to load VIP partner portals", snapshotError);
        setPartnerPortals([]);
        setError(t("vipErrorLoadPortals"));
        markLoaded();
      },
    );

    // Demandes de places supplémentaires envoyées depuis les portails (ne
    // compte pas dans le chargement initial : un échec n'empêche pas la page).
    const unsubPlaceRequests = onSnapshot(
      collectionGroup(db, "placeRequests"),
      (snapshot) => {
        setPlaceRequests(
          snapshot.docs
            .filter((entry) => entry.ref.path.startsWith("vipPartnerPortals/"))
            .map((entry) => ({ id: entry.id, portalId: entry.ref.path.split("/")[1] || "", ...entry.data() }))
            .filter((entry) => recordMatchesEdition(entry, activeEditionId)),
        );
      },
      (snapshotError) => {
        console.error("Unable to load VIP place requests", snapshotError);
        setPlaceRequests([]);
      },
    );

    const unsubPartnerPortalSecrets = onSnapshot(
      collection(db, "vipPartnerPortalSecrets"),
      (snapshot) => {
        const nextSecrets = {};
        snapshot.docs.forEach((secretDoc) => {
          nextSecrets[secretDoc.id] = secretDoc.data()?.accessPassword || "";
        });
        setPartnerPortalSecrets(nextSecrets);
        markLoaded();
      },
      (snapshotError) => {
        console.error("Unable to load VIP partner portal secrets", snapshotError);
        setPartnerPortalSecrets({});
        markLoaded();
      },
    );

    const unsubInvitations = onSnapshot(
      collection(db, "vipInvitations"),
      (snapshot) => {
        setInvitations(snapshot.docs.map(mapVipInvitation));
        markLoaded();
      },
      (snapshotError) => {
        console.error("Unable to load VIP invitations", snapshotError);
        setInvitations([]);
        setError(t("vipErrorLoadInvitations"));
        markLoaded();
      },
    );

    const unsubPublic = onSnapshot(
      collection(db, "vipPublicRegistrations"),
      (snapshot) => {
        setPublicRegistrations(
          snapshot.docs
            .map(mapVipPublicRegistration)
            .filter((entry) => recordMatchesEdition(entry, activeEditionId)),
        );
        markLoaded();
      },
      (snapshotError) => {
        console.error("Unable to load VIP public registrations", snapshotError);
        setPublicRegistrations([]);
        setError(t("vipErrorLoadPublicRegistrations"));
        markLoaded();
      },
    );

    const unsubPartner = onSnapshot(
      collectionGroup(db, "entries"),
      (snapshot) => {
        setPartnerRegistrations(
          snapshot.docs
            .filter((entry) => entry.ref.path.startsWith("vipPartnerPortals/"))
            .map(mapVipPartnerRegistration)
            .filter((entry) => recordMatchesEdition(entry, activeEditionId)),
        );
        markLoaded();
      },
      (snapshotError) => {
        console.error("Unable to load VIP partner registrations", snapshotError);
        setPartnerRegistrations([]);
        setError(t("vipErrorLoadPartnerRegistrations"));
        markLoaded();
      },
    );

    const unsubAdmin = onSnapshot(
      collection(db, "vipAdminRegistrations"),
      (snapshot) => {
        setAdminRegistrations(
          snapshot.docs
            .map(mapVipAdminRegistration)
            .filter((entry) => recordMatchesEdition(entry, activeEditionId)),
        );
        markLoaded();
      },
      (snapshotError) => {
        console.error("Unable to load VIP admin registrations", snapshotError);
        setAdminRegistrations([]);
        setError(t("vipErrorLoadAdminRegistrations"));
        markLoaded();
      },
    );

    return () => {
      unsubPartnerPortals();
      unsubPlaceRequests();
      unsubPartnerPortalSecrets();
      unsubInvitations();
      unsubPublic();
      unsubPartner();
      unsubAdmin();
    };
  }, [activeEditionId, editionLoading]);

  function handleInvitationChange(event) {
    const { name, value } = event.target;
    setInvitationForm((current) => ({ ...current, [name]: value }));
  }

  function handleRegistrationChange(event) {
    const { name, value } = event.target;
    setRegistrationForm((current) => ({ ...current, [name]: value }));
  }

  function handlePartnerPortalChange(event) {
    const { name, value } = event.target;
    setPartnerPortalForm((current) => ({ ...current, [name]: value }));
  }

  function handlePortalContactChange(index, event) {
    const { name, value } = event.target;
    setPartnerPortalForm((current) => ({
      ...current,
      contacts: current.contacts.map((contact, contactIndex) => (contactIndex === index ? { ...contact, [name]: value } : contact)),
    }));
  }

  function handleMeetingContactChange(event) {
    const { name, value } = event.target;
    setPartnerPortalForm((current) => ({ ...current, meetingContact: { ...current.meetingContact, [name]: value } }));
  }

  function addPortalContact() {
    setPartnerPortalForm((current) => ({ ...current, contacts: [...current.contacts, createEmptyVipPortalContact()] }));
  }

  function removePortalContact(index) {
    setPartnerPortalForm((current) => {
      const contacts = current.contacts.filter((_, contactIndex) => contactIndex !== index);
      return { ...current, contacts: contacts.length ? contacts : [createEmptyVipPortalContact()] };
    });
  }

  // Accepter : le plafond du type demandé augmente du nombre de places demandé.
  async function handlePlaceRequestDecision(request, accept) {
    setError("");
    setStatusMessage("");
    const portal = partnerPortals.find((item) => item.id === request.portalId);
    const placeType = request.placeType === "standard" ? "standard" : "vip";
    const capField = placeType === "standard" ? "standardPlacesCap" : "vipPlacesCap";
    const requested = Math.max(0, Math.floor(Number(request.requestedPlaces) || 0));
    try {
      if (accept && portal) {
        // VIP sans plafond = déjà illimité : rien à augmenter. Places normales
        // sans plafond = aucune : on part de 0.
        const currentCap = normalizeVipPlacesCap(portal[capField]) ?? (placeType === "standard" ? 0 : null);
        if (currentCap !== null) {
          const portalEntries = partnerRegistrations.filter((entry) => entry.portalId === portal.id);
          const used = computeVipPortalPlaces(portal, portalEntries).used[placeType];
          // Si le portail dépasse déjà son plafond, on part des places utilisées.
          await updateDoc(doc(db, "vipPartnerPortals", portal.id), {
            [capField]: Math.max(currentCap, used) + requested,
            updatedAt: serverTimestamp(),
          });
        }
      }
      await updateDoc(doc(db, "vipPartnerPortals", request.portalId, "placeRequests", request.id), {
        status: accept ? "accepted" : "refused",
        decidedAt: serverTimestamp(),
      });
      setStatusMessage(accept ? t("vipPlaceRequestAccepted") : t("vipPlaceRequestRefused"));
    } catch (decisionError) {
      console.error("VIP place request decision failed", decisionError);
      setError(t("vipErrorSavePortal"));
    }
  }

  function handleEditingInvitationChange(event) {
    const { name, value } = event.target;
    setEditingInvitationForm((current) => ({ ...current, [name]: value }));
  }

  async function handleImportBaseInvitations() {
    setError("");
    setStatusMessage("");

    try {
      let createdCount = 0;

      for (const importedInvitation of vipImport2027.invitations) {
        const existingInvitation = findMatchingVipInvitation(invitations, importedInvitation);
        if (existingInvitation) {
          continue;
        }

        await addDoc(collection(db, "vipInvitations"), {
          ...importedInvitation,
          invitationMailLanguage: importedInvitation.invitationMailLanguage || "fr",
          invitedByEdition: {
            [activeEditionId]: getImportedInvitationEditionValue(importedInvitation, activeEditionId),
          },
          invitedFor2027: null,
          archivedAt: null,
          archivedReason: "",
          invitationMailStatus: "not_sent",
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        createdCount += 1;
      }

      setStatusMessage(
        createdCount > 0
          ? t("vipImportedCount").replace("{count}", createdCount)
          : t("vipImportAlreadyPresent"),
      );
    } catch (importError) {
      console.error("VIP import failed", importError);
      setError(t("vipErrorImport"));
    }
  }

  async function handleInvitationSubmit(event) {
    event.preventDefault();
    setError("");
    setStatusMessage("");

  const payload = {
      firstName: invitationForm.firstName,
      lastName: invitationForm.lastName,
      organization: invitationForm.organization,
      email: String(invitationForm.email || "").trim().toLowerCase(),
      category: invitationForm.category,
      invitationMailLanguage: invitationForm.invitationMailLanguage || "fr",
      mailGreetingLabel: invitationForm.mailGreetingLabel,
      notes: invitationForm.notes,
      [`invitedByEdition.${activeEditionId}`]: invitationForm.invitedThisEdition,
      updatedAt: serverTimestamp(),
    };

    try {
      await addDoc(collection(db, "vipInvitations"), {
        ...payload,
        archivedAt: null,
        archivedReason: "",
        invitationMailStatus: "not_sent",
        createdAt: serverTimestamp(),
      });
      setStatusMessage(t("vipInvitationAdded"));

      setInvitationForm(createEmptyVipInvitationData());
    } catch (submissionError) {
      console.error("VIP invitation save failed", submissionError);
      setError(t("vipErrorSaveInvitation"));
    }
  }

  async function handleEditingInvitationSubmit(event) {
    event.preventDefault();
    if (!editingInvitationId) return;

    setError("");
    setStatusMessage("");

    const payload = {
      firstName: editingInvitationForm.firstName,
      lastName: editingInvitationForm.lastName,
      organization: editingInvitationForm.organization,
      email: String(editingInvitationForm.email || "").trim().toLowerCase(),
      category: editingInvitationForm.category,
      invitationMailLanguage: editingInvitationForm.invitationMailLanguage || "fr",
      mailGreetingLabel: editingInvitationForm.mailGreetingLabel,
      notes: editingInvitationForm.notes,
      [`invitedByEdition.${activeEditionId}`]: editingInvitationForm.invitedThisEdition,
      updatedAt: serverTimestamp(),
    };

    try {
      await updateDoc(doc(db, "vipInvitations", editingInvitationId), payload);
      setStatusMessage(t("vipInvitationUpdated"));
      setEditingInvitationId("");
      setEditingInvitationForm(createEmptyVipInvitationData());
    } catch (submissionError) {
      console.error("VIP invitation update failed", submissionError);
      setError(t("vipErrorSaveInvitation"));
    }
  }

  function startEditingInvitation(invitation) {
    setEditingInvitationId(invitation.id);
    setEditingInvitationForm({
      firstName: invitation.firstName || "",
      lastName: invitation.lastName || "",
      email: invitation.email || "",
      organization: invitation.organization || "",
      category: invitation.category || "Partenaire",
      invitationMailLanguage: invitation.invitationMailLanguage || "fr",
      mailGreetingLabel: invitation.mailGreetingLabel || "",
      invitedThisEdition: getInvitationCurrentEditionValue(invitation, activeEditionId),
      notes: invitation.notes || "",
    });
  }

  function cancelEditingInvitation() {
    setEditingInvitationId("");
    setEditingInvitationForm(createEmptyVipInvitationData());
  }

  function startEditingPartnerPortal(portal) {
    setEditingPartnerPortalId(portal.id);
    setPartnerPortalForm({
      portalId: portal.id,
      organizationName: portal.organizationName || "",
      contacts: getVipPortalContacts(portal).length ? getVipPortalContacts(portal) : [createEmptyVipPortalContact()],
      meetingContact: getVipPortalMeetingContact(portal),
      vipPlacesCap: normalizeVipPlacesCap(portal.vipPlacesCap) ?? "",
      standardPlacesCap: normalizeVipPlacesCap(portal.standardPlacesCap) ?? "",
      companionsAllowed: vipPortalAllowsCompanions(portal),
      accessPassword: partnerPortalSecrets[portal.id] || "",
      notes: portal.notes || "",
    });
  }

  function cancelEditingPartnerPortal() {
    setEditingPartnerPortalId("");
    setPartnerPortalForm(createEmptyVipPartnerPortalData());
  }

  async function handlePartnerPortalSubmit(event) {
    event.preventDefault();
    setError("");
    setStatusMessage("");

    const resolvedPortalId = buildVipPortalId(partnerPortalForm.portalId || partnerPortalForm.organizationName);
    if (!resolvedPortalId) {
      setError(t("vipErrorMissingPortalId"));
      return;
    }

    const resolvedDocId = editingPartnerPortalId || resolvedPortalId;
    const trimmedPassword = String(partnerPortalForm.accessPassword || "").trim();
    const contacts = normalizeVipPortalContacts(partnerPortalForm.contacts);
    if (!contacts.some((contact) => contact.firstName || contact.lastName)) {
      setError(t("vipErrorMissingContact"));
      return;
    }
    const mainContact = contacts[0];

    const payload = {
      organizationName: partnerPortalForm.organizationName,
      contacts,
      // Vide = contact par défaut (Margot) sur le portail.
      meetingContact: normalizeVipPortalContacts([partnerPortalForm.meetingContact || {}])[0] || null,
      // Champs historiques = premier contact (lus par les écrans plus anciens).
      contactName: buildVipFullName(mainContact),
      contactPhone: mainContact.phone,
      contactEmail: mainContact.email,
      vipPlacesCap: parseVipPlacesCap(partnerPortalForm.vipPlacesCap),
      standardPlacesCap: parseVipPlacesCap(partnerPortalForm.standardPlacesCap),
      companionsAllowed: partnerPortalForm.companionsAllowed !== false,
      hasPassword: Boolean(trimmedPassword),
      notes: partnerPortalForm.notes,
      updatedAt: serverTimestamp(),
    };

    try {
      await setDoc(
        doc(db, "vipPartnerPortals", resolvedDocId),
        {
          ...payload,
          createdAt: editingPartnerPortalId ? partnerPortals.find((portal) => portal.id === editingPartnerPortalId)?.createdAt || serverTimestamp() : serverTimestamp(),
        },
        { merge: true },
      );

      await setDoc(
        doc(db, "vipPartnerPortalSecrets", resolvedDocId),
        { accessPassword: trimmedPassword, updatedAt: serverTimestamp() },
        { merge: true },
      );

      setStatusMessage(editingPartnerPortalId ? t("vipPortalUpdated") : t("vipPortalCreated"));
      setPartnerPortalForm(createEmptyVipPartnerPortalData());
      setEditingPartnerPortalId("");
    } catch (submissionError) {
      console.error("VIP partner portal save failed", submissionError);
      setError(t("vipErrorSavePortal"));
    }
  }

  async function handleSendInvitation(invitation) {
    setError("");
    setStatusMessage("");

    if (!String(invitation.email || "").trim()) {
      setError(t("vipErrorSendNoEmail"));
      return;
    }

    try {
      const { buildVipInvitationMail, enqueueTransactionalMail } = await loadMailQueueModule();
      await enqueueTransactionalMail(
          buildVipInvitationMail({
            category: invitation.category,
            email: invitation.email,
            firstName: invitation.firstName,
            greetingLabel: invitation.mailGreetingLabel,
            invitationUrl: buildAppUrl("/vip"),
            language: invitation.invitationMailLanguage,
            lastName: invitation.lastName,
            organization: invitation.organization,
          }),
      );
      await updateDoc(doc(db, "vipInvitations", invitation.id), {
        invitationMailStatus: "sent",
        invitationSentAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setStatusMessage(t("vipInvitationSentTo").replace("{email}", invitation.email));
    } catch (mailError) {
      console.error("VIP invitation mail failed", mailError);
      setError(mailError?.message || t("vipErrorSendInvitation"));
    }
  }

  function toggleInvitationSelection(invitationId) {
    setSelectedInvitationIds((current) => {
      const next = new Set(current);
      if (next.has(invitationId)) {
        next.delete(invitationId);
      } else {
        next.add(invitationId);
      }
      return next;
    });
  }

  function handleSelectAllFilteredInvitations() {
    setSelectedInvitationIds(new Set(filteredInvitationRows.map((invitation) => invitation.id)));
  }

  function handleClearInvitationSelection() {
    setSelectedInvitationIds(new Set());
  }

  async function handleSendSelectedInvitations() {
    setError("");
    setStatusMessage("");

    const selectedInvitations = filteredInvitationRows.filter((invitation) => selectedInvitationIds.has(invitation.id));
    const invitationsWithEmail = selectedInvitations.filter((invitation) => String(invitation.email || "").trim());

    if (!invitationsWithEmail.length) {
      setError(t("vipErrorNoSelectionEmail"));
      return;
    }

    try {
      const { buildVipInvitationMail, enqueueTransactionalMail } = await loadMailQueueModule();

      for (const invitation of invitationsWithEmail) {
        await enqueueTransactionalMail(
          buildVipInvitationMail({
            category: invitation.category,
            email: invitation.email,
            firstName: invitation.firstName,
            greetingLabel: invitation.mailGreetingLabel,
            invitationUrl: buildAppUrl("/vip"),
            language: invitation.invitationMailLanguage,
            lastName: invitation.lastName,
            organization: invitation.organization,
          }),
        );

        await updateDoc(doc(db, "vipInvitations", invitation.id), {
          invitationMailStatus: "sent",
          invitationSentAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }

      setStatusMessage(t("vipInvitationsSentCount").replace("{count}", invitationsWithEmail.length));
      setSelectedInvitationIds(new Set());
    } catch (mailError) {
      console.error("VIP bulk invitation mail failed", mailError);
      setError(mailError?.message || t("vipErrorSendSelected"));
    }
  }

  async function handleForceRegistration(invitation) {
    setError("");
    setStatusMessage("");

    try {
      const matchedRegistration = findMatchingVipRegistration(allRegistrations, invitation);

      if (!matchedRegistration) {
        const registrationRef = await addDoc(collection(db, "vipAdminRegistrations"), {
          editionId: activeEditionId,
          source: "forced_from_invitation",
          forcedFromInvitationId: invitation.id,
          firstName: invitation.firstName || "",
          lastName: invitation.lastName || "",
          email: String(invitation.email || "").trim().toLowerCase(),
          organization: invitation.organization || "",
          vipTourChoice: "none",
          pickupPoint: "Accueil VIP",
          badgePrintStatus: "non_imprime",
          registrationStatus: "forced",
          notes: invitation.notes || "",
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        await updateDoc(doc(db, "vipInvitations", invitation.id), {
          forcedRegistrationId: registrationRef.id,
          updatedAt: serverTimestamp(),
        });
      }

      setStatusMessage(t("vipForcedRegistrationSaved"));
    } catch (registrationError) {
      console.error("Force VIP registration failed", registrationError);
      setError(t("vipErrorForceRegistration"));
    }
  }

  async function handleToggleArchiveInvitation(invitation) {
    setError("");
    setStatusMessage("");

    try {
      const nextArchived = !isInvitationArchived(invitation);
      await updateDoc(doc(db, "vipInvitations", invitation.id), {
        archivedAt: nextArchived ? serverTimestamp() : null,
        archivedReason: nextArchived ? "Archivage manuel" : "",
        updatedAt: serverTimestamp(),
      });
      setStatusMessage(nextArchived ? t("vipInvitationArchived") : t("vipInvitationReactivated"));
    } catch (archiveError) {
      console.error("VIP invitation archive failed", archiveError);
      setError(t("vipErrorToggleArchive"));
    }
  }

  async function handleRegistrationSubmit(event) {
    event.preventDefault();
    setError("");
    setStatusMessage("");

    try {
      await addDoc(
        collection(db, "vipAdminRegistrations"),
        buildVipRegistrationPayload(registrationForm, {
          editionId: activeEditionId,
          source: "admin_manual",
          pickupPoint: registrationForm.pickupPoint || "Accueil VIP",
          badgePrintStatus: registrationForm.badgePrintStatus || "non_imprime",
          registrationStatus: registrationForm.registrationStatus || "confirmed",
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }),
      );
      setRegistrationForm(createEmptyVipAdminRegistrationData());
      setStatusMessage(t("vipRegistrantAdded"));
    } catch (submissionError) {
      console.error("VIP admin manual registration failed", submissionError);
      setError(t("vipErrorAddRegistrant"));
    }
  }

  async function handleRegistrationFieldUpdate(registration, patch) {
    setError("");
    setStatusMessage("");

    try {
      await updateDoc(getRegistrationDocumentRef(registration), {
        ...patch,
        updatedAt: serverTimestamp(),
      });
    } catch (updateError) {
      console.error("VIP registration update failed", updateError);
      setError(t("vipErrorUpdateRegistrant"));
    }
  }

  // Exports exactly the rows currently shown (respects search + filters), not
  // the whole database — an admin filtering to one tour or one badge status
  // expects the export to match what they're looking at on screen.
  async function handleExportRegistrationsExcel() {
    setIsExportingVip(true);
    setError("");
    setStatusMessage("");
    try {
      const ExcelJSModule = await import("exceljs");
      const ExcelJS = ExcelJSModule.default ?? ExcelJSModule;
      const workbook = new ExcelJS.Workbook();
      workbook.creator = "MyCLIM";
      workbook.created = new Date();
      workbook.title = `VIP ${activeEditionId}`;

      const sheet = workbook.addWorksheet("VIP");
      sheet.columns = [
        { header: "Prénom", key: "firstName", width: 16 },
        { header: "Nom", key: "lastName", width: 16 },
        { header: "Organisation", key: "organization", width: 24 },
        { header: "Email", key: "email", width: 26 },
        { header: "Téléphone", key: "phone", width: 16 },
        { header: "Catégorie", key: "category", width: 20 },
        { header: "Tour VIP", key: "vipTour", width: 30 },
        { header: "Point de RDV", key: "pickupPoint", width: 18 },
        { header: "Badge", key: "badgePrintStatus", width: 16 },
        { header: "Source", key: "sourceType", width: 18 },
        { header: "Invité(e) +1", key: "guestName", width: 20 },
        { header: "Notes", key: "notes", width: 30 },
      ];
      sheet.getRow(1).font = { bold: true };

      filteredRegistrationRows.forEach((registration) => {
        sheet.addRow({
          firstName: registration.firstName || "",
          lastName: registration.lastName || "",
          organization: registration.organization || "",
          email: registration.email || "",
          phone: registration.phone || "",
          category: registration.matchedInvitation?.category || "",
          vipTour: getVipTourChoiceLabel(registration.vipTourChoice || "none"),
          pickupPoint: registration.pickupPoint || "",
          badgePrintStatus: registration.badgePrintStatus || "non_imprime",
          sourceType: registration.sourceType || "",
          guestName:
            buildVipFullName({ firstName: registration.guestFirstName, lastName: registration.guestLastName }) ||
            (registration.hasCompanion ? "+1" : ""),
          notes: registration.matchedInvitation?.notes || registration.notes || "",
        });
      });

      const filename = `vip-inscrits-${activeEditionId}.xlsx`;
      await downloadWorkbook(workbook, filename);
      setStatusMessage(`Export Excel prêt : ${filename}`);
    } catch (exportError) {
      console.error("VIP Excel export failed", exportError);
      setError("L'export Excel a échoué.");
    } finally {
      setIsExportingVip(false);
    }
  }

  // The invitation list is primarily a mailing list — recipient, contact
  // language and whether the invite mail already went out — rather than the
  // richer per-guest details tracked once someone actually registers.
  async function handleExportInvitationsExcel() {
    setIsExportingVip(true);
    setError("");
    setStatusMessage("");
    try {
      const ExcelJSModule = await import("exceljs");
      const ExcelJS = ExcelJSModule.default ?? ExcelJSModule;
      const workbook = new ExcelJS.Workbook();
      workbook.creator = "MyCLIM";
      workbook.created = new Date();
      workbook.title = `VIP — invitations ${activeEditionId}`;

      const sheet = workbook.addWorksheet("Invitations");
      sheet.columns = [
        { header: "Prénom", key: "firstName", width: 16 },
        { header: "Nom", key: "lastName", width: 16 },
        { header: "Email", key: "email", width: 28 },
        { header: "Organisation", key: "organization", width: 24 },
        { header: "Catégorie", key: "category", width: 20 },
        { header: "Langue mail", key: "invitationMailLanguage", width: 12 },
        { header: "Mail envoyé", key: "mailSent", width: 14 },
        { header: "Invité cette édition", key: "invitedThisEdition", width: 16 },
        { header: "Archivé", key: "archived", width: 12 },
        { header: "Déjà inscrit", key: "registered", width: 14 },
        { header: "Notes", key: "notes", width: 30 },
      ];
      sheet.getRow(1).font = { bold: true };

      filteredInvitationRows.forEach((invitation) => {
        sheet.addRow({
          firstName: invitation.firstName || "",
          lastName: invitation.lastName || "",
          email: invitation.email || "",
          organization: invitation.organization || "",
          category: invitation.category || "",
          invitationMailLanguage: invitation.invitationMailLanguage || "",
          mailSent: invitation.invitationMailStatus === "sent" ? "Oui" : "Non",
          invitedThisEdition: invitation.invitedThisEdition === "oui" ? "Oui" : "Non",
          archived: invitation.archived ? "Oui" : "Non",
          registered: invitation.matchedRegistration ? "Oui" : "Non",
          notes: invitation.notes || "",
        });
      });

      const filename = `vip-invitations-${activeEditionId}.xlsx`;
      await downloadWorkbook(workbook, filename);
      setStatusMessage(`Export Excel prêt : ${filename}`);
    } catch (exportError) {
      console.error("VIP invitations Excel export failed", exportError);
      setError("L'export Excel a échoué.");
    } finally {
      setIsExportingVip(false);
    }
  }

  const invitationRows = useMemo(
    () =>
      invitations
        .slice()
        .sort((left, right) => buildVipFullName(left).localeCompare(buildVipFullName(right), "fr"))
        .map((invitation) => ({
          ...invitation,
          invitedThisEdition: getInvitationCurrentEditionValue(invitation, activeEditionId),
          archived: isInvitationArchived(invitation),
          matchedRegistration: findMatchingVipRegistration(allRegistrations, invitation),
        })),
    [activeEditionId, allRegistrations, invitations],
  );

  const filteredInvitationRows = useMemo(
    () =>
      invitationRows.filter((invitation) => {
        if (!matchesVipSearch(invitation, invitationSearch)) return false;

        if (invitationArchiveFilter === "actifs" && invitation.archived) return false;
        if (invitationArchiveFilter === "archives" && !invitation.archived) return false;

        if (invitationMailFilter === "envoyes" && invitation.invitationMailStatus !== "sent") return false;
        if (invitationMailFilter === "non_envoyes" && invitation.invitationMailStatus === "sent") return false;

        return true;
      }),
    [invitationArchiveFilter, invitationMailFilter, invitationRows, invitationSearch],
  );

  const registrationRows = useMemo(
    () =>
      allRegistrations.map((registration) => ({
        ...registration,
        matchedInvitation: findMatchingVipInvitation(invitations, registration),
      })),
    [allRegistrations, invitations],
  );

  const filteredRegistrationRows = useMemo(
    () =>
      registrationRows.filter((registration) => {
        if (
          !matchesVipSearch(
            {
              ...registration,
              category: registration.matchedInvitation?.category || "",
              notes: registration.matchedInvitation?.notes || registration.notes || "",
            },
            registrationSearch,
          )
        ) {
          return false;
        }

        if (registrationSourceFilter !== "tous" && registration.sourceType !== registrationSourceFilter) return false;
        if (registrationBadgeFilter !== "tous" && (registration.badgePrintStatus || "non_imprime") !== registrationBadgeFilter) return false;
        if (registrationTourFilter !== "tous" && (registration.vipTourChoice || "none") !== registrationTourFilter) return false;

        return true;
      }),
    [registrationBadgeFilter, registrationRows, registrationSearch, registrationSourceFilter, registrationTourFilter],
  );

  const selectedFilteredInvitationCount = useMemo(
    () => filteredInvitationRows.filter((invitation) => selectedInvitationIds.has(invitation.id)).length,
    [filteredInvitationRows, selectedInvitationIds],
  );

  const partnerPortalRows = useMemo(
    () =>
      partnerPortals
        .slice()
        .sort((left, right) =>
          String(left.organizationName || left.id || "").localeCompare(String(right.organizationName || right.id || ""), "fr"),
        )
        .map((portal) => ({
          ...portal,
          contactList: getVipPortalContacts(portal),
          places: computeVipPortalPlaces(
            portal,
            partnerRegistrations.filter((entry) => entry.portalId === portal.id),
          ),
          portalUrl: buildVipPartnerPortalUrl(portal.id),
          portalPreviewUrl: canOpenVipPartnerPortalLocally() ? buildVipPartnerPortalPath(portal.id) : "",
        })),
    [partnerPortals, partnerRegistrations],
  );

  const pendingPlaceRequests = useMemo(
    () =>
      placeRequests
        .filter((request) => (request.status || "pending") === "pending")
        .map((request) => ({
          ...request,
          portalName: partnerPortals.find((portal) => portal.id === request.portalId)?.organizationName || request.portalId,
        }))
        .sort((left, right) => (left.createdAt?.toMillis?.() || 0) - (right.createdAt?.toMillis?.() || 0)),
    [partnerPortals, placeRequests],
  );

  const formatPlaces = (used, cap) => (cap === null ? `${used}` : `${used} / ${cap}`);

  return (
    <div className="stacked-entry vip-admin">
      <header className="vip-admin-head">
        <div>
          <h1>{t("vipAdminTitle")}</h1>
          <p>{t("vipAdminSubtitle").replace("{edition}", activeEditionLabel)}</p>
        </div>
        <dl className="vip-admin-kpis">
          <div><dt>{t("vipAdminStatInvitations")}</dt><dd>{invitationRows.length}</dd></div>
          <div><dt>{t("vipAdminStatRegistrations")}</dt><dd>{registrationRows.length}</dd></div>
          <div><dt>{t("vipAdminStatQueued")}</dt><dd>{registrationRows.filter((row) => row.badgePrintStatus === "en_file").length}</dd></div>
          <div><dt>{t("vipAdminStatPrinted")}</dt><dd>{registrationRows.filter((row) => row.badgePrintStatus === "imprime").length}</dd></div>
        </dl>
      </header>
      {editionLoading || loading ? <p className="panel-note">{t("vipAdminLoading")}</p> : null}
      {error ? <p className="form-error">{error}</p> : null}
      {statusMessage ? <p className="panel-note panel-note--success">{statusMessage}</p> : null}

      <details className="vip-explainer">
        <summary>{t("vipExplainerToggle")}</summary>
        <p className="panel-note">{t("vipExplainerSubtitle")}</p>
        <ol className="vip-explainer-list">
          <li>
            <strong>{t("vipExplainerStep1Title")}</strong> {t("vipExplainerStep1Tab")}
            <p>{t("vipExplainerStep1Body")}</p>
          </li>
          <li>
            <strong>{t("vipExplainerStep2Title")}</strong> {t("vipExplainerStep2Tab")}
            <p>{t("vipExplainerStep2Body")}</p>
          </li>
          <li>
            <strong>{t("vipExplainerStep3Title")}</strong> {t("vipExplainerStep3Tab")}
            <p>{t("vipExplainerStep3Body")}</p>
          </li>
          <li>
            <strong>{t("vipExplainerStep4Title")}</strong> {t("vipExplainerStep4Tab")}
            <p>{t("vipExplainerStep4Body")}</p>
          </li>
        </ol>
        <p className="panel-note">
          {t("vipExplainerFooterPrefix")} <strong>{t("vipExplainerFooterHighlight")}</strong>{" "}
          {t("vipExplainerFooterSuffix")}
        </p>
        <p className="panel-note">
          {t("vipAdminImportNotePrefix")} <strong>{vipImport2027.metadata.recordCount}</strong>{" "}
          {t("vipAdminImportNoteSuffix")}
        </p>
      </details>

      <div className="vip-admin-tabs" role="tablist" aria-label={t("vipTabNavAriaLabel")}>
        {[
          ["invitations", t("vipTabInvitations"), invitationRows.length],
          ["registrations", t("vipTabRegistrations"), registrationRows.length],
          ["partner-portals", t("vipTabPartnerPortals"), partnerPortalRows.length],
        ].map(([key, label, count]) => (
          <button
            key={key}
            role="tab"
            aria-selected={activeVipTab === key}
            className={`vip-admin-tab${activeVipTab === key ? " is-active" : ""}`}
            type="button"
            onClick={() => setActiveVipTab(key)}
          >
            {label}
            <span className="vip-admin-tab__count">{count}</span>
          </button>
        ))}
      </div>

      {activeVipTab === "invitations" ? (
        <>
          {showInvitationForm ? (
          <Panel
            title={t("vipAddInvitationTitle")}
            subtitle={t("vipAddInvitationSubtitle")}
            actions={<button type="button" className="button button--neutral" onClick={() => setShowInvitationForm(false)}>{t("vipHideForm")}</button>}
          >
            <form className="auth-form auth-form--compact vip-admin-form vip-admin-form--inline" onSubmit={handleInvitationSubmit}>
              <AuthFormField label={t("vipFieldFirstName")} required>
                <input name="firstName" required value={invitationForm.firstName} onChange={handleInvitationChange} />
              </AuthFormField>
              <AuthFormField label={t("vipFieldLastName")} required>
                <input name="lastName" required value={invitationForm.lastName} onChange={handleInvitationChange} />
              </AuthFormField>
              <AuthFormField label={t("vipFieldEmail")}>
                <input name="email" type="email" value={invitationForm.email} onChange={handleInvitationChange} />
              </AuthFormField>
              <AuthFormField label={t("vipFieldOrganization")}>
                <input name="organization" value={invitationForm.organization} onChange={handleInvitationChange} />
              </AuthFormField>
              <AuthFormField label={t("vipFieldCategory")} required>
                <input
                  list="vip-invitation-category-suggestions"
                  name="category"
                  title={t("vipFieldCategoryHint")}
                  required
                  value={invitationForm.category}
                  onChange={handleInvitationChange}
                />
              </AuthFormField>
              <AuthFormField label={t("vipFieldMailLanguage")} required>
                <select
                  name="invitationMailLanguage"
                  value={invitationForm.invitationMailLanguage}
                  onChange={handleInvitationChange}
                >
                  <option value="fr">{t("vipLangFrench")}</option>
                  <option value="en">{t("vipLangEnglish")}</option>
                </select>
              </AuthFormField>
              <AuthFormField label={t("vipFieldMailGreeting")}>
                <input
                  name="mailGreetingLabel"
                  placeholder={t("vipMailGreetingPlaceholder")}
                  title={t("vipFieldMailGreetingHint")}
                  value={invitationForm.mailGreetingLabel}
                  onChange={handleInvitationChange}
                />
              </AuthFormField>
              <AuthFormField label={t("vipFieldInvitedThisEdition")} required>
                <select name="invitedThisEdition" value={invitationForm.invitedThisEdition} onChange={handleInvitationChange}>
                  <option value="oui">{t("vipYes")}</option>
                  <option value="non">{t("vipNo")}</option>
                </select>
              </AuthFormField>
              <AuthFormField className="vip-admin-form__wide" label={t("vipFieldNotes")}>
                <input name="notes" value={invitationForm.notes} onChange={handleInvitationChange} />
              </AuthFormField>
              <datalist id="vip-invitation-category-suggestions">
                {VIP_INVITATION_CATEGORY_SUGGESTIONS.map((category) => (
                  <option key={category} value={category} />
                ))}
              </datalist>
              <div className="panel-actions vip-admin-form__actions">
                <button className="button button--primary" type="submit">
                  {t("vipAddToInvitationList")}
                </button>
              </div>
            </form>
          </Panel>
          ) : null}

          <Panel
            title={t("vipInvitationListTitle")}
            subtitle={t("vipInvitationListSubtitle")}
            actions={
              <div className="vip-admin-head-actions">
                {showInvitationForm ? null : (
                  <button type="button" className="button button--primary" onClick={() => setShowInvitationForm(true)}>
                    + {t("vipNewInvitation")}
                  </button>
                )}
                <button
                  type="button"
                  className="button button--secondary"
                  onClick={handleExportInvitationsExcel}
                  disabled={isExportingVip || filteredInvitationRows.length === 0}
                >
                  {isExportingVip ? "Export…" : `Excel (${filteredInvitationRows.length})`}
                </button>
              </div>
            }
          >
            <div className="vip-admin-filters">
              <input
                type="search"
                placeholder={t("vipSearchPlaceholder")}
                value={invitationSearch}
                onChange={(event) => setInvitationSearch(event.target.value)}
              />
              <select value={invitationArchiveFilter} onChange={(event) => setInvitationArchiveFilter(event.target.value)}>
                <option value="actifs">{t("vipFilterActive")}</option>
                <option value="archives">{t("vipFilterArchived")}</option>
                <option value="tous">{t("vipFilterAll")}</option>
              </select>
              <select value={invitationMailFilter} onChange={(event) => setInvitationMailFilter(event.target.value)}>
                <option value="tous">{t("vipFilterAllMails")}</option>
                <option value="non_envoyes">{t("vipFilterMailsNotSent")}</option>
                <option value="envoyes">{t("vipFilterMailsSent")}</option>
              </select>
            </div>
            <div className="vip-admin-bulkbar">
              <label className="vip-admin-checkbox">
                <input
                  type="checkbox"
                  checked={filteredInvitationRows.length > 0 && selectedFilteredInvitationCount === filteredInvitationRows.length}
                  onChange={(event) =>
                    event.target.checked ? handleSelectAllFilteredInvitations() : handleClearInvitationSelection()
                  }
                />
                <span>{t("vipSelectAll")}</span>
              </label>
              <span className="panel-note">{t("vipSelectedCount").replace("{count}", selectedFilteredInvitationCount)}</span>
              <button className="button button--secondary" type="button" onClick={handleClearInvitationSelection}>
                {t("vipClearSelection")}
              </button>
              <button className="button button--primary" type="button" onClick={handleSendSelectedInvitations}>
                {t("vipSendToSelected")}
              </button>
            </div>
            <div className="table-wrap">
              <table className="data-table data-table--vip data-table--vip-invitations">
                <thead>
                  <tr>
                    <th className="vip-table-checkbox-col">{t("vipColSel")}</th>
                    <th>{t("vipColGuest")}</th>
                    <th>{t("vipColContact")}</th>
                    <th>{t("vipColStatus")}</th>
                    <th>{t("vipColMatching")}</th>
                    <th>{t("vipColActions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredInvitationRows.map((invitation) => (
                    <Fragment key={invitation.id}>
                      <tr key={invitation.id}>
                        <td className="vip-table-checkbox-col">
                          <label className="vip-admin-checkbox">
                            <input
                              type="checkbox"
                              checked={selectedInvitationIds.has(invitation.id)}
                              onChange={() => toggleInvitationSelection(invitation.id)}
                            />
                          </label>
                        </td>
                        <td>
                          <div className="table-stack table-stack--tight">
                            <strong>{buildVipFullName(invitation) || "—"}</strong>
                            <span>{invitation.organization || "—"}</span>
                            <span className="vip-table-muted">
                              {invitation.category || "—"} · {invitation.invitationMailLanguage === "en" ? "EN" : "FR"}
                            </span>
                          </div>
                        </td>
                        <td>
                          <div className="table-stack table-stack--tight">
                            <span>{invitation.email || "—"}</span>
                          </div>
                        </td>
                        <td>
                          <div className="table-stack table-stack--tight">
                            <label className="vip-table-inline-select">
                              <span className="vip-table-label">{t("vipThisYear")}</span>
                              <select
                                value={invitation.invitedThisEdition || "non"}
                                onChange={(event) =>
                                  handleRegistrationFieldUpdate(
                                    { sourceCollection: "vipInvitations", id: invitation.id },
                                    { [`invitedByEdition.${activeEditionId}`]: event.target.value },
                                  )
                                }
                              >
                                <option value="oui">{t("vipYes")}</option>
                                <option value="non">{t("vipNo")}</option>
                              </select>
                            </label>
                            <span className="vip-table-muted">{invitation.archived ? t("vipArchived") : t("vipActive")}</span>
                            <span className="vip-table-muted">{formatMailStatus(invitation.invitationMailStatus, t)}</span>
                          </div>
                        </td>
                        <td>
                          <span>
                            {invitation.matchedRegistration
                              ? formatRegistrationSource(invitation.matchedRegistration.sourceType, t)
                              : t("vipToMatch")}
                          </span>
                        </td>
                        <td>
                          <div className="vip-admin-actions vip-admin-actions--compact">
                            <button className="button button--secondary" type="button" onClick={() => startEditingInvitation(invitation)}>
                              {t("vipEdit")}
                            </button>
                            <button className="button button--secondary" type="button" onClick={() => handleForceRegistration(invitation)}>
                              {t("vipForce")}
                            </button>
                            <button className="button button--secondary" type="button" onClick={() => handleToggleArchiveInvitation(invitation)}>
                              {invitation.archived ? t("vipReactivate") : t("vipArchive")}
                            </button>
                          </div>
                        </td>
                      </tr>
                      {editingInvitationId === invitation.id ? (
                        <tr className="vip-inline-editor-row">
                          <td colSpan="6">
                            <form className="vip-inline-editor" onSubmit={handleEditingInvitationSubmit}>
                              <input name="firstName" required placeholder={t("vipFieldFirstName")} value={editingInvitationForm.firstName} onChange={handleEditingInvitationChange} />
                              <input name="lastName" required placeholder={t("vipFieldLastName")} value={editingInvitationForm.lastName} onChange={handleEditingInvitationChange} />
                              <input name="email" type="email" placeholder={t("vipFieldEmail")} value={editingInvitationForm.email} onChange={handleEditingInvitationChange} />
                              <input
                                name="organization"
                                placeholder={t("vipFieldOrganization")}
                                value={editingInvitationForm.organization}
                                onChange={handleEditingInvitationChange}
                              />
                              <input
                                list="vip-invitation-category-suggestions"
                                name="category"
                                required
                                placeholder={t("vipFieldCategory")}
                                value={editingInvitationForm.category}
                                onChange={handleEditingInvitationChange}
                              />
                              <select
                                name="invitationMailLanguage"
                                value={editingInvitationForm.invitationMailLanguage}
                                onChange={handleEditingInvitationChange}
                              >
                                <option value="fr">{t("vipLangFrench")}</option>
                                <option value="en">{t("vipLangEnglish")}</option>
                              </select>
                              <input
                                name="mailGreetingLabel"
                                placeholder={t("vipFieldMailGreeting")}
                                value={editingInvitationForm.mailGreetingLabel}
                                onChange={handleEditingInvitationChange}
                              />
                              <select
                                name="invitedThisEdition"
                                value={editingInvitationForm.invitedThisEdition}
                                onChange={handleEditingInvitationChange}
                              >
                                <option value="oui">{t("vipInvitedThisEditionYes")}</option>
                                <option value="non">{t("vipInvitedThisEditionNo")}</option>
                              </select>
                              <input name="notes" placeholder={t("vipFieldNotes")} value={editingInvitationForm.notes} onChange={handleEditingInvitationChange} />
                              <div className="vip-inline-editor__actions">
                                <button className="button button--primary" type="submit">
                                  {t("vipSave")}
                                </button>
                                <button className="button button--secondary" type="button" onClick={cancelEditingInvitation}>
                                  {t("vipCancel")}
                                </button>
                              </div>
                            </form>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  ))}
                  {filteredInvitationRows.length === 0 ? (
                    <tr>
                      <td colSpan="6">{t("vipNoInvitations")}</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </Panel>
        </>
      ) : activeVipTab === "registrations" ? (
        <>
          {showRegistrationForm ? (
          <Panel
            title={t("vipAddRegistrantTitle")}
            subtitle={t("vipAddRegistrantSubtitle")}
            actions={<button type="button" className="button button--neutral" onClick={() => setShowRegistrationForm(false)}>{t("vipHideForm")}</button>}
          >
            <form className="auth-form auth-form--compact vip-admin-form vip-admin-form--inline" onSubmit={handleRegistrationSubmit}>
              <AuthFormField label={t("vipFieldFirstName")} required>
                <input name="firstName" required value={registrationForm.firstName} onChange={handleRegistrationChange} />
              </AuthFormField>
              <AuthFormField label={t("vipFieldLastName")} required>
                <input name="lastName" required value={registrationForm.lastName} onChange={handleRegistrationChange} />
              </AuthFormField>
              <AuthFormField label={t("vipFieldOrganization")} required>
                <input name="organization" required value={registrationForm.organization} onChange={handleRegistrationChange} />
              </AuthFormField>
              <AuthFormField label={t("vipFieldEmail")}>
                <input name="email" type="email" value={registrationForm.email} onChange={handleRegistrationChange} />
              </AuthFormField>
              <AuthFormField className="vip-admin-form__phone" label={t("vipFieldPhone")}>
                <PhoneInput name="phone" value={registrationForm.phone} onChange={handleRegistrationChange} />
              </AuthFormField>
              <AuthFormField label={t("vipFieldPickupPoint")} required>
                <select name="pickupPoint" value={registrationForm.pickupPoint} onChange={handleRegistrationChange}>
                  {VIP_PICKUP_POINT_OPTIONS.map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
              </AuthFormField>
              <AuthFormField label={t("vipFieldTour")} required>
                <select name="vipTourChoice" value={registrationForm.vipTourChoice} onChange={handleRegistrationChange}>
                  {VIP_TOUR_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{tourShortLabel(option.value)}</option>
                  ))}
                </select>
              </AuthFormField>
              <AuthFormField className="vip-admin-form__wide" label={t("vipFieldNotes")}>
                <input name="notes" value={registrationForm.notes} onChange={handleRegistrationChange} />
              </AuthFormField>
              <div className="panel-actions vip-admin-form__actions">
                <button className="button button--primary" type="submit">
                  {t("vipAddToRegistrantList")}
                </button>
              </div>
            </form>
          </Panel>
          ) : null}

          <Panel
            title={t("vipRegistrantListTitle")}
            subtitle={t("vipRegistrantListSubtitle")}
            actions={
              <div className="vip-admin-head-actions">
                {showRegistrationForm ? null : (
                  <button type="button" className="button button--primary" onClick={() => setShowRegistrationForm(true)}>
                    + {t("vipNewRegistrant")}
                  </button>
                )}
                <button
                  type="button"
                  className="button button--secondary"
                  onClick={handleExportRegistrationsExcel}
                  disabled={isExportingVip || filteredRegistrationRows.length === 0}
                >
                  {isExportingVip ? "Export…" : `Excel (${filteredRegistrationRows.length})`}
                </button>
              </div>
            }
          >
            <div className="vip-admin-filters">
              <input
                type="search"
                placeholder={t("vipSearchPlaceholder")}
                value={registrationSearch}
                onChange={(event) => setRegistrationSearch(event.target.value)}
              />
              <select value={registrationSourceFilter} onChange={(event) => setRegistrationSourceFilter(event.target.value)}>
                <option value="tous">{t("vipFilterAllSources")}</option>
                <option value="public_form">{t("vipSourcePublicForm")}</option>
                <option value="partner_portal">{t("vipSourcePartnerPortal")}</option>
                <option value="forced_from_invitation">{t("vipSourceForced")}</option>
                <option value="admin_manual">{t("vipSourceAdminManual")}</option>
              </select>
              <select value={registrationBadgeFilter} onChange={(event) => setRegistrationBadgeFilter(event.target.value)}>
                <option value="tous">{t("vipFilterAllAccreditations")}</option>
                <option value="non_imprime">{t("vipBadgeNotPrinted")}</option>
                <option value="en_file">{t("vipBadgeQueued")}</option>
                <option value="imprime">{t("vipBadgePrinted")}</option>
              </select>
              <select value={registrationTourFilter} onChange={(event) => setRegistrationTourFilter(event.target.value)}>
                <option value="tous">{t("vipFilterAllTours")}</option>
                {VIP_TOUR_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {tourShortLabel(option.value)}
                  </option>
                ))}
              </select>
            </div>
            <div className="vip-admin-tour-chips">
              {VIP_TOUR_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`vip-admin-tour-chip${registrationTourFilter === option.value ? " is-active" : ""}`}
                  title={getVipTourChoiceLabel(option.value)}
                  onClick={() => setRegistrationTourFilter(registrationTourFilter === option.value ? "tous" : option.value)}
                >
                  {tourShortLabel(option.value)}
                  <strong>{registrationRows.filter((row) => (row.vipTourChoice || "none") === option.value).length}</strong>
                </button>
              ))}
            </div>
            <div className="table-wrap">
              <table className="data-table data-table--vip">
                <thead>
                  <tr>
                    <th>{t("vipColRegistrant")}</th>
                    <th>{t("vipColSourceMatching")}</th>
                    <th>{t("vipColVipTour")}</th>
                    <th>{t("vipColAccreditation")}</th>
                    <th>{t("vipColPickup")}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRegistrationRows.map((registration) => (
                    <tr key={`${registration.sourceCollection}-${registration.id}`}>
                      <td>
                        <div className="table-stack table-stack--tight">
                          <strong>{buildVipFullName(registration) || "—"}</strong>
                          <span title={registration.email || ""}>{registration.email || "—"}</span>
                          <span className="vip-table-muted">{registration.organization || "—"}</span>
                        </div>
                      </td>
                      <td>
                        <div className="table-stack table-stack--tight">
                          <span>{formatRegistrationSource(registration.sourceType, t)}</span>
                          <span className="vip-table-muted">
                            {registration.matchedInvitation
                              ? `${buildVipFullName(registration.matchedInvitation)} (${registration.matchedInvitation.category || "VIP"})`
                              : t("vipNoMatch")}
                          </span>
                        </div>
                      </td>
                      <td>
                        {/* Tour modifiable ici, quelle que soit la source de l'inscription. */}
                        <select
                          aria-label={t("vipColVipTour")}
                          title={getVipTourChoiceLabel(registration.vipTourChoice || "none")}
                          value={registration.vipTourChoice || "none"}
                          onChange={(event) =>
                            handleRegistrationFieldUpdate(registration, { vipTourChoice: event.target.value })
                          }
                        >
                          {VIP_TOUR_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>{tourShortLabel(option.value)}</option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <select
                          aria-label={t("vipColAccreditation")}
                          value={registration.badgePrintStatus || "non_imprime"}
                          onChange={(event) =>
                            handleRegistrationFieldUpdate(registration, { badgePrintStatus: event.target.value })
                          }
                        >
                          <option value="non_imprime">{t("vipBadgeNotPrinted")}</option>
                          <option value="en_file">{t("vipBadgeQueued")}</option>
                          <option value="imprime">{t("vipBadgePrinted")}</option>
                        </select>
                      </td>
                      <td>
                        <select
                          value={registration.pickupPoint || "Accueil VIP"}
                          onChange={(event) =>
                            handleRegistrationFieldUpdate(registration, { pickupPoint: event.target.value })
                          }
                        >
                          {VIP_PICKUP_POINT_OPTIONS.map((option) => (
                            <option key={option} value={option}>{option}</option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                  {filteredRegistrationRows.length === 0 ? (
                    <tr>
                      <td colSpan="5">{t("vipNoRegistrations")}</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </Panel>
        </>
      ) : (
        <>
          {pendingPlaceRequests.length ? (
            <Panel title={t("vipPlaceRequestsTitle")} subtitle={t("vipPlaceRequestsSubtitle")}>
              <div className="table-wrap">
                <table className="data-table data-table--vip">
                  <thead>
                    <tr>
                      <th>{t("vipColOrganization")}</th>
                      <th>{t("vipColRequest")}</th>
                      <th>{t("vipColRequestedBy")}</th>
                      <th>{t("vipColMessage")}</th>
                      <th>{t("vipColActions")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pendingPlaceRequests.map((request) => (
                      <tr key={`${request.portalId}-${request.id}`}>
                        <td><strong>{request.portalName}</strong></td>
                        <td>
                          +{request.requestedPlaces}{" "}
                          {request.placeType === "standard" ? t("vipPlacesStandard") : t("vipPlacesVip")}
                        </td>
                        <td>
                          <div className="table-stack table-stack--tight">
                            <span>{buildVipFullName(request) || "—"}</span>
                            <span className="vip-table-muted">{request.email || "—"}</span>
                          </div>
                        </td>
                        <td>{request.message || <span className="vip-table-muted">—</span>}</td>
                        <td>
                          <div className="vip-admin-actions vip-admin-actions--compact">
                            <button className="button button--primary" type="button" onClick={() => handlePlaceRequestDecision(request, true)}>
                              {t("vipAccept")}
                            </button>
                            <button className="button button--secondary" type="button" onClick={() => handlePlaceRequestDecision(request, false)}>
                              {t("vipRefuse")}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          ) : null}

          <Panel
            title={editingPartnerPortalId ? t("vipEditPortalTitle") : t("vipCreatePortalTitle")}
            subtitle={t("vipCreatePortalSubtitle")}
          >
            <form className="auth-form auth-form--compact vip-admin-form vip-admin-form--inline" onSubmit={handlePartnerPortalSubmit}>
              <AuthFormField label={t("vipFieldOrganization")} required>
                <input name="organizationName" required value={partnerPortalForm.organizationName} onChange={handlePartnerPortalChange} />
              </AuthFormField>
              <AuthFormField label={t("vipFieldSlugUrl")} hint={t("vipFieldSlugUrlHint")}>
                <input
                  name="portalId"
                  disabled={Boolean(editingPartnerPortalId)}
                  placeholder={t("vipSlugPlaceholder")}
                  value={partnerPortalForm.portalId}
                  onChange={handlePartnerPortalChange}
                />
              </AuthFormField>
              <AuthFormField label={t("vipFieldVipPlacesCap")} hint={t("vipFieldVipPlacesCapHint")}>
                <input name="vipPlacesCap" type="number" min="0" step="1" value={partnerPortalForm.vipPlacesCap} onChange={handlePartnerPortalChange} />
              </AuthFormField>
              <AuthFormField label={t("vipFieldStandardPlacesCap")} hint={t("vipFieldStandardPlacesCapHint")}>
                <input name="standardPlacesCap" type="number" min="0" step="1" value={partnerPortalForm.standardPlacesCap} onChange={handlePartnerPortalChange} />
              </AuthFormField>
              <AuthFormField label={t("vipFieldCompanions")} hint={t("vipFieldCompanionsHint")}>
                <select
                  name="companionsAllowed"
                  value={partnerPortalForm.companionsAllowed === false ? "no" : "yes"}
                  onChange={(event) => setPartnerPortalForm((current) => ({ ...current, companionsAllowed: event.target.value === "yes" }))}
                >
                  <option value="yes">{t("vipCompanionsYes")}</option>
                  <option value="no">{t("vipCompanionsNo")}</option>
                </select>
              </AuthFormField>
              <AuthFormField label={t("vipFieldPassword")} hint={t("vipFieldPasswordHint")}>
                <input name="accessPassword" type="text" value={partnerPortalForm.accessPassword} onChange={handlePartnerPortalChange} />
              </AuthFormField>
              <AuthFormField className="vip-admin-form__wide" label={t("vipFieldNotes")}>
                <input name="notes" value={partnerPortalForm.notes} onChange={handlePartnerPortalChange} />
              </AuthFormField>
              <fieldset className="vip-portal-contacts-editor">
                <legend>{t("vipFieldContacts")}</legend>
                {partnerPortalForm.contacts.map((contact, index) => (
                  <div className="vip-portal-contacts-editor__row" key={index}>
                    <input
                      aria-label={t("vipFieldFirstName")}
                      placeholder={`${t("vipFieldFirstName")}${index === 0 ? " *" : ""}`}
                      name="firstName"
                      value={contact.firstName}
                      onChange={(event) => handlePortalContactChange(index, event)}
                    />
                    <input
                      aria-label={t("vipFieldLastName")}
                      placeholder={t("vipFieldLastName")}
                      name="lastName"
                      value={contact.lastName}
                      onChange={(event) => handlePortalContactChange(index, event)}
                    />
                    <input
                      aria-label={t("vipFieldContactEmail")}
                      placeholder={t("vipFieldContactEmail")}
                      name="email"
                      type="email"
                      value={contact.email}
                      onChange={(event) => handlePortalContactChange(index, event)}
                    />
                    <PhoneInput name="phone" value={contact.phone} onChange={(event) => handlePortalContactChange(index, event)} />
                    <button
                      className="button button--neutral vip-portal-contacts-editor__remove"
                      type="button"
                      aria-label={t("vipRemoveContact")}
                      title={t("vipRemoveContact")}
                      onClick={() => removePortalContact(index)}
                    >
                      ×
                    </button>
                  </div>
                ))}
                <button className="button button--neutral vip-portal-contacts-editor__add" type="button" onClick={addPortalContact}>
                  {t("vipAddContact")}
                </button>
              </fieldset>
              <fieldset className="vip-portal-contacts-editor">
                <legend>{t("vipFieldMeetingContact")}</legend>
                <div className="vip-portal-contacts-editor__row">
                  <input
                    aria-label={t("vipFieldFirstName")}
                    placeholder={t("vipFieldFirstName")}
                    name="firstName"
                    value={partnerPortalForm.meetingContact?.firstName || ""}
                    onChange={handleMeetingContactChange}
                  />
                  <input
                    aria-label={t("vipFieldLastName")}
                    placeholder={t("vipFieldLastName")}
                    name="lastName"
                    value={partnerPortalForm.meetingContact?.lastName || ""}
                    onChange={handleMeetingContactChange}
                  />
                  <input
                    aria-label={t("vipFieldContactEmail")}
                    placeholder={t("vipFieldContactEmail")}
                    name="email"
                    type="email"
                    value={partnerPortalForm.meetingContact?.email || ""}
                    onChange={handleMeetingContactChange}
                  />
                  <PhoneInput name="phone" value={partnerPortalForm.meetingContact?.phone || ""} onChange={handleMeetingContactChange} />
                </div>
                <small className="vip-portal-contacts-editor__hint">{t("vipFieldMeetingContactHint")}</small>
              </fieldset>
              <div className="panel-actions vip-admin-form__actions">
                <button className="button button--primary" type="submit">
                  {editingPartnerPortalId ? t("vipSavePortal") : t("vipCreatePortal")}
                </button>
                {editingPartnerPortalId ? (
                  <button className="button button--secondary" type="button" onClick={cancelEditingPartnerPortal}>
                    {t("vipCancel")}
                  </button>
                ) : null}
              </div>
            </form>
          </Panel>

          <Panel title={t("vipPortalListTitle")} subtitle={t("vipPortalListSubtitle")}>
            <div className="table-wrap">
              <table className="data-table data-table--vip data-table--vip-portals">
                <thead>
                  <tr>
                    <th>{t("vipColOrganization")}</th>
                    <th>{t("vipColContact")}</th>
                    <th>{t("vipColPlaces")}</th>
                    <th>{t("vipColAccess")}</th>
                    <th>{t("vipColUrl")}</th>
                  </tr>
                </thead>
                <tbody>
                  {partnerPortalRows.map((portal) => (
                    <tr key={portal.id}>
                      <td>
                        <div className="table-stack table-stack--tight">
                          <strong>{portal.organizationName || portal.id}</strong>
                          <span className="vip-table-muted">{portal.id}</span>
                          <button className="button button--secondary vip-portal-edit-btn" type="button" onClick={() => startEditingPartnerPortal(portal)}>
                            {t("vipEdit")}
                          </button>
                        </div>
                      </td>
                      <td>
                        {portal.contactList.length ? (
                          <div className="vip-portal-contact-list">
                            {portal.contactList.map((contact, index) => (
                              <div className="table-stack table-stack--tight" key={index}>
                                <span>{buildVipFullName(contact) || "—"}</span>
                                <span className="vip-table-muted">
                                  {[contact.email, contact.phone].filter(Boolean).join(" · ") || "—"}
                                </span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>
                        <div className="table-stack table-stack--tight">
                          <span>
                            {t("vipPlacesVip")} : {formatPlaces(portal.places.used.vip, portal.places.caps.vip)}{" "}
                            <span className="vip-table-muted">
                              {t("vipInvitationsShort")} · {portal.places.seats.vip} {t("vipPeopleShort")}
                            </span>
                          </span>
                          {portal.places.caps.standard > 0 || portal.places.used.standard ? (
                            <span>
                              {t("vipPlacesStandard")} : {formatPlaces(portal.places.used.standard, portal.places.caps.standard)}{" "}
                              <span className="vip-table-muted">
                                {t("vipInvitationsShort")} · {portal.places.seats.standard} {t("vipPeopleShort")}
                              </span>
                            </span>
                          ) : null}
                          <span className="vip-table-muted">
                            {vipPortalAllowsCompanions(portal) ? t("vipCompanionsYesShort") : t("vipCompanionsNoShort")}
                          </span>
                        </div>
                      </td>
                      <td>
                        <div className="table-stack table-stack--tight">
                          <span>{portal.hasPassword ? t("vipPasswordProtected") : t("vipLinkOnlyNoPassword")}</span>
                          <span className="vip-table-muted">{portal.notes || "—"}</span>
                        </div>
                      </td>
                      <td>
                        <div className="vip-portal-link-cell">
                          <span className="vip-table-muted" title={portal.portalUrl}>/vip/orga/{portal.id}</span>
                          <span className="vip-portal-link-cell__actions">
                            <button
                              className="button button--neutral"
                              type="button"
                              onClick={() => {
                                navigator.clipboard?.writeText(portal.portalUrl);
                                setStatusMessage(t("vipLinkCopied").replace("{name}", portal.organizationName || portal.id));
                              }}
                            >
                              {t("vipCopyLink")}
                            </button>
                            <a href={portal.portalPreviewUrl || portal.portalUrl} target="_blank" rel="noreferrer">
                              {t("vipOpenLink")}
                            </a>
                          </span>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {partnerPortalRows.length === 0 ? (
                    <tr>
                      <td colSpan="5">{t("vipNoPortals")}</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}

export { VipAdminPage };
