import { useEffect, useMemo, useState } from "react";
import { collection } from "firebase/firestore";
import { useLocation, useNavigate } from "react-router-dom";
import {
  U14_PRACTICAL_INFO_DOC_PATH,
  U14_RACE_DEFINITIONS,
  U14_RESERVED_SLOTS_COLLECTION,
  U14_RESERVED_SLOTS_PER_RACE,
  buildU14AllocationSnapshot,
  buildU14RequestRecord,
  doesProtectedSlotMatchRequest,
  formatDateForDisplay,
  formatDateTimeForDisplay,
  formatU14RequestStatusLabel,
  getAdminApprovalLabel,
  getParentDecisionLabel,
  getProtectedSlotStatusLabel,
  getTimestampMs,
  getU14RaceLabel,
  getU14WorkflowStatusLabel,
  isProtectedSlotActive,
  normalizeComparableValue,
} from "./u14-helpers";
import {
  useProtectedU14Entries,
  useU14ChildrenList,
  useU14PracticalInfoConfiguration,
  useU14RequestsList,
} from "./u14-hooks";
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
        description: "Gestion des places réservées par course et des invitations parent associées.",
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

function U14Page(props) {
  const {
    AuthFormField,
    DataTable,
    Panel,
    addDoc,
    deleteDoc,
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
  const {
    entries: protectedEntries,
    loading: protectedEntriesLoading,
    error: protectedEntriesError,
  } = useProtectedU14Entries(true);
  const {
    preprogram: preprogramPracticalInfo,
    porte_panier: basketPracticalInfo,
    loading: practicalInfoLoading,
    error: practicalInfoError,
  } = useU14PracticalInfoConfiguration(true);
  const [selectedRaceCode, setSelectedRaceCode] = useState(U14_RACE_DEFINITIONS[0]?.code || "");
  const [activeU14Tab, setActiveU14Tab] = useState(() => getU14TabFromPath(location.pathname));
  const [practicalInfoForm, setPracticalInfoForm] = useState({ preprogram: "", porte_panier: "" });
  const [requestSearch, setRequestSearch] = useState("");
  const [requestStatusFilter, setRequestStatusFilter] = useState("Tous");
  const [requestRaceFilter, setRequestRaceFilter] = useState("Toutes");
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [reservationForm, setReservationForm] = useState({
    raceCode: U14_RACE_DEFINITIONS[0]?.code || "",
    slotNumber: "1",
    firstName: "",
    lastName: "",
    club: "",
    bibNumber: "",
    parentEmail: "",
    inviteDeadline: "",
  });
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
  const dataLoading = requestsLoading || childrenLoading || protectedEntriesLoading;
  const { requestRecords, raceSummaries } = useMemo(
    () => buildU14AllocationSnapshot({ requests, children, protectedEntries }),
    [children, protectedEntries, requests],
  );
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
  const filteredProtectedEntries = useMemo(
    () =>
      protectedEntries
        .filter((entry) => !selectedRaceCode || entry.raceCode === selectedRaceCode)
        .sort((left, right) => {
          if (left.raceCode !== right.raceCode) return left.raceCode.localeCompare(right.raceCode);
          return Number(left.slotNumber || 0) - Number(right.slotNumber || 0);
        }),
    [protectedEntries, selectedRaceCode],
  );
  const waitingRequests = useMemo(
    () =>
      requestRecords.filter(
        (request) =>
          request.raceCode === selectedRaceCode &&
          request.requestType !== "porte_panier" &&
          normalizeComparableValue(request.status) === "waitlisted",
      ),
    [requestRecords, selectedRaceCode],
  );
  const selectedRaceProtectedPendingEntries = useMemo(
    () =>
      filteredProtectedEntries.filter(
        (entry) =>
          !["matched", "released"].includes(normalizeComparableValue(entry.status)),
      ),
    [filteredProtectedEntries],
  );
  const basketRequests = useMemo(
    () =>
      requestRecords
        .filter((request) => request.requestType === "porte_panier")
        .sort((left, right) => left.submittedAtMs - right.submittedAtMs),
    [requestRecords],
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
  const slotSuggestionsById = useMemo(
    () =>
      filteredProtectedEntries.reduce((accumulator, entry) => {
        accumulator[entry.id] = requestRecords.filter((request) => doesProtectedSlotMatchRequest(entry, request));
        return accumulator;
      }, {}),
    [filteredProtectedEntries, requestRecords],
  );
  const selectedRaceTableRows = useMemo(() => {
    const protectedRows = selectedRaceProtectedPendingEntries.map((entry) => ({
      type: "Place protégée",
      child: `${entry.firstName || ""} ${entry.lastName || ""}`.trim() || `Place protégée ${entry.slotNumber || "?"}`,
      club: entry.club || "-",
      bib: entry.bibNumber || "-",
      status: getProtectedSlotStatusLabel(entry.status),
      position: `Réservée (${entry.slotNumber || "?"})`,
      parent: entry.parentEmail || "-",
      submittedAt: entry.createdAt ? formatDateTimeForDisplay(getTimestampMs(entry.createdAt)) : "-",
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
  }, [selectedRaceProtectedPendingEntries, selectedRaceRequests]);

  function handleReservationFormChange(event) {
    const { name, value } = event.target;
    setReservationForm((current) => ({ ...current, [name]: value }));
  }

  async function handleCreateProtectedEntry(event) {
    event.preventDefault();
    setErrorMessage("");
    setStatusMessage("");

    const raceEntries = protectedEntries.filter(
      (entry) => entry.raceCode === reservationForm.raceCode && isProtectedSlotActive(entry),
    );
    if (raceEntries.length >= U14_RESERVED_SLOTS_PER_RACE) {
      setErrorMessage("Cette catégorie a déjà ses 3 places protégées actives.");
      return;
    }

    setIsSaving(true);
    try {
      await addDoc(collection(db, U14_RESERVED_SLOTS_COLLECTION), {
        raceCode: reservationForm.raceCode,
        slotNumber: Number(reservationForm.slotNumber || 1),
        firstName: reservationForm.firstName.trim(),
        lastName: reservationForm.lastName.trim(),
        club: reservationForm.club.trim(),
        bibNumber: reservationForm.bibNumber.trim(),
        parentEmail: reservationForm.parentEmail.trim(),
        inviteDeadline: reservationForm.inviteDeadline || null,
        status: "invited",
        createdAt: serverTimestamp(),
      });

      if (reservationForm.parentEmail.trim()) {
        const { enqueueTransactionalMail } = await loadMailQueueModule();
        await enqueueTransactionalMail({
          type: "u14-protected-invitation",
          to: reservationForm.parentEmail.trim(),
          subject: "Votre enfant est pré-sélectionné pour le CMCM Luxembourg Indoor Meeting 2027",
          body: `Bonjour,\n\nVotre enfant ${reservationForm.firstName.trim()} ${reservationForm.lastName.trim()} est pré-sélectionné pour ${getU14RaceLabel(reservationForm.raceCode)}. Merci de compléter son inscription sur MyCLIM avant le ${formatDateForDisplay(reservationForm.inviteDeadline)}. Sans dossier complété avant cette date, nous ne pourrons pas garantir de conserver cette place protégée.\n`,
          metadata: {
            raceCode: reservationForm.raceCode,
            slotNumber: Number(reservationForm.slotNumber || 1),
            bibNumber: reservationForm.bibNumber.trim(),
          },
        });
      }

      setStatusMessage("Place protégée enregistrée et mail d'invitation placé dans la file d'envoi.");
      setReservationForm((current) => ({
        ...current,
        firstName: "",
        lastName: "",
        club: "",
        bibNumber: "",
        parentEmail: "",
        inviteDeadline: "",
      }));
    } catch {
      setErrorMessage("Impossible d'enregistrer cette place protégée pour le moment.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleMatchProtectedEntry(entry, request) {
    setErrorMessage("");
    setStatusMessage("");
    setIsSaving(true);

    try {
      await updateDoc(doc(db, U14_RESERVED_SLOTS_COLLECTION, entry.id), {
        status: "matched",
        matchedRequestId: request.id,
        matchedChildId: request.childId || "",
        matchedParentUserId: request.parentUserId || "",
        matchedAt: serverTimestamp(),
      });

      await syncU14RaceAllocations({
        requests,
        children,
        protectedEntries: protectedEntries.map((current) =>
          current.id === entry.id
            ? { ...current, status: "matched", matchedRequestId: request.id }
            : current,
        ),
      });
      setStatusMessage(`La place protégée ${entry.slotNumber} a été matchée avec ${request.childName}.`);
    } catch {
      setErrorMessage("Le matching a échoué.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleReleaseProtectedEntry(entry) {
    setErrorMessage("");
    setStatusMessage("");
    setIsSaving(true);

    try {
      await updateDoc(doc(db, U14_RESERVED_SLOTS_COLLECTION, entry.id), {
        status: "released",
        matchedRequestId: null,
        matchedChildId: null,
        matchedParentUserId: null,
        releasedAt: serverTimestamp(),
      });

      const nextProtectedEntries = protectedEntries.map((current) =>
        current.id === entry.id
          ? { ...current, status: "released", matchedRequestId: null }
          : current,
      );
      await syncU14RaceAllocations({ requests, children, protectedEntries: nextProtectedEntries });
      setStatusMessage(`La place protégée ${entry.slotNumber} a été libérée.`);
    } catch {
      setErrorMessage("Impossible de libérer cette place protégée.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDeleteProtectedEntry(entry) {
    if (!window.confirm(`Supprimer définitivement la place protégée ${entry.slotNumber} pour ${entry.firstName || ""} ${entry.lastName || ""} ?`)) {
      return;
    }

    setErrorMessage("");
    setStatusMessage("");
    setIsSaving(true);

    try {
      await deleteDoc(doc(db, U14_RESERVED_SLOTS_COLLECTION, entry.id));
      const nextProtectedEntries = protectedEntries.filter((current) => current.id !== entry.id);
      await syncU14RaceAllocations({ requests, children, protectedEntries: nextProtectedEntries });
      setStatusMessage(`La place protégée ${entry.slotNumber} a été supprimée définitivement.`);
    } catch {
      setErrorMessage("Impossible de supprimer cette place protégée.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleRecalculateAllocations() {
    setErrorMessage("");
    setStatusMessage("");
    setIsSaving(true);

    try {
      await syncU14RaceAllocations({ requests, children, protectedEntries });
      setStatusMessage("Les statuts, places acceptées et listes d'attente ont été recalculés.");
    } catch {
      setErrorMessage("Le recalcul automatique a échoué.");
    } finally {
      setIsSaving(false);
    }
  }

  async function approvePreprogramRequest(request) {
    await updateDoc(doc(db, "u14Requests", request.id), {
      adminApprovalStatus: "approved",
      parentDecisionRequired: true,
      parentDecisionStatus: "pending",
      adminApprovedAt: serverTimestamp(),
    });

    if (request.parentEmail) {
      const { buildU14PreprogramAcceptanceMail, enqueueTransactionalMail } = await loadMailQueueModule();
      await enqueueTransactionalMail(
        buildU14PreprogramAcceptanceMail({
          parentEmail: request.parentEmail,
          childName: request.childName,
          raceLabel: request.raceLabel,
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
        getDocs(collection(db, U14_RESERVED_SLOTS_COLLECTION)),
      ]);

      const latestRequests = requestsSnapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
      const latestChildren = childrenSnapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
      const latestProtectedEntries = protectedSnapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));

      await syncU14RaceAllocations({
        requests: latestRequests,
        children: latestChildren,
        protectedEntries: latestProtectedEntries,
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
      await updateDoc(doc(db, "u14Requests", request.id), {
        status: "confirmed",
        allocationMode: "porte_panier",
        adminApprovalStatus: "approved",
        parentDecisionRequired: true,
        parentDecisionStatus: "pending",
        adminApprovedAt: serverTimestamp(),
      });

      if (request.parentEmail) {
        const { buildU14BasketAcceptanceMail, enqueueTransactionalMail } = await loadMailQueueModule();
        await enqueueTransactionalMail(
          buildU14BasketAcceptanceMail({
            parentEmail: request.parentEmail,
            childName: request.childName,
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

      {requestsError || childrenError || protectedEntriesError ? (
        <p className="status-note">{requestsError || childrenError || protectedEntriesError}</p>
      ) : null}
      {statusMessage ? <p className="panel-note panel-note--success">{statusMessage}</p> : null}
      {errorMessage ? <p className="form-error">{errorMessage}</p> : null}
      {dataLoading ? <p className="status-note">Chargement du module U12 / U14...</p> : null}

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
                    onClick={() => {
                      setSelectedRaceCode(summary.code);
                      setReservationForm((current) => ({ ...current, raceCode: summary.code }));
                    }}
                  >
                    <div className="u14-race-card__head">
                      <strong>{summary.label}</strong>
                      <span className="u14-race-card__remaining">{summary.remainingPlaces} restante(s)</span>
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
                  {selectedRaceSummary?.totalPlaces || 0} place(s) au total, {selectedRaceSummary?.protectedPlaces || 0} protégée(s),{" "}
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
                            ? getParentDecisionLabel(request.parentDecisionStatus)
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
        <Panel
          title="Gestion des places protégées"
          subtitle="Création, matching et suivi des places protégées sur la course sélectionnée."
        >
          <div className="notice-card notice-card--ok">
            <strong>{selectedRaceSummary?.label || "Course non définie"}</strong>
            <p>
              {filteredProtectedEntries.length} place(s) protégée(s) active(s), {waitingRequests.length} enfant(s)
              actuellement en liste d'attente sur cette course.
            </p>
          </div>

          <form className="profile-form" onSubmit={handleCreateProtectedEntry}>
            <div className="field-grid">
              <AuthFormField label="Catégorie / course">
                <select name="raceCode" value={reservationForm.raceCode} onChange={handleReservationFormChange}>
                  {U14_RACE_DEFINITIONS.map((definition) => (
                    <option key={definition.code} value={definition.code}>
                      {definition.label}
                    </option>
                  ))}
                </select>
              </AuthFormField>
              <AuthFormField label="Place protégée">
                <select name="slotNumber" value={reservationForm.slotNumber} onChange={handleReservationFormChange}>
                  {[1, 2, 3].map((slotNumber) => (
                    <option key={slotNumber} value={slotNumber}>
                      Place {slotNumber}
                    </option>
                  ))}
                </select>
              </AuthFormField>
            </div>
            <div className="field-grid">
              <AuthFormField label="Prénom enfant">
                <input name="firstName" required value={reservationForm.firstName} onChange={handleReservationFormChange} />
              </AuthFormField>
              <AuthFormField label="Nom enfant">
                <input name="lastName" required value={reservationForm.lastName} onChange={handleReservationFormChange} />
              </AuthFormField>
            </div>
            <div className="field-grid">
              <AuthFormField label="Club">
                <input name="club" required value={reservationForm.club} onChange={handleReservationFormChange} />
              </AuthFormField>
              <AuthFormField label="Dossard">
                <input name="bibNumber" required value={reservationForm.bibNumber} onChange={handleReservationFormChange} />
              </AuthFormField>
            </div>
            <div className="field-grid">
              <AuthFormField label="Email parent">
                <input name="parentEmail" required type="email" value={reservationForm.parentEmail} onChange={handleReservationFormChange} />
              </AuthFormField>
              <AuthFormField label="Date limite d'inscription">
                <input name="inviteDeadline" required type="date" value={reservationForm.inviteDeadline} onChange={handleReservationFormChange} />
              </AuthFormField>
            </div>
            <div className="profile-form__actions">
              <button className="button button--primary" disabled={isSaving} type="submit">
                {isSaving ? "Enregistrement..." : "Créer la place protégée"}
              </button>
            </div>
          </form>

          <DataTable
            columns={[
              { key: "slot", label: "Place" },
              { key: "child", label: "Enfant protégé" },
              { key: "status", label: "Statut" },
              { key: "match", label: "Meilleur matching" },
              { key: "actions", label: "Actions" },
            ]}
            rows={
              filteredProtectedEntries.length
                ? filteredProtectedEntries.map((entry) => {
                    const suggestions = slotSuggestionsById[entry.id] || [];
                    const firstSuggestion = suggestions[0] || null;

                    return {
                      slot: `Place ${entry.slotNumber}`,
                      child: `${entry.firstName || ""} ${entry.lastName || ""}`.trim(),
                      status: getProtectedSlotStatusLabel(entry.status),
                      match: firstSuggestion ? (
                        <div className="compact-list compact-list--actions">
                          <span>
                            {firstSuggestion.childName} - dossard {firstSuggestion.bibNumber || "?"}
                          </span>
                        </div>
                      ) : (
                        "Aucune inscription matchée"
                      ),
                      actions: (
                        <div className="table-actions">
                          {firstSuggestion && normalizeComparableValue(entry.status) !== "matched" ? (
                            <button
                              className="button button--secondary"
                              type="button"
                              onClick={() => handleMatchProtectedEntry(entry, firstSuggestion)}
                            >
                              Matcher
                            </button>
                          ) : null}
                          {normalizeComparableValue(entry.status) !== "released" ? (
                            <button
                              className="button button--secondary"
                              type="button"
                              onClick={() => handleReleaseProtectedEntry(entry)}
                            >
                              Libérer
                            </button>
                          ) : null}
                          <button
                            className="button button--secondary"
                            type="button"
                            onClick={() => handleDeleteProtectedEntry(entry)}
                            style={{ color: "#b91c1c", borderColor: "#fca5a5" }}
                          >
                            Supprimer
                          </button>
                        </div>
                      ),
                    };
                  })
                : [{ slot: "Aucune place protégée", child: "-", status: "-", match: "-", actions: "-" }]
            }
          />

          <DataTable
            columns={[
              { key: "child", label: "Enfant en attente" },
              { key: "parent", label: "Responsable" },
              { key: "place", label: "Place attente" },
            ]}
            rows={
              waitingRequests.length
                ? waitingRequests.map((request) => ({
                    child: request.childName,
                    parent: request.parentName,
                    place: request.waitlistPosition || "-",
                  }))
                : [{ child: "Aucune attente sur cette course", parent: "-", place: "-" }]
            }
          />
        </Panel>
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
                        ? getParentDecisionLabel(request.parentDecisionStatus)
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
