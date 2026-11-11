import { useMemo, useState } from "react";
import { addDoc, arrayUnion, collection, deleteDoc, doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { useAuth } from "../context/auth-context";
import { getActiveRoles } from "./navigation";
import { normalizeEditionId, useActiveEdition } from "./edition";
import { useMeetingEditions } from "./meeting-history-hooks";
import { db } from "../services/firebase";
import {
  ATHLETE_TRANSPORT_LOTS_COLLECTION,
  useAthletes,
  useAccompanyingPersons,
  useAthleteTransportLots,
  useTransportVolunteers,
  formatTravelDay,
} from "./athlete-portal-hooks";
import { useLanguage } from "./language-context";
import { useTr } from "./use-tr";

// fallbackRole is a French display value set by useTransportVolunteers.
const FALLBACK_ROLE_EN = { Gestionnaire: "Manager" };

function volunteerRoleLabel(role, tr) {
  return tr(role, FALLBACK_ROLE_EN[role] || role);
}

// ─── Chief page ───────────────────────────────────────────────────────────────

function AthleteTransportChiefPage({ Panel }) {
  const tr = useTr();
  const { userProfile } = useAuth();
  const roles = getActiveRoles(userProfile);
  const isAdmin = roles.includes("admin");
  const [tab, setTab] = useState("arrivals");
  const { activeEditionId } = useActiveEdition();
  // Admins can switch to "test" to check a rehearsal import's travel/lots
  // logic — without this, this page always showed the real edition only,
  // even while every athlete/staff record lived under "test".
  // Follows the active edition until the user picks another one (useActiveEdition
  // starts on "test" while it loads, which used to stick).
  const [pickedViewEditionId, setViewEditionId] = useState("");
  const viewEditionId = pickedViewEditionId || activeEditionId;
  const { athletes, loading: athletesLoading } = useAthletes(true, viewEditionId);
  const { people: accompanyingPersons, loading: staffLoading } = useAccompanyingPersons(true, viewEditionId);
  const { lots, loading: lotsLoading } = useAthleteTransportLots(true, viewEditionId);
  const { volunteers, loading: volunteersLoading } = useTransportVolunteers();
  const { editions: meetingEditions } = useMeetingEditions();
  const meetingReferenceDate = meetingEditions.find((e) => String(e.year) === String(activeEditionId))?.date;

  // The transport chief needs to pick up everyone the meeting director sent
  // travel info for, not just competing athletes — coaches, managers, physios
  // arrive/depart on their own flights too. Both groups share the id space
  // (Firestore auto ids), so they can live in one merged list/map.
  const allPeople = useMemo(
    () => [...athletes, ...accompanyingPersons.map((p) => ({ ...p, isStaff: true }))],
    [athletes, accompanyingPersons],
  );

  const peopleWithArrival = useMemo(
    () => allPeople.filter((a) => a.arrivalDay || a.arrivalFlight || a.arrivalTime),
    [allPeople],
  );

  const lotAthleteIds = useMemo(() => {
    const ids = new Set();
    lots.forEach((lot) => (lot.athleteIds ?? []).forEach((id) => ids.add(id)));
    return ids;
  }, [lots]);

  const athleteMap = useMemo(() => {
    const map = {};
    allPeople.forEach((a) => { map[a.id] = a; });
    return map;
  }, [allPeople]);

  return (
    <div className="page">
      <section className="page-header">
        <div>
          <p className="eyebrow">Athlete Portal</p>
          <h1>Transport</h1>
          <p>{tr("Gérez les lots de transport et les affectations des bénévoles.", "Manage transport groups and volunteer assignments.")}</p>
          {isAdmin && (
            <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8 }}>
              <label style={{ fontSize: "0.8rem", color: "#607086" }}>{tr("Édition :", "Edition:")}</label>
              <select
                value={viewEditionId}
                onChange={(e) => setViewEditionId(e.target.value)}
                style={{ width: "auto", fontSize: "0.85rem", padding: "3px 6px" }}
              >
                <option value={activeEditionId}>{tr("Courante", "Current")} ({activeEditionId})</option>
                {normalizeEditionId(activeEditionId) !== "test" && <option value="test">{tr("Exemple 2026", "Sample 2026")}</option>}
              </select>
              {viewEditionId === "test" && (
                <span className="status-pill status-pill--warn" style={{ fontSize: "0.72rem" }}>
                  {tr("Rien ici n'apparaît ailleurs dans l'app", "Nothing here shows anywhere else in the app")}
                </span>
              )}
            </div>
          )}
        </div>
      </section>

      <div className="admin-subtabs" style={{ marginBottom: "1.5rem" }}>
        <button
          type="button"
          className={`admin-subtab${tab === "arrivals" ? " admin-subtab--active" : ""}`}
          onClick={() => setTab("arrivals")}
        >
          {tr("Arrivées", "Arrivals")} ({peopleWithArrival.length})
        </button>
        <button
          type="button"
          className={`admin-subtab${tab === "lots" ? " admin-subtab--active" : ""}`}
          onClick={() => setTab("lots")}
        >
          {tr("Lots", "Groups")} ({lots.length})
        </button>
        <button
          type="button"
          className={`admin-subtab${tab === "volunteers" ? " admin-subtab--active" : ""}`}
          onClick={() => setTab("volunteers")}
        >
          {tr("Bénévoles", "Volunteers")} ({volunteers.length})
        </button>
      </div>

      {tab === "arrivals" && (
        <ArrivalsTab
          Panel={Panel}
          athletes={peopleWithArrival}
          loading={athletesLoading || staffLoading}
          lots={lots}
          lotAthleteIds={lotAthleteIds}
          volunteers={volunteers}
          editionId={viewEditionId}
          meetingReferenceDate={meetingReferenceDate}
        />
      )}
      {tab === "lots" && (
        <LotsTab
          Panel={Panel}
          lots={lots}
          loading={lotsLoading}
          athletes={athletes}
          athleteMap={athleteMap}
          volunteers={volunteers}
          editionId={viewEditionId}
        />
      )}
      {tab === "volunteers" && (
        <VolunteersTab
          Panel={Panel}
          volunteers={volunteers}
          loading={volunteersLoading}
          lots={lots}
        />
      )}
    </div>
  );
}

