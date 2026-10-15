// Événements (porté de myFLA : app/communication/evenements/page.tsx et event-dialog.tsx).
import { useMemo, useState } from "react";
import { useAuth } from "../../context/auth-context";
import { createEvenement, createPublication, createTask, deleteEvenement, updateEvenement, updateTask } from "./com-actions.js";
import { useCommunicationTeam, useEvenements, useEventPublications, useTasks } from "./com-data.js";
import { fmtLong, fmtShort, todayYmd } from "./com-dates.js";
import { TASK_STATUT_LABELS } from "./com-domain.js";
import { pick, useComLang } from "./com-i18n.js";
import { NewPublicationDialog } from "./com-calendar-page.jsx";
import { TaskDialog } from "./com-tasks-page.jsx";
import { Avatar, ComPageHeader, Dialog, StatusPill, Toast } from "./com-ui.jsx";
import { useToast } from "./com-ui-helpers.js";

export function ComEventsPage() {
  const { currentUser } = useAuth();
  const uid = currentUser?.uid || "";
  const { lang, tr } = useComLang();
  const today = todayYmd();
  const events = useEvenements();
  const publications = useEventPublications();
  const tasks = useTasks();
  const team = useCommunicationTeam();
  const teamById = useMemo(() => new Map(team.map((u) => [u.uid, u])), [team]);
  const [editing, setEditing] = useState(null);
  const [newPubFor, setNewPubFor] = useState(null);
  const [newTaskFor, setNewTaskFor] = useState(null);
  const [showPast, setShowPast] = useState(false);
  const [toast, setToast] = useToast();

  async function run(action, success) {
    try {
      await action();
      if (success) setToast(success);
    } catch (error) {
      console.error(error);
      setToast(tr("L'enregistrement a échoué. Réessaie.", "Saving failed. Please try again."));
    }
  }

  const isPast = (e) => (e.dateFin || e.dateDebut) < today;
  const upcoming = events.filter((e) => !isPast(e));
  const past = events.filter(isPast).reverse();
  const shown = showPast ? [...upcoming, ...past] : upcoming;

  return (
    <>
      <ComPageHeader
        title={tr("Événements", "Events")}
        description={tr(
          "Un événement regroupe toutes les communications qui s'y rattachent (conférence de presse, annonce des athlètes, jour J…), avec les tâches de chacun.",
          "An event groups all the communications linked to it (press conference, athlete announcements, meet day…), along with everyone's tasks.",
        )}
        actions={
          <button type="button" className="button button--primary button--small" onClick={() => setEditing("new")}>
            {tr("+ Événement", "+ Event")}
          </button>
        }
      />

      {!shown.length ? (
        <p className="com-empty" style={{ textAlign: "center" }}>
          {tr(
            "Aucun événement à venir. Crée-en un pour regrouper ses publications et ses tâches.",
            "No upcoming events. Create one to group its publications and tasks.",
          )}
        </p>
      ) : (
        <div className="com-partner-grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 360px), 1fr))" }}>
          {shown.map((ev) => {
            const pubs = publications.filter((p) => p.eventId === ev.id).sort((a, b) => a.date.localeCompare(b.date));
            const evTasks = tasks.filter((t) => t.eventId === ev.id);
            const ready = pubs.filter((p) => p.statut === "done" || p.statut === "scheduled").length;
            const tasksDone = evTasks.filter((t) => t.statut === "done").length;
            return (
              <article key={ev.id} className="com-card com-stack" style={isPast(ev) ? { opacity: 0.75 } : undefined}>
                <div className="com-row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <p className="com-section-title" style={{ margin: 0 }}>
                      {fmtLong(ev.dateDebut, lang)}
                      {ev.dateFin && ev.dateFin !== ev.dateDebut ? ` → ${fmtShort(ev.dateFin, lang)}` : ""}
                      {ev.lieu ? ` · ${ev.lieu}` : ""}
                    </p>
                    <h2 style={{ margin: "2px 0 0", fontSize: "1.1rem" }}>{ev.titre}</h2>
                  </div>
                  <button type="button" className="com-btn-ghost" onClick={() => setEditing(ev)}>
                    {tr("Modifier", "Edit")}
                  </button>
                </div>

                <div className="com-stack" style={{ gap: 6 }}>
                  <span className="com-muted" style={{ fontSize: "0.78rem" }}>
                    {tr(
                      `${ready} / ${pubs.length} publications prêtes · ${tasksDone} / ${evTasks.length} tâches faites`,
                      `${ready} / ${pubs.length} publication${pubs.length > 1 ? "s" : ""} ready · ${tasksDone} / ${evTasks.length} task${evTasks.length > 1 ? "s" : ""} done`,
                    )}
                  </span>
                  <span className="com-progress">
                    <span style={{ width: pubs.length ? `${(ready / pubs.length) * 100}%` : "0%" }} />
                  </span>
                </div>

                <ul className="com-ob-items">
                  {pubs.map((p) => (
                    <li key={p.id}>
                      <span className="com-mini__date">{fmtShort(p.date, lang)}</span>
                      <span className="com-chip__title">{p.titre}</span>
                      <StatusPill statut={p.statut} />
                    </li>
                  ))}
                  {evTasks.map((t) => (
                    <li key={t.id}>
                      <span className="com-mini__date">{t.echeance ? fmtShort(t.echeance, lang) : "—"}</span>
                      <Avatar user={t.assigneUid ? teamById.get(t.assigneUid) : undefined} />
                      <span className="com-chip__title">{t.titre}</span>
                      <button
                        type="button"
                        className="com-btn-ghost"
                        style={{ padding: "2px 6px", fontSize: "0.75rem" }}
                        title={tr("Changer le statut", "Change status")}
                        onClick={() => run(() => updateTask(t.id, { statut: t.statut === "done" ? "todo" : t.statut === "todo" ? "doing" : "done" }))}
                      >
                        {pick(TASK_STATUT_LABELS[t.statut], lang)}
                      </button>
                    </li>
                  ))}
                  {!pubs.length && !evTasks.length ? <li className="com-muted">{tr("Rien de rattaché pour l'instant.", "Nothing linked yet.")}</li> : null}
                </ul>

                <div className="com-row">
                  <button type="button" className="button button--secondary button--small" onClick={() => setNewPubFor(ev)}>
                    + Publication
                  </button>
                  <button type="button" className="button button--secondary button--small" onClick={() => setNewTaskFor(ev)}>
                    {tr("+ Tâche", "+ Task")}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {past.length ? (
        <button type="button" className="com-btn-ghost" style={{ alignSelf: "flex-start" }} onClick={() => setShowPast((v) => !v)}>
          {showPast
            ? tr("Masquer les événements passés", "Hide past events")
            : tr(`Afficher les événements passés (${past.length})`, `Show past events (${past.length})`)}
        </button>
      ) : null}

      {editing ? (
        <EventDialog
          event={editing === "new" ? null : editing}
          defaultDate={today}
          onClose={() => setEditing(null)}
          onSave={async (data) => {
            if (editing === "new") await run(() => createEvenement(data, uid), tr("Événement créé", "Event created"));
            else await run(() => updateEvenement(editing.id, data), tr("Événement mis à jour", "Event updated"));
            setEditing(null);
          }}
          onDelete={
            editing === "new"
              ? undefined
              : async () => {
                  await run(() => deleteEvenement(editing.id), tr("Événement supprimé", "Event deleted"));
                  setEditing(null);
                }
          }
        />
      ) : null}

      {newPubFor ? (
        <NewPublicationDialog
          date={newPubFor.dateDebut}
          team={team}
          eventId={newPubFor.id}
          onClose={() => setNewPubFor(null)}
          onCreate={async (data) => {
            await run(() => createPublication({ ...data, statut: "todo", notes: "", eventId: newPubFor.id }, uid), tr("Publication ajoutée", "Publication added"));
            setNewPubFor(null);
          }}
        />
      ) : null}

      {newTaskFor ? (
        <TaskDialog
          task={null}
          preset={{ eventId: newTaskFor.id, echeance: newTaskFor.dateDebut }}
          team={team}
          events={events}
          onClose={() => setNewTaskFor(null)}
          onSave={async (data) => {
            await run(() => createTask(data, uid), tr("Tâche créée", "Task created"));
            setNewTaskFor(null);
          }}
        />
      ) : null}

      <Toast message={toast} />
    </>
  );
}

function EventDialog({ event, defaultDate, onClose, onSave, onDelete }) {
  const { tr } = useComLang();
  const [form, setForm] = useState(
    event
      ? { titre: event.titre, dateDebut: event.dateDebut, dateFin: event.dateFin || null, lieu: event.lieu || "", notes: event.notes || "" }
      : { titre: "", dateDebut: defaultDate, dateFin: null, lieu: "", notes: "" },
  );
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const endBeforeStart = Boolean(form.dateFin && form.dateFin < form.dateDebut);

  async function handleSubmit(e) {
    e.preventDefault();
    if (endBeforeStart) return;
    setSaving(true);
    try {
      await onSave({ ...form, titre: form.titre.trim(), lieu: form.lieu.trim(), dateFin: form.dateFin || null });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog title={event ? tr("Modifier l'événement", "Edit event") : tr("Nouvel événement", "New event")} onClose={onClose}>
      <form className="com-stack" onSubmit={handleSubmit}>
        <label className="com-field">
          {tr("Nom", "Name")}
          <input
            className="com-input"
            required
            autoFocus
            placeholder={tr("Ex. Conférence de presse du meeting", "e.g. Meet press conference")}
            value={form.titre}
            onChange={(e) => setForm({ ...form, titre: e.target.value })}
          />
        </label>
        <div className="com-grid-2">
          <label className="com-field">
            {tr("Date de début", "Start date")}
            <input type="date" className="com-input" required value={form.dateDebut} onChange={(e) => setForm({ ...form, dateDebut: e.target.value })} />
          </label>
          <label className="com-field">
            {tr("Date de fin (facultatif)", "End date (optional)")}
            <input type="date" className="com-input" value={form.dateFin || ""} onChange={(e) => setForm({ ...form, dateFin: e.target.value || null })} />
          </label>
        </div>
        {endBeforeStart ? <p className="com-error">{tr("La date de fin doit être après la date de début.", "The end date must be after the start date.")}</p> : null}
        <label className="com-field">
          {tr("Lieu", "Venue")}
          <input className="com-input" value={form.lieu} onChange={(e) => setForm({ ...form, lieu: e.target.value })} />
        </label>
        <label className="com-field">
          Notes
          <textarea className="com-input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </label>
        <div className="com-row" style={{ justifyContent: "space-between" }}>
          {onDelete ? (
            confirmDelete ? (
              <span className="com-row">
                {tr("Supprimer l'événement ? Ses publications et tâches restent.", "Delete this event? Its publications and tasks will be kept.")}
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
