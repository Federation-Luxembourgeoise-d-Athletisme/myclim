// Tâches de l'équipe (porté de myFLA : app/communication/taches/page.tsx et task-dialog.tsx).
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../context/auth-context";
import { createTask, deleteTask, sendValidation, updateTask } from "./com-actions.js";
import { memberName, useCommunicationTeam, useEvenements, usePendingValidations, usePublications, useRubriques, useTasks } from "./com-data.js";
import { addDays, fmtShort, todayYmd, ymd } from "./com-dates.js";
import { TASK_STATUTS, TASK_STATUT_LABELS } from "./com-domain.js";
import { buildCalendarItems } from "./com-recurrence.js";
import { Avatar, Dialog, StatusPill, Toast, TypeTag, ValidationBadge } from "./com-ui.jsx";
import { useToast } from "./com-ui-helpers.js";

const calendarLink = (item) => `/app/communication?pub=${encodeURIComponent(item.id)}&date=${item.date}`;

export function ComTasksPage() {
  const { currentUser } = useAuth();
  const uid = currentUser?.uid || "";
  const today = todayYmd();
  const horizon = ymd(addDays(new Date(), 21));
  const [scope, setScope] = useState("equipe");
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
      setToast(error?.message || "L'enregistrement a échoué. Réessaie.");
    }
  }

  const move = (task, delta) => {
    const next = TASK_STATUTS[TASK_STATUTS.indexOf(task.statut) + delta];
    if (next) run(() => updateTask(task.id, { statut: next }));
  };

  return (
    <>
      <div className="com-page-header">
        <h1>{mine ? "Mes tâches" : "Tâches de l'équipe"}</h1>
        <div className="com-row">
          <div className="com-segmented">
            <button type="button" className={!mine ? "is-on" : ""} onClick={() => setScope("equipe")}>
              Toute l'équipe
            </button>
            <button type="button" className={mine ? "is-on" : ""} onClick={() => setScope("moi")}>
              Mes tâches
            </button>
          </div>
          <button type="button" className="button button--primary button--small" onClick={() => setEditing("new")}>
            + Tâche
          </button>
        </div>
      </div>

      {toValidate.length ? (
        <section className="com-stack" style={{ gap: 8 }}>
          <h2 className="com-section-title">
            À valider <span className="com-nav__badge">{toValidate.length}</span>
          </h2>
          <div className="com-list" style={{ borderColor: "#f4c35a" }}>
            {toValidate.map((p) => {
              const last = [...(p.validation?.history || [])].reverse().find((entry) => entry.action === "demande");
              const by = p.validation ? teamById.get(p.validation.demandeePar) : undefined;
              return (
                <div key={p.id} className="com-list__day" style={{ gridTemplateColumns: "72px minmax(0, 1fr) auto", alignItems: "center" }}>
                  <strong>{fmtShort(p.date)}</strong>
                  <Link to={`/app/communication/publication/${p.id}`} className="com-stack" style={{ gap: 2, color: "inherit", textDecoration: "none" }}>
                    <b>{p.titre}</b>
                    <span className="com-muted" style={{ fontSize: "0.78rem" }}>
                      Demandé par {by ? memberName(by) : last?.nom || "?"}
                      {last?.message ? ` · « ${last.message} »` : ""}
                    </span>
                  </Link>
                  <span className="com-row">
                    <button
                      type="button"
                      className="button button--secondary button--small"
                      aria-label={`Valider « ${p.titre} »`}
                      title="Valider (ouvre la fiche pour ajouter un commentaire)"
                      onClick={() => run(() => sendValidation(p.id, "validee", ""), "Publication validée 👍")}
                    >
                      👍
                    </button>
                    <button
                      type="button"
                      className="button button--danger-soft button--small"
                      aria-label={`À revoir : « ${p.titre} »`}
                      title="À revoir (ouvre la fiche pour ajouter un commentaire)"
                      onClick={() => run(() => sendValidation(p.id, "a_revoir", ""), "Renvoyée pour corrections 👎")}
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
                  {TASK_STATUT_LABELS[statut]}
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
                          {task.echeance ? `${late ? "En retard · " : "Pour le "}${fmtShort(task.echeance)}` : "Sans échéance"}
                        </span>
                      </span>
                      <span className="com-row" style={{ gap: 4 }}>
                        {col > 0 ? (
                          <button type="button" className="com-toggle" aria-label="Reculer" onClick={() => move(task, -1)}>
                            ←
                          </button>
                        ) : null}
                        {col < TASK_STATUTS.length - 1 ? (
                          <button type="button" className="com-toggle" aria-label="Avancer" onClick={() => move(task, 1)}>
                            →
                          </button>
                        ) : null}
                      </span>
                    </div>
                  </article>
                );
              })}
              {!list.length ? <p className="com-muted">Aucune tâche.</p> : null}
            </section>
          );
        })}
      </div>

      <h2 className="com-section-title">Publications à produire · 3 prochaines semaines</h2>
      <div className="com-list">
        {!upcoming.length ? (
          <p className="com-muted" style={{ padding: 24, textAlign: "center" }}>
            {mine ? "Aucune publication ne t'est assignée sur cette période." : "Rien à produire sur cette période."}
          </p>
        ) : (
          upcoming.map((item) => (
            <Link
              key={item.id}
              to={calendarLink(item)}
              className="com-list__day"
              style={{ gridTemplateColumns: "72px minmax(0, 1fr) auto", alignItems: "center", color: "inherit", textDecoration: "none" }}
            >
              <strong>{fmtShort(item.date)}</strong>
              <span className="com-stack" style={{ gap: 2 }}>
                <b>{item.titre}</b>
                <span className="com-list__meta">
                  <TypeTag type={item.type} />
                  {item.rubriqueId ? "↻ récurrent" : null}
                  {!mine && !item.assigneUids.length ? <span style={{ color: "#9f2020" }}>Personne d'assigné</span> : null}
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
            if (editing === "new") await run(() => createTask(data, uid), "Tâche créée");
            else await run(() => updateTask(editing.id, data), "Tâche mise à jour");
            setEditing(null);
          }}
          onDelete={
            editing === "new"
              ? undefined
              : async () => {
                  await run(() => deleteTask(editing.id), "Tâche supprimée");
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
    <Dialog title={task ? "Modifier la tâche" : "Nouvelle tâche"} onClose={onClose}>
      <form className="com-stack" onSubmit={handleSubmit}>
        <label className="com-field">
          Tâche
          <input className="com-input" required autoFocus maxLength={300} placeholder="Ex. Préparer les visuels du compte à rebours" value={form.titre} onChange={(e) => setForm({ ...form, titre: e.target.value })} />
        </label>
        <div className="com-grid-2">
          <label className="com-field">
            Pour
            <select className="com-input" value={form.assigneUid || ""} onChange={(e) => setForm({ ...form, assigneUid: e.target.value || null })}>
              <option value="">Personne pour l'instant</option>
              {team.map((u) => (
                <option key={u.uid} value={u.uid}>
                  {memberName(u)}
                </option>
              ))}
            </select>
          </label>
          <label className="com-field">
            Échéance
            <input type="date" className="com-input" value={form.echeance || ""} onChange={(e) => setForm({ ...form, echeance: e.target.value || null })} />
          </label>
          <label className="com-field">
            Statut
            <select className="com-input" value={form.statut} onChange={(e) => setForm({ ...form, statut: e.target.value })}>
              {TASK_STATUTS.map((s) => (
                <option key={s} value={s}>
                  {TASK_STATUT_LABELS[s]}
                </option>
              ))}
            </select>
          </label>
          <label className="com-field">
            Événement
            <select className="com-input" value={form.eventId || ""} onChange={(e) => setForm({ ...form, eventId: e.target.value || null })}>
              <option value="">Aucun</option>
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
                Supprimer la tâche ?
                <button type="button" className="button button--danger-soft button--small" onClick={onDelete}>
                  Confirmer
                </button>
                <button type="button" className="com-btn-ghost" onClick={() => setConfirmDelete(false)}>
                  Garder
                </button>
              </span>
            ) : (
              <button type="button" className="button button--danger-soft button--small" onClick={() => setConfirmDelete(true)}>
                Supprimer
              </button>
            )
          ) : (
            <span />
          )}
          <div className="com-row">
            <button type="button" className="com-btn-ghost" onClick={onClose}>
              Annuler
            </button>
            <button type="submit" className="button button--primary button--small" disabled={saving}>
              {saving ? "Enregistrement…" : "Enregistrer"}
            </button>
          </div>
        </div>
      </form>
    </Dialog>
  );
}
