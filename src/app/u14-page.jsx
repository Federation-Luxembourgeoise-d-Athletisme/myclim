import { useEffect, useMemo, useState } from "react";
import { collection } from "firebase/firestore";
import { useLocation, useNavigate } from "react-router-dom";
import {
  U14_PRACTICAL_INFO_DOC_PATH,
  U14_RACE_DEFINITIONS,
  buildU14AllocationSnapshot,
  buildU14RequestRecord,
  formatDateForDisplay,
  formatDateTimeForDisplay,
  formatU14RequestStatusLabel,
  getAdminApprovalLabel,
  getParentDecisionLabel,
  getTimestampMs,
  getU14ConfirmationDeadline,
  getU14PracticalRoleKey,
  getU14WorkflowStatusLabel,
  normalizeComparableValue,
} from "./u14-helpers";
import {
  useU14ChildrenList,
  useU14PracticalInfoConfiguration,
  useU14ProtectedInvites,
  useU14ProtectedSettings,
  useU14RequestsList,
} from "./u14-hooks";
import { U14_PROTECTED_INVITES_COLLECTION } from "./u14-protected";
import { U14ProtectedTab } from "./u14-protected-tab";
import { useActiveEdition } from "./edition";
import { useMeetingEditions } from "./meeting-history-hooks";
import { db } from "../services/firebase";

const U14_TAB_PATHS = {
  preprogram: "/app/u14",
  protected: "/app/u14/places-protegees",
  basket: "/app/u14/porte-panier",
  timeline: "/app/u14/chronologie",
  practical: "/app/u14/infos-pratiques",
};

function getU14TabFromPath(pathname) {
  const normalizedPath = String(pathname || "").replace(/\/+$/, "") || "/app/u14";

  if (normalizedPath.endsWith("/porte-panier")) return "basket";
  if (normalizedPath.endsWith("/places-protegees")) return "protected";
  if (normalizedPath.endsWith("/chronologie")) return "timeline";
  if (normalizedPath.endsWith("/infos-pratiques")) return "practical";
  return "preprogram";
}

function getU14PageHeader(activeTab, basketRequestsCount) {
  switch (activeTab) {
    case "basket":
      return {
        eyebrow: "Module Pré-programme",
        title: "Porte-panier",
        description: `Gestion séparée des demandes porte-panier et du suivi parent (${basketRequestsCount} demande(s)).`,
      };
    case "protected":
      return {
        eyebrow: "Module Pré-programme",
        title: "Places protégées",
        description: "Réserves par catégorie, invitations des enfants protégés et suivi de leurs inscriptions.",
      };
    case "timeline":
      return {
        eyebrow: "Module Pré-programme",
        title: "Chronologie",
        description: "Vue chronologique de toutes les demandes pré-programme et porte-panier.",
      };
    case "practical":
      return {
        eyebrow: "Module Pré-programme",
        title: "Infos pratiques",
        description: "Messages pratiques envoyés aux familles pour le pré-programme et le porte-panier.",
      };
    default:
      return {
        eyebrow: "Module U12 / U14",
        title: "U12 / U14",
        description: "Gestion des demandes U12 / U14, des places protégées et du suivi parent.",
      };
  }
}

// Décision du parent, avec la date limite de confirmation (10 jours après la
// validation) tant qu'il n'a pas répondu ; en rouge une fois dépassée.
function ParentDecisionCell({ request, now }) {
  const label = getParentDecisionLabel(request.parentDecisionStatus);
  const isPending = !["confirmed", "declined"].includes(normalizeComparableValue(request.parentDecisionStatus));
  const deadlineMs = getTimestampMs(request.confirmationDeadline);
  if (!isPending || !deadlineMs) return label;
  const isOverdue = deadlineMs < now;
  return (
    <div className="table-stack">
      <span>{label}</span>
      <span className={isOverdue ? "status-pill status-pill--danger" : "parent-request-note"}>
        {isOverdue ? "Délai dépassé le " : "Avant le "}
        {formatDateForDisplay(request.confirmationDeadline)}
      </span>
    </div>
  );
}

