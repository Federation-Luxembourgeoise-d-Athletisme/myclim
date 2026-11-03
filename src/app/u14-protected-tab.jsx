import { useMemo, useState } from "react";
import { doc, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import { db } from "../services/firebase";
import { formatDateForDisplay, getU14RaceLabel } from "./u14-helpers";
import { useU14AdminCopy } from "./u14-admin-copy";
import {
  U14_PROTECTED_INVITES_COLLECTION,
  U14_PROTECTED_SETTINGS_DOC_PATH,
  buildU14ProtectedInviteUrl,
  generateU14InviteToken,
  getU14InvitePoolKey,
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
  const { copy, fill, raceLabel } = useU14AdminCopy();
  const text = copy.protected;
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
      flash(text.saved);
    } catch {
      setErrorMessage(text.saveFailed);
    } finally {
      setIsBusy(false);
    }
  }

  function handlePreview() {
    const rows = parseU14ProtectedInvitesPaste(pasteText).map((row) => ({
      ...row,
      errors: knownBibs.has(String(row.bibNumber).trim()) ? [...row.errors, "duplicate"] : row.errors,
    }));
    setPreview(rows);
    setStatusMessage("");
    setErrorMessage(rows.length ? "" : text.noRows);
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
      setErrorMessage(text.deadlineFirst);
      return;
    }
    if (!window.confirm(fill(text.createConfirm, { count: validPreview.length }))) return;
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
        birthYear: row.birthYear,
        gender: row.gender,
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
    if (failed.length) setErrorMessage(fill(text.createProblems, { names: failed.join(", ") }));
    flash(fill(text.created, { count: created }));
  }

  async function handleResend(invite) {
    setIsBusy(true);
    try {
      await sendInviteMail(invite);
      await updateDoc(doc(db, U14_PROTECTED_INVITES_COLLECTION, invite.id), { invitationSentAt: serverTimestamp() });
      flash(fill(text.resent, { email: invite.parentEmail }));
    } catch {
      setErrorMessage(text.resendFailed);
    } finally {
      setIsBusy(false);
    }
  }

  async function handleCancel(invite) {
    if (!window.confirm(fill(text.cancelConfirm, { name: `${invite.firstName} ${invite.lastName}` }))) return;
    setIsBusy(true);
    try {
      await updateDoc(doc(db, U14_PROTECTED_INVITES_COLLECTION, invite.id), { status: "cancelled", cancelledAt: serverTimestamp() });
      flash(text.cancelled);
    } catch {
      setErrorMessage(text.cancelFailed);
    } finally {
      setIsBusy(false);
    }
  }

  async function handleCopyLink(invite) {
    try {
      await navigator.clipboard.writeText(buildU14ProtectedInviteUrl(invite.id));
      flash(text.copied);
    } catch {
      setErrorMessage(buildU14ProtectedInviteUrl(invite.id));
    }
  }

  return (
    <>
      {statusMessage ? <p className="panel-note panel-note--success">{statusMessage}</p> : null}
      {errorMessage ? <p className="form-error">{errorMessage}</p> : null}

      <Panel
        title={text.poolsTitle}
        subtitle={text.poolsSubtitle}
      >
        <div className="u14-pool-grid">
          {Object.keys(pools).map((poolKey) => (
            <div key={poolKey} className="u14-pool-card">
              <strong>{text.poolLabels[poolKey]}</strong>
              <label className="field">
                <span>{text.reserve}</span>
                <input
                  min="0"
                  type="number"
                  value={pools[poolKey]}
                  onChange={(event) => setPoolDraft({ ...pools, [poolKey]: Number(event.target.value) })}
                />
              </label>
              <span className="parent-request-note">
                {fill(text.poolStatus, { claimed: claimedByPool[poolKey] || 0, blocked: reserveByPool[poolKey] || 0 })}
              </span>
            </div>
          ))}
        </div>
        <div className="u14-protected-settings-row">
          <label className="field">
            <span>{text.deadline}</span>
            <input type="date" value={deadline} onChange={(event) => setDeadlineDraft(event.target.value)} />
          </label>
          <span className="parent-request-note">
            {reserveReleased
              ? text.deadlinePassed
              : text.deadlineHint}
          </span>
          <button className="button button--primary" disabled={isBusy || (!poolDraft && deadlineDraft === null)} type="button" onClick={handleSaveSettings}>
            {text.save}
          </button>
        </div>
      </Panel>

      <Panel
        title={text.importTitle}
        subtitle={text.importSubtitle}
      >
        <textarea
          className="u14-paste"
          placeholder={"Weber\tEmma\tCAB\tparent@example.lu\t245\t2016\tF"}
          rows="5"
          value={pasteText}
          onChange={(event) => setPasteText(event.target.value)}
        />
        <div className="table-actions table-actions--inline">
          <button className="button button--secondary" disabled={!pasteText.trim()} type="button" onClick={handlePreview}>
            {text.check}
          </button>
        </div>
        {preview.length ? (
          <>
            <DataTable
              columns={[
                { key: "child", label: text.colChild },
                { key: "club", label: text.colClub },
                { key: "bib", label: text.colBib },
                { key: "pool", label: text.colPool },
                { key: "email", label: text.colEmail },
                { key: "check", label: text.colCheck },
              ]}
              rows={preview.map((row, index) => ({
                id: `preview-${index}`,
                child: `${row.firstName} ${row.lastName}`,
                club: row.club || "-",
                bib: row.bibNumber || "-",
                pool: getU14InvitePoolKey(row) ? `${row.birthYear} · ${text.poolLabels[getU14InvitePoolKey(row)]}` : "-",
                email: row.parentEmail || "-",
                check: row.errors.length ? (
                  <span className="status-pill status-pill--danger">{row.errors.map((code) => text.rowErrors[code] || code).join(", ")}</span>
                ) : (
                  <span className="status-pill status-pill--ok">OK</span>
                ),
              }))}
            />
            <div className="table-actions table-actions--inline">
              <button className="button button--primary" disabled={isBusy || !validPreview.length} type="button" onClick={handleCreateInvites}>
                {isBusy ? text.sending : fill(text.createButton, { count: validPreview.length })}
              </button>
              {preview.length !== validPreview.length ? (
                <span className="parent-request-note">{text.errorsSkipped}</span>
              ) : null}
            </div>
          </>
        ) : null}
      </Panel>

      <Panel title={fill(text.invitesTitle, { count: invites.length })} subtitle={text.invitesSubtitle}>
        <DataTable
          columns={[
            { key: "child", label: text.colChild },
            { key: "email", label: text.colEmail },
            { key: "status", label: text.colStatus },
            { key: "race", label: text.colRace },
            { key: "actions", label: text.colActions },
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
                        <span className="parent-request-note">
                          {invite.club || "-"} · {fill(copy.table.bib, { bib: invite.bibNumber || "-" })}
                          {getU14InvitePoolKey(invite) ? ` · ${invite.birthYear} · ${text.poolLabels[getU14InvitePoolKey(invite)]}` : ""}
                        </span>
                      </div>
                    ),
                    email: invite.parentEmail,
                    status: (
                      <div className="table-stack">
                        <span className={STATUS_PILLS[status] || "status-pill"}>{text.statuses[status] || status}</span>
                        {status === "invited" ? (
                          <span className="parent-request-note">
                            {fill(text.before, { date: formatDateForDisplay(invite.deadline) })}
                            {invite.reminderSentAt ? text.reminderSent : ""}
                          </span>
                        ) : null}
                        {claimedRequest && claimedRequest.status === "declined" ? (
                          <span className="status-pill status-pill--danger">{text.withdrewLater}</span>
                        ) : null}
                      </div>
                    ),
                    race: invite.claimedRaceCode ? raceLabel(getU14RaceLabel(invite.claimedRaceCode)) : "-",
                    actions:
                      status === "invited" ? (
                        <div className="table-actions table-actions--inline">
                          <button className="button button--secondary button--small" type="button" onClick={() => handleCopyLink(invite)}>
                            {text.copyLink}
                          </button>
                          <button className="button button--secondary button--small" disabled={isBusy} type="button" onClick={() => handleResend(invite)}>
                            {text.resend}
                          </button>
                          <button className="button button--ghost-danger button--small" disabled={isBusy} type="button" onClick={() => handleCancel(invite)}>
                            {text.cancel}
                          </button>
                        </div>
                      ) : (
                        "-"
                      ),
                  };
                })
              : [{ id: "empty", child: text.noInvites, email: "-", status: "-", race: "-", actions: "-" }]
          }
        />
      </Panel>
    </>
  );
}

export { U14ProtectedTab };
