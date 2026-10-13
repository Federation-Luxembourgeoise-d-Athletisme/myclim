import { useEffect, useMemo, useState } from "react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  increment,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../services/firebase";
import { buildAppUrl } from "../services/app-url";
import { TICKET_PRICING } from "../site/ticket-pricing-config";
import { useActiveEdition } from "./edition";
import { AuthFormField } from "./form-components";
import {
  CASH_POST_KINDS,
  CASH_SALE_PAYMENT_METHODS,
  CASH_SALE_STATUS_LABELS,
  DEFAULT_CASH_POSTS,
  DOOR_GUEST_LIST_CATEGORIES,
  DOOR_GUEST_LIST_SCOPES,
  buildDefaultCashArticles,
  buildPersonName,
  formatEuros,
  isPaidSale,
  normalizeSearchValue,
  parseGuestImportRows,
  toCents,
} from "./cash-desk-helpers";

const TABS = [
  { id: "postes", label: "Postes & accès" },
  { id: "articles", label: "Articles" },
  { id: "listes", label: "Listes d'invités" },
  { id: "suivi", label: "Suivi" },
];

const EMPTY_ARTICLE_FORM = { label: "", price: "", postKinds: ["public", "vip"] };
const EMPTY_LIST_FORM = { name: "", category: "sponsors", postScope: "all" };
const EMPTY_GUEST_FORM = { firstName: "", lastName: "", organization: "", email: "", places: "1", notes: "" };

function mapSnapshot(snapshot) {
  return snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
}

function sortByOrder(items) {
  return [...items].sort(
    (left, right) =>
      (Number(left.sortOrder) || 0) - (Number(right.sortOrder) || 0) ||
      String(left.name || left.label || "").localeCompare(String(right.name || right.label || "")),
  );
}

