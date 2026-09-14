import { useEffect, useRef, useState } from "react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import { db } from "../services/firebase";
import { ACCREDITATION_PRINT_STATUS_OPTIONS } from "./accreditation-config";

// ─── Constantes ───────────────────────────────────────────────────────────────

const PRESS_REGISTRATION_STATUS_OPTIONS = ["pending_review", "accepted", "rejected"];

const STATUS_LABELS = {
  pending_review: "En attente",
  accepted: "Acceptée",
  rejected: "Refusée",
};

const STATUS_PILL_CLASS = {
  pending_review: "workflow-pill workflow-pill--received",
  accepted: "workflow-pill workflow-pill--confirmed",
  rejected: "workflow-pill workflow-pill--cancelled",
};

const REQUEST_TYPE_LABELS = {
  press: "Presse",
  photographer: "Photographe",
};

const ZONE_LABELS_BY_TYPE = {
  press: "Mixed Zone",
  photographer: "Mixed Zone + Infield",
};

// Contacts importés depuis la liste de diffusion presse@fla.lu (05/11/2026)
const INITIAL_MAILING_LIST = [
  { name: "Andre Klein", email: "andre.klein@wort.lu", media: "Wort" },
  { name: "Arnaud Starck", email: "arnaud.starck@fla.lu", media: "FLA" },
  { name: "Bernard Thill", email: "bernard.thill@education.lu", media: "" },
  { name: "Chrescht Beneke", email: "chrescht.beneke@revue.lu", media: "Revue" },
  { name: "Daniel Baltes", email: "daniel.baltes@revue.lu", media: "Revue" },
  { name: "David Riboulet", email: "david.riboulet@fla.lu", media: "FLA" },
  { name: "Delvinger", email: "delvinger@tageblatt.lu", media: "Tageblatt" },
  { name: "Eric Hamus", email: "eric.hamus@revue.lu", media: "Revue" },
  { name: "Frank Krier", email: "frank.krier@education.lu", media: "" },
  { name: "G. Simonelli", email: "gsimonelli@zlv.lu", media: "ZLV" },
  { name: "Ievgenii", email: "ievgenii@chronicle.lu", media: "Chronicle.lu" },
  { name: "Rédaction Sportletzebuerg", email: "info@sportletzebuerg.lu", media: "Sportletzebuerg.lu" },
  { name: "Rédaction Sportspress", email: "info@sportspress.lu", media: "Sportspress" },
  { name: "Rédaction Editpress", email: "internet@editpress.lu", media: "Editpress" },
  { name: "Jan Morawski", email: "jan.morawski@wort.lu", media: "Wort" },
  { name: "Jean-Baptiste Souche", email: "jean-baptiste.souche@fla.lu", media: "FLA" },
  { name: "Jean-Sébastien Dauch", email: "jean-sebastien.dauch@fla.lu", media: "FLA" },
  { name: "Jhillion", email: "jhillion@le-jeudi.lu", media: "Le Jeudi" },
  { name: "J. Zeyen", email: "jzeyen@tageblatt.lu", media: "Tageblatt" },
  { name: "Léon Moureaud", email: "leonmoureaud@gmail.com", media: "" },
  { name: "Lex Damit", email: "lex.damit@fla.lu", media: "FLA" },
  { name: "Margot Laporte", email: "margot.laporte@fla.lu", media: "FLA" },
  { name: "Marlyse Turrini", email: "marlyse.turrini@free.fr", media: "" },
  { name: "Mayonjess", email: "mayonjess@yahoo.fr", media: "" },
  { name: "M. Gatti", email: "mgatti@tango.lu", media: "Tango" },
  { name: "Niala", email: "niala1965@gmail.com", media: "" },
  { name: "Nicolas Martin", email: "nicolas.martin@lessentiel.lu", media: "L'Essentiel" },
  { name: "Otasch", email: "otasch@le-jeudi.lu", media: "Le Jeudi" },
  { name: "Patrick", email: "patrick@runners.lu", media: "Runners.lu" },
  { name: "Jana Peters", email: "peters_jana@hotmail.com", media: "" },
  { name: "Pilo", email: "pilo@fonck.lu", media: "Fonck" },
  { name: "R. Conzemius", email: "rconzemius@cosl.lu", media: "COSL" },
  { name: "Rédaction 100,7", email: "redaction@100komma7.lu", media: "100,7" },
  { name: "R. Haas", email: "rhaas@lequotidien.lu", media: "Le Quotidien" },
  { name: "Rich Simon", email: "rich.simon@rtl.lu", media: "RTL" },
  { name: "RTL Sport", email: "rtlsport@clt-ufa.com", media: "RTL / CLT-UFA" },
  { name: "Sarah Muenchen", email: "sarah.muenchen@telecran.lu", media: "Télécran" },
  { name: "Schnutz", email: "schnutz@pt.lu", media: "POST Telecom" },
  { name: "Sophie Hermes", email: "sophie_hermes@hotmail.com", media: "" },
  { name: "Sport Lequotidien", email: "sport@lequotidien.lu", media: "Le Quotidien" },
  { name: "Sport Revue", email: "sport@revue.lu", media: "Revue" },
  { name: "Sport RTL", email: "sport@rtl.lu", media: "RTL" },
  { name: "Sport Tageblatt", email: "sport@tageblatt.lu", media: "Tageblatt" },
  { name: "Sport Wort", email: "sport@wort.lu", media: "Wort" },
  { name: "Sportredaktion Tageblatt", email: "sportredaktion@tageblatt.lu", media: "Tageblatt" },
  { name: "Sports Lessentiel", email: "sports@lessentiel.lu", media: "L'Essentiel" },
  { name: "Télécran", email: "telecran@telecran.lu", media: "Télécran" },
  { name: "Toffnad", email: "toffnad@gmail.com", media: "" },
  { name: "Tunnel Moureaud", email: "tunnmoureaud@gmail.com", media: "" },
];

