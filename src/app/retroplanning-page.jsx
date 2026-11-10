import { useMemo, useState } from "react";
import { addDoc, collection, deleteDoc, doc, serverTimestamp, updateDoc, writeBatch } from "firebase/firestore";
import { db } from "../services/firebase";
import { useAuth } from "../context/auth-context";
import { useSiteEditionYear } from "./edition";
import { useMeetingEditions } from "./meeting-history-hooks";
import { getActiveRoles } from "./navigation";
import { MEETING_TASKS, useMeetingTasks, useMyOrganisationTeams, useOrganisationTeams } from "./organisation-hooks";
import { findOrganisationTeam, getPerimeterEmails, getPerimeterNames } from "./organisation-teams";
import legacyPlanning2026 from "./planning-2026-legacy.json";
import {
  TASK_STATUSES,
  daysFromMeeting,
  formatDMinus,
  groupTasksByMonth,
  importLegacyTasks,
  isTaskLate,
  summarizeTasks,
  toYmd,
} from "./retroplanning";

// Pilotage › Rétroplanning : les tâches et échéances de l'organisation
// (feuille « Tasks » du fichier « Task and Organisation »), avec responsable
// et statut. Décisions de Margot du 09/11/2026 (voir retroplanning.js).

function todayYmd() {
  return toYmd(new Date(Date.UTC(new Date().getFullYear(), new Date().getMonth(), new Date().getDate())));
}

