import { useMemo, useState } from "react";
import { doc, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import { db } from "../services/firebase";
import { formatDateForDisplay, getU14RaceLabel } from "./u14-helpers";
import {
  U14_PROTECTED_INVITES_COLLECTION,
  U14_PROTECTED_INVITE_STATUS_LABELS,
  U14_PROTECTED_POOL_LABELS,
  U14_PROTECTED_SETTINGS_DOC_PATH,
  buildU14ProtectedInviteUrl,
  generateU14InviteToken,
  getU14ProtectedInviteStatus,
  parseU14ProtectedInvitesPaste,
} from "./u14-protected";

const STATUS_PILLS = {
  invited: "status-pill status-pill--warn",
  claimed: "status-pill status-pill--ok",
  expired: "status-pill status-pill--danger",
  cancelled: "status-pill",
};

// Onglet « Places protégées » : réserves par catégorie, date limite, import
// de la liste des enfants invités et suivi des invitations.
function U14ProtectedTab(props) {
  const {
    DataTable,
    Panel,
    activeEditionId,
    claimedByPool,
    invites,
    loadMailQueueModule,
    mailContext,
    requestRecords,
    reserveByPool,
    reserveReleased,
    settings,
  } = props;
  const [poolDraft, setPoolDraft] = useState(null);
  const [deadlineDraft, setDeadlineDraft] = useState(null);
  const [pasteText, setPasteText] = useState("");
  const [preview, setPreview] = useState([]);
  const [isBusy, setIsBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [now] = useState(() => Date.now());
  const pools = poolDraft || settings.pools;
  const deadline = deadlineDraft ?? settings.deadline;
  const requestsById = useMemo(() => new Map(requestRecords.map((request) => [request.id, request])), [requestRecords]);
  const knownBibs = useMemo(
    () => new Set(invites.filter((invite) => invite.status !== "cancelled").map((invite) => String(invite.bibNumber).trim())),
    [invites],
  );
  const sortedInvites = useMemo(
    () => [...invites].sort((left, right) => `${left.lastName} ${left.firstName}`.localeCompare(`${right.lastName} ${right.firstName}`, "fr")),
    [invites],
  );
  const validPreview = preview.filter((row) => !row.errors.length);

  function flash(message) {
    setStatusMessage(message);
    setErrorMessage("");
  }

  async function handleSaveSettings() {
    setIsBusy(true);
    try {
      await setDoc(
        doc(db, ...U14_PROTECTED_SETTINGS_DOC_PATH),
        { pools, deadline, editionId: activeEditionId, updatedAt: serverTimestamp() },
        { merge: true },
      );
      setPoolDraft(null);
      setDeadlineDraft(null);
      flash("Réserves et date limite enregistrées.");
    } catch {
      setErrorMessage("Les réglages n'ont pas pu être enregistrés.");
    } finally {
      setIsBusy(false);
    }
  }

  function handlePreview() {
    const rows = parseU14ProtectedInvitesPaste(pasteText).map((row) => ({
      ...row,
      errors: knownBibs.has(String(row.bibNumber).trim()) ? [...row.errors, "déjà invité(e)"] : row.errors,
    }));
    setPreview(rows);
    setStatusMessage("");
    setErrorMessage(rows.length ? "" : "Aucune ligne reconnue : collez Nom, Prénom, Club, Mail, Dossard.");
  }

  async function sendInviteMail(invite) {
    const { buildU14ProtectedInviteMail, enqueueTransactionalMail } = await loadMailQueueModule();
    await enqueueTransactionalMail(
      buildU14ProtectedInviteMail({
        ...mailContext,
        parentEmail: invite.parentEmail,
        childName: `${invite.firstName} ${invite.lastName}`,
        club: invite.club,
        inviteUrl: buildU14ProtectedInviteUrl(invite.id),
        deadline: invite.deadline,
      }),
    );
  }

  async function handleCreateInvites() {
    if (!settings.deadline) {
      setErrorMessage("Enregistrez d'abord la date limite des places protégées.");
      return;
    }
    if (!window.confirm(`Créer ${validPreview.length} invitation(s) et envoyer les mails maintenant ?`)) return;
    setIsBusy(true);
    const failed = [];
    let created = 0;
    for (const row of validPreview) {
      const token = generateU14InviteToken();
      const invite = {
        id: token,
        editionId: activeEditionId,
        firstName: row.firstName,
        lastName: row.lastName,
        club: row.club,
        bibNumber: row.bibNumber,
        parentEmail: row.parentEmail,
        deadline: settings.deadline,
        status: "invited",
      };
      try {
        const { id, ...data } = invite;
        await setDoc(doc(db, U14_PROTECTED_INVITES_COLLECTION, id), { ...data, createdAt: serverTimestamp() });
        created += 1;
        await sendInviteMail(invite);
        await updateDoc(doc(db, U14_PROTECTED_INVITES_COLLECTION, id), { invitationSentAt: serverTimestamp() });
      } catch {
        failed.push(`${row.firstName} ${row.lastName}`);
      }
    }
    setIsBusy(false);
    setPreview([]);
    setPasteText("");
    if (failed.length) setErrorMessage(`Problème (création ou mail) pour : ${failed.join(", ")}.`);
    flash(`${created} invitation(s) créée(s).`);
  }

  async function handleResend(invite) {
    setIsBusy(true);
    try {
      await sendInviteMail(invite);
      await updateDoc(doc(db, U14_PROTECTED_INVITES_COLLECTION, invite.id), { invitationSentAt: serverTimestamp() });
      flash(`Invitation renvoyée à ${invite.parentEmail}.`);
    } catch {
      setErrorMessage("L'invitation n'a pas pu être renvoyée.");
    } finally {
      setIsBusy(false);
    }
  }

  async function handleCancel(invite) {
    if (!window.confirm(`Annuler l'invitation de ${invite.firstName} ${invite.lastName} ? Le lien ne fonctionnera plus.`)) return;
    setIsBusy(true);
    try {
      await updateDoc(doc(db, U14_PROTECTED_INVITES_COLLECTION, invite.id), { status: "cancelled", cancelledAt: serverTimestamp() });
      flash("Invitation annulée.");
    } catch {
      setErrorMessage("L'invitation n'a pas pu être annulée.");
    } finally {
      setIsBusy(false);
    }
  }

  async function handleCopyLink(invite) {
    try {
      await navigator.clipboard.writeText(buildU14ProtectedInviteUrl(invite.id));
      flash("Lien copié.");
    } catch {
      setErrorMessage(buildU14ProtectedInviteUrl(invite.id));
    }
  }

  return (
    <>
      {statusMessage ? <p className="panel-note panel-note--success">{statusMessage}</p> : null}
      {errorMessage ? <p className="form-error">{errorMessage}</p> : null}

      <Panel
        title="Réserves par catégorie"
        subtitle="Places bloquées dans chaque course de la catégorie tant que les enfants invités n'ont pas confirmé. Chaque confirmation réduit la réserve ; à la date limite, le reste est rendu aux places générales."
      >
        <div className="u14-pool-grid">
          {Object.keys(pools).map((poolKey) => (
            <div key={poolKey} className="u14-pool-card">
              <strong>{U14_PROTECTED_POOL_LABELS[poolKey]}</strong>
              <label className="field">
                <span>Réserve</span>
                <input
                  min="0"
                  type="number"
                  value={pools[poolKey]}
                  onChange={(event) => setPoolDraft({ ...pools, [poolKey]: Number(event.target.value) })}
                />
              </label>
              <span className="parent-request-note">
                {claimedByPool[poolKey] || 0} confirmé(s) · {reserveByPool[poolKey] || 0} place(s) encore bloquée(s)
              </span>
            </div>
          ))}
        </div>
        <div className="u14-protected-settings-row">
          <label className="field">
            <span>Date limite d'inscription des enfants invités</span>
            <input type="date" value={deadline} onChange={(event) => setDeadlineDraft(event.target.value)} />
          </label>
          <span className="parent-request-note">
            {reserveReleased
              ? "Date limite passée : la réserve est rendue aux places générales. Pensez à recalculer les statuts."
              : "Rappel automatique aux familles 2 jours avant ; libération automatique le lendemain de la date limite."}
          </span>
          <button className="button button--primary" disabled={isBusy || (!poolDraft && deadlineDraft === null)} type="button" onClick={handleSaveSettings}>
            Enregistrer
          </button>
        </div>
      </Panel>

      <Panel
        title="Importer la liste des enfants invités"
        subtitle="Collez depuis Excel : Nom, Prénom, Club, Mail, Dossard (une ligne par enfant). La famille choisira la course et complétera ses coordonnées."
      >
        <textarea
          className="u14-paste"
          placeholder={"Weber\tEmma\tCAB\tparent@example.lu\t245"}
          rows="5"
          value={pasteText}
          onChange={(event) => setPasteText(event.target.value)}
        />
        <div className="table-actions table-actions--inline">
          <button className="button button--secondary" disabled={!pasteText.trim()} type="button" onClick={handlePreview}>
            Vérifier la liste
          </button>
        </div>
        {preview.length ? (
          <>
            <DataTable
              columns={[
                { key: "child", label: "Enfant" },
                { key: "club", label: "Club" },
                { key: "bib", label: "Dossard" },
                { key: "email", label: "Mail" },
                { key: "check", label: "Contrôle" },
              ]}
              rows={preview.map((row, index) => ({
                id: `preview-${index}`,
                child: `${row.firstName} ${row.lastName}`,
                club: row.club || "-",
                bib: row.bibNumber || "-",
                email: row.parentEmail || "-",
                check: row.errors.length ? (
                  <span className="status-pill status-pill--danger">{row.errors.join(", ")}</span>
                ) : (
                  <span className="status-pill status-pill--ok">OK</span>
                ),
              }))}
            />
            <div className="table-actions table-actions--inline">
              <button className="button button--primary" disabled={isBusy || !validPreview.length} type="button" onClick={handleCreateInvites}>
                {isBusy ? "Envoi…" : `Créer ${validPreview.length} invitation(s) et envoyer les mails`}
              </button>
              {preview.length !== validPreview.length ? (
                <span className="parent-request-note">Les lignes en erreur ne seront pas créées.</span>
              ) : null}
            </div>
          </>
        ) : null}
      </Panel>

      <Panel title={`Invitations (${invites.length})`} subtitle="La course apparaît quand la famille a confirmé avec son lien.">
        <DataTable
          columns={[
            { key: "child", label: "Enfant" },
            { key: "email", label: "Mail" },
            { key: "status", label: "Statut" },
            { key: "race", label: "Course choisie" },
            { key: "actions", label: "Actions" },
          ]}
          rows={
            sortedInvites.length
              ? sortedInvites.map((invite) => {
                  const status = getU14ProtectedInviteStatus(invite, now);
                  const claimedRequest = requestsById.get(invite.claimedRequestId);
                  return {
                    id: invite.id,
                    child: (
                      <div className="table-stack">
                        <strong>{invite.firstName} {invite.lastName}</strong>
                        <span className="parent-request-note">{invite.club || "-"} · dossard {invite.bibNumber || "-"}</span>
                      </div>
                    ),
                    email: invite.parentEmail,
                    status: (
                      <div className="table-stack">
                        <span className={STATUS_PILLS[status] || "status-pill"}>{U14_PROTECTED_INVITE_STATUS_LABELS[status] || status}</span>
                        {status === "invited" ? (
                          <span className="parent-request-note">
                            avant le {formatDateForDisplay(invite.deadline)}
                            {invite.reminderSentAt ? " · rappel envoyé" : ""}
                          </span>
                        ) : null}
                        {claimedRequest && claimedRequest.status === "declined" ? (
                          <span className="status-pill status-pill--danger">Désisté ensuite</span>
                        ) : null}
                      </div>
                    ),
                    race: invite.claimedRaceCode ? getU14RaceLabel(invite.claimedRaceCode) : "-",
                    actions:
                      status === "invited" ? (
                        <div className="table-actions table-actions--inline">
                          <button className="button button--secondary button--small" type="button" onClick={() => handleCopyLink(invite)}>
                            Copier le lien
                          </button>
                          <button className="button button--secondary button--small" disabled={isBusy} type="button" onClick={() => handleResend(invite)}>
                            Renvoyer
                          </button>
                          <button className="button button--ghost-danger button--small" disabled={isBusy} type="button" onClick={() => handleCancel(invite)}>
                            Annuler
                          </button>
                        </div>
                      ) : (
                        "-"
                      ),
                  };
                })
              : [{ id: "empty", child: "Aucune invitation pour l'instant", email: "-", status: "-", race: "-", actions: "-" }]
          }
        />
      </Panel>
    </>
  );
}

export { U14ProtectedTab };