function formatTimestamp(value) {
  const date = value?.toDate?.() || (value ? new Date(value) : null);
  if (!date || Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("fr-LU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

async function downloadWorkbook(workbook, filename) {
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function CashDeskAdminPage({ Panel }) {
  const { activeEditionId, activeEditionLabel, loading: editionLoading } = useActiveEdition(true);
  const [activeTab, setActiveTab] = useState("postes");
  const [posts, setPosts] = useState([]);
  const [articles, setArticles] = useState([]);
  const [guestLists, setGuestLists] = useState([]);
  const [guests, setGuests] = useState([]);
  const [sales, setSales] = useState([]);
  const [checkIns, setCheckIns] = useState([]);
  const [error, setError] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [busyKey, setBusyKey] = useState("");
  const [revealedCode, setRevealedCode] = useState(null);
  const [newPostForm, setNewPostForm] = useState({ name: "", kind: "public" });
  const [articleForm, setArticleForm] = useState(EMPTY_ARTICLE_FORM);
  const [editingArticleId, setEditingArticleId] = useState("");
  const [listForm, setListForm] = useState(EMPTY_LIST_FORM);
  const [selectedListId, setSelectedListId] = useState("");
  const [guestForm, setGuestForm] = useState(EMPTY_GUEST_FORM);
  const [guestSearch, setGuestSearch] = useState("");
  const [pendingImport, setPendingImport] = useState(null);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, "cashPosts"),
      (snapshot) => setPosts(sortByOrder(mapSnapshot(snapshot))),
      (snapshotError) => {
        console.error("Unable to load cash posts", snapshotError);
        setError("Impossible de charger les postes de caisse.");
      },
    );
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (editionLoading) return undefined;

    const byEdition = (name) => query(collection(db, name), where("editionId", "==", activeEditionId));
    const listen = (name, setter, label) =>
      onSnapshot(
        byEdition(name),
        (snapshot) => setter(mapSnapshot(snapshot)),
        (snapshotError) => {
          console.error(`Unable to load ${name}`, snapshotError);
          setError(`Impossible de charger ${label}.`);
        },
      );

    const unsubscribers = [
      listen("cashArticles", (items) => setArticles(sortByOrder(items)), "les articles"),
      listen("doorGuestLists", (items) => setGuestLists(sortByOrder(items)), "les listes d'invités"),
      listen("doorGuests", setGuests, "les invités"),
      listen("cashSales", setSales, "les ventes"),
      listen("doorCheckIns", setCheckIns, "les entrées"),
    ];

    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [activeEditionId, editionLoading]);

  useEffect(() => {
    if (selectedListId && !guestLists.some((list) => list.id === selectedListId)) {
      setSelectedListId("");
    }
  }, [guestLists, selectedListId]);

  async function runAction(key, action, successMessage) {
    setBusyKey(key);
    setError("");
    setStatusMessage("");
    try {
      await action();
      if (successMessage) setStatusMessage(successMessage);
    } catch (actionError) {
      console.error(`Cash desk action ${key} failed`, actionError);
      setError(actionError?.message ? `Action impossible : ${actionError.message}` : "Action impossible.");
    } finally {
      setBusyKey("");
    }
  }

  // ── Postes ────────────────────────────────────────────────────────────────

  function handleCreateDefaultPosts() {
    const existingIds = new Set(posts.map((post) => post.id));
    const missing = DEFAULT_CASH_POSTS.filter((post) => !existingIds.has(post.id));
    return runAction(
      "default-posts",
      async () => {
        const batch = writeBatch(db);
        missing.forEach(({ id, ...post }) => {
          batch.set(doc(db, "cashPosts", id), {
            ...post,
            active: true,
            accessVersion: 0,
            hasCode: false,
            createdAt: serverTimestamp(),
          });
        });
        await batch.commit();
      },
      `${missing.length} poste(s) créé(s). Génère maintenant un code pour chacun.`,
    );
  }

  function handleCreatePost(event) {
    event.preventDefault();
    const name = newPostForm.name.trim();
    if (!name) return undefined;
    const id = normalizeSearchValue(name).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    if (!id || posts.some((post) => post.id === id)) {
      setError("Un poste avec ce nom existe déjà.");
      return undefined;
    }
    return runAction(
      "new-post",
      async () => {
        await setDoc(doc(db, "cashPosts", id), {
          name,
          kind: newPostForm.kind,
          showVipLists: newPostForm.kind === "vip",
          active: true,
          accessVersion: 0,
          hasCode: false,
          sortOrder: posts.length + 1,
          createdAt: serverTimestamp(),
        });
        setNewPostForm({ name: "", kind: "public" });
      },
      "Poste ajouté.",
    );
  }

  function handleUpdatePost(post, changes, message) {
    return runAction(`post-${post.id}`, () => updateDoc(doc(db, "cashPosts", post.id), { ...changes, updatedAt: serverTimestamp() }), message);
  }

  function handleGenerateCode(post) {
    if (
      post.hasCode &&
      !window.confirm(`Générer un nouveau code pour « ${post.name} » ? L'ancien code ne marchera plus et l'ordinateur ouvert sur ce poste sera déconnecté.`)
    ) {
      return undefined;
    }
    return runAction(`code-${post.id}`, async () => {
      const setCode = httpsCallable(functions, "setCashPostCode");
      const response = await setCode({ postId: post.id });
      setRevealedCode({ postId: post.id, postName: post.name, code: response?.data?.code || "" });
    });
  }

  function handlePairReader(post) {
    const pairingCode = window.prompt(
      `Appairer un SumUp Solo à « ${post.name} »

Sur le Solo : Connexions → API → Connecter. Saisis ici le code affiché (valable 5 minutes).`,
    );
    if (!pairingCode) return undefined;
    return runAction(
      `reader-${post.id}`,
      async () => {
        const pairReader = httpsCallable(functions, "pairSumupReader");
        await pairReader({ postId: post.id, pairingCode });
      },
      `Solo appairé à « ${post.name} ».`,
    );
  }

  function handleUnpairReader(post) {
    if (!window.confirm(`Dissocier le Solo de « ${post.name} » ? Il faudra aussi faire Connexions → API → Déconnecter sur le Solo.`)) {
      return undefined;
    }
    return runAction(
      `reader-${post.id}`,
      async () => {
        const unpairReader = httpsCallable(functions, "unpairSumupReader");
        await unpairReader({ postId: post.id });
      },
      `Solo dissocié de « ${post.name} ».`,
    );
  }

  function handleDisconnectPost(post) {
    if (!window.confirm(`Déconnecter l'ordinateur ouvert sur « ${post.name} » ? Le code actuel reste valable pour se reconnecter.`)) {
      return undefined;
    }
    return handleUpdatePost(post, { accessVersion: increment(1) }, `« ${post.name} » est déconnecté.`);
  }

  // ── Articles ──────────────────────────────────────────────────────────────

  function handleSeedArticles() {
    return runAction(
      "seed-articles",
      async () => {
        const batch = writeBatch(db);
        buildDefaultCashArticles(TICKET_PRICING).forEach(({ id, ...article }) => {
          batch.set(doc(db, "cashArticles", `${activeEditionId}-${id}`), {
            ...article,
            editionId: activeEditionId,
            active: true,
            createdAt: serverTimestamp(),
          });
        });
        await batch.commit();
      },
      "Articles créés à partir de la grille tarifaire (prix sur place).",
    );
  }

  function toggleArticleFormKind(kind) {
    setArticleForm((current) => ({
      ...current,
      postKinds: current.postKinds.includes(kind)
        ? current.postKinds.filter((value) => value !== kind)
        : [...current.postKinds, kind],
    }));
  }

  function handleArticleSubmit(event) {
    event.preventDefault();
    const label = articleForm.label.trim();
    if (!label) return undefined;
    const payload = {
      label,
      priceCents: toCents(articleForm.price),
      postKinds: articleForm.postKinds,
      updatedAt: serverTimestamp(),
    };
    return runAction(
      "article",
      async () => {
        if (editingArticleId) {
          await updateDoc(doc(db, "cashArticles", editingArticleId), payload);
        } else {
          await addDoc(collection(db, "cashArticles"), {
            ...payload,
            editionId: activeEditionId,
            active: true,
            sortOrder: articles.length + 1,
            createdAt: serverTimestamp(),
          });
        }
        setArticleForm(EMPTY_ARTICLE_FORM);
        setEditingArticleId("");
      },
      editingArticleId ? "Article mis à jour." : "Article ajouté.",
    );
  }

  function handleEditArticle(article) {
    setEditingArticleId(article.id);
    setArticleForm({
      label: article.label || "",
      price: String((Number(article.priceCents) || 0) / 100).replace(".", ","),
      postKinds: Array.isArray(article.postKinds) ? article.postKinds : [],
    });
  }

  function handleDeleteArticle(article) {
    if (!window.confirm(`Supprimer l'article « ${article.label} » ? Les ventes déjà faites le gardent.`)) return undefined;
    return runAction(`article-${article.id}`, () => deleteDoc(doc(db, "cashArticles", article.id)), "Article supprimé.");
  }

  // ── Listes d'invités ──────────────────────────────────────────────────────

  const selectedList = guestLists.find((list) => list.id === selectedListId) || null;
  const guestsByList = useMemo(() => {
    const grouped = new Map();
    guests.forEach((guest) => {
      grouped.set(guest.listId, [...(grouped.get(guest.listId) || []), guest]);
    });
    return grouped;
  }, [guests]);

  const checkInsById = useMemo(() => new Map(checkIns.map((checkIn) => [checkIn.id, checkIn])), [checkIns]);

  const selectedListGuests = useMemo(() => {
    const terms = normalizeSearchValue(guestSearch).split(" ").filter(Boolean);
    return (guestsByList.get(selectedListId) || [])
      .filter((guest) => {
        if (!terms.length) return true;
        const haystack = normalizeSearchValue([guest.firstName, guest.lastName, guest.organization, guest.email].join(" "));
        return terms.every((term) => haystack.includes(term));
      })
      .sort((left, right) =>
        normalizeSearchValue(buildPersonName(left.lastName, left.firstName)).localeCompare(
          normalizeSearchValue(buildPersonName(right.lastName, right.firstName)),
        ),
      );
  }, [guestSearch, guestsByList, selectedListId]);

  function handleCreateList(event) {
    event.preventDefault();
    const name = listForm.name.trim();
    if (!name) return undefined;
    return runAction(
      "list",
      async () => {
        const created = await addDoc(collection(db, "doorGuestLists"), {
          ...listForm,
          name,
          editionId: activeEditionId,
          active: true,
          sortOrder: guestLists.length + 1,
          createdAt: serverTimestamp(),
        });
        setListForm(EMPTY_LIST_FORM);
        setSelectedListId(created.id);
      },
      "Liste créée.",
    );
  }

  function handleDeleteList(list) {
    const count = guestsByList.get(list.id)?.length || 0;
    if (!window.confirm(`Supprimer la liste « ${list.name} » et ses ${count} invité(s) ?`)) return undefined;
    return runAction(
      `list-${list.id}`,
      async () => {
        const toDelete = guestsByList.get(list.id) || [];
        for (let index = 0; index < toDelete.length; index += 400) {
          const batch = writeBatch(db);
          toDelete.slice(index, index + 400).forEach((guest) => batch.delete(doc(db, "doorGuests", guest.id)));
          await batch.commit();
        }
        await deleteDoc(doc(db, "doorGuestLists", list.id));
      },
      "Liste supprimée.",
    );
  }

  function handleAddGuest(event) {
    event.preventDefault();
    if (!selectedList) return undefined;
    if (!guestForm.firstName.trim() && !guestForm.lastName.trim() && !guestForm.organization.trim()) {
      setError("Indique au moins un nom ou une organisation.");
      return undefined;
    }
    return runAction(
      "guest",
      async () => {
        await addDoc(collection(db, "doorGuests"), {
          listId: selectedList.id,
          editionId: activeEditionId,
          firstName: guestForm.firstName.trim(),
          lastName: guestForm.lastName.trim(),
          organization: guestForm.organization.trim(),
          email: guestForm.email.trim().toLowerCase(),
          places: Math.max(1, Number.parseInt(guestForm.places, 10) || 1),
          notes: guestForm.notes.trim(),
          source: "admin_manual",
          createdAt: serverTimestamp(),
        });
        setGuestForm(EMPTY_GUEST_FORM);
      },
      "Invité ajouté.",
    );
  }

  function handleDeleteGuest(guest) {
    if (!window.confirm(`Retirer ${buildPersonName(guest.firstName, guest.lastName) || guest.organization} de la liste ?`)) {
      return undefined;
    }
    return runAction(`guest-${guest.id}`, () => deleteDoc(doc(db, "doorGuests", guest.id)));
  }

  async function handleImportFile(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !selectedList) return;
    setError("");
    setStatusMessage("");
    try {
      const { read, utils } = await import("xlsx");
      const workbook = read(await file.arrayBuffer());
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false });
      const parsed = parseGuestImportRows(rows);
      if (parsed.error === "missing_name_column") {
        setError("Colonne de nom introuvable. La première ligne doit contenir « Prénom » et/ou « Nom » (ou « Nom complet »).");
        return;
      }
      setPendingImport({ ...parsed, fileName: file.name, listId: selectedList.id });
    } catch (importError) {
      console.error("Guest list import failed", importError);
      setError("Impossible de lire ce fichier Excel.");
    }
  }

  function handleConfirmImport() {
    if (!pendingImport) return undefined;
    const { guests: importedGuests, listId, fileName } = pendingImport;
    return runAction(
      "import",
      async () => {
        for (let index = 0; index < importedGuests.length; index += 400) {
          const batch = writeBatch(db);
          importedGuests.slice(index, index + 400).forEach((guest) => {
            batch.set(doc(collection(db, "doorGuests")), {
              ...guest,
              listId,
              editionId: activeEditionId,
              source: "excel_import",
              importFileName: fileName,
              createdAt: serverTimestamp(),
            });
          });
          await batch.commit();
        }
        setPendingImport(null);
      },
      `${importedGuests.length} invité(s) importé(s).`,
    );
  }

  // ── Suivi ─────────────────────────────────────────────────────────────────

  const paidSales = useMemo(() => sales.filter(isPaidSale), [sales]);

  const statsByPost = useMemo(() => {
    const stats = new Map(posts.map((post) => [post.id, { post, entries: 0, sales: 0, tickets: 0, totalCents: 0 }]));
    const ensure = (postId, postName) => {
      if (!stats.has(postId)) stats.set(postId, { post: { id: postId, name: postName || postId }, entries: 0, sales: 0, tickets: 0, totalCents: 0 });
      return stats.get(postId);
    };
    checkIns.forEach((checkIn) => {
      (Array.isArray(checkIn.history) ? checkIn.history : []).forEach((event) => {
        ensure(event.postId, event.postName).entries += Number(event.count) || 0;
      });
    });
    paidSales.forEach((sale) => {
      const stat = ensure(sale.postId, sale.postName);
      stat.sales += 1;
      stat.tickets += (sale.items || []).reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
      stat.totalCents += Number(sale.totalCents) || 0;
    });
    return [...stats.values()];
  }, [checkIns, paidSales, posts]);

  const totals = useMemo(
    () =>
      statsByPost.reduce(
        (sum, stat) => ({
          entries: sum.entries + stat.entries,
          sales: sum.sales + stat.sales,
          tickets: sum.tickets + stat.tickets,
          totalCents: sum.totalCents + stat.totalCents,
        }),
        { entries: 0, sales: 0, tickets: 0, totalCents: 0 },
      ),
    [statsByPost],
  );

  const recentSales = useMemo(
    () =>
      [...sales]
        .sort((left, right) => (right.createdAt?.toMillis?.() || 0) - (left.createdAt?.toMillis?.() || 0))
        .slice(0, 30),
    [sales],
  );

  function handleExport() {
    return runAction("export", async () => {
      const ExcelJSModule = await import("exceljs");
      const ExcelJS = ExcelJSModule.default ?? ExcelJSModule;
      const workbook = new ExcelJS.Workbook();
      workbook.creator = "MyCLIM";
      workbook.created = new Date();

      const salesSheet = workbook.addWorksheet("Ventes");
      salesSheet.columns = [
        { header: "Date", key: "date", width: 18 },
        { header: "Poste", key: "post", width: 18 },
        { header: "Caissier", key: "operator", width: 18 },
        { header: "Articles", key: "items", width: 40 },
        { header: "Billets", key: "tickets", width: 10 },
        { header: "Total (€)", key: "total", width: 12 },
        { header: "Paiement", key: "payment", width: 30 },
        { header: "Statut", key: "status", width: 18 },
        { header: "Réf. SumUp", key: "sumupCode", width: 18 },
      ];
      [...sales]
        .sort((left, right) => (left.createdAt?.toMillis?.() || 0) - (right.createdAt?.toMillis?.() || 0))
        .forEach((sale) => {
          salesSheet.addRow({
            date: formatTimestamp(sale.createdAt),
            post: sale.postName || sale.postId,
            operator: sale.operator || "",
            items: (sale.items || []).map((item) => `${item.quantity} × ${item.label}`).join(", "),
            tickets: (sale.items || []).reduce((sum, item) => sum + (Number(item.quantity) || 0), 0),
            total: (Number(sale.totalCents) || 0) / 100,
            payment: CASH_SALE_PAYMENT_METHODS[sale.paymentMethod] || sale.paymentMethod || "",
            status: CASH_SALE_STATUS_LABELS[sale.status] || sale.status || "",
            sumupCode: sale.sumupTransactionCode || "",
          });
        });

      const entriesSheet = workbook.addWorksheet("Entrées invités");
      entriesSheet.columns = [
        { header: "Invité", key: "name", width: 26 },
        { header: "Organisation", key: "organization", width: 24 },
        { header: "Liste", key: "list", width: 22 },
        { header: "Places", key: "places", width: 8 },
        { header: "Entrés", key: "admitted", width: 8 },
        { header: "Dernier passage", key: "last", width: 18 },
        { header: "Poste", key: "post", width: 18 },
      ];
      checkIns.forEach((checkIn) => {
        entriesSheet.addRow({
          name: checkIn.displayName || "",
          organization: checkIn.organization || "",
          list: checkIn.listName || "",
          places: checkIn.places || "",
          admitted: checkIn.admittedCount || 0,
          last: formatTimestamp(checkIn.lastAt),
          post: checkIn.lastPostName || checkIn.lastPostId || "",
        });
      });

      [salesSheet, entriesSheet].forEach((sheet) => {
        sheet.getRow(1).font = { bold: true };
      });
      await downloadWorkbook(workbook, `caisse-${activeEditionId}-${new Date().toISOString().slice(0, 10)}.xlsx`);
    });
  }

  const cashDeskUrl = buildAppUrl("/caisse");

  return (
    <div className="page">
      <section className="page-header">
        <div>
          <p className="eyebrow">Jour J · {activeEditionLabel}</p>
          <h1>Caisse & entrées</h1>
          <p>
            Postes de caisse des entrées, codes d'accès des ordinateurs, articles vendus et listes d'invités consultables à
            l'entrée. Les ordinateurs ouvrent <a href={cashDeskUrl} target="_blank" rel="noreferrer">{cashDeskUrl}</a> et
            saisissent le code de leur poste, sans compte bénévole.
          </p>
        </div>
      </section>

      {error ? <p className="form-error">{error}</p> : null}
      {statusMessage ? <p className="panel-note panel-note--success">{statusMessage}</p> : null}

      <div className="admin-subtabs" role="tablist" aria-label="Sections de la caisse">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            className={`admin-subtab ${activeTab === tab.id ? "admin-subtab--active" : ""}`}
            type="button"
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "postes" ? (
        <>
          {revealedCode ? (
            <Panel
              title={`Code de « ${revealedCode.postName} »`}
              subtitle="Note-le maintenant : il ne sera plus affiché. En cas de perte, génère un nouveau code."
              actions={
                <button className="button button--secondary button--small" type="button" onClick={() => setRevealedCode(null)}>
                  J'ai noté le code
                </button>
              }
            >
              <p className="cash-admin-code">{revealedCode.code}</p>
            </Panel>
          ) : null}

          <Panel
            title="Postes de caisse"
            subtitle="Chaque poste a son propre code. Régénérer un code ou cliquer sur « Déconnecter » ferme immédiatement la session ouverte sur l'ordinateur."
            actions={
              posts.length < DEFAULT_CASH_POSTS.length ? (
                <button
                  className="button button--primary button--small"
                  type="button"
                  disabled={busyKey === "default-posts"}
                  onClick={handleCreateDefaultPosts}
                >
                  Créer les postes par défaut
                </button>
              ) : null
            }
          >
            {posts.length ? (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Poste</th>
                      <th>Type</th>
                      <th>Listes VIP</th>
                      <th>Code</th>
                      <th>Terminal SumUp</th>
                      <th>Statut</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {posts.map((post) => {
                      const isBusy =
                        busyKey === `post-${post.id}` || busyKey === `code-${post.id}` || busyKey === `reader-${post.id}`;
                      return (
                        <tr key={post.id}>
                          <td><strong>{post.name}</strong></td>
                          <td>
                            <select
                              value={post.kind || "public"}
                              disabled={isBusy}
                              onChange={(event) => handleUpdatePost(post, { kind: event.target.value })}
                            >
                              {CASH_POST_KINDS.map((kind) => (
                                <option key={kind.value} value={kind.value}>{kind.label}</option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <label className="cash-admin-inline-check">
                              <input
                                type="checkbox"
                                checked={Boolean(post.showVipLists)}
                                disabled={isBusy}
                                onChange={(event) => handleUpdatePost(post, { showVipLists: event.target.checked })}
                              />
                              Affichées
                            </label>
                          </td>
                          <td>
                            {post.hasCode ? (
                              <span className="status-pill status-pill--ok">Défini · {formatTimestamp(post.codeUpdatedAt)}</span>
                            ) : (
                              <span className="status-pill status-pill--pending">Aucun code</span>
                            )}
                          </td>
                          <td>
                            {post.sumupReaderId ? (
                              <div className="cash-admin-actions">
                                <span className="status-pill status-pill--ok">
                                  Solo {post.sumupReaderSerial || post.sumupReaderId.slice(-6)}
                                </span>
                                <button className="button button--secondary button--small" type="button" disabled={isBusy} onClick={() => handleUnpairReader(post)}>
                                  Dissocier
                                </button>
                              </div>
                            ) : (
                              <button className="button button--secondary button--small" type="button" disabled={isBusy} onClick={() => handlePairReader(post)}>
                                Appairer un Solo
                              </button>
                            )}
                          </td>
                          <td>
                            {post.active === false ? (
                              <span className="status-pill status-pill--danger">Fermé</span>
                            ) : (
                              <span className="status-pill status-pill--ok">Ouvert</span>
                            )}
                          </td>
                          <td>
                            <div className="cash-admin-actions">
                              <button className="button button--secondary button--small" type="button" disabled={isBusy} onClick={() => handleGenerateCode(post)}>
                                {post.hasCode ? "Nouveau code" : "Générer le code"}
                              </button>
                              <button className="button button--secondary button--small" type="button" disabled={isBusy || !post.hasCode} onClick={() => handleDisconnectPost(post)}>
                                Déconnecter
                              </button>
                              <button
                                className={`button button--small ${post.active === false ? "button--secondary" : "button--danger-soft"}`}
                                type="button"
                                disabled={isBusy}
                                onClick={() =>
                                  handleUpdatePost(
                                    post,
                                    { active: post.active === false },
                                    post.active === false ? `« ${post.name} » est rouvert.` : `« ${post.name} » est fermé.`,
                                  )
                                }
                              >
                                {post.active === false ? "Rouvrir" : "Fermer"}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="panel-note">Aucun poste pour l'instant. Crée les 4 postes par défaut (3 entrées public + 1 entrée VIP).</p>
            )}

            <form className="auth-form auth-form--compact cash-admin-form" onSubmit={handleCreatePost}>
              <AuthFormField label="Nouveau poste">
                <input
                  value={newPostForm.name}
                  placeholder="Ex. Entrée public 4"
                  onChange={(event) => setNewPostForm((current) => ({ ...current, name: event.target.value }))}
                />
              </AuthFormField>
              <AuthFormField label="Type">
                <select value={newPostForm.kind} onChange={(event) => setNewPostForm((current) => ({ ...current, kind: event.target.value }))}>
                  {CASH_POST_KINDS.map((kind) => (
                    <option key={kind.value} value={kind.value}>{kind.label}</option>
                  ))}
                </select>
              </AuthFormField>
              <button className="button button--secondary" type="submit" disabled={busyKey === "new-post" || !newPostForm.name.trim()}>
                Ajouter le poste
              </button>
            </form>
          </Panel>
        </>
      ) : null}

      {activeTab === "articles" ? (
        <Panel
          title="Articles vendus en caisse"
          subtitle={`Billets et prix (${activeEditionLabel}). Le type de poste détermine où chaque article apparaît.`}
          actions={
            !articles.length ? (
              <button className="button button--primary button--small" type="button" disabled={busyKey === "seed-articles"} onClick={handleSeedArticles}>
                Créer depuis la grille tarifaire
              </button>
            ) : null
          }
        >
          {articles.length ? (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Article</th>
                    <th>Prix</th>
                    <th>Postes</th>
                    <th>Statut</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {articles.map((article) => (
                    <tr key={article.id}>
                      <td><strong>{article.label}</strong></td>
                      <td>{formatEuros(article.priceCents)}</td>
                      <td>
                        {(article.postKinds || [])
                          .map((kind) => CASH_POST_KINDS.find((option) => option.value === kind)?.label || kind)
                          .join(", ") || "Tous"}
                      </td>
                      <td>
                        <label className="cash-admin-inline-check">
                          <input
                            type="checkbox"
                            checked={article.active !== false}
                            onChange={(event) =>
                              runAction(`article-${article.id}`, () =>
                                updateDoc(doc(db, "cashArticles", article.id), { active: event.target.checked, updatedAt: serverTimestamp() }),
                              )
                            }
                          />
                          En vente
                        </label>
                      </td>
                      <td>
                        <div className="cash-admin-actions">
                          <button className="button button--secondary button--small" type="button" onClick={() => handleEditArticle(article)}>
                            Modifier
                          </button>
                          <button className="button button--danger-soft button--small" type="button" onClick={() => handleDeleteArticle(article)}>
                            Supprimer
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="panel-note">
              Aucun article. La grille tarifaire officielle propose : adulte {formatEuros(toCents(TICKET_PRICING.regular.onSite))},
              moins de 18 ans {formatEuros(toCents(TICKET_PRICING.under18.onSite))}, VIP {formatEuros(toCents(TICKET_PRICING.vip.onSite))} (prix sur place).
            </p>
          )}

          <form className="auth-form auth-form--compact cash-admin-form" onSubmit={handleArticleSubmit}>
            <AuthFormField label={editingArticleId ? "Modifier l'article" : "Nouvel article"} required>
              <input
                value={articleForm.label}
                placeholder="Ex. Entrée famille"
                onChange={(event) => setArticleForm((current) => ({ ...current, label: event.target.value }))}
              />
            </AuthFormField>
            <AuthFormField label="Prix (€)" required>
              <input
                inputMode="decimal"
                value={articleForm.price}
                placeholder="15,00"
                onChange={(event) => setArticleForm((current) => ({ ...current, price: event.target.value }))}
              />
            </AuthFormField>
            <fieldset className="cash-admin-fieldset">
              <legend>Postes</legend>
              {CASH_POST_KINDS.map((kind) => (
                <label key={kind.value} className="cash-admin-inline-check">
                  <input type="checkbox" checked={articleForm.postKinds.includes(kind.value)} onChange={() => toggleArticleFormKind(kind.value)} />
                  {kind.label}
                </label>
              ))}
            </fieldset>
            <div className="cash-admin-actions">
              <button className="button button--primary" type="submit" disabled={busyKey === "article" || !articleForm.label.trim()}>
                {editingArticleId ? "Enregistrer" : "Ajouter"}
              </button>
              {editingArticleId ? (
                <button
                  className="button button--secondary"
                  type="button"
                  onClick={() => {
                    setEditingArticleId("");
                    setArticleForm(EMPTY_ARTICLE_FORM);
                  }}
                >
                  Annuler
                </button>
              ) : null}
            </div>
          </form>
        </Panel>
      ) : null}

      {activeTab === "listes" ? (
        <>
          <Panel
            title="Listes d'invités"
            subtitle="Les inscrits VIP (formulaire, ajouts orga, portails partenaires) apparaissent automatiquement sur les postes qui affichent les listes VIP. Crée ici les autres listes : sponsors, athlètes, officiels, listes libres."
          >
            {guestLists.length ? (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Liste</th>
                      <th>Catégorie</th>
                      <th>Visible sur</th>
                      <th>Invités</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {guestLists.map((list) => {
                      const listGuests = guestsByList.get(list.id) || [];
                      const places = listGuests.reduce((sum, guest) => sum + (Number(guest.places) || 1), 0);
                      return (
                        <tr key={list.id} className={list.id === selectedListId ? "cash-admin-row--selected" : ""}>
                          <td><strong>{list.name}</strong></td>
                          <td>{DOOR_GUEST_LIST_CATEGORIES.find((option) => option.value === list.category)?.label || list.category}</td>
                          <td>
                            <select
                              value={list.postScope || "all"}
                              onChange={(event) =>
                                runAction(`list-${list.id}`, () =>
                                  updateDoc(doc(db, "doorGuestLists", list.id), { postScope: event.target.value, updatedAt: serverTimestamp() }),
                                )
                              }
                            >
                              {DOOR_GUEST_LIST_SCOPES.map((scope) => (
                                <option key={scope.value} value={scope.value}>{scope.label}</option>
                              ))}
                            </select>
                          </td>
                          <td>{listGuests.length} ({places} places)</td>
                          <td>
                            <div className="cash-admin-actions">
                              <button className="button button--secondary button--small" type="button" onClick={() => setSelectedListId(list.id)}>
                                Ouvrir
                              </button>
                              <button className="button button--danger-soft button--small" type="button" onClick={() => handleDeleteList(list)}>
                                Supprimer
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="panel-note">Aucune liste ({activeEditionLabel}).</p>
            )}

            <form className="auth-form auth-form--compact cash-admin-form" onSubmit={handleCreateList}>
              <AuthFormField label="Nouvelle liste" required>
                <input
                  value={listForm.name}
                  placeholder="Ex. Invités CMCM"
                  onChange={(event) => setListForm((current) => ({ ...current, name: event.target.value }))}
                />
              </AuthFormField>
              <AuthFormField label="Catégorie">
                <select value={listForm.category} onChange={(event) => setListForm((current) => ({ ...current, category: event.target.value }))}>
                  {DOOR_GUEST_LIST_CATEGORIES.map((category) => (
                    <option key={category.value} value={category.value}>{category.label}</option>
                  ))}
                </select>
              </AuthFormField>
              <AuthFormField label="Visible sur">
                <select value={listForm.postScope} onChange={(event) => setListForm((current) => ({ ...current, postScope: event.target.value }))}>
                  {DOOR_GUEST_LIST_SCOPES.map((scope) => (
                    <option key={scope.value} value={scope.value}>{scope.label}</option>
                  ))}
                </select>
              </AuthFormField>
              <button className="button button--primary" type="submit" disabled={busyKey === "list" || !listForm.name.trim()}>
                Créer la liste
              </button>
            </form>
          </Panel>

          {selectedList ? (
            <Panel
              title={selectedList.name}
              subtitle="Import Excel : première ligne = en-têtes. Colonnes reconnues : Prénom, Nom (ou Nom complet), Organisation, E-mail, Places, Notes."
              actions={
                <label className="button button--secondary button--small cash-admin-file">
                  Importer un Excel
                  <input type="file" accept=".xlsx,.xls,.csv" onChange={handleImportFile} />
                </label>
              }
            >
              {pendingImport && pendingImport.listId === selectedList.id ? (
                <div className="cash-admin-import">
                  <p>
                    <strong>{pendingImport.fileName}</strong> : {pendingImport.guests.length} invité(s) à importer
                    {pendingImport.skipped ? `, ${pendingImport.skipped} ligne(s) vide(s) ignorée(s)` : ""}. Aperçu :{" "}
                    {pendingImport.guests
                      .slice(0, 5)
                      .map((guest) => buildPersonName(guest.firstName, guest.lastName) || guest.organization)
                      .join(", ")}
                    {pendingImport.guests.length > 5 ? "…" : ""}
                  </p>
                  <div className="cash-admin-actions">
                    <button className="button button--primary button--small" type="button" disabled={busyKey === "import" || !pendingImport.guests.length} onClick={handleConfirmImport}>
                      Importer dans « {selectedList.name} »
                    </button>
                    <button className="button button--secondary button--small" type="button" onClick={() => setPendingImport(null)}>
                      Annuler
                    </button>
                  </div>
                </div>
              ) : null}

              <form className="auth-form auth-form--compact cash-admin-form" onSubmit={handleAddGuest}>
                <AuthFormField label="Prénom">
                  <input value={guestForm.firstName} onChange={(event) => setGuestForm((current) => ({ ...current, firstName: event.target.value }))} />
                </AuthFormField>
                <AuthFormField label="Nom">
                  <input value={guestForm.lastName} onChange={(event) => setGuestForm((current) => ({ ...current, lastName: event.target.value }))} />
                </AuthFormField>
                <AuthFormField label="Organisation">
                  <input value={guestForm.organization} onChange={(event) => setGuestForm((current) => ({ ...current, organization: event.target.value }))} />
                </AuthFormField>
                <AuthFormField label="Places">
                  <input
                    type="number"
                    min="1"
                    value={guestForm.places}
                    onChange={(event) => setGuestForm((current) => ({ ...current, places: event.target.value }))}
                  />
                </AuthFormField>
                <AuthFormField label="Notes">
                  <input value={guestForm.notes} onChange={(event) => setGuestForm((current) => ({ ...current, notes: event.target.value }))} />
                </AuthFormField>
                <button className="button button--primary" type="submit" disabled={busyKey === "guest"}>
                  Ajouter
                </button>
              </form>

              <input
                className="cash-admin-search"
                type="search"
                placeholder="Rechercher dans la liste…"
                value={guestSearch}
                onChange={(event) => setGuestSearch(event.target.value)}
              />

              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Invité</th>
                      <th>Organisation</th>
                      <th>Places</th>
                      <th>Entrée</th>
                      <th>Notes</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {selectedListGuests.map((guest) => {
                      const checkIn = checkInsById.get(`${activeEditionId}__door_guest__${guest.id}`);
                      return (
                        <tr key={guest.id}>
                          <td>{buildPersonName(guest.firstName, guest.lastName) || "—"}</td>
                          <td>{guest.organization || "—"}</td>
                          <td>{guest.places || 1}</td>
                          <td>
                            {checkIn?.admittedCount ? (
                              <span className="status-pill status-pill--ok">
                                {checkIn.admittedCount}/{guest.places || 1} · {formatTimestamp(checkIn.lastAt)}
                              </span>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td>{guest.notes || ""}</td>
                          <td>
                            <button className="button button--danger-soft button--small" type="button" onClick={() => handleDeleteGuest(guest)}>
                              Retirer
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                    {!selectedListGuests.length ? (
                      <tr>
                        <td colSpan={6}>Aucun invité.</td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </Panel>
          ) : null}
        </>
      ) : null}

      {activeTab === "suivi" ? (
        <>
          <Panel
            title="Bilan par poste"
            subtitle="Mis à jour en direct pendant l'événement."
            actions={
              <button className="button button--secondary button--small" type="button" disabled={busyKey === "export"} onClick={handleExport}>
                Exporter en Excel
              </button>
            }
          >
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Poste</th>
                    <th>Entrées invités</th>
                    <th>Ventes</th>
                    <th>Billets vendus</th>
                    <th>Montant</th>
                  </tr>
                </thead>
                <tbody>
                  {statsByPost.map((stat) => (
                    <tr key={stat.post.id}>
                      <td><strong>{stat.post.name}</strong></td>
                      <td>{stat.entries}</td>
                      <td>{stat.sales}</td>
                      <td>{stat.tickets}</td>
                      <td>{formatEuros(stat.totalCents)}</td>
                    </tr>
                  ))}
                  <tr className="cash-admin-total-row">
                    <td>Total</td>
                    <td>{totals.entries}</td>
                    <td>{totals.sales}</td>
                    <td>{totals.tickets}</td>
                    <td>{formatEuros(totals.totalCents)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Panel>

          <Panel title="Dernières ventes">
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Heure</th>
                    <th>Poste</th>
                    <th>Articles</th>
                    <th>Total</th>
                    <th>Statut</th>
                  </tr>
                </thead>
                <tbody>
                  {recentSales.map((sale) => (
                    <tr key={sale.id}>
                      <td>{formatTimestamp(sale.createdAt)}</td>
                      <td>{sale.postName || sale.postId}</td>
                      <td>{(sale.items || []).map((item) => `${item.quantity} × ${item.label}`).join(", ")}</td>
                      <td>{formatEuros(sale.totalCents)}</td>
                      <td>
                        <span
                          className={`status-pill ${
                            sale.status === "paid" ? "status-pill--ok" : sale.status === "pending" ? "status-pill--pending" : "status-pill--danger"
                          }`}
                          title={sale.failureReason || ""}
                        >
                          {CASH_SALE_STATUS_LABELS[sale.status] || sale.status}
                          {sale.paymentMethod === "sumup_solo" ? " · Solo" : ""}
                        </span>
                        {sale.amountMismatch ? <span className="status-pill status-pill--danger">Montant SumUp différent</span> : null}
                      </td>
                    </tr>
                  ))}
                  {!recentSales.length ? (
                    <tr>
                      <td colSpan={5}>Aucune vente pour l'instant.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </Panel>
        </>
      ) : null}
    </div>
  );
}

export { CashDeskAdminPage };
