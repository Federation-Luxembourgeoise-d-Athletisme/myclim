import { useEffect, useMemo, useRef, useState } from "react";
import { signInWithCustomToken, signOut } from "firebase/auth";
import {
  Timestamp,
  addDoc,
  collection,
  doc,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { useAuth } from "../context/auth-context";
import { auth, db, functions } from "../services/firebase";
import { getCashPostIdFromUid } from "../context/technical-sessions";
import { recordMatchesEdition, useActiveEdition } from "./edition";
import { getActiveRoles } from "./navigation";
import {
  articleIsAvailableForPost,
  buildCartLines,
  buildDoorEntries,
  computeCartTotalCents,
  countCartTickets,
  evaluateCheckIn,
  filterDoorEntries,
  formatEuros,
  CASH_SALE_STATUS_LABELS,
  isPaidSale,
  normalizeCashPostCode,
} from "./cash-desk-helpers";

const OPERATOR_STORAGE_KEY = "myclim-cash-operator";
const MAX_VISIBLE_RESULTS = 40;
const READER_STATUS_REFRESH_MS = 60 * 1000;

const READER_STATE_LABELS = {
  IDLE: "prêt",
  SELECTING_TIP: "pourboire",
  WAITING_FOR_CARD: "attend la carte",
  WAITING_FOR_PIN: "attend le code PIN",
  WAITING_FOR_SIGNATURE: "attend la signature",
  UPDATING_FIRMWARE: "mise à jour en cours",
};

function describeReaderStatus(readerStatus) {
  if (!readerStatus) return { label: "Solo : vérification…", tone: "pending" };
  if (!readerStatus.paired) return { label: "Aucun Solo appairé — mode manuel", tone: "pending" };
  if (readerStatus.error) return { label: "Solo : SumUp injoignable", tone: "danger" };
  if (readerStatus.status === "ONLINE") {
    const state = READER_STATE_LABELS[readerStatus.state] || "en ligne";
    const battery = readerStatus.batteryLevel != null ? ` · ${Math.round(readerStatus.batteryLevel)} %` : "";
    return { label: `Solo en ligne (${state})${battery}`, tone: "ok" };
  }
  return { label: "Solo hors ligne — vérifie Wi-Fi et alimentation", tone: "danger" };
}

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
  const [articles, setArticles] = useState([]);
  const [guestLists, setGuestLists] = useState([]);
  const [guests, setGuests] = useState([]);
  const [checkIns, setCheckIns] = useState([]);
  const [vipAdmin, setVipAdmin] = useState([]);
  const [vipPublic, setVipPublic] = useState([]);
  const [vipPortals, setVipPortals] = useState([]);
  const [vipPortalEntries, setVipPortalEntries] = useState({});
  const [sales, setSales] = useState([]);
  const [activeTab, setActiveTab] = useState("");
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

  const postKind = post?.kind || "";
  const showVipLists = Boolean(post?.showVipLists);
  const postIsOpen = Boolean(post) && post.active !== false && !sessionRevoked;

  useEffect(() => {
    if (!activeTab && postKind) setActiveTab(postKind === "vip" ? "invites" : "vente");
  }, [activeTab, postKind]);

  useEffect(() => {
    if (editionLoading || !postIsOpen) return undefined;

    const fail = (label) => (snapshotError) => {
      console.error(`Cash desk: unable to load ${label}`, snapshotError);
      setLoadError(`Impossible de charger ${label}. Vérifie la connexion internet.`);
    };
    const byEdition = (name) => query(collection(db, name), where("editionId", "==", activeEditionId));

    const unsubscribers = [
      onSnapshot(byEdition("cashArticles"), (snapshot) => setArticles(mapSnapshot(snapshot)), fail("les articles")),
      onSnapshot(byEdition("doorGuestLists"), (snapshot) => setGuestLists(mapSnapshot(snapshot)), fail("les listes")),
      onSnapshot(byEdition("doorGuests"), (snapshot) => setGuests(mapSnapshot(snapshot)), fail("les invités")),
      onSnapshot(byEdition("doorCheckIns"), (snapshot) => setCheckIns(mapSnapshot(snapshot)), fail("les entrées")),
      onSnapshot(
        query(collection(db, "cashSales"), where("postId", "==", postId)),
        (snapshot) => setSales(mapSnapshot(snapshot).filter((sale) => sale.editionId === activeEditionId)),
        fail("les ventes"),
      ),
    ];

    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [activeEditionId, editionLoading, postId, postIsOpen]);

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

  const postArticles = useMemo(
    () =>
      articles
        .filter((article) => articleIsAvailableForPost(article, post))
        .sort((left, right) => (Number(left.sortOrder) || 0) - (Number(right.sortOrder) || 0)),
    [articles, post],
  );

  const paidSales = sales.filter(isPaidSale);

  const sumupReaderId = post?.sumupReaderId || "";
  const [readerStatus, setReaderStatus] = useState(null);
  async function refreshReaderStatus() {
    if (!sumupReaderId) {
      setReaderStatus({ paired: false });
      return;
    }
    try {
      const getStatus = httpsCallable(functions, "getSumupReaderStatus");
      const response = await getStatus({ postId });
      setReaderStatus(response?.data || { paired: true, status: "UNKNOWN" });
    } catch (statusError) {
      console.error("SumUp reader status failed", statusError);
      setReaderStatus({ paired: true, error: true });
    }
  }
  useEffect(() => {
    if (!postIsOpen) return undefined;
    refreshReaderStatus();
    const interval = window.setInterval(refreshReaderStatus, READER_STATUS_REFRESH_MS);
    return () => window.clearInterval(interval);
    // refreshReaderStatus ne dépend que du poste et de son Solo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postId, sumupReaderId, postIsOpen]);
  const readerSummary = describeReaderStatus(readerStatus);
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
          <p className="eyebrow">Caisse · {activeEditionLabel}</p>
          <h1>{post.name}</h1>
        </div>
        <div className="cash-desk-header__stats">
          <span><strong>{postEntriesCount}</strong> entrées invités</span>
          <span><strong>{paidSales.length}</strong> ventes</span>
          <span><strong>{formatEuros(paidSales.reduce((sum, sale) => sum + (Number(sale.totalCents) || 0), 0))}</strong></span>
        </div>
        <button
          type="button"
          className={`cash-desk-reader cash-desk-reader--${readerSummary.tone}`}
          title="Actualiser l'état du Solo"
          onClick={refreshReaderStatus}
        >
          {readerSummary.label}
        </button>
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

      <nav className="cash-desk-tabs" aria-label="Sections de la caisse">
        <button
          type="button"
          className={`cash-desk-tab ${activeTab === "invites" ? "cash-desk-tab--active" : ""}`}
          onClick={() => setActiveTab("invites")}
        >
          Invités ({doorEntries.length})
        </button>
        <button
          type="button"
          className={`cash-desk-tab ${activeTab === "vente" ? "cash-desk-tab--active" : ""}`}
          onClick={() => setActiveTab("vente")}
        >
          Vente de billets
        </button>
      </nav>

      {activeTab === "invites" ? (
        <CashDeskGuests
          entries={doorEntries}
          editionId={activeEditionId}
          post={post}
          operator={operator}
        />
      ) : (
        <CashDeskSales
          articles={postArticles}
          sales={sales}
          editionId={activeEditionId}
          post={post}
          operator={operator}
          canUseSolo={Boolean(sumupReaderId) && !readerStatus?.error && readerStatus?.status !== "OFFLINE"}
          onReaderIssue={refreshReaderStatus}
        />
      )}
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

// Étapes du panier : "cart" (composition), "solo" (montant envoyé au Solo,
// on suit la vente côté serveur) ou "manual" (mode secours : montant saisi à
// la main sur le Solo, validé par le caissier).
function CashDeskSales({ articles, sales, editionId, post, operator, canUseSolo, onReaderIssue }) {
  const [cart, setCart] = useState({});
  const [step, setStep] = useState("cart");
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [soloSaleId, setSoloSaleId] = useState("");
  const [soloBusy, setSoloBusy] = useState(false);

  const lines = useMemo(() => buildCartLines(cart, articles), [articles, cart]);
  const totalCents = computeCartTotalCents(lines);
  const ticketCount = countCartTickets(lines);
  const recentSales = useMemo(
    () => [...sales].sort((left, right) => (right.createdAt?.toMillis?.() || 0) - (left.createdAt?.toMillis?.() || 0)).slice(0, 8),
    [sales],
  );
  const soloSale = soloSaleId ? sales.find((sale) => sale.id === soloSaleId) || null : null;
  const soloStatus = soloSale?.status || "pending";

  // Fin d'un paiement Solo : la vente est confirmée par le serveur (webhook
  // SumUp ou bouton « Vérifier »), on vide le panier ou on propose de réessayer.
  useEffect(() => {
    if (step !== "solo" || !soloSale) return;
    if (soloSale.status === "paid") {
      setFeedback({
        type: "ok",
        message: `Paiement accepté : ${soloSale.ticketCount || ticketCount} billet(s), ${formatEuros(soloSale.totalCents)}.`,
      });
      setCart({});
      setStep("cart");
      setSoloSaleId("");
    } else if (soloSale.status === "failed") {
      setFeedback({ type: "error", message: `Paiement non abouti : ${soloSale.failureReason || "refusé sur le Solo"}.` });
    }
  }, [soloSale, step, ticketCount]);

  // Filet de sécurité si le webhook SumUp tarde : revérifie toutes les 15 s.
  useEffect(() => {
    if (step !== "solo" || !soloSaleId || soloStatus !== "pending") return undefined;
    const interval = window.setInterval(() => {
      httpsCallable(functions, "refreshCashSaleStatus")({ saleId: soloSaleId }).catch((refreshError) =>
        console.error("Solo sale refresh failed", refreshError),
      );
    }, 15000);
    return () => window.clearInterval(interval);
  }, [soloSaleId, soloStatus, step]);

  function changeQuantity(articleId, delta) {
    setFeedback(null);
    setCart((current) => {
      const nextQuantity = Math.max(0, (Number(current[articleId]) || 0) + delta);
      return { ...current, [articleId]: nextQuantity };
    });
  }

  function resetCart() {
    setCart({});
    setStep("cart");
    setSoloSaleId("");
  }

  async function startSoloPayment() {
    setSoloBusy(true);
    setFeedback(null);
    try {
      const startCheckout = httpsCallable(functions, "startCashSaleCheckout");
      const response = await startCheckout({ postId: post.id, cart, operator });
      setSoloSaleId(response?.data?.saleId || "");
      setStep("solo");
    } catch (checkoutError) {
      console.error("Solo checkout failed", checkoutError);
      setFeedback({
        type: "error",
        message: checkoutError?.message || "Le Solo n'a pas reçu le montant. Réessaie ou passe en mode manuel.",
      });
      onReaderIssue?.();
    } finally {
      setSoloBusy(false);
    }
  }

  async function callSoloSaleAction(name) {
    if (!soloSaleId) return;
    setSoloBusy(true);
    try {
      const action = httpsCallable(functions, name);
      const response = await action({ saleId: soloSaleId });
      if (response?.data?.status === "pending") {
        setFeedback({
          type: "warn",
          message:
            name === "cancelCashSaleCheckout"
              ? "Annulation demandée au Solo. Si le client a déjà présenté sa carte, le paiement peut quand même aboutir."
              : "SumUp n'a pas encore de résultat pour ce paiement. Attends quelques secondes.",
        });
      }
    } catch (actionError) {
      console.error(`${name} failed`, actionError);
      setFeedback({ type: "error", message: "SumUp ne répond pas. Vérifie la connexion internet." });
    } finally {
      setSoloBusy(false);
    }
  }

  function retryAfterFailure() {
    setSoloSaleId("");
    setStep("cart");
    setFeedback(null);
  }

  async function recordManualSale(paymentMethod) {
    setSaving(true);
    setFeedback(null);
    try {
      await addDoc(collection(db, "cashSales"), {
        editionId,
        postId: post.id,
        postName: post.name,
        operator,
        items: lines,
        ticketCount,
        totalCents,
        currency: "EUR",
        paymentMethod,
        status: "paid",
        createdAt: serverTimestamp(),
      });
      setFeedback({ type: "ok", message: `Vente enregistrée : ${ticketCount} billet(s), ${formatEuros(totalCents)}.` });
      resetCart();
    } catch (saleError) {
      console.error("Cash sale failed", saleError);
      setFeedback({ type: "error", message: "Vente non enregistrée. Vérifie la connexion puis réessaie." });
    } finally {
      setSaving(false);
    }
  }

  async function cancelSale(sale) {
    if (!window.confirm(`Annuler la vente de ${formatEuros(sale.totalCents)} ? Si le client a payé, rembourse-le aussi sur le Solo.`)) return;
    try {
      await updateDoc(doc(db, "cashSales", sale.id), {
        status: "cancelled",
        cancelledAt: serverTimestamp(),
        cancelledBy: operator || post.name,
        updatedAt: serverTimestamp(),
      });
    } catch (cancelError) {
      console.error("Cash sale cancel failed", cancelError);
      setFeedback({ type: "error", message: "Annulation impossible. Vérifie la connexion." });
    }
  }

  const cartLocked = step !== "cart";

  return (
    <section className="cash-desk-panel cash-desk-sales">
      <div className="cash-desk-articles">
        {articles.map((article) => (
          <button
            key={article.id}
            type="button"
            className="cash-desk-article"
            disabled={cartLocked}
            onClick={() => changeQuantity(article.id, 1)}
          >
            <span>{article.label}</span>
            <strong>{formatEuros(article.priceCents)}</strong>
            {cart[article.id] ? <em>×{cart[article.id]}</em> : null}
          </button>
        ))}
        {!articles.length ? <p className="cash-desk-hint">Aucun article en vente sur ce poste. Préviens l'organisation.</p> : null}
      </div>

      <aside className="cash-desk-cart">
        <h2>Panier</h2>
        {lines.length ? (
          <ul>
            {lines.map((line) => (
              <li key={line.articleId}>
                <span>{line.label}</span>
                <div className="cash-desk-cart__qty">
                  <button type="button" disabled={cartLocked} onClick={() => changeQuantity(line.articleId, -1)} aria-label={`Retirer un ${line.label}`}>
                    −
                  </button>
                  <strong>{line.quantity}</strong>
                  <button type="button" disabled={cartLocked} onClick={() => changeQuantity(line.articleId, 1)} aria-label={`Ajouter un ${line.label}`}>
                    +
                  </button>
                </div>
                <span>{formatEuros(line.lineTotalCents)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="cash-desk-hint">Touche un article pour l'ajouter.</p>
        )}

        <p className="cash-desk-cart__total">
          Total <strong>{formatEuros(totalCents)}</strong>
        </p>

        {feedback ? <p className={`cash-desk-feedback cash-desk-feedback--${feedback.type}`}>{feedback.message}</p> : null}

        {step === "cart" ? (
          <div className="cash-desk-cart__actions">
            {!lines.length ? null : totalCents === 0 ? (
              <button className="button button--primary" type="button" disabled={saving} onClick={() => recordManualSale("free")}>
                Valider (gratuit)
              </button>
            ) : canUseSolo ? (
              <button className="button button--primary" type="button" disabled={soloBusy} onClick={startSoloPayment}>
                {soloBusy ? "Envoi au Solo…" : `Encaisser ${formatEuros(totalCents)} sur le Solo`}
              </button>
            ) : (
              <button className="button button--primary" type="button" onClick={() => setStep("manual")}>
                Encaisser {formatEuros(totalCents)}
              </button>
            )}
            {lines.length ? (
              <button className="button button--secondary" type="button" onClick={resetCart}>
                Vider
              </button>
            ) : null}
            {lines.length && totalCents > 0 && canUseSolo ? (
              <button className="cash-desk-manual-link" type="button" onClick={() => setStep("manual")}>
                Le Solo ne répond pas ? Mode manuel
              </button>
            ) : null}
          </div>
        ) : null}

        {step === "solo" ? (
          <div className={`cash-desk-payment cash-desk-payment--${soloStatus}`}>
            {soloStatus === "failed" ? (
              <>
                <p>
                  Le paiement de <strong>{formatEuros(soloSale?.totalCents ?? totalCents)}</strong> n'a pas abouti. Le panier est conservé.
                </p>
                <div className="cash-desk-cart__actions">
                  <button className="button button--primary" type="button" onClick={retryAfterFailure}>
                    Réessayer
                  </button>
                  <button className="button button--secondary" type="button" onClick={() => setStep("manual")}>
                    Mode manuel
                  </button>
                </div>
              </>
            ) : (
              <>
                <p>
                  <strong>{formatEuros(soloSale?.totalCents ?? totalCents)}</strong> envoyés au Solo. Le client présente sa carte
                  ou son téléphone. L'écran se met à jour tout seul quand le paiement est accepté.
                </p>
                <div className="cash-desk-cart__actions">
                  <button className="button button--secondary" type="button" disabled={soloBusy} onClick={() => callSoloSaleAction("refreshCashSaleStatus")}>
                    Vérifier
                  </button>
                  <button className="button button--danger-soft" type="button" disabled={soloBusy} onClick={() => callSoloSaleAction("cancelCashSaleCheckout")}>
                    Annuler sur le Solo
                  </button>
                </div>
              </>
            )}
          </div>
        ) : null}

        {step === "manual" ? (
          <div className="cash-desk-payment">
            <p>
              <strong>Mode manuel.</strong> Saisis <strong>{formatEuros(totalCents)}</strong> directement sur le Solo et fais payer
              le client. Valide ici seulement quand le Solo affiche le paiement accepté.
            </p>
            <div className="cash-desk-cart__actions">
              <button className="button button--primary" type="button" disabled={saving} onClick={() => recordManualSale("sumup_manual")}>
                {saving ? "Enregistrement…" : "Paiement accepté"}
              </button>
              <button className="button button--secondary" type="button" disabled={saving} onClick={() => setStep("cart")}>
                Paiement refusé / retour
              </button>
            </div>
          </div>
        ) : null}

        {recentSales.length ? (
          <div className="cash-desk-recent">
            <h3>Dernières ventes</h3>
            <ul>
              {recentSales.map((sale) => (
                <li key={sale.id} className={sale.status === "cancelled" || sale.status === "failed" ? "cash-desk-recent--cancelled" : ""}>
                  <span>{formatTime(sale.createdAt)}</span>
                  <span>{(sale.items || []).map((item) => `${item.quantity}× ${item.label}`).join(", ")}</span>
                  <span>{formatEuros(sale.totalCents)}</span>
                  {sale.status === "paid" ? (
                    <button type="button" className="button button--danger-soft button--small" onClick={() => cancelSale(sale)}>
                      Annuler
                    </button>
                  ) : (
                    <em>{CASH_SALE_STATUS_LABELS[sale.status] || sale.status}</em>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </aside>
    </section>
  );
}

export { CashDeskPage };
