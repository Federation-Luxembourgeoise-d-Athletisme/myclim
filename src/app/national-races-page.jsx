import { useMemo, useState } from "react";
import { doc, serverTimestamp, setDoc, updateDoc, writeBatch } from "firebase/firestore";
import { useAuth } from "../context/auth-context";
import { db } from "../services/firebase";
import {
  DEFAULT_NATIONAL_RACE_MAIL_TEMPLATES,
  NATIONAL_RACE_DEFINITIONS,
  NATIONAL_RACE_MAIL_TEMPLATES_DOC_PATH,
  NATIONAL_RACE_NOTIFIABLE_STATUSES,
  NATIONAL_RACE_REQUESTS_COLLECTION,
  buildNationalRaceDecisionMail,
  compareNationalRaceRequests,
  getBestTimeSummary,
  isNationalRaceMailPending,
} from "./national-races-helpers";
import { useNationalRaceMailTemplates, useNationalRaceRequests } from "./national-races-hooks";
import { useNationalRacesAdminCopy } from "./national-races-admin-copy";
import { formatDateForDisplay, formatDateTimeForDisplay, getTimestampMs } from "./u14-helpers";

// Module Courses nationales (commission des athlètes). Textes français /
// anglais : national-races-admin-copy.js.
const DECISIONS = [
  { status: "selected", className: "nat-seg__item--ok" },
  { status: "waitlist", className: "nat-seg__item--warn" },
  { status: "not_selected", className: "nat-seg__item--danger" },
];

const STATUS_PILL_CLASSES = {
  selected: "status-pill status-pill--ok",
  waitlist: "status-pill status-pill--warn",
  not_selected: "status-pill status-pill--danger",
  withdrawn: "status-pill status-pill--danger",
};

function getAthleteAge(birthDate) {
  if (!birthDate) return null;
  const birth = new Date(birthDate);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const monthDifference = today.getMonth() - birth.getMonth();
  if (monthDifference < 0 || (monthDifference === 0 && today.getDate() < birth.getDate())) age -= 1;
  return Number.isNaN(age) ? null : age;
}

function getAuthorName(userProfile, currentUser) {
  return [userProfile?.firstName, userProfile?.lastName].filter(Boolean).join(" ") || currentUser?.email || "";
}

