import { Fragment, useEffect, useMemo, useState } from "react";
import { collection, deleteDoc, doc, onSnapshot, query, serverTimestamp, setDoc, updateDoc, where, writeBatch } from "firebase/firestore";
import { db } from "../services/firebase";
import { useAuth } from "../context/auth-context";

import { useActiveEdition } from "./edition";
import { useTr } from "./use-tr";
import { useLanguage } from "./language-context";
import { useCollapsedState } from "./collapsible-state";
import {
  CELEBRITY_GENDERS,
  CELEBRITY_RACES,
  CELEBRITY_RACE_STARTER_LIST,
  CELEBRITY_STATUSES,
  applyFollowUpDone,
  applyStatusChange,
  getCelebrityDisplayName,
  getCelebrityStatus,
  getFollowUpDate,
  isFollowUpDue,
  normalizeCelebrityContact,
  sortCelebrityContacts,
  summarizeCelebrityRace,
} from "./celebrity-race-helpers";
import "./business-race.css";
import "./celebrity-race.css";

const COLLECTION = "celebrityRaceContacts";

function todayIso() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function formatShortDate(isoDate, language) {
  if (!isoDate) return "";
  const date = new Date(isoDate.length === 10 ? `${isoDate}T12:00:00` : isoDate);
  if (Number.isNaN(date.getTime())) return isoDate;
  return date.toLocaleDateString(language === "fr" ? "fr-LU" : "en-GB", { day: "numeric", month: "short" });
}

