import { useState } from "react";
import { doc, getDoc, serverTimestamp, updateDoc } from "firebase/firestore";
import { AuthFormField } from "./form-components";
import { useActiveEdition } from "./edition";
import { useMeetingEditions } from "./meeting-history-hooks";
import {
  U14_PRACTICAL_INFO_DOC_PATH,
  U14_RESERVED_SLOTS_COLLECTION,
  createEmptyParentU14ChildForm,
  formatDateForDisplay,
  formatParentRequestSchedule,
  formatParentRequestStatus,
  formatParentRequestType,
  getPreProgramSubmissionErrorMessage,
  getU14AllowedEvents,
  isU14BasketOnlyCategory,
  getU14ParentStatusPillClass,
  getU14PracticalRoleKey,
  getU14RaceLabel,
  getValidRequestedEventForCategory,
} from "./u14-helpers";
import { useParentU14Children } from "./u14-hooks";
import { useLanguage } from "./language-context";
import { useAuth } from "../context/auth-context";
import { db } from "../services/firebase";
import "./my-children.css";

function MyChildrenPage(props) {
  const {
    Panel,
    getU14CategoryFromBirthDate,
    loadMailQueueModule,
    luxCompetitionClubs,
    normalizeComparableValue,
  } = props;
  const { addU14ChildRegistration, currentUser, userProfile } = useAuth();
  const { t } = useLanguage();
  const { rows: parentRows, loading, error } = useParentU14Children(currentUser?.uid);
  const { activeEditionId } = useActiveEdition();
  const { editions } = useMeetingEditions();
  const activeEdition = editions.find((edition) => String(edition.year || edition.id) === String(activeEditionId)) || null;
  const [childForm, setChildForm] = useState(createEmptyParentU14ChildForm);
  const [isAddChildOpen, setIsAddChildOpen] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [busyRequestId, setBusyRequestId] = useState("");
  const [isSubmittingChild, setIsSubmittingChild] = useState(false);
  // Place proposée par l'équipe, que le parent doit encore confirmer.
  const needsParentConfirmation = (row) =>
    Boolean(row.requestId) &&
    row.adminApprovalStatus === "approved" &&
    row.parentDecisionStatus !== "confirmed" &&
    row.parentDecisionStatus !== "declined" &&
    normalizeComparableValue(row.status) !== "desiste";
  const rowsToConfirm = loading ? [] : parentRows.filter(needsParentConfirmation);

  function handleChildFormChange(event) {
    const { name, type, checked, value } = event.target;

    setChildForm((current) => {
      const nextValue = type === "checkbox" ? checked : value;
      const nextCategory = name === "birthDate" ? getU14CategoryFromBirthDate(value) : current.category;
      const nextForm = {
        ...current,
        [name]: nextValue,
        ...(name === "birthDate" ? { category: nextCategory } : {}),
        // U16 : porte-panier seulement.
        ...(isU14BasketOnlyCategory(nextCategory) ? { requestType: "porte_panier" } : {}),
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

    if (isU14BasketOnlyCategory(childForm.category) && childForm.requestType !== "porte_panier") {
      setErrorMessage(t("u14BasketOnlyNote"));
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

      // « Merci, tout est ok » avec les infos pratiques du rôle.
      if (currentUser?.email) {
        try {
          const isBasket = getU14PracticalRoleKey(row) === "porte_panier";
          const practicalSnapshot = await getDoc(doc(db, ...U14_PRACTICAL_INFO_DOC_PATH)).catch(() => null);
          const practical = practicalSnapshot?.exists?.() ? practicalSnapshot.data() || {} : {};
          const { buildU14ParticipationConfirmedMail, enqueueTransactionalMail } = await loadMailQueueModule();
          await enqueueTransactionalMail(
            buildU14ParticipationConfirmedMail({
              parentEmail: currentUser.email,
              parentFirstName: userProfile?.firstName || "",
              childName: row.name,
              raceLabel: getU14RaceLabel(row.raceCode),
              isBasket,
              eventDate: activeEdition?.date || null,
              venue: activeEdition?.venue || "",
              editionYear: activeEdition?.year || activeEditionId,
              practicalInfo: isBasket ? practical.porte_panier || "" : practical.preprogram || "",
            }),
          );
        } catch (mailError) {
          console.error("Participation confirmation email could not be sent", mailError);
          setErrorMessage(t("mcConfirmMailError"));
        }
      }
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

      // Le recalcul de la liste d'attente (qui lit/écrit les demandes de tous
      // les parents) se fait côté serveur dès ce désistement
      // (functions/src/u14-allocation.js) : l'enfant suivant monte et reste à
      // valider par l'équipe.
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
      {rowsToConfirm.length ? (
        <div className="mc-callout" role="status">
          <strong>{t("mcActionTitle")}</strong>
          {rowsToConfirm.map((row) => (
            <p key={row.requestId}>
              {t("mcActionBody").replace("{name}", row.name)}
              {row.confirmationDeadline ? (
                <> <b>{t("mcActionDeadline").replace("{date}", formatDateForDisplay(row.confirmationDeadline))}</b></>
              ) : null}
            </p>
          ))}
        </div>
      ) : null}
      <Panel title={t("mcPanelTitle")}>
        {loading ? (
          <p className="parent-request-note">{t("mcLoading")}</p>
        ) : !parentRows.length ? (
          <p className="parent-request-note">{t("mcEmpty")}</p>
        ) : (
          <div className="mc-list">
            {parentRows.map((row, index) => {
              const statusKey = normalizeComparableValue(row.status);
              const isWithdrawn = statusKey === "desiste";
              const isAccepted = row.adminApprovalStatus === "approved" && (statusKey === "retenu" || statusKey === "valide");
              const toConfirm = needsParentConfirmation(row);
              const isConfirmed = row.parentDecisionStatus === "confirmed";
              const isBusy = busyRequestId === row.requestId;

              return (
                <article
                  key={row.requestId || `${row.name}-${index}`}
                  className={`mc-card${toConfirm ? " mc-card--todo" : ""}${isWithdrawn ? " mc-card--muted" : ""}`}
                >
                  <header className="mc-card__head">
                    <div className="mc-card__who">
                      <strong>{row.name}</strong>
                      <span>{formatParentRequestType(row.requestType, t)}</span>
                    </div>
                    <span className={getU14ParentStatusPillClass(row.status)}>{formatParentRequestStatus(row.status, t)}</span>
                  </header>

                  <dl className="mc-card__facts">
                    <div>
                      <dt>{t("mcColSchedule")}</dt>
                      <dd>{formatParentRequestSchedule(row, t)}</dd>
                    </div>
                    {isAccepted || statusKey === "liste d'attente" ? (
                      <div>
                        <dt>{t("mcColPosition")}</dt>
                        <dd>
                          {isAccepted
                            ? row.acceptedPosition
                              ? t("mcAcceptedPosition").replace("{position}", row.acceptedPosition)
                              : t("mcAccepted")
                            : t("mcWaitlistPosition").replace("{position}", row.waitlistPosition || row.queuePosition || "?")}
                        </dd>
                      </div>
                    ) : null}
                    {row.submittedAt ? (
                      <div>
                        <dt>{t("mcColSubmittedAt")}</dt>
                        <dd>{row.submittedAt}</dd>
                      </div>
                    ) : null}
                  </dl>

                  {statusKey === "demande enregistree" &&
                  normalizeComparableValue(row.adminApprovalStatus) !== "approved" &&
                  normalizeComparableValue(row.requestType) !== "porte_panier" ? (
                    <p className="parent-request-note">{t("mcAdminValidationPending")}</p>
                  ) : null}
                  {isConfirmed && !isWithdrawn ? <p className="mc-card__ok">✓ {t("mcConfirmedNote")}</p> : null}
                  {row.practicalInfoText ? <p className="parent-request-practical">{row.practicalInfoText}</p> : null}

                  {row.requestId && !isWithdrawn ? (
                    <div className="mc-card__actions">
                      {toConfirm ? (
                        <>
                          {row.confirmationDeadline ? (
                            <p className="mc-card__deadline">
                              {t("mcConfirmBefore").replace("{date}", formatDateForDisplay(row.confirmationDeadline))}
                            </p>
                          ) : null}
                          <button
                            className="button button--primary mc-card__confirm"
                            type="button"
                            disabled={isBusy}
                            onClick={() => handleConfirmAttendance(row)}
                          >
                            {t("mcConfirmButton")}
                          </button>
                        </>
                      ) : null}
                      <button
                        className="button button--ghost-danger button--small mc-card__withdraw"
                        type="button"
                        disabled={isBusy}
                        onClick={() => handleDeclineAttendance(row)}
                      >
                        {t("mcWithdrawButton")}
                      </button>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
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
            {isU14BasketOnlyCategory(childForm.category) ? <p className="panel-note">{t("u14BasketOnlyNote")}</p> : null}
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
                  {isU14BasketOnlyCategory(childForm.category) ? null : <option value="preprogram">{t("u14TypePreprogram")}</option>}
                  <option value="porte_panier">{t("u14TypeBasket")}</option>
                  {isU14BasketOnlyCategory(childForm.category) ? null : (
                    <option value="preprogram_ou_porte_panier">{t("u14TypeEither")}</option>
                  )}
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
