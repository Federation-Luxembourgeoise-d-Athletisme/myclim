import { Fragment, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { addDoc, collection, doc, serverTimestamp, setDoc, updateDoc, writeBatch } from "firebase/firestore";
import { useAuth } from "../context/auth-context";
import { db } from "../services/firebase";
import {
  DEFAULT_NATIONAL_RACE_MAIL_TEMPLATES,
  NATIONAL_RACE_DEFINITIONS,
  NATIONAL_RACE_MAIL_TEMPLATES_DOC_PATH,
  NATIONAL_RACE_NOTIFIABLE_STATUSES,
  NATIONAL_RACE_PACER_ROLE,
  NATIONAL_RACE_REQUESTS_COLLECTION,
  buildNationalRaceDecisionMail,
  compareNationalRaceRequests,
  getBestTimeSummary,
  getNationalRaceAthleteQuota,
  getNationalRaceSelectionDate,
  getProposedNationalRaceSelection,
  isNationalRaceMailPending,
  isNationalRacePacer,
  parsePerformanceToSeconds,
} from "./national-races-helpers";
import { useNationalRaceMailTemplates, useNationalRaceRequests } from "./national-races-hooks";
import { useNationalRacesAdminCopy } from "./national-races-admin-copy";
import { useActiveEdition } from "./edition";
import { useLanguage } from "./language-context";
import { useMeetingEditions } from "./meeting-history-hooks";
import { formatDateForDisplay, formatDateTimeForDisplay, getTimestampMs, luxCompetitionClubs } from "./u14-helpers";

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

function requestToForm(request) {
  return {
    ...Object.fromEntries(Object.keys(EMPTY_ADD_FORM).map((key) => [key, request[key] ?? EMPTY_ADD_FORM[key]])),
    isLuxLicensed: request.isLuxLicensed ? "oui" : "non",
    isPacer: isNationalRacePacer(request),
  };
}

// Champs écrits dans la demande à partir du formulaire commission.
function formToRequestFields(form) {
  const isLux = form.isLuxLicensed === "oui";
  return {
    firstName: form.firstName.trim(),
    lastName: form.lastName.trim(),
    email: form.email.trim(),
    phone: form.phone.trim(),
    // Date de naissance obligatoire : SELTEC en a besoin pour l'engagement.
    birthDate: form.birthDate,
    birthYear: form.birthDate ? new Date(form.birthDate).getFullYear() : null,
    nationality: form.nationality.trim(),
    worldAthleticsUrl: form.worldAthleticsUrl.trim(),
    previousSeasonBest: form.previousSeasonBest.trim(),
    previousSeasonBestDate: form.previousSeasonBestDate,
    isLuxLicensed: isLux,
    club: isLux ? form.club : "",
    bibNumber: isLux ? form.bibNumber.trim() : "",
    foreignCountry: isLux ? "" : form.foreignCountry.trim(),
    foreignClub: isLux ? "" : form.foreignClub.trim(),
    seasonBest: form.seasonBest.trim(),
    seasonBestPlace: form.seasonBestPlace.trim(),
    seasonBestDate: form.seasonBestDate,
    notes: form.notes.trim(),
    role: form.isPacer ? NATIONAL_RACE_PACER_ROLE : "athlete",
  };
}

const EMPTY_ADD_FORM = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  birthDate: "",
  nationality: "",
  worldAthleticsUrl: "",
  previousSeasonBest: "",
  previousSeasonBestDate: "",
  isLuxLicensed: "oui",
  club: "",
  bibNumber: "",
  foreignCountry: "",
  foreignClub: "",
  seasonBest: "",
  seasonBestPlace: "",
  seasonBestDate: "",
  notes: "",
  isPacer: false,
};

