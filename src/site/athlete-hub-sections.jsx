import { useCallback, useEffect, useMemo, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "../services/firebase";
import { formatPhysioDate } from "../app/physio-helpers";

// « Mes réservations » du roadbook : kiné + places gratuites. L'athlète
// s'identifie (nom + année de naissance) ; le pass signé renvoyé par le
// serveur est gardé sur le téléphone, qui peut en garder plusieurs.

const PASSES_STORAGE_KEY = "myclim-athlete-passes";

const HUB_COPY = {
  en: {
    eyebrow: "My bookings",
    physioTitle: "Physio booking",
    ticketsTitle: "Free tickets for your guests",
    identifyTitle: "Who are you?",
    identifyText: "Enter your last name and year of birth as registered by the meeting. Your phone will remember you.",
    lastName: "Last name",
    birthYear: "Year of birth",
    identify: "Continue",
    identifying: "Checking…",
    chooseAthlete: "Several athletes match. Which one are you?",
    addAthlete: "+ Another athlete",
    forget: "Remove from this phone",
    loading: "Loading your bookings…",
    yourSlot: "Your slot",
    cancel: "Cancel",
    noSlots: "Physio slots will open soon.",
    full: "Full",
    placesLeft: (count) => `${count} place${count > 1 ? "s" : ""} left`,
    yourBooking: "Your booking",
    oneByDay: "One booking per day. You can cancel at any time to free the slot for another athlete.",
    alreadyToday: "You already have a slot that day",
    ticketsText: "You can invite up to 2 people. Their names will be on the guest list at the public entrance: they just give their name, no ticket to print.",
    firstName: "First name",
    guestLastName: "Last name",
    email: "Email (optional)",
    admitted: "Already entered",
    save: "Save my guests",
    saving: "Saving…",
    saved: "Guests saved.",
    used: (used, max) => `${used} of ${max} places used`,
    identifyFirst: "Identify yourself in the physio section above to invite your guests.",
    errors: {
      "not-found": "No athlete found with this name and year of birth. Check the spelling or ask the athlete desk.",
      "resource-exhausted": "This slot was just taken. Pick another one.",
      "already-exists": "You already have a physio slot that day.",
      "invalid-argument": "Fill in the first and last name of each guest.",
      "failed-precondition": "A guest who has already entered can't be changed.",
      unauthenticated: "Please identify yourself again.",
      default: "Something went wrong. Check your connection and try again.",
    },
  },
  fr: {
    eyebrow: "Mes réservations",
    physioTitle: "Réservation kiné",
    ticketsTitle: "Places gratuites pour tes invités",
    identifyTitle: "Qui es-tu ?",
    identifyText: "Indique ton nom et ton année de naissance tels qu'enregistrés par le meeting. Ton téléphone s'en souviendra.",
    lastName: "Nom",
    birthYear: "Année de naissance",
    identify: "Continuer",
    identifying: "Vérification…",
    chooseAthlete: "Plusieurs athlètes correspondent. Lequel es-tu ?",
    addAthlete: "+ Autre athlète",
    forget: "Retirer de ce téléphone",
    loading: "Chargement de tes réservations…",
    yourSlot: "Ton créneau",
    cancel: "Annuler",
    noSlots: "Les créneaux kiné seront ouverts prochainement.",
    full: "Complet",
    placesLeft: (count) => `${count} place${count > 1 ? "s" : ""} libre${count > 1 ? "s" : ""}`,
    yourBooking: "Ta réservation",
    oneByDay: "Une réservation par jour. Tu peux annuler à tout moment pour libérer le créneau.",
    alreadyToday: "Tu as déjà un créneau ce jour-là",
    ticketsText: "Tu peux inviter jusqu'à 2 personnes. Leurs noms seront sur la liste des invités à l'entrée public : elles donnent simplement leur nom, aucun billet à imprimer.",
    firstName: "Prénom",
    guestLastName: "Nom",
    email: "E-mail (facultatif)",
    admitted: "Déjà entré(e)",
    save: "Enregistrer mes invités",
    saving: "Enregistrement…",
    saved: "Invités enregistrés.",
    used: (used, max) => `${used} place${used > 1 ? "s" : ""} utilisée${used > 1 ? "s" : ""} sur ${max}`,
    identifyFirst: "Identifie-toi dans la partie kiné ci-dessus pour inviter tes proches.",
    errors: {
      "not-found": "Aucun athlète trouvé avec ce nom et cette année de naissance. Vérifie l'orthographe ou demande à l'accueil athlètes.",
      "resource-exhausted": "Ce créneau vient d'être pris. Choisis-en un autre.",
      "already-exists": "Tu as déjà un créneau kiné ce jour-là.",
      "invalid-argument": "Indique le prénom et le nom de chaque invité.",
      "failed-precondition": "Un invité déjà entré ne peut plus être modifié.",
      unauthenticated: "Identifie-toi à nouveau.",
      default: "Une erreur est survenue. Vérifie ta connexion et réessaie.",
    },
  },
};

function readPasses() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(PASSES_STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter((entry) => entry?.pass && entry?.athlete?.id) : [];
  } catch {
    return [];
  }
}