function formatDateTime(isoDate, language) {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return isoDate;
  return date.toLocaleString(language === "fr" ? "fr-LU" : "en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

// Champs enregistrés (sans id) : ce que les règles et la page relisent.
function toStored(contact) {
  const clean = normalizeCelebrityContact(contact);
  return { ...clean, updatedAt: serverTimestamp() };
}

function emptyDraft(race = "influencer", gender = "women") {
  return normalizeCelebrityContact({ race, gender });
}

function StatusChip({ statusId }) {
  const tr = useTr();
  const status = getCelebrityStatus(statusId);
  return <span className={`cr-status cr-status--${status.tone}`}>{tr(status.fr, status.en)}</span>;
}

function ContactEditor({ draft, onChange, onSubmit, onCancel, onDelete, saving, isNew }) {
  const tr = useTr();
  const set = (field) => (event) => onChange({ ...draft, [field]: event.target.value });
  const hasName = Boolean(draft.firstName || draft.lastName || draft.alias);
  return (
    <form
      className="cr-editor"
      onSubmit={(event) => {
        event.preventDefault();
        if (hasName) onSubmit();
      }}
    >
      <div className="cr-editor__grid">
        <label className="br-field">
          <span>{tr("Course", "Race")}</span>
          <select value={draft.race} onChange={set("race")}>
            {CELEBRITY_RACES.map((race) => <option key={race.id} value={race.id}>{tr(race.fr, race.en)}</option>)}
          </select>
        </label>
        <label className="br-field">
          <span>{tr("Catégorie", "Category")}</span>
          <select value={draft.gender} onChange={set("gender")}>
            {CELEBRITY_GENDERS.map((gender) => <option key={gender.id} value={gender.id}>{tr(gender.fr, gender.en)}</option>)}
          </select>
        </label>
        <label className="br-field">
          <span>{tr("Prénom", "First name")}</span>
          <input value={draft.firstName} onChange={set("firstName")} autoFocus={isNew} />
        </label>
        <label className="br-field">
          <span>{tr("Nom", "Last name")}</span>
          <input value={draft.lastName} onChange={set("lastName")} />
        </label>
        <label className="br-field">
          <span>{tr("Pseudo / compte", "Handle / account")}</span>
          <input value={draft.alias} onChange={set("alias")} placeholder="@…" />
        </label>
        <label className="br-field">
          <span>{tr("Statut", "Status")}</span>
          <select value={draft.status} onChange={set("status")}>
            {CELEBRITY_STATUSES.map((status) => <option key={status.id} value={status.id}>{tr(status.fr, status.en)}</option>)}
          </select>
        </label>
        <label className="br-field cr-editor__wide">
          <span>{tr("Contact (e-mail, téléphone, agent, DM…)", "Contact (email, phone, agent, DM…)")}</span>
          <input value={draft.contact} onChange={set("contact")} />
        </label>
        <label className="br-field">
          <span>{tr("Suivi par", "Handled by")}</span>
          <input value={draft.owner} onChange={set("owner")} />
        </label>
        <label className="br-field">
          <span>{tr("Demandé le", "Asked on")}</span>
          <input type="date" value={draft.askedAt} onChange={set("askedAt")} />
        </label>
        <label className="br-field">
          <span>{tr("Relancer le", "Follow up on")}</span>
          <input type="date" value={draft.followUpAt} onChange={set("followUpAt")} />
        </label>
        <label className="br-field cr-editor__full">
          <span>{tr("Notes", "Notes")}</span>
          <textarea rows={2} value={draft.notes} onChange={set("notes")} />
        </label>
      </div>
      <div className="br-form__bar">
        {onDelete ? (
          <button type="button" className="br-btn br-btn--ghost cr-danger" onClick={onDelete} disabled={saving}>
            {tr("Supprimer", "Delete")}
          </button>
        ) : null}
        <span className="br-toolbar__spacer" />
        <button type="button" className="br-btn" onClick={onCancel}>{tr("Annuler", "Cancel")}</button>
        <button type="submit" className="br-btn br-btn--primary" disabled={saving || !hasName}>
          {isNew ? tr("Ajouter", "Add") : tr("Enregistrer", "Save")}
        </button>
      </div>
    </form>
  );
}

function ContactJournal({ contact, onAddNote, saving }) {
  const tr = useTr();
  const { language } = useLanguage();
  const [note, setNote] = useState("");
  const entries = [...contact.history].reverse();
  return (
    <div className="cr-journal">
      <h4>{tr("Suivi de la demande", "Request log")}</h4>
      <form
        className="cr-journal__add"
        onSubmit={(event) => {
          event.preventDefault();
          if (!note.trim()) return;
          onAddNote(note);
          setNote("");
        }}
      >
        <input value={note} onChange={(event) => setNote(event.target.value)} placeholder={tr("Ajouter une note (appel, message, réponse…)", "Add a note (call, message, answer…)")} />
        <button type="submit" className="br-btn br-btn--small" disabled={saving || !note.trim()}>{tr("Noter", "Add")}</button>
      </form>
      {entries.length ? (
        <ol className="cr-journal__list">
          {entries.map((entry, index) => (
            <li key={`${entry.at}-${index}`}>
              <time>{formatDateTime(entry.at, language)}</time>
              {entry.status ? <StatusChip statusId={entry.status} /> : null}
              {entry.note ? <span>{entry.note}</span> : null}
              {entry.by ? <small>· {entry.by}</small> : null}
            </li>
          ))}
        </ol>
      ) : (
        <p className="br-muted">{tr("Rien de noté pour l'instant.", "Nothing logged yet.")}</p>
      )}
    </div>
  );
}

function CelebrityRacePage() {
  const tr = useTr();
  const { language } = useLanguage();
  const { userProfile } = useAuth();
  const { activeEditionId, activeEditionLabel } = useActiveEdition(true);
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [flash, setFlash] = useState("");
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState("");
  const [editDraft, setEditDraft] = useState(null);
  const [newDraft, setNewDraft] = useState(null);
  const [collapsed, toggleCollapsed] = useCollapsedState("celebrity-race-collapsed");
  const today = todayIso();
  const by = [userProfile?.firstName, userProfile?.lastName].filter(Boolean).join(" ") || userProfile?.email || "";

  useEffect(() => {
    if (!activeEditionId) return undefined;
    setLoading(true);
    return onSnapshot(
      query(collection(db, COLLECTION), where("editionId", "==", activeEditionId)),
      (snapshot) => {
        setContacts(snapshot.docs.map((entry) => ({ id: entry.id, ...normalizeCelebrityContact(entry.data()) })));
        setLoading(false);
      },
      (snapshotError) => {
        setError(snapshotError.message || tr("Lecture impossible.", "Could not load."));
        setLoading(false);
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeEditionId]);

  useEffect(() => {
    if (!flash) return undefined;
    const timer = window.setTimeout(() => setFlash(""), 3000);
    return () => window.clearTimeout(timer);
  }, [flash]);

  const summaries = useMemo(
    () => Object.fromEntries(CELEBRITY_RACES.map((race) => [race.id, summarizeCelebrityRace(contacts, race.id, today)])),
    [contacts, today],
  );
  const followUpTotal = summaries.influencer.followUpDue + summaries.athlete.followUpDue;
  const waitingTotal = summaries.influencer.waiting + summaries.athlete.waiting;

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return contacts.filter((contact) => {
      if (filter === "followUp" && !isFollowUpDue(contact, today)) return false;
      if (filter === "waiting" && !["asked", "no_reply", "to_confirm"].includes(contact.status)) return false;
      if (filter === "confirmed" && contact.status !== "confirmed") return false;
      if (filter === "idea" && contact.status !== "idea") return false;
      if (!needle) return true;
      return [contact.firstName, contact.lastName, contact.alias, contact.owner, contact.contact, contact.notes]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [contacts, filter, search, today]);

  async function run(action, message) {
    setSaving(true);
    setError("");
    try {
      await action();
      if (message) setFlash(message);
      return true;
    } catch (actionError) {
      setError(actionError.message || tr("Enregistrement impossible.", "Could not save."));
      return false;
    } finally {
      setSaving(false);
    }
  }

  function saveContact(contact) {
    const { id, ...rest } = contact;
    return updateDoc(doc(db, COLLECTION, id), toStored(rest));
  }

  function changeStatus(contact, nextStatus) {
    const next = applyStatusChange(contact, nextStatus, { todayIso: today, nowIso: new Date().toISOString(), by });
    if (next === contact) return;
    run(() => saveContact(next));
  }

  function markFollowUpDone(contact) {
    const next = applyFollowUpDone(contact, { todayIso: today, nowIso: new Date().toISOString(), by, note: tr("Relancé", "Followed up") });
    run(() => saveContact(next), tr(`Relance notée pour ${getCelebrityDisplayName(contact)}.`, `Follow-up logged for ${getCelebrityDisplayName(contact)}.`));
  }

  function addNote(contact, note) {
    const next = { ...contact, history: [...contact.history, { at: new Date().toISOString(), status: "", note: note.trim(), by }] };
    run(() => saveContact(next));
  }

  function openRow(contact) {
    if (openId === contact.id) {
      setOpenId("");
      setEditDraft(null);
      return;
    }
    setOpenId(contact.id);
    setEditDraft(normalizeCelebrityContact(contact));
  }

  async function submitEdit(contact) {
    // Statut changé dans le formulaire : on passe par le journal comme en ligne.
    let next = { ...editDraft, history: contact.history };
    if (editDraft.status !== contact.status) {
      next = applyStatusChange({ ...next, status: contact.status }, editDraft.status, {
        todayIso: today,
        nowIso: new Date().toISOString(),
        by,
      });
      if (editDraft.askedAt) next.askedAt = editDraft.askedAt;
      if (editDraft.followUpAt && ["asked", "no_reply", "to_confirm"].includes(editDraft.status)) next.followUpAt = editDraft.followUpAt;
    }
    const ok = await run(() => saveContact({ id: contact.id, ...next }), tr("Fiche enregistrée.", "Saved."));
    if (ok) {
      setOpenId("");
      setEditDraft(null);
    }
  }

  async function removeContact(contact) {
    const name = getCelebrityDisplayName(contact);
    if (!window.confirm(tr(`Supprimer ${name} de la liste ? Le suivi de la demande sera perdu.`, `Remove ${name} from the list? The request log will be lost.`))) return;
    const ok = await run(() => deleteDoc(doc(db, COLLECTION, contact.id)), tr(`${name} retiré(e).`, `${name} removed.`));
    if (ok) {
      setOpenId("");
      setEditDraft(null);
    }
  }

  async function submitNew() {
    const nowIso = new Date().toISOString();
    const base = normalizeCelebrityContact(newDraft);
    const contact = {
      ...base,
      askedAt: base.askedAt || (base.status !== "idea" ? today : ""),
      history: [{ at: nowIso, status: base.status, note: "", by }],
    };
    const ref = doc(collection(db, COLLECTION));
    const ok = await run(
      () => setDoc(ref, { ...toStored(contact), editionId: activeEditionId, createdAt: serverTimestamp() }),
      tr(`${getCelebrityDisplayName(contact)} ajouté(e).`, `${getCelebrityDisplayName(contact)} added.`),
    );
    if (ok) setNewDraft(null);
  }

  function importStarterList() {
    const nowIso = new Date().toISOString();
    run(async () => {
      const batch = writeBatch(db);
      CELEBRITY_RACE_STARTER_LIST.forEach((entry) => {
        const contact = normalizeCelebrityContact(entry);
        batch.set(doc(collection(db, COLLECTION)), {
          ...toStored({ ...contact, history: [{ at: nowIso, status: contact.status, note: "", by }] }),
          editionId: activeEditionId,
          createdAt: serverTimestamp(),
        });
      });
      await batch.commit();
    }, tr("Liste de départ importée.", "Starter list imported."));
  }

  const filters = [
    ["all", tr("Tous", "All"), contacts.length],
    ["followUp", tr("À relancer", "Follow up"), followUpTotal],
    ["waiting", tr("En attente", "Waiting"), waitingTotal],
    ["idea", tr("À demander", "To ask"), summaries.influencer.toAsk + summaries.athlete.toAsk],
    ["confirmed", tr("Confirmés", "Confirmed"), summaries.influencer.confirmed + summaries.athlete.confirmed],
  ];

  return (
    <div className="page br-admin cr-page">
      <header className="br-admin-head">
        <div>
          <p className="eyebrow">{tr("Pré-programme", "Pre-programme")}{activeEditionLabel ? ` · ${activeEditionLabel}` : ""}</p>
          <h1>Influencer vs Athletes Race</h1>
        </div>
        <dl className="br-kpis">
          {CELEBRITY_RACES.map((race) => (
            <div key={race.id}>
              <dt>{tr(race.fr, race.en)}</dt>
              <dd>
                {summaries[race.id].confirmed}
                <small> {tr("confirmés", "confirmed")} · {tr("F", "W")} {summaries[race.id].byGender.women} / {tr("H", "M")} {summaries[race.id].byGender.men}</small>
              </dd>
            </div>
          ))}
          <div>
            <dt>{tr("En attente", "Waiting")}</dt>
            <dd>{waitingTotal}</dd>
          </div>
          <div className={followUpTotal ? "cr-kpi--warn" : ""}>
            <dt>{tr("À relancer", "Follow up")}</dt>
            <dd>{followUpTotal}</dd>
          </div>
        </dl>
      </header>

      {error ? <p className="form-error">{error}</p> : null}
      {flash ? <p className="br-flash">{flash}</p> : null}

      <div className="br-toolbar cr-toolbar">
        <div className="cr-filters" role="tablist">
          {filters.map(([id, label, count]) => (
            <button key={id} type="button" role="tab" aria-selected={filter === id} className={`cr-filter${filter === id ? " is-active" : ""}`} onClick={() => setFilter(id)}>
              {label} <span>{count}</span>
            </button>
          ))}
        </div>
        <span className="br-toolbar__spacer" />
        <input className="cr-search" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={tr("Rechercher…", "Search…")} />
        <button type="button" className="br-btn br-btn--primary" onClick={() => setNewDraft(newDraft ? null : emptyDraft())}>
          + {tr("Ajouter une personne", "Add a person")}
        </button>
      </div>

      {newDraft ? (
        <section className="br-panel">
          <header className="br-panel__head">
            <h3>{tr("Nouvelle personne", "New person")}</h3>
            <span>{tr("Prénom + nom, ou seulement le pseudo pour un compte Instagram.", "First + last name, or just the handle for an Instagram account.")}</span>
          </header>
          <ContactEditor draft={newDraft} onChange={setNewDraft} onSubmit={submitNew} onCancel={() => setNewDraft(null)} saving={saving} isNew />
        </section>
      ) : null}

      {!loading && !contacts.length ? (
        <section className="br-panel cr-empty">
          <p>{tr("Personne dans la liste pour cette édition.", "Nobody on the list for this edition yet.")}</p>
          <button type="button" className="br-btn br-btn--primary" disabled={saving} onClick={importStarterList}>
            {tr(`Importer la liste de départ (${CELEBRITY_RACE_STARTER_LIST.length} noms)`, `Import the starter list (${CELEBRITY_RACE_STARTER_LIST.length} names)`)}
          </button>
        </section>
      ) : null}

      {loading ? <p className="br-muted">{tr("Chargement…", "Loading…")}</p> : null}

      {contacts.length
        ? CELEBRITY_RACES.map((race) => {
            const raceRows = visible.filter((contact) => contact.race === race.id);
            const summary = summaries[race.id];
            const isCollapsed = Boolean(collapsed[race.id]);
            return (
              <section key={race.id} className="br-panel cr-race">
                <header className="br-panel__head">
                  <button type="button" className="br-collapse" aria-expanded={!isCollapsed} onClick={() => toggleCollapsed(race.id)}>
                    <span className="br-collapse__caret" aria-hidden="true">{isCollapsed ? "▸" : "▾"}</span>
                    <h3>{tr(race.fr, race.en)} <span className="br-count">{summary.total}</span></h3>
                  </button>
                  <span>
                    {summary.confirmed} {tr("confirmés", "confirmed")} · {summary.waiting} {tr("en attente", "waiting")} · {summary.toAsk} {tr("à demander", "to ask")}
                    {summary.declined ? ` · ${summary.declined} ${tr("refusés", "declined")}` : ""}
                  </span>
                  {summary.followUpDue ? <span className="br-chip br-chip--warn">{summary.followUpDue} {tr("à relancer", "to follow up")}</span> : null}
                </header>
                {isCollapsed ? null : (
                  <div className="br-table-wrap">
                    <table className="br-table cr-table">
                      <thead>
                        <tr>
                          <th>{tr("Nom", "Name")}</th>
                          <th>{tr("Statut", "Status")}</th>
                          <th>{tr("Demandé le", "Asked")}</th>
                          <th>{tr("Relance", "Follow-up")}</th>
                          <th>{tr("Suivi par", "Handled by")}</th>
                          <th>{tr("Dernière note", "Latest note")}</th>
                          <th aria-label={tr("Actions", "Actions")} />
                        </tr>
                      </thead>
                      <tbody>
                        {CELEBRITY_GENDERS.map((gender) => {
                          const rows = sortCelebrityContacts(raceRows.filter((contact) => contact.gender === gender.id));
                          const confirmed = contacts.filter((contact) => contact.race === race.id && contact.gender === gender.id && contact.status === "confirmed").length;
                          return (
                            <Fragment key={gender.id}>
                              <tr className="cr-group">
                                <td colSpan={7}>
                                  {tr(gender.fr, gender.en)} <small>· {confirmed} {tr("confirmé(s)", "confirmed")}</small>
                                </td>
                              </tr>
                              {rows.length ? null : (
                                <tr>
                                  <td colSpan={7} className="br-muted">{search || filter !== "all" ? tr("Aucun résultat.", "No match.") : tr("Personne pour l'instant.", "Nobody yet.")}</td>
                                </tr>
                              )}
                              {rows.map((contact) => {
                                const due = isFollowUpDue(contact, today);
                                const followUp = getFollowUpDate(contact);
                                const lastNote = [...contact.history].reverse().find((entry) => entry.note)?.note || contact.notes;
                                const isOpen = openId === contact.id;
                                const name = [contact.firstName, contact.lastName].filter(Boolean).join(" ");
                                return (
                                  <Fragment key={contact.id}>
                                    <tr className={`${isOpen ? "is-open" : ""}${contact.status === "declined" ? " cr-row--off" : ""}`}>
                                      <td>
                                        <button type="button" className="cr-name" onClick={() => openRow(contact)} aria-expanded={isOpen}>
                                          <span className="br-caret" aria-hidden="true">{isOpen ? "▾" : "▸"}</span>
                                          <strong>{getCelebrityDisplayName(contact)}</strong>
                                          {name && contact.alias ? <small>{contact.alias}</small> : null}
                                        </button>
                                      </td>
                                      <td>
                                        <select
                                          className={`cr-status-select cr-status--${getCelebrityStatus(contact.status).tone}`}
                                          value={contact.status}
                                          disabled={saving}
                                          onChange={(event) => changeStatus(contact, event.target.value)}
                                          aria-label={tr("Statut", "Status")}
                                        >
                                          {CELEBRITY_STATUSES.map((status) => <option key={status.id} value={status.id}>{tr(status.fr, status.en)}</option>)}
                                        </select>
                                      </td>
                                      <td className="is-num">{formatShortDate(contact.askedAt, language) || <span className="br-muted">—</span>}</td>
                                      <td className="is-num">
                                        {followUp ? (
                                          <span className={due ? "cr-due" : ""}>{formatShortDate(followUp, language)}</span>
                                        ) : due ? (
                                          <span className="cr-due">{tr("à faire", "due")}</span>
                                        ) : (
                                          <span className="br-muted">—</span>
                                        )}
                                      </td>
                                      <td>{contact.owner || <span className="br-muted">—</span>}</td>
                                      <td className="cr-note" title={lastNote}>{lastNote || <span className="br-muted">—</span>}</td>
                                      <td className="cr-actions">
                                        {["asked", "no_reply", "to_confirm"].includes(contact.status) ? (
                                          <button type="button" className="br-btn br-btn--small" disabled={saving} onClick={() => markFollowUpDone(contact)} title={tr("Noter une relance faite aujourd'hui (prochaine dans 7 jours)", "Log a follow-up done today (next in 7 days)")}>
                                            {tr("Relancé", "Followed up")}
                                          </button>
                                        ) : null}
                                      </td>
                                    </tr>
                                    {isOpen && editDraft ? (
                                      <tr className="br-detail-row">
                                        <td colSpan={7}>
                                          <div className="cr-detail">
                                            <ContactEditor
                                              draft={editDraft}
                                              onChange={setEditDraft}
                                              onSubmit={() => submitEdit(contact)}
                                              onCancel={() => openRow(contact)}
                                              onDelete={() => removeContact(contact)}
                                              saving={saving}
                                            />
                                            <ContactJournal contact={contact} onAddNote={(note) => addNote(contact, note)} saving={saving} />
                                          </div>
                                        </td>
                                      </tr>
                                    ) : null}
                                  </Fragment>
                                );
                              })}
                            </Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            );
          })
        : null}

      <p className="br-muted cr-foot">
        {tr(
          "Passer une personne en « Demandé » note la date de la demande. Sans réponse, elle remonte « À relancer » 7 jours après (ou à la date de relance choisie). La Business Race se gère dans sa propre page.",
          "Setting someone to “Asked” records the request date. Without an answer they show up under “Follow up” 7 days later (or on the follow-up date you set). The Business Race has its own page.",
        )}
      </p>
    </div>
  );
}

export { CelebrityRacePage };
