import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  U14_PRACTICAL_INFO_DOC_PATH,
  U14_RACE_DEFINITIONS,
  buildU14AllocationSnapshot,
  formatDateForDisplay,
  formatDateTimeForDisplay,
  getTimestampMs,
  getU14ConfirmationDeadline,
  getU14PracticalRoleKey,
  normalizeComparableValue,
} from "./u14-helpers";
import {
  useU14ChildrenList,
  useU14PracticalInfoConfiguration,
  useU14ProtectedInvites,
  useU14ProtectedSettings,
  useU14RequestsList,
} from "./u14-hooks";
import { U14_STAGE_ORDER, U14_STAGE_TONES, getU14ChildStage } from "./u14-stage";
import { U14ProtectedTab } from "./u14-protected-tab";
import { useActiveEdition } from "./edition";
import { useMeetingEditions } from "./meeting-history-hooks";
import { db } from "../services/firebase";

// Module Pré-programme U12 / U14 (équipe) : une page « À faire », un tableau
// par course avec un seul statut lisible, le porte-panier sur le même modèle,
// les places protégées et les textes envoyés aux familles. La répartition des
// places est automatique (ici à l'ouverture, et côté serveur à chaque
// nouvelle demande ou désistement) ; l'équipe ne fait que retenir, relancer
// ou libérer.
const U14_TABS = [
  { id: "todo", path: "/app/u14", label: "À faire" },
  { id: "races", path: "/app/u14/courses", label: "Courses" },
  { id: "basket", path: "/app/u14/porte-panier", label: "Porte-panier" },
  { id: "protected", path: "/app/u14/places-protegees", label: "Places protégées" },
  { id: "mails", path: "/app/u14/infos-pratiques", label: "Mails et infos pratiques" },
];

const U14_AUTOMATIC_MAILS = [
  { when: "À l'inscription", what: "Confirmation de la demande, avec le récapitulatif des enfants inscrits." },
  { when: "Quand vous retenez un enfant", what: "« Votre enfant est retenu » : course ou porte-panier, date, lieu, infos pratiques et délai de 10 jours pour confirmer." },
  { when: "Quand vous relancez", what: "Le même mail, avec un nouveau délai de 10 jours." },
  { when: "Quand le parent confirme", what: "« Merci, tout est ok » avec les infos pratiques et l'entrée offerte de l'accompagnant." },
  { when: "Place protégée", what: "Invitation avec lien personnel, rappel automatique 2 jours avant la date limite, puis « Merci, tout est ok » à l'inscription." },
  { when: "Désistement", what: "Accusé de réception au parent qui se désiste." },
];

function getTabFromPath(pathname) {
  const path = String(pathname || "").replace(/\/+$/, "");
  return U14_TABS.find((tab) => tab.id !== "todo" && path.endsWith(tab.path))?.id || "todo";
}

function StagePill({ stage }) {
  return <span className={U14_STAGE_TONES[stage.tone] || "status-pill"}>{stage.label}</span>;
}