function formatDeadline(ymd) {
  const match = String(ymd || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return "—";
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).toLocaleDateString("fr-FR", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

const EMPTY_TASK = { deadline: "", perimeter: [], action: "", ownerName: "", status: "todo" };

export function RetroplanningPage() {
  const { currentUser, userProfile } = useAuth();
  const roles = getActiveRoles(userProfile);
  const isManager = roles.includes("admin") || roles.includes("gestionnaire");
  const { siteEditionYear, loading: yearLoading } = useSiteEditionYear();
  const { editions } = useMeetingEditions();
  const year = Number(siteEditionYear || editions[0]?.year) || null;
  const edition = editions.find((item) => Number(item.year || item.id) === year) || null;
  const meetingDate = String(edition?.date || "").slice(0, 10);
  const { teams: orgTeams } = useOrganisationTeams(isManager);
  const { tasks, loading, error } = useMeetingTasks({ year, isManager, email: currentUser?.email });
  // Un gestionnaire membre d'équipes (étudiants LUNEX) voit d'abord les tâches
  // de ses équipes ; « Mes équipes » se décoche pour tout voir.
  const { teams: myTeams } = useMyOrganisationTeams(currentUser?.email, isManager);
  const [mineChoice, setMineChoice] = useState(null);
  const mineOnly = isManager && myTeams.length > 0 && (mineChoice ?? !roles.includes("admin"));
  const today = todayYmd();

  const [search, setSearch] = useState("");
  const [perimeterFilter, setPerimeterFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("open");
  const [lateOnly, setLateOnly] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [form, setForm] = useState(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const orgTeamById = useMemo(() => new Map(orgTeams.map((team) => [team.id, team])), [orgTeams]);
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return tasks.filter((task) => {
      if (mineOnly && !task.perimeter.some((id) => myTeams.some((team) => team.id === id))) return false;
      if (perimeterFilter && !task.perimeter.includes(perimeterFilter)) return false;
      if (statusFilter === "open" && task.status === "done") return false;
      if (statusFilter && statusFilter !== "open" && task.status !== statusFilter) return false;
      if (lateOnly && !isTaskLate(task, today)) return false;
      if (needle && !`${task.action} ${task.ownerName}`.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [tasks, mineOnly, myTeams, perimeterFilter, statusFilter, lateOnly, search, today]);
  const groups = useMemo(() => groupTasksByMonth(filtered), [filtered]);
  const summary = useMemo(() => summarizeTasks(tasks, today), [tasks, today]);
  const nextGroupKey = groups.find((group) => group.tasks.some((task) => task.deadline >= today))?.key;

  // Les noms viennent des équipes (gestionnaires) ou de la copie sur la tâche.
  function perimeterLabel(task) {
    const names = task.perimeter.map((id) => orgTeamById.get(id)?.name).filter(Boolean);
    return names.length ? names : task.perimeterNames;
  }

  function openTask(task) {
    setSelectedId(task.id);
    setForm({ ...task });
  }

  function openNew() {
    setSelectedId("new");
    setForm({ ...EMPTY_TASK, deadline: today });
  }

  async function run(action, success) {
    setBusy(true);
    setMessage("");
    try {
      await action();
      if (success) setMessage(success);
    } catch (runError) {
      console.error(runError);
      setMessage("L'enregistrement a échoué. Réessayez dans un instant.");
    } finally {
      setBusy(false);
    }
  }

  async function saveForm(event) {
    event.preventDefault();
    if (!form.action.trim()) return;
    const payload = {
      editionYear: year,
      deadline: form.deadline,
      perimeter: form.perimeter,
      action: form.action.trim(),
      ownerName: form.ownerName.trim(),
      status: form.status,
      perimeterEmails: getPerimeterEmails(orgTeams, form.perimeter),
      perimeterNames: getPerimeterNames(orgTeams, form.perimeter),
      updatedAt: serverTimestamp(),
    };
    await run(async () => {
      if (selectedId === "new") {
        const created = await addDoc(collection(db, MEETING_TASKS), { ...payload, createdAt: serverTimestamp() });
        setSelectedId(created.id);
      } else {
        await updateDoc(doc(db, MEETING_TASKS, selectedId), payload);
      }
    }, "Tâche enregistrée.");
  }

  function setStatus(task, status) {
    run(() => updateDoc(doc(db, MEETING_TASKS, task.id), { status, updatedAt: serverTimestamp() }));
    if (task.id === selectedId) setForm((current) => (current ? { ...current, status } : current));
  }

  async function importLastYear() {
    if (!meetingDate) return;
    const rows = importLegacyTasks(legacyPlanning2026.tasks, { meetingDate, editionYear: year, orgTeams, findOrgTeam: findOrganisationTeam });
    if (!window.confirm(`Importer ${rows.length} tâches de l'an dernier, avec des échéances recalculées depuis le meeting du ${formatDeadline(meetingDate)} ?`)) return;
    await run(async () => {
      for (let index = 0; index < rows.length; index += 400) {
        const batch = writeBatch(db);
        rows.slice(index, index + 400).forEach((row) =>
          batch.set(doc(collection(db, MEETING_TASKS)), {
            ...row,
            perimeterEmails: getPerimeterEmails(orgTeams, row.perimeter),
            perimeterNames: getPerimeterNames(orgTeams, row.perimeter),
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          }),
        );
        await batch.commit();
      }
    }, `${rows.length} tâches importées.`);
  }

  if (yearLoading || loading) return <p className="mdp-status">Chargement du rétroplanning…</p>;
  if (!year) return <p className="mdp-status">Choisissez d'abord l'édition affichée dans Site web › Édition.</p>;
  if (error) return <p className="mdp-status mdp-status--error">{error}</p>;

  if (!tasks.length && isManager && !form) {
    return (
      <section className="mdp-empty">
        <h3>Rétroplanning {year}</h3>
        <p>
          Les tâches et échéances de l'organisation, avec le J-x par rapport au meeting, le périmètre (équipes de
          l'organisation), un responsable et un statut. Partez de l'an dernier (feuille « Tasks » du fichier « Task and
          Organisation ») : les échéances sont recalculées depuis la date du meeting.
        </p>
        {!meetingDate ? (
          <p className="mdp-status mdp-status--error">Renseignez d'abord la date du meeting {year} dans Site web › Édition.</p>
        ) : null}
        {!orgTeams.length ? (
          <p className="mdp-muted">Astuce : créez d'abord les équipes de l'organisation (Équipes & affectations) pour retrouver les périmètres.</p>
        ) : null}
        <div className="mdp-empty__actions">
          <button className="button button--primary" disabled={!meetingDate || busy} type="button" onClick={importLastYear}>
            Importer les tâches de l'an dernier
          </button>
          <button className="button button--secondary" type="button" onClick={openNew}>
            Ajouter une tâche
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="rp">
      <div className="rp-summary">
        <span>
          <strong>{summary.total}</strong> tâches
        </span>
        <span>{summary.todo} à faire</span>
        <span>{summary.doing} en cours</span>
        <span className="rp-summary__done">{summary.done} faites</span>
        {summary.late ? <span className="rp-summary__late">{summary.late} en retard</span> : null}
        {meetingDate ? <span className="rp-summary__date">Meeting : {formatDeadline(meetingDate)}</span> : null}
        {!isManager ? <span className="rp-summary__date">Tâches de vos équipes</span> : null}
      </div>

      <div className="ath-sheet">
        <div className="ath-toolbar">
          <input className="ath-filter ath-filter--search" placeholder="Rechercher une action, un responsable…" value={search} onChange={(event) => setSearch(event.target.value)} />
          {isManager ? (
            <select className="ath-filter" value={perimeterFilter} onChange={(event) => setPerimeterFilter(event.target.value)}>
              <option value="">Périmètre</option>
              {orgTeams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
          ) : null}
          <select className="ath-filter" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="open">À faire + en cours</option>
            <option value="">Tous les statuts</option>
            {TASK_STATUSES.map((status) => (
              <option key={status.value} value={status.value}>
                {status.label}
              </option>
            ))}
          </select>
          <label className="ath-check">
            <input checked={lateOnly} type="checkbox" onChange={(event) => setLateOnly(event.target.checked)} />
            En retard seulement
          </label>
          {isManager && myTeams.length ? (
            <label className="ath-check" title={myTeams.map((team) => team.name).join(", ")}>
              <input checked={mineOnly} type="checkbox" onChange={(event) => setMineChoice(event.target.checked)} />
              Mes équipes
            </label>
          ) : null}
          <span className="ath-toolbar__spacer" />
          <span className="ath-toolbar__count">{filtered.length} affichées</span>
          {isManager ? (
            <button className="ath-btn ath-btn--primary" type="button" onClick={openNew}>
              + Tâche
            </button>
          ) : null}
        </div>

        <div className="rp-body">
          <div className="table-wrap rp-tablewrap">
            <table className="data-table data-table--sheet rp-table">
              <thead>
                <tr>
                  <th>Échéance</th>
                  <th className="rp-num">J-x</th>
                  <th>Périmètre</th>
                  <th>Action</th>
                  <th>Responsable</th>
                  <th>Statut</th>
                </tr>
              </thead>
              {groups.length === 0 ? (
                <tbody>
                  <tr>
                    <td className="orgt-muted" colSpan={6}>
                      Aucune tâche avec ces filtres.
                    </td>
                  </tr>
                </tbody>
              ) : null}
              {groups.map((group) => (
                <tbody key={group.key}>
                  <tr className="rp-month">
                    <td colSpan={6}>
                      {group.label}
                      {group.key === nextGroupKey ? <span className="rp-month__now">à venir</span> : null}
                      <small>{group.tasks.length}</small>
                    </td>
                  </tr>
                  {group.tasks.map((task) => {
                    const late = isTaskLate(task, today);
                    const dMinus = daysFromMeeting(task.deadline, meetingDate);
                    return (
                      <tr
                        key={task.id}
                        className={[
                          late ? "rp-row--late" : "",
                          task.status === "done" ? "rp-row--done" : "",
                          task.id === selectedId ? "orgt-row--active" : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        onClick={() => isManager && openTask(task)}
                      >
                        <td className="rp-date">
                          {formatDeadline(task.deadline)}
                          {late ? <span className="rp-late">en retard</span> : null}
                        </td>
                        <td className="rp-num">{formatDMinus(dMinus)}</td>
                        <td className="rp-perimeter">
                          {perimeterLabel(task).map((name) => (
                            <span key={name} className="ath-tag">
                              {name}
                            </span>
                          ))}
                        </td>
                        <td className="rp-action">{task.action}</td>
                        <td>{task.ownerName || <span className="orgt-muted">—</span>}</td>
                        <td onClick={(event) => event.stopPropagation()}>
                          <select
                            aria-label="Statut"
                            className={`rp-status rp-status--${task.status}`}
                            value={task.status}
                            onChange={(event) => setStatus(task, event.target.value)}
                          >
                            {TASK_STATUSES.map((status) => (
                              <option key={status.value} value={status.value}>
                                {status.label}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              ))}
            </table>
          </div>

          {isManager && form ? (
            <form className="mdp-panel rp-panel" onSubmit={saveForm}>
              <h3>{selectedId === "new" ? "Nouvelle tâche" : "Tâche"}</h3>
              <label className="mdp-field">
                <span>Action</span>
                <textarea required rows="3" value={form.action} onChange={(event) => setForm({ ...form, action: event.target.value })} />
              </label>
              <div className="mdp-field-row">
                <label className="mdp-field">
                  <span>Échéance</span>
                  <input type="date" value={form.deadline} onChange={(event) => setForm({ ...form, deadline: event.target.value })} />
                </label>
                <label className="mdp-field">
                  <span>J-x</span>
                  <input readOnly value={formatDMinus(daysFromMeeting(form.deadline, meetingDate)) || "—"} />
                </label>
              </div>
              <div className="mdp-field-row">
                <label className="mdp-field">
                  <span>Responsable</span>
                  <input value={form.ownerName} onChange={(event) => setForm({ ...form, ownerName: event.target.value })} />
                </label>
                <label className="mdp-field">
                  <span>Statut</span>
                  <select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}>
                    {TASK_STATUSES.map((status) => (
                      <option key={status.value} value={status.value}>
                        {status.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="mdp-field">
                <span>Périmètre (équipes de l'organisation)</span>
                <div className="mdp-collist rp-perimeter-list">
                  {orgTeams.length === 0 ? <p className="mdp-muted">Créez les équipes dans Équipes & affectations › Équipes organisation.</p> : null}
                  {orgTeams.map((team) => (
                    <label key={team.id}>
                      <input
                        checked={form.perimeter.includes(team.id)}
                        type="checkbox"
                        onChange={(event) =>
                          setForm({
                            ...form,
                            perimeter: event.target.checked ? [...form.perimeter, team.id] : form.perimeter.filter((id) => id !== team.id),
                          })
                        }
                      />
                      {team.name}
                    </label>
                  ))}
                </div>
              </div>
              {message ? <p className="mdp-muted">{message}</p> : null}
              <div className="mdp-panel__actions">
                <button className="mdp-btn mdp-btn--primary" disabled={busy} type="submit">
                  Enregistrer
                </button>
                {selectedId !== "new" ? (
                  <button
                    className="mdp-btn mdp-btn--danger"
                    disabled={busy}
                    type="button"
                    onClick={() => {
                      if (!window.confirm(`Supprimer la tâche « ${form.action} » ?`)) return;
                      run(() => deleteDoc(doc(db, MEETING_TASKS, selectedId)), "Tâche supprimée.");
                      setSelectedId("");
                      setForm(null);
                    }}
                  >
                    Supprimer
                  </button>
                ) : null}
                <button
                  className="mdp-btn mdp-panel__close"
                  type="button"
                  onClick={() => {
                    setSelectedId("");
                    setForm(null);
                  }}
                >
                  Fermer
                </button>
              </div>
            </form>
          ) : null}
        </div>
      </div>
    </section>
  );
}
