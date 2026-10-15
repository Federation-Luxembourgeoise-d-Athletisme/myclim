// Tâches de l'équipe (porté de myFLA : app/communication/taches/page.tsx et task-dialog.tsx).
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../context/auth-context";
import { createTask, deleteTask, sendValidation, updateTask } from "./com-actions.js";
import { memberName, useCommunicationTeam, useEvenements, usePendingValidations, usePublications, useRubriques, useTasks } from "./com-data.js";
import { addDays, fmtShort, todayYmd, ymd } from "./com-dates.js";
import { TASK_STATUTS, TASK_STATUT_LABELS } from "./com-domain.js";
import { pick, useComLang } from "./com-i18n.js";
import { buildCalendarItems } from "./com-recurrence.js";
import { Avatar, Dialog, StatusPill, Toast, TypeTag, ValidationBadge } from "./com-ui.jsx";
import { useToast } from "./com-ui-helpers.js";

const calendarLink = (item) => `/app/communication?pub=${encodeURIComponent(item.id)}&date=${item.date}`;

export function ComTasksPage() {
  const { currentUser } = useAuth();
  const uid = currentUser?.uid || "";
  const { lang, tr } = useComLang();
  const today = todayYmd();
  const horizon = ymd(addDays(new Date(), 21));
  const [scope, setScope] = useState("moi");
  const [editing, setEditing] = useState(null);
  const [toast, setToast] = useToast();

  const tasks = useTasks();
  const team = useCommunicationTeam();
  const events = useEvenements();
  const { rubriques } = useRubriques();
  const publications = usePublications(today, horizon);
  const toValidate = usePendingValidations(uid);
  const teamById = useMemo(() => new Map(team.map((u) => [u.uid, u])), [team]);
  const eventById = useMemo(() => new Map(events.map((e) => [e.id, e])), [events]);
  const mine = scope === "moi";

  const visible = tasks.filter((t) => !mine || t.assigneUid === uid);
  const upcoming = useMemo(
    () =>
      buildCalendarItems({ rubriques, publications, start: today, end: horizon, today }).filter(
        (i) => i.statut !== "done" && (!mine || i.assigneUids.includes(uid)),
      ),
    [rubriques, publications, today, horizon, mine, uid],
  );

  async function run(action, success) {
    try {
      await action();
      if (success) setToast(success);
    } catch (error) {
      console.error(error);
      setToast(error?.message || tr("L'enregistrement a échoué. Réessaie.", "Saving failed. Please try again."));
    }
  }

  const move = (task, delta) => {
    const next = TASK_STATUTS[TASK_STATUTS.indexOf(task.statut) + delta];
    if (next) run(() => updateTask(task.id, { statut: next }));
  };

  return (
    <>
      <div className="com-page-header">
        <h1>{mine ? tr("Mes tâches", "My tasks") : tr("Tâches de l'équipe", "Team tasks")}</h1>
        <div className="com-row">
          <div className="com-segmented">
            <button type="button" className={mine ? "is-on" : ""} onClick={() => setScope("moi")}>
              {tr("Mes tâches", "My tasks")}
            </button>
            <button type="button" className={!mine ? "is-on" : ""} onClick={() => setScope("equipe")}>
              {tr("Toute l'équipe", "Whole team")}
            </button>
          </div>
          <button type="button" className="button button--primary button--small" onClick={() => setEditing("new")}>
            {tr("+ Tâche", "+ Task")}
          </button>
        </div>
      </div>

      {toValidate.length ? (
        <section className="com-stack" style={{ gap: 8 }}>
          <h2 className="com-section-title">
            {tr("À valider", "To approve")} <span className="com-nav__badge">{toValidate.length}</span>
          </h2>
          <div className="com-list" style={{ borderColor: "#f4c35a" }}>
            {toValidate.map((p) => {
              const last = [...(p.validation?.history || [])].reverse().find((entry) => entry.action === "demande");
              const by = p.validation ? teamById.get(p.validation.demandeePar) : undefined;
              return (
                <div key={p.id} className="com-list__day" style={{ gridTemplateColumns: "72px minmax(0, 1fr) auto", alignItems: "center" }}>
                  <strong>{fmtShort(p.date, lang)}</strong>
                  <Link to={`/app/communication/publication/${p.id}`} className="com-stack" style={{ gap: 2, color: "inherit", textDecoration: "none" }}>
                    <b>{p.titre}</b>
                    <span className="com-muted" style={{ fontSize: "0.78rem" }}>
                      {tr("Demandé par", "Requested by")} {by ? memberName(by) : last?.nom || "?"}
                      {last?.message ? (lang === "fr" ? ` · « ${last.message} »` : ` · “${last.message}”`) : ""}
                    </span>
                  </Link>
                  <span className="com-row">
                    <button
                      type="button"
                      className="button button--secondary button--small"
                      aria-label={tr(`Valider « ${p.titre} »`, `Approve “${p.titre}”`)}
                      title={tr("Valider (ouvre la fiche pour ajouter un commentaire)", "Approve (open the publication to add a comment)")}
                      onClick={() => run(() => sendValidation(p.id, "validee", "", undefined, lang), tr("Publication validée 👍", "Publication approved 👍"))}
                    >
                      👍
                    </button>
                    <button
                      type="button"
                      className="button button--danger-soft button--small"
                      aria-label={tr(`À revoir : « ${p.titre} »`, `Request changes: “${p.titre}”`)}
                      title={tr("À revoir (ouvre la fiche pour ajouter un commentaire)", "Request changes (open the publication to add a comment)")}
                      onClick={() => run(() => sendValidation(p.id, "a_revoir", "", undefined, lang), tr("Renvoyée pour corrections 👎", "Sent back for changes 👎"))}
                    >
                      👎
                    </button>
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      <div className="com-kanban">
        {TASK_STATUTS.map((statut, col) => {
          const list = visible.filter((t) => t.statut === statut);
          return (
            <section key={statut} className="com-kanban__col">
              <div className="com-row" style={{ justifyContent: "space-between" }}>
                <h2 className="com-section-title" style={{ margin: 0 }}>
                  {pick(TASK_STATUT_LABELS[statut], lang)}
                </h2>
                <span className="com-muted">{list.length}</span>
              </div>
              {list.map((task) => {
                const late = task.statut !== "done" && task.echeance && task.echeance < today;
                const ev = task.eventId ? eventById.get(task.eventId) : undefined;
                return (
                  <article key={task.id} className={`com-task ${late ? "is-late" : ""}`}>
                    <button type="button" className="com-btn-ghost" style={{ padding: 0, textAlign: "left", color: "inherit", fontWeight: 700 }} onClick={() => setEditing(task)}>
                      {task.titre}
                    </button>
                    {ev ? <span className="com-muted" style={{ fontSize: "0.75rem" }}>◆ {ev.titre}</span> : null}
                    <div className="com-row" style={{ justifyContent: "space-between" }}>
                      <span className="com-row">
                        <Avatar user={task.assigneUid ? teamById.get(task.assigneUid) : undefined} />
                        <span className="com-task__due">
                          {task.echeance
                            ? `${late ? tr("En retard · ", "Overdue · ") : tr("Pour le ", "Due ")}${fmtShort(task.echeance, lang)}`
                            : tr("Sans échéance", "No due date")}
                        </span>
                      </span>
                      <span className="com-row" style={{ gap: 4 }}>
                        {col > 0 ? (
                          <button type="button" className="com-toggle" aria-label={tr("Reculer", "Move back")} onClick={() => move(task, -1)}>
                            ←
                          </button>
                        ) : null}
                        {col < TASK_STATUTS.length - 1 ? (
                          <button type="button" className="com-toggle" aria-label={tr("Avancer", "Move forward")} onClick={() => move(task, 1)}>
                            →
                          </button>
                        ) : null}
                      </span>
                    </div>
                  </article>
                );
              })}
              {!list.length ? <p className="com-muted">{tr("Aucune tâche.", "No tasks.")}</p> : null}
            </section>
          );
        })}
      </div>

      <h2 className="com-section-title">{tr("Publications à produire · 3 prochaines semaines", "Publications to produce · next 3 weeks")}</h2>
      <div className="com-list">
        {!upcoming.length ? (
          <p className="com-muted" style={{ padding: 24, textAlign: "center" }}>
            {mine
              ? tr("Aucune publication ne t'est assignée sur cette période.", "No publications assigned to you in this period.")
              : tr("Rien à produire sur cette période.", "Nothing to produce in this period.")}
          </p>
        ) : (
          upcoming.map((item) => (
            <Link
              key={item.id}
              to={calendarLink(item)}
              className="com-list__day"
              style={{ gridTemplateColumns: "72px minmax(0, 1fr) auto", alignItems: "center", color: "inherit", textDecoration: "none" }}
            >
              <strong>{fmtShort(item.date, lang)}</strong>
              <span className="com-stack" style={{ gap: 2 }}>
                <b>{item.titre}</b>
                <span className="com-list__meta">
                  <TypeTag type={item.type} />
                  {item.rubriqueId ? tr("↻ récurrent", "↻ recurring") : null}
                  {!mine && !item.assigneUids.length ? <span style={{ color: "#9f2020" }}>{tr("Personne d'assigné", "Nobody assigned")}</span> : null}
                  <ValidationBadge validation={item.validation} />
                </span>
              </span>
              <StatusPill statut={item.statut} />
            </Link>
          ))
        )}
      </div>

      {editing ? (
        <TaskDialog
          task={editing === "new" ? null : editing}
          preset={{ assigneUid: uid }}
          team={team}
          events={events}
          onClose={() => setEditing(null)}
          onSave={async (data) => {
            if (editing === "new") await run(() => createTask(data, uid), tr("Tâche créée", "Task created"));
            else await run(() => updateTask(editing.id, data), tr("Tâche mise à jour", "Task updated"));
            setEditing(null);
          }}
          onDelete={
            editing === "new"
              ? undefined
              : async () => {
                  await run(() => deleteTask(editing.id), tr("Tâche supprimée", "Task deleted"));
                  setEditing(null);
                }
          }
        />
      ) : null}

      <Toast message={toast} />
    </>
  );
}

export function TaskDialog({ task, preset = {}, team, events, onClose, onSave, onDelete }) {
  const { lang, tr } = useComLang();
  const [form, setForm] = useState(
    task
      ? { titre: task.titre, assigneUid: task.assigneUid || null, echeance: task.echeance || null, statut: task.statut || "todo", eventId: task.eventId || null, notes: task.notes || "" }
      : { titre: "", assigneUid: null, echeance: null, statut: "todo", eventId: null, notes: "", ...preset },
  );
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setSaving(true);
    try {
      await onSave({ ...form, titre: form.titre.trim() });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog title={task ? tr("Modifier la tâche", "Edit task") : tr("Nouvelle tâche", "New task")} onClose={onClose}>
      <form className="com-stack" onSubmit={handleSubmit}>
        <label className="com-field">
          {tr("Tâche", "Task")}
          <input
            className="com-input"
            required
            autoFocus
            maxLength={300}
            placeholder={tr("Ex. Préparer les visuels du compte à rebours", "e.g. Prepare the countdown visuals")}
            value={form.titre}
            onChange={(e) => setForm({ ...form, titre: e.target.value })}
          />
        </label>
        <div className="com-grid-2">
          <label className="com-field">
            {tr("Pour", "Assigned to")}
            <select className="com-input" value={form.assigneUid || ""} onChange={(e) => setForm({ ...form, assigneUid: e.target.value || null })}>
              <option value="">{tr("Personne pour l'instant", "Nobody yet")}</option>
              {team.map((u) => (
                <option key={u.uid} value={u.uid}>
                  {memberName(u)}
                </option>
              ))}
            </select>
          </label>
          <label className="com-field">
            {tr("Échéance", "Due date")}
            <input type="date" className="com-input" value={form.echeance || ""} onChange={(e) => setForm({ ...form, echeance: e.target.value || null })} />
          </label>
          <label className="com-field">
            {tr("Statut", "Status")}
            <select className="com-input" value={form.statut} onChange={(e) => setForm({ ...form, statut: e.target.value })}>
              {TASK_STATUTS.map((s) => (
                <option key={s} value={s}>
                  {pick(TASK_STATUT_LABELS[s], lang)}
                </option>
              ))}
            </select>
          </label>
          <label className="com-field">
            {tr("Événement", "Event")}
            <select className="com-input" value={form.eventId || ""} onChange={(e) => setForm({ ...form, eventId: e.target.value || null })}>
              <option value="">{tr("Aucun", "None")}</option>
              {events.map((ev) => (
                <option key={ev.id} value={ev.id}>
                  {ev.titre}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="com-field">
          Notes
          <textarea className="com-input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </label>
        <div className="com-row" style={{ justifyContent: "space-between" }}>
          {onDelete ? (
            confirmDelete ? (
              <span className="com-row">
                {tr("Supprimer la tâche ?", "Delete this task?")}
                <button type="button" className="button button--danger-soft button--small" onClick={onDelete}>
                  {tr("Confirmer", "Confirm")}
                </button>
                <button type="button" className="com-btn-ghost" onClick={() => setConfirmDelete(false)}>
                  {tr("Garder", "Keep")}
                </button>
              </span>
            ) : (
              <button type="button" className="button button--danger-soft button--small" onClick={() => setConfirmDelete(true)}>
                {tr("Supprimer", "Delete")}
              </button>
            )
          ) : (
            <span />
          )}
          <div className="com-row">
            <button type="button" className="com-btn-ghost" onClick={onClose}>
              {tr("Annuler", "Cancel")}
            </button>
            <button type="submit" className="button button--primary button--small" disabled={saving}>
              {saving ? tr("Enregistrement…", "Saving…") : tr("Enregistrer", "Save")}
            </button>
          </div>
        </div>
      </form>
    </Dialog>
  );
}