// Fiche d'un enfant : coordonnées et historique de sa demande.
function ChildDetail({ request, invite, onRelease, isBusy }) {
  const child = request.child || {};
  const history = [
    [request.submittedAt, "Demande envoyée"],
    [invite?.claimedAt, "Place protégée confirmée avec le lien d'invitation"],
    [request.promotedFromWaitlistAt, "Monté de la liste d'attente"],
    [request.adminApprovedAt, "Retenu par l'équipe, mail envoyé au parent"],
    [request.remindedAt, `Relance envoyée${request.reminderCount > 1 ? ` (${request.reminderCount} au total)` : ""}`],
    [
      request.parentDecisionAt,
      normalizeComparableValue(request.parentDecisionStatus) === "declined"
        ? `Désistement${request.withdrawalReason ? ` : ${request.withdrawalReason}` : ""}`
        : "Participation confirmée par le parent",
    ],
  ]
    .filter(([value]) => getTimestampMs(value))
    .sort((left, right) => getTimestampMs(left[0]) - getTimestampMs(right[0]));
  const stage = getU14ChildStage(request);
  const canRelease = !["withdrawn", "rejected"].includes(stage.key);

  return (
    <div className="u14m-detail">
      <div className="u14m-detail__grid">
        <div>
          <strong>Enfant</strong>
          <span>{request.childName}</span>
          <span className="parent-request-note">
            {[request.category, child.birthDate ? `né(e) le ${formatDateForDisplay(child.birthDate)}` : "", request.club, request.bibNumber ? `dossard ${request.bibNumber}` : ""]
              .filter(Boolean)
              .join(" · ")}
          </span>
          {request.notes ? <span className="parent-request-note">Note : {request.notes}</span> : null}
        </div>
        <div>
          <strong>Parent</strong>
          <span>{request.parentName}</span>
          {request.parentEmail ? <a href={`mailto:${request.parentEmail}`}>{request.parentEmail}</a> : null}
        </div>
        <div>
          <strong>Historique</strong>
          {history.length ? (
            history.map(([value, label]) => (
              <span key={label}>
                <span className="parent-request-note">{formatDateTimeForDisplay(value)}</span> — {label}
              </span>
            ))
          ) : (
            <span className="parent-request-note">Aucun événement</span>
          )}
        </div>
      </div>
      {canRelease ? (
        <div className="table-actions table-actions--inline">
          <button className="button button--ghost-danger button--small" disabled={isBusy} type="button" onClick={() => onRelease(request)}>
            Retirer cet enfant et libérer la place
          </button>
        </div>
      ) : null}
    </div>
  );
}

