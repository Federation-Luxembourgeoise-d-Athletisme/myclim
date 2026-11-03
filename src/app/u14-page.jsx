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
import { U14_STAGE_ORDER, getU14ChildStage } from "./u14-stage";
import { useU14AdminCopy } from "./u14-admin-copy";
import { U14ProtectedTab } from "./u14-protected-tab";
import { useActiveEdition } from "./edition";
import { useMeetingEditions } from "./meeting-history-hooks";
import { db } from "../services/firebase";

// Module Pré-programme U12 / U14 (équipe) : une page « À faire », un tableau
// par course avec un seul statut lisible, le porte-panier sur le même modèle,
// les places protégées et les textes envoyés aux familles. La répartition des
// places est automatique (ici à l'ouverture, et côté serveur à chaque
// nouvelle demande ou désistement) ; l'équipe ne fait que retenir, relancer
// ou libérer. Textes français / anglais : u14-admin-copy.js.
const U14_TABS = [
  { id: "todo", path: "/app/u14" },
  { id: "races", path: "/app/u14/courses" },
  { id: "basket", path: "/app/u14/porte-panier" },
  { id: "protected", path: "/app/u14/places-protegees" },
  { id: "mails", path: "/app/u14/infos-pratiques" },
];

function getTabFromPath(pathname) {
  const path = String(pathname || "").replace(/\/+$/, "");
  return U14_TABS.find((tab) => tab.id !== "todo" && path.endsWith(tab.path))?.id || "todo";
}

function StagePill({ stage }) {
  return (
    <span className={`u14m-status u14m-status--${stage.tone}`}>
      <span aria-hidden="true" className="u14m-status__dot" />
      {stage.label}
    </span>
  );
}

function initialsOf(request) {
  return `${(request.childFirstName || request.childName || "?")[0] || ""}${(request.childLastName || "")[0] || ""}`.toUpperCase();
}

