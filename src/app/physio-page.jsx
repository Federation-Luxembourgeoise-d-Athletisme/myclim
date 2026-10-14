import { useEffect, useMemo, useState } from "react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "../services/firebase";
import { useAuth } from "../context/auth-context";
import { useActiveEdition } from "./edition";
import { AuthFormField } from "./form-components";
import { getActiveRoles } from "./navigation";
import {
  PHYSIO_SLOT_LENGTH_OPTIONS,
  buildPhysioBookingId,
  buildSessionSlots,
  formatPhysioDate,
  listSessionDates,
  timeToMinutes,
  validatePhysioSession,
} from "./physio-helpers";

const EMPTY_SESSION_FORM = { date: "", start: "16:00", end: "19:00", slotMinutes: 20, location: "" };

function mapSnapshot(snapshot) {
  return snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
}

function personName(firstName, lastName) {
  return [firstName, lastName].filter(Boolean).join(" ");
}

function PhysioPage({ Panel }) {
  const { currentUser, userProfile } = useAuth();
  const roles = getActiveRoles(userProfile);
  const isManager = roles.includes("admin") || roles.includes("gestionnaire");
  const { activeEditionId, activeEditionLabel, loading: editionLoading } = useActiveEdition(true);
  const [sessions, setSessions] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [activeTab, setActiveTab] = useState("planning");
  const [selectedDate, setSelectedDate] = useState("");
  const [sessionForm, setSessionForm] = useState(EMPTY_SESSION_FORM);
  const [walkIn, setWalkIn] = useState(null);
  const [busyKey, setBusyKey] = useState("");
  const [error, setError] = useState("");
  const [statusMessage, setStatusMessage] = useState("");

  useEffect(() => {
    if (editionLoading) return undefined;
    const byEdition = (name) => query(collection(db, name), where("editionId", "==", activeEditionId));
    const fail = (label) => (snapshotError) => {
      console.error(`Unable to load ${label}`, snapshotError);
      setError(`Impossible de charger ${label}.`);
    };
    const unsubscribers = [
      onSnapshot(byEdition("physioSessions"), (snapshot) => setSessions(mapSnapshot(snapshot)), fail("les horaires")),
      onSnapshot(byEdition("physioBookings"), (snapshot) => setBookings(mapSnapshot(snapshot)), fail("les réservations")),
    ];
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [activeEditionId, editionLoading]);

  const dates = useMemo(() => listSessionDates(sessions), [sessions]);
  const dayKey = dates.includes(selectedDate) ? selectedDate : dates[0] || "";
  const bookingsById = useMemo(() => new Map(bookings.map((booking) => [booking.id, booking])), [bookings]);

  // Planning du jour : une colonne par kiné, une ligne par horaire de début.
  const planning = useMemo(() => {
    const daySessions = sessions.filter((session) => session.date === dayKey);
    const physios = new Map();
    const starts = new Set();
    daySessions.forEach((session) => {
      const column = physios.get(session.physioUid) || { physioUid: session.physioUid, physioName: session.physioName, cells: new Map(), locations: new Set() };
      column.locations.add(session.location);
      buildSessionSlots(session).forEach((slot) => {
        starts.add(slot.start);
        column.cells.set(slot.start, { session, slot, booking: bookingsById.get(buildPhysioBookingId(session.id, slot.start)) || null });
      });
      physios.set(session.physioUid, column);
    });
    return {
      columns: [...physios.values()].sort((left, right) => String(left.physioName).localeCompare(String(right.physioName))),
      starts: [...starts].sort((left, right) => timeToMinutes(left) - timeToMinutes(right)),
    };
  }, [bookingsById, dayKey, sessions]);

  const dayBookingCount = bookings.filter((booking) => booking.date === dayKey && booking.status !== "cancelled").length;

  const mySessions = useMemo(
    () =>
      sessions
        .filter((session) => isManager || session.physioUid === currentUser?.uid)
        .sort((left, right) => `${left.date}${left.start}`.localeCompare(`${right.date}${right.start}`)),
    [currentUser?.uid, isManager, sessions],
  );

  function countSessionBookings(session) {
    return buildSessionSlots(session).filter((slot) => {
      const booking = bookingsById.get(buildPhysioBookingId(session.id, slot.start));
      return booking && booking.status !== "cancelled";
    }).length;
  }

  async function runAction(key, action, successMessage) {
    setBusyKey(key);
    setError("");
    setStatusMessage("");
    try {
      await action();
      if (successMessage) setStatusMessage(successMessage);
    } catch (actionError) {
      console.error(`Physio action ${key} failed`, actionError);
      setError(actionError?.userMessage || "Action impossible. Vérifie ta connexion puis réessaie.");
    } finally {
      setBusyKey("");
    }
  }

  function handleCreateSession(event) {
    event.preventDefault();
    const payload = { ...sessionForm, slotMinutes: Number(sessionForm.slotMinutes), location: sessionForm.location.trim() };
    const validationError = validatePhysioSession(payload);
    if (validationError) {
      setError(validationError);
      return undefined;
    }
    return runAction(
      "session",
      async () => {
        await addDoc(collection(db, "physioSessions"), {
          ...payload,
          editionId: activeEditionId,
          physioUid: currentUser.uid,
          physioName: personName(userProfile?.firstName, userProfile?.lastName) || currentUser.email || "Kiné",
          createdAt: serverTimestamp(),
        });
        setSessionForm((current) => ({ ...EMPTY_SESSION_FORM, date: current.date, location: current.location }));
      },
      "Plage ajoutée : les athlètes peuvent réserver ces créneaux.",
    );
  }

  function handleDeleteSession(session) {
    const booked = countSessionBookings(session);
    if (booked) {
      setError(`Cette plage a ${booked} réservation(s). Annule-les d'abord dans le planning.`);
      return undefined;
    }
    if (!window.confirm(`Supprimer la plage du ${formatPhysioDate(session.date)} (${session.start}–${session.end}) ?`)) return undefined;
    return runAction(`session-${session.id}`, () => deleteDoc(doc(db, "physioSessions", session.id)), "Plage supprimée.");
  }

  function handleMarkDone(booking) {
    return runAction(`booking-${booking.id}`, () =>
      updateDoc(doc(db, "physioBookings", booking.id), {
        status: booking.status === "done" ? "booked" : "done",
        updatedAt: serverTimestamp(),
      }),
    );
  }

  function handleCancelBooking(booking) {
    const name = personName(booking.athleteFirstName, booking.athleteLastName);
    if (!window.confirm(`Annuler le créneau de ${name} (${booking.start}) ? Le créneau redevient libre.`)) return undefined;
    return runAction(`booking-${booking.id}`, () => deleteDoc(doc(db, "physioBookings", booking.id)), "Créneau libéré.");
  }

  function handleWalkInSubmit(event) {
    event.preventDefault();
    const firstName = walkIn.firstName.trim();
    const lastName = walkIn.lastName.trim();
    if (!firstName || !lastName) {
      setError("Indique le prénom et le nom de l'athlète.");
      return undefined;
    }
    const { session, slot } = walkIn;
    const ref = doc(db, "physioBookings", buildPhysioBookingId(session.id, slot.start));
    return runAction(
      "walk-in",
      async () => {
        await runTransaction(db, async (transaction) => {
          const snapshot = await transaction.get(ref);
          if (snapshot.exists() && snapshot.data().status !== "cancelled") {
            const taken = new Error("slot-taken");
            taken.userMessage = "Ce créneau vient d'être réservé par un athlète.";
            throw taken;
          }
          transaction.set(ref, {
            editionId: activeEditionId,
            sessionId: session.id,
            physioUid: session.physioUid,
            physioName: session.physioName,
            date: session.date,
            start: slot.start,
            end: slot.end,
            location: session.location,
            athleteId: "",
            athleteFirstName: firstName,
            athleteLastName: lastName,
            athleteEvent: walkIn.event.trim(),
            status: "booked",
            source: "physio",
            createdBy: currentUser.uid,
            createdAt: serverTimestamp(),
          });
        });
        setWalkIn(null);
      },
      `${firstName} ${lastName} ajouté(e) à ${slot.start}.`,
    );
  }

  return (
    <div className="page">
      <section className="page-header">
        <div>
          <p className="eyebrow">Kiné · {activeEditionLabel}</p>
          <h1>Réservations kiné</h1>
          <p>
            Les athlètes réservent depuis « Mes réservations » du roadbook. Quand plusieurs kinés sont ouverts au même
            horaire, l'athlète est attribué automatiquement à un kiné libre, et voit le lieu de ce kiné.
          </p>
        </div>
      </section>

      {error ? <p className="form-error">{error}</p> : null}
      {statusMessage ? <p className="panel-note panel-note--success">{statusMessage}</p> : null}

      <div className="admin-subtabs" role="tablist" aria-label="Sections kiné">
        <button type="button" className={`admin-subtab ${activeTab === "planning" ? "admin-subtab--active" : ""}`} onClick={() => setActiveTab("planning")}>
          Planning
        </button>
        <button type="button" className={`admin-subtab ${activeTab === "horaires" ? "admin-subtab--active" : ""}`} onClick={() => setActiveTab("horaires")}>
          {isManager ? "Horaires des kinés" : "Mes horaires"}
        </button>
      </div>

      {activeTab === "planning" ? (
        <Panel
          title={dayKey ? formatPhysioDate(dayKey) : "Planning"}
          subtitle={dayKey ? `${dayBookingCount} réservation(s) ce jour-là.` : "Aucune plage d'ouverture pour l'instant : ajoute tes horaires."}
        >
          {dates.length > 1 ? (
            <div className="physio-days">
              {dates.map((date) => (
                <button key={date} type="button" className={`physio-day ${date === dayKey ? "physio-day--active" : ""}`} onClick={() => setSelectedDate(date)}>
                  {formatPhysioDate(date, "fr", { weekday: "short", day: "numeric", month: "short" })}
                </button>
              ))}
            </div>
          ) : null}

          {walkIn ? (
            <form className="auth-form auth-form--compact physio-walkin" onSubmit={handleWalkInSubmit}>
              <p>
                Athlète sans réservation · <strong>{walkIn.slot.start}</strong> avec {walkIn.session.physioName}
              </p>
              <AuthFormField label="Prénom" required>
                <input autoFocus value={walkIn.firstName} onChange={(event) => setWalkIn((current) => ({ ...current, firstName: event.target.value }))} />
              </AuthFormField>
              <AuthFormField label="Nom" required>
                <input value={walkIn.lastName} onChange={(event) => setWalkIn((current) => ({ ...current, lastName: event.target.value }))} />
              </AuthFormField>
              <AuthFormField label="Épreuve">
                <input value={walkIn.event} onChange={(event) => setWalkIn((current) => ({ ...current, event: event.target.value }))} />
              </AuthFormField>
              <div className="physio-actions">
                <button className="button button--primary button--small" type="submit" disabled={busyKey === "walk-in"}>
                  Réserver
                </button>
                <button className="button button--secondary button--small" type="button" onClick={() => setWalkIn(null)}>
                  Annuler
                </button>
              </div>
            </form>
          ) : null}

          {planning.columns.length ? (
            <div className="table-wrap">
              <table className="data-table physio-planning">
                <thead>
                  <tr>
                    <th>Heure</th>
                    {planning.columns.map((column) => (
                      <th key={column.physioUid}>
                        {column.physioName}
                        <small>{[...column.locations].join(" · ")}</small>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {planning.starts.map((start) => (
                    <tr key={start}>
                      <td className="physio-planning__time">{start}</td>
                      {planning.columns.map((column) => {
                        const cell = column.cells.get(start);
                        if (!cell) return <td key={column.physioUid} className="physio-cell physio-cell--closed">—</td>;
                        const { booking } = cell;
                        if (!booking || booking.status === "cancelled") {
                          return (
                            <td key={column.physioUid} className="physio-cell physio-cell--free">
                              <button
                                type="button"
                                className="physio-cell__add"
                                onClick={() => setWalkIn({ session: cell.session, slot: cell.slot, firstName: "", lastName: "", event: "" })}
                              >
                                Libre · + athlète
                              </button>
                            </td>
                          );
                        }
                        const isBusy = busyKey === `booking-${booking.id}`;
                        return (
                          <td key={column.physioUid} className={`physio-cell ${booking.status === "done" ? "physio-cell--done" : "physio-cell--booked"}`}>
                            <strong>{personName(booking.athleteFirstName, booking.athleteLastName)}</strong>
                            <small>
                              {booking.athleteEvent || ""}
                              {booking.source === "physio" ? " · ajouté par un kiné" : ""}
                            </small>
                            <div className="physio-actions">
                              <button type="button" className="button button--secondary button--small" disabled={isBusy} onClick={() => handleMarkDone(booking)}>
                                {booking.status === "done" ? "↺ À faire" : "✓ Fait"}
                              </button>
                              <button type="button" className="button button--danger-soft button--small" disabled={isBusy} onClick={() => handleCancelBooking(booking)}>
                                Annuler
                              </button>
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </Panel>
      ) : (
        <>
          {roles.includes("kine") || isManager ? (
            <Panel title="Ajouter une plage d'ouverture" subtitle="Les créneaux sont découpés automatiquement selon la durée choisie.">
              <form className="auth-form auth-form--compact physio-form" onSubmit={handleCreateSession}>
                <AuthFormField label="Jour" required>
                  <input type="date" value={sessionForm.date} onChange={(event) => setSessionForm((current) => ({ ...current, date: event.target.value }))} />
                </AuthFormField>
                <AuthFormField label="Ouverture" required>
                  <input type="time" step="300" value={sessionForm.start} onChange={(event) => setSessionForm((current) => ({ ...current, start: event.target.value }))} />
                </AuthFormField>
                <AuthFormField label="Fermeture" required>
                  <input type="time" step="300" value={sessionForm.end} onChange={(event) => setSessionForm((current) => ({ ...current, end: event.target.value }))} />
                </AuthFormField>
                <AuthFormField label="Durée d'un créneau" required>
                  <select value={sessionForm.slotMinutes} onChange={(event) => setSessionForm((current) => ({ ...current, slotMinutes: Number(event.target.value) }))}>
                    {PHYSIO_SLOT_LENGTH_OPTIONS.map((minutes) => (
                      <option key={minutes} value={minutes}>{minutes} min</option>
                    ))}
                  </select>
                </AuthFormField>
                <AuthFormField label="Lieu" required>
                  <input
                    value={sessionForm.location}
                    placeholder="Salle kiné, Coque niveau 0"
                    onChange={(event) => setSessionForm((current) => ({ ...current, location: event.target.value }))}
                  />
                </AuthFormField>
                <button className="button button--primary" type="submit" disabled={busyKey === "session"}>
                  Ajouter
                </button>
              </form>
              {sessionForm.date && validatePhysioSession({ ...sessionForm, location: sessionForm.location || "x" }) === "" ? (
                <p className="panel-note">{buildSessionSlots(sessionForm).length} créneau(x) de {sessionForm.slotMinutes} min.</p>
              ) : null}
            </Panel>
          ) : null}

          <Panel title={isManager ? "Toutes les plages" : "Mes plages"}>
            {mySessions.length ? (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Jour</th>
                      {isManager ? <th>Kiné</th> : null}
                      <th>Horaires</th>
                      <th>Créneaux</th>
                      <th>Lieu</th>
                      <th>Réservés</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {mySessions.map((session) => (
                      <tr key={session.id}>
                        <td>{formatPhysioDate(session.date, "fr", { weekday: "short", day: "numeric", month: "short" })}</td>
                        {isManager ? <td>{session.physioName}</td> : null}
                        <td>{session.start} – {session.end}</td>
                        <td>{buildSessionSlots(session).length} × {session.slotMinutes} min</td>
                        <td>{session.location}</td>
                        <td>{countSessionBookings(session)}</td>
                        <td>
                          <button type="button" className="button button--danger-soft button--small" disabled={busyKey === `session-${session.id}`} onClick={() => handleDeleteSession(session)}>
                            Supprimer
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="panel-note">Aucune plage pour l'instant.</p>
            )}
          </Panel>
        </>
      )}
    </div>
  );
}

export { PhysioPage };
