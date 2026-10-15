import { useMemo, useState } from "react";
import { doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { AuthFormField } from "./form-components";
import {
  U14_RESERVED_SLOTS_COLLECTION,
  createEmptyParentU14ChildForm,
  formatParentRequestSchedule,
  formatParentRequestStatus,
  formatParentRequestType,
  getPreProgramSubmissionErrorMessage,
  getU14AllowedEvents,
  getU14ParentStatusPillClass,
  getU14RaceLabel,
  getValidRequestedEventForCategory,
} from "./u14-helpers";
import { useParentU14Children } from "./u14-hooks";
import { useLanguage } from "./language-context";
import { useAuth } from "../context/auth-context";
import { db } from "../services/firebase";

function MyChildrenPage(props) {
  const {
    DataTable,
    Panel,
    getU14CategoryFromBirthDate,
    loadMailQueueModule,
    luxCompetitionClubs,
    normalizeComparableValue,
  } = props;
  const { addU14ChildRegistration, currentUser, userProfile } = useAuth();
  const { t } = useLanguage();
  const { rows: parentRows, loading, error } = useParentU14Children(currentUser?.uid);
  const [childForm, setChildForm] = useState(createEmptyParentU14ChildForm);
  const [isAddChildOpen, setIsAddChildOpen] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [busyRequestId, setBusyRequestId] = useState("");
  const [isSubmittingChild, setIsSubmittingChild] = useState(false);
  const parentRequestSummary = useMemo(
    () => ({
      total: parentRows.length,
      pending: parentRows.filter((row) => normalizeComparableValue(row.status) === "demande enregistree").length,
      retained: parentRows.filter((row) => normalizeComparableValue(row.status) === "retenu").length,
      validated: parentRows.filter((row) => normalizeComparableValue(row.status) === "valide").length,
    }),
    [normalizeComparableValue, parentRows],
  );

  function handleChildFormChange(event) {
    const { name, type, checked, value } = event.target;

    setChildForm((current) => {
      const nextValue = type === "checkbox" ? checked : value;
      const nextCategory = name === "birthDate" ? getU14CategoryFromBirthDate(value) : current.category;
      const nextForm = {
        ...current,
        [name]: nextValue,
        ...(name === "birthDate" ? { category: nextCategory } : {}),
      };

      return {
        ...nextForm,
        requestedEvent: getValidRequestedEventForCategory(
          nextCategory,
          name === "requestedEvent" ? value : nextForm.requestedEvent,
        ),
      };
    });

    setStatusMessage("");
    setErrorMessage("");
  }

  async function handleAddChild(event) {
    event.preventDefault();
    setStatusMessage("");
    setErrorMessage("");

    if (!childForm.category) {
      setErrorMessage(t("mcErrorNotEligible"));
      return;
    }

    if (!luxCompetitionClubs.includes(childForm.club) || !childForm.bibNumber.trim()) {
      setErrorMessage(t("mcErrorClubLicence"));
      return;
    }

    if (!getU14AllowedEvents(childForm.category).includes(childForm.requestedEvent) && childForm.requestType !== "porte_panier") {
      setErrorMessage(t("u14ErrorU12Event"));
      return;
    }

    if (!childForm.imageConsent) {
      setErrorMessage(t("mcErrorImageConsent"));
      return;
    }

    setIsSubmittingChild(true);

    try {
      await addU14ChildRegistration({
        ...childForm,
        parentFirstName: userProfile?.firstName || "",
        parentLastName: userProfile?.lastName || "",
        parentEmail: currentUser?.email || "",
        bibNumber: childForm.bibNumber.trim(),
        club: childForm.club,
        firstName: childForm.firstName.trim(),
        lastName: childForm.lastName.trim(),
        notes: childForm.notes.trim(),
      });

      setChildForm(createEmptyParentU14ChildForm());
      setIsAddChildOpen(false);
      setStatusMessage(t("mcChildAdded"));
    } catch (submissionError) {
      setErrorMessage(getPreProgramSubmissionErrorMessage(submissionError, t));
    } finally {
      setIsSubmittingChild(false);
    }
  }

  async function handleConfirmAttendance(row) {
    if (!row.requestId) return;

    setBusyRequestId(row.requestId);
    setStatusMessage("");
    setErrorMessage("");

    try {
      await updateDoc(doc(db, "u14Requests", row.requestId), {
        parentDecisionStatus: "confirmed",
        parentDecisionAt: serverTimestamp(),
      });
      setStatusMessage(t("mcConfirmed").replace("{name}", row.name));
    } catch {
      setErrorMessage(t("mcConfirmError"));
    } finally {
      setBusyRequestId("");
    }
  }

  async function handleDeclineAttendance(row) {
    if (!row.requestId) return;
    if (!window.confirm(t("mcWithdrawConfirm").replace("{name}", row.name))) return;

    const withdrawalReason = window.prompt(t("mcWithdrawReasonPrompt"), "") || "";

    setBusyRequestId(row.requestId);
    setStatusMessage("");
    setErrorMessage("");

    try {
      await updateDoc(doc(db, "u14Requests", row.requestId), {
        status: "declined",
        parentDecisionStatus: "declined",
        parentDecisionAt: serverTimestamp(),
        withdrawalReason: withdrawalReason.trim(),
        acceptedPosition: null,
        waitlistPosition: null,
        queuePosition: null,
      });

      if (row.protectedSlotId) {
        await updateDoc(doc(db, U14_RESERVED_SLOTS_COLLECTION, row.protectedSlotId), {
          status: "released",
          matchedRequestId: null,
          matchedChildId: null,
          matchedParentUserId: null,
          releasedAt: serverTimestamp(),
        });
      }

      // Le recalcul de la liste d'attente (qui doit lire/écrire les demandes de
      // tous les parents) ne peut pas se faire depuis la session du parent —
      // seul l'admin y est autorisé, via "Recalculer les allocations" dans le
      // module Pré-programme.
      const promotedRaceLabel = row.raceCode ? getU14RaceLabel(row.raceCode) : "sa course";
      if (currentUser?.email) {
        const { enqueueTransactionalMail } = await loadMailQueueModule();
        await enqueueTransactionalMail({
          type: "u14-decline-ack",
          to: currentUser.email,
          subject: "Votre désistement a bien été enregistré",
          body: `Bonjour,\n\nLe désistement pour ${row.name} a bien été enregistré. La place libérée sur ${promotedRaceLabel} sera prochainement proposée au prochain enfant sur liste d'attente.\n`,
          metadata: {
            requestId: row.requestId,
            childId: row.childId,
            raceCode: row.raceCode,
          },
        });
      }

      setStatusMessage(t("mcWithdrawn").replace("{name}", row.name));
    } catch {
      setErrorMessage(t("mcWithdrawError"));
    } finally {
      setBusyRequestId("");
    }
  }

  return (
    <div className="page">
      <section className="page-header">
        <div>
          <p className="eyebrow">{t("mcEyebrow")}</p>
          <h1>{t("mcTitle")}</h1>
          <p>{t("mcIntro")}</p>
        </div>
      </section>
      {error ? <p className="status-note">{error}</p> : null}
      {statusMessage ? <p className="panel-note panel-note--success">{statusMessage}</p> : null}
      {errorMessage ? <p className="form-error">{errorMessage}</p> : null}
      <section className="metric-grid metric-grid--3">
        <article className="metric-card">
          <span>{t("mcMetricTotal")}</span>
          <strong>{parentRequestSummary.total}</strong>
        </article>
        <article className="metric-card metric-card--warn">
          <span>{t("mcMetricPending")}</span>
          <strong>{parentRequestSummary.pending}</strong>
        </article>
        <article className="metric-card metric-card--accent">
          <span>{t("mcMetricSelected")}</span>
          <strong>{parentRequestSummary.retained + parentRequestSummary.validated}</strong>
        </article>
      </section>
      <Panel title={t("mcPanelTitle")}>
        <DataTable
          columns={[
            { key: "name", label: t("mcColChild") },
            { key: "type", label: t("mcColType") },
            { key: "status", label: t("mcColStatus") },
            { key: "submittedAt", label: t("mcColSubmittedAt") },
            { key: "position", label: t("mcColPosition") },
            { key: "schedule", label: t("mcColSchedule") },
            { key: "actions", label: t("mcColActions") },
          ]}
          rows={
            loading
              ? [{ name: t("mcLoading"), type: "-", status: "-", submittedAt: "-", position: "-", schedule: "-", actions: "-" }]
              : parentRows.length
                ? parentRows.map((row) => ({
                    ...row,
                    name: (
                      <div className="table-stack">
                        <strong>{row.name}</strong>
                      </div>
                    ),
                    type: <span className="parent-request-type">{formatParentRequestType(row.requestType, t)}</span>,
                    status: <span className={getU14ParentStatusPillClass(row.status)}>{formatParentRequestStatus(row.status, t)}</span>,
                    submittedAt: (
                      <div className="table-stack">
                        <strong>{row.submittedAt}</strong>
                      </div>
                    ),
                    position:
                      row.adminApprovalStatus === "approved" &&
                      (normalizeComparableValue(row.status) === "retenu" || normalizeComparableValue(row.status) === "valide")
                        ? (
                            <span className="status-pill status-pill--accent">
                              {row.acceptedPosition ? t("mcAcceptedPosition").replace("{position}", row.acceptedPosition) : t("mcAccepted")}
                            </span>
                          )
                        : row.status === "Liste d'attente"
                          ? (
                              <span className="status-pill status-pill--warn">
                                {t("mcWaitlistPosition").replace("{position}", row.waitlistPosition || row.queuePosition || "?")}
                              </span>
                            )
                          : "-",
                    schedule: (
                      <div className="table-stack">
                        <strong>{formatParentRequestSchedule(row, t)}</strong>
                        {row.practicalInfoText ? (
                          <span className="parent-request-practical">{row.practicalInfoText}</span>
                        ) : null}
                        {normalizeComparableValue(row.status) === "demande enregistree" &&
                        normalizeComparableValue(row.adminApprovalStatus) !== "approved" &&
                        normalizeComparableValue(row.requestType) !== "porte_panier" ? (
                          <span className="parent-request-note">{t("mcAdminValidationPending")}</span>
                        ) : null}
                      </div>
                    ),
                    actions:
                      !row.requestId || normalizeComparableValue(row.status) === "desiste" ? (
                        "-"
                      ) : (
                        <div className="table-actions table-actions--inline parent-request-actions">
                          {normalizeComparableValue(row.adminApprovalStatus) === "approved" &&
                          row.adminApprovalStatus === "approved" &&
                          row.parentDecisionStatus !== "confirmed" ? (
                            <button
                              className="button button--secondary button--small"
                              type="button"
                              disabled={busyRequestId === row.requestId}
                              onClick={() => handleConfirmAttendance(row)}
                            >
                              {t("mcConfirmButton")}
                            </button>
                          ) : null}
                          {normalizeComparableValue(row.status) !== "desiste" ? (
                            <button
                              className="button button--ghost-danger button--small"
                              type="button"
                              disabled={busyRequestId === row.requestId}
                              onClick={() => handleDeclineAttendance(row)}
                            >
                              {t("mcWithdrawButton")}
                            </button>
                          ) : null}
                        </div>
                      ),
                  }))
                : [{ name: t("mcEmpty"), type: "-", status: "-", submittedAt: "-", position: "-", schedule: "-", actions: "-" }]
          }
        />
      </Panel>
      <div className="panel-actions">
        <button className="button" type="button" onClick={() => setIsAddChildOpen((current) => !current)}>
          {isAddChildOpen ? t("mcCollapseAddChild") : t("mcAddChild")}
        </button>
      </div>
      {isAddChildOpen ? (
        <Panel
          title={t("mcAddChild")}
          subtitle={t("mcAddChildSubtitle")}
        >
          <form className="profile-form" onSubmit={handleAddChild}>
            <div className="panel-grid panel-grid--2">
              <AuthFormField label={t("fieldFirstName")}>
                <input name="firstName" required value={childForm.firstName} onChange={handleChildFormChange} />
              </AuthFormField>
              <AuthFormField label={t("fieldLastName")}>
                <input name="lastName" required value={childForm.lastName} onChange={handleChildFormChange} />
              </AuthFormField>
            </div>
            <div className="panel-grid panel-grid--2">
              <AuthFormField label={t("fieldBirthDate")} hint={t("mcBirthDateHint")}>
                <input
                  name="birthDate"
                  required
                  type="date"
                  value={childForm.birthDate}
                  onChange={handleChildFormChange}
                />
              </AuthFormField>
              <AuthFormField label={t("u14CategoryLabel")}>
                <input readOnly name="category" value={childForm.category} />
              </AuthFormField>
            </div>
            {childForm.birthDate && !childForm.category ? (
              <div className="notice-card notice-card--danger">
                <strong>{t("u14NotEligibleTitle")}</strong>
                <p>{t("mcNotEligibleBody")}</p>
              </div>
            ) : null}
            <div className="panel-grid panel-grid--2">
              <AuthFormField label={t("fieldGender")}>
                <select name="gender" required value={childForm.gender} onChange={handleChildFormChange}>
                  <option value="">{t("fieldSelectPlaceholder")}</option>
                  <option value="fille">{t("u14GenderGirl")}</option>
                  <option value="garcon">{t("u14GenderBoy")}</option>
                </select>
              </AuthFormField>
              <AuthFormField label={t("u14ClubLabel")}>
                <select name="club" required value={childForm.club} onChange={handleChildFormChange}>
                  <option value="">{t("u14SelectClub")}</option>
                  {luxCompetitionClubs.map((club) => (
                    <option key={club} value={club}>
                      {club}
                    </option>
                  ))}
                </select>
              </AuthFormField>
            </div>
            <div className="panel-grid panel-grid--2">
              <AuthFormField label={t("u14LicenceLabel")}>
                <input name="bibNumber" required value={childForm.bibNumber} onChange={handleChildFormChange} />
              </AuthFormField>
              <AuthFormField label={t("u14RequestTypeLabel")}>
                <select name="requestType" value={childForm.requestType} onChange={handleChildFormChange}>
                  <option value="preprogram">{t("u14TypePreprogram")}</option>
                  <option value="porte_panier">{t("u14TypeBasket")}</option>
                  <option value="preprogram_ou_porte_panier">{t("u14TypeEither")}</option>
                </select>
              </AuthFormField>
            </div>
            {childForm.requestType !== "porte_panier" ? (
              <div className="panel-grid panel-grid--2">
                <AuthFormField label={t("u14EventLabel")}>
                  <select name="requestedEvent" value={childForm.requestedEvent} onChange={handleChildFormChange}>
                    {getU14AllowedEvents(childForm.category).map((eventOption) => (
                      <option key={eventOption} value={eventOption}>
                        {eventOption}
                      </option>
                    ))}
                  </select>
                </AuthFormField>
                <AuthFormField label={t("u14NotesLabel")}>
                  <input name="notes" value={childForm.notes} onChange={handleChildFormChange} />
                </AuthFormField>
              </div>
            ) : (
              <AuthFormField label={t("u14NotesLabel")}>
                <input name="notes" value={childForm.notes} onChange={handleChildFormChange} />
              </AuthFormField>
            )}
            <label className="selection-card">
              <input
                checked={childForm.imageConsent}
                name="imageConsent"
                type="checkbox"
                onChange={handleChildFormChange}
              />
              <div>
                <strong>{t("u14ImageConsentTitle")}</strong>
                <p>{t("mcImageConsentBody")}</p>
              </div>
            </label>
            <div className="panel-actions">
              <button className="button" type="submit" disabled={isSubmittingChild}>
                {isSubmittingChild ? t("mcSaving") : t("mcAddChildButton")}
              </button>
            </div>
          </form>
        </Panel>
      ) : null}
    </div>
  );
}

export { MyChildrenPage };