// Fiche d'un enfant : coordonnées et historique de sa demande.
function ChildDetail({ request, invite, onRelease, isBusy, now }) {
  const { copy, fill } = useU14AdminCopy();
  const text = copy.detail;
  const child = request.child || {};
  const history = [
    [request.submittedAt, text.submitted],
    [invite?.claimedAt, text.claimed],
    [request.promotedFromWaitlistAt, text.promoted],
    [request.adminApprovedAt, text.approved],
    [request.remindedAt, request.reminderCount > 1 ? fill(text.remindedTotal, { count: request.reminderCount }) : text.reminded],
    [
      request.parentDecisionAt,
      normalizeComparableValue(request.parentDecisionStatus) === "declined"
        ? `${text.declined}${request.withdrawalReason ? ` — ${request.withdrawalReason}` : ""}`
        : text.confirmed,
    ],
  ]
    .filter(([value]) => getTimestampMs(value))
    .sort((left, right) => getTimestampMs(left[0]) - getTimestampMs(right[0]));
  const stage = getU14ChildStage(request, now, copy.stages);
  const canRelease = !["withdrawn", "rejected"].includes(stage.key);
  const facts = [
    [text.category, request.category],
    [text.birth, child.birthDate ? formatDateForDisplay(child.birthDate) : ""],
    [text.club, request.club],
    [text.bib, request.bibNumber],
  ].filter(([, value]) => value);

  return (
    <div className="u14m-detail">
      <section>
        <h4>{text.child}</h4>
        <dl className="u14m-facts">
          {facts.map(([label, value]) => (
            <Fragment key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </Fragment>
          ))}
        </dl>
        {request.notes ? <p className="u14m-note">« {request.notes} »</p> : null}
      </section>
      <section>
        <h4>{text.parent}</h4>
        <p className="u14m-strong">{request.parentName}</p>
        {request.parentEmail ? <a href={`mailto:${request.parentEmail}`}>{request.parentEmail}</a> : null}
      </section>
      <section>
        <h4>{text.history}</h4>
        {history.length ? (
          <ol className="u14m-timeline">
            {history.map(([value, label]) => (
              <li key={label}>
                <span className="u14m-timeline__date">{formatDateTimeForDisplay(value)}</span>
                <span>{label}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="u14m-muted">{text.noEvent}</p>
        )}
      </section>
      {canRelease ? (
        <div className="u14m-detail__footer">
          <button className="u14m-btn u14m-btn--danger" disabled={isBusy} type="button" onClick={() => onRelease(request)}>
            {text.release}
          </button>
        </div>
      ) : null}
    </div>
  );
}

// Tableau d'enfants (une course, le porte-panier ou « À faire ») : une ligne
// par enfant, un statut, une action. Les groupes donnent les sous-titres
// (Retenus, Places réservées, Liste d'attente, Désistés…).
function ChildrenTable({ groups, invitesByRequestId, renderAction, onRelease, isBusy, now, emptyLabel }) {
  const { copy, fill } = useU14AdminCopy();
  const [openId, setOpenId] = useState("");
  const visibleGroups = groups.filter((group) => group.rows.length || group.placeholder);

  return (
    <div className="u14m-table" role="table">
      <div className="u14m-row u14m-row--head" role="row">
        <span>{copy.table.position}</span>
        <span>{copy.table.child}</span>
        <span>{copy.table.stage}</span>
        <span className="u14m-actions">{copy.table.action}</span>
      </div>
      {visibleGroups.length ? null : <p className="u14m-empty">{emptyLabel || copy.table.empty}</p>}
      {visibleGroups.map((group) => (
        <Fragment key={group.key}>
          {group.title ? (
            <div className="u14m-group" role="row">
              <span>{group.title}</span>
              <span className="u14m-group__count">{group.count ?? group.rows.length}</span>
            </div>
          ) : null}
          {group.placeholder}
          {group.rows.map(({ request, position, tag }) => {
            const stage = getU14ChildStage(request, now, copy.stages);
            const isOpen = openId === request.id;
            const invite = invitesByRequestId.get(request.id);
            const isInactive = stage.key === "withdrawn" || stage.key === "rejected";
            return (
              <Fragment key={request.id}>
                <div className={`u14m-row${isInactive ? " u14m-row--muted" : ""}${isOpen ? " u14m-row--open" : ""}`} role="row">
                  <span className="u14m-position">{position}</span>
                  <button aria-expanded={isOpen} className="u14m-child" type="button" onClick={() => setOpenId(isOpen ? "" : request.id)}>
                    <span aria-hidden="true" className="u14m-avatar">{initialsOf(request)}</span>
                    <span className="u14m-child__text">
                      <span className="u14m-child__name">
                        {request.childName}
                        {invite ? <span className="u14m-tag u14m-tag--accent">{copy.table.invited}</span> : null}
                        {request.requestType === "preprogram_ou_porte_panier" ? <span className="u14m-tag">{copy.table.alsoBasket}</span> : null}
                      </span>
                      <span className="u14m-child__meta">
                        {[tag, request.club, request.bibNumber ? fill(copy.table.bib, { bib: request.bibNumber }) : ""].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                  </button>
                  <span className="u14m-stage">
                    <StagePill stage={stage} />
                    {stage.detail ? <span className="u14m-stage__detail">{stage.detail}</span> : null}
                  </span>
                  <span className="u14m-actions">{renderAction(request, stage)}</span>
                </div>
                {isOpen ? <ChildDetail invite={invite} isBusy={isBusy} now={now} request={request} onRelease={onRelease} /> : null}
              </Fragment>
            );
          })}
        </Fragment>
      ))}
    </div>
  );
}

function U14Page(props) {
  const { AuthFormField, Panel, DataTable, doc, loadMailQueueModule, serverTimestamp, setDoc, syncU14RaceAllocations, updateDoc } = props;
  const { copy, fill, raceLabel } = useU14AdminCopy();
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
    if (dataLoading || !pendingSyncKey || lastSyncKey.current === pendingSyncKey) return;
    lastSyncKey.current = pendingSyncKey;
    syncU14RaceAllocations({ requests, children, protectedInvites, protectedSettings }).catch((error) =>
      console.error("Automatic U14 allocation failed", error),
    );
  }, [children, dataLoading, pendingSyncKey, protectedInvites, protectedSettings, requests, syncU14RaceAllocations]);

  const stageOf = (request) => getU14ChildStage(request, now, copy.stages);
  const raceRequests = requestRecords.filter((request) => request.requestType !== "porte_panier" && request.raceCode);
  const basketRequests = requestRecords.filter((request) => request.requestType === "porte_panier");
  const withStage = (request) => ({ request, stage: stageOf(request) });
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
      fill(copy.messages.retained, { name: request.childName }),
      copy.messages.retainFailed,
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
      fill(copy.messages.reminded, { name: request.childName }),
      copy.messages.remindFailed,
    );
  }

  // Retirer un enfant (délai dépassé, demande de la famille…) : même effet
  // qu'un désistement ; la liste d'attente avance toute seule. Le motif
  // enregistré reste en français (historique de l'équipe).
  function handleRelease(request) {
    if (!window.confirm(fill(copy.messages.releaseConfirm, { name: request.childName }))) {
      return undefined;
    }
    return runAction(
      async () => {
        const declinedFields = {
          status: "declined",
          parentDecisionStatus: "declined",
          withdrawalReason:
            stageOf(request).key === "overdue" ? "Délai de confirmation dépassé (libéré par l'organisation)" : "Retiré par l'organisation",
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
      fill(copy.messages.released, { name: request.childName }),
      copy.messages.releaseFailed,
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
      copy.messages.practicalSaved,
      copy.messages.practicalFailed,
    );
  }

  function renderAction(request, stage) {
    if (stage.key === "to-retain") {
      return (
        <button className="u14m-btn u14m-btn--primary" disabled={isBusy} type="button" onClick={() => handleRetain(request)}>
          {copy.actions.retain}
        </button>
      );
    }
    if (stage.key === "to-decide") {
      return (
        <button className="u14m-btn u14m-btn--primary" disabled={isBusy} type="button" onClick={() => handleRetain(request)}>
          {copy.actions.retainBasket}
        </button>
      );
    }
    if (stage.key === "overdue") {
      return (
        <>
          <button className="u14m-btn" disabled={isBusy} type="button" onClick={() => handleRemind(request)}>
            {copy.actions.remind}
          </button>
          <button className="u14m-btn u14m-btn--danger" disabled={isBusy} type="button" onClick={() => handleRelease(request)}>
            {copy.actions.release}
          </button>
        </>
      );
    }
    if (stage.key === "waiting-parent") {
      return (
        <button className="u14m-btn" disabled={isBusy} type="button" onClick={() => handleRemind(request)}>
          {copy.actions.remind}
        </button>
      );
    }
    return null;
  }

  // ── Tableau d'une course ──
  const normalizedSearch = normalizeComparableValue(search);
  const selectedRace = raceSummaries.find((race) => race.code === selectedRaceCode) || raceSummaries[0];
  const RETAINED_STAGES = ["confirmed", "waiting-parent", "overdue", "to-retain", "received"];
  const byStageThenPosition = (left, right) => {
    const order = (U14_STAGE_ORDER[left.stage.key] ?? 9) - (U14_STAGE_ORDER[right.stage.key] ?? 9);
    if (order) return order;
    const leftPosition = Number(left.request.acceptedPosition || left.request.waitlistPosition || 0);
    const rightPosition = Number(right.request.acceptedPosition || right.request.waitlistPosition || 0);
    return leftPosition - rightPosition || left.request.submittedAtMs - right.request.submittedAtMs;
  };
  const raceEntries = raceRequests
    .filter((request) =>
      normalizedSearch
        ? normalizeComparableValue([request.childName, request.club, request.bibNumber, request.parentName].join(" ")).includes(normalizedSearch)
        : request.raceCode === selectedRace.code,
    )
    .map(withStage)
    .sort(byStageThenPosition);
  const searchTag = (request) => (normalizedSearch ? raceLabel(request.raceLabel) : "");
  const raceGroups = [
    {
      key: "retained",
      title: copy.races.groupRetained,
      rows: raceEntries
        .filter(({ stage }) => RETAINED_STAGES.includes(stage.key))
        .map(({ request }, index) => ({ request, position: index + 1, tag: searchTag(request) })),
    },
    {
      key: "reserve",
      title: copy.races.groupReserve,
      count: !normalizedSearch ? selectedRace.blockedPlaces : 0,
      rows: [],
      placeholder:
        !normalizedSearch && selectedRace.blockedPlaces ? (
          <div className="u14m-row u14m-row--reserve" role="row">
            <span className="u14m-position">—</span>
            <span className="u14m-reserve-text">
              {selectedRace.blockedPlaces > 1 ? fill(copy.races.reserveMany, { count: selectedRace.blockedPlaces }) : copy.races.reserveOne}
            </span>
            <span className="u14m-stage__detail">
              {protectedSettings.deadline ? fill(copy.races.reserveUntil, { date: formatDateForDisplay(protectedSettings.deadline) }) : copy.races.reserveUntilDeadline}
            </span>
            <span />
          </div>
        ) : null,
    },
    {
      key: "waitlist",
      title: copy.races.groupWaitlist,
      rows: raceEntries
        .filter(({ stage }) => stage.key === "waitlist")
        .map(({ request }) => ({ request, position: `A${request.waitlistPosition || "?"}`, tag: searchTag(request) })),
    },
    {
      key: "inactive",
      title: copy.races.groupInactive,
      rows: raceEntries
        .filter(({ stage }) => ["withdrawn", "rejected"].includes(stage.key))
        .map(({ request }) => ({ request, position: "—", tag: searchTag(request) })),
    },
  ];

  const todoGroups = [
    {
      key: "overdue",
      title: copy.todo.groupOverdue,
      rows: overdue.map(({ request }, index) => ({
        request,
        position: index + 1,
        tag: request.requestType === "porte_panier" ? copy.todo.basketTag : raceLabel(request.raceLabel),
      })),
    },
    {
      key: "retain",
      title: copy.todo.groupRetain,
      rows: toRetain.map(({ request }, index) => ({ request, position: index + 1, tag: raceLabel(request.raceLabel) })),
    },
    {
      key: "basket",
      title: copy.todo.groupBasket,
      rows: basketToDecide.map(({ request }, index) => ({ request, position: index + 1, tag: copy.todo.basketTag })),
    },
  ];

  const basketEntries = basketRequests.map(withStage).sort(byStageThenPosition);
  const basketGroups = [
    {
      key: "active",
      title: "",
      rows: basketEntries
        .filter(({ stage }) => !["withdrawn", "rejected"].includes(stage.key))
        .map(({ request }, index) => ({ request, position: index + 1 })),
    },
    {
      key: "inactive",
      title: copy.basket.groupInactive,
      rows: basketEntries.filter(({ stage }) => ["withdrawn", "rejected"].includes(stage.key)).map(({ request }) => ({ request, position: "—" })),
    },
  ];
  const basketAlternatives = raceRequests.filter(
    (request) => request.requestType === "preprogram_ou_porte_panier" && normalizeComparableValue(request.status) === "waitlisted",
  );

  const tableProps = { invitesByRequestId, isBusy, now, renderAction, onRelease: handleRelease };

  return (
    <div className="page u14m-page">
      <section className="page-header">
        <div>
          <p className="eyebrow">{copy.eyebrow}</p>
          <h1>{copy.title}</h1>
          <p>{copy.intro}</p>
        </div>
      </section>

      {requestsError || childrenError || invitesError ? <p className="status-note">{requestsError || childrenError || invitesError}</p> : null}
      {statusMessage ? <p className="panel-note panel-note--success">{statusMessage}</p> : null}
      {errorMessage ? <p className="form-error">{errorMessage}</p> : null}
      {dataLoading ? <p className="status-note">{copy.loading}</p> : null}

      <nav aria-label={copy.navLabel} className="u14m-tabs" role="tablist">
        {U14_TABS.map((tab) => (
          <button
            key={tab.id}
            aria-selected={activeTab === tab.id}
            className={`u14m-tab${activeTab === tab.id ? " u14m-tab--active" : ""}`}
            role="tab"
            type="button"
            onClick={() => navigate(tab.path)}
          >
            {copy.tabs[tab.id]}
            {tab.id === "todo" && todoCount ? <span className="u14m-tab__badge">{todoCount}</span> : null}
            {tab.id === "basket" && basketRequests.length ? <span className="u14m-tab__count">{basketRequests.length}</span> : null}
          </button>
        ))}
      </nav>

      {activeTab === "todo" ? (
        <>
          <section className="u14m-kpis">
            <div className="u14m-kpi">
              <span>{copy.todo.kpiRetain}</span>
              <strong>{toRetain.length}</strong>
              <small>{promotedCount ? fill(copy.todo.kpiRetainPromoted, { count: promotedCount }) : copy.todo.kpiRetainNone}</small>
            </div>
            <div className={`u14m-kpi${overdue.length ? " u14m-kpi--alert" : ""}`}>
              <span>{copy.todo.kpiOverdue}</span>
              <strong>{overdue.length}</strong>
              <small>{copy.todo.kpiOverdueDetail}</small>
            </div>
            <div className="u14m-kpi">
              <span>{copy.todo.kpiBasket}</span>
              <strong>{basketToDecide.length}</strong>
              <small>{copy.todo.kpiBasketDetail}</small>
            </div>
            <div className="u14m-kpi">
              <span>{copy.todo.kpiConfirmed}</span>
              <strong>{requestRecords.filter((request) => stageOf(request).key === "confirmed").length}</strong>
              <small>{copy.todo.kpiConfirmedDetail}</small>
            </div>
          </section>
          <Panel title={copy.todo.title} subtitle={copy.todo.subtitle}>
            <ChildrenTable {...tableProps} emptyLabel={copy.todo.empty} groups={todoGroups} />
          </Panel>
        </>
      ) : null}

      {activeTab === "races" ? (
        <Panel title={copy.races.title} subtitle={copy.races.subtitle}>
          <div className="u14m-race-grid">
            {raceSummaries.map((race) => {
              const filled = raceRequests.filter((request) => request.raceCode === race.code && RETAINED_STAGES.includes(stageOf(request).key)).length;
              const total = race.totalPlaces || 14;
              const isActive = !normalizedSearch && selectedRace.code === race.code;
              return (
                <button
                  key={race.code}
                  aria-pressed={isActive}
                  className={`u14m-race${isActive ? " u14m-race--active" : ""}`}
                  type="button"
                  onClick={() => {
                    setSelectedRaceCode(race.code);
                    setSearch("");
                  }}
                >
                  <span className="u14m-race__head">
                    <span className="u14m-race__name">{raceLabel(race.label).replace(" - ", " · ")}</span>
                    <span className="u14m-race__count">
                      {filled}<span>/{total}</span>
                    </span>
                  </span>
                  <span aria-hidden="true" className="u14m-bar">
                    <span className="u14m-bar__filled" style={{ width: `${Math.min((filled / total) * 100, 100)}%` }} />
                    <span className="u14m-bar__reserved" style={{ width: `${Math.min((race.blockedPlaces / total) * 100, 100)}%` }} />
                  </span>
                  <span className="u14m-race__meta">
                    {race.blockedPlaces ? fill(copy.races.reservedShort, { count: race.blockedPlaces }) : ""}
                    {race.waitlistedRequests.length
                      ? fill(copy.races.waiting, { count: race.waitlistedRequests.length })
                      : fill(copy.races.free, { count: race.remainingPlaces })}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="u14m-toolbar">
            <h3 className="u14m-toolbar__title">{normalizedSearch ? copy.races.searchResults : raceLabel(selectedRace.label)}</h3>
            <input
              aria-label={copy.races.searchLabel}
              className="u14m-search"
              placeholder={copy.races.searchPlaceholder}
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <ChildrenTable {...tableProps} emptyLabel={normalizedSearch ? copy.races.emptySearch : copy.races.emptyRace} groups={raceGroups} />
        </Panel>
      ) : null}

      {activeTab === "basket" ? (
        <Panel title={copy.basket.title} subtitle={copy.basket.subtitle}>
          <ChildrenTable {...tableProps} emptyLabel={copy.basket.empty} groups={basketGroups} />
          {basketAlternatives.length ? (
            <p className="u14m-footnote">{fill(copy.basket.alternatives, { names: basketAlternatives.map((request) => request.childName).join(", ") })}</p>
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
          <Panel title={copy.mails.practicalTitle} subtitle={copy.mails.practicalSubtitle}>
            {practicalInfoError ? <p className="form-error">{practicalInfoError}</p> : null}
            {practicalInfoLoading ? <p className="panel-note">{copy.mails.loading}</p> : null}
            <form className="profile-form" onSubmit={handleSavePracticalInfo}>
              <AuthFormField label={copy.mails.practicalRaces}>
                <textarea
                  rows="5"
                  value={(practicalDraft || { preprogram: preprogramPracticalInfo }).preprogram}
                  onChange={(event) => setPracticalDraft((current) => ({ porte_panier: basketPracticalInfo, ...current, preprogram: event.target.value }))}
                />
              </AuthFormField>
              <AuthFormField label={copy.mails.practicalBasket}>
                <textarea
                  rows="5"
                  value={(practicalDraft || { porte_panier: basketPracticalInfo }).porte_panier}
                  onChange={(event) => setPracticalDraft((current) => ({ preprogram: preprogramPracticalInfo, ...current, porte_panier: event.target.value }))}
                />
              </AuthFormField>
              <div className="profile-form__actions">
                <button className="button button--primary" disabled={isBusy || !practicalDraft} type="submit">
                  {copy.mails.save}
                </button>
              </div>
            </form>
          </Panel>
          <Panel title={copy.mails.listTitle} subtitle={copy.mails.listSubtitle}>
            <div className="u14m-mail-list">
              {copy.mails.list.map(([when, what]) => (
                <div key={when} className="u14m-mail-row">
                  <strong>{when}</strong>
                  <span>{what}</span>
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