// Ajout direct par la commission : athlètes invités au 60 m (pas de
// formulaire public) et lièvre éventuel au 800 m. Pas de compte MyCLIM créé :
// l'athlète est prévenu par le mail de décision habituel.
// Le même formulaire sert à corriger la fiche d'un athlète (initial fourni).
function AddAthleteForm({ race, raceLabel, initial = null, onCancel, onSubmit, isSaving }) {
  const { copy } = useNationalRacesAdminCopy();
  const text = copy.add;
  const [form, setForm] = useState(() => (initial ? { ...EMPTY_ADD_FORM, ...requestToForm(initial) } : EMPTY_ADD_FORM));
  const [error, setError] = useState("");
  const isLux = form.isLuxLicensed === "oui";

  function update(event) {
    const { name, type, checked, value } = event.target;
    setForm((current) => ({ ...current, [name]: type === "checkbox" ? checked : value }));
  }

  function handleSubmit(event) {
    event.preventDefault();
    if ([form.seasonBest, form.previousSeasonBest].some((value) => value && parsePerformanceToSeconds(value) === null)) {
      setError(text.timeFormat);
      return;
    }
    setError("");
    onSubmit(form);
  }

  return (
    <form className="nat-card" onSubmit={handleSubmit}>
      <div className="nat-card__head">
        <strong>
          {initial
            ? text.editTitle.replace("{name}", `${initial.firstName} ${initial.lastName}`)
            : (race.invitationOnly ? text.inviteTitle : text.addTitle).replace("{race}", raceLabel)}
        </strong>
        <span className="nat-muted">{initial ? text.editHint : text.hint}</span>
      </div>
      {race.allowsPacer ? (
        <label className="nat-inline-check">
          <input checked={form.isPacer} name="isPacer" type="checkbox" onChange={update} />
          {text.pacer}
        </label>
      ) : null}
      <div className="field-grid">
        <label className="field"><span>{text.firstName}</span><input name="firstName" required value={form.firstName} onChange={update} /></label>
        <label className="field"><span>{text.lastName}</span><input name="lastName" required value={form.lastName} onChange={update} /></label>
      </div>
      <div className="field-grid">
        <label className="field"><span>{text.email}</span><input name="email" required type="email" value={form.email} onChange={update} /></label>
        <label className="field"><span>{text.phone}</span><input name="phone" value={form.phone} onChange={update} /></label>
      </div>
      <div className="field-grid">
        <label className="field"><span>{text.birthDate}</span><input name="birthDate" required type="date" value={form.birthDate} onChange={update} /></label>
        <label className="field"><span>{text.nationality}</span><input name="nationality" required value={form.nationality} onChange={update} /></label>
      </div>
      <label className="field">
        <span>{text.worldAthletics}</span>
        <input name="worldAthleticsUrl" placeholder="https://worldathletics.org/athletes/..." required type="url" value={form.worldAthleticsUrl} onChange={update} />
      </label>
      <div className="field-grid">
        <label className="field">
          <span>{text.licence}</span>
          <select name="isLuxLicensed" value={form.isLuxLicensed} onChange={update}>
            <option value="oui">{text.licenceLux}</option>
            <option value="non">{text.licenceForeign}</option>
          </select>
        </label>
        {isLux ? (
          <label className="field">
            <span>{text.club}</span>
            <select name="club" value={form.club} onChange={update}>
              <option value="">-</option>
              {luxCompetitionClubs.map((club) => <option key={club} value={club}>{club}</option>)}
            </select>
          </label>
        ) : (
          <label className="field"><span>{text.country}</span><input name="foreignCountry" value={form.foreignCountry} onChange={update} /></label>
        )}
      </div>
      <div className="field-grid">
        {isLux ? (
          <label className="field"><span>{text.bib}</span><input name="bibNumber" value={form.bibNumber} onChange={update} /></label>
        ) : (
          <label className="field"><span>{text.foreignClub}</span><input name="foreignClub" value={form.foreignClub} onChange={update} /></label>
        )}
        <label className="field">
          <span>{text.seasonBest}</span>
          <input inputMode="decimal" name="seasonBest" placeholder={race.event === "800 m" ? "2:05.30" : "7.45"} value={form.seasonBest} onChange={update} />
        </label>
      </div>
      <div className="field-grid">
        <label className="field"><span>{text.place}</span><input name="seasonBestPlace" value={form.seasonBestPlace} onChange={update} /></label>
        <label className="field"><span>{text.date}</span><input name="seasonBestDate" type="date" value={form.seasonBestDate} onChange={update} /></label>
      </div>
      <div className="field-grid">
        <label className="field">
          <span>{text.previousSeasonBest}</span>
          <input inputMode="decimal" name="previousSeasonBest" placeholder={race.event === "800 m" ? "2:05.30" : "7.45"} value={form.previousSeasonBest} onChange={update} />
        </label>
        <label className="field"><span>{text.previousDate}</span><input name="previousSeasonBestDate" type="date" value={form.previousSeasonBestDate} onChange={update} /></label>
      </div>
      <label className="field"><span>{text.notes}</span><input name="notes" value={form.notes} onChange={update} /></label>
      {error ? <p className="form-error">{error}</p> : null}
      <div className="nat-actions">
        <span className="nat-spacer" />
        <button className="button button--secondary" type="button" onClick={onCancel}>{text.cancel}</button>
        <button className="button button--primary" disabled={isSaving} type="submit">{isSaving ? text.saving : text.save}</button>
      </div>
    </form>
  );
}

