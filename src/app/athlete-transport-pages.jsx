import { useMemo, useState } from "react";
import { addDoc, collection, deleteDoc, doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { useAuth } from "../context/auth-context";
import { getActiveRoles } from "./navigation";
import { useActiveEdition } from "./edition";
import { useMeetingEditions } from "./meeting-history-hooks";
import { db } from "../services/firebase";
import {
  ATHLETE_TRANSPORT_LOTS_COLLECTION,
  useAthletes,
  useAthleteTransportLots,
  useTransportVolunteers,
  formatTravelDay,
} from "./athlete-portal-hooks";

// ─── Chief page ───────────────────────────────────────────────────────────────

function AthleteTransportChiefPage({ Panel }) {
  const [tab, setTab] = useState("arrivals");
  const { lots, loading: lotsLoading } = useAthleteTransportLots();
  const { activeEditionId } = useActiveEdition();
  const { athletes, loading: athletesLoading } = useAthletes(true, activeEditionId);
  const { volunteers, loading: volunteersLoading } = useTransportVolunteers();
  const { editions: meetingEditions } = useMeetingEditions();
  const meetingReferenceDate = meetingEditions.find((e) => String(e.year) === String(activeEditionId))?.date;

  const athletesWithArrival = useMemo(
    () => athletes.filter((a) => a.arrivalDay || a.arrivalFlight || a.arrivalTime),
    [athletes],
  );

  const lotAthleteIds = useMemo(() => {
    const ids = new Set();
    lots.forEach((lot) => (lot.athleteIds ?? []).forEach((id) => ids.add(id)));
    return ids;
  }, [lots]);

  const athleteMap = useMemo(() => {
    const map = {};
    athletes.forEach((a) => { map[a.id] = a; });
    return map;
  }, [athletes]);

  return (
    <div className="page">
      <section className="page-header">
        <div>
          <p className="eyebrow">Athlete Portal</p>
          <h1>Transport</h1>
          <p>Gérez les lots de transport et les affectations des bénévoles.</p>
        </div>
      </section>

      <div className="admin-subtabs" style={{ marginBottom: "1.5rem" }}>
        <button
          type="button"
          className={`admin-subtab${tab === "arrivals" ? " admin-subtab--active" : ""}`}
          onClick={() => setTab("arrivals")}
        >
          Arrivées ({athletesWithArrival.length})
        </button>
        <button
          type="button"
          className={`admin-subtab${tab === "lots" ? " admin-subtab--active" : ""}`}
          onClick={() => setTab("lots")}
        >
          Lots ({lots.length})
        </button>
        <button
          type="button"
          className={`admin-subtab${tab === "volunteers" ? " admin-subtab--active" : ""}`}
          onClick={() => setTab("volunteers")}
        >
          Bénévoles ({volunteers.length})
        </button>
      </div>

      {tab === "arrivals" && (
        <ArrivalsTab
          Panel={Panel}
          athletes={athletesWithArrival}
          loading={athletesLoading}
          lots={lots}
          lotAthleteIds={lotAthleteIds}
          volunteers={volunteers}
          editionId={activeEditionId}
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
          editionId={activeEditionId}
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

// ─── Arrivées tab ─────────────────────────────────────────────────────────────

function ArrivalsTab({ Panel, athletes, loading, lots, lotAthleteIds, volunteers, editionId, meetingReferenceDate }) {
  const [dayFilter, setDayFilter] = useState("");
  const [flightFilter, setFlightFilter] = useState("");
  const [selected, setSelected] = useState(new Set());
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newLotLabel, setNewLotLabel] = useState("");
  const [newLotVolunteerId, setNewLotVolunteerId] = useState("");
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
    let label = "";
    if (flights.length === 1) label = `Vol ${flights[0]}`;
    if (times.length === 1) label += (label ? ` ${times[0]}` : `Arr. ${times[0]}`);
    if (days.length === 1) label += ` — ${formatTravelDay(days[0], meetingReferenceDate)}`;
    setNewLotLabel(label || `Lot du ${new Date().toLocaleDateString("fr-FR")}`);
    setNewLotVolunteerId("");
    setShowCreateForm(true);
  }

  async function createLot() {
    if (!newLotLabel.trim()) { setError("Un libellé est requis."); return; }
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
        pickedUp: {},
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setSelected(new Set());
      setShowCreateForm(false);
    } catch {
      setError("Erreur lors de la création du lot.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Panel
      title="Athlètes avec info d'arrivée"
      subtitle={`${athletes.length} athlètes · ${lotAthleteIds.size} dans un lot`}
      actions={
        selected.size > 0 && !showCreateForm
          ? <button type="button" className="btn btn--primary" onClick={openCreateForm}>Créer un lot ({selected.size})</button>
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
          <option value="">Tous les jours</option>
          {days.map((d) => <option key={d} value={d}>{formatTravelDay(d, meetingReferenceDate)}</option>)}
        </select>
        <input
          type="text"
          className="text-field"
          placeholder="Filtrer par vol…"
          value={flightFilter}
          onChange={(e) => setFlightFilter(e.target.value)}
          style={{ width: "160px" }}
        />
      </div>

      {showCreateForm && (
        <div className="panel" style={{ marginBottom: "1rem", background: "var(--color-bg-offset, #f5f5f5)", padding: "1rem" }}>
          <h4 style={{ marginTop: 0 }}>Nouveau lot — {selected.size} athlète(s)</h4>
          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", marginBottom: "0.75rem" }}>
            <input
              type="text"
              className="text-field"
              placeholder="Libellé du lot"
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
              <option value="">Bénévole — à assigner</option>
              {volunteers.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.firstName} {v.lastName}
                </option>
              ))}
            </select>
          </div>
          {error && <p style={{ color: "red", marginBottom: "0.5rem" }}>{error}</p>}
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button type="button" className="btn btn--primary" onClick={createLot} disabled={saving}>
              {saving ? "Création…" : "Créer le lot"}
            </button>
            <button type="button" className="btn" onClick={() => setShowCreateForm(false)}>Annuler</button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="panel-note">Chargement…</p>
      ) : filtered.length === 0 ? (
        <p className="panel-note">Aucun athlète avec info d'arrivée.</p>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>
                  <input type="checkbox" checked={selected.size === filtered.length && filtered.length > 0} onChange={toggleAll} />
                </th>
                <th>Nom</th>
                <th>Nat.</th>
                <th>Épreuve</th>
                <th>Jour</th>
                <th>Heure arr.</th>
                <th>Vol</th>
                <th>Depuis</th>
                <th>Lot</th>
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
                    <td>{a.event}</td>
                    <td>{a.arrivalDay ? formatTravelDay(a.arrivalDay, meetingReferenceDate) : "—"}</td>
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
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newLotLabel, setNewLotLabel] = useState("");
  const [newLotVolunteerId, setNewLotVolunteerId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [assigningLotId, setAssigningLotId] = useState(null);
  const [assignVolunteerId, setAssignVolunteerId] = useState("");
  const [expandedLotId, setExpandedLotId] = useState(null);

  async function createEmptyLot() {
    if (!newLotLabel.trim()) { setError("Un libellé est requis."); return; }
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
      setError("Erreur lors de la création du lot.");
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
    if (!window.confirm("Supprimer ce lot ? Les athlètes ne seront pas supprimés.")) return;
    await deleteDoc(doc(db, ATHLETE_TRANSPORT_LOTS_COLLECTION, lotId));
  }

  return (
    <Panel
      title="Lots de transport"
      actions={
        !showCreateForm
          ? <button type="button" className="btn btn--primary" onClick={() => setShowCreateForm(true)}>+ Nouveau lot</button>
          : null
      }
    >
      {showCreateForm && (
        <div className="panel" style={{ marginBottom: "1rem", background: "var(--color-bg-offset, #f5f5f5)", padding: "1rem" }}>
          <h4 style={{ marginTop: 0 }}>Nouveau lot vide</h4>
          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", marginBottom: "0.75rem" }}>
            <input
              type="text"
              className="text-field"
              placeholder="Libellé du lot"
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
              <option value="">Bénévole — à assigner</option>
              {volunteers.map((v) => (
                <option key={v.id} value={v.id}>{v.firstName} {v.lastName}</option>
              ))}
            </select>
          </div>
          {error && <p style={{ color: "red", marginBottom: "0.5rem" }}>{error}</p>}
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button type="button" className="btn btn--primary" onClick={createEmptyLot} disabled={saving}>
              {saving ? "Création…" : "Créer le lot"}
            </button>
            <button type="button" className="btn" onClick={() => setShowCreateForm(false)}>Annuler</button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="panel-note">Chargement…</p>
      ) : lots.length === 0 ? (
        <p className="panel-note">Aucun lot créé. Sélectionnez des athlètes dans l'onglet Arrivées pour créer un lot.</p>
      ) : (
        <ul className="compact-list" style={{ listStyle: "none", padding: 0 }}>
          {lots.map((lot) => {
            const pickedCount = Object.values(lot.pickedUp ?? {}).filter(Boolean).length;
            const total = (lot.athleteIds ?? []).length;
            const isExpanded = expandedLotId === lot.id;
            const isAssigning = assigningLotId === lot.id;

            return (
              <li key={lot.id} style={{ borderBottom: "1px solid var(--color-border, #e0e0e0)", padding: "0.75rem 0" }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: "0.75rem", flexWrap: "wrap" }}>
                  <div style={{ flex: 1 }}>
                    <strong>{lot.label}</strong>
                    <span style={{ marginLeft: "0.5rem", color: "#888", fontSize: "0.85em" }}>
                      {total} athlète{total !== 1 ? "s" : ""} · {pickedCount}/{total} récupéré{pickedCount !== 1 ? "s" : ""}
                    </span>
                    <br />
                    <span style={{ fontSize: "0.85em", color: lot.assignedVolunteerName ? "#333" : "#aaa" }}>
                      {lot.assignedVolunteerName ? `Bénévole : ${lot.assignedVolunteerName}` : "Bénévole non assigné"}
                    </span>
                  </div>
                  <div style={{ display: "flex", gap: "0.5rem", flexShrink: 0 }}>
                    <button
                      type="button"
                      className="btn"
                      style={{ fontSize: "0.8em" }}
                      onClick={() => setExpandedLotId(isExpanded ? null : lot.id)}
                    >
                      {isExpanded ? "Réduire" : `Athlètes (${total})`}
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
                      {isAssigning ? "Annuler" : "Assigner"}
                    </button>
                    <button
                      type="button"
                      className="btn btn--danger"
                      style={{ fontSize: "0.8em" }}
                      onClick={() => deleteLot(lot.id)}
                    >
                      Supprimer
                    </button>
                  </div>
                </div>

                {isAssigning && (
                  <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem", alignItems: "center" }}>
                    <select
                      className="select-field"
                      value={assignVolunteerId}
                      onChange={(e) => setAssignVolunteerId(e.target.value)}
                      style={{ flex: 1, maxWidth: "300px" }}
                    >
                      <option value="">— Aucun bénévole —</option>
                      {volunteers.map((v) => (
                        <option key={v.id} value={v.id}>{v.firstName} {v.lastName}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="btn btn--primary"
                      style={{ fontSize: "0.85em" }}
                      onClick={() => assignVolunteer(lot)}
                    >
                      Confirmer
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
  function getLotsForVolunteer(uid) {
    return lots.filter((lot) => lot.assignedVolunteerId === uid);
  }

  return (
    <Panel title="Bénévoles transport athlètes">
      {loading ? (
        <p className="panel-note">Chargement…</p>
      ) : volunteers.length === 0 ? (
        <p className="panel-note">
          Aucun bénévole avec le rôle <em>benevole_transport_athletes</em> trouvé.
          Assignez ce rôle via la gestion des rôles plateforme.
        </p>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Nom</th>
                <th>Email</th>
                <th>Téléphone</th>
                <th>Lots assignés</th>
              </tr>
            </thead>
            <tbody>
              {volunteers.map((v) => {
                const myLots = getLotsForVolunteer(v.id);
                return (
                  <tr key={v.id}>
                    <td>{v.firstName} {v.lastName}</td>
                    <td>{v.email ?? "—"}</td>
                    <td>{v.phone ?? "—"}</td>
                    <td>
                      {myLots.length === 0
                        ? <span style={{ color: "#aaa" }}>Aucun</span>
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

function LotAthletesList({ lot, athleteMap, showPickedUp = false, onTogglePickedUp }) {
  const athleteIds = lot.athleteIds ?? [];

  if (athleteIds.length === 0) {
    return <p className="panel-note" style={{ marginTop: "0.5rem" }}>Aucun athlète dans ce lot.</p>;
  }

  return (
    <div className="table-wrap" style={{ marginTop: "0.5rem" }}>
      <table className="data-table">
        <thead>
          <tr>
            {showPickedUp && <th>Récupéré</th>}
            <th>Nom</th>
            <th>Nat.</th>
            <th>Épreuve</th>
            <th>Vol arr.</th>
            <th>Heure arr.</th>
            <th>Depuis</th>
          </tr>
        </thead>
        <tbody>
          {athleteIds.map((id) => {
            const a = athleteMap[id];
            const picked = !!(lot.pickedUp ?? {})[id];
            if (!a) return null;
            return (
              <tr key={id} style={picked ? { opacity: 0.55 } : undefined}>
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
                          {picked ? "✓ Récupéré" : "En attente"}
                        </button>
                      )
                      : <span>{picked ? "✓" : "—"}</span>
                    }
                  </td>
                )}
                <td>{a.lastName} {a.firstName}</td>
                <td>{a.nationality}</td>
                <td>{a.event}</td>
                <td>{a.arrivalFlight ?? "—"}</td>
                <td>{a.arrivalTime ?? "—"}</td>
                <td>{a.arrivalFrom ?? "—"}</td>
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
  const { currentUser } = useAuth();
  const { lots, loading: lotsLoading } = useAthleteTransportLots();
  const { activeEditionId } = useActiveEdition();
  const { athletes, loading: athletesLoading } = useAthletes(true, activeEditionId);
  const [savingId, setSavingId] = useState(null);

  const athleteMap = useMemo(() => {
    const map = {};
    athletes.forEach((a) => { map[a.id] = a; });
    return map;
  }, [athletes]);

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

  const loading = lotsLoading || athletesLoading;

  return (
    <div className="page">
      <section className="page-header">
        <div>
          <p className="eyebrow">Transport athlètes</p>
          <h1>Mes transports</h1>
          <p>Athlètes qui vous sont affectés à récupérer.</p>
        </div>
      </section>

      {loading ? (
        <p className="panel-note">Chargement…</p>
      ) : myLots.length === 0 ? (
        <section className="panel">
          <div className="panel-head"><div><h3>Aucun lot assigné</h3></div></div>
          <p className="panel-note">
            Aucun lot de transport ne vous est encore assigné. Le chef du transport vous contactera une fois votre lot prêt.
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
              subtitle={`${pickedCount}/${total} athlète${total !== 1 ? "s" : ""} récupéré${pickedCount !== 1 ? "s" : ""}`}
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
              />
            </Panel>
          );
        })
      )}
    </div>
  );
}

export { AthleteTransportChiefPage, AthleteTransportVolunteerPage };
