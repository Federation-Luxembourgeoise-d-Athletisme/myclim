import { useMemo, useState } from "react";
import { doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { getAppBaseUrl } from "../services/app-url";
import { db } from "../services/firebase";
import {
  NATIONAL_RACE_DEFINITIONS,
  NATIONAL_RACE_REQUESTS_COLLECTION,
  NATIONAL_RACE_STATUSES,
  compareNationalRaceRequests,
} from "./national-races-helpers";
import { useNationalRaceRequests } from "./national-races-hooks";
import { formatDateTimeForDisplay } from "./u14-helpers";

const STATUS_LABELS = {
  submitted: "Demande reçue",
  selected: "Retenu",
  waitlist: "Liste d'attente",
  not_selected: "Non retenu",
  withdrawn: "Désisté",
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

// Onglet « Courses nationales » du module Pré-programme : la liste est
// proposée dans l'ordre de sélection (licenciés luxembourgeois d'abord, puis
// meilleure performance) ; la décision reste manuelle, validée avec la
// commission des athlètes.
function NationalRacesAdminTab(props) {
  const { DataTable, Panel, loadMailQueueModule } = props;
  const { requests, loading, error } = useNationalRaceRequests();
  const [selectedRaceCode, setSelectedRaceCode] = useState(NATIONAL_RACE_DEFINITIONS[0].code);
  const [busyRequestId, setBusyRequestId] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [messageDrafts, setMessageDrafts] = useState({});

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
  const selectedRace = raceSummaries.find((race) => race.code === selectedRaceCode) || raceSummaries[0];
  const raceRequests = useMemo(
    () => requests.filter((request) => request.raceCode === selectedRace.code).sort(compareNationalRaceRequests),
    [requests, selectedRace.code],
  );

  async function updateRequest(request, changes, successMessage) {
    setBusyRequestId(request.id);
    setStatusMessage("");
    setErrorMessage("");
    try {
      await updateDoc(doc(db, NATIONAL_RACE_REQUESTS_COLLECTION, request.id), { ...changes, updatedAt: serverTimestamp() });
      setStatusMessage(successMessage);
      return true;
    } catch {
      setErrorMessage("La modification n'a pas pu être enregistrée.");
      return false;
    } finally {
      setBusyRequestId("");
    }
  }

  async function handleStatusChange(request, status) {
    const name = `${request.firstName} ${request.lastName}`;
    const saved = await updateRequest(request, { status }, `${name} : ${STATUS_LABELS[status]}.`);
    if (!saved || status !== "selected" || !request.email) return;

    try {
      const { enqueueTransactionalMail } = await loadMailQueueModule();
      await enqueueTransactionalMail({
        type: "national-race-selected",
        to: request.email,
        subject: `Vous êtes retenu(e) pour le ${request.event} / You have been selected for the ${request.event}`,
        body: `Bonjour ${request.firstName},\n\nVous êtes retenu(e) pour le ${request.event} des courses nationales du pré-programme du CMCM Luxembourg Indoor Meeting.\n\nL'organisation se charge de votre engagement et reviendra vers vous avec les informations pratiques. Votre statut est visible dans votre espace MyCLIM (${getAppBaseUrl()}/app/mon-inscription).\n\n---\n\nHello ${request.firstName},\n\nYou have been selected for the ${request.event} of the pre-programme national races. The organisers handle your entry and will contact you with the practical information. Your status is in your MyCLIM space (${getAppBaseUrl()}/app/mon-inscription).\n`,
        metadata: { requestId: request.id, raceCode: request.raceCode },
      });
    } catch (mailError) {
      console.error("National race selection email could not be sent", mailError);
      setErrorMessage(`${name} est retenu(e), mais le mail n'a pas pu être envoyé.`);
    }
  }

  return (
    <>
      {error ? <p className="status-note">{error}</p> : null}
      {statusMessage ? <p className="panel-note panel-note--success">{statusMessage}</p> : null}
      {errorMessage ? <p className="form-error">{errorMessage}</p> : null}
      <Panel
        title="Courses nationales"
        subtitle="Classement proposé : licenciés luxembourgeois d'abord, puis meilleure performance déclarée, puis ordre d'arrivée. La sélection reste à valider avec la commission des athlètes."
      >
        <div className="u14-race-grid">
          {raceSummaries.map((race) => (
            <button
              key={race.code}
              className={`selection-card u14-race-card ${selectedRace.code === race.code ? "u14-race-card--active" : ""}`}
              type="button"
              onClick={() => setSelectedRaceCode(race.code)}
            >
              <div className="u14-race-card__head">
                <strong>{race.label}</strong>
                <span className="u14-race-card__remaining">
                  {race.selected} / {race.quota} retenu(s) · {race.total} demande(s)
                </span>
              </div>
            </button>
          ))}
        </div>
      </Panel>

      {selectedRace.selected > selectedRace.quota ? (
        <div className="notice-card notice-card--warn">
          <strong>Quota dépassé</strong>
          <p>
            {selectedRace.selected} athlètes retenus pour {selectedRace.quota} places sur le {selectedRace.label}.
          </p>
        </div>
      ) : null}

      <Panel title={selectedRace.label} subtitle={`${selectedRace.quota} places. Un mail est envoyé à l'athlète quand vous le passez en « Retenu ».`}>
        <DataTable
          columns={[
            { key: "rank", label: "#" },
            { key: "athlete", label: "Athlète" },
            { key: "licence", label: "Licence" },
            { key: "performance", label: "Performance" },
            { key: "status", label: "Décision" },
            { key: "seltec", label: "Engagé SELTEC (orga)" },
            { key: "message", label: "Message à l'athlète" },
          ]}
          rows={
            loading
              ? [{ rank: "-", athlete: "Chargement..." }]
              : raceRequests.length
                ? raceRequests.map((request, index) => {
                    const age = getAthleteAge(request.birthDate);
                    const isBusy = busyRequestId === request.id;
                    const messageDraft = messageDrafts[request.id] ?? request.athleteMessage ?? "";
                    return {
                      id: request.id,
                      rank: index + 1,
                      athlete: (
                        <div className="table-stack">
                          <strong>{request.firstName} {request.lastName}</strong>
                          <span>{request.birthYear || "-"}{age !== null ? ` · ${age} ans` : ""} · {request.email}</span>
                          {request.isMinor ? (
                            <span className={request.guardianConsent ? "status-pill status-pill--accent" : "status-pill status-pill--danger"}>
                              Mineur · accord {request.guardianFirstName} {request.guardianLastName} ({request.guardianEmail})
                            </span>
                          ) : null}
                          <span>Reçue le {formatDateTimeForDisplay(request.submittedAt)}</span>
                        </div>
                      ),
                      licence: request.isLuxLicensed ? (
                        <div className="table-stack">
                          <strong>{request.club}</strong>
                          <span>Dossard {request.bibNumber || "-"}</span>
                        </div>
                      ) : (
                        <div className="table-stack">
                          <span className="status-pill status-pill--warn">Étranger</span>
                          <strong>{request.foreignClub} ({request.foreignCountry})</strong>
                          <span>Licence {request.foreignLicenceNumber || "-"}</span>
                        </div>
                      ),
                      performance: (
                        <div className="table-stack">
                          <strong>PB {request.personalBest || "-"}</strong>
                          <span>SB 2026 {request.seasonBest || "-"}</span>
                          {request.performanceContext ? <span>{request.performanceContext}</span> : null}
                          {request.otherTimes ? <span>Autres temps : {request.otherTimes}</span> : null}
                          {request.notes ? <span className="parent-request-note">{request.notes}</span> : null}
                        </div>
                      ),
                      status: (
                        <select disabled={isBusy} value={request.status || "submitted"} onChange={(event) => handleStatusChange(request, event.target.value)}>
                          {NATIONAL_RACE_STATUSES.map((status) => (
                            <option key={status} value={status}>{STATUS_LABELS[status]}</option>
                          ))}
                        </select>
                      ),
                      seltec:
                        request.status === "selected" ? (
                          <label className="selection-card selection-card--compact">
                            <input
                              checked={Boolean(request.seltecEntered)}
                              disabled={isBusy}
                              type="checkbox"
                              onChange={(event) =>
                                updateRequest(
                                  request,
                                  { seltecEntered: event.target.checked },
                                  event.target.checked ? "Engagement SELTEC noté." : "Engagement SELTEC retiré.",
                                )
                              }
                            />
                            <div><strong>Engagé</strong></div>
                          </label>
                        ) : (
                          "-"
                        ),
                      message: (
                        <input
                          disabled={isBusy}
                          placeholder="Visible dans son espace"
                          value={messageDraft}
                          onBlur={() => {
                            if (messageDraft === (request.athleteMessage || "")) return;
                            updateRequest(request, { athleteMessage: messageDraft.trim() }, "Message enregistré.");
                          }}
                          onChange={(event) => setMessageDrafts((current) => ({ ...current, [request.id]: event.target.value }))}
                        />
                      ),
                    };
                  })
                : [{ rank: "-", athlete: "Aucune demande pour cette course." }]
          }
        />
      </Panel>
    </>
  );
}

export { NationalRacesAdminTab };
