import { useState } from "react";
import { NavLink } from "react-router-dom";
import { doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { useLanguage } from "./language-context";
import {
  NATIONAL_RACE_REQUESTS_COLLECTION,
  getNationalRaceDefinition,
  getNationalRaceStatusKey,
  getNationalRaceStatusPillClass,
} from "./national-races-helpers";
import { useNationalRaceRequests } from "./national-races-hooks";
import { formatDateTimeForDisplay } from "./u14-helpers";
import { useAuth } from "../context/auth-context";
import { db } from "../services/firebase";

function MyNationalRacePage(props) {
  const { DataTable, Panel } = props;
  const { currentUser } = useAuth();
  const { t } = useLanguage();
  const { requests, loading, error } = useNationalRaceRequests({ athleteUserId: currentUser?.uid || "", enabled: Boolean(currentUser) });
  const [busyRequestId, setBusyRequestId] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const hasSelectedRequest = requests.some((request) => request.status === "selected");

  async function handleWithdraw(request) {
    if (!window.confirm(t("natWithdrawConfirm").replace("{event}", request.event))) return;
    setBusyRequestId(request.id);
    setStatusMessage("");
    setErrorMessage("");
    try {
      await updateDoc(doc(db, NATIONAL_RACE_REQUESTS_COLLECTION, request.id), {
        status: "withdrawn",
        withdrawnAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setStatusMessage(t("natWithdrawn").replace("{event}", request.event));
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
          <p className="eyebrow">{t("natPortalEyebrow")}</p>
          <h1>{t("natPortalTitle")}</h1>
          <p>{t("natPortalIntro")}</p>
        </div>
      </section>
      {error ? <p className="status-note">{error}</p> : null}
      {statusMessage ? <p className="panel-note panel-note--success">{statusMessage}</p> : null}
      {errorMessage ? <p className="form-error">{errorMessage}</p> : null}

      {hasSelectedRequest ? (
        <div className="notice-card notice-card--ok">
          <strong>{t("natSelectedTitle")}</strong>
          <p>{t("natSelectedBody")}</p>
        </div>
      ) : null}

      <Panel title={t("natPortalPanelTitle")}>
        <DataTable
          columns={[
            { key: "race", label: t("natColRace") },
            { key: "performance", label: t("natColPerformance") },
            { key: "status", label: t("mcColStatus") },
            { key: "submittedAt", label: t("mcColSubmittedAt") },
            { key: "actions", label: t("mcColActions") },
          ]}
          rows={
            loading
              ? [{ race: t("mcLoading"), performance: "-", status: "-", submittedAt: "-", actions: "-" }]
              : requests.length
                ? requests.map((request) => ({
                    id: request.id,
                    race: getNationalRaceDefinition(request.raceCode)?.label || request.event,
                    performance: (
                      <div className="table-stack">
                        <strong>{t("natPersonalBestShort")} {request.personalBest || "-"}</strong>
                        {request.seasonBest ? <span>{t("natSeasonBestShort")} {request.seasonBest}</span> : null}
                      </div>
                    ),
                    status: (
                      <div className="table-stack">
                        <span className={getNationalRaceStatusPillClass(request.status)}>{t(getNationalRaceStatusKey(request.status))}</span>
                        {request.athleteMessage ? <span className="parent-request-practical">{request.athleteMessage}</span> : null}
                      </div>
                    ),
                    submittedAt: formatDateTimeForDisplay(request.submittedAt),
                    actions:
                      request.status === "withdrawn" || request.status === "not_selected" ? (
                        "-"
                      ) : (
                        <button
                          className="button button--ghost-danger button--small"
                          disabled={busyRequestId === request.id}
                          type="button"
                          onClick={() => handleWithdraw(request)}
                        >
                          {t("mcWithdrawButton")}
                        </button>
                      ),
                  }))
                : [{ race: t("natPortalEmpty"), performance: "-", status: "-", submittedAt: "-", actions: "-" }]
          }
        />
      </Panel>
      <div className="panel-actions">
        <NavLink className="button button-link" to="/pre-programme?parcours=courses-nationales">
          {t("natAddEvent")}
        </NavLink>
      </div>
    </div>
  );
}

export { MyNationalRacePage };
