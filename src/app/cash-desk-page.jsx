import { useEffect, useMemo, useRef, useState } from "react";
import { signInWithCustomToken, signOut } from "firebase/auth";
import {
  Timestamp,
  collection,
  doc,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  where,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { useAuth } from "../context/auth-context";
import { auth, db, functions } from "../services/firebase";
import { getCashPostIdFromUid } from "../context/technical-sessions";
import { recordMatchesEdition, useActiveEdition } from "./edition";
import { getActiveRoles } from "./navigation";
import {
  buildDoorEntries,
  evaluateCheckIn,
  filterDoorEntries,
  normalizeCashPostCode,
} from "./cash-desk-helpers";

const OPERATOR_STORAGE_KEY = "myclim-cash-operator";
const MAX_VISIBLE_RESULTS = 40;
function readStoredOperator() {
  try {
    return window.localStorage.getItem(OPERATOR_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

function storeOperator(value) {
  try {
    window.localStorage.setItem(OPERATOR_STORAGE_KEY, value);
  } catch {
    // Stockage indisponible (navigation privée) : le nom reste en mémoire.
  }
}

function mapSnapshot(snapshot) {
  return snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
}

function formatTime(value) {
  const date = value?.toDate?.() || null;
  if (!date) return "";
  return date.toLocaleTimeString("fr-LU", { hour: "2-digit", minute: "2-digit" });
}

function CashDeskCodeForm() {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const openSession = httpsCallable(functions, "openCashPostSession");
      const response = await openSession({ code: normalizeCashPostCode(code) });
      const token = response?.data?.token;
      if (!token) throw new Error("missing-token");
      await signInWithCustomToken(auth, token);
    } catch (accessError) {
      console.error("Cash post access failed", accessError);
      if (accessError?.code === "functions/permission-denied") {
        setError("Code incorrect.");
      } else if (accessError?.code === "functions/resource-exhausted") {
        setError("Trop d'essais. Réessaie dans quelques minutes.");
      } else if (accessError?.code === "functions/failed-precondition") {
        setError("Ce poste est fermé. Demande à l'organisation de le rouvrir.");
      } else {
        setError("Connexion impossible. Vérifie la connexion internet puis réessaie.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="cash-desk cash-desk--login">
      <form className="cash-desk-login" onSubmit={handleSubmit}>
        <p className="eyebrow">CMCM Luxembourg Indoor Meeting</p>
        <h1>Caisse d'entrée</h1>
        <p>Saisis le code du poste fourni par l'organisation.</p>
        <input
          className="cash-desk-login__code"
          autoFocus
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          placeholder="XXXX-XXXX"
          value={code}
          onChange={(event) => setCode(event.target.value.toUpperCase())}
        />
        {error ? <p className="form-error">{error}</p> : null}
        <button className="button button--primary" type="submit" disabled={submitting || normalizeCashPostCode(code).length < 8}>
          {submitting ? "Vérification…" : "Ouvrir la caisse"}
        </button>
      </form>
    </div>
  );
}

function CashDeskPostPicker({ onPick }) {
  const [posts, setPosts] = useState([]);

  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, "cashPosts"), (snapshot) => {
      setPosts(mapSnapshot(snapshot).sort((left, right) => (Number(left.sortOrder) || 0) - (Number(right.sortOrder) || 0)));
    });
    return unsubscribe;
  }, []);

  return (
    <div className="cash-desk cash-desk--login">
      <div className="cash-desk-login">
        <p className="eyebrow">Connecté avec ton compte organisation</p>
        <h1>Quel poste ouvrir ?</h1>
        <p>Pour un ordinateur de caisse, déconnecte-toi et utilise le code du poste.</p>
        <div className="cash-desk-post-picker">
          {posts.map((post) => (
            <button key={post.id} className="button button--secondary" type="button" onClick={() => onPick(post.id)}>
              {post.name}
            </button>
          ))}
          {!posts.length ? <p>Aucun poste. Crée-les dans MyCLIM → Caisse & entrées.</p> : null}
        </div>
      </div>
    </div>
  );
}

function CashDeskPage() {
  const { currentUser, userProfile, loading } = useAuth();
  const [pickedPostId, setPickedPostId] = useState("");
  const cashPostId = getCashPostIdFromUid(currentUser?.uid);
  const roles = userProfile ? getActiveRoles(userProfile) : [];
  const isManager = roles.includes("admin") || roles.includes("gestionnaire");

  if (loading) {
    return (
      <div className="cash-desk cash-desk--login">
        <div className="cash-desk-login">
          <h1>Ouverture de la caisse…</h1>
        </div>
      </div>
    );
  }

  if (!currentUser) return <CashDeskCodeForm />;

  if (cashPostId) return <CashDeskWorkspace postId={cashPostId} isTechnicalSession />;

  if (isManager) {
    return pickedPostId ? (
      <CashDeskWorkspace postId={pickedPostId} onLeave={() => setPickedPostId("")} />
    ) : (
      <CashDeskPostPicker onPick={setPickedPostId} />
    );
  }

  return (
    <div className="cash-desk cash-desk--login">
      <div className="cash-desk-login">
        <h1>Caisse d'entrée</h1>
        <p>Ce navigateur est connecté avec un compte personnel. Déconnecte-toi pour saisir le code du poste.</p>
        <button className="button button--primary" type="button" onClick={() => signOut(auth)}>
          Se déconnecter
        </button>
      </div>
    </div>
  );
}

function CashDeskWorkspace({ postId, isTechnicalSession = false, onLeave }) {
  const { activeEditionId, activeEditionLabel, loading: editionLoading } = useActiveEdition(true);
  const [post, setPost] = useState(null);
  const [postError, setPostError] = useState("");
  const [guestLists, setGuestLists] = useState([]);
  const [guests, setGuests] = useState([]);
  const [checkIns, setCheckIns] = useState([]);
  const [vipAdmin, setVipAdmin] = useState([]);
  const [vipPublic, setVipPublic] = useState([]);
  const [vipPortals, setVipPortals] = useState([]);
  const [vipPortalEntries, setVipPortalEntries] = useState({});
  const [operator, setOperator] = useState(readStoredOperator);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    const unsubscribe = onSnapshot(
      doc(db, "cashPosts", postId),
      (snapshot) => {
        if (!snapshot.exists()) {
          setPost(null);
          setPostError("Ce poste n'existe plus.");
          return;
        }
        setPost({ id: snapshot.id, ...snapshot.data() });
        setPostError("");
      },
      (snapshotError) => {
        console.error("Cash post load failed", snapshotError);
        setPost(null);
        setPostError("Accès à ce poste coupé (code changé ou poste fermé).");
      },
    );
    return unsubscribe;
  }, [postId]);

  // Une session de poste porte la version d'accès du moment où le code a été
  // saisi : si l'admin régénère le code ou déconnecte le poste, la version du
  // poste change et l'écran se ferme (les règles refusent déjà les écritures).
  const [sessionAccessVersion, setSessionAccessVersion] = useState(null);
  useEffect(() => {
    if (!isTechnicalSession || !auth.currentUser) return undefined;
    let cancelled = false;
    auth.currentUser
      .getIdTokenResult()
      .then((result) => {
        if (!cancelled) setSessionAccessVersion(Number(result.claims.cashAccessVersion ?? -1));
      })
      .catch((tokenError) => console.error("Cash session token read failed", tokenError));
    return () => {
      cancelled = true;
    };
  }, [isTechnicalSession]);

  const sessionRevoked =
    isTechnicalSession &&
    Boolean(post) &&
    sessionAccessVersion !== null &&
    Number(post.accessVersion || 0) !== sessionAccessVersion;

  const showVipLists = Boolean(post?.showVipLists);
  const postIsOpen = Boolean(post) && post.active !== false && !sessionRevoked;

  useEffect(() => {
    if (editionLoading || !postIsOpen) return undefined;

    const fail = (label) => (snapshotError) => {
      console.error(`Cash desk: unable to load ${label}`, snapshotError);
      setLoadError(`Impossible de charger ${label}. Vérifie la connexion internet.`);
    };
    const byEdition = (name) => query(collection(db, name), where("editionId", "==", activeEditionId));

    const unsubscribers = [
      onSnapshot(byEdition("doorGuestLists"), (snapshot) => setGuestLists(mapSnapshot(snapshot)), fail("les listes")),
      onSnapshot(byEdition("doorGuests"), (snapshot) => setGuests(mapSnapshot(snapshot)), fail("les invités")),
      onSnapshot(byEdition("doorCheckIns"), (snapshot) => setCheckIns(mapSnapshot(snapshot)), fail("les entrées")),
    ];

    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [activeEditionId, editionLoading, postIsOpen]);

  useEffect(() => {
    if (editionLoading || !postIsOpen || !showVipLists) {
      setVipAdmin([]);
      setVipPublic([]);
      setVipPortals([]);
      return undefined;
    }

    const fail = (snapshotError) => {
      console.error("Cash desk: unable to load VIP lists", snapshotError);
      setLoadError("Impossible de charger les listes VIP.");
    };
    const forEdition = (snapshot) => mapSnapshot(snapshot).filter((record) => recordMatchesEdition(record, activeEditionId));

    const unsubscribers = [
      onSnapshot(collection(db, "vipAdminRegistrations"), (snapshot) => setVipAdmin(forEdition(snapshot)), fail),
      onSnapshot(collection(db, "vipPublicRegistrations"), (snapshot) => setVipPublic(forEdition(snapshot)), fail),
      onSnapshot(collection(db, "vipPartnerPortals"), (snapshot) => setVipPortals(snapshot.docs.map((entry) => entry.id)), fail),
    ];
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [activeEditionId, editionLoading, postIsOpen, showVipLists]);

  const vipPortalKey = vipPortals.join("|");
  useEffect(() => {
    if (!vipPortals.length) {
      setVipPortalEntries({});
      return undefined;
    }
    const unsubscribers = vipPortals.map((portalId) =>
      onSnapshot(
        collection(db, "vipPartnerPortals", portalId, "entries"),
        (snapshot) => {
          const entries = mapSnapshot(snapshot)
            .map((entry) => ({ ...entry, portalId }))
            .filter((entry) => recordMatchesEdition(entry, activeEditionId));
          setVipPortalEntries((current) => ({ ...current, [portalId]: entries }));
        },
        (snapshotError) => console.error(`Cash desk: unable to load VIP portal ${portalId}`, snapshotError),
      ),
    );
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
    // vipPortalKey suit la liste des portails sans recréer les écouteurs à chaque snapshot identique.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vipPortalKey, activeEditionId]);

  const doorEntries = useMemo(
    () =>
      buildDoorEntries({
        editionId: activeEditionId,
        post,
        vipAdminRegistrations: vipAdmin,
        vipPublicRegistrations: vipPublic,
        vipPortalEntries: Object.values(vipPortalEntries).flat(),
        guestLists,
        guests,
        checkIns,
      }),
    [activeEditionId, checkIns, guestLists, guests, post, vipAdmin, vipPortalEntries, vipPublic],
  );

  const postEntriesCount = checkIns.reduce(
    (sum, checkIn) =>
      sum +
      (Array.isArray(checkIn.history) ? checkIn.history : [])
        .filter((event) => event.postId === postId)
        .reduce((eventSum, event) => eventSum + (Number(event.count) || 0), 0),
    0,
  );

  function handleOperatorChange(event) {
    setOperator(event.target.value);
    storeOperator(event.target.value);
  }

  async function handleLeave() {
    if (onLeave) {
      onLeave();
      return;
    }
    if (window.confirm("Fermer la caisse sur cet ordinateur ? Il faudra ressaisir le code du poste.")) {
      await signOut(auth);
    }
  }

  if (postError || sessionRevoked || (post && post.active === false)) {
    return (
      <div className="cash-desk cash-desk--login">
        <div className="cash-desk-login">
          <h1>Caisse fermée</h1>
          <p>
            {postError ||
              (sessionRevoked
                ? "L'organisation a déconnecté ce poste ou changé son code. Saisis le code du poste pour continuer."
                : "Ce poste a été fermé par l'organisation.")}
          </p>
          <button className="button button--primary" type="button" onClick={() => (isTechnicalSession ? signOut(auth) : onLeave?.())}>
            {isTechnicalSession ? "Saisir un code" : "Choisir un autre poste"}
          </button>
        </div>
      </div>
    );
  }

  if (!post) {
    return (
      <div className="cash-desk cash-desk--login">
        <div className="cash-desk-login">
          <h1>Chargement du poste…</h1>
        </div>
      </div>
    );
  }

  return (
    <div className="cash-desk">
      <header className="cash-desk-header">
        <div>
          <p className="eyebrow">Contrôle des entrées · {activeEditionLabel}</p>
          <h1>{post.name}</h1>
        </div>
        <div className="cash-desk-header__stats">
          <span><strong>{doorEntries.length}</strong> invités sur les listes</span>
          <span><strong>{postEntriesCount}</strong> entrées validées ici</span>
        </div>
        <div className="cash-desk-header__operator">
          <label>
            Caissier·ère
            <input value={operator} placeholder="Ton prénom" onChange={handleOperatorChange} />
          </label>
          <button className="button button--secondary button--small" type="button" onClick={handleLeave}>
            {onLeave ? "Changer de poste" : "Fermer la caisse"}
          </button>
        </div>
      </header>

      {loadError ? <p className="form-error cash-desk-banner">{loadError}</p> : null}

      <CashDeskGuests entries={doorEntries} editionId={activeEditionId} post={post} operator={operator} />
    </div>
  );
}

function CashDeskGuests({ entries, editionId, post, operator }) {
  const [search, setSearch] = useState("");
  const [busyKey, setBusyKey] = useState("");
  const [feedback, setFeedback] = useState(null);
  const searchRef = useRef(null);

  const results = useMemo(() => filterDoorEntries(entries, search), [entries, search]);
  const visibleResults = search.trim() ? results.slice(0, MAX_VISIBLE_RESULTS) : [];

  async function recordCheckIn(entry, count, { force = false } = {}) {
    setBusyKey(entry.key);
    setFeedback(null);
    try {
      await runTransaction(db, async (transaction) => {
        const checkInRef = doc(db, "doorCheckIns", entry.key);
        const snapshot = await transaction.get(checkInRef);
        const current = snapshot.exists() ? snapshot.data() : null;
        const result = evaluateCheckIn({
          places: entry.places,
          admittedCount: current?.admittedCount || 0,
          count,
          force,
        });
        if (!result.ok) {
          const refusal = new Error(result.reason);
          refusal.checkIn = current;
          throw refusal;
        }

        transaction.set(checkInRef, {
          editionId,
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

      setFeedback({
        type: "ok",
        message:
          count > 0
            ? `${entry.fullName || entry.organization} : ${count} entrée${count > 1 ? "s" : ""} validée${count > 1 ? "s" : ""}.`
            : `${entry.fullName || entry.organization} : dernière entrée annulée.`,
      });
      if (count > 0) {
        setSearch("");
        searchRef.current?.focus();
      }
    } catch (checkInError) {
      if (checkInError?.message === "overflow") {
        const last = checkInError.checkIn;
        setFeedback({
          type: "warn",
          message: `Déjà entré${last?.lastPostName ? ` à ${formatTime(last.lastAt)} via ${last.lastPostName}` : ""}. Utilise « Forcer » seulement si l'organisation l'autorise.`,
        });
      } else if (checkInError?.message === "nothing_to_undo") {
        setFeedback({ type: "warn", message: "Aucune entrée à annuler." });
      } else {
        console.error("Check-in failed", checkInError);
        setFeedback({ type: "error", message: "Enregistrement impossible. Vérifie la connexion puis réessaie." });
      }
    } finally {
      setBusyKey("");
    }
  }

  return (
    <section className="cash-desk-panel">
      <input
        ref={searchRef}
        className="cash-desk-search"
        type="search"
        autoFocus
        placeholder="Nom, prénom ou organisation…"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />

      {feedback ? <p className={`cash-desk-feedback cash-desk-feedback--${feedback.type}`}>{feedback.message}</p> : null}

      {!search.trim() ? (
        <p className="cash-desk-hint">
          {entries.length} invité(s) sur les listes de ce poste. Tape quelques lettres du nom ou de l'organisation.
        </p>
      ) : null}

      {search.trim() && !results.length ? (
        <p className="cash-desk-hint">Personne ne correspond à « {search} ». Vérifie l'orthographe ou cherche par organisation.</p>
      ) : null}

      <ul className="cash-desk-results">
        {visibleResults.map((entry) => {
          const isBusy = busyKey === entry.key;
          const complete = entry.remainingPlaces === 0;
          return (
            <li key={entry.key} className={`cash-desk-guest ${complete ? "cash-desk-guest--done" : ""}`}>
              <div className="cash-desk-guest__info">
                <strong>{entry.fullName || entry.organization}</strong>
                {entry.fullName && entry.organization ? <span>{entry.organization}</span> : null}
                <span className={`cash-desk-badge ${entry.isVip ? "cash-desk-badge--vip" : ""}`}>{entry.sourceLabel}</span>
                {entry.companions.length ? <span>Accompagné·e de {entry.companions.join(", ")}</span> : null}
                {entry.notes ? <span className="cash-desk-guest__notes">{entry.notes}</span> : null}
              </div>
              <div className="cash-desk-guest__status">
                <span>
                  {entry.admittedCount}/{entry.places} entré{entry.places > 1 ? "s" : ""}
                </span>
                {entry.checkIn?.lastAt ? (
                  <small>
                    {formatTime(entry.checkIn.lastAt)} · {entry.checkIn.lastPostName}
                  </small>
                ) : null}
              </div>
              <div className="cash-desk-guest__actions">
                {!complete ? (
                  <>
                    <button className="button button--primary" type="button" disabled={isBusy} onClick={() => recordCheckIn(entry, 1)}>
                      Entrée ×1
                    </button>
                    {entry.remainingPlaces > 1 ? (
                      <button
                        className="button button--primary"
                        type="button"
                        disabled={isBusy}
                        onClick={() => recordCheckIn(entry, entry.remainingPlaces)}
                      >
                        Tout le groupe ×{entry.remainingPlaces}
                      </button>
                    ) : null}
                  </>
                ) : (
                  <button
                    className="button button--danger-soft button--small"
                    type="button"
                    disabled={isBusy}
                    onClick={() => {
                      if (window.confirm(`${entry.fullName || entry.organization} a déjà utilisé toutes ses places. Laisser entrer une personne de plus ?`)) {
                        recordCheckIn(entry, 1, { force: true });
                      }
                    }}
                  >
                    Forcer +1
                  </button>
                )}
                {entry.admittedCount > 0 ? (
                  <button className="button button--secondary button--small" type="button" disabled={isBusy} onClick={() => recordCheckIn(entry, -1)}>
                    Annuler 1
                  </button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      {results.length > MAX_VISIBLE_RESULTS ? (
        <p className="cash-desk-hint">{results.length - MAX_VISIBLE_RESULTS} autre(s) résultat(s) : affine la recherche.</p>
      ) : null}
    </section>
  );
}

export { CashDeskPage };