function U14Page(props) {
  const {
    AuthFormField,
    DataTable,
    Panel,
    doc,
    getDocs,
    loadMailQueueModule,
    serverTimestamp,
    setDoc,
    syncU14RaceAllocations,
    updateDoc,
  } = props;
  const location = useLocation();
  const navigate = useNavigate();
  const { requests, loading: requestsLoading, error: requestsError } = useU14RequestsList(true);
  const { children, loading: childrenLoading, error: childrenError } = useU14ChildrenList(true);
  const { invites: protectedInvites, loading: protectedInvitesLoading, error: protectedInvitesError } = useU14ProtectedInvites(true);
  const { settings: protectedSettings } = useU14ProtectedSettings(true);
  const {
    preprogram: preprogramPracticalInfo,
    porte_panier: basketPracticalInfo,
    loading: practicalInfoLoading,
    error: practicalInfoError,
  } = useU14PracticalInfoConfiguration(true);
  // Date et lieu de l'édition active, repris dans les mails d'acceptation.
  const { activeEditionId } = useActiveEdition();
  const { editions } = useMeetingEditions();
  const activeEdition = editions.find((edition) => String(edition.year || edition.id) === String(activeEditionId)) || null;
  const [pageOpenedAt] = useState(() => Date.now());
  const acceptanceMailContext = {
    eventDate: activeEdition?.date || null,
    venue: activeEdition?.venue || "",
    editionYear: activeEdition?.year || activeEditionId,
  };
  const [selectedRaceCode, setSelectedRaceCode] = useState(U14_RACE_DEFINITIONS[0]?.code || "");
  const [activeU14Tab, setActiveU14Tab] = useState(() => getU14TabFromPath(location.pathname));
  const [practicalInfoForm, setPracticalInfoForm] = useState({ preprogram: "", porte_panier: "" });
  const [requestSearch, setRequestSearch] = useState("");
  const [requestStatusFilter, setRequestStatusFilter] = useState("Tous");
  const [requestRaceFilter, setRequestRaceFilter] = useState("Toutes");
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setPracticalInfoForm({
        preprogram: preprogramPracticalInfo,
        porte_panier: basketPracticalInfo,
      });
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [basketPracticalInfo, preprogramPracticalInfo]);

  useEffect(() => {
    const nextTab = getU14TabFromPath(location.pathname);
    if (nextTab === activeU14Tab) return;
    setActiveU14Tab(nextTab);
  }, [activeU14Tab, location.pathname]);

  function openU14Tab(tabId) {
    const nextPath = U14_TAB_PATHS[tabId] || U14_TAB_PATHS.preprogram;
    setActiveU14Tab(tabId);
    if (location.pathname !== nextPath) {
      navigate(nextPath);
    }
  }
  const dataLoading = requestsLoading || childrenLoading || protectedInvitesLoading;
  const { requestRecords, raceSummaries, reserveByPool, claimedByPool, reserveReleased } = useMemo(
    () => buildU14AllocationSnapshot({ requests, children, protectedInvites, protectedSettings, now: pageOpenedAt }),
    [children, pageOpenedAt, protectedInvites, protectedSettings, requests],
  );
  // Tous les recalculs passent par ici, avec les invitations et réserves à jour.
  function syncAllocations(overrides = {}) {
    return syncU14RaceAllocations({ requests, children, protectedInvites, protectedSettings, ...overrides });
  }
  const selectedRaceSummary = raceSummaries.find((summary) => summary.code === selectedRaceCode) || raceSummaries[0] || null;
  const selectedRaceRequests = useMemo(
    () =>
      requestRecords
        .filter((request) => request.raceCode === selectedRaceCode && request.requestType !== "porte_panier")
        .sort((left, right) => {
          const leftStatus = normalizeComparableValue(left.status);
          const rightStatus = normalizeComparableValue(right.status);
          const statusPriority = {
            confirmed: 0,
            waitlisted: 1,
            submitted: 2,
            declined: 3,
            rejected: 4,
          };
          const priorityDifference =
            (statusPriority[leftStatus] ?? 99) - (statusPriority[rightStatus] ?? 99);
          if (priorityDifference !== 0) return priorityDifference;
          if (left.submittedAtMs !== right.submittedAtMs) return left.submittedAtMs - right.submittedAtMs;
          return left.childName.localeCompare(right.childName, "fr");
        }),
    [requestRecords, selectedRaceCode],
  );
  const basketRequests = useMemo(
    () =>
      requestRecords
        .filter((request) => request.requestType === "porte_panier")
        .sort((left, right) => left.submittedAtMs - right.submittedAtMs),
    [requestRecords],
  );
  // Enfants montés tout seuls de la liste d'attente (recalcul serveur après un
  // désistement) : retenus, mais le mail d'acceptation attend la validation.
  const promotedToApprove = useMemo(
    () =>
      requestRecords
        .filter(
          (request) =>
            request.promotedFromWaitlistAt &&
            normalizeComparableValue(request.status) === "confirmed" &&
            normalizeComparableValue(request.adminApprovalStatus) !== "approved",
        )
        .sort((left, right) => getTimestampMs(left.promotedFromWaitlistAt) - getTimestampMs(right.promotedFromWaitlistAt)),
    [requestRecords],
  );
  // Alertes : parents retenus qui n'ont pas confirmé dans les 10 jours.
  const overdueConfirmations = useMemo(
    () =>
      requestRecords
        .filter(
          (request) =>
            request.adminApprovalStatus === "approved" &&
            !["confirmed", "declined"].includes(normalizeComparableValue(request.parentDecisionStatus)) &&
            normalizeComparableValue(request.status) !== "declined" &&
            getTimestampMs(request.confirmationDeadline) &&
            getTimestampMs(request.confirmationDeadline) < pageOpenedAt,
        )
        .sort((left, right) => getTimestampMs(left.confirmationDeadline) - getTimestampMs(right.confirmationDeadline)),
    [pageOpenedAt, requestRecords],
  );
  const pageHeader = useMemo(
    () => getU14PageHeader(activeU14Tab, basketRequests.length),
    [activeU14Tab, basketRequests.length],
  );
  const chronologicalRequests = useMemo(
    () =>
      [...requestRecords]
        .sort((left, right) => left.submittedAtMs - right.submittedAtMs)
        .map((request) => ({
          child: request.childName,
          type:
            request.requestType === "porte_panier"
              ? "Porte-panier"
              : request.requestType === "preprogram_ou_porte_panier"
                ? "Pré-programme ou porte-panier"
                : "Pré-programme",
          race: request.requestType === "porte_panier" ? "-" : request.raceLabel,
          parent: request.parentName,
          submittedAt: request.submittedAtMs ? formatDateTimeForDisplay(request.submittedAtMs) : "-",
          status: getU14WorkflowStatusLabel(request),
          position:
            normalizeComparableValue(request.status) === "confirmed"
              ? `Accepté${request.acceptedPosition ? ` (${request.acceptedPosition})` : ""}`
              : request.waitlistPosition
                ? `Attente ${request.waitlistPosition}`
                : "-",
          admin:
            normalizeComparableValue(request.adminApprovalStatus) === "approved"
              ? getAdminApprovalLabel(request.adminApprovalStatus)
              : "Validation admin requise",
        })),
    [requestRecords],
  );
  const filteredAdminRequests = useMemo(() => {
    const normalizedSearch = normalizeComparableValue(requestSearch);

    return requestRecords
      .filter((request) => request.requestType !== "porte_panier")
      .filter((request) => {
        if (requestStatusFilter === "Tous") return true;
        return getU14WorkflowStatusLabel(request) === requestStatusFilter;
      })
      .filter((request) => {
        if (requestRaceFilter === "Toutes") return true;
        return request.raceCode === requestRaceFilter;
      })
      .filter((request) => {
        if (!normalizedSearch) return true;

        const haystack = normalizeComparableValue(
          [
            request.childName,
            request.parentName,
            request.raceLabel,
            request.club,
            request.bibNumber,
            getU14WorkflowStatusLabel(request),
          ]
            .filter(Boolean)
            .join(" "),
        );

        return haystack.includes(normalizedSearch);
      })
      .sort((left, right) => left.raceCode.localeCompare(right.raceCode) || left.submittedAtMs - right.submittedAtMs);
  }, [
    requestRaceFilter,
    requestRecords,
    requestSearch,
    requestStatusFilter,
  ]);
  const selectedRaceTableRows = useMemo(() => {
    const blockedPlaces = selectedRaceSummary?.blockedPlaces || 0;
    const protectedRows = Array.from({ length: blockedPlaces }, (_, index) => ({
      id: `reserve-${index}`,
      type: "Place protégée",
      child: "Réservée — en attente d'un enfant invité",
      club: "-",
      bib: "-",
      status: "Bloquée",
      position: `Réserve ${index + 1}`,
      parent: "-",
      submittedAt: "-",
    }));

    const requestRows = selectedRaceRequests.map((request) => ({
      type: "Demande",
      child: request.childName,
      club: request.club || "-",
      bib: request.bibNumber || "-",
      status: formatU14RequestStatusLabel(request.status),
      position:
        normalizeComparableValue(request.status) === "confirmed"
          ? request.acceptedPosition
            ? `Accepté (${request.acceptedPosition})`
            : "Accepté"
          : normalizeComparableValue(request.status) === "waitlisted"
            ? `Attente ${request.waitlistPosition || request.queuePosition || "?"}`
            : "-",
      parent: request.parentName || "-",
      submittedAt: request.submittedAtMs
        ? formatDateTimeForDisplay(request.submittedAtMs)
        : "-",
    }));

    return [...protectedRows, ...requestRows];
  }, [selectedRaceRequests, selectedRaceSummary]);

  // Relance d'un parent qui n'a pas confirmé à temps : nouveau délai de
  // 10 jours et nouveau mail d'acceptation (course ou porte-panier).
  async function handleRemindParent(request) {
    setErrorMessage("");
    setStatusMessage("");
    setIsSaving(true);

    try {
      const confirmationDeadline = getU14ConfirmationDeadline();
      const isBasket = getU14PracticalRoleKey(request) === "porte_panier";
      await updateDoc(doc(db, "u14Requests", request.id), {
        confirmationDeadline,
        remindedAt: serverTimestamp(),
        reminderCount: Number(request.reminderCount || 0) + 1,
      });

      if (request.parentEmail) {
        const mailQueue = await loadMailQueueModule();
        const buildMail = isBasket ? mailQueue.buildU14BasketAcceptanceMail : mailQueue.buildU14PreprogramAcceptanceMail;
        await mailQueue.enqueueTransactionalMail(
          buildMail({
            ...acceptanceMailContext,
            parentEmail: request.parentEmail,
            parentFirstName: request.parentFirstName,
            childName: request.childName,
            raceLabel: request.raceLabel,
            practicalInfo: isBasket ? basketPracticalInfo : preprogramPracticalInfo,
            confirmationDeadline,
          }),
        );
      }

      setStatusMessage(`Relance envoyée au parent de ${request.childName}, nouveau délai : ${formatDateForDisplay(confirmationDeadline)}.`);
    } catch {
      setErrorMessage("Impossible d'envoyer la relance pour le moment.");
    } finally {
      setIsSaving(false);
    }
  }

  // Libération décidée par l'équipe après un délai dépassé : même effet qu'un
  // désistement du parent, puis recalcul pour faire monter la liste d'attente.
  async function handleReleaseOverdueRequest(request) {
    if (!window.confirm(`Libérer la place de ${request.childName} ? La demande passe en « Désisté » et la liste d'attente est recalculée.`)) {
      return;
    }

    setErrorMessage("");
    setStatusMessage("");
    setIsSaving(true);

    try {
      const declinedFields = {
        status: "declined",
        parentDecisionStatus: "declined",
        withdrawalReason: "Délai de confirmation dépassé (libéré par l'organisation)",
        declinedByAdmin: true,
        acceptedPosition: null,
        waitlistPosition: null,
        queuePosition: null,
      };
      await updateDoc(doc(db, "u14Requests", request.id), { ...declinedFields, parentDecisionAt: serverTimestamp() });

      await syncAllocations({
        requests: requests.map((current) => (current.id === request.id ? { ...current, ...declinedFields } : current)),
      });
      setStatusMessage(`Place de ${request.childName} libérée. Pensez à valider l'enfant qui monte de la liste d'attente.`);
    } catch {
      setErrorMessage("Impossible de libérer cette place pour le moment.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleRecalculateAllocations() {
    setErrorMessage("");
    setStatusMessage("");
    setIsSaving(true);

    try {
      await syncAllocations();
      setStatusMessage("Les statuts, places acceptées et listes d'attente ont été recalculés.");
    } catch {
      setErrorMessage("Le recalcul automatique a échoué.");
    } finally {
      setIsSaving(false);
    }
  }

  async function approvePreprogramRequest(request) {
    const confirmationDeadline = getU14ConfirmationDeadline();
    await updateDoc(doc(db, "u14Requests", request.id), {
      adminApprovalStatus: "approved",
      parentDecisionRequired: true,
      parentDecisionStatus: "pending",
      adminApprovedAt: serverTimestamp(),
      confirmationDeadline,
    });

    if (request.parentEmail) {
      const { buildU14PreprogramAcceptanceMail, enqueueTransactionalMail } = await loadMailQueueModule();
      await enqueueTransactionalMail(
        buildU14PreprogramAcceptanceMail({
          ...acceptanceMailContext,
          parentEmail: request.parentEmail,
          parentFirstName: request.parentFirstName,
          childName: request.childName,
          raceLabel: request.raceLabel,
          practicalInfo: preprogramPracticalInfo,
          confirmationDeadline,
        }),
      );
    }
  }

  async function handleApproveRequest(request) {
    setErrorMessage("");
    setStatusMessage("");
    setIsSaving(true);

    try {
      await approvePreprogramRequest(request);
      setStatusMessage(`Validation envoyée au parent de ${request.childName}.`);
    } catch {
      setErrorMessage("Impossible de valider cette demande pour le moment.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleProcessRequest(request) {
    setErrorMessage("");
    setStatusMessage("");
    setIsSaving(true);

    try {
      const [requestsSnapshot, childrenSnapshot, protectedSnapshot] = await Promise.all([
        getDocs(collection(db, "u14Requests")),
        getDocs(collection(db, "u14Children")),
        getDocs(collection(db, U14_PROTECTED_INVITES_COLLECTION)),
      ]);

      const latestRequests = requestsSnapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
      const latestChildren = childrenSnapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
      const latestProtectedInvites = protectedSnapshot.docs
        .map((entry) => ({ id: entry.id, ...entry.data() }))
        .filter((entry) => !entry.editionId || String(entry.editionId) === String(activeEditionId));

      await syncAllocations({
        requests: latestRequests,
        children: latestChildren,
        protectedInvites: latestProtectedInvites,
      });

      const refreshedRequestsSnapshot = await getDocs(collection(db, "u14Requests"));
      const refreshedRequests = refreshedRequestsSnapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
      const refreshedRequest = refreshedRequests.find((entry) => entry.id === request.id);

      if (!refreshedRequest) {
        setErrorMessage("Impossible de retrouver cette demande après recalcul.");
        return;
      }

      const refreshedChild = latestChildren.find((child) => child.id === refreshedRequest.childId);
      const refreshedRecord = buildU14RequestRecord(refreshedRequest, refreshedChild);
      const refreshedStatus = normalizeComparableValue(refreshedRecord.status);
      const refreshedApproval = normalizeComparableValue(refreshedRecord.adminApprovalStatus);

      if (refreshedStatus === "confirmed" && refreshedApproval !== "approved") {
        await approvePreprogramRequest(refreshedRecord);
        setStatusMessage(`Validation envoyée au parent de ${refreshedRecord.childName}.`);
        return;
      }

      if (refreshedStatus === "waitlisted") {
        setStatusMessage(`${refreshedRecord.childName} est actuellement en liste d'attente. Aucune validation admin à envoyer pour le moment.`);
        return;
      }

      setStatusMessage(
        `${refreshedRecord.childName} est actuellement au statut "${formatU14RequestStatusLabel(refreshedRecord.status)}".`,
      );
    } catch {
      setErrorMessage("Impossible de traiter cette demande pour le moment.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleApproveBasketRequest(request) {
    setErrorMessage("");
    setStatusMessage("");
    setIsSaving(true);

    try {
      const confirmationDeadline = getU14ConfirmationDeadline();
      await updateDoc(doc(db, "u14Requests", request.id), {
        status: "confirmed",
        allocationMode: "porte_panier",
        adminApprovalStatus: "approved",
        parentDecisionRequired: true,
        parentDecisionStatus: "pending",
        adminApprovedAt: serverTimestamp(),
        confirmationDeadline,
      });

      if (request.parentEmail) {
        const { buildU14BasketAcceptanceMail, enqueueTransactionalMail } = await loadMailQueueModule();
        await enqueueTransactionalMail(
          buildU14BasketAcceptanceMail({
            ...acceptanceMailContext,
            parentEmail: request.parentEmail,
            parentFirstName: request.parentFirstName,
            childName: request.childName,
            practicalInfo: basketPracticalInfo,
            confirmationDeadline,
          }),
        );
      }

      setStatusMessage(`Acceptation porte-panier envoyée au parent de ${request.childName}.`);
    } catch {
      setErrorMessage("Impossible de valider cette demande porte-panier pour le moment.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleSavePracticalInfo(event) {
    event.preventDefault();
    setErrorMessage("");
    setStatusMessage("");
    setIsSaving(true);

    try {
      await setDoc(
        doc(db, ...U14_PRACTICAL_INFO_DOC_PATH),
        {
          preprogram: practicalInfoForm.preprogram.trim(),
          porte_panier: practicalInfoForm.porte_panier.trim(),
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );

      setStatusMessage("Les informations pratiques ont été enregistrées.");
    } catch {
      setErrorMessage("Impossible d'enregistrer les informations pratiques pour le moment.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="page">
      <section className="page-header">
        <div>
          <p className="eyebrow">{pageHeader.eyebrow}</p>
          <h1>{pageHeader.title}</h1>
          <p>{pageHeader.description}</p>
        </div>
      </section>

      {requestsError || childrenError || protectedInvitesError ? (
        <p className="status-note">{requestsError || childrenError || protectedInvitesError}</p>
      ) : null}
      {statusMessage ? <p className="panel-note panel-note--success">{statusMessage}</p> : null}
      {errorMessage ? <p className="form-error">{errorMessage}</p> : null}
      {dataLoading ? <p className="status-note">Chargement du module U12 / U14...</p> : null}

      {promotedToApprove.length ? (
        <div className="notice-card notice-card--ok">
          <strong>Montés de la liste d'attente — à valider</strong>
          <p>Une place s'est libérée : ces enfants sont retenus. La validation envoie le mail d'acceptation et ouvre le délai de 10 jours.</p>
          <div className="u14-overdue-list">
            {promotedToApprove.map((request) => (
              <div key={request.id} className="u14-overdue-row">
                <span>
                  <strong>{request.childName}</strong> · {request.raceLabel}
                  <span className="parent-request-note"> — monté le {formatDateTimeForDisplay(request.promotedFromWaitlistAt)}</span>
                </span>
                <span className="table-actions table-actions--inline">
                  <button className="button button--primary button--small" disabled={isSaving} type="button" onClick={() => handleApproveRequest(request)}>
                    Valider et envoyer le mail
                  </button>
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {overdueConfirmations.length ? (
        <div className="notice-card notice-card--warn">
          <strong>Délais dépassés — à traiter</strong>
          <p>Rien n'est libéré automatiquement : relancez la famille (nouveau délai de 10 jours) ou libérez la place.</p>
          <div className="u14-overdue-list">
            {overdueConfirmations.map((request) => (
              <div key={request.id} className="u14-overdue-row">
                <span>
                  <strong>{request.childName}</strong> · {getU14PracticalRoleKey(request) === "porte_panier" ? "Porte-panier" : request.raceLabel}
                  <span className="parent-request-note">
                    {" "}— confirmation attendue le {formatDateForDisplay(request.confirmationDeadline)}
                    {request.reminderCount ? ` · ${request.reminderCount} relance(s)` : ""}
                  </span>
                </span>
                <span className="table-actions table-actions--inline">
                  <button className="button button--secondary button--small" disabled={isSaving} type="button" onClick={() => handleRemindParent(request)}>
                    Relancer
                  </button>
                  <button className="button button--ghost-danger button--small" disabled={isSaving} type="button" onClick={() => handleReleaseOverdueRequest(request)}>
                    Libérer la place
                  </button>
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="admin-subtabs" role="tablist" aria-label="Navigation du module Pré-programme">
        <button
          className={`admin-subtab ${activeU14Tab === "preprogram" ? "admin-subtab--active" : ""}`}
          type="button"
          onClick={() => openU14Tab("preprogram")}
        >
          Pré-programme
        </button>
        <button
          className={`admin-subtab ${activeU14Tab === "protected" ? "admin-subtab--active" : ""}`}
          type="button"
          onClick={() => openU14Tab("protected")}
        >
          Places protégées
        </button>
        <button
          className={`admin-subtab ${activeU14Tab === "basket" ? "admin-subtab--active" : ""}`}
          type="button"
          onClick={() => openU14Tab("basket")}
        >
          Porte-panier ({basketRequests.length})
        </button>
        <button
          className={`admin-subtab ${activeU14Tab === "timeline" ? "admin-subtab--active" : ""}`}
          type="button"
          onClick={() => openU14Tab("timeline")}
        >
          Chronologie
        </button>
        <button
          className={`admin-subtab ${activeU14Tab === "practical" ? "admin-subtab--active" : ""}`}
          type="button"
          onClick={() => openU14Tab("practical")}
        >
          Infos pratiques
        </button>
      </div>

      {activeU14Tab === "preprogram" ? (
        <>
          <section className="u14-overview-grid">
            <Panel
              title="Répartition par course"
              subtitle="Choisissez une course. Le détail complet s'affiche à droite."
              actions={
                <button className="button button--secondary" disabled={isSaving || dataLoading} type="button" onClick={handleRecalculateAllocations}>
                  {isSaving ? "Mise à jour..." : "Recalculer les statuts"}
                </button>
              }
            >
              <div className="u14-race-grid">
                {raceSummaries.map((summary) => (
                  <button
                    key={summary.code}
                    className={`selection-card u14-race-card ${selectedRaceCode === summary.code ? "u14-race-card--active" : ""}`}
                    type="button"
                    onClick={() => setSelectedRaceCode(summary.code)}
                  >
                    <div className="u14-race-card__head">
                      <strong>{summary.label}</strong>
                      <span className="u14-race-card__remaining">
                        {summary.remainingPlaces} restante(s)
                        {summary.blockedPlaces ? ` · ${summary.blockedPlaces} réservée(s)` : ""}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </Panel>

            <Panel
              title="Tableau de la course sélectionnée"
              subtitle="Vue tableau avec les demandes et les places protégées en attente pour la course choisie."
            >
              <div className="notice-card notice-card--ok">
                <strong>{selectedRaceSummary?.label || "Course non définie"}</strong>
                <p>
                  {selectedRaceSummary?.totalPlaces || 0} place(s) au total, {selectedRaceSummary?.protectedPlaces || 0} prise(s) par des enfants invités,{" "}
                  {selectedRaceSummary?.blockedPlaces || 0} encore réservée(s) pour eux,{" "}
                  {selectedRaceSummary?.takenPlaces || 0} prise(s), {selectedRaceSummary?.remainingPlaces || 0} restante(s).
                </p>
              </div>

              <DataTable
                columns={[
                  { key: "type", label: "Type" },
                  { key: "child", label: "Enfant" },
                  { key: "club", label: "Club" },
                  { key: "bib", label: "Dossard" },
                  { key: "status", label: "Statut" },
                  { key: "position", label: "Position" },
                  { key: "parent", label: "Parent / contact" },
                  { key: "submittedAt", label: "Date" },
                ]}
                rows={
                  selectedRaceTableRows.length
                    ? selectedRaceTableRows
                    : [
                        {
                          type: "-",
                          child: "Aucun enfant sur cette course",
                          club: "-",
                          bib: "-",
                          status: "-",
                          position: "-",
                          parent: "-",
                          submittedAt: "-",
                        },
                      ]
                }
              />
            </Panel>
          </section>

          <Panel
            title="Demandes reçues"
            subtitle="Vue consolidée avec statut parent, position et mode d'attribution."
            actions={
              <button className="button button--secondary" disabled={isSaving || dataLoading} type="button" onClick={handleRecalculateAllocations}>
                {isSaving ? "Mise à jour..." : "Recalculer les statuts"}
              </button>
            }
          >
            <div className="admin-toolbar">
              <AuthFormField label="Rechercher une demande">
                <input
                  placeholder="Enfant, parent, course, club, dossard..."
                  type="search"
                  value={requestSearch}
                  onChange={(event) => setRequestSearch(event.target.value)}
                />
              </AuthFormField>
              <div className="team-toolbar-main">
                <AuthFormField label="Statut">
                  <select value={requestStatusFilter} onChange={(event) => setRequestStatusFilter(event.target.value)}>
                    <option value="Tous">Tous</option>
                    <option value="Demande enregistrée">Demande enregistrée</option>
                    <option value="Retenu">Retenu</option>
                    <option value="Validé">Validé</option>
                    <option value="Liste d'attente">Liste d'attente</option>
                    <option value="Désisté">Désisté</option>
                    <option value="Non retenue">Non retenue</option>
                  </select>
                </AuthFormField>
                <AuthFormField label="Course">
                  <select value={requestRaceFilter} onChange={(event) => setRequestRaceFilter(event.target.value)}>
                    <option value="Toutes">Toutes</option>
                    {U14_RACE_DEFINITIONS.map((definition) => (
                      <option key={definition.code} value={definition.code}>
                        {definition.label}
                      </option>
                    ))}
                  </select>
                </AuthFormField>
              </div>
            </div>

            <DataTable
              columns={[
                { key: "child", label: "Enfant" },
                { key: "race", label: "Course" },
                { key: "parent", label: "Responsable" },
                { key: "submittedAt", label: "Date / heure" },
                { key: "status", label: "Statut" },
                { key: "position", label: "Position" },
                { key: "admin", label: "Validation admin" },
                { key: "decision", label: "Réponse parent" },
                { key: "actions", label: "Action" },
              ]}
              rows={
                filteredAdminRequests.length
                  ? filteredAdminRequests.map((request) => ({
                        child: request.childName,
                        race: request.raceLabel,
                        parent: request.parentName,
                        submittedAt: request.submittedAtMs ? formatDateTimeForDisplay(request.submittedAtMs) : "-",
                        status: getU14WorkflowStatusLabel(request),
                        position:
                          normalizeComparableValue(request.status) === "confirmed"
                            ? `Accepté${request.acceptedPosition ? ` (${request.acceptedPosition})` : ""}`
                            : request.waitlistPosition
                              ? `Attente ${request.waitlistPosition}`
                              : "-",
                        admin:
                          normalizeComparableValue(request.adminApprovalStatus) === "approved"
                            ? getAdminApprovalLabel(request.adminApprovalStatus)
                            : "Validation admin requise",
                        decision:
                          normalizeComparableValue(request.adminApprovalStatus) === "approved"
                            ? <ParentDecisionCell now={pageOpenedAt} request={request} />
                            : "En attente validation admin",
                        __rowClass:
                          normalizeComparableValue(request.status) === "declined" ||
                          normalizeComparableValue(request.parentDecisionStatus) === "declined"
                            ? "data-table__row--danger"
                            : normalizeComparableValue(request.adminApprovalStatus) === "approved" &&
                                normalizeComparableValue(request.parentDecisionStatus) === "confirmed"
                              ? "data-table__row--success"
                              : "",
                        actions:
                          normalizeComparableValue(request.adminApprovalStatus) !== "approved" &&
                          normalizeComparableValue(request.status) !== "declined" &&
                          normalizeComparableValue(request.status) !== "rejected" ? (
                            <button
                              className="button button--secondary"
                              type="button"
                              disabled={isSaving}
                              onClick={() =>
                                normalizeComparableValue(request.status) === "confirmed"
                                  ? handleApproveRequest(request)
                                  : handleProcessRequest(request)
                              }
                            >
                              {normalizeComparableValue(request.status) === "confirmed"
                                ? "Valider et envoyer"
                                : "Traiter la demande"}
                            </button>
                          ) : (
                            "-"
                          ),
                      }))
                  : [{ child: "Aucune demande", race: "-", parent: "-", submittedAt: "-", status: "-", position: "-", admin: "-", decision: "-", actions: "-" }]
              }
            />
          </Panel>
        </>
      ) : null}

      {activeU14Tab === "protected" ? (
        <U14ProtectedTab
          DataTable={DataTable}
          Panel={Panel}
          activeEditionId={activeEditionId}
          claimedByPool={claimedByPool}
          invites={protectedInvites}
          loadMailQueueModule={loadMailQueueModule}
          mailContext={acceptanceMailContext}
          requestRecords={requestRecords}
          reserveByPool={reserveByPool}
          reserveReleased={reserveReleased}
          settings={protectedSettings}
        />
      ) : null}

      {activeU14Tab === "basket" ? (
        <Panel title="Demandes porte-panier" subtitle="Validation manuelle avec envoi du mail parent depuis la même file transactionnelle.">
          <DataTable
            columns={[
              { key: "child", label: "Enfant" },
              { key: "parent", label: "Responsable" },
              { key: "status", label: "Statut" },
              { key: "admin", label: "Validation admin" },
              { key: "decision", label: "Réponse parent" },
              { key: "actions", label: "Action" },
            ]}
            rows={
              basketRequests.length
                ? basketRequests.map((request) => ({
                    child: request.childName,
                    parent: request.parentName,
                    status: getU14WorkflowStatusLabel(request),
                    admin:
                      normalizeComparableValue(request.status) === "confirmed"
                        ? getAdminApprovalLabel(request.adminApprovalStatus)
                        : "Validation admin requise",
                    decision:
                      normalizeComparableValue(request.adminApprovalStatus) === "approved"
                        ? <ParentDecisionCell now={pageOpenedAt} request={request} />
                        : "En attente validation admin",
                    actions:
                      normalizeComparableValue(request.adminApprovalStatus) !== "approved" ? (
                        <button
                          className="button button--secondary"
                          type="button"
                          disabled={isSaving}
                          onClick={() => handleApproveBasketRequest(request)}
                        >
                          Valider porte-panier
                        </button>
                      ) : (
                        "-"
                      ),
                  }))
                : [{ child: "Aucune demande porte-panier", parent: "-", status: "-", admin: "-", decision: "-", actions: "-" }]
            }
          />
        </Panel>
      ) : null}

      {activeU14Tab === "timeline" ? (
        <Panel
          title="Toutes les demandes par ordre chronologique"
          subtitle="Vue globale de toutes les demandes avec date et heure de soumission."
        >
          <DataTable
            columns={[
              { key: "submittedAt", label: "Date / heure" },
              { key: "child", label: "Enfant" },
              { key: "type", label: "Type" },
              { key: "race", label: "Course" },
              { key: "parent", label: "Responsable" },
              { key: "status", label: "Statut" },
              { key: "position", label: "Position" },
              { key: "admin", label: "Validation admin" },
            ]}
            rows={
              chronologicalRequests.length
                ? chronologicalRequests
                : [{ submittedAt: "-", child: "Aucune demande", type: "-", race: "-", parent: "-", status: "-", position: "-", admin: "-" }]
            }
          />
        </Panel>
      ) : null}

      {activeU14Tab === "practical" ? (
        <Panel
          title="Informations pratiques"
          subtitle="Un texte par rôle. Il sera affiché dans l'espace parent une fois la demande validée."
        >
          {practicalInfoError ? <p className="form-error">{practicalInfoError}</p> : null}
          {practicalInfoLoading ? <p className="panel-note">Chargement des informations pratiques...</p> : null}
          <form className="profile-form" onSubmit={handleSavePracticalInfo}>
            <AuthFormField label="Texte Pré-programme">
              <textarea
                rows="6"
                value={practicalInfoForm.preprogram}
                onChange={(event) =>
                  setPracticalInfoForm((current) => ({ ...current, preprogram: event.target.value }))
                }
              />
            </AuthFormField>
            <AuthFormField label="Texte Porte-panier">
              <textarea
                rows="6"
                value={practicalInfoForm.porte_panier}
                onChange={(event) =>
                  setPracticalInfoForm((current) => ({ ...current, porte_panier: event.target.value }))
                }
              />
            </AuthFormField>
            <div className="profile-form__actions">
              <button className="button button--primary" disabled={isSaving} type="submit">
                {isSaving ? "Enregistrement..." : "Enregistrer les infos pratiques"}
              </button>
            </div>
          </form>
        </Panel>
      ) : null}
    </div>
  );
}

export { U14Page };
