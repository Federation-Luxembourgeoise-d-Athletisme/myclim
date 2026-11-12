import { useEffect, useMemo, useState } from "react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../services/firebase";
import { buildAppUrl } from "../services/app-url";
import { useActiveEdition } from "./edition";
import { useTr } from "./use-tr";
import { useLanguage } from "./language-context";
import { mapSnapshot, useDoorData } from "./cash-desk-data";
import {
  DEFAULT_CASH_POSTS,
  DOOR_ENTRY_KINDS,
  DOOR_GUEST_LIST_CATEGORIES,
  buildPersonName,
  countEntriesByPost,
  filterDoorEntries,
  flattenCheckInEvents,
  normalizeSearchValue,
  parseGuestImportRows,
} from "./cash-desk-helpers";
import "./cash-desk.css";

const EMPTY_GUEST_FORM = { listId: "", firstName: "", lastName: "", organization: "", places: "1", notes: "" };
const EMPTY_LIST_FORM = { name: "", category: "sponsors" };
const MAX_GUEST_ROWS = 300;
const MAX_LOG_ROWS = 150;

function sortByOrder(items) {
  return [...items].sort(
    (left, right) =>
      (Number(left.sortOrder) || 0) - (Number(right.sortOrder) || 0) ||
      String(left.name || "").localeCompare(String(right.name || "")),
  );
}