// Adds (or subtracts) minutes to a "HH:MM" time string, wrapping past midnight.
function addMinutesToTime(time, minutesToAdd) {
  if (!time || !/^\d{1,2}:\d{2}$/.test(time)) return "";
  const [h, m] = time.split(":").map(Number);
  const wrapped = ((h * 60 + m + minutesToAdd) % 1440 + 1440) % 1440;
  return `${String(Math.floor(wrapped / 60)).padStart(2, "0")}:${String(wrapped % 60).padStart(2, "0")}`;
}

// ─── Arrivées tab ─────────────────────────────────────────────────────────────

function ArrivalsTab({ Panel, athletes, loading, lots, lotAthleteIds, volunteers, editionId, meetingReferenceDate }) {
  const tr = useTr();
  const { language } = useLanguage();
  const [dayFilter, setDayFilter] = useState("");
  const [flightFilter, setFlightFilter] = useState("");
  const [selected, setSelected] = useState(new Set());
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newLotLabel, setNewLotLabel] = useState("");
  const [newLotVolunteerId, setNewLotVolunteerId] = useState("");
  const [addToLotId, setAddToLotId] = useState("");
  const [newLotPickupTime, setNewLotPickupTime] = useState("");
  const [newLotLeaveTime, setNewLotLeaveTime] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const days = useMemo(() => {
    const set = new Set(athletes.map((a) => a.arrivalDay).filter(Boolean));
    return [...set].sort((a, b) => a - b);
  }, [athletes]);

  const filtered = useMemo(() => {
    let list = athletes;
    if (dayFilter) list = list.filter((a) => String(a.arrivalDay) === dayFilter);
    if (flightFilter) list = list.filter((a) =>
      (a.arrivalFlight || "").toLowerCase().includes(flightFilter.toLowerCase()),
    );
    return list.sort((a, b) => {
      if (a.arrivalDay !== b.arrivalDay) return (a.arrivalDay ?? 99) - (b.arrivalDay ?? 99);
      return (a.arrivalTime ?? "").localeCompare(b.arrivalTime ?? "");
    });
  }, [athletes, dayFilter, flightFilter]);

  function toggleSelect(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === filtered.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map((a) => a.id)));
    }
  }

  function getLotForAthlete(athleteId) {
    return lots.find((lot) => (lot.athleteIds ?? []).includes(athleteId));
  }

  function openCreateForm() {
    const selectedAthletes = filtered.filter((a) => selected.has(a.id));
    const flights = [...new Set(selectedAthletes.map((a) => a.arrivalFlight).filter(Boolean))];
    const times = [...new Set(selectedAthletes.map((a) => a.arrivalTime).filter(Boolean))];
    const days = [...new Set(selectedAthletes.map((a) => a.arrivalDay).filter(Boolean))];
    const sortedTimes = times.slice().sort();
    // Two lots created the same day with a mix of flights/times used to both
    // fall back to the exact same bare "— Samedi 16 janv." label — always
    // include a time (range) and the headcount so lots stay distinguishable
    // at a glance; the chief can still rename it via "Renommer" afterwards.
    let label = "";
    if (flights.length === 1) label = `${tr("Vol", "Flight")} ${flights[0]}`;
    if (sortedTimes.length === 1) {
      label += label ? ` ${sortedTimes[0]}` : `Arr. ${sortedTimes[0]}`;
    } else if (sortedTimes.length > 1) {
      label += label ? ` ${sortedTimes[0]}–${sortedTimes[sortedTimes.length - 1]}` : `Arr. ${sortedTimes[0]}–${sortedTimes[sortedTimes.length - 1]}`;
    }
    if (days.length === 1) label += `${label ? " — " : ""}${formatTravelDay(days[0], meetingReferenceDate, language)}`;
    if (!label) label = `${tr("Lot du", "Group of")} ${new Date().toLocaleDateString(language === "fr" ? "fr-FR" : "en-GB")}`;
    setNewLotLabel(`${label} (${selectedAthletes.length} ${tr("pers.", selectedAthletes.length === 1 ? "person" : "people")})`);
    setNewLotVolunteerId("");
    // The volunteer should be there 30min before the EARLIEST arrival, and
    // the auto-filled leave time is 30min after the LAST arrival in the lot
    // — both stay editable since a flight can be delayed or the chief may
    // want more margin.
    setNewLotPickupTime(addMinutesToTime(sortedTimes[0], -30));
    setNewLotLeaveTime(addMinutesToTime(sortedTimes[sortedTimes.length - 1], 30));
    setShowCreateForm(true);
  }

  async function createLot() {
    if (!newLotLabel.trim()) { setError(tr("Un libellé est requis.", "A name is required.")); return; }
    setSaving(true);
    setError("");
    try {
      const volunteer = volunteers.find((v) => v.id === newLotVolunteerId) ?? null;
      await addDoc(collection(db, ATHLETE_TRANSPORT_LOTS_COLLECTION), {
        editionId,
        label: newLotLabel.trim(),
        assignedVolunteerId: volunteer?.id ?? null,
        assignedVolunteerName: volunteer ? `${volunteer.firstName ?? ""} ${volunteer.lastName ?? ""}`.trim() : null,
        athleteIds: [...selected],
        pickupTime: newLotPickupTime || null,
        leaveTime: newLotLeaveTime || null,
        pickedUp: {},
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setSelected(new Set());
      setShowCreateForm(false);
    } catch {
      setError(tr("Erreur lors de la création du lot.", "Could not create the group."));
    } finally {
      setSaving(false);
    }
  }

  async function addToLot() {
    if (!addToLotId) return;
    setSaving(true);
    setError("");
    try {
      await updateDoc(doc(db, ATHLETE_TRANSPORT_LOTS_COLLECTION, addToLotId), {
        athleteIds: arrayUnion(...selected),
        updatedAt: serverTimestamp(),
      });
      setSelected(new Set());
      setAddToLotId("");
    } catch {
      setError(tr("Erreur lors de l'ajout au lot.", "Could not add to the group."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Panel
      title={tr("Personnes avec info d'arrivée", "People with arrival info")}
      subtitle={tr(
        `${athletes.length} personnes (athlètes + staff) · ${lotAthleteIds.size} dans un lot`,
        `${athletes.length} ${athletes.length === 1 ? "person" : "people"} (athletes + staff) · ${lotAthleteIds.size} in a group`,
      )}
      actions={
        selected.size > 0 && !showCreateForm
          ? (
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
              {lots.length > 0 && (
                <>
                  <select
                    className="select-field"
                    value={addToLotId}
                    onChange={(e) => setAddToLotId(e.target.value)}
                    style={{ width: "auto" }}
                  >
                    <option value="">{tr("Ajouter au lot existant…", "Add to existing group…")}</option>
                    {lots.map((lot) => <option key={lot.id} value={lot.id}>{lot.label}</option>)}
                  </select>
                  <button type="button" className="btn" onClick={addToLot} disabled={!addToLotId || saving}>
                    {saving ? "…" : tr("Ajouter", "Add")}
                  </button>
                </>
              )}
              <button type="button" className="btn btn--primary" onClick={openCreateForm}>{tr("Créer un lot", "Create group")} ({selected.size})</button>
            </div>
          )
          : null
      }
    >
      <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1rem", flexWrap: "wrap" }}>
        <select
          className="select-field"
          value={dayFilter}
          onChange={(e) => setDayFilter(e.target.value)}
          style={{ width: "auto" }}
        >
          <option value="">{tr("Tous les jours", "All days")}</option>
          {days.map((d) => <option key={d} value={d}>{formatTravelDay(d, meetingReferenceDate, language)}</option>)}
        </select>
        <input
          type="text"
          className="text-field"
          placeholder={tr("Filtrer par vol…", "Filter by flight…")}
          value={flightFilter}
          onChange={(e) => setFlightFilter(e.target.value)}
          style={{ width: "160px" }}
        />
      </div>

      {error && !showCreateForm && <p style={{ color: "red", marginBottom: "1rem" }}>{error}</p>}

      {showCreateForm && (
        <div className="panel" style={{ marginBottom: "1rem", background: "var(--color-bg-offset, #f5f5f5)", padding: "1rem" }}>
          <h4 style={{ marginTop: 0 }}>{tr(`Nouveau lot — ${selected.size} athlète(s)`, `New group — ${selected.size} ${selected.size === 1 ? "person" : "people"}`)}</h4>
          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", marginBottom: "0.75rem" }}>
            <input
              type="text"
              className="text-field"
              placeholder={tr("Libellé du lot", "Group name")}
              value={newLotLabel}
              onChange={(e) => setNewLotLabel(e.target.value)}
              style={{ flex: "1 1 200px" }}
            />
            <select
              className="select-field"
              value={newLotVolunteerId}
              onChange={(e) => setNewLotVolunteerId(e.target.value)}
              style={{ flex: "1 1 200px" }}
            >
              <option value="">{tr("Bénévole — à assigner", "Volunteer — to assign")}</option>
              {volunteers.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.firstName} {v.lastName}{v.fallbackRole ? ` (${volunteerRoleLabel(v.fallbackRole, tr)})` : ""}
                </option>
              ))}
            </select>
          </div>
          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", marginBottom: "0.75rem", alignItems: "center" }}>
            <label style={{ fontSize: "0.85rem", color: "#475569", display: "flex", alignItems: "center", gap: "0.4rem" }}>
              {tr("Bénévole présent à", "Volunteer on site at")}
              <input
                type="time"
                className="text-field"
                value={newLotPickupTime}
                onChange={(e) => setNewLotPickupTime(e.target.value)}
                style={{ width: "auto" }}
              />
            </label>
            <label style={{ fontSize: "0.85rem", color: "#475569", display: "flex", alignItems: "center", gap: "0.4rem" }}>
              {tr("Départ de l'aéroport à", "Leaves the airport at")}
              <input
                type="time"
                className="text-field"
                value={newLotLeaveTime}
                onChange={(e) => setNewLotLeaveTime(e.target.value)}
                style={{ width: "auto" }}
              />
            </label>
            <span style={{ fontSize: "0.75rem", color: "#888" }}>{tr("Départ pré-rempli 30min après la dernière arrivée du lot", "Departure pre-filled 30 min after the group's last arrival")}</span>
          </div>
          {error && <p style={{ color: "red", marginBottom: "0.5rem" }}>{error}</p>}
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button type="button" className="btn btn--primary" onClick={createLot} disabled={saving}>
              {saving ? tr("Création…", "Creating…") : tr("Créer le lot", "Create group")}
            </button>
            <button type="button" className="btn" onClick={() => setShowCreateForm(false)}>{tr("Annuler", "Cancel")}</button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="panel-note">{tr("Chargement…", "Loading…")}</p>
      ) : filtered.length === 0 ? (
        <p className="panel-note">{tr("Aucun athlète avec info d'arrivée.", "No one with arrival info yet.")}</p>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>
                  <input type="checkbox" checked={selected.size === filtered.length && filtered.length > 0} onChange={toggleAll} />
                </th>
                <th>{tr("Nom", "Name")}</th>
                <th>{tr("Nat.", "Nat.")}</th>
                <th>{tr("Rôle / épreuve", "Role / event")}</th>
                <th>{tr("Jour", "Day")}</th>
                <th>{tr("Heure arr.", "Arr. time")}</th>
                <th>{tr("Vol", "Flight")}</th>
                <th>{tr("Depuis", "From")}</th>
                <th>{tr("Lot", "Group")}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((a) => {
                const lot = getLotForAthlete(a.id);
                return (
                  <tr key={a.id} style={lot ? { opacity: 0.6 } : undefined}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selected.has(a.id)}
                        onChange={() => toggleSelect(a.id)}
                      />
                    </td>
                    <td>{a.lastName} {a.firstName}</td>
                    <td>{a.nationality}</td>
                    <td>{a.isStaff ? <span className="status-pill">{a.staffRole || "Staff"}</span> : a.event}</td>
                    <td>{a.arrivalDay ? formatTravelDay(a.arrivalDay, meetingReferenceDate, language) : "—"}</td>
                    <td>{a.arrivalTime ?? "—"}</td>
                    <td>{a.arrivalFlight ?? "—"}</td>
                    <td>{a.arrivalFrom ?? "—"}</td>
                    <td style={{ fontSize: "0.8em", color: "#888" }}>{lot ? lot.label : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

// ─── Lots tab ─────────────────────────────────────────────────────────────────

function LotsTab({ Panel, lots, loading, athleteMap, volunteers, editionId }) {
  const tr = useTr();
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newLotLabel, setNewLotLabel] = useState("");
  const [newLotVolunteerId, setNewLotVolunteerId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [assigningLotId, setAssigningLotId] = useState(null);
  const [assignVolunteerId, setAssignVolunteerId] = useState("");
  const [expandedLotId, setExpandedLotId] = useState(null);
  const [editingTimesLotId, setEditingTimesLotId] = useState(null);
  const [editPickupTime, setEditPickupTime] = useState("");
  const [editLeaveTime, setEditLeaveTime] = useState("");
  const [renamingLotId, setRenamingLotId] = useState(null);
  const [renameValue, setRenameValue] = useState("");

  async function createEmptyLot() {
    if (!newLotLabel.trim()) { setError(tr("Un libellé est requis.", "A name is required.")); return; }
    setSaving(true);
    setError("");
    try {
      const volunteer = volunteers.find((v) => v.id === newLotVolunteerId) ?? null;
      await addDoc(collection(db, ATHLETE_TRANSPORT_LOTS_COLLECTION), {
        editionId,
        label: newLotLabel.trim(),
        assignedVolunteerId: volunteer?.id ?? null,
        assignedVolunteerName: volunteer ? `${volunteer.firstName ?? ""} ${volunteer.lastName ?? ""}`.trim() : null,
        athleteIds: [],
        pickedUp: {},
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setNewLotLabel("");
      setNewLotVolunteerId("");
      setShowCreateForm(false);
    } catch {
      setError(tr("Erreur lors de la création du lot.", "Could not create the group."));
    } finally {
      setSaving(false);
    }
  }

  async function assignVolunteer(lot) {
    const volunteer = volunteers.find((v) => v.id === assignVolunteerId) ?? null;
    await updateDoc(doc(db, ATHLETE_TRANSPORT_LOTS_COLLECTION, lot.id), {
      assignedVolunteerId: volunteer?.id ?? null,
      assignedVolunteerName: volunteer ? `${volunteer.firstName ?? ""} ${volunteer.lastName ?? ""}`.trim() : null,
      updatedAt: serverTimestamp(),
    });
    setAssigningLotId(null);
  }

  async function deleteLot(lotId) {
    if (!window.confirm(tr("Supprimer ce lot ? Les athlètes ne seront pas supprimés.", "Delete this group? The athletes will not be deleted."))) return;
    await deleteDoc(doc(db, ATHLETE_TRANSPORT_LOTS_COLLECTION, lotId));
  }

  async function saveTimes(lot) {
    await updateDoc(doc(db, ATHLETE_TRANSPORT_LOTS_COLLECTION, lot.id), {
      pickupTime: editPickupTime || null,
      leaveTime: editLeaveTime || null,
      updatedAt: serverTimestamp(),
    });
    setEditingTimesLotId(null);
  }

  async function saveRename(lot) {
    if (!renameValue.trim()) return;
    await updateDoc(doc(db, ATHLETE_TRANSPORT_LOTS_COLLECTION, lot.id), {
      label: renameValue.trim(),
      updatedAt: serverTimestamp(),
    });
    setRenamingLotId(null);
  }

  return (
    <Panel
      title={tr("Lots de transport", "Transport groups")}
      actions={
        !showCreateForm
          ? <button type="button" className="btn btn--primary" onClick={() => setShowCreateForm(true)}>{tr("+ Nouveau lot", "+ New group")}</button>
          : null
      }
    >
      {showCreateForm && (
        <div className="panel" style={{ marginBottom: "1rem", background: "var(--color-bg-offset, #f5f5f5)", padding: "1rem" }}>
          <h4 style={{ marginTop: 0 }}>{tr("Nouveau lot vide", "New empty group")}</h4>
          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", marginBottom: "0.75rem" }}>
            <input
              type="text"
              className="text-field"
              placeholder={tr("Libellé du lot", "Group name")}
              value={newLotLabel}
              onChange={(e) => setNewLotLabel(e.target.value)}
              style={{ flex: "1 1 200px" }}
            />
            <select
              className="select-field"
              value={newLotVolunteerId}
              onChange={(e) => setNewLotVolunteerId(e.target.value)}
              style={{ flex: "1 1 200px" }}
            >
              <option value="">{tr("Bénévole — à assigner", "Volunteer — to assign")}</option>
              {volunteers.map((v) => (
                <option key={v.id} value={v.id}>{v.firstName} {v.lastName}{v.fallbackRole ? ` (${volunteerRoleLabel(v.fallbackRole, tr)})` : ""}</option>
              ))}
            </select>
          </div>
          {error && <p style={{ color: "red", marginBottom: "0.5rem" }}>{error}</p>}
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button type="button" className="btn btn--primary" onClick={createEmptyLot} disabled={saving}>
              {saving ? tr("Création…", "Creating…") : tr("Créer le lot", "Create group")}
            </button>
            <button type="button" className="btn" onClick={() => setShowCreateForm(false)}>{tr("Annuler", "Cancel")}</button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="panel-note">{tr("Chargement…", "Loading…")}</p>
      ) : lots.length === 0 ? (
        <p className="panel-note">{tr("Aucun lot créé. Sélectionnez des athlètes dans l'onglet Arrivées pour créer un lot.", "No groups yet. Select people in the Arrivals tab to create one.")}</p>
      ) : (
        <ul className="compact-list" style={{ listStyle: "none", padding: 0 }}>
          {lots.map((lot) => {
            const pickedCount = Object.values(lot.pickedUp ?? {}).filter(Boolean).length;
            const total = (lot.athleteIds ?? []).length;
            const isExpanded = expandedLotId === lot.id;
            const isAssigning = assigningLotId === lot.id;
            const isEditingTimes = editingTimesLotId === lot.id;
            const isRenaming = renamingLotId === lot.id;

            return (
              <li key={lot.id} style={{ borderBottom: "1px solid var(--color-border, #e0e0e0)", padding: "0.75rem 0" }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: "0.75rem", flexWrap: "wrap" }}>
                  <div style={{ flex: 1 }}>
                    {isRenaming ? (
                      <span style={{ display: "inline-flex", gap: "0.4rem", alignItems: "center" }}>
                        <input
                          type="text"
                          className="text-field"
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") saveRename(lot); }}
                          style={{ minWidth: "220px" }}
                          autoFocus
                        />
                        <button type="button" className="btn btn--primary" style={{ fontSize: "0.8em" }} onClick={() => saveRename(lot)}>
                          {tr("Confirmer", "Confirm")}
                        </button>
                        <button type="button" className="btn" style={{ fontSize: "0.8em" }} onClick={() => setRenamingLotId(null)}>
                          {tr("Annuler", "Cancel")}
                        </button>
                      </span>
                    ) : (
                      <strong>{lot.label}</strong>
                    )}
                    <span style={{ marginLeft: "0.5rem", color: "#888", fontSize: "0.85em" }}>
                      {tr(
                        `${total} athlète${total !== 1 ? "s" : ""} · ${pickedCount}/${total} récupéré${pickedCount !== 1 ? "s" : ""}`,
                        `${total} athlete${total !== 1 ? "s" : ""} · ${pickedCount}/${total} picked up`,
                      )}
                    </span>
                    <br />
                    <span style={{ fontSize: "0.85em", color: lot.assignedVolunteerName ? "#333" : "#aaa" }}>
                      {lot.assignedVolunteerName ? `${tr("Bénévole :", "Volunteer:")} ${lot.assignedVolunteerName}` : tr("Bénévole non assigné", "No volunteer assigned")}
                    </span>
                    {(lot.pickupTime || lot.leaveTime) && (
                      <>
                        <br />
                        <span style={{ fontSize: "0.85em", color: "#555" }}>
                          {lot.pickupTime && <>{tr("Présent à", "On site at")} {lot.pickupTime}</>}
                          {lot.pickupTime && lot.leaveTime && " · "}
                          {lot.leaveTime && <>{tr("Départ à", "Leaves at")} {lot.leaveTime}</>}
                        </span>
                      </>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: "0.5rem", flexShrink: 0 }}>
                    <button
                      type="button"
                      className="btn"
                      style={{ fontSize: "0.8em" }}
                      onClick={() => {
                        setRenamingLotId(isRenaming ? null : lot.id);
                        setRenameValue(lot.label ?? "");
                      }}
                    >
                      {isRenaming ? tr("Annuler", "Cancel") : tr("Renommer", "Rename")}
                    </button>
                    <button
                      type="button"
                      className="btn"
                      style={{ fontSize: "0.8em" }}
                      onClick={() => setExpandedLotId(isExpanded ? null : lot.id)}
                    >
                      {isExpanded ? tr("Réduire", "Collapse") : `${tr("Athlètes", "Athletes")} (${total})`}
                    </button>
                    <button
                      type="button"
                      className="btn"
                      style={{ fontSize: "0.8em" }}
                      onClick={() => {
                        setAssigningLotId(isAssigning ? null : lot.id);
                        setAssignVolunteerId(lot.assignedVolunteerId ?? "");
                      }}
                    >
                      {isAssigning ? tr("Annuler", "Cancel") : tr("Assigner", "Assign")}
                    </button>
                    <button
                      type="button"
                      className="btn"
                      style={{ fontSize: "0.8em" }}
                      onClick={() => {
                        setEditingTimesLotId(isEditingTimes ? null : lot.id);
                        setEditPickupTime(lot.pickupTime ?? "");
                        setEditLeaveTime(lot.leaveTime ?? "");
                      }}
                    >
                      {isEditingTimes ? tr("Annuler", "Cancel") : tr("Horaires", "Times")}
                    </button>
                    <button
                      type="button"
                      className="btn btn--danger"
                      style={{ fontSize: "0.8em" }}
                      onClick={() => deleteLot(lot.id)}
                    >
                      {tr("Supprimer", "Delete")}
                    </button>
                  </div>
                </div>

                {isEditingTimes && (
                  <div style={{ display: "flex", gap: "0.75rem", marginTop: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
                    <label style={{ fontSize: "0.85rem", color: "#475569", display: "flex", alignItems: "center", gap: "0.4rem" }}>
                      {tr("Bénévole présent à", "Volunteer on site at")}
                      <input
                        type="time"
                        className="text-field"
                        value={editPickupTime}
                        onChange={(e) => setEditPickupTime(e.target.value)}
                        style={{ width: "auto" }}
                      />
                    </label>
                    <label style={{ fontSize: "0.85rem", color: "#475569", display: "flex", alignItems: "center", gap: "0.4rem" }}>
                      {tr("Départ de l'aéroport à", "Leaves the airport at")}
                      <input
                        type="time"
                        className="text-field"
                        value={editLeaveTime}
                        onChange={(e) => setEditLeaveTime(e.target.value)}
                        style={{ width: "auto" }}
                      />
                    </label>
                    <button type="button" className="btn btn--primary" style={{ fontSize: "0.85em" }} onClick={() => saveTimes(lot)}>
                      {tr("Confirmer", "Confirm")}
                    </button>
                  </div>
                )}

                {isAssigning && (
                  <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem", alignItems: "center" }}>
                    <select
                      className="select-field"
                      value={assignVolunteerId}
                      onChange={(e) => setAssignVolunteerId(e.target.value)}
                      style={{ flex: 1, maxWidth: "300px" }}
                    >
                      <option value="">{tr("— Aucun bénévole —", "— No volunteer —")}</option>
                      {volunteers.map((v) => (
                        <option key={v.id} value={v.id}>{v.firstName} {v.lastName}{v.fallbackRole ? ` (${volunteerRoleLabel(v.fallbackRole, tr)})` : ""}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="btn btn--primary"
                      style={{ fontSize: "0.85em" }}
                      onClick={() => assignVolunteer(lot)}
                    >
                      {tr("Confirmer", "Confirm")}
                    </button>
                  </div>
                )}

                {isExpanded && (
                  <LotAthletesList
                    lot={lot}
                    athleteMap={athleteMap}
                    showPickedUp
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

// ─── Volunteer assignment tab ─────────────────────────────────────────────────

function VolunteersTab({ Panel, volunteers, loading, lots }) {
  const tr = useTr();
  function getLotsForVolunteer(uid) {
    return lots.filter((lot) => lot.assignedVolunteerId === uid);
  }

  return (
    <Panel title={tr("Bénévoles transport athlètes", "Athlete transport volunteers")}>
      {loading ? (
        <p className="panel-note">{tr("Chargement…", "Loading…")}</p>
      ) : volunteers.length === 0 ? (
        <p className="panel-note">
          {tr("Aucun bénévole trouvé — ni avec le rôle ", "No volunteer found — none with the role ")}<em>benevole_transport_athletes</em>{tr(", ni parmi les admins/gestionnaires.", ", nor among admins/managers.")}
          {" "}{tr("Assignez ce rôle via la gestion des rôles plateforme.", "Assign this role in the platform role management.")}
        </p>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>{tr("Nom", "Name")}</th>
                <th>{tr("Type", "Type")}</th>
                <th>{tr("Email", "Email")}</th>
                <th>{tr("Téléphone", "Phone")}</th>
                <th>{tr("Lots assignés", "Assigned groups")}</th>
              </tr>
            </thead>
            <tbody>
              {volunteers.map((v) => {
                const myLots = getLotsForVolunteer(v.id);
                return (
                  <tr key={v.id}>
                    <td>{v.firstName} {v.lastName}</td>
                    <td>
                      {v.fallbackRole
                        ? <span className="status-pill" title={tr("Bénévole par défaut (admin/gestionnaire), pas un bénévole transport dédié", "Fallback volunteer (admin/manager), not a dedicated transport volunteer")}>{volunteerRoleLabel(v.fallbackRole, tr)}</span>
                        : <span className="status-pill status-pill--ok">{tr("Bénévole transport", "Transport volunteer")}</span>
                      }
                    </td>
                    <td>{v.email ?? "—"}</td>
                    <td>{v.phone ?? "—"}</td>
                    <td>
                      {myLots.length === 0
                        ? <span style={{ color: "#aaa" }}>{tr("Aucun", "None")}</span>
                        : myLots.map((l) => <span key={l.id} style={{ display: "block" }}>{l.label}</span>)
                      }
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

// ─── Shared: lot athlete list with pick-up toggle ─────────────────────────────

function LotAthletesList({ lot, athleteMap, showPickedUp = false, onTogglePickedUp, onToggleNoShow, onToggleDelayed }) {
  const tr = useTr();
  const athleteIds = lot.athleteIds ?? [];

  if (athleteIds.length === 0) {
    return <p className="panel-note" style={{ marginTop: "0.5rem" }}>{tr("Aucun athlète dans ce lot.", "No one in this group.")}</p>;
  }

  const showDeclareCols = Boolean(onToggleNoShow || onToggleDelayed);

  return (
    <div className="table-wrap" style={{ marginTop: "0.5rem" }}>
      <table className="data-table">
        <thead>
          <tr>
            {showPickedUp && <th>{tr("Récupéré", "Picked up")}</th>}
            <th>{tr("Nom", "Name")}</th>
            <th>{tr("Nat.", "Nat.")}</th>
            <th>{tr("Rôle / épreuve", "Role / event")}</th>
            <th>{tr("Vol arr.", "Arr. flight")}</th>
            <th>{tr("Heure arr.", "Arr. time")}</th>
            <th>{tr("Depuis", "From")}</th>
            {showDeclareCols && <th>{tr("Signaler", "Report")}</th>}
          </tr>
        </thead>
        <tbody>
          {athleteIds.map((id) => {
            const a = athleteMap[id];
            const picked = !!(lot.pickedUp ?? {})[id];
            const noShow = !!(lot.noShow ?? {})[id];
            const delayed = !!(lot.delayed ?? {})[id];
            if (!a) return null;
            return (
              <tr key={id} style={picked || noShow ? { opacity: 0.55 } : undefined}>
                {showPickedUp && (
                  <td>
                    {onTogglePickedUp
                      ? (
                        <button
                          type="button"
                          className={`btn ${picked ? "btn--primary" : ""}`}
                          style={{ fontSize: "0.8em", padding: "0.2em 0.6em" }}
                          onClick={() => onTogglePickedUp(id, !picked)}
                        >
                          {picked ? tr("✓ Récupéré", "✓ Picked up") : tr("En attente", "Waiting")}
                        </button>
                      )
                      : <span>{picked ? "✓" : "—"}</span>
                    }
                  </td>
                )}
                <td>{a.lastName} {a.firstName}</td>
                <td>{a.nationality}</td>
                <td>{a.isStaff ? <span className="status-pill">{a.staffRole || "Staff"}</span> : a.event}</td>
                <td>{a.arrivalFlight ?? "—"}</td>
                <td>{a.arrivalTime ?? "—"}</td>
                <td>{a.arrivalFrom ?? "—"}</td>
                {showDeclareCols && (
                  <td style={{ display: "flex", gap: "0.35em", flexWrap: "wrap" }}>
                    {onToggleNoShow && (
                      <button
                        type="button"
                        className={`btn ${noShow ? "btn--danger" : ""}`}
                        style={{ fontSize: "0.75em", padding: "0.2em 0.5em" }}
                        onClick={() => onToggleNoShow(id, !noShow)}
                      >
                        {noShow ? tr("Absent ✓", "No-show ✓") : tr("Absent", "No-show")}
                      </button>
                    )}
                    {onToggleDelayed && (
                      <button
                        type="button"
                        className={`btn ${delayed ? "btn--primary" : ""}`}
                        style={{ fontSize: "0.75em", padding: "0.2em 0.5em" }}
                        onClick={() => onToggleDelayed(id, !delayed)}
                        title={tr("Signale un retard pour tous les passagers du même vol", "Flags a delay for every passenger on the same flight")}
                      >
                        {delayed ? tr("Retard ✓", "Delayed ✓") : tr("Retard", "Delayed")}
                      </button>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Volunteer page ───────────────────────────────────────────────────────────

function AthleteTransportVolunteerPage({ Panel }) {
  const tr = useTr();
  const { currentUser, userProfile } = useAuth();
  const roles = getActiveRoles(userProfile);
  const isAdmin = roles.includes("admin") || roles.includes("gestionnaire");
  const { activeEditionId } = useActiveEdition();
  // Admins/gestionnaires stand in as a fallback transport volunteer (see
  // useTransportVolunteers) and are often the ones testing a rehearsal import
  // — without this override, a lot they assigned themselves under "test"
  // would show up (lots carry their own editionId) but with an empty athlete
  // list, since athletes/staff would still be looked up in the real edition.
  // A real, non-admin volunteer never needs this — they only ever pick up a
  // real lot in the real edition.
  // Follows the active edition until the user picks another one (useActiveEdition
  // starts on "test" while it loads, which used to stick).
  const [pickedViewEditionId, setViewEditionId] = useState("");
  const viewEditionId = pickedViewEditionId || activeEditionId;
  const effectiveEditionId = isAdmin ? viewEditionId : activeEditionId;
  const { lots, loading: lotsLoading } = useAthleteTransportLots(true, effectiveEditionId);
  const { athletes, loading: athletesLoading } = useAthletes(true, effectiveEditionId);
  const { people: accompanyingPersons, loading: staffLoading } = useAccompanyingPersons(true, effectiveEditionId);
  const [savingId, setSavingId] = useState(null);

  const athleteMap = useMemo(() => {
    const map = {};
    athletes.forEach((a) => { map[a.id] = a; });
    accompanyingPersons.forEach((p) => { map[p.id] = { ...p, isStaff: true }; });
    return map;
  }, [athletes, accompanyingPersons]);

  const myLots = useMemo(
    () => lots.filter((lot) => lot.assignedVolunteerId === currentUser?.uid),
    [lots, currentUser],
  );

  async function togglePickedUp(lot, athleteId, value) {
    setSavingId(`${lot.id}:${athleteId}`);
    try {
      await updateDoc(doc(db, ATHLETE_TRANSPORT_LOTS_COLLECTION, lot.id), {
        [`pickedUp.${athleteId}`]: value,
        updatedAt: serverTimestamp(),
      });
    } finally {
      setSavingId(null);
    }
  }

  async function toggleNoShow(lot, athleteId, value) {
    setSavingId(`${lot.id}:${athleteId}`);
    try {
      await updateDoc(doc(db, ATHLETE_TRANSPORT_LOTS_COLLECTION, lot.id), {
        [`noShow.${athleteId}`]: value,
        updatedAt: serverTimestamp(),
      });
    } finally {
      setSavingId(null);
    }
  }

  // A delay is a flight-level event, not a per-person one — everyone in this
  // lot on the same flight as the declared person gets flagged too, so the
  // volunteer doesn't have to click through each passenger individually.
  async function toggleDelayed(lot, athleteId, value) {
    setSavingId(`${lot.id}:${athleteId}`);
    try {
      const flightNo = athleteMap[athleteId]?.arrivalFlight;
      const affectedIds = flightNo
        ? (lot.athleteIds ?? []).filter((id) => athleteMap[id]?.arrivalFlight === flightNo)
        : [athleteId];
      const updates = {};
      affectedIds.forEach((id) => { updates[`delayed.${id}`] = value; });
      await updateDoc(doc(db, ATHLETE_TRANSPORT_LOTS_COLLECTION, lot.id), {
        ...updates,
        updatedAt: serverTimestamp(),
      });
    } finally {
      setSavingId(null);
    }
  }

  const loading = lotsLoading || athletesLoading || staffLoading;

  return (
    <div className="page">
      <section className="page-header">
        <div>
          <p className="eyebrow">{tr("Transport athlètes", "Athlete transport")}</p>
          <h1>{tr("Mes transports", "My pick-ups")}</h1>
          <p>{tr("Athlètes qui vous sont affectés à récupérer.", "Athletes assigned to you for pick-up.")}</p>
          {isAdmin && (
            <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8 }}>
              <label style={{ fontSize: "0.8rem", color: "#607086" }}>{tr("Édition :", "Edition:")}</label>
              <select
                value={viewEditionId}
                onChange={(e) => setViewEditionId(e.target.value)}
                style={{ width: "auto", fontSize: "0.85rem", padding: "3px 6px" }}
              >
                <option value={activeEditionId}>{tr("Courante", "Current")} ({activeEditionId})</option>
                {normalizeEditionId(activeEditionId) !== "test" && <option value="test">{tr("Exemple 2026", "Sample 2026")}</option>}
              </select>
            </div>
          )}
        </div>
      </section>

      {loading ? (
        <p className="panel-note">{tr("Chargement…", "Loading…")}</p>
      ) : myLots.length === 0 ? (
        <section className="panel">
          <div className="panel-head"><div><h3>{tr("Aucun lot assigné", "No group assigned")}</h3></div></div>
          <p className="panel-note">
            {tr("Aucun lot de transport ne vous est encore assigné. Le chef du transport vous contactera une fois votre lot prêt.", "No transport group assigned to you yet. The transport chief will contact you once your group is ready.")}
          </p>
        </section>
      ) : (
        myLots.map((lot) => {
          const total = (lot.athleteIds ?? []).length;
          const pickedCount = Object.values(lot.pickedUp ?? {}).filter(Boolean).length;
          return (
            <Panel
              key={lot.id}
              title={lot.label}
              subtitle={tr(
                `${pickedCount}/${total} athlète${total !== 1 ? "s" : ""} récupéré${pickedCount !== 1 ? "s" : ""}`,
                `${pickedCount}/${total} athlete${total !== 1 ? "s" : ""} picked up`,
              )}
            >
              {total > 0 && (
                <div style={{ marginBottom: "0.75rem" }}>
                  <div style={{
                    height: "8px",
                    background: "var(--color-border, #e0e0e0)",
                    borderRadius: "4px",
                    overflow: "hidden",
                  }}>
                    <div style={{
                      height: "100%",
                      width: `${(pickedCount / total) * 100}%`,
                      background: pickedCount === total ? "#22c55e" : "var(--color-primary, #3b82f6)",
                      borderRadius: "4px",
                      transition: "width 0.3s",
                    }} />
                  </div>
                </div>
              )}
              <LotAthletesList
                lot={lot}
                athleteMap={athleteMap}
                showPickedUp
                onTogglePickedUp={(athleteId, value) => {
                  if (savingId !== `${lot.id}:${athleteId}`) {
                    togglePickedUp(lot, athleteId, value);
                  }
                }}
                onToggleNoShow={(athleteId, value) => {
                  if (savingId !== `${lot.id}:${athleteId}`) {
                    toggleNoShow(lot, athleteId, value);
                  }
                }}
                onToggleDelayed={(athleteId, value) => {
                  if (savingId !== `${lot.id}:${athleteId}`) {
                    toggleDelayed(lot, athleteId, value);
                  }
                }}
              />
            </Panel>
          );
        })
      )}
    </div>
  );
}

export { AthleteTransportChiefPage, AthleteTransportVolunteerPage };