function writePasses(passes) {
  try {
    window.localStorage.setItem(PASSES_STORAGE_KEY, JSON.stringify(passes));
  } catch {
    // Navigation privée : les pass restent en mémoire pour cette visite.
  }
}

function errorCode(error) {
  return String(error?.code || "").replace(/^functions\//, "");
}

function callHub(name, data) {
  return httpsCallable(functions, name)(data).then((response) => response.data);
}

function emptyGuest() {
  return { firstName: "", lastName: "", email: "", admitted: false };
}

function IdentifyForm({ copy, onIdentified }) {
  const [lastName, setLastName] = useState("");
  const [birthYear, setBirthYear] = useState("");
  const [candidates, setCandidates] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function identify(athleteId = "") {
    setSubmitting(true);
    setError("");
    try {
      const result = await callHub("identifyAthlete", { lastName, birthYear, athleteId });
      if (result.candidates) {
        setCandidates(result.candidates);
      } else {
        onIdentified({ pass: result.pass, athlete: result.athlete });
      }
    } catch (identifyError) {
      setError(copy.errors[errorCode(identifyError)] || copy.errors.default);
    } finally {
      setSubmitting(false);
    }
  }

  function handleSubmit(event) {
    event.preventDefault();
    if (!lastName.trim() || !/^\d{4}$/.test(birthYear.trim())) return;
    setCandidates(null);
    identify();
  }

  return (
    <div className="rb-hub-identify">
      <h3>👋 {copy.identifyTitle}</h3>
      <p className="rb-muted">{copy.identifyText}</p>
      <form onSubmit={handleSubmit}>
        <label>
          <span>{copy.lastName}</span>
          <input value={lastName} autoComplete="family-name" onChange={(event) => setLastName(event.target.value)} />
        </label>
        <label>
          <span>{copy.birthYear}</span>
          <input
            value={birthYear}
            inputMode="numeric"
            maxLength={4}
            placeholder="1998"
            onChange={(event) => setBirthYear(event.target.value.replace(/\D/g, ""))}
          />
        </label>
        <button className="rb-btn" type="submit" disabled={submitting || !lastName.trim() || birthYear.length !== 4}>
          {submitting ? copy.identifying : copy.identify}
        </button>
      </form>
      {candidates ? (
        <div className="rb-hub-candidates">
          <p>{copy.chooseAthlete}</p>
          {candidates.map((candidate) => (
            <button key={candidate.id} type="button" className="rb-chip" disabled={submitting} onClick={() => identify(candidate.id)}>
              {candidate.firstName} {candidate.lastName}
              {candidate.event ? ` · ${candidate.event}` : ""}
            </button>
          ))}
        </div>
      ) : null}
      {error ? <p className="rb-hub-error">{error}</p> : null}
    </div>
  );
}

function AthleteHubSections({ language, indexOffset }) {
  const copy = HUB_COPY[language] || HUB_COPY.en;
  const [passes, setPasses] = useState(readPasses);
  const [activeAthleteId, setActiveAthleteId] = useState(() => readPasses()[0]?.athlete.id || "");
  const [addingAthlete, setAddingAthlete] = useState(false);
  const [hub, setHub] = useState(null);
  const [loadingHub, setLoadingHub] = useState(false);
  const [selectedDate, setSelectedDate] = useState("");
  const [busy, setBusy] = useState("");
  const [physioError, setPhysioError] = useState("");
  const [guests, setGuests] = useState([emptyGuest(), emptyGuest()]);
  const [guestMessage, setGuestMessage] = useState(null);

  const activePass = passes.find((entry) => entry.athlete.id === activeAthleteId) || passes[0] || null;

  function savePasses(next) {
    setPasses(next);
    writePasses(next);
  }

  const forgetAthlete = useCallback(
    (athleteId) => {
      setPasses((current) => {
        const next = current.filter((entry) => entry.athlete.id !== athleteId);
        writePasses(next);
        return next;
      });
      setHub(null);
    },
    [],
  );

  const loadHub = useCallback(
    async (entry) => {
      if (!entry) return;
      setLoadingHub(true);
      setPhysioError("");
      try {
        const data = await callHub("getAthleteHub", { pass: entry.pass });
        setHub({ athleteId: entry.athlete.id, ...data });
        const nextGuests = Array.from({ length: data.maxGuests || 2 }, (_, index) => ({ ...emptyGuest(), ...(data.guests?.[index] || {}) }));
        setGuests(nextGuests);
      } catch (hubError) {
        if (errorCode(hubError) === "unauthenticated") {
          forgetAthlete(entry.athlete.id);
        } else {
          setPhysioError(copy.errors.default);
        }
      } finally {
        setLoadingHub(false);
      }
    },
    [copy.errors.default, forgetAthlete],
  );

  const activePassKey = activePass?.pass || "";
  useEffect(() => {
    if (activePass) loadHub(activePass);
    // Recharge seulement quand l'athlète actif change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePassKey]);

  function handleIdentified(entry) {
    const next = [entry, ...passes.filter((existing) => existing.athlete.id !== entry.athlete.id)];
    savePasses(next);
    setActiveAthleteId(entry.athlete.id);
    setAddingAthlete(false);
  }

  const hubIsCurrent = hub && activePass && hub.athleteId === activePass.athlete.id;
  const availability = useMemo(() => (hubIsCurrent ? hub.availability || [] : []), [hub, hubIsCurrent]);
  const myBookings = hubIsCurrent ? hub.bookings || [] : [];
  const dayKey = availability.some((day) => day.date === selectedDate) ? selectedDate : availability[0]?.date || "";
  const daySlots = availability.find((day) => day.date === dayKey)?.slots || [];
  const myBookingOnDay = myBookings.find((booking) => booking.date === dayKey) || null;

  async function bookSlot(slot) {
    setBusy(`slot-${slot.start}`);
    setPhysioError("");
    try {
      await callHub("bookPhysioSlot", { pass: activePass.pass, date: dayKey, start: slot.start });
      await loadHub(activePass);
    } catch (bookError) {
      setPhysioError(copy.errors[errorCode(bookError)] || copy.errors.default);
      await loadHub(activePass);
    } finally {
      setBusy("");
    }
  }

  async function cancelBooking(booking) {
    setBusy(`cancel-${booking.id}`);
    setPhysioError("");
    try {
      await callHub("cancelPhysioBooking", { pass: activePass.pass, bookingId: booking.id });
      await loadHub(activePass);
    } catch (cancelError) {
      setPhysioError(copy.errors[errorCode(cancelError)] || copy.errors.default);
    } finally {
      setBusy("");
    }
  }

  async function saveGuests(event) {
    event.preventDefault();
    setBusy("guests");
    setGuestMessage(null);
    try {
      const result = await callHub("saveAthleteGuests", {
        pass: activePass.pass,
        guests: guests.map(({ firstName, lastName, email }) => ({ firstName, lastName, email })),
      });
      setGuests((current) => current.map((_, index) => ({ ...emptyGuest(), ...(result.guests?.[index] || {}) })));
      setGuestMessage({ type: "ok", text: copy.saved });
    } catch (saveError) {
      setGuestMessage({ type: "error", text: copy.errors[errorCode(saveError)] || copy.errors.default });
    } finally {
      setBusy("");
    }
  }

  const showIdentify = !activePass || addingAthlete;
  const usedPlaces = guests.filter((guest) => guest.firstName && guest.lastName).length;
  const athleteBanner = activePass ? (
    <div className="rb-hub-who">
      <div className="rb-hub-avatar">
        {(activePass.athlete.firstName?.[0] || "") + (activePass.athlete.lastName?.[0] || "")}
      </div>
      <div>
        <b>
          {activePass.athlete.firstName} {activePass.athlete.lastName}
        </b>
        {activePass.athlete.event ? <small>{activePass.athlete.event}</small> : null}
      </div>
      <div className="rb-hub-who__actions">
        {passes.length > 1
          ? passes
              .filter((entry) => entry.athlete.id !== activePass.athlete.id)
              .map((entry) => (
                <button key={entry.athlete.id} type="button" className="rb-chip" onClick={() => setActiveAthleteId(entry.athlete.id)}>
                  {entry.athlete.firstName} {entry.athlete.lastName}
                </button>
              ))
          : null}
        <button type="button" className="rb-chip" onClick={() => setAddingAthlete((current) => !current)}>
          {copy.addAthlete}
        </button>
        <button type="button" className="rb-chip rb-chip--quiet" onClick={() => forgetAthlete(activePass.athlete.id)}>
          {copy.forget}
        </button>
      </div>
    </div>
  ) : null;

  return (
    <>
      <section id="physio" className="rb-section">
        <div className="rb-sh">
          <p className="rb-eyebrow">{String(indexOffset + 1).padStart(2, "0")} · 💆 {copy.eyebrow}</p>
          <h2>{copy.physioTitle}</h2>
        </div>

        {athleteBanner}
        {showIdentify ? <IdentifyForm copy={copy} onIdentified={handleIdentified} /> : null}

        {activePass && !addingAthlete ? (
          loadingHub && !hubIsCurrent ? (
            <p className="rb-muted">{copy.loading}</p>
          ) : (
            <>
              {myBookings.map((booking) => (
                <div key={booking.id} className="rb-hub-booked">
                  <span>
                    ✅ {copy.yourSlot} : {formatPhysioDate(booking.date, language)} · {booking.start} – {booking.end}
                    {booking.location ? ` · ${booking.location}` : ""}
                  </span>
                  <button type="button" className="rb-chip" disabled={busy === `cancel-${booking.id}`} onClick={() => cancelBooking(booking)}>
                    {copy.cancel}
                  </button>
                </div>
              ))}

              {availability.length ? (
                <>
                  <div className="rb-hub-days">
                    {availability.map((day) => (
                      <button
                        key={day.date}
                        type="button"
                        className={day.date === dayKey ? "rb-hub-days--on" : ""}
                        onClick={() => setSelectedDate(day.date)}
                      >
                        {formatPhysioDate(day.date, language, { weekday: "short", day: "numeric" })}
                      </button>
                    ))}
                  </div>
                  <div className="rb-hub-slots">
                    {daySlots.map((slot) => {
                      const mine = myBookingOnDay && myBookingOnDay.start === slot.start;
                      const full = slot.remaining <= 0 && !mine;
                      const blocked = Boolean(myBookingOnDay) && !mine;
                      return (
                        <button
                          key={slot.start}
                          type="button"
                          className={`rb-hub-slot ${mine ? "rb-hub-slot--mine" : ""} ${full || blocked ? "rb-hub-slot--full" : ""}`}
                          disabled={full || blocked || mine || Boolean(busy)}
                          title={blocked ? copy.alreadyToday : undefined}
                          onClick={() => bookSlot(slot)}
                        >
                          <b>{slot.start}</b>
                          <span>{mine ? copy.yourBooking : full ? copy.full : copy.placesLeft(slot.remaining)}</span>
                        </button>
                      );
                    })}
                  </div>
                  <p className="rb-muted rb-hub-hint">{copy.oneByDay}</p>
                </>
              ) : (
                <p className="rb-muted">{copy.noSlots}</p>
              )}
              {physioError ? <p className="rb-hub-error">{physioError}</p> : null}
            </>
          )
        ) : null}
      </section>

      <section id="tickets" className="rb-section">
        <div className="rb-sh">
          <p className="rb-eyebrow">{String(indexOffset + 2).padStart(2, "0")} · 🎟️ {copy.eyebrow}</p>
          <h2>{copy.ticketsTitle}</h2>
        </div>
        <p className="rb-muted">{copy.ticketsText}</p>
        {activePass && hubIsCurrent ? (
          <form className="rb-hub-guests" onSubmit={saveGuests}>
            {guests.map((guest, index) => (
              <div key={index} className="rb-hub-guest">
                <span className="rb-hub-guest__n">{index + 1}</span>
                <input
                  aria-label={`${copy.firstName} ${index + 1}`}
                  placeholder={copy.firstName}
                  value={guest.firstName}
                  disabled={guest.admitted}
                  onChange={(event) => setGuests((current) => current.map((item, itemIndex) => (itemIndex === index ? { ...item, firstName: event.target.value } : item)))}
                />
                <input
                  aria-label={`${copy.guestLastName} ${index + 1}`}
                  placeholder={copy.guestLastName}
                  value={guest.lastName}
                  disabled={guest.admitted}
                  onChange={(event) => setGuests((current) => current.map((item, itemIndex) => (itemIndex === index ? { ...item, lastName: event.target.value } : item)))}
                />
                <input
                  aria-label={`${copy.email} ${index + 1}`}
                  type="email"
                  placeholder={copy.email}
                  value={guest.email}
                  disabled={guest.admitted}
                  onChange={(event) => setGuests((current) => current.map((item, itemIndex) => (itemIndex === index ? { ...item, email: event.target.value } : item)))}
                />
                {guest.admitted ? <span className="rb-hub-guest__admitted">✅ {copy.admitted}</span> : null}
              </div>
            ))}
            <div className="rb-hub-guests__row">
              <button className="rb-btn" type="submit" disabled={busy === "guests"}>
                {busy === "guests" ? copy.saving : copy.save}
              </button>
              <span className="rb-muted">{copy.used(usedPlaces, guests.length)}</span>
            </div>
            {guestMessage ? <p className={guestMessage.type === "ok" ? "rb-hub-ok" : "rb-hub-error"}>{guestMessage.text}</p> : null}
          </form>
        ) : (
          <p className="rb-muted">{copy.identifyFirst}</p>
        )}
      </section>
    </>
  );
}

export { AthleteHubSections, HUB_COPY };