function downloadCsv(filename, rows) {
  const escapeCell = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  // BOM UTF-8 pour qu'Excel ouvre les accents correctement.
  const content = String.fromCharCode(0xfeff) + rows.map((row) => row.map(escapeCell).join(";")).join("\r\n");
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function MailStatus({ request }) {
  const { copy, fill } = useNationalRacesAdminCopy();
  if (isNationalRaceMailPending(request)) {
    return <span className="status-pill status-pill--warn">{request.notifiedStatus ? copy.mailStatus.resend : copy.mailStatus.toSend}</span>;
  }
  if (request.notifiedAt && request.notifiedStatus === request.status) {
    return <span className="status-pill status-pill--ok">{fill(copy.mailStatus.sent, { date: formatDateForDisplay(request.notifiedAt) })}</span>;
  }
  return <span className="nat-muted">-</span>;
}

function TemplateEditor({ templates, onClose, onSave, isSaving }) {
  const { copy } = useNationalRacesAdminCopy();
  const text = copy.templates;
  const [draft, setDraft] = useState(templates);
  const [activeStatus, setActiveStatus] = useState("selected");
  const current = draft[activeStatus];

  function updateField(field, value) {
    setDraft((previous) => ({ ...previous, [activeStatus]: { ...previous[activeStatus], [field]: value } }));
  }

  return (
    <div className="nat-card">
      <div className="nat-card__head">
        <strong>{text.title}</strong>
        <span className="nat-muted">{text.variables}</span>
      </div>
      <div className="nat-chip-row">
        {NATIONAL_RACE_NOTIFIABLE_STATUSES.map((status) => (
          <button
            key={status}
            className={`nat-chip${activeStatus === status ? " nat-chip--active" : ""}`}
            type="button"
            onClick={() => setActiveStatus(status)}
          >
            {copy.statuses[status]}
          </button>
        ))}
      </div>
      <label className="field">
        <span>{text.subject}</span>
        <input value={current.subject} onChange={(event) => updateField("subject", event.target.value)} />
      </label>
      <div className="field-grid">
        <label className="field">
          <span>{text.bodyFr}</span>
          <textarea rows="9" value={current.bodyFr} onChange={(event) => updateField("bodyFr", event.target.value)} />
        </label>
        <label className="field">
          <span>{text.bodyEn}</span>
          <textarea rows="9" value={current.bodyEn} onChange={(event) => updateField("bodyEn", event.target.value)} />
        </label>
      </div>
      <div className="nat-actions">
        <button
          className="button button--secondary"
          type="button"
          onClick={() => setDraft((previous) => ({ ...previous, [activeStatus]: DEFAULT_NATIONAL_RACE_MAIL_TEMPLATES[activeStatus] }))}
        >
          {text.reset}
        </button>
        <span className="nat-spacer" />
        <button className="button button--secondary" type="button" onClick={onClose}>{text.cancel}</button>
        <button className="button button--primary" disabled={isSaving} type="button" onClick={() => onSave(draft)}>
          {isSaving ? text.saving : text.save}
        </button>
      </div>
    </div>
  );
}

function MailPanel({ pendingRequests, templates, onSend, onSendTest, onEditTemplates, isSending, lastSend }) {
  const { copy, fill, raceLabel } = useNationalRacesAdminCopy();
  const text = copy.mailPanel;
  const [checkedIds, setCheckedIds] = useState([]);
  const [previewId, setPreviewId] = useState("");
  const visibleChecked = checkedIds.filter((id) => pendingRequests.some((request) => request.id === id));
  const previewRequest = pendingRequests.find((request) => request.id === previewId) || null;
  const previewMail = previewRequest ? buildNationalRaceDecisionMail(previewRequest, templates) : null;

  function toggle(id) {
    setCheckedIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }

  async function sendChecked(ids) {
    const sent = await onSend(pendingRequests.filter((request) => ids.includes(request.id)));
    setCheckedIds((current) => current.filter((id) => !sent.includes(id)));
    if (sent.includes(previewId)) setPreviewId("");
  }

  return (
    <div className="nat-card">
      <div className="nat-card__head">
        <strong>{fill(text.title, { count: pendingRequests.length })}</strong>
        <span className="nat-muted">{text.hint}</span>
      </div>
      {pendingRequests.length ? (
        <div className="nat-table">
          {pendingRequests.map((request) => (
            <div key={request.id} className="nat-mail-row">
              <input
                aria-label={fill(copy.select, { name: `${request.firstName} ${request.lastName}` })}
                checked={visibleChecked.includes(request.id)}
                type="checkbox"
                onChange={() => toggle(request.id)}
              />
              <span>
                <strong>{request.firstName} {request.lastName}</strong>
                {request.isMinor && request.guardianEmail ? <span className="nat-muted">{text.parentCopy}</span> : null}
              </span>
              <span><span className={STATUS_PILL_CLASSES[request.status]}>{copy.statuses[request.status]}</span></span>
              <span className="nat-muted">{raceLabel(request.raceCode, request.event)}</span>
              <button
                className={`button button--secondary button--small${previewId === request.id ? " nat-button--active" : ""}`}
                type="button"
                onClick={() => setPreviewId(previewId === request.id ? "" : request.id)}
              >
                {text.preview}
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="nat-muted">{text.empty}</p>
      )}

      {previewMail ? (
        <div className="nat-preview">
          <div className="nat-muted">
            {fill(text.to, { to: previewMail.to })}
            {previewMail.cc ? fill(text.cc, { cc: previewMail.cc }) : ""}
          </div>
          <strong>{previewMail.subject}</strong>
          <pre>{previewMail.body}</pre>
          <div className="nat-actions">
            <span className="nat-muted">{text.messageHint}</span>
            <span className="nat-spacer" />
            <button className="button button--primary button--small" disabled={isSending} type="button" onClick={() => sendChecked([previewRequest.id])}>
              {fill(text.sendOnly, { name: previewRequest.firstName })}
            </button>
          </div>
        </div>
      ) : null}

      <div className="nat-actions">
        <span className="nat-muted">
          {lastSend
            ? `${fill(text.lastSend, { date: formatDateTimeForDisplay(lastSend.at) })}${lastSend.by ? fill(text.lastSendBy, { name: lastSend.by }) : ""}`
            : text.noSend}
        </span>
        <span className="nat-spacer" />
        <button className="button button--secondary" type="button" onClick={onEditTemplates}>{text.editTemplates}</button>
        <button
          className="button button--secondary"
          disabled={isSending || !pendingRequests.length}
          type="button"
          onClick={() => onSendTest(previewRequest || pendingRequests.find((request) => visibleChecked.includes(request.id)) || pendingRequests[0])}
        >
          {text.test}
        </button>
        <button
          className="button button--secondary"
          type="button"
          onClick={() => setCheckedIds(visibleChecked.length === pendingRequests.length ? [] : pendingRequests.map((request) => request.id))}
        >
          {visibleChecked.length === pendingRequests.length && pendingRequests.length ? text.uncheckAll : text.checkAll}
        </button>
        <button
          className="button button--primary"
          disabled={isSending || !visibleChecked.length}
          type="button"
          onClick={() => sendChecked(visibleChecked)}
        >
          {isSending ? text.sending : visibleChecked.length === 1 ? text.sendOne : fill(text.sendMany, { count: visibleChecked.length })}
        </button>
      </div>
    </div>
  );
}

function NationalRacesPage(props) {
  const { loadMailQueueModule } = props;
  const { copy, fill, raceLabel } = useNationalRacesAdminCopy();
  const text = copy.messages;
  const { currentUser, userProfile } = useAuth();
  const { requests, loading, error } = useNationalRaceRequests();
  const { templates, error: templatesError } = useNationalRaceMailTemplates();
  const [selectedRaceCode, setSelectedRaceCode] = useState(NATIONAL_RACE_DEFINITIONS[0].code);
  const [checkedIds, setCheckedIds] = useState([]);
  const [messageDrafts, setMessageDrafts] = useState({});
  const [isBusy, setIsBusy] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isEditingTemplates, setIsEditingTemplates] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const authorName = getAuthorName(userProfile, currentUser);

  const raceSummaries = useMemo(
    () =>
      NATIONAL_RACE_DEFINITIONS.map((race) => {
        const raceRequests = requests.filter((request) => request.raceCode === race.code);
        return {
          ...race,
          total: raceRequests.filter((request) => request.status !== "withdrawn").length,
          selected: raceRequests.filter((request) => request.status === "selected").length,
        };
      }),
    [requests],
  );
  const metrics = useMemo(
    () => ({
      total: requests.filter((request) => request.status !== "withdrawn").length,
      selected: requests.filter((request) => request.status === "selected").length,
      places: NATIONAL_RACE_DEFINITIONS.reduce((sum, race) => sum + race.quota, 0),
      undecided: requests.filter((request) => (request.status || "submitted") === "submitted").length,
      pending: requests.filter(isNationalRaceMailPending).length,
    }),
    [requests],
  );
  const selectedRace = raceSummaries.find((race) => race.code === selectedRaceCode) || raceSummaries[0];
  const selectedRaceLabel = raceLabel(selectedRace.code, selectedRace.label);
  const raceRequests = useMemo(
    () => requests.filter((request) => request.raceCode === selectedRace.code).sort(compareNationalRaceRequests),
    [requests, selectedRace.code],
  );
  const pendingRequests = useMemo(
    () => requests.filter(isNationalRaceMailPending).sort(compareNationalRaceRequests),
    [requests],
  );
  const lastSend = useMemo(() => {
    const latest = requests.reduce(
      (best, request) => (getTimestampMs(request.notifiedAt) > getTimestampMs(best?.notifiedAt) ? request : best),
      null,
    );
    return latest?.notifiedAt ? { at: latest.notifiedAt, by: latest.notifiedBy } : null;
  }, [requests]);
  const checkedInRace = checkedIds.filter((id) => raceRequests.some((request) => request.id === id));

  function flash(message) {
    setStatusMessage(message);
    setErrorMessage("");
  }

  async function setStatuses(targetRequests, status) {
    if (!targetRequests.length) return;
    setIsBusy(true);
    try {
      const batch = writeBatch(db);
      targetRequests.forEach((request) => {
        batch.update(doc(db, NATIONAL_RACE_REQUESTS_COLLECTION, request.id), {
          status,
          decidedBy: authorName,
          decidedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      });
      await batch.commit();
      setCheckedIds([]);
      flash(
        targetRequests.length === 1
          ? fill(text.decidedOne, { name: `${targetRequests[0].firstName} ${targetRequests[0].lastName}`, status: copy.statuses[status] })
          : fill(text.decidedMany, { count: targetRequests.length, status: copy.statuses[status] }),
      );
    } catch {
      setErrorMessage(text.decisionFailed);
    } finally {
      setIsBusy(false);
    }
  }

  function handleSelectTop() {
    const candidates = raceRequests.filter((request) => request.status !== "withdrawn").slice(0, selectedRace.quota);
    const toUpdate = candidates.filter((request) => request.status !== "selected");
    if (!toUpdate.length) {
      flash(fill(text.topAlready, { count: candidates.length, race: selectedRaceLabel }));
      return;
    }
    if (!window.confirm(fill(text.topConfirm, { count: candidates.length, race: selectedRaceLabel, changes: toUpdate.length }))) return;
    setStatuses(toUpdate, "selected");
  }

  async function updateRequest(request, changes, successMessage) {
    try {
      await updateDoc(doc(db, NATIONAL_RACE_REQUESTS_COLLECTION, request.id), { ...changes, updatedAt: serverTimestamp() });
      if (successMessage) flash(successMessage);
    } catch {
      setErrorMessage(text.updateFailed);
    }
  }

  async function handleSend(targetRequests) {
    if (!targetRequests.length) return [];
    const question =
      targetRequests.length === 1
        ? fill(text.sendConfirmOne, { name: `${targetRequests[0].firstName} ${targetRequests[0].lastName}` })
        : fill(text.sendConfirmMany, { count: targetRequests.length });
    if (!window.confirm(question)) return [];

    setIsSending(true);
    setStatusMessage("");
    setErrorMessage("");
    const sentIds = [];
    const failed = [];
    try {
      const { enqueueTransactionalMail } = await loadMailQueueModule();
      for (const request of targetRequests) {
        try {
          await enqueueTransactionalMail(buildNationalRaceDecisionMail(request, templates));
          await updateDoc(doc(db, NATIONAL_RACE_REQUESTS_COLLECTION, request.id), {
            notifiedStatus: request.status,
            notifiedAt: serverTimestamp(),
            notifiedBy: authorName,
            updatedAt: serverTimestamp(),
          });
          sentIds.push(request.id);
        } catch (sendError) {
          console.error("National race decision email failed", sendError);
          failed.push(`${request.firstName} ${request.lastName}`);
        }
      }
    } finally {
      setIsSending(false);
    }

    if (failed.length) setErrorMessage(fill(text.sendFailed, { names: failed.join(", ") }));
    if (sentIds.length) setStatusMessage(sentIds.length === 1 ? text.sentOne : fill(text.sentMany, { count: sentIds.length }));
    return sentIds;
  }

  async function handleSendTest(request) {
    if (!request || !currentUser?.email) return;
    setIsSending(true);
    try {
      const { enqueueTransactionalMail } = await loadMailQueueModule();
      const mail = buildNationalRaceDecisionMail(request, templates);
      await enqueueTransactionalMail({ ...mail, to: currentUser.email, cc: undefined, subject: `[TEST] ${mail.subject}` });
      flash(fill(text.testSent, { email: currentUser.email, status: copy.statuses[request.status], name: request.firstName }));
    } catch {
      setErrorMessage(text.testFailed);
    } finally {
      setIsSending(false);
    }
  }

  async function handleSaveTemplates(draft) {
    setIsBusy(true);
    try {
      await setDoc(doc(db, ...NATIONAL_RACE_MAIL_TEMPLATES_DOC_PATH), { ...draft, updatedAt: serverTimestamp(), updatedBy: authorName });
      setIsEditingTemplates(false);
      flash(text.templatesSaved);
    } catch {
      setErrorMessage(text.templatesFailed);
    } finally {
      setIsBusy(false);
    }
  }

  function handleExport() {
    const selected = requests.filter((request) => request.status === "selected").sort((left, right) => {
      const raceOrder = NATIONAL_RACE_DEFINITIONS.findIndex((race) => race.code === left.raceCode) -
        NATIONAL_RACE_DEFINITIONS.findIndex((race) => race.code === right.raceCode);
      return raceOrder || compareNationalRaceRequests(left, right);
    });
    if (!selected.length) {
      flash(text.nothingToExport);
      return;
    }
    const { csv } = copy;
    downloadCsv(`${csv.file}-${new Date().toISOString().slice(0, 10)}.csv`, [
      csv.headers,
      ...selected.map((request) => [
        raceLabel(request.raceCode, request.event),
        request.lastName,
        request.firstName,
        request.gender === "femme" ? "F" : "M",
        request.birthDate,
        request.isLuxLicensed ? csv.yes : csv.no,
        request.isLuxLicensed ? request.club : request.foreignClub,
        request.bibNumber,
        request.isLuxLicensed ? "LUX" : request.foreignCountry,
        request.foreignLicenceNumber,
        request.personalBest,
        request.seasonBest,
        request.otherTime,
        request.email,
        request.phone,
        request.seltecEntered ? csv.yes : csv.no,
      ]),
    ]);
  }

  return (
    <div className="page">
      <section className="page-header">
        <div>
          <p className="eyebrow">{copy.eyebrow}</p>
          <h1>{copy.title}</h1>
          <p>{copy.intro}</p>
        </div>
        <div className="nat-actions">
          <button className="button button--secondary" type="button" onClick={handleExport}>{copy.export}</button>
        </div>
      </section>

      {error || templatesError ? <p className="status-note">{error || templatesError}</p> : null}
      {statusMessage ? <p className="panel-note panel-note--success">{statusMessage}</p> : null}
      {errorMessage ? <p className="form-error">{errorMessage}</p> : null}

      <section className="metric-grid">
        <article className="metric-card"><span>{copy.metrics.total}</span><strong>{metrics.total}</strong></article>
        <article className="metric-card metric-card--accent"><span>{copy.metrics.selected}</span><strong>{metrics.selected} / {metrics.places}</strong></article>
        <article className="metric-card"><span>{copy.metrics.undecided}</span><strong>{metrics.undecided}</strong></article>
        <article className="metric-card metric-card--warn"><span>{copy.metrics.pending}</span><strong>{metrics.pending}</strong></article>
      </section>

      <div className="nat-chip-row">
        {raceSummaries.map((race) => (
          <button
            key={race.code}
            className={`nat-chip${selectedRace.code === race.code ? " nat-chip--active" : ""}${race.selected > race.quota ? " nat-chip--over" : ""}`}
            type="button"
            onClick={() => {
              setSelectedRaceCode(race.code);
              setCheckedIds([]);
            }}
          >
            {raceLabel(race.code, race.label)} · {race.selected}/{race.quota}
            <span className="nat-muted"> ({race.total})</span>
          </button>
        ))}
      </div>

      {selectedRace.selected > selectedRace.quota ? (
        <div className="notice-card notice-card--warn">
          <strong>{copy.quotaTitle}</strong>
          <p>{fill(copy.quotaBody, { count: selectedRace.selected, quota: selectedRace.quota, race: selectedRaceLabel })}</p>
        </div>
      ) : null}

      <div className="nat-card nat-card--flush">
        <div className="nat-bulk">
          <span className="nat-muted">{checkedInRace.length ? fill(copy.bulkSelected, { count: checkedInRace.length }) : copy.bulkHint}</span>
          {DECISIONS.map((decision) => (
            <button
              key={decision.status}
              className="button button--secondary button--small"
              disabled={isBusy || !checkedInRace.length}
              type="button"
              onClick={() => setStatuses(raceRequests.filter((request) => checkedInRace.includes(request.id)), decision.status)}
            >
              {copy.statuses[decision.status]}
            </button>
          ))}
          <span className="nat-spacer" />
          <button className="button button--secondary button--small" disabled={isBusy || !raceRequests.length} type="button" onClick={handleSelectTop}>
            {fill(copy.selectTop, { count: selectedRace.quota })}
          </button>
        </div>
        <div className="nat-row nat-row--head">
          <span />
          <span>{copy.columns.position}</span>
          <span>{copy.columns.athlete}</span>
          <span>{copy.columns.best}</span>
          <span>{copy.columns.decision}</span>
          <span>{copy.columns.mail}</span>
          <span>{copy.columns.message}</span>
        </div>
        {loading ? <p className="nat-muted nat-pad">{copy.loading}</p> : null}
        {!loading && !raceRequests.length ? <p className="nat-muted nat-pad">{copy.emptyRace}</p> : null}
        {raceRequests.map((request, index) => {
          const age = getAthleteAge(request.birthDate);
          const best = getBestTimeSummary(request);
          const isWithdrawn = request.status === "withdrawn";
          const messageDraft = messageDrafts[request.id] ?? request.athleteMessage ?? "";
          return (
            <div key={request.id} className={`nat-row${isWithdrawn ? " nat-row--withdrawn" : ""}`}>
              <input
                aria-label={fill(copy.select, { name: `${request.firstName} ${request.lastName}` })}
                checked={checkedInRace.includes(request.id)}
                disabled={isWithdrawn}
                type="checkbox"
                onChange={() =>
                  setCheckedIds((current) => (current.includes(request.id) ? current.filter((id) => id !== request.id) : [...current, request.id]))
                }
              />
              <span>{index + 1}</span>
              <span className="table-stack">
                <strong>{request.firstName} {request.lastName}</strong>
                <span className="nat-muted">
                  {request.birthYear || "-"}
                  {age !== null ? ` · ${fill(copy.age, { age })}` : ""} ·{" "}
                  {request.isLuxLicensed
                    ? `${request.club} · ${fill(copy.bib, { bib: request.bibNumber || "-" })}`
                    : `${request.foreignClub} · ${request.foreignCountry}`}
                </span>
                <span className="nat-badges">
                  {request.isLuxLicensed ? null : <span className="status-pill status-pill--warn">{copy.foreign}</span>}
                  {request.isMinor ? (
                    <span
                      className={request.guardianConsent ? "status-pill status-pill--accent" : "status-pill status-pill--danger"}
                      title={`${request.guardianFirstName} ${request.guardianLastName} · ${request.guardianEmail}`}
                    >
                      {copy.minor}
                    </span>
                  ) : null}
                  {isWithdrawn ? <span className="status-pill status-pill--danger">{copy.withdrawn}</span> : null}
                </span>
              </span>
              <span className="table-stack">
                {best ? (
                  <>
                    <strong>{best.time} <span className="nat-muted">{copy.timeLabels[best.label] || best.label}</span></strong>
                    <span className="nat-muted">{[best.place, best.date ? formatDateForDisplay(best.date) : ""].filter(Boolean).join(" · ")}</span>
                  </>
                ) : (
                  <span className="nat-muted">{copy.noTime}</span>
                )}
                <details className="nat-details">
                  <summary>{copy.detail}</summary>
                  {[
                    { label: "PB", prefix: "personalBest" },
                    { label: "SB 2026", prefix: "seasonBest" },
                    { label: "Autre", prefix: "otherTime" },
                  ]
                    .filter((row) => request[row.prefix])
                    .map((row) => (
                      <span key={row.prefix}>
                        {copy.timeLabels[row.label]} {request[row.prefix]}
                        {request[`${row.prefix}Place`] ? ` · ${request[`${row.prefix}Place`]}` : ""}
                        {request[`${row.prefix}Date`] ? ` · ${formatDateForDisplay(request[`${row.prefix}Date`])}` : ""}
                      </span>
                    ))}
                  {request.notes ? <span>{fill(copy.note, { note: request.notes })}</span> : null}
                  <span>{request.email} · {request.phone}</span>
                  <span>{fill(copy.receivedOn, { date: formatDateTimeForDisplay(request.submittedAt) })}</span>
                  {request.status === "selected" ? (
                    <label className="nat-inline-check">
                      <input
                        checked={Boolean(request.seltecEntered)}
                        type="checkbox"
                        onChange={(event) =>
                          updateRequest(request, { seltecEntered: event.target.checked }, event.target.checked ? copy.seltecOn : copy.seltecOff)
                        }
                      />
                      {copy.seltec}
                    </label>
                  ) : null}
                </details>
              </span>
              <span>
                {isWithdrawn ? (
                  <span className="nat-muted">-</span>
                ) : (
                  <span className="nat-seg" role="group" aria-label={copy.decisionGroup}>
                    {DECISIONS.map((decision) => (
                      <button
                        key={decision.status}
                        aria-pressed={request.status === decision.status}
                        className={`nat-seg__item${request.status === decision.status ? ` ${decision.className}` : ""}`}
                        disabled={isBusy}
                        type="button"
                        onClick={() => setStatuses([request], request.status === decision.status ? "submitted" : decision.status)}
                      >
                        {copy.decisions[decision.status]}
                      </button>
                    ))}
                  </span>
                )}
              </span>
              <span><MailStatus request={request} /></span>
              <span>
                <input
                  aria-label={copy.messageLabel}
                  className="nat-message-input"
                  placeholder={copy.messagePlaceholder}
                  value={messageDraft}
                  onBlur={() => {
                    if (messageDraft.trim() === (request.athleteMessage || "")) return;
                    updateRequest(request, { athleteMessage: messageDraft.trim() }, copy.messageSaved);
                  }}
                  onChange={(event) => setMessageDrafts((current) => ({ ...current, [request.id]: event.target.value }))}
                />
              </span>
            </div>
          );
        })}
      </div>

      {isEditingTemplates ? (
        <TemplateEditor
          isSaving={isBusy}
          templates={templates}
          onClose={() => setIsEditingTemplates(false)}
          onSave={handleSaveTemplates}
        />
      ) : (
        <MailPanel
          isSending={isSending}
          lastSend={lastSend}
          pendingRequests={pendingRequests}
          templates={templates}
          onEditTemplates={() => setIsEditingTemplates(true)}
          onSend={handleSend}
          onSendTest={handleSendTest}
        />
      )}
    </div>
  );
}

export { NationalRacesPage };