// Tableau d'enfants (une course ou le porte-panier) : un statut, une action.
function ChildrenTable({ rows, invitesByRequestId, renderAction, onRelease, isBusy, now, extraRows = [] }) {
  const [openId, setOpenId] = useState("");

  return (
    <div className="u14m-table">
      <div className="u14m-row u14m-row--head">
        <span>#</span>
        <span>Enfant</span>
        <span>Où il en est</span>
        <span />
      </div>
      {rows.length || extraRows.length ? null : <p className="parent-request-note u14m-empty">Aucun enfant pour l'instant.</p>}
      {rows.map(({ request, position }) => {
        const stage = getU14ChildStage(request, now);
        const isOpen = openId === request.id;
        const invite = invitesByRequestId.get(request.id);
        return (
          <Fragment key={request.id}>
            <div className={`u14m-row${stage.key === "withdrawn" || stage.key === "rejected" ? " u14m-row--muted" : ""}`}>
              <span className="u14m-position">{position}</span>
              <span>
                <button className="u14m-name" type="button" onClick={() => setOpenId(isOpen ? "" : request.id)}>
                  {request.childName} <span aria-hidden="true">{isOpen ? "▴" : "▾"}</span>
                </button>
                <span className="parent-request-note"> {request.club || ""}</span>
                <span className="u14m-badges">
                  {invite ? <span className="status-pill status-pill--accent">Invité(e)</span> : null}
                  {request.requestType === "preprogram_ou_porte_panier" ? <span className="status-pill">accepte aussi porte-panier</span> : null}
                </span>
              </span>
              <span>
                <StagePill stage={stage} /> <span className="parent-request-note">{stage.detail}</span>
              </span>
              <span className="table-actions table-actions--inline">{renderAction(request, stage)}</span>
            </div>
            {isOpen ? <ChildDetail invite={invite} isBusy={isBusy} request={request} onRelease={onRelease} /> : null}
          </Fragment>
        );
      })}
      {extraRows}
    </div>
  );
}

function U14Page(props) {
  const { AuthFormField, Panel, DataTable, doc, loadMailQueueModule, serverTimestamp, setDoc, syncU14RaceAllocations, updateDoc } = props;
  const location = useLocation();
  const navigate = useNavigate();
  const { requests, loading: requestsLoading, error: requestsError } = useU14RequestsList(true);
  const { children, loading: childrenLoading, error: childrenError } = useU14ChildrenList(true);
  const { invites: protectedInvites, loading: invitesLoading, error: invitesError } = useU14ProtectedInvites(true);
  const { settings: protectedSettings } = useU14ProtectedSettings(true);
  const {
    preprogram: preprogramPracticalInfo,
    porte_panier: basketPracticalInfo,
    loading: practicalInfoLoading,
    error: practicalInfoError,
  } = useU14PracticalInfoConfiguration(true);
  const { activeEditionId } = useActiveEdition();
  const { editions } = useMeetingEditions();
  const activeEdition = editions.find((edition) => String(edition.year || edition.id) === String(activeEditionId)) || null;
  const mailContext = {
    eventDate: activeEdition?.date || null,
    venue: activeEdition?.venue || "",
    editionYear: activeEdition?.year || activeEditionId,
  };
  const [now] = useState(() => Date.now());
  const activeTab = getTabFromPath(location.pathname);
  const [selectedRaceCode, setSelectedRaceCode] = useState(U14_RACE_DEFINITIONS[0].code);
  const [search, setSearch] = useState("");
  const [practicalDraft, setPracticalDraft] = useState(null);
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const dataLoading = requestsLoading || childrenLoading || invitesLoading;

  const { requestRecords, requestStatusMap, raceSummaries, reserveByPool, claimedByPool, reserveReleased } = useMemo(
    () => buildU14AllocationSnapshot({ requests, children, protectedInvites, protectedSettings, now }),
    [children, now, protectedInvites, protectedSettings, requests],
  );
  const invitesByRequestId = useMemo(
    () => new Map(protectedInvites.filter((invite) => invite.status === "claimed").map((invite) => [invite.claimedRequestId, invite])),
    [protectedInvites],
  );

  // Répartition automatique : si l'état enregistré d'une demande ne correspond
  // plus au calcul (nouvelle demande, place libérée…), on l'écrit sans clic.
  const pendingSyncKey = useMemo(() => {
    const outdated = requestRecords.filter((request) => {
      const next = requestStatusMap.get(request.id);
      if (!next || request.requestType === "porte_panier") return false;
      return (
        normalizeComparableValue(request.status) !== next.status ||
        normalizeComparableValue(request.allocationMode) !== next.allocationMode ||
        (Number(request.waitlistPosition || 0) || null) !== next.waitlistPosition
      );
    });
    return outdated.map((request) => request.id).sort().join(",");
  }, [requestRecords, requestStatusMap]);
  const lastSyncKey = useRef("");
  useEffect(() => {
    if (dataLoading || !pendingSyncKey || lastSyncKey.current === pendingSyncKey) return;    lastSyncKey.current = pendingSyncKey;
    syncU14RaceAllocations({ requests, children, protectedInvites, protectedSettings }).catch((error) =>
      console.error("Automatic U14 allocation failed", error),
    );
  }, [children, dataLoading, pendingSyncKey, protectedInvites, protectedSettings, requests, syncU14RaceAllocations]);

  const raceRequests = requestRecords.filter((request) => request.requestType !== "porte_panier" && request.raceCode);
  const basketRequests = requestRecords.filter((request) => request.requestType === "porte_panier");
  const withStage = (request) => ({ request, stage: getU14ChildStage(request, now) });
  const toRetain = raceRequests.map(withStage).filter(({ stage }) => stage.key === "to-retain");
  const overdue = requestRecords.map(withStage).filter(({ stage }) => stage.key === "overdue");
  const basketToDecide = basketRequests.map(withStage).filter(({ stage }) => stage.key === "to-decide");
  const promotedCount = toRetain.filter(({ request }) => request.promotedFromWaitlistAt).length;
  const todoCount = toRetain.length + overdue.length + basketToDecide.length;

  function flash(message) {
    setStatusMessage(message);
    setErrorMessage("");
  }

  async function runAction(action, successMessage, failureMessage) {
    setIsBusy(true);
    setStatusMessage("");
    setErrorMessage("");
    try {
      await action();
      flash(successMessage);
    } catch (error) {
      console.error(failureMessage, error);
      setErrorMessage(failureMessage);
    } finally {
      setIsBusy(false);
    }
  }

  async function sendAcceptanceMail(request, confirmationDeadline) {
    if (!request.parentEmail) return;
    const isBasket = getU14PracticalRoleKey(request) === "porte_panier";
    const mailQueue = await loadMailQueueModule();
    const buildMail = isBasket ? mailQueue.buildU14BasketAcceptanceMail : mailQueue.buildU14PreprogramAcceptanceMail;
    await mailQueue.enqueueTransactionalMail(
      buildMail({
        ...mailContext,
        parentEmail: request.parentEmail,
        parentFirstName: request.parentFirstName,
        childName: request.childName,
        raceLabel: request.raceLabel,
        practicalInfo: isBasket ? basketPracticalInfo : preprogramPracticalInfo,
        confirmationDeadline,
      }),
    );
  }

  // Retenir : le parent reçoit le mail d'acceptation et a 10 jours pour confirmer.
  function handleRetain(request) {
    const isBasket = request.requestType === "porte_panier";
    return runAction(
      async () => {
        const confirmationDeadline = getU14ConfirmationDeadline();
        await updateDoc(doc(db, "u14Requests", request.id), {
          ...(isBasket ? { status: "confirmed", allocationMode: "porte_panier" } : {}),
          adminApprovalStatus: "approved",
          parentDecisionRequired: true,
          parentDecisionStatus: "pending",
          adminApprovedAt: serverTimestamp(),
          confirmationDeadline,
        });
        await sendAcceptanceMail(request, confirmationDeadline);
      },
      `${request.childName} est retenu(e) : mail envoyé au parent, réponse attendue sous 10 jours.`,
      "Impossible de retenir cet enfant pour le moment.",
    );
  }

  function handleRemind(request) {
    return runAction(
      async () => {
        const confirmationDeadline = getU14ConfirmationDeadline();
        await updateDoc(doc(db, "u14Requests", request.id), {
          confirmationDeadline,
          remindedAt: serverTimestamp(),
          reminderCount: Number(request.reminderCount || 0) + 1,
        });
        await sendAcceptanceMail(request, confirmationDeadline);
      },
      `Relance envoyée au parent de ${request.childName}, nouveau délai de 10 jours.`,
      "Impossible d'envoyer la relance pour le moment.",
    );
  }

  // Retirer un enfant (délai dépassé, demande de la famille…) : même effet
  // qu'un désistement ; la liste d'attente avance toute seule.
  function handleRelease(request) {
    if (!window.confirm(`Retirer ${request.childName} et libérer sa place ? L'enfant suivant de la liste d'attente montera (à retenir par vous).`)) {
      return undefined;
    }
    return runAction(
      async () => {
        const declinedFields = {
          status: "declined",
          parentDecisionStatus: "declined",
          withdrawalReason:
            getU14ChildStage(request, now).key === "overdue" ? "Délai de confirmation dépassé (libéré par l'organisation)" : "Retiré par l'organisation",
          declinedByAdmin: true,
          acceptedPosition: null,
          waitlistPosition: null,
          queuePosition: null,
        };
        await updateDoc(doc(db, "u14Requests", request.id), { ...declinedFields, parentDecisionAt: serverTimestamp() });
        await syncU14RaceAllocations({
          requests: requests.map((current) => (current.id === request.id ? { ...current, ...declinedFields } : current)),
          children,
          protectedInvites,
          protectedSettings,
        });
      },
      `Place de ${request.childName} libérée. Si un enfant monte de la liste d'attente, il apparaît dans « À faire ».`,
      "Impossible de libérer cette place pour le moment.",
    );
  }

  function handleSavePracticalInfo(event) {
    event.preventDefault();
    const draft = practicalDraft || { preprogram: preprogramPracticalInfo, porte_panier: basketPracticalInfo };
    return runAction(
      async () => {
        await setDoc(
          doc(db, ...U14_PRACTICAL_INFO_DOC_PATH),
          { preprogram: draft.preprogram.trim(), porte_panier: draft.porte_panier.trim(), updatedAt: serverTimestamp() },
          { merge: true },
        );
        setPracticalDraft(null);
      },
      "Infos pratiques enregistrées.",
      "Impossible d'enregistrer les infos pratiques pour le moment.",
    );
  }

  function renderAction(request, stage) {
    if (stage.key === "to-retain") {
      return (
        <button className="button button--primary button--small" disabled={isBusy} type="button" onClick={() => handleRetain(request)}>
          Retenir et envoyer le mail
        </button>
      );
    }
    if (stage.key === "to-decide") {
      return (
        <button className="button button--primary button--small" disabled={isBusy} type="button" onClick={() => handleRetain(request)}>
          Retenir en porte-panier
        </button>
      );
    }
    if (stage.key === "overdue") {
      return (
        <>
          <button className="button button--secondary button--small" disabled={isBusy} type="button" onClick={() => handleRemind(request)}>
            Relancer
          </button>
          <button className="button button--ghost-danger button--small" disabled={isBusy} type="button" onClick={() => handleRelease(request)}>
            Libérer
          </button>
        </>
      );
    }
    if (stage.key === "waiting-parent") {
      return (
        <button className="button button--secondary button--small" disabled={isBusy} type="button" onClick={() => handleRemind(request)}>
          Relancer
        </button>
      );
    }
    return null;
  }

  // ── Tableau d'une course ──
  const normalizedSearch = normalizeComparableValue(search);
  const selectedRace = raceSummaries.find((race) => race.code === selectedRaceCode) || raceSummaries[0];
  const raceRows = raceRequests
    .filter((request) =>
      normalizedSearch
        ? normalizeComparableValue([request.childName, request.club, request.bibNumber, request.parentName].join(" ")).includes(normalizedSearch)
        : request.raceCode === selectedRace.code,
    )
    .map(withStage)
    .sort((left, right) => {
      const order = (U14_STAGE_ORDER[left.stage.key] ?? 9) - (U14_STAGE_ORDER[right.stage.key] ?? 9);
      if (order) return order;
      const leftPosition = Number(left.request.acceptedPosition || left.request.waitlistPosition || 0);
      const rightPosition = Number(right.request.acceptedPosition || right.request.waitlistPosition || 0);
      return leftPosition - rightPosition || left.request.submittedAtMs - right.request.submittedAtMs;
    })
    .map(({ request, stage }) => ({
      request,
      position:
        stage.key === "waitlist"
          ? `A${request.waitlistPosition || "?"}`
          : ["withdrawn", "rejected"].includes(stage.key)
            ? "—"
            : request.acceptedPosition || "—",
    }));
  const reserveRows =
    !normalizedSearch && selectedRace.blockedPlaces
      ? [
          <div key="reserve" className="u14m-row u14m-row--reserve">
            <span className="u14m-position">—</span>
            <span>{selectedRace.blockedPlaces} place(s) réservée(s) aux enfants invités</span>
            <span className="parent-request-note">
              {protectedSettings.deadline ? `jusqu'au ${formatDateForDisplay(protectedSettings.deadline)}, puis rendues aux inscriptions` : "jusqu'à la date limite des places protégées"}
            </span>
            <span />
          </div>,
        ]
      : [];

  return (
    <div className="page">
      <section className="page-header">
        <div>
          <p className="eyebrow">Pré-programme</p>
          <h1>U12 / U14</h1>
          <p>Courses jeunes et porte-panier. Les places se répartissent toutes seules par ordre d'arrivée ; vous retenez les enfants, relancez les familles et suivez les confirmations.</p>
        </div>
      </section>

      {requestsError || childrenError || invitesError ? <p className="status-note">{requestsError || childrenError || invitesError}</p> : null}
      {statusMessage ? <p className="panel-note panel-note--success">{statusMessage}</p> : null}
      {errorMessage ? <p className="form-error">{errorMessage}</p> : null}
      {dataLoading ? <p className="status-note">Chargement du module U12 / U14…</p> : null}

      <div className="admin-subtabs" role="tablist" aria-label="Navigation du module U12 / U14">
        {U14_TABS.map((tab) => (
          <button
            key={tab.id}
            aria-selected={activeTab === tab.id}
            className={`admin-subtab ${activeTab === tab.id ? "admin-subtab--active" : ""}`}
            role="tab"
            type="button"
            onClick={() => navigate(tab.path)}
          >
            {tab.label}
            {tab.id === "todo" && todoCount ? ` · ${todoCount}` : ""}
            {tab.id === "basket" && basketRequests.length ? ` (${basketRequests.length})` : ""}
          </button>
        ))}
      </div>

      {activeTab === "todo" ? (
        <>
          <section className="metric-grid">
            <article className="metric-card"><span>Enfants à retenir</span><strong>{toRetain.length}</strong></article>
            <article className="metric-card metric-card--accent"><span>dont montés de l'attente</span><strong>{promotedCount}</strong></article>
            <article className="metric-card metric-card--warn"><span>Sans réponse (délai dépassé)</span><strong>{overdue.length}</strong></article>
            <article className="metric-card"><span>Porte-panier à décider</span><strong>{basketToDecide.length}</strong></article>
          </section>
          <Panel title="À faire" subtitle="Tout ce qui attend une décision de l'équipe. Retenir envoie le mail d'acceptation ; le parent a ensuite 10 jours pour confirmer.">
            {todoCount ? (
              <ChildrenTable
                invitesByRequestId={invitesByRequestId}
                isBusy={isBusy}
                now={now}
                renderAction={renderAction}
                rows={[...overdue, ...toRetain, ...basketToDecide].map(({ request }) => ({
                  request,
                  position: request.requestType === "porte_panier" ? "PP" : request.raceCode ? request.raceLabel.replace(" - ", " ") : "—",
                }))}
                onRelease={handleRelease}
              />
            ) : (
              <p className="parent-request-note">Rien à faire pour l'instant : toutes les demandes sont traitées.</p>
            )}
          </Panel>
        </>
      ) : null}

      {activeTab === "races" ? (
        <Panel title="Courses" subtitle="Un tableau par course : les enfants retenus, les places réservées aux invités, puis la liste d'attente. Cliquez sur un nom pour voir sa fiche.">
          <div className="u14m-toolbar">
            <div className="u14m-race-chips">
              {raceSummaries.map((race) => {
                const filled = raceRequests.filter((request) => request.raceCode === race.code && ["confirmed", "waiting-parent", "overdue", "to-retain"].includes(getU14ChildStage(request, now).key)).length;
                return (
                  <button
                    key={race.code}
                    className={`u14m-chip${!normalizedSearch && selectedRace.code === race.code ? " u14m-chip--active" : ""}`}
                    type="button"
                    onClick={() => {
                      setSelectedRaceCode(race.code);
                      setSearch("");
                    }}
                  >
                    {race.label.replace(" - ", " · ")} <span className="parent-request-note">{filled}/{race.totalPlaces}</span>
                  </button>
                );
              })}
            </div>
            <input aria-label="Rechercher un enfant" className="u14m-search" placeholder="Rechercher un enfant, un club, un dossard…" value={search} onChange={(event) => setSearch(event.target.value)} />
          </div>
          {normalizedSearch ? null : (
            <p className="parent-request-note">
              {selectedRace.label} : {selectedRace.totalPlaces} places · {selectedRace.protectedPlaces + selectedRace.confirmedGeneralRequests.length} prises
              {selectedRace.blockedPlaces ? ` · ${selectedRace.blockedPlaces} réservée(s) aux invités` : ""} · {selectedRace.remainingPlaces} libre(s) ·{" "}
              {selectedRace.waitlistedRequests.length} en attente
            </p>
          )}
          <ChildrenTable
            extraRows={reserveRows}
            invitesByRequestId={invitesByRequestId}
            isBusy={isBusy}
            now={now}
            renderAction={renderAction}
            rows={raceRows}
            onRelease={handleRelease}
          />
        </Panel>
      ) : null}

      {activeTab === "basket" ? (
        <Panel title="Porte-panier" subtitle="Les demandes porte-panier, sans limite de places automatique : vous retenez au cas par cas.">
          <ChildrenTable
            invitesByRequestId={invitesByRequestId}
            isBusy={isBusy}
            now={now}
            renderAction={renderAction}
            rows={basketRequests
              .map(withStage)
              .sort((left, right) => (U14_STAGE_ORDER[left.stage.key] ?? 9) - (U14_STAGE_ORDER[right.stage.key] ?? 9) || left.request.submittedAtMs - right.request.submittedAtMs)
              .map(({ request }, index) => ({ request, position: index + 1 }))}
            onRelease={handleRelease}
          />
          {raceRequests.some((request) => request.requestType === "preprogram_ou_porte_panier" && normalizeComparableValue(request.status) === "waitlisted") ? (
            <p className="parent-request-note">
              Accepteraient aussi le porte-panier (actuellement en liste d'attente d'une course) :{" "}
              {raceRequests
                .filter((request) => request.requestType === "preprogram_ou_porte_panier" && normalizeComparableValue(request.status) === "waitlisted")
                .map((request) => request.childName)
                .join(", ")}
              .
            </p>
          ) : null}
        </Panel>
      ) : null}

      {activeTab === "protected" ? (
        <U14ProtectedTab
          DataTable={DataTable}
          Panel={Panel}
          activeEditionId={activeEditionId}
          claimedByPool={claimedByPool}
          invites={protectedInvites}
          loadMailQueueModule={loadMailQueueModule}
          mailContext={mailContext}
          requestRecords={requestRecords}
          reserveByPool={reserveByPool}
          reserveReleased={reserveReleased}
          settings={protectedSettings}
        />
      ) : null}

      {activeTab === "mails" ? (
        <>
          <Panel title="Infos pratiques" subtitle="Ajoutées aux mails « retenu » et « tout est ok », et visibles par le parent dans « Mes enfants » une fois la place confirmée.">
            {practicalInfoError ? <p className="form-error">{practicalInfoError}</p> : null}
            {practicalInfoLoading ? <p className="panel-note">Chargement…</p> : null}
            <form className="profile-form" onSubmit={handleSavePracticalInfo}>
              <AuthFormField label="Courses U12 / U14">
                <textarea
                  rows="5"
                  value={(practicalDraft || { preprogram: preprogramPracticalInfo }).preprogram}
                  onChange={(event) => setPracticalDraft((current) => ({ porte_panier: basketPracticalInfo, ...current, preprogram: event.target.value }))}
                />
              </AuthFormField>
              <AuthFormField label="Porte-panier">
                <textarea
                  rows="5"
                  value={(practicalDraft || { porte_panier: basketPracticalInfo }).porte_panier}
                  onChange={(event) => setPracticalDraft((current) => ({ preprogram: preprogramPracticalInfo, ...current, porte_panier: event.target.value }))}
                />
              </AuthFormField>
              <div className="profile-form__actions">
                <button className="button button--primary" disabled={isBusy || !practicalDraft} type="submit">
                  Enregistrer les infos pratiques
                </button>
              </div>
            </form>
          </Panel>
          <Panel title="Mails envoyés aux familles" subtitle="Ce qui part, et quand. Tous les mails sont en français et en anglais.">
            <div className="u14m-mail-list">
              {U14_AUTOMATIC_MAILS.map((mail) => (
                <div key={mail.when} className="u14m-mail-row">
                  <strong>{mail.when}</strong>
                  <span>{mail.what}</span>
                </div>
              ))}
            </div>
          </Panel>
        </>
      ) : null}
    </div>
  );
}

export { U14Page };
