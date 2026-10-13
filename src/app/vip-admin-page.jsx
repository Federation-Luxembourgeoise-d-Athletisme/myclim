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
  buildVipFullName,
  buildVipPortalId,
  buildVipRegistrationPayload,
  createEmptyVipAdminRegistrationData,
  createEmptyVipInvitationData,
  createEmptyVipPartnerPortalData,
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

function formatBadgeStatus(status, t) {
  switch (String(status || "").trim().toLowerCase()) {
    case "en_file":
      return t("vipBadgeQueued");
    case "imprime":
      return t("vipBadgePrinted");
    default:
      return t("vipBadgeNotPrinted");
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
  const [partnerPortals, setPartnerPortals] = useState([]);
  const [partnerPortalSecrets, setPartnerPortalSecrets] = useState({});
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
      [...publicRegistrations, ...partnerRegistrations, ...adminRegistrations].sort((left, right) => {
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
      contactName: portal.contactName || "",
      contactPhone: portal.contactPhone || "",
      contactEmail: portal.contactEmail || "",
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

    const payload = {
      organizationName: partnerPortalForm.organizationName,
      contactName: partnerPortalForm.contactName,
      contactPhone: partnerPortalForm.contactPhone,
      contactEmail: String(partnerPortalForm.contactEmail || "").trim().toLowerCase(),
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
          guestName: buildVipFullName({ firstName: registration.guestFirstName, lastName: registration.guestLastName }),
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
          portalUrl: buildVipPartnerPortalUrl(portal.id),
          portalPreviewUrl: canOpenVipPartnerPortalLocally() ? buildVipPartnerPortalPath(portal.id) : "",
        })),
    [partnerPortals],
  );

  return (
    <div className="stacked-entry">
      <Panel
        title={t("vipAdminTitle")}
        subtitle={t("vipAdminSubtitle").replace("{edition}", activeEditionLabel)}
      >
        <div className="vip-admin-stats">
          <article className="vip-admin-stat-card">
            <strong>{invitationRows.length}</strong>
            <span>{t("vipAdminStatInvitations")}</span>
          </article>
          <article className="vip-admin-stat-card">
            <strong>{registrationRows.length}</strong>
            <span>{t("vipAdminStatRegistrations")}</span>
          </article>
          <article className="vip-admin-stat-card">
            <strong>{registrationRows.filter((row) => row.badgePrintStatus === "en_file").length}</strong>
            <span>{t("vipAdminStatQueued")}</span>
          </article>
          <article className="vip-admin-stat-card">
            <strong>{registrationRows.filter((row) => row.badgePrintStatus === "imprime").length}</strong>
            <span>{t("vipAdminStatPrinted")}</span>
          </article>
        </div>
        {editionLoading || loading ? <p>{t("vipAdminLoading")}</p> : null}
        {error ? <p className="form-error">{error}</p> : null}
        {statusMessage ? <p className="panel-note panel-note--success">{statusMessage}</p> : null}
        <p className="panel-note">
          {t("vipAdminImportNotePrefix")} <strong>{vipImport2027.metadata.recordCount}</strong>{" "}
          {t("vipAdminImportNoteSuffix")}
        </p>
      </Panel>

      <Panel title={t("vipExplainerTitle")} subtitle={t("vipExplainerSubtitle")}>
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
      </Panel>

      <div className="admin-subtabs" role="tablist" aria-label={t("vipTabNavAriaLabel")}>
        <button
          className={`admin-subtab ${activeVipTab === "invitations" ? "admin-subtab--active" : ""}`}
          type="button"
          onClick={() => setActiveVipTab("invitations")}
        >
          {t("vipTabInvitations")}
        </button>
        <button
          className={`admin-subtab ${activeVipTab === "registrations" ? "admin-subtab--active" : ""}`}
          type="button"
          onClick={() => setActiveVipTab("registrations")}
        >
          {t("vipTabRegistrations")}
        </button>
        <button
          className={`admin-subtab ${activeVipTab === "partner-portals" ? "admin-subtab--active" : ""}`}
          type="button"
          onClick={() => setActiveVipTab("partner-portals")}
        >
          {t("vipTabPartnerPortals")}
        </button>
      </div>

      {activeVipTab === "invitations" ? (
        <>
          <Panel title={t("vipAddInvitationTitle")} subtitle={t("vipAddInvitationSubtitle")}>
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
              <AuthFormField label={t("vipFieldCategory")} required hint={t("vipFieldCategoryHint")}>
                <input
                  list="vip-invitation-category-suggestions"
                  name="category"
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
              <AuthFormField label={t("vipFieldMailGreeting")} hint={t("vipFieldMailGreetingHint")}>
                <input
                  name="mailGreetingLabel"
                  placeholder={t("vipMailGreetingPlaceholder")}
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

          <Panel
            title={t("vipInvitationListTitle")}
            subtitle={t("vipInvitationListSubtitle")}
            actions={
              <button
                type="button"
                className="button button--secondary"
                onClick={handleExportInvitationsExcel}
                disabled={isExportingVip || filteredInvitationRows.length === 0}
              >
                {isExportingVip ? "Export…" : `Exporter Excel (${filteredInvitationRows.length})`}
              </button>
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
          <Panel title={t("vipAddRegistrantTitle")} subtitle={t("vipAddRegistrantSubtitle")}>
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

          <Panel
            title={t("vipRegistrantListTitle")}
            subtitle={t("vipRegistrantListSubtitle")}
            actions={
              <button
                type="button"
                className="button button--secondary"
                onClick={handleExportRegistrationsExcel}
                disabled={isExportingVip || filteredRegistrationRows.length === 0}
              >
                {isExportingVip ? "Export…" : `Exporter Excel (${filteredRegistrationRows.length})`}
              </button>
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
                    {getVipTourChoiceLabel(option.value)}
                  </option>
                ))}
              </select>
            </div>
            <div className="vip-admin-stats">
              {VIP_TOUR_OPTIONS.map((option) => (
                <article key={option.value} className="vip-admin-stat-card">
                  <strong>
                    {registrationRows.filter((row) => (row.vipTourChoice || "none") === option.value).length}
                  </strong>
                  <span>{getVipTourChoiceLabel(option.value)}</span>
                </article>
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
                          <span>{registration.email || "—"}</span>
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
                      <td>{getVipTourChoiceLabel(registration.vipTourChoice)}</td>
                      <td>
                        <div className="vip-admin-inline-field">
                          <select
                            value={registration.badgePrintStatus || "non_imprime"}
                            onChange={(event) =>
                              handleRegistrationFieldUpdate(registration, { badgePrintStatus: event.target.value })
                            }
                          >
                            <option value="non_imprime">{t("vipBadgeNotPrinted")}</option>
                            <option value="en_file">{t("vipBadgeQueued")}</option>
                            <option value="imprime">{t("vipBadgePrinted")}</option>
                          </select>
                          <span className="panel-note">{formatBadgeStatus(registration.badgePrintStatus, t)}</span>
                        </div>
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
              <AuthFormField label={t("vipFieldContact")} required>
                <input name="contactName" required value={partnerPortalForm.contactName} onChange={handlePartnerPortalChange} />
              </AuthFormField>
              <AuthFormField label={t("vipFieldContactEmail")}>
                <input name="contactEmail" type="email" value={partnerPortalForm.contactEmail} onChange={handlePartnerPortalChange} />
              </AuthFormField>
              <AuthFormField className="vip-admin-form__phone" label={t("vipFieldContactPhone")}>
                <PhoneInput name="contactPhone" value={partnerPortalForm.contactPhone} onChange={handlePartnerPortalChange} />
              </AuthFormField>
              <AuthFormField label={t("vipFieldPassword")} hint={t("vipFieldPasswordHint")}>
                <input name="accessPassword" type="text" value={partnerPortalForm.accessPassword} onChange={handlePartnerPortalChange} />
              </AuthFormField>
              <AuthFormField className="vip-admin-form__wide" label={t("vipFieldNotes")}>
                <input name="notes" value={partnerPortalForm.notes} onChange={handlePartnerPortalChange} />
              </AuthFormField>
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
              <table className="data-table data-table--vip">
                <thead>
                  <tr>
                    <th>{t("vipColOrganization")}</th>
                    <th>{t("vipColContact")}</th>
                    <th>{t("vipColAccess")}</th>
                    <th>{t("vipColUrl")}</th>
                    <th>{t("vipColActions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {partnerPortalRows.map((portal) => (
                    <tr key={portal.id}>
                      <td>
                        <div className="table-stack table-stack--tight">
                          <strong>{portal.organizationName || portal.id}</strong>
                          <span className="vip-table-muted">{portal.id}</span>
                        </div>
                      </td>
                      <td>
                        <div className="table-stack table-stack--tight">
                          <span>{portal.contactName || "—"}</span>
                          <span className="vip-table-muted">{portal.contactEmail || "—"}</span>
                          <span className="vip-table-muted">{portal.contactPhone || "—"}</span>
                        </div>
                      </td>
                      <td>
                        <div className="table-stack table-stack--tight">
                          <span>{portal.hasPassword ? t("vipPasswordProtected") : t("vipLinkOnlyNoPassword")}</span>
                          <span className="vip-table-muted">{portal.notes || "—"}</span>
                        </div>
                      </td>
                      <td>
                        <div className="table-stack table-stack--tight">
                          <span>{portal.portalUrl}</span>
                          {portal.portalPreviewUrl ? (
                            <a href={portal.portalPreviewUrl} target="_blank" rel="noreferrer">
                              {t("vipOpenLocalPreview")}
                            </a>
                          ) : (
                            <a href={portal.portalUrl} target="_blank" rel="noreferrer">
                              {t("vipOpenPublicLink")}
                            </a>
                          )}
                        </div>
                      </td>
                      <td>
                        <div className="vip-admin-actions vip-admin-actions--compact">
                          <button className="button button--secondary" type="button" onClick={() => startEditingPartnerPortal(portal)}>
                            {t("vipEdit")}
                          </button>
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