const KNOWN_MEDIA_DOMAINS = {
  "wort.lu": "Wort",
  "revue.lu": "Revue",
  "tageblatt.lu": "Tageblatt",
  "rtl.lu": "RTL",
  "lessentiel.lu": "L'Essentiel",
  "lequotidien.lu": "Le Quotidien",
  "telecran.lu": "Télécran",
  "le-jeudi.lu": "Le Jeudi",
  "chronicle.lu": "Chronicle.lu",
  "editpress.lu": "Editpress",
  "100komma7.lu": "100,7",
  "sportletzebuerg.lu": "Sportletzebuerg.lu",
  "sportspress.lu": "Sportspress",
  "cosl.lu": "COSL",
  "pt.lu": "POST Telecom",
  "tango.lu": "Tango",
  "zlv.lu": "ZLV",
  "fonck.lu": "Fonck",
  "runners.lu": "Runners.lu",
  "clt-ufa.com": "RTL / CLT-UFA",
  "fla.lu": "FLA",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(timestamp) {
  if (!timestamp) return "—";
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  return date.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function mediaFromEmail(email) {
  const domain = String(email || "").split("@")[1] || "";
  return KNOWN_MEDIA_DOMAINS[domain] ?? "";
}

function parseCsvContacts(csvText) {
  const lines = csvText.trim().split("\n");
  if (lines.length < 2) return [];

  const header = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, "").toLowerCase());
  const nameIdx = header.findIndex((h) => h === "displayname");
  const emailIdx = header.findIndex((h) => h === "emailaddress");

  if (nameIdx === -1 || emailIdx === -1) return [];

  return lines
    .slice(1)
    .map((line) => {
      const cols = line.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
      const name = cols[nameIdx] || "";
      const email = cols[emailIdx] || "";
      if (!email || !email.includes("@")) return null;
      return { name, email, media: mediaFromEmail(email) };
    })
    .filter(Boolean);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Onglet Demandes d'accréditation ─────────────────────────────────────────

function RequestsTab({ Panel, loadMailQueueModule }) {
  const [registrations, setRegistrations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [selectedId, setSelectedId] = useState("");
  const [rejectionComment, setRejectionComment] = useState("");
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [actionStatus, setActionStatus] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, "pressRegistrations"),
      (snapshot) => {
        const docs = snapshot.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .sort((a, b) => (b.submittedAt?.toMillis?.() || 0) - (a.submittedAt?.toMillis?.() || 0));
        setRegistrations(docs);
        setLoading(false);
        setError("");
      },
      () => {
        setLoading(false);
        setError("Impossible de charger les demandes presse.");
      },
    );
    return unsubscribe;
  }, []);

  const filtered = registrations.filter((r) => {
    if (statusFilter !== "all" && r.status !== statusFilter) return false;
    if (typeFilter !== "all" && r.requestType !== typeFilter) return false;
    return true;
  });

  const effectiveSelectedId =
    registrations.some((r) => r.id === selectedId) ? selectedId : registrations[0]?.id ?? "";
  const effectiveSelected = registrations.find((r) => r.id === effectiveSelectedId) ?? null;

  const countByStatus = registrations.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {});

  async function acceptRegistration(registration) {
    if (isProcessing) return;
    setIsProcessing(true);
    setActionStatus("");
    try {
      const zoneIds = registration.requestType === "photographer"
        ? ["zone-infield", "zone-mixed"]
        : ["zone-mixed"];
      await updateDoc(doc(db, "pressRegistrations", registration.id), {
        status: "accepted",
        zoneIds,
        printStatus: "Non-imprimé",
        processedAt: serverTimestamp(),
        rejectionComment: "",
      });
      let mailSent = false;
      if (registration.email && loadMailQueueModule) {
        // The decision is already saved at this point — a failed notification
        // e-mail must not be reported as "the accept failed", or the admin may
        // retry an action that already succeeded.
        try {
          const { buildPressRegistrationDecisionMail, enqueueTransactionalMail } = await loadMailQueueModule();
          await enqueueTransactionalMail(
            buildPressRegistrationDecisionMail({
              email: registration.email,
              firstName: registration.firstName,
              requestType: registration.requestType,
              decision: "accepted",
            }),
          );
          mailSent = true;
        } catch (mailError) {
          console.error("Press accept notification email failed", mailError);
        }
      }
      setActionStatus(
        mailSent
          ? "Demande acceptée. Un email a été envoyé au demandeur."
          : "Demande acceptée. L'email n'a pas pu être envoyé au demandeur.",
      );
      setShowRejectForm(false);
      setRejectionComment("");
    } catch (err) {
      console.error("Press accept failed", err);
      setActionStatus("Impossible d'accepter la demande pour le moment.");
    } finally {
      setIsProcessing(false);
    }
  }

  async function rejectRegistration(registration) {
    if (isProcessing) return;
    setIsProcessing(true);
    setActionStatus("");
    try {
      await updateDoc(doc(db, "pressRegistrations", registration.id), {
        status: "rejected",
        rejectionComment: rejectionComment.trim(),
        processedAt: serverTimestamp(),
      });
      let mailSent = false;
      if (registration.email && loadMailQueueModule) {
        try {
          const { buildPressRegistrationDecisionMail, enqueueTransactionalMail } = await loadMailQueueModule();
          await enqueueTransactionalMail(
            buildPressRegistrationDecisionMail({
              email: registration.email,
              firstName: registration.firstName,
              requestType: registration.requestType,
              decision: "rejected",
              rejectionComment: rejectionComment.trim(),
            }),
          );
          mailSent = true;
        } catch (mailError) {
          console.error("Press reject notification email failed", mailError);
        }
      }
      setActionStatus(
        mailSent
          ? "Demande refusée. Un email a été envoyé au demandeur."
          : "Demande refusée. L'email n'a pas pu être envoyé au demandeur.",
      );
      setShowRejectForm(false);
      setRejectionComment("");
    } catch (err) {
      console.error("Press reject failed", err);
      setActionStatus("Impossible de refuser la demande pour le moment.");
    } finally {
      setIsProcessing(false);
    }
  }

  async function updatePrintStatus(registration, printStatus) {
    if (isProcessing) return;
    setIsProcessing(true);
    setActionStatus("");
    try {
      await updateDoc(doc(db, "pressRegistrations", registration.id), { printStatus });
      setActionStatus("Statut d'impression mis à jour.");
    } catch (err) {
      console.error("Press print status update failed", err);
      setActionStatus("Impossible de mettre à jour le statut d'impression.");
    } finally {
      setIsProcessing(false);
    }
  }

  return (
    <>
      <Panel title="Vue d'ensemble">
        <div className="accreditation-person-summary">
          <div className="team-summary-pill">
            <strong>{registrations.length}</strong>
            <span>Demande(s) reçue(s)</span>
          </div>
          <div className="team-summary-pill">
            <strong>{countByStatus.pending_review ?? 0}</strong>
            <span>En attente</span>
          </div>
          <div className="team-summary-pill">
            <strong>{countByStatus.accepted ?? 0}</strong>
            <span>Acceptée(s)</span>
          </div>
          <div className="team-summary-pill">
            <strong>{countByStatus.rejected ?? 0}</strong>
            <span>Refusée(s)</span>
          </div>
        </div>
      </Panel>

      <Panel title="Liste des demandes" subtitle="Cliquez sur une demande pour afficher le détail et prendre une décision.">
        {loading ? <p className="panel-note">Chargement des demandes...</p> : null}
        {error ? <p className="panel-note">{error}</p> : null}

        <div className="admin-toolbar">
          <label className="field">
            <span>Statut</span>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="all">Tous les statuts</option>
              {PRESS_REGISTRATION_STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>{STATUS_LABELS[s]}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Type</span>
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
              <option value="all">Tous les types</option>
              <option value="press">Presse</option>
              <option value="photographer">Photographe</option>
            </select>
          </label>
        </div>

        {!loading && filtered.length === 0 ? (
          <div className="placeholder-card">
            <p className="eyebrow">Aucune demande</p>
            <h2>Aucun résultat pour ces filtres</h2>
            <p>Modifiez les filtres ou attendez de nouvelles demandes via le formulaire public.</p>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="data-table data-table--admin">
              <thead>
                <tr>
                  <th>Nom</th>
                  <th>Média</th>
                  <th>Type</th>
                  <th>Statut</th>
                  <th>Date</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id} className={r.id === effectiveSelectedId ? "data-table__row--selected" : ""}>
                    <td>{`${r.firstName || ""} ${r.lastName || ""}`.trim() || "—"}</td>
                    <td>{r.media || "—"}</td>
                    <td>{REQUEST_TYPE_LABELS[r.requestType] ?? r.requestType ?? "—"}</td>
                    <td>
                      <span className={STATUS_PILL_CLASS[r.status] ?? "workflow-pill"}>
                        {STATUS_LABELS[r.status] ?? r.status ?? "—"}
                      </span>
                    </td>
                    <td>{formatDate(r.submittedAt)}</td>
                    <td>
                      <button
                        className="button button--secondary button--small"
                        type="button"
                        onClick={() => {
                          setSelectedId(r.id);
                          setShowRejectForm(false);
                          setRejectionComment("");
                          setActionStatus("");
                        }}
                      >
                        Détail
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {effectiveSelected ? (
        <Panel
          title={`Détail — ${effectiveSelected.firstName || ""} ${effectiveSelected.lastName || ""}`.trim()}
          subtitle={effectiveSelected.media || ""}
        >
          {actionStatus ? <p className="panel-note panel-note--success">{actionStatus}</p> : null}

          <div className="accreditation-inline-panel">
            <div className="field-grid">
              <div>
                <p className="eyebrow">Identité</p>
                <p><strong>{`${effectiveSelected.firstName || ""} ${effectiveSelected.lastName || ""}`.trim()}</strong></p>
                <p>{effectiveSelected.role || "—"}</p>
                <p>{effectiveSelected.media || "—"}</p>
              </div>
              <div>
                <p className="eyebrow">Contact</p>
                <p>{effectiveSelected.email || "—"}</p>
                <p>{effectiveSelected.phone || "—"}</p>
              </div>
            </div>

            <div className="field-grid">
              <div>
                <p className="eyebrow">Type de demande</p>
                <p><strong>{REQUEST_TYPE_LABELS[effectiveSelected.requestType] ?? effectiveSelected.requestType}</strong></p>
                <p className="panel-note" style={{ marginTop: 4 }}>
                  Accès : {ZONE_LABELS_BY_TYPE[effectiveSelected.requestType] ?? "—"}
                </p>
              </div>
              <div>
                <p className="eyebrow">Statut</p>
                <span className={STATUS_PILL_CLASS[effectiveSelected.status] ?? "workflow-pill"}>
                  {STATUS_LABELS[effectiveSelected.status] ?? effectiveSelected.status}
                </span>
                {effectiveSelected.status === "accepted" ? (
                  <p className="panel-note" style={{ marginTop: 8 }}>Impression : {effectiveSelected.printStatus || "Non-imprimé"}</p>
                ) : null}
                {effectiveSelected.status === "rejected" && effectiveSelected.rejectionComment ? (
                  <p className="panel-note" style={{ marginTop: 8 }}>Motif : {effectiveSelected.rejectionComment}</p>
                ) : null}
              </div>
            </div>

            {effectiveSelected.comment ? (
              <div>
                <p className="eyebrow">Commentaire du demandeur</p>
                <p>{effectiveSelected.comment}</p>
              </div>
            ) : null}

            <div>
              <p className="eyebrow">Soumis le</p>
              <p>{formatDate(effectiveSelected.submittedAt)}</p>
              {effectiveSelected.processedAt ? (
                <p>Traité le : {formatDate(effectiveSelected.processedAt)}</p>
              ) : null}
            </div>
          </div>

          {effectiveSelected.status === "pending_review" ? (
            <div className="table-actions table-actions--inline" style={{ marginTop: 16 }}>
              <button className="button button--primary" type="button" disabled={isProcessing} onClick={() => acceptRegistration(effectiveSelected)}>
                Accepter la demande
              </button>
              <button className="button button--secondary" type="button" disabled={isProcessing} onClick={() => { setShowRejectForm((v) => !v); setRejectionComment(""); }}>
                Refuser la demande
              </button>
            </div>
          ) : null}

          {effectiveSelected.status === "pending_review" && showRejectForm ? (
            <div className="accreditation-inline-panel" style={{ marginTop: 12 }}>
              <label className="field">
                <span>Motif du refus (optionnel — inclus dans l'email)</span>
                <textarea rows="2" placeholder="Ex : zone photographes complète pour cette édition." value={rejectionComment} onChange={(e) => setRejectionComment(e.target.value)} />
              </label>
              <div className="table-actions table-actions--inline" style={{ marginTop: 8 }}>
                <button className="button button--secondary" type="button" disabled={isProcessing} onClick={() => rejectRegistration(effectiveSelected)}>
                  Confirmer le refus
                </button>
              </div>
            </div>
          ) : null}

          {effectiveSelected.status === "accepted" ? (
            <div style={{ marginTop: 16 }}>
              <label className="field">
                <span>Statut d'impression du badge</span>
                <select value={effectiveSelected.printStatus || "Non-imprimé"} disabled={isProcessing} onChange={(e) => updatePrintStatus(effectiveSelected, e.target.value)}>
                  {ACCREDITATION_PRINT_STATUS_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              </label>
            </div>
          ) : null}
        </Panel>
      ) : null}
    </>
  );
}

// ─── Onglet Liste de diffusion ────────────────────────────────────────────────

function MailingListTab({ Panel, loadMailQueueModule }) {
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newMedia, setNewMedia] = useState("");
  const [newNote, setNewNote] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [addStatus, setAddStatus] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const [importStatus, setImportStatus] = useState("");
  const [csvPreview, setCsvPreview] = useState(null);
  const [showCompose, setShowCompose] = useState(false);
  const [composeSubject, setComposeSubject] = useState("");
  const [composeBody, setComposeBody] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [sendProgress, setSendProgress] = useState({ done: 0, total: 0, errors: 0 });
  const [sendResult, setSendResult] = useState("");
  const fileInputRef = useRef(null);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, "pressMailingList"),
      (snapshot) => {
        const docs = snapshot.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "fr"));
        setContacts(docs);
        setLoading(false);
      },
      () => setLoading(false),
    );
    return unsubscribe;
  }, []);

  const activeContacts = contacts.filter((c) => c.active !== false);

  const filteredContacts = contacts.filter((c) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      (c.name || "").toLowerCase().includes(q) ||
      (c.email || "").toLowerCase().includes(q) ||
      (c.media || "").toLowerCase().includes(q)
    );
  });

  const existingEmails = new Set(contacts.map((c) => String(c.email || "").toLowerCase()));

  async function addContact() {
    const name = newName.trim();
    const email = newEmail.trim().toLowerCase();
    if (!name || !email) return;
    if (existingEmails.has(email)) {
      setAddStatus("Cet email est déjà dans la liste.");
      return;
    }
    setIsAdding(true);
    setAddStatus("");
    try {
      await addDoc(collection(db, "pressMailingList"), {
        name,
        email,
        media: newMedia.trim(),
        note: newNote.trim(),
        active: true,
        addedAt: serverTimestamp(),
      });
      setNewName("");
      setNewEmail("");
      setNewMedia("");
      setNewNote("");
      setAddStatus(`${name} ajouté(e) à la liste.`);
    } catch (err) {
      console.error("Mailing list add failed", err);
      setAddStatus("Impossible d'ajouter ce contact.");
    } finally {
      setIsAdding(false);
    }
  }

  async function toggleActive(contact) {
    try {
      await updateDoc(doc(db, "pressMailingList", contact.id), { active: !(contact.active !== false) });
    } catch (err) {
      console.error("Toggle active failed", err);
    }
  }

  async function deleteContact(contact) {
    if (!window.confirm(`Supprimer ${contact.name} (${contact.email}) de la liste ?`)) return;
    try {
      await deleteDoc(doc(db, "pressMailingList", contact.id));
    } catch (err) {
      console.error("Delete contact failed", err);
    }
  }

  async function importInitialList() {
    if (!window.confirm(`Importer ${INITIAL_MAILING_LIST.length} contacts depuis la liste presse@fla.lu (05/11/2026) ? Les emails déjà présents seront ignorés.`)) return;
    setIsImporting(true);
    setImportStatus("");
    try {
      const toImport = INITIAL_MAILING_LIST.filter(
        (c) => !existingEmails.has(c.email.toLowerCase()),
      );
      const batch = writeBatch(db);
      toImport.forEach((c) => {
        const ref = doc(collection(db, "pressMailingList"));
        batch.set(ref, { name: c.name, email: c.email, media: c.media, note: "", active: true, addedAt: serverTimestamp() });
      });
      await batch.commit();
      setImportStatus(`${toImport.length} contact(s) importé(s). ${INITIAL_MAILING_LIST.length - toImport.length} ignoré(s) (déjà présents).`);
    } catch (err) {
      console.error("Seed import failed", err);
      setImportStatus("L'import a échoué.");
    } finally {
      setIsImporting(false);
    }
  }

  function handleCsvFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const parsed = parseCsvContacts(e.target.result);
      const newContacts = parsed.filter((c) => !existingEmails.has(c.email.toLowerCase()));
      setCsvPreview({ all: parsed, toImport: newContacts });
    };
    reader.readAsText(file, "utf-8");
    event.target.value = "";
  }

  async function confirmCsvImport() {
    if (!csvPreview?.toImport?.length) return;
    setIsImporting(true);
    setImportStatus("");
    try {
      const batch = writeBatch(db);
      csvPreview.toImport.forEach((c) => {
        const ref = doc(collection(db, "pressMailingList"));
        batch.set(ref, { name: c.name, email: c.email, media: c.media, note: "", active: true, addedAt: serverTimestamp() });
      });
      await batch.commit();
      setImportStatus(`${csvPreview.toImport.length} contact(s) importé(s) depuis le fichier CSV.`);
      setCsvPreview(null);
    } catch (err) {
      console.error("CSV import failed", err);
      setImportStatus("L'import CSV a échoué.");
    } finally {
      setIsImporting(false);
    }
  }

  async function sendAnnouncement() {
    if (!composeSubject.trim() || !composeBody.trim()) return;
    if (!loadMailQueueModule) return;
    const recipients = activeContacts;
    if (!recipients.length) return;
    if (!window.confirm(`Envoyer cet email à ${recipients.length} contact(s) actif(s) ?`)) return;

    setIsSending(true);
    setSendProgress({ done: 0, total: recipients.length, errors: 0 });
    setSendResult("");

    let errors = 0;
    const { buildPressAnnouncementMail, enqueueTransactionalMail } = await loadMailQueueModule();

    for (let i = 0; i < recipients.length; i++) {
      const contact = recipients[i];
      try {
        await enqueueTransactionalMail(
          buildPressAnnouncementMail({
            email: contact.email,
            name: contact.name,
            subject: composeSubject.trim(),
            body: composeBody.trim(),
          }),
        );
      } catch (err) {
        console.error(`Send failed for ${contact.email}`, err);
        errors += 1;
      }
      setSendProgress({ done: i + 1, total: recipients.length, errors });
      if (i < recipients.length - 1) await sleep(80);
    }

    const sent = recipients.length - errors;
    setSendResult(
      errors === 0
        ? `Email envoyé à ${sent} contact(s).`
        : `${sent} email(s) envoyé(s), ${errors} échec(s).`,
    );
    setIsSending(false);
  }

  return (
    <>
      <Panel title="Liste de diffusion presse" subtitle="Contacts pour les annonces et communiqués de presse. Gérez la liste et envoyez des emails groupés.">
        {loading ? <p className="panel-note">Chargement de la liste...</p> : null}

        <div className="accreditation-person-summary">
          <div className="team-summary-pill">
            <strong>{contacts.length}</strong>
            <span>Contact(s) au total</span>
          </div>
          <div className="team-summary-pill">
            <strong>{activeContacts.length}</strong>
            <span>Actif(s)</span>
          </div>
          <div className="team-summary-pill">
            <strong>{contacts.length - activeContacts.length}</strong>
            <span>Désactivé(s)</span>
          </div>
        </div>

        <div className="table-actions table-actions--inline" style={{ marginTop: 8 }}>
          <button
            className="button button--primary"
            type="button"
            onClick={() => { setShowCompose((v) => !v); setSendResult(""); }}
          >
            {showCompose ? "Fermer la rédaction" : "Rédiger un email"}
          </button>
          {contacts.length === 0 && !loading ? (
            <button className="button button--secondary" type="button" disabled={isImporting} onClick={importInitialList}>
              {isImporting ? "Import en cours..." : "Importer la liste initiale (49 contacts)"}
            </button>
          ) : null}
          <button className="button button--secondary" type="button" disabled={isImporting} onClick={() => fileInputRef.current?.click()}>
            Importer un fichier CSV
          </button>
          <input ref={fileInputRef} type="file" accept=".csv" style={{ display: "none" }} onChange={handleCsvFile} />
        </div>

        {importStatus ? <p className="panel-note panel-note--success" style={{ marginTop: 8 }}>{importStatus}</p> : null}

        {csvPreview ? (
          <div className="accreditation-inline-panel" style={{ marginTop: 12 }}>
            <p className="eyebrow">Aperçu import CSV</p>
            <p>{csvPreview.all.length} contact(s) détecté(s) — {csvPreview.toImport.length} à importer, {csvPreview.all.length - csvPreview.toImport.length} ignoré(s) (déjà présents).</p>
            {csvPreview.toImport.length > 0 ? (
              <div className="table-wrap" style={{ maxHeight: 240, overflow: "auto", marginTop: 8 }}>
                <table className="data-table">
                  <thead>
                    <tr><th>Nom</th><th>Email</th><th>Média détecté</th></tr>
                  </thead>
                  <tbody>
                    {csvPreview.toImport.map((c, i) => (
                      <tr key={i}><td>{c.name}</td><td>{c.email}</td><td>{c.media || "—"}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            <div className="table-actions table-actions--inline" style={{ marginTop: 8 }}>
              {csvPreview.toImport.length > 0 ? (
                <button className="button button--primary" type="button" disabled={isImporting} onClick={confirmCsvImport}>
                  {isImporting ? "Import en cours..." : `Confirmer l'import (${csvPreview.toImport.length})`}
                </button>
              ) : null}
              <button className="button button--secondary" type="button" onClick={() => setCsvPreview(null)}>Annuler</button>
            </div>
          </div>
        ) : null}
      </Panel>

      {showCompose ? (
        <Panel title="Rédiger un email" subtitle={`Sera envoyé à ${activeContacts.length} contact(s) actif(s) de la liste de diffusion.`}>
          {sendResult ? <p className="panel-note panel-note--success">{sendResult}</p> : null}

          <label className="field">
            <span>Objet *</span>
            <input
              value={composeSubject}
              placeholder="Ex : Ouverture du formulaire d'accréditation presse 2027"
              onChange={(e) => setComposeSubject(e.target.value)}
            />
          </label>

          <label className="field" style={{ marginTop: 12 }}>
            <span>Corps du message *</span>
            <textarea
              rows="10"
              placeholder={"Rédigez votre message ici...\n\nSauts de ligne double = nouveaux paragraphes dans l'email."}
              value={composeBody}
              onChange={(e) => setComposeBody(e.target.value)}
            />
          </label>

          {isSending ? (
            <p className="panel-note" style={{ marginTop: 12 }}>
              Envoi en cours : {sendProgress.done} / {sendProgress.total}
              {sendProgress.errors > 0 ? ` (${sendProgress.errors} échec(s))` : ""}
            </p>
          ) : null}

          <div className="table-actions table-actions--inline" style={{ marginTop: 12 }}>
            <button
              className="button button--primary"
              type="button"
              disabled={isSending || !composeSubject.trim() || !composeBody.trim() || activeContacts.length === 0}
              onClick={sendAnnouncement}
            >
              {isSending ? `Envoi... ${sendProgress.done}/${sendProgress.total}` : `Envoyer à ${activeContacts.length} contact(s)`}
            </button>
          </div>

          {activeContacts.length > 0 ? (
            <details style={{ marginTop: 16 }}>
              <summary style={{ cursor: "pointer", fontSize: "0.9rem", color: "#5d6b82" }}>
                Voir les {activeContacts.length} destinataires
              </summary>
              <div style={{ marginTop: 8, fontSize: "0.85rem", lineHeight: 1.8 }}>
                {activeContacts.map((c) => (
                  <span key={c.id} style={{ display: "inline-block", marginRight: 12 }}>
                    {c.name} &lt;{c.email}&gt;{c.media ? ` (${c.media})` : ""}
                  </span>
                ))}
              </div>
            </details>
          ) : null}
        </Panel>
      ) : null}

      <Panel title="Ajouter un contact manuellement">
        <div className="field-grid">
          <label className="field">
            <span>Nom *</span>
            <input value={newName} placeholder="Ex : Marie Dupont" onChange={(e) => setNewName(e.target.value)} />
          </label>
          <label className="field">
            <span>Email *</span>
            <input type="email" value={newEmail} placeholder="Ex : marie.dupont@wort.lu" onChange={(e) => setNewEmail(e.target.value)} />
          </label>
          <label className="field">
            <span>Média / organisation</span>
            <input value={newMedia} placeholder="Ex : Wort" onChange={(e) => setNewMedia(e.target.value)} />
          </label>
          <label className="field">
            <span>Note interne</span>
            <input value={newNote} placeholder="Ex : photographe officiel" onChange={(e) => setNewNote(e.target.value)} />
          </label>
        </div>
        {addStatus ? <p className="panel-note panel-note--success" style={{ marginTop: 8 }}>{addStatus}</p> : null}
        <div className="table-actions table-actions--inline" style={{ marginTop: 8 }}>
          <button
            className="button button--secondary"
            type="button"
            disabled={isAdding || !newName.trim() || !newEmail.trim()}
            onClick={addContact}
          >
            {isAdding ? "Ajout..." : "Ajouter à la liste"}
          </button>
        </div>
      </Panel>

      <Panel title={`Contacts (${contacts.length})`} subtitle="Désactivez un contact pour l'exclure des envois sans le supprimer.">
        <div className="admin-toolbar">
          <label className="field">
            <span>Rechercher</span>
            <input placeholder="Nom, email, média..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
        </div>

        {contacts.length === 0 && !loading ? (
          <div className="placeholder-card">
            <p className="eyebrow">Liste vide</p>
            <h2>Aucun contact dans la liste</h2>
            <p>Importez la liste initiale ou ajoutez des contacts manuellement.</p>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="data-table data-table--admin">
              <thead>
                <tr>
                  <th>Nom</th>
                  <th>Email</th>
                  <th>Média</th>
                  <th>Note</th>
                  <th>Statut</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredContacts.map((c) => (
                  <tr key={c.id} style={{ opacity: c.active === false ? 0.5 : 1 }}>
                    <td>{c.name || "—"}</td>
                    <td style={{ fontFamily: "monospace", fontSize: "0.85rem" }}>{c.email || "—"}</td>
                    <td>{c.media || "—"}</td>
                    <td>{c.note || "—"}</td>
                    <td>
                      <span className={`status-pill ${c.active !== false ? "status-pill--ok" : ""}`}>
                        {c.active !== false ? "Actif" : "Désactivé"}
                      </span>
                    </td>
                    <td>
                      <div className="table-actions table-actions--inline">
                        <button
                          className="button button--secondary button--small"
                          type="button"
                          onClick={() => toggleActive(c)}
                        >
                          {c.active !== false ? "Désactiver" : "Réactiver"}
                        </button>
                        <button
                          className="button button--secondary button--small"
                          type="button"
                          onClick={() => deleteContact(c)}
                        >
                          Supprimer
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}

// ─── Page principale ──────────────────────────────────────────────────────────

function PressAdminPage({ Panel, loadMailQueueModule }) {
  const [activeTab, setActiveTab] = useState("requests");

  return (
    <div className="admin-stack">
      <section className="panel-head">
        <div>
          <p className="eyebrow">Administration</p>
          <h1>Presse</h1>
          <p>Demandes d'accréditation et liste de diffusion presse pour le CMCM Luxembourg Indoor Meeting.</p>
        </div>
      </section>

      <div className="admin-subtabs">
        <button
          className={`admin-subtab ${activeTab === "requests" ? "admin-subtab--active" : ""}`}
          type="button"
          onClick={() => setActiveTab("requests")}
        >
          Demandes d'accréditation
        </button>
        <button
          className={`admin-subtab ${activeTab === "mailing" ? "admin-subtab--active" : ""}`}
          type="button"
          onClick={() => setActiveTab("mailing")}
        >
          Liste de diffusion
        </button>
      </div>

      {activeTab === "requests" ? (
        <RequestsTab Panel={Panel} loadMailQueueModule={loadMailQueueModule} />
      ) : (
        <MailingListTab Panel={Panel} loadMailQueueModule={loadMailQueueModule} />
      )}
    </div>
  );
}

export { PressAdminPage };