function toDate(value) {
  const date = value?.toDate?.() || (typeof value === "number" ? new Date(value) : value ? new Date(value) : null);
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

function formatDateTime(value) {
  const date = toDate(value);
  return date ? date.toLocaleString("fr-LU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";
}

function formatTime(value) {
  const date = toDate(value);
  return date ? date.toLocaleTimeString("fr-LU", { hour: "2-digit", minute: "2-digit" }) : "—";
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

function CashDeskAdminPage() {
  const tr = useTr();
  const { language } = useLanguage();
  const { activeEditionId, activeEditionLabel, loading: editionLoading } = useActiveEdition(true);
  const { entries, guestLists, guests, checkIns, error: dataError } = useDoorData({
    editionId: activeEditionId,
    enabled: !editionLoading,
  });

  const [activeTab, setActiveTab] = useState("guests");
  const [posts, setPosts] = useState([]);
  const [access, setAccess] = useState(null);
  const [revealedCode, setRevealedCode] = useState("");
  const [error, setError] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [busyKey, setBusyKey] = useState("");

  const [search, setSearch] = useState("");
  const [listFilter, setListFilter] = useState("all");
  const [stateFilter, setStateFilter] = useState("all");
  const [showGuestForm, setShowGuestForm] = useState(false);
  const [guestForm, setGuestForm] = useState(EMPTY_GUEST_FORM);
  const [pendingImport, setPendingImport] = useState(null);

  const [showListForm, setShowListForm] = useState(false);
  const [listForm, setListForm] = useState(EMPTY_LIST_FORM);
  const [newPostName, setNewPostName] = useState("");

  useEffect(() => {
    const stopPosts = onSnapshot(
      collection(db, "cashPosts"),
      (snapshot) => setPosts(sortByOrder(mapSnapshot(snapshot))),
      (snapshotError) => {
        console.error("Unable to load cash posts", snapshotError);
        setError(tr("Impossible de charger les postes.", "Unable to load the posts."));
      },
    );
    const stopAccess = onSnapshot(
      doc(db, "cashDesk", "access"),
      (snapshot) => setAccess(snapshot.exists() ? snapshot.data() : {}),
      (snapshotError) => console.error("Unable to load cash desk access", snapshotError),
    );
    return () => {
      stopPosts();
      stopAccess();
    };
    // tr ne sert qu'au message d'erreur.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function runAction(key, action, successMessage) {
    setBusyKey(key);
    setError("");
    setStatusMessage("");
    try {
      await action();
      if (successMessage) setStatusMessage(successMessage);
    } catch (actionError) {
      console.error(`Cash desk action ${key} failed`, actionError);
      setError(tr("Action impossible", "Action failed") + (actionError?.message ? ` : ${actionError.message}` : "."));
    } finally {
      setBusyKey("");
    }
  }

  // ── Accès ────────────────────────────────────────────────────────────────
  const hasCode = Boolean(access?.hasCode);
  const isOpen = access?.open !== false;
  const cashDeskUrl = buildAppUrl("/caisse");

  function handleGenerateCode() {
    if (
      hasCode &&
      !window.confirm(
        tr(
          "Générer un nouveau code ? L'ancien ne marchera plus et tous les ordinateurs de caisse devront saisir le nouveau.",
          "Generate a new code? The old one stops working and every cash desk computer will need the new one.",
        ),
      )
    ) {
      return undefined;
    }
    return runAction("code", async () => {
      const response = await httpsCallable(functions, "setCashDeskCode")({});
      setRevealedCode(response?.data?.code || "");
    });
  }

  function handleToggleOpen() {
    if (
      isOpen &&
      !window.confirm(
        tr(
          "Fermer la caisse ? Tous les postes sont bloqués jusqu'à la réouverture (le code reste le même).",
          "Close the cash desk? Every post is blocked until you reopen it (the code stays the same).",
        ),
      )
    ) {
      return undefined;
    }
    return runAction(
      "open",
      () => setDoc(doc(db, "cashDesk", "access"), { open: !isOpen, openUpdatedAt: serverTimestamp() }, { merge: true }),
      isOpen ? tr("Caisse fermée.", "Cash desk closed.") : tr("Caisse rouverte.", "Cash desk reopened."),
    );
  }

  function handleCopyLink() {
    navigator.clipboard?.writeText(cashDeskUrl).then(
      () => setStatusMessage(tr("Lien copié.", "Link copied.")),
      () => setError(tr("Copie impossible.", "Copy failed.")),
    );
  }

  // ── Invités ──────────────────────────────────────────────────────────────
  const doorLists = useMemo(() => sortByOrder(guestLists), [guestLists]);

  const listOptions = useMemo(() => {
    const options = [];
    if (entries.some((entry) => entry.listId === "vip")) options.push({ id: "vip", name: "VIP" });
    if (entries.some((entry) => entry.listId === "national_races")) {
      options.push({ id: "national_races", name: tr("Courses nationales", "National races") });
    }
    doorLists.forEach((list) => options.push({ id: list.id, name: list.name }));
    return options;
  }, [doorLists, entries, tr]);

  const filteredEntries = useMemo(() => {
    let rows = filterDoorEntries(entries, search);
    if (listFilter !== "all") rows = rows.filter((entry) => entry.listId === listFilter);
    if (stateFilter === "in") rows = rows.filter((entry) => entry.admittedCount > 0);
    if (stateFilter === "out") rows = rows.filter((entry) => entry.admittedCount === 0);
    return rows;
  }, [entries, listFilter, search, stateFilter]);

  const totals = useMemo(() => {
    const places = entries.reduce((sum, entry) => sum + entry.places, 0);
    const admitted = entries.reduce((sum, entry) => sum + entry.admittedCount, 0);
    return { people: entries.length, places, admitted, remaining: Math.max(0, places - admitted) };
  }, [entries]);

  function openGuestForm() {
    const preset = doorLists.some((list) => list.id === listFilter) ? listFilter : doorLists[0]?.id || "";
    setGuestForm({ ...EMPTY_GUEST_FORM, listId: preset });
    setShowGuestForm(true);
  }

  function handleAddGuest(event) {
    event.preventDefault();
    if (!guestForm.listId) {
      setError(tr("Crée d'abord une liste (onglet Listes).", "Create a list first (Lists tab)."));
      return undefined;
    }
    if (!guestForm.firstName.trim() && !guestForm.lastName.trim() && !guestForm.organization.trim()) {
      setError(tr("Indique au moins un nom ou une organisation.", "Enter at least a name or an organisation."));
      return undefined;
    }
    return runAction(
      "guest",
      async () => {
        await addDoc(collection(db, "doorGuests"), {
          listId: guestForm.listId,
          editionId: activeEditionId,
          firstName: guestForm.firstName.trim(),
          lastName: guestForm.lastName.trim(),
          organization: guestForm.organization.trim(),
          email: "",
          places: Math.max(1, Number.parseInt(guestForm.places, 10) || 1),
          notes: guestForm.notes.trim(),
          source: "admin_manual",
          createdAt: serverTimestamp(),
        });
        setGuestForm((current) => ({ ...EMPTY_GUEST_FORM, listId: current.listId }));
      },
      tr("Invité ajouté.", "Guest added."),
    );
  }

  function handleDeleteGuest(entry) {
    if (!window.confirm(tr(`Retirer ${entry.fullName || entry.organization} de la liste ?`, `Remove ${entry.fullName || entry.organization} from the list?`))) {
      return undefined;
    }
    return runAction(`guest-${entry.sourceId}`, () => deleteDoc(doc(db, "doorGuests", entry.sourceId)));
  }

  async function handleImportFile(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError("");
    setStatusMessage("");
    try {
      const { read, utils } = await import("xlsx");
      const workbook = read(await file.arrayBuffer());
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false });
      const parsed = parseGuestImportRows(rows);
      if (parsed.error === "full_name_only") {
        setError(
          tr(
            "Ce fichier n'a qu'une colonne de nom. Sépare-la en deux colonnes « Prénom » et « Nom » avant d'importer.",
            "This file has a single name column. Split it into “First name” and “Last name” columns before importing.",
          ),
        );
        return;
      }
      if (parsed.error) {
        setError(tr("Colonnes « Prénom » et « Nom » introuvables sur la première ligne.", "“First name” and “Last name” columns not found on the first row."));
        return;
      }
      const preset = doorLists.some((list) => list.id === listFilter) ? listFilter : doorLists[0]?.id || "";
      setPendingImport({ ...parsed, fileName: file.name, listId: preset });
    } catch (importError) {
      console.error("Guest list import failed", importError);
      setError(tr("Impossible de lire ce fichier Excel.", "Unable to read this Excel file."));
    }
  }

  function handleConfirmImport() {
    if (!pendingImport?.listId) return undefined;
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
        setListFilter(listId);
      },
      tr(`${importedGuests.length} invité(s) importé(s).`, `${importedGuests.length} guest(s) imported.`),
    );
  }

  // ── Listes ───────────────────────────────────────────────────────────────
  const listStats = useMemo(() => {
    const stats = new Map();
    entries.forEach((entry) => {
      const current = stats.get(entry.listId) || { people: 0, places: 0, admitted: 0 };
      current.people += 1;
      current.places += entry.places;
      current.admitted += entry.admittedCount;
      stats.set(entry.listId, current);
    });
    return stats;
  }, [entries]);

  function handleCreateList(event) {
    event.preventDefault();
    const name = listForm.name.trim();
    if (!name) return undefined;
    return runAction(
      "list",
      async () => {
        await addDoc(collection(db, "doorGuestLists"), {
          name,
          category: listForm.category,
          editionId: activeEditionId,
          active: true,
          sortOrder: guestLists.length + 1,
          createdAt: serverTimestamp(),
        });
        setListForm(EMPTY_LIST_FORM);
        setShowListForm(false);
      },
      tr("Liste créée.", "List created."),
    );
  }

  function handleDeleteList(list) {
    const toDelete = guests.filter((guest) => guest.listId === list.id);
    if (!window.confirm(tr(`Supprimer la liste « ${list.name} » et ses ${toDelete.length} invité(s) ?`, `Delete the list “${list.name}” and its ${toDelete.length} guest(s)?`))) {
      return undefined;
    }
    return runAction(
      `list-${list.id}`,
      async () => {
        for (let index = 0; index < toDelete.length; index += 400) {
          const batch = writeBatch(db);
          toDelete.slice(index, index + 400).forEach((guest) => batch.delete(doc(db, "doorGuests", guest.id)));
          await batch.commit();
        }
        await deleteDoc(doc(db, "doorGuestLists", list.id));
        if (listFilter === list.id) setListFilter("all");
      },
      tr("Liste supprimée.", "List deleted."),
    );
  }

  function handleUpdateList(list, changes) {
    return runAction(`list-${list.id}`, () => updateDoc(doc(db, "doorGuestLists", list.id), { ...changes, updatedAt: serverTimestamp() }));
  }

  // ── Entrées & postes ─────────────────────────────────────────────────────
  const events = useMemo(() => flattenCheckInEvents(checkIns), [checkIns]);
  const entriesByPost = useMemo(() => countEntriesByPost(events), [events]);
  const orphanPostIds = [...entriesByPost.keys()].filter((postId) => postId && !posts.some((post) => post.id === postId));

  function handleCreateDefaultPosts() {
    const existingIds = new Set(posts.map((post) => post.id));
    const missing = DEFAULT_CASH_POSTS.filter((post) => !existingIds.has(post.id));
    return runAction("default-posts", async () => {
      const batch = writeBatch(db);
      missing.forEach(({ id, ...post }) => batch.set(doc(db, "cashPosts", id), { ...post, createdAt: serverTimestamp() }));
      await batch.commit();
    });
  }

  function handleCreatePost(event) {
    event.preventDefault();
    const name = newPostName.trim();
    if (!name) return undefined;
    const id = normalizeSearchValue(name).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    if (!id || posts.some((post) => post.id === id)) {
      setError(tr("Un poste avec ce nom existe déjà.", "A post with this name already exists."));
      return undefined;
    }
    return runAction("new-post", async () => {
      await setDoc(doc(db, "cashPosts", id), { name, sortOrder: posts.length + 1, createdAt: serverTimestamp() });
      setNewPostName("");
    });
  }

  function handleDeletePost(post) {
    if (!window.confirm(tr(`Supprimer le poste « ${post.name} » ? Les entrées déjà validées restent comptées.`, `Delete the post “${post.name}”? Entries already recorded stay counted.`))) {
      return undefined;
    }
    return runAction(`post-${post.id}`, () => deleteDoc(doc(db, "cashPosts", post.id)));
  }

  function handleExport() {
    return runAction("export", async () => {
      const ExcelJSModule = await import("exceljs");
      const ExcelJS = ExcelJSModule.default ?? ExcelJSModule;
      const workbook = new ExcelJS.Workbook();
      workbook.creator = "MyCLIM";
      workbook.created = new Date();

      const guestSheet = workbook.addWorksheet(tr("Invités", "Guests"));
      guestSheet.columns = [
        { header: tr("Prénom Nom", "Name"), key: "name", width: 26 },
        { header: tr("Organisation", "Organisation"), key: "organization", width: 24 },
        { header: tr("Liste", "List"), key: "list", width: 22 },
        { header: tr("Places", "Places"), key: "places", width: 8 },
        { header: tr("Entrés", "Admitted"), key: "admitted", width: 9 },
        { header: tr("Dernier passage", "Last entry"), key: "last", width: 16 },
        { header: tr("Poste", "Post"), key: "post", width: 18 },
      ];
      entries.forEach((entry) => {
        guestSheet.addRow({
          name: entry.fullName,
          organization: entry.organization,
          list: entry.listName,
          places: entry.places,
          admitted: entry.admittedCount,
          last: entry.checkIn?.lastAt ? formatDateTime(entry.checkIn.lastAt) : "",
          post: entry.checkIn?.lastPostName || "",
        });
      });
      guestSheet.getRow(1).font = { bold: true };

      const logSheet = workbook.addWorksheet(tr("Journal", "Log"));
      logSheet.columns = [
        { header: tr("Heure", "Time"), key: "time", width: 16 },
        { header: tr("Invité", "Guest"), key: "name", width: 26 },
        { header: tr("Liste", "List"), key: "list", width: 22 },
        { header: tr("Poste", "Post"), key: "post", width: 18 },
        { header: tr("Caissier", "Operator"), key: "operator", width: 16 },
        { header: tr("Nombre", "Count"), key: "count", width: 8 },
        { header: tr("Forcé", "Forced"), key: "forced", width: 8 },
      ];
      events.forEach((event) => {
        logSheet.addRow({
          time: formatDateTime(event.time),
          name: event.displayName,
          list: event.listName,
          post: event.postName,
          operator: event.operator,
          count: event.count,
          forced: event.forced ? tr("oui", "yes") : "",
        });
      });
      logSheet.getRow(1).font = { bold: true };

      await downloadWorkbook(workbook, `entrees-${activeEditionId}-${new Date().toISOString().slice(0, 10)}.xlsx`);
    });
  }

  const kindLabel = (kind) => (DOOR_ENTRY_KINDS[kind] || DOOR_ENTRY_KINDS.free)[language === "fr" ? "fr" : "en"];
  const categoryLabel = (value) => {
    const category = DOOR_GUEST_LIST_CATEGORIES.find((option) => option.value === value);
    return category ? (language === "fr" ? category.label : category.labelEn) : value || "—";
  };

  const tabs = [
    { id: "guests", label: tr("Invités", "Guests"), count: entries.length },
    { id: "lists", label: tr("Listes", "Lists"), count: listOptions.length },
    { id: "entries", label: tr("Entrées & postes", "Entries & posts"), count: totals.admitted },
  ];

  const visibleRows = filteredEntries.slice(0, MAX_GUEST_ROWS);

  return (
    <div className="page cash-admin">
      <header className="cash-admin-head">
        <div>
          <p className="eyebrow">{tr("Jour J", "Event day")} · {activeEditionLabel}</p>
          <h1>{tr("Caisse & entrées", "Cash desk & entries")}</h1>
        </div>
        <dl className="cash-kpis">
          <div>
            <dt>{tr("Invités", "Guests")}</dt>
            <dd>{totals.people}</dd>
          </div>
          <div>
            <dt>{tr("Places", "Places")}</dt>
            <dd>{totals.places}</dd>
          </div>
          <div>
            <dt>{tr("Entrés", "Admitted")}</dt>
            <dd className="is-ok">{totals.admitted}</dd>
          </div>
          <div>
            <dt>{tr("Attendus", "Expected")}</dt>
            <dd>{totals.remaining}</dd>
          </div>
        </dl>
      </header>

      <section className="cash-access">
        <span className={`cash-dot ${!hasCode ? "is-off" : isOpen ? "is-on" : "is-closed"}`} aria-hidden="true" />
        <div className="cash-access__state">
          <strong>
            {!hasCode
              ? tr("Pas encore de code", "No code yet")
              : isOpen
                ? tr("Caisse ouverte", "Cash desk open")
                : tr("Caisse fermée", "Cash desk closed")}
          </strong>
          <span>
            {hasCode
              ? tr(`Code créé le ${formatDateTime(access?.codeUpdatedAt)}`, `Code created ${formatDateTime(access?.codeUpdatedAt)}`)
              : tr("Génère le code à donner aux postes.", "Generate the code to give to the posts.")}
          </span>
        </div>
        <div className="cash-access__link">
          <a href={cashDeskUrl} target="_blank" rel="noreferrer">{cashDeskUrl.replace(/^https?:\/\//, "")}</a>
          <button className="cash-btn cash-btn--ghost" type="button" onClick={handleCopyLink}>{tr("Copier", "Copy")}</button>
        </div>
        <div className="cash-access__actions">
          <button className="cash-btn" type="button" disabled={busyKey === "code"} onClick={handleGenerateCode}>
            {hasCode ? tr("Nouveau code", "New code") : tr("Générer le code", "Generate code")}
          </button>
          {hasCode ? (
            <button className={`cash-btn ${isOpen ? "cash-btn--danger" : "cash-btn--primary"}`} type="button" disabled={busyKey === "open"} onClick={handleToggleOpen}>
              {isOpen ? tr("Fermer la caisse", "Close cash desk") : tr("Rouvrir", "Reopen")}
            </button>
          ) : null}
        </div>
        {revealedCode ? (
          <div className="cash-access__code">
            <code>{revealedCode}</code>
            <span>{tr("Note-le maintenant : il ne sera plus affiché.", "Write it down now: it won't be shown again.")}</span>
            <button className="cash-btn cash-btn--primary" type="button" onClick={() => setRevealedCode("")}>{tr("C'est noté", "Done")}</button>
          </div>
        ) : null}
      </section>

      <details className="cash-explainer">
        <summary>{tr("Comment ça marche", "How it works")}</summary>
        <ul>
          <li>{tr("Chaque ordinateur ou tablette ouvre le lien ci-dessus, saisit le code, choisit son poste et le prénom du caissier.", "Each computer or tablet opens the link above, enters the code, picks its post and the operator's first name.")}</li>
          <li>{tr("Tous les postes voient tous les invités : VIP, sponsors, invités des athlètes, courses nationales et listes ajoutées ici.", "Every post sees every guest: VIP, sponsors, athletes' guests, national races and the lists added here.")}</li>
          <li>{tr("Les billets payants se vendent sur les SumUp, pas ici. « Fermer la caisse » bloque tous les postes ; « Nouveau code » déconnecte tout le monde.", "Paid tickets are sold on the SumUp terminals, not here. “Close cash desk” blocks every post; “New code” signs everyone out.")}</li>
        </ul>
      </details>

      {error || dataError ? <p className="form-error">{error || tr("Chargement incomplet des données.", "Some data could not be loaded.")}</p> : null}
      {statusMessage ? <p className="cash-flash">{statusMessage}</p> : null}

      <nav className="cash-tabs" role="tablist">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            className={`cash-tab ${activeTab === tab.id ? "is-active" : ""}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
            <span className="cash-tab__count">{tab.count}</span>
          </button>
        ))}
      </nav>

      {activeTab === "guests" ? (
        <section className="cash-card">
          <div className="cash-toolbar">
            <input
              className="cash-toolbar__search"
              type="search"
              placeholder={tr("Rechercher un nom, une organisation…", "Search a name, an organisation…")}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <select value={listFilter} onChange={(event) => setListFilter(event.target.value)}>
              <option value="all">{tr("Toutes les listes", "All lists")}</option>
              {listOptions.map((option) => (
                <option key={option.id} value={option.id}>{option.name}</option>
              ))}
            </select>
            <select value={stateFilter} onChange={(event) => setStateFilter(event.target.value)}>
              <option value="all">{tr("Tous", "All")}</option>
              <option value="out">{tr("Pas encore entrés", "Not yet in")}</option>
              <option value="in">{tr("Entrés", "Admitted")}</option>
            </select>
            <span className="cash-toolbar__spacer" />
            <label className="cash-btn cash-btn--file">
              {tr("Importer Excel", "Import Excel")}
              <input type="file" accept=".xlsx,.xls,.csv" onChange={handleImportFile} />
            </label>
            <button className="cash-btn cash-btn--primary" type="button" onClick={showGuestForm ? () => setShowGuestForm(false) : openGuestForm}>
              {showGuestForm ? tr("Fermer", "Close") : tr("+ Ajouter", "+ Add")}
            </button>
          </div>

          {pendingImport ? (
            <div className="cash-inline-bar">
              <span>
                <strong>{pendingImport.fileName}</strong> · {pendingImport.guests.length} {tr("invité(s)", "guest(s)")}
                {pendingImport.skipped ? ` · ${pendingImport.skipped} ${tr("ligne(s) vide(s) ignorée(s)", "empty row(s) skipped")}` : ""}
                {" — "}
                {pendingImport.guests.slice(0, 3).map((guest) => buildPersonName(guest.firstName, guest.lastName) || guest.organization).join(", ")}
                {pendingImport.guests.length > 3 ? "…" : ""}
              </span>
              <select value={pendingImport.listId} onChange={(event) => setPendingImport((current) => ({ ...current, listId: event.target.value }))}>
                <option value="">{tr("Choisir la liste…", "Choose the list…")}</option>
                {doorLists.map((list) => (
                  <option key={list.id} value={list.id}>{list.name}</option>
                ))}
              </select>
              <button className="cash-btn cash-btn--primary" type="button" disabled={busyKey === "import" || !pendingImport.listId || !pendingImport.guests.length} onClick={handleConfirmImport}>
                {tr("Importer", "Import")}
              </button>
              <button className="cash-btn cash-btn--ghost" type="button" onClick={() => setPendingImport(null)}>{tr("Annuler", "Cancel")}</button>
            </div>
          ) : null}

          {showGuestForm ? (
            <form className="cash-form" onSubmit={handleAddGuest}>
              <label>
                <span>{tr("Liste", "List")}</span>
                <select value={guestForm.listId} onChange={(event) => setGuestForm((current) => ({ ...current, listId: event.target.value }))}>
                  {!doorLists.length ? <option value="">{tr("Aucune liste", "No list")}</option> : null}
                  {doorLists.map((list) => (
                    <option key={list.id} value={list.id}>{list.name}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>{tr("Prénom", "First name")}</span>
                <input autoFocus value={guestForm.firstName} onChange={(event) => setGuestForm((current) => ({ ...current, firstName: event.target.value }))} />
              </label>
              <label>
                <span>{tr("Nom", "Last name")}</span>
                <input value={guestForm.lastName} onChange={(event) => setGuestForm((current) => ({ ...current, lastName: event.target.value }))} />
              </label>
              <label>
                <span>{tr("Organisation", "Organisation")}</span>
                <input value={guestForm.organization} onChange={(event) => setGuestForm((current) => ({ ...current, organization: event.target.value }))} />
              </label>
              <label className="cash-form__narrow">
                <span>{tr("Places", "Places")}</span>
                <input type="number" min="1" value={guestForm.places} onChange={(event) => setGuestForm((current) => ({ ...current, places: event.target.value }))} />
              </label>
              <label>
                <span>{tr("Note", "Note")}</span>
                <input value={guestForm.notes} onChange={(event) => setGuestForm((current) => ({ ...current, notes: event.target.value }))} />
              </label>
              <button className="cash-btn cash-btn--primary" type="submit" disabled={busyKey === "guest" || !doorLists.length}>
                {tr("Ajouter", "Add")}
              </button>
            </form>
          ) : null}

          <div className="table-wrap">
            <table className="cash-table">
              <thead>
                <tr>
                  <th>{tr("Invité", "Guest")}</th>
                  <th>{tr("Organisation", "Organisation")}</th>
                  <th>{tr("Liste", "List")}</th>
                  <th className="num">{tr("Entrés", "In")}</th>
                  <th>{tr("Passage", "Entry")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((entry) => (
                  <tr key={entry.key} className={entry.remainingPlaces === 0 ? "is-done" : ""}>
                    <td>
                      <strong>{entry.fullName || "—"}</strong>
                      {entry.companions.length ? <small> + {entry.companions.join(", ")}</small> : null}
                      {entry.notes ? <small className="cash-table__note">{entry.notes}</small> : null}
                    </td>
                    <td>{entry.organization || "—"}</td>
                    <td>
                      <span className={`cash-badge cash-badge--${entry.kind}`}>{kindLabel(entry.kind)}</span>{" "}
                      <span className="cash-muted">{entry.kind === "vip" || entry.kind === "national_race" ? "" : entry.listName}</span>
                    </td>
                    <td className="num">
                      <span className={entry.admittedCount ? "cash-count is-in" : "cash-count"}>{entry.admittedCount}/{entry.places}</span>
                    </td>
                    <td className="cash-muted">
                      {entry.checkIn?.lastAt ? `${formatTime(entry.checkIn.lastAt)} · ${entry.checkIn.lastPostName || ""}` : ""}
                    </td>
                    <td className="cash-table__actions">
                      {entry.sourceType === "door_guest" && !entry.admittedCount ? (
                        <button className="cash-icon-btn" type="button" title={tr("Retirer", "Remove")} disabled={busyKey === `guest-${entry.sourceId}`} onClick={() => handleDeleteGuest(entry)}>
                          ✕
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
                {!visibleRows.length ? (
                  <tr>
                    <td colSpan={6} className="cash-empty">
                      {entries.length ? tr("Personne ne correspond.", "No match.") : tr("Aucun invité pour l'instant.", "No guests yet.")}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          {filteredEntries.length > MAX_GUEST_ROWS ? (
            <p className="cash-muted">{tr(`${filteredEntries.length - MAX_GUEST_ROWS} autres : affine la recherche.`, `${filteredEntries.length - MAX_GUEST_ROWS} more: refine the search.`)}</p>
          ) : null}
        </section>
      ) : null}

      {activeTab === "lists" ? (
        <section className="cash-card">
          <div className="cash-toolbar">
            <span className="cash-muted">
              {tr("VIP et courses nationales viennent automatiquement de leurs modules.", "VIP and national races come automatically from their modules.")}
            </span>
            <span className="cash-toolbar__spacer" />
            <button className="cash-btn cash-btn--primary" type="button" onClick={() => setShowListForm((current) => !current)}>
              {showListForm ? tr("Fermer", "Close") : tr("+ Nouvelle liste", "+ New list")}
            </button>
          </div>

          {showListForm ? (
            <form className="cash-form" onSubmit={handleCreateList}>
              <label className="cash-form__wide">
                <span>{tr("Nom de la liste", "List name")}</span>
                <input autoFocus value={listForm.name} placeholder={tr("Ex. Invités CMCM", "E.g. CMCM guests")} onChange={(event) => setListForm((current) => ({ ...current, name: event.target.value }))} />
              </label>
              <label>
                <span>{tr("Type", "Type")}</span>
                <select value={listForm.category} onChange={(event) => setListForm((current) => ({ ...current, category: event.target.value }))}>
                  {DOOR_GUEST_LIST_CATEGORIES.map((category) => (
                    <option key={category.value} value={category.value}>{language === "fr" ? category.label : category.labelEn}</option>
                  ))}
                </select>
              </label>
              <button className="cash-btn cash-btn--primary" type="submit" disabled={busyKey === "list" || !listForm.name.trim()}>
                {tr("Créer", "Create")}
              </button>
            </form>
          ) : null}

          <div className="table-wrap">
            <table className="cash-table">
              <thead>
                <tr>
                  <th>{tr("Liste", "List")}</th>
                  <th>{tr("Type", "Type")}</th>
                  <th className="num">{tr("Invités", "Guests")}</th>
                  <th className="num">{tr("Places", "Places")}</th>
                  <th className="num">{tr("Entrés", "In")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {listOptions
                  .filter((option) => option.id === "vip" || option.id === "national_races")
                  .map((option) => {
                    const stats = listStats.get(option.id) || { people: 0, places: 0, admitted: 0 };
                    return (
                      <tr key={option.id}>
                        <td><strong>{option.name}</strong> <span className="cash-muted">· {tr("automatique", "automatic")}</span></td>
                        <td><span className={`cash-badge cash-badge--${option.id === "vip" ? "vip" : "national_race"}`}>{kindLabel(option.id === "vip" ? "vip" : "national_race")}</span></td>
                        <td className="num">{stats.people}</td>
                        <td className="num">{stats.places}</td>
                        <td className="num">{stats.admitted}</td>
                        <td />
                      </tr>
                    );
                  })}
                {doorLists.map((list) => {
                  const stats = listStats.get(list.id) || { people: 0, places: 0, admitted: 0 };
                  const automatic = list.source === "athlete_hub";
                  return (
                    <tr key={list.id}>
                      <td>
                        <button className="cash-link" type="button" onClick={() => { setListFilter(list.id); setActiveTab("guests"); }}>
                          {list.name}
                        </button>
                        {automatic ? <span className="cash-muted"> · {tr("roadbook athlètes", "athlete roadbook")}</span> : null}
                      </td>
                      <td>
                        <select value={list.category || "free"} disabled={busyKey === `list-${list.id}`} onChange={(event) => handleUpdateList(list, { category: event.target.value })}>
                          {DOOR_GUEST_LIST_CATEGORIES.map((category) => (
                            <option key={category.value} value={category.value}>{categoryLabel(category.value)}</option>
                          ))}
                        </select>
                      </td>
                      <td className="num">{stats.people}</td>
                      <td className="num">{stats.places}</td>
                      <td className="num">{stats.admitted}</td>
                      <td className="cash-table__actions">
                        {!automatic ? (
                          <button className="cash-icon-btn" type="button" title={tr("Supprimer la liste", "Delete list")} disabled={busyKey === `list-${list.id}`} onClick={() => handleDeleteList(list)}>
                            ✕
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
                {!listOptions.length ? (
                  <tr>
                    <td colSpan={6} className="cash-empty">{tr("Aucune liste pour cette édition.", "No list for this edition.")}</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {activeTab === "entries" ? (
        <div className="cash-split">
          <section className="cash-card">
            <div className="cash-card__head">
              <h3>{tr("Postes", "Posts")}</h3>
              {posts.length < DEFAULT_CASH_POSTS.length ? (
                <button className="cash-btn" type="button" disabled={busyKey === "default-posts"} onClick={handleCreateDefaultPosts}>
                  {tr("Créer les 4 postes par défaut", "Create the 4 default posts")}
                </button>
              ) : null}
            </div>
            <table className="cash-table">
              <thead>
                <tr>
                  <th>{tr("Poste", "Post")}</th>
                  <th className="num">{tr("Entrées", "Entries")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {posts.map((post) => (
                  <tr key={post.id}>
                    <td><strong>{post.name}</strong></td>
                    <td className="num">{entriesByPost.get(post.id) || 0}</td>
                    <td className="cash-table__actions">
                      <button className="cash-icon-btn" type="button" title={tr("Supprimer le poste", "Delete post")} disabled={busyKey === `post-${post.id}`} onClick={() => handleDeletePost(post)}>
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
                {orphanPostIds.map((postId) => (
                  <tr key={postId}>
                    <td className="cash-muted">{events.find((event) => event.postId === postId)?.postName || postId} · {tr("supprimé", "deleted")}</td>
                    <td className="num">{entriesByPost.get(postId)}</td>
                    <td />
                  </tr>
                ))}
                <tr className="is-total">
                  <td>{tr("Total", "Total")}</td>
                  <td className="num">{totals.admitted}</td>
                  <td />
                </tr>
              </tbody>
            </table>
            <form className="cash-form cash-form--row" onSubmit={handleCreatePost}>
              <input value={newPostName} placeholder={tr("Nouveau poste, ex. Entrée public 4", "New post, e.g. Public entrance 4")} onChange={(event) => setNewPostName(event.target.value)} />
              <button className="cash-btn" type="submit" disabled={busyKey === "new-post" || !newPostName.trim()}>{tr("Ajouter", "Add")}</button>
            </form>
          </section>

          <section className="cash-card">
            <div className="cash-card__head">
              <h3>{tr("Journal des passages", "Entry log")}</h3>
              <button className="cash-btn" type="button" disabled={busyKey === "export"} onClick={handleExport}>
                {tr("Exporter Excel", "Export Excel")}
              </button>
            </div>
            <div className="table-wrap">
              <table className="cash-table">
                <thead>
                  <tr>
                    <th>{tr("Heure", "Time")}</th>
                    <th>{tr("Invité", "Guest")}</th>
                    <th>{tr("Poste", "Post")}</th>
                    <th>{tr("Caissier", "Operator")}</th>
                    <th className="num">±</th>
                  </tr>
                </thead>
                <tbody>
                  {events.slice(0, MAX_LOG_ROWS).map((event) => (
                    <tr key={event.id}>
                      <td className="cash-muted">{formatTime(event.time)}</td>
                      <td>
                        <strong>{event.displayName}</strong>
                        {event.forced ? <span className="cash-badge cash-badge--warn">{tr("forcé", "forced")}</span> : null}
                      </td>
                      <td>{event.postName}</td>
                      <td className="cash-muted">{event.operator || "—"}</td>
                      <td className={`num ${event.count < 0 ? "is-undo" : "is-in"}`}>{event.count > 0 ? `+${event.count}` : event.count}</td>
                    </tr>
                  ))}
                  {!events.length ? (
                    <tr>
                      <td colSpan={5} className="cash-empty">{tr("Aucun passage pour l'instant.", "No entries yet.")}</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

export { CashDeskAdminPage };
