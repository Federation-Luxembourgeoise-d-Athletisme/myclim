import { useEffect, useMemo, useRef, useState } from "react";
import { signInWithCustomToken, signOut } from "firebase/auth";
import { Timestamp, collection, doc, onSnapshot, runTransaction, serverTimestamp } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { useAuth } from "../context/auth-context";
import { auth, db, functions } from "../services/firebase";
import { isCashDeskUid } from "../context/technical-sessions";
import { useActiveEdition } from "./edition";
import { getActiveRoles } from "./navigation";
import { useTr } from "./use-tr";
import { useLanguage } from "./language-context";
import { mapSnapshot, useDoorData } from "./cash-desk-data";
import {
  DOOR_ENTRY_KINDS,
  evaluateCheckIn,
  filterDoorEntries,
  flattenCheckInEvents,
  normalizeCashPostCode,
} from "./cash-desk-helpers";
import "./cash-desk.css";

const OPERATOR_STORAGE_KEY = "myclim-cash-operator";
const POST_STORAGE_KEY = "myclim-cash-post";
const MAX_VISIBLE_RESULTS = 30;
const RECENT_COUNT = 8;

function readStored(key) {
  try {
    return window.localStorage.getItem(key) || "";
  } catch {
    return "";
  }
}

function store(key, value) {
  try {
    if (value) window.localStorage.setItem(key, value);
    else window.localStorage.removeItem(key);
  } catch {
    // Stockage indisponible (navigation privée) : la valeur reste en mémoire.
  }
}

function formatTime(value) {
  const date = value?.toDate?.() || (typeof value === "number" && value ? new Date(value) : null);
  return date ? date.toLocaleTimeString("fr-LU", { hour: "2-digit", minute: "2-digit" }) : "";
}