// Aperçu du mail tel qu'il partira (ou est parti) pour la décision actuelle.
function MailPreviewCard({ request, templates, onClose }) {
  const { copy, fill } = useNationalRacesAdminCopy();
  const mail = buildNationalRaceDecisionMail(request, templates);
  return (
    <div className="nat-card">
      <div className="nat-card__head">
        <strong>{fill(copy.previewTitle, { name: `${request.firstName} ${request.lastName}`, status: copy.statuses[request.status] })}</strong>
        <button className="button button--secondary button--small" type="button" onClick={onClose}>{copy.templates.cancel}</button>
      </div>
      <div className="nat-preview">
        <div className="nat-muted">
          {fill(copy.mailPanel.to, { to: mail.to })}
          {mail.cc ? fill(copy.mailPanel.cc, { cc: mail.cc }) : ""}
        </div>
        <strong>{mail.subject}</strong>
        <pre>{mail.body}</pre>
      </div>
    </div>
  );
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
  // "" (fermé), "new" (ajout) ou l'id de la demande en cours de modification.
  const [athleteFormTarget, setAthleteFormTarget] = useState("");
  const [mailPreviewId, setMailPreviewId] = useState("");
  const [isMailDrawerOpen, setIsMailDrawerOpen] = useState(false);
  const [expandedId, setExpandedId] = useState("");
  const { activeEditionId } = useActiveEdition();
  const { language } = useLanguage();
  const { editions } = useMeetingEditions();
  const activeEdition = editions.find((edition) => String(edition.year || edition.id) === String(activeEditionId)) || null;
  const selectionDate = getNationalRaceSelectionDate(activeEdition?.date);
  const selectionDateLabel = selectionDate
    ? selectionDate.toLocaleDateString(language === "fr" ? "fr-LU" : "en-GB", { day: "numeric", month: "short", year: "numeric" })
    : "-";
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const authorName = getAuthorName(userProfile, currentUser);

  const raceSummaries = useMemo(
    () =>
      NATIONAL_RACE_DEFINITIONS.map((race) => {
        const raceRequests = requests.filter((request) => request.raceCode === race.code);
        const athletes = raceRequests.filter((request) => !isNationalRacePacer(request));
        return {
          ...race,
          athleteQuota: getNationalRaceAthleteQuota(race, raceRequests),
          hasPacer: raceRequests.some((request) => isNationalRacePacer(request) && request.status === "selected"),
          total: athletes.filter((request) => request.status !== "withdrawn").length,
          selected: athletes.filter((request) => request.status === "selected").length,
        };
      }),
    [requests],
  );
  const metrics = useMemo(
    () => ({
      total: requests.filter((request) => request.status !== "withdrawn" && !isNationalRacePacer(request)).length,
      selected: requests.filter((request) => request.status === "selected" && !isNationalRacePacer(request)).length,
      places: raceSummaries.reduce((sum, race) => sum + race.athleteQuota, 0),
      undecided: requests.filter((request) => (request.status || "submitted") === "submitted").length,
      pending: requests.filter(isNationalRaceMailPending).length,
    }),
    [requests, raceSummaries],
  );
  const selectedRace = raceSummaries.find((race) => race.code === selectedRaceCode) || raceSummaries[0];
  const selectedRaceLabel = raceLabel(selectedRace.code, selectedRace.label);
  const raceRequests = useMemo(
    // Lièvres en tête de liste, puis le classement au SB.
    () =>
      requests
        .filter((request) => request.raceCode === selectedRace.code)
        .sort((left, right) => Number(isNationalRacePacer(right)) - Number(isNationalRacePacer(left)) || compareNationalRaceRequests(left, right)),
    [requests, selectedRace.code],
  );
  const proposal = useMemo(() => getProposedNationalRaceSelection(selectedRace, raceRequests), [selectedRace, raceRequests]);
  const editedRequest = athleteFormTarget && athleteFormTarget !== "new" ? requests.find((request) => request.id === athleteFormTarget) : null;
  const mailPreviewRequest = requests.find((request) => request.id === mailPreviewId) || null;
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

  // Retient la sélection proposée (places Lux réservées puis meilleurs SB).
  function handleSelectTop() {
    const candidates = proposal.selection;
    const toUpdate = candidates.filter((request) => request.status !== "selected");
    if (!toUpdate.length) {
      flash(fill(text.topAlready, { count: candidates.length, race: selectedRaceLabel }));
      return;
    }
    if (!window.confirm(fill(text.topConfirm, { count: candidates.length, race: selectedRaceLabel, changes: toUpdate.length }))) return;
    setStatuses(toUpdate, "selected");
  }

  async function handleSaveAthlete(form) {
    setIsBusy(true);
    try {
      const fields = formToRequestFields(form);
      if (editedRequest) {
        await updateDoc(doc(db, NATIONAL_RACE_REQUESTS_COLLECTION, editedRequest.id), {
          ...fields,
          editedBy: authorName,
          updatedAt: serverTimestamp(),
        });
        flash(fill(copy.add.updated, { name: `${fields.firstName} ${fields.lastName}` }));
      } else {
        await addDoc(collection(db, NATIONAL_RACE_REQUESTS_COLLECTION), {
          ...fields,
          editionId: activeEditionId,
          athleteUserId: "",
          event: selectedRace.event,
          gender: selectedRace.gender,
          raceCode: selectedRace.code,
          source: "commission",
          addedBy: authorName,
          isMinor: (getAthleteAge(fields.birthDate) ?? 18) < 18,
          status: "submitted",
          seltecEntered: false,
          submittedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        flash(fill(copy.add.added, { name: `${fields.firstName} ${fields.lastName}`, race: selectedRaceLabel }));
      }
      setAthleteFormTarget("");
    } catch {
      setErrorMessage(text.updateFailed);
    } finally {
      setIsBusy(false);
    }
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
        isNationalRacePacer(request) ? csv.pacer : csv.athlete,
        request.lastName,
        request.firstName,
        request.gender === "femme" ? "F" : "M",
        request.birthDate,
        request.nationality,
        request.isLuxLicensed ? csv.yes : csv.no,
        request.isLuxLicensed ? request.club : request.foreignClub,
        request.bibNumber,
        request.isLuxLicensed ? "LUX" : request.foreignCountry,
        request.foreignLicenceNumber,
        request.personalBest,
        request.seasonBest,
        request.previousSeasonBest,
        request.otherTime,
        request.worldAthleticsUrl,
        request.pacerPayment === "oui" ? csv.yes : request.pacerPayment === "non" ? csv.no : "",
        request.email,
        request.phone,
        request.seltecEntered ? csv.yes : csv.no,
      ]),
    ]);
  }

  const ui = copy.ui;
  const luxInProposal = proposal.reservedIds.size;
  const proposedIds = new Set(proposal.selection.map((request) => request.id));
  const drawerOpen = Boolean(athleteFormTarget || mailPreviewRequest || isEditingTemplates || isMailDrawerOpen);

  function closeDrawer() {
    setAthleteFormTarget("");
    setMailPreviewId("");
    setIsEditingTemplates(false);
    setIsMailDrawerOpen(false);
  }

  function openDrawer(setter) {
    closeDrawer();
    setter();
  }

  return (
    <div className="page natx">
      <header className="natx-head">
        <div>
          <p className="natx-eyebrow">{fill(ui.eyebrow, { edition: activeEditionId })}</p>
          <h1>{copy.title}</h1>
          <p className="natx-lead">{ui.lead}</p>
        </div>
        <div className="natx-head__actions">
          <button className="natx-btn" type="button" onClick={() => openDrawer(() => setIsMailDrawerOpen(true))}>
            {ui.mailsButton}
            {metrics.pending ? <span className="natx-count natx-count--warn">{metrics.pending}</span> : null}
          </button>
          <button className="natx-btn" type="button" onClick={() => openDrawer(() => setIsEditingTemplates(true))}>{ui.templatesButton}</button>
          <button className="natx-btn" type="button" onClick={handleExport}>{copy.export}</button>
        </div>
      </header>

      {error || templatesError ? <p className="natx-alert natx-alert--danger">{error || templatesError}</p> : null}
      {statusMessage ? <p className="natx-alert natx-alert--ok">{statusMessage}</p> : null}
      {errorMessage ? <p className="natx-alert natx-alert--danger">{errorMessage}</p> : null}

      <div className="natx-kpis">
        <div><span>{copy.metrics.total}</span><strong>{metrics.total}</strong></div>
        <div><span>{copy.metrics.selected}</span><strong>{metrics.selected}<small> / {metrics.places}</small></strong></div>
        <div><span>{copy.metrics.undecided}</span><strong>{metrics.undecided}</strong></div>
        <div className={metrics.pending ? "natx-kpi--warn" : ""}><span>{copy.metrics.pending}</span><strong>{metrics.pending}</strong></div>
        <div><span>{ui.selectionDate}</span><strong className="natx-kpi__text">{selectionDateLabel}</strong></div>
      </div>

      <nav className="natx-tabs" aria-label={ui.racesLabel}>
        {raceSummaries.map((race) => {
          const ratio = race.athleteQuota ? Math.min(1, race.selected / race.athleteQuota) : 0;
          const pending = requests.filter((request) => request.raceCode === race.code && isNationalRaceMailPending(request)).length;
          return (
            <button
              key={race.code}
              aria-pressed={selectedRace.code === race.code}
              className={`natx-tab${selectedRace.code === race.code ? " natx-tab--active" : ""}${race.selected > race.athleteQuota ? " natx-tab--over" : ""}`}
              type="button"
              onClick={() => {
                setSelectedRaceCode(race.code);
                setCheckedIds([]);
                setExpandedId("");
                closeDrawer();
              }}
            >
              <span className="natx-tab__top">
                <strong>{raceLabel(race.code, race.label)}</strong>
                <span className="natx-tab__mode">{race.invitationOnly ? ui.modeInvitation : ui.modeOpen}</span>
              </span>
              <span className="natx-meter"><span style={{ width: `${ratio * 100}%` }} /></span>
              <span className="natx-tab__meta">
                <span>{fill(ui.tabSelected, { selected: race.selected, quota: race.athleteQuota })}{race.hasPacer ? ` + ${copy.pacerShort}` : ""}</span>
                <span>{fill(ui.tabRequests, { count: race.total })}{pending ? ` · ${fill(ui.tabMails, { count: pending })}` : ""}</span>
              </span>
            </button>
          );
        })}
      </nav>

      <section className="natx-race">
        <div className="natx-race__facts">
          <span className="natx-fact"><b>{selectedRace.quota}</b> {ui.factPlaces}</span>
          {selectedRace.allowsPacer ? (
            <span className="natx-fact">{ui.factPacer} <b>{selectedRace.hasPacer ? ui.yes : ui.no}</b></span>
          ) : null}
          {selectedRace.luxReserved ? (
            <span className="natx-fact">{ui.factLux} <b>{luxInProposal}/{selectedRace.luxReserved}</b></span>
          ) : null}
          <span className="natx-fact">{ui.factBasis}</span>
          {selectedRace.invitationOnly ? <span className="natx-fact natx-fact--note">{ui.factInvitation}</span> : null}
        </div>
        <button className="natx-btn natx-btn--primary" type="button" onClick={() => openDrawer(() => setAthleteFormTarget("new"))}>
          {selectedRace.invitationOnly ? copy.add.inviteButton : copy.add.addButton}
        </button>
      </section>

      {selectedRace.selected > selectedRace.athleteQuota ? (
        <p className="natx-alert natx-alert--warn">
          <b>{copy.quotaTitle}.</b> {fill(copy.quotaBody, { count: selectedRace.selected, quota: selectedRace.athleteQuota, race: selectedRaceLabel })}
        </p>
      ) : null}

      <div className="natx-board">
        <div className="natx-toolbar">
          <span className="natx-muted">{checkedInRace.length ? fill(copy.bulkSelected, { count: checkedInRace.length }) : copy.bulkHint}</span>
          {DECISIONS.map((decision) => (
            <button
              key={decision.status}
              className="natx-btn natx-btn--sm"
              disabled={isBusy || !checkedInRace.length}
              type="button"
              onClick={() => setStatuses(raceRequests.filter((request) => checkedInRace.includes(request.id)), decision.status)}
            >
              {copy.statuses[decision.status]}
            </button>
          ))}
          <span className="natx-spacer" />
          <span className="natx-legend"><i className="natx-legend__proposed" /> {ui.legendProposed}</span>
          <button className="natx-btn natx-btn--sm natx-btn--accent" disabled={isBusy || !proposal.selection.length} type="button" onClick={handleSelectTop}>
            {selectedRace.luxReserved
              ? fill(copy.selectProposal, { count: proposal.selection.length, lux: luxInProposal })
              : fill(copy.selectTop, { count: proposal.selection.length })}
          </button>
        </div>

        <div className="natx-table-wrap">
          <table className="natx-table">
            <thead>
              <tr>
                <th aria-label={copy.select} />
                <th>#</th>
                <th>{copy.columns.athlete}</th>
                <th>{ui.colLicence}</th>
                <th>{copy.columns.best}</th>
                <th title={ui.colPacerPayTitle}>{ui.colPacerPay}</th>
                <th>{copy.columns.decision}</th>
                <th>{copy.columns.mail}</th>
                <th aria-label={ui.colActions} />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td className="natx-empty" colSpan={9}>{copy.loading}</td></tr>
              ) : null}
              {!loading && !raceRequests.length ? (
                <tr><td className="natx-empty" colSpan={9}>{selectedRace.invitationOnly ? ui.emptyInvitation : copy.emptyRace}</td></tr>
              ) : null}
              {raceRequests.map((request, index) => {
                const age = getAthleteAge(request.birthDate);
                const best = getBestTimeSummary(request);
                const isWithdrawn = request.status === "withdrawn";
                const isPacer = isNationalRacePacer(request);
                const isExpanded = expandedId === request.id;
                const messageDraft = messageDrafts[request.id] ?? request.athleteMessage ?? "";
                const rowClass = [
                  "natx-row",
                  isWithdrawn ? "natx-row--withdrawn" : "",
                  proposedIds.has(request.id) ? "natx-row--proposed" : "",
                  isExpanded ? "natx-row--open" : "",
                ].filter(Boolean).join(" ");
                return (
                  <Fragment key={request.id}>
                    <tr className={rowClass}>
                      <td>
                        <input
                          aria-label={fill(copy.select, { name: `${request.firstName} ${request.lastName}` })}
                          checked={checkedInRace.includes(request.id)}
                          disabled={isWithdrawn}
                          type="checkbox"
                          onChange={() =>
                            setCheckedIds((current) => (current.includes(request.id) ? current.filter((id) => id !== request.id) : [...current, request.id]))
                          }
                        />
                      </td>
                      <td className="natx-rank">{isPacer ? "L" : index + 1}</td>
                      <td>
                        <button className="natx-name" type="button" onClick={() => setExpandedId(isExpanded ? "" : request.id)}>
                          {request.lastName.toUpperCase()} {request.firstName}
                        </button>
                        <span className="natx-sub">
                          {[request.nationality, age !== null ? fill(copy.age, { age }) : request.birthYear].filter(Boolean).join(" · ")}
                        </span>
                        <span className="natx-tags">
                          {isPacer ? <span className="natx-tag natx-tag--pacer">{copy.pacer}</span> : null}
                          {proposal.reservedIds.has(request.id) ? <span className="natx-tag natx-tag--lux">{copy.luxSeat}</span> : null}
                          {request.source === "commission" ? <span className="natx-tag">{selectedRace.invitationOnly ? copy.invited : copy.addedByCommission}</span> : null}
                          {request.isMinor ? <span className={`natx-tag${request.guardianConsent ? "" : " natx-tag--danger"}`}>{copy.minor}</span> : null}
                          {isWithdrawn ? <span className="natx-tag natx-tag--danger">{copy.withdrawn}</span> : null}
                        </span>
                      </td>
                      <td>
                        {request.isLuxLicensed ? (
                          <>
                            <span className="natx-lic natx-lic--lux">LUX</span> {request.club}
                            <span className="natx-sub">{fill(copy.bib, { bib: request.bibNumber || "-" })}</span>
                          </>
                        ) : (
                          <>
                            <span className="natx-lic">{ui.foreignShort}</span> {request.foreignClub}
                            <span className="natx-sub">{request.foreignCountry}</span>
                          </>
                        )}
                      </td>
                      <td>
                        {best ? (
                          <>
                            <span className="natx-time">{best.time}</span> <span className="natx-time-label">{copy.timeLabels[best.label] || best.label}</span>
                            <span className="natx-sub">{[best.place, best.date ? formatDateForDisplay(best.date) : ""].filter(Boolean).join(" · ")}</span>
                          </>
                        ) : (
                          <span className="natx-muted">{copy.noTime}</span>
                        )}
                      </td>
                      <td>
                        {request.pacerPayment ? (
                          <span className={`natx-yn natx-yn--${request.pacerPayment === "oui" ? "yes" : "no"}`}>{request.pacerPayment === "oui" ? ui.yes : ui.no}</span>
                        ) : <span className="natx-muted">-</span>}
                      </td>
                      <td>
                        {isWithdrawn ? (
                          <span className="natx-muted">-</span>
                        ) : (
                          <span className="natx-seg" role="group" aria-label={copy.decisionGroup}>
                            {DECISIONS.map((decision) => (
                              <button
                                key={decision.status}
                                aria-pressed={request.status === decision.status}
                                className={`natx-seg__item${request.status === decision.status ? ` natx-seg__item--${decision.status}` : ""}`}
                                disabled={isBusy}
                                type="button"
                                onClick={() => setStatuses([request], request.status === decision.status ? "submitted" : decision.status)}
                              >
                                {copy.decisions[decision.status]}
                              </button>
                            ))}
                          </span>
                        )}
                      </td>
                      <td><MailStatus request={request} /></td>
                      <td className="natx-row-actions">
                        {NATIONAL_RACE_NOTIFIABLE_STATUSES.includes(request.status) ? (
                          <button className="natx-link" type="button" onClick={() => openDrawer(() => setMailPreviewId(request.id))}>{copy.mailPanel.preview}</button>
                        ) : null}
                        <button className="natx-link" type="button" onClick={() => openDrawer(() => setAthleteFormTarget(request.id))}>{copy.add.editButton}</button>
                        <button
                          aria-expanded={isExpanded}
                          aria-label={copy.detail}
                          className="natx-chevron"
                          type="button"
                          onClick={() => setExpandedId(isExpanded ? "" : request.id)}
                        >
                          ▾
                        </button>
                      </td>
                    </tr>
                    {isExpanded ? (
                      <tr className="natx-detail">
                        <td colSpan={9}>
                          <div className="natx-detail__grid">
                            <div>
                              <h4>{ui.detailTimes}</h4>
                              <dl>
                                {[
                                  { label: "SB", prefix: "seasonBest" },
                                  { label: "SB 2025", prefix: "previousSeasonBest" },
                                  { label: "PB", prefix: "personalBest" },
                                  { label: "Autre", prefix: "otherTime" },
                                ].map((row) => (
                                  <Fragment key={row.prefix}>
                                    <dt>{copy.timeLabels[row.label]}</dt>
                                    <dd>
                                      {request[row.prefix]
                                        ? [request[row.prefix], request[`${row.prefix}Place`], request[`${row.prefix}Date`] ? formatDateForDisplay(request[`${row.prefix}Date`]) : ""].filter(Boolean).join(" · ")
                                        : "-"}
                                    </dd>
                                  </Fragment>
                                ))}
                              </dl>
                            </div>
                            <div>
                              <h4>{ui.detailIdentity}</h4>
                              <dl>
                                <dt>{copy.add.birthDate}</dt><dd>{request.birthDate ? formatDateForDisplay(request.birthDate) : "-"}</dd>
                                <dt>{copy.add.nationality}</dt><dd>{request.nationality || "-"}</dd>
                                <dt>{ui.detailLicence}</dt>
                                <dd>{request.isLuxLicensed ? `${request.club} · ${fill(copy.bib, { bib: request.bibNumber || "-" })}` : `${request.foreignClub} · ${request.foreignCountry} · ${request.foreignLicenceNumber || "-"}`}</dd>
                                <dt>World Athletics</dt>
                                <dd>{request.worldAthleticsUrl ? <a href={request.worldAthleticsUrl} rel="noreferrer" target="_blank">{copy.worldAthleticsLink}</a> : "-"}</dd>
                              </dl>
                            </div>
                            <div>
                              <h4>{ui.detailContact}</h4>
                              <dl>
                                <dt>{copy.add.email}</dt><dd>{request.email || "-"}</dd>
                                <dt>{copy.add.phone}</dt><dd>{request.phone || "-"}</dd>
                                {request.isMinor ? (
                                  <>
                                    <dt>{ui.detailGuardian}</dt>
                                    <dd>{`${request.guardianFirstName || ""} ${request.guardianLastName || ""} · ${request.guardianEmail || ""}`}</dd>
                                  </>
                                ) : null}
                                <dt>{ui.detailReceived}</dt><dd>{formatDateTimeForDisplay(request.submittedAt)}</dd>
                                {request.notes ? (<><dt>{ui.detailNote}</dt><dd>{request.notes}</dd></>) : null}
                              </dl>
                            </div>
                            <div>
                              <h4>{ui.detailFollowUp}</h4>
                              <label className="natx-field">
                                <span>{copy.messageLabel}</span>
                                <input
                                  placeholder={copy.messagePlaceholder}
                                  value={messageDraft}
                                  onBlur={() => {
                                    if (messageDraft.trim() === (request.athleteMessage || "")) return;
                                    updateRequest(request, { athleteMessage: messageDraft.trim() }, copy.messageSaved);
                                  }}
                                  onChange={(event) => setMessageDrafts((current) => ({ ...current, [request.id]: event.target.value }))}
                                />
                              </label>
                              {request.status === "selected" ? (
                                <label className="natx-check">
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
                            </div>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {drawerOpen ? createPortal(
        <div className="natx natx-drawer-layer">
          <button aria-label={ui.close} className="natx-drawer-backdrop" type="button" onClick={closeDrawer} />
          <aside className="natx-drawer" aria-modal="true" role="dialog">
            <button aria-label={ui.close} className="natx-drawer__close" type="button" onClick={closeDrawer}>×</button>
            {athleteFormTarget && (athleteFormTarget === "new" || editedRequest) ? (
              <AddAthleteForm
                key={athleteFormTarget}
                initial={editedRequest}
                isSaving={isBusy}
                race={editedRequest ? raceSummaries.find((race) => race.code === editedRequest.raceCode) || selectedRace : selectedRace}
                raceLabel={editedRequest ? raceLabel(editedRequest.raceCode, editedRequest.event) : selectedRaceLabel}
                onCancel={closeDrawer}
                onSubmit={handleSaveAthlete}
              />
            ) : null}
            {mailPreviewRequest ? <MailPreviewCard request={mailPreviewRequest} templates={templates} onClose={closeDrawer} /> : null}
            {isEditingTemplates ? (
              <TemplateEditor isSaving={isBusy} templates={templates} onClose={closeDrawer} onSave={handleSaveTemplates} />
            ) : null}
            {isMailDrawerOpen ? (
              <MailPanel
                isSending={isSending}
                lastSend={lastSend}
                pendingRequests={pendingRequests}
                templates={templates}
                onEditTemplates={() => openDrawer(() => setIsEditingTemplates(true))}
                onSend={handleSend}
                onSendTest={handleSendTest}
              />
            ) : null}
          </aside>
        </div>
      , document.body) : null}
    </div>
  );
}

export { NationalRacesPage };
