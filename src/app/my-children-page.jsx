import { useMemo, useState } from "react";
import { doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { AuthFormField } from "./form-components";
import {
  U14_RESERVED_SLOTS_COLLECTION,
  createEmptyParentU14ChildForm,
  getPreProgramSubmissionErrorMessage,
  getU14AllowedEvents,
  getU14ParentStatusPillClass,
  getU14RaceLabel,
  getValidRequestedEventForCategory,
} from "./u14-helpers";
import { useParentU14Children } from "./u14-hooks";
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
      setErrorMessage("Seuls les enfants U12 et U14 peuvent être ajoutés dans cet espace.");
      return;
    }

    if (!luxCompetitionClubs.includes(childForm.club) || !childForm.bibNumber.trim()) {
      setErrorMessage("Merci d'indiquer un club luxembourgeois autorisé et un numéro de licence.");
      return;
    }

    if (!getU14AllowedEvents(childForm.category).includes(childForm.requestedEvent) && childForm.requestType !== "porte_panier") {
      setErrorMessage("Pour la catégorie U12, seule l'épreuve du 60 m peut être demandée.");
      return;
    }

    if (!childForm.imageConsent) {
      setErrorMessage("L'autorisation image est obligatoire pour enregistrer un enfant.");
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
      setStatusMessage("Enfant ajouté. La demande est maintenant visible dans le suivi.");
    } catch (submissionError) {
      setErrorMessage(getPreProgramSubmissionErrorMessage(submissionError));
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
      setStatusMessage(`${row.name} est maintenant confirmé.`);
    } catch {
      setErrorMessage("Impossible d'enregistrer votre confirmation pour le moment.");
    } finally {
      setBusyRequestId("");
    }
  }

  async function handleDeclineAttendance(row) {
    if (!row.requestId) return;
    if (!window.confirm(`Cette action est définitive. Êtes-vous sûr de vouloir vous désister pour ${row.name} ?`)) return;

    const withdrawalReason = window.prompt("Motif du désistement (facultatif)", "") || "";

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

      setStatusMessage(`Le désistement de ${row.name} a été enregistré.`);
    } catch {
      setErrorMessage("Impossible d'enregistrer ce désistement pour le moment.");
    } finally {
      setBusyRequestId("");
    }
  }

  return (
    <div className="page">
      <section className="page-header">
        <div>
          <p className="eyebrow">Parent U14</p>
          <h1>Mes enfants</h1>
          <p>Demandes, decisions, convocations et informations pratiques centralisees.</p>
        </div>
      </section>
      {error ? <p className="status-note">{error}</p> : null}
      {statusMessage ? <p className="panel-note panel-note--success">{statusMessage}</p> : null}
      {errorMessage ? <p className="form-error">{errorMessage}</p> : null}
      <section className="metric-grid metric-grid--3">
        <article className="metric-card">
          <span>Demandes suivies</span>
          <strong>{parentRequestSummary.total}</strong>
        </article>
        <article className="metric-card metric-card--warn">
          <span>En attente</span>
          <strong>{parentRequestSummary.pending}</strong>
        </article>
        <article className="metric-card metric-card--accent">
          <span>Retenues / validées</span>
          <strong>{parentRequestSummary.retained + parentRequestSummary.validated}</strong>
        </article>
      </section>
      <Panel title="Suivi des demandes">
        <DataTable
          columns={[
            { key: "name", label: "Enfant" },
            { key: "type", label: "Type" },
            { key: "status", label: "Statut" },
            { key: "submittedAt", label: "Demande faite le" },
            { key: "position", label: "Position" },
            { key: "schedule", label: "Info pratique" },
            { key: "actions", label: "Actions" },
          ]}
          rows={
            loading
              ? [{ name: "Chargement...", type: "-", status: "-", submittedAt: "-", position: "-", schedule: "-", actions: "-" }]
              : parentRows.length
                ? parentRows.map((row) => ({
                    ...row,
                    name: (
                      <div className="table-stack">
                        <strong>{row.name}</strong>
                      </div>
                    ),
                    type: <span className="parent-request-type">{row.type}</span>,
                    status: <span className={getU14ParentStatusPillClass(row.status)}>{row.status}</span>,
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
                              {row.acceptedPosition ? `Accepté - place ${row.acceptedPosition}` : "Accepté"}
                            </span>
                          )
                        : row.status === "Liste d'attente"
                          ? (
                              <span className="status-pill status-pill--warn">
                                {`Liste d'attente - place ${row.waitlistPosition || row.queuePosition || "?"}`}
                              </span>
                            )
                          : "-",
                    schedule: (
                      <div className="table-stack">
                        <strong>{row.schedule}</strong>
                        {row.practicalInfoText ? (
                          <span className="parent-request-practical">{row.practicalInfoText}</span>
                        ) : null}
                        {normalizeComparableValue(row.status) === "demande enregistree" &&
                        normalizeComparableValue(row.adminApprovalStatus) !== "approved" &&
                        normalizeComparableValue(row.requestType) !== "porte_panier" ? (
                          <span className="parent-request-note">Validation admin en cours</span>
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
                              Je confirme
                            </button>
                          ) : null}
                          {normalizeComparableValue(row.status) !== "desiste" ? (
                            <button
                              className="button button--ghost-danger button--small"
                              type="button"
                              disabled={busyRequestId === row.requestId}
                              onClick={() => handleDeclineAttendance(row)}
                            >
                              Se désister
                            </button>
                          ) : null}
                        </div>
                      ),
                  }))
                : [{ name: "Aucune demande liée à ce compte", type: "-", status: "-", submittedAt: "-", position: "-", schedule: "-", actions: "-" }]
          }
        />
      </Panel>
      <div className="panel-actions">
        <button className="button" type="button" onClick={() => setIsAddChildOpen((current) => !current)}>
          {isAddChildOpen ? "Replier l'ajout d'enfant" : "Ajouter un enfant"}
        </button>
      </div>
      {isAddChildOpen ? (
        <Panel
          title="Ajouter un enfant"
          subtitle="Permet de compléter votre dossier si le compte parent existe déjà ou si vous souhaitez ajouter un nouvel enfant après coup."
        >
          <form className="profile-form" onSubmit={handleAddChild}>
            <div className="panel-grid panel-grid--2">
              <AuthFormField label="Prénom">
                <input name="firstName" required value={childForm.firstName} onChange={handleChildFormChange} />
              </AuthFormField>
              <AuthFormField label="Nom">
                <input name="lastName" required value={childForm.lastName} onChange={handleChildFormChange} />
              </AuthFormField>
            </div>
            <div className="panel-grid panel-grid--2">
              <AuthFormField label="Date de naissance" hint="U12 = 2017/2016, U14 = 2015/2014 pour l'édition 2027.">
                <input
                  name="birthDate"
                  required
                  type="date"
                  value={childForm.birthDate}
                  onChange={handleChildFormChange}
                />
              </AuthFormField>
              <AuthFormField label="Catégorie attribuée">
                <input readOnly name="category" value={childForm.category} />
              </AuthFormField>
            </div>
            {childForm.birthDate && !childForm.category ? (
              <div className="notice-card notice-card--danger">
                <strong>Catégorie non éligible</strong>
                <p>Seuls les enfants U12 et U14 peuvent être ajoutés dans cet espace parent.</p>
              </div>
            ) : null}
            <div className="panel-grid panel-grid--2">
              <AuthFormField label="Genre">
                <select name="gender" required value={childForm.gender} onChange={handleChildFormChange}>
                  <option value="">Sélectionner</option>
                  <option value="fille">Fille</option>
                  <option value="garcon">Garcon</option>
                </select>
              </AuthFormField>
              <AuthFormField label="Club">
                <select name="club" required value={childForm.club} onChange={handleChildFormChange}>
                  <option value="">Sélectionner un club</option>
                  {luxCompetitionClubs.map((club) => (
                    <option key={club} value={club}>
                      {club}
                    </option>
                  ))}
                </select>
              </AuthFormField>
            </div>
            <div className="panel-grid panel-grid--2">
              <AuthFormField label="Numéro de licence">
                <input name="bibNumber" required value={childForm.bibNumber} onChange={handleChildFormChange} />
              </AuthFormField>
              <AuthFormField label="Type d'inscription souhaité">
                <select name="requestType" value={childForm.requestType} onChange={handleChildFormChange}>
                  <option value="preprogram">Pré-programme U12/U14</option>
                  <option value="porte_panier">Porte-panier</option>
                  <option value="preprogram_ou_porte_panier">Pré-programme ou porte-panier</option>
                </select>
              </AuthFormField>
            </div>
            {childForm.requestType !== "porte_panier" ? (
              <div className="panel-grid panel-grid--2">
                <AuthFormField label="Épreuve demandée">
                  <select name="requestedEvent" value={childForm.requestedEvent} onChange={handleChildFormChange}>
                    {getU14AllowedEvents(childForm.category).map((eventOption) => (
                      <option key={eventOption} value={eventOption}>
                        {eventOption}
                      </option>
                    ))}
                  </select>
                </AuthFormField>
                <AuthFormField label="Informations utiles">
                  <input name="notes" value={childForm.notes} onChange={handleChildFormChange} />
                </AuthFormField>
              </div>
            ) : (
              <AuthFormField label="Informations utiles">
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
                <strong>Autorisation image</strong>
                <p>Cette autorisation est requise pour enregistrer l'enfant dans le pré-programme.</p>
              </div>
            </label>
            <div className="panel-actions">
              <button className="button" type="submit" disabled={isSubmittingChild}>
                {isSubmittingChild ? "Enregistrement..." : "Ajouter cet enfant"}
              </button>
            </div>
          </form>
        </Panel>
      ) : null}
    </div>
  );
}

export { MyChildrenPage };