function LanguageSwitch() {
  const { language, setLanguage } = useLanguage();
  return (
    <div className="desk-lang">
      {["fr", "en"].map((option) => (
        <button key={option} type="button" className={language === option ? "is-active" : ""} onClick={() => setLanguage(option)}>
          {option.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

function DeskScreen({ title, children }) {
  return (
    <div className="desk desk--center">
      <div className="desk-card">
        <div className="desk-card__top">
          <p className="desk-eyebrow">CMCM Luxembourg Indoor Meeting</p>
          <LanguageSwitch />
        </div>
        <h1>{title}</h1>
        {children}
      </div>
    </div>
  );
}

function CashDeskCodeForm() {
  const tr = useTr();
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const response = await httpsCallable(functions, "openCashPostSession")({ code: normalizeCashPostCode(code) });
      const token = response?.data?.token;
      if (!token) throw new Error("missing-token");
      await signInWithCustomToken(auth, token);
    } catch (accessError) {
      console.error("Cash desk access failed", accessError);
      if (accessError?.code === "functions/permission-denied") {
        setError(tr("Code incorrect.", "Wrong code."));
      } else if (accessError?.code === "functions/resource-exhausted") {
        setError(tr("Trop d'essais. Réessaie dans quelques minutes.", "Too many attempts. Try again in a few minutes."));
      } else if (accessError?.code === "functions/failed-precondition") {
        setError(tr("La caisse est fermée. Demande à l'organisation de la rouvrir.", "The cash desk is closed. Ask the organisers to reopen it."));
      } else {
        setError(tr("Connexion impossible. Vérifie internet puis réessaie.", "Unable to connect. Check the internet connection and try again."));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <DeskScreen title={tr("Caisse d'entrée", "Entrance desk")}>
      <form className="desk-form" onSubmit={handleSubmit}>
        <p className="desk-muted">{tr("Saisis le code donné par l'organisation.", "Enter the code given by the organisers.")}</p>
        <input
          className="desk-code"
          autoFocus
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          placeholder="XXXX-XXXX"
          value={code}
          onChange={(event) => setCode(event.target.value.toUpperCase())}
        />
        {error ? <p className="desk-error">{error}</p> : null}
        <button className="desk-btn desk-btn--primary desk-btn--block" type="submit" disabled={submitting || normalizeCashPostCode(code).length < 8}>
          {submitting ? tr("Vérification…", "Checking…") : tr("Ouvrir", "Open")}
        </button>
      </form>
    </DeskScreen>
  );
}

function CashDeskPage() {
  const tr = useTr();
  const { currentUser, userProfile, loading } = useAuth();
  const roles = userProfile ? getActiveRoles(userProfile) : [];
  const isManager = roles.includes("admin") || roles.includes("gestionnaire");

  if (loading) return <DeskScreen title={tr("Ouverture…", "Opening…")} />;
  if (!currentUser) return <CashDeskCodeForm />;
  if (isCashDeskUid(currentUser.uid)) return <CashDeskSession isTechnicalSession />;
  if (isManager) return <CashDeskSession />;

  return (
    <DeskScreen title={tr("Caisse d'entrée", "Entrance desk")}>
      <p className="desk-muted">
        {tr("Ce navigateur est connecté avec un compte personnel. Déconnecte-toi pour saisir le code de la caisse.", "This browser is signed in with a personal account. Sign out to enter the cash desk code.")}
      </p>
      <button className="desk-btn desk-btn--primary desk-btn--block" type="button" onClick={() => signOut(auth)}>
        {tr("Se déconnecter", "Sign out")}
      </button>
    </DeskScreen>
  );
}

// Session ouverte : vérifie que la caisse reste ouverte (et, pour un
// ordinateur de caisse, que le code n'a pas changé), puis fait choisir le
// poste et le caissier avant d'afficher l'écran d'entrée.
function CashDeskSession({ isTechnicalSession = false }) {
  const tr = useTr();
  const [access, setAccess] = useState(null);
  const [sessionVersion, setSessionVersion] = useState(null);
  const [posts, setPosts] = useState(null);
  const [postId, setPostId] = useState(() => readStored(POST_STORAGE_KEY));
  const [operator, setOperator] = useState(() => readStored(OPERATOR_STORAGE_KEY));
  const [setupDone, setSetupDone] = useState(() => Boolean(readStored(POST_STORAGE_KEY) && readStored(OPERATOR_STORAGE_KEY)));
  const [accessAttempt, setAccessAttempt] = useState(0);

  // Juste après la saisie du code, Firestore peut lire avant d'avoir reçu le
  // nouveau jeton : la lecture est refusée et l'écouteur s'arrête. On réessaie
  // au lieu de conclure à une caisse fermée ou à un code changé.
  useEffect(() => {
    let retryTimer = null;
    const unsubscribe = onSnapshot(
      doc(db, "cashDesk", "access"),
      (snapshot) => setAccess(snapshot.exists() ? snapshot.data() : {}),
      (snapshotError) => {
        console.error("Cash desk access load failed", snapshotError);
        retryTimer = window.setTimeout(() => setAccessAttempt((current) => current + 1), 2000);
      },
    );
    return () => {
      unsubscribe();
      if (retryTimer) window.clearTimeout(retryTimer);
    };
  }, [accessAttempt]);

  useEffect(() => {
    if (!isTechnicalSession || !auth.currentUser) return undefined;
    let cancelled = false;
    auth.currentUser
      .getIdTokenResult()
      .then((result) => {
        if (!cancelled) setSessionVersion(Number(result.claims.cashAccessVersion ?? -1));
      })
      .catch((tokenError) => console.error("Cash session token read failed", tokenError));
    return () => {
      cancelled = true;
    };
  }, [isTechnicalSession]);

  const revoked = isTechnicalSession && access && sessionVersion !== null && Number(access.accessVersion || 0) !== sessionVersion;
  const closed = Boolean(access) && access.open === false;
  const sessionOk = Boolean(access) && !revoked && !closed && (!isTechnicalSession || sessionVersion !== null);

  useEffect(() => {
    if (!sessionOk) return undefined;
    return onSnapshot(
      collection(db, "cashPosts"),
      (snapshot) =>
        setPosts(
          mapSnapshot(snapshot).sort(
            (left, right) => (Number(left.sortOrder) || 0) - (Number(right.sortOrder) || 0) || String(left.name).localeCompare(String(right.name)),
          ),
        ),
      (snapshotError) => {
        console.error("Cash posts load failed", snapshotError);
        setPosts([]);
      },
    );
  }, [sessionOk]);

  const post = posts?.find((item) => item.id === postId) || null;

  async function handleQuit() {
    if (!isTechnicalSession) {
      window.location.assign("/app/caisse");
      return;
    }
    if (window.confirm(tr("Fermer la caisse sur cet appareil ? Il faudra ressaisir le code.", "Close the cash desk on this device? You will need the code again."))) {
      store(POST_STORAGE_KEY, "");
      await signOut(auth);
    }
  }

  if (revoked) {
    return (
      <DeskScreen title={tr("Code changé", "Code changed")}>
        <p className="desk-muted">{tr("L'organisation a créé un nouveau code. Saisis-le pour continuer.", "The organisers created a new code. Enter it to continue.")}</p>
        <button className="desk-btn desk-btn--primary desk-btn--block" type="button" onClick={() => signOut(auth)}>
          {tr("Saisir le code", "Enter the code")}
        </button>
      </DeskScreen>
    );
  }

  if (closed) {
    return (
      <DeskScreen title={tr("Caisse fermée", "Cash desk closed")}>
        <p className="desk-muted">{tr("L'organisation a fermé la caisse. L'écran se rouvrira tout seul dès qu'elle sera rouverte.", "The organisers closed the cash desk. This screen reopens by itself as soon as it is reopened.")}</p>
      </DeskScreen>
    );
  }

  if (!sessionOk || posts === null) return <DeskScreen title={tr("Chargement…", "Loading…")} />;

  if (!setupDone || !post) {
    return (
      <DeskScreen title={tr("Quel poste ?", "Which post?")}>
        <div className="desk-posts">
          {posts.map((item) => (
            <button key={item.id} type="button" className={`desk-post ${item.id === postId ? "is-active" : ""}`} onClick={() => setPostId(item.id)}>
              {item.name}
            </button>
          ))}
          {!posts.length ? <p className="desk-muted">{tr("Aucun poste. L'organisation doit les créer dans MyCLIM › Caisse & entrées.", "No posts yet. The organisers must create them in MyCLIM › Cash desk & entries.")}</p> : null}
        </div>
        <form
          className="desk-form"
          onSubmit={(event) => {
            event.preventDefault();
            store(POST_STORAGE_KEY, postId);
            store(OPERATOR_STORAGE_KEY, operator.trim());
            setSetupDone(true);
          }}
        >
          <label className="desk-label">
            {tr("Ton prénom", "Your first name")}
            <input value={operator} onChange={(event) => setOperator(event.target.value)} placeholder={tr("Ex. Julie", "E.g. Julie")} />
          </label>
          <button className="desk-btn desk-btn--primary desk-btn--block" type="submit" disabled={!post || !operator.trim()}>
            {tr("Commencer", "Start")}
          </button>
        </form>
      </DeskScreen>
    );
  }

  return (
    <CashDeskWorkspace
      post={post}
      operator={operator.trim()}
      onChangeSetup={() => setSetupDone(false)}
      onQuit={handleQuit}
      quitLabel={isTechnicalSession ? tr("Fermer", "Close") : tr("Retour admin", "Back to admin")}
    />
  );
}

function CashDeskWorkspace({ post, operator, onChangeSetup, onQuit, quitLabel }) {
  const tr = useTr();
  const { language } = useLanguage();
  const { activeEditionId, loading: editionLoading } = useActiveEdition(true);
  const { entries, checkIns, error: loadError, loaded } = useDoorData({ editionId: activeEditionId, enabled: !editionLoading });
  const [search, setSearch] = useState("");
  const [highlight, setHighlight] = useState(0);
  const [busyKey, setBusyKey] = useState("");
  const [feedback, setFeedback] = useState(null);
  const searchRef = useRef(null);

  const results = useMemo(() => filterDoorEntries(entries, search), [entries, search]);
  const visibleResults = search.trim() ? results.slice(0, MAX_VISIBLE_RESULTS) : [];
  const entriesByKey = useMemo(() => new Map(entries.map((entry) => [entry.key, entry])), [entries]);

  const postEvents = useMemo(() => flattenCheckInEvents(checkIns).filter((event) => event.postId === post.id), [checkIns, post.id]);
  const postCount = postEvents.reduce((sum, event) => sum + event.count, 0);
  // Entrées encore valables : une entrée annulée depuis disparaît de la liste.
  const recent = postEvents
    .filter((event) => event.count > 0 && (entriesByKey.get(event.checkInId)?.admittedCount ?? 1) > 0)
    .slice(0, RECENT_COUNT);
  const totalPlaces = entries.reduce((sum, entry) => sum + entry.places, 0);
  const totalIn = entries.reduce((sum, entry) => sum + entry.admittedCount, 0);

  useEffect(() => setHighlight(0), [search]);

  const kindLabel = (kind) => (DOOR_ENTRY_KINDS[kind] || DOOR_ENTRY_KINDS.free)[language === "fr" ? "fr" : "en"];
  const nameOf = (entry) => entry.fullName || entry.organization;

  async function recordCheckIn(entry, count, { force = false } = {}) {
    setBusyKey(entry.key);
    try {
      await runTransaction(db, async (transaction) => {
        const checkInRef = doc(db, "doorCheckIns", entry.key);
        const snapshot = await transaction.get(checkInRef);
        const current = snapshot.exists() ? snapshot.data() : null;
        const result = evaluateCheckIn({ places: entry.places, admittedCount: current?.admittedCount || 0, count, force });
        if (!result.ok) {
          const refusal = new Error(result.reason);
          refusal.checkIn = current;
          throw refusal;
        }
        transaction.set(checkInRef, {
          editionId: activeEditionId,
          sourceType: entry.sourceType,
          sourceId: entry.sourceId,
          displayName: entry.fullName,
          organization: entry.organization,
          listName: entry.listName,
          places: entry.places,
          admittedCount: result.nextCount,
          lastPostId: post.id,
          lastPostName: post.name,
          lastOperator: operator,
          lastAt: serverTimestamp(),
          history: [
            ...(Array.isArray(current?.history) ? current.history : []),
            { postId: post.id, postName: post.name, operator, count, forced: force, at: Timestamp.now() },
          ],
        });
      });

      if (count > 0) {
        setFeedback({ type: "ok", entry, count, message: `${nameOf(entry)} — ${count} ${count > 1 ? tr("entrées", "entries") : tr("entrée", "entry")}` });
        setSearch("");
      } else {
        setFeedback({ type: "info", message: tr(`${nameOf(entry)} — entrée annulée`, `${nameOf(entry)} — entry undone`) });
      }
      searchRef.current?.focus();
    } catch (checkInError) {
      if (checkInError?.message === "overflow") {
        const last = checkInError.checkIn;
        setFeedback({
          type: "warn",
          message: tr(
            `${nameOf(entry)} est déjà entré·e${last?.lastAt ? ` à ${formatTime(last.lastAt)} (${last.lastPostName})` : ""}.`,
            `${nameOf(entry)} is already in${last?.lastAt ? ` since ${formatTime(last.lastAt)} (${last.lastPostName})` : ""}.`,
          ),
        });
      } else if (checkInError?.message === "nothing_to_undo") {
        setFeedback({ type: "warn", message: tr("Rien à annuler.", "Nothing to undo.") });
      } else {
        console.error("Check-in failed", checkInError);
        setFeedback({ type: "error", message: tr("Enregistrement impossible. Vérifie internet et réessaie.", "Could not save. Check the internet connection and try again.") });
      }
    } finally {
      setBusyKey("");
    }
  }

  function admitAnyway(entry) {
    if (window.confirm(tr(`${nameOf(entry)} a déjà utilisé ses ${entry.places} place(s). Laisser entrer une personne de plus ?`, `${nameOf(entry)} has already used ${entry.places} place(s). Let one more person in?`))) {
      recordCheckIn(entry, 1, { force: true });
    }
  }

  function handleSearchKey(event) {
    if (event.key === "Escape") {
      setSearch("");
      return;
    }
    if (!visibleResults.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlight((current) => Math.min(visibleResults.length - 1, current + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight((current) => Math.max(0, current - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const entry = visibleResults[highlight];
      if (!entry || busyKey) return;
      if (entry.remainingPlaces > 0) {
        recordCheckIn(entry, 1);
      } else {
        const last = entry.checkIn;
        setFeedback({
          type: "warn",
          message: tr(
            `${nameOf(entry)} est déjà entré·e${last?.lastAt ? ` à ${formatTime(last.lastAt)} (${last.lastPostName})` : ""}.`,
            `${nameOf(entry)} is already in${last?.lastAt ? ` since ${formatTime(last.lastAt)} (${last.lastPostName})` : ""}.`,
          ),
        });
      }
    }
  }

  return (
    <div className="desk">
      <header className="desk-bar">
        <button className="desk-bar__post" type="button" onClick={onChangeSetup} title={tr("Changer de poste ou de caissier", "Change post or operator")}>
          <strong>{post.name}</strong>
          <span>{operator} · {tr("changer", "change")}</span>
        </button>
        <div className="desk-bar__stats">
          <span><strong>{postCount}</strong> {tr("entrés ici", "in here")}</span>
          <span><strong>{totalIn}</strong>/{totalPlaces} {tr("au total", "in total")}</span>
        </div>
        <LanguageSwitch />
        <button className="desk-btn desk-btn--ghost" type="button" onClick={onQuit}>{quitLabel}</button>
      </header>

      {loadError ? <p className="desk-error desk-banner">{tr("Connexion instable : certaines listes ne sont pas à jour.", "Unstable connection: some lists are not up to date.")}</p> : null}

      <main className="desk-main">
        <input
          ref={searchRef}
          className="desk-search"
          type="search"
          autoFocus
          autoComplete="off"
          placeholder={tr("Nom, prénom ou organisation…", "Name or organisation…")}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          onKeyDown={handleSearchKey}
        />

        {feedback ? (
          <div className={`desk-feedback desk-feedback--${feedback.type}`}>
            <span>{feedback.type === "ok" ? "✓ " : ""}{feedback.message}</span>
            {feedback.type === "ok" ? (
              <button type="button" disabled={Boolean(busyKey)} onClick={() => recordCheckIn(entriesByKey.get(feedback.entry.key) || feedback.entry, -feedback.count)}>
                {tr("Annuler", "Undo")}
              </button>
            ) : null}
            <button type="button" className="desk-feedback__close" aria-label={tr("Masquer", "Hide")} onClick={() => setFeedback(null)}>✕</button>
          </div>
        ) : null}

        {search.trim() ? (
          <>
            {!results.length ? (
              <p className="desk-hint">
                {tr(`Personne ne correspond à « ${search} ». Essaie le nom de famille seul ou l'organisation.`, `Nobody matches “${search}”. Try the last name only or the organisation.`)}
              </p>
            ) : null}
            <ul className="desk-results">
              {visibleResults.map((entry, index) => {
                const isBusy = busyKey === entry.key;
                const complete = entry.remainingPlaces === 0;
                return (
                  <li
                    key={entry.key}
                    className={`desk-guest ${complete ? "is-done" : ""} ${index === highlight ? "is-highlight" : ""}`}
                    onMouseEnter={() => setHighlight(index)}
                  >
                    <div className="desk-guest__info">
                      <div className="desk-guest__name">
                        <strong>{nameOf(entry)}</strong>
                        <span className={`cash-badge cash-badge--${entry.kind}`}>{kindLabel(entry.kind)}</span>
                      </div>
                      <div className="desk-guest__meta">
                        {entry.fullName && entry.organization ? <span>{entry.organization}</span> : null}
                        {entry.kind !== "vip" && entry.kind !== "national_race" && entry.listName ? <span>{entry.listName}</span> : null}
                        {entry.companions.length ? <span>+ {entry.companions.join(", ")}</span> : null}
                      </div>
                      {entry.notes ? <p className="desk-guest__notes">{entry.notes}</p> : null}
                    </div>
                    <div className="desk-guest__status">
                      <span className="desk-places">
                        {Array.from({ length: Math.min(entry.places, 6) }, (_, dot) => (
                          <i key={dot} className={dot < entry.admittedCount ? "is-in" : ""} />
                        ))}
                      </span>
                      <small>
                        {entry.admittedCount}/{entry.places}
                        {entry.checkIn?.lastAt && entry.admittedCount ? ` · ${formatTime(entry.checkIn.lastAt)} ${entry.checkIn.lastPostName}` : ""}
                      </small>
                    </div>
                    <div className="desk-guest__actions">
                      {complete ? (
                        <button className="desk-btn desk-btn--warn" type="button" disabled={isBusy} onClick={() => admitAnyway(entry)}>
                          {tr("Déjà entré · +1 ?", "Already in · +1?")}
                        </button>
                      ) : (
                        <>
                          <button className="desk-btn desk-btn--primary" type="button" disabled={isBusy} onClick={() => recordCheckIn(entry, 1)}>
                            {tr("Entrer", "Admit")}
                          </button>
                          {entry.remainingPlaces > 1 ? (
                            <button className="desk-btn" type="button" disabled={isBusy} onClick={() => recordCheckIn(entry, entry.remainingPlaces)}>
                              ×{entry.remainingPlaces}
                            </button>
                          ) : null}
                        </>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
            {results.length > MAX_VISIBLE_RESULTS ? (
              <p className="desk-hint">{tr(`${results.length - MAX_VISIBLE_RESULTS} autres résultats : précise la recherche.`, `${results.length - MAX_VISIBLE_RESULTS} more results: refine the search.`)}</p>
            ) : null}
          </>
        ) : (
          <section className="desk-recent">
            <p className="desk-hint">
              {loaded
                ? tr(`${entries.length} invités sur les listes. Tape quelques lettres, puis Entrée pour valider.`, `${entries.length} guests on the lists. Type a few letters, then Enter to admit.`)
                : tr("Chargement des listes…", "Loading the lists…")}
            </p>
            {recent.length ? (
              <>
                <h2>{tr("Dernières entrées à ce poste", "Latest entries at this post")}</h2>
                <ul>
                  {recent.map((event) => {
                    const entry = entriesByKey.get(event.checkInId);
                    return (
                      <li key={event.id}>
                        <span className="desk-recent__time">{formatTime(event.time)}</span>
                        <strong>{event.displayName}</strong>
                        <span className="desk-muted">{event.count > 1 ? `×${event.count}` : ""} {event.operator}</span>
                        {entry && entry.admittedCount > 0 ? (
                          <button type="button" className="desk-link" disabled={busyKey === entry.key} onClick={() => recordCheckIn(entry, -1)}>
                            {tr("Annuler 1", "Undo 1")}
                          </button>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </>
            ) : null}
          </section>
        )}
      </main>
    </div>
  );
}

export { CashDeskPage };
