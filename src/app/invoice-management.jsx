import { useEffect, useMemo, useState } from "react";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { useComLang } from "./communication/com-i18n";
import { FileUpload } from "./file-upload";
import { useLanguage } from "./language-context";
import { getDisplayName } from "./utils";
import { db } from "../services/firebase";
import { enqueueTransactionalMail } from "../services/mailQueue";

// Andrée Schengen (FLA staff) suit les factures du meeting. L'adresse reste
// modifiable dans la fenêtre d'envoi.
const INVOICE_CONTACT = { firstName: "Andrée", email: "andree.schengen@fla.lu" };

function getInvoiceDocumentUrl(document) {
  if (document?.fileUrl) return document.fileUrl;
  if (/^https?:\/\//i.test(String(document?.reference || "").trim())) return document.reference;
  return "";
}

function formatInvoiceStatusLabel(invoice, t) {
  if (String(invoice?.invoiceStatus || "").trim() === "linked" && invoice?.linkedBudgetRowLabel) {
    const label = t ? t("invoiceClassified") : "Classée";
    return `${label} · ${invoice.linkedBudgetRowLabel}`;
  }

  return t ? t("invoiceToClassify") : "À classer";
}

function normalizeSearchText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

// Lignes de dépense triées par ordre alphabétique (sans tenir compte du numéro).
function buildBudgetExpenseTargetOptions(sections = [], editionId = "") {
  return sections
    .flatMap(({ sectionName, rows }) =>
      rows.map((row) => ({
        value: row.id,
        rowId: row.id,
        rowLabel: `#${row.rowNumber} ${row.label}`.trim(),
        sortLabel: String(row.label || "").trim(),
        sectionName,
        collectionKey: "expenses",
        editionId,
      })),
    )
    .sort(
      (a, b) =>
        a.sortLabel.localeCompare(b.sortLabel, "fr", { sensitivity: "base", numeric: true }) ||
        a.sectionName.localeCompare(b.sectionName, "fr", { sensitivity: "base" }),
    );
}

// Chaque mot tapé doit se retrouver dans le libellé ou la section de la ligne.
function filterBudgetTargets(targets = [], search = "") {
  const words = normalizeSearchText(search).split(/\s+/).filter(Boolean);
  if (!words.length) return targets;
  return targets.filter((target) => {
    const haystack = normalizeSearchText(`${target.rowLabel} ${target.sectionName}`);
    return words.every((word) => haystack.includes(word));
  });
}

function BudgetLinePicker({ targets = [], value = "", onChange }) {
  const { tr } = useComLang();
  const [search, setSearch] = useState("");
  const visibleTargets = useMemo(() => filterBudgetTargets(targets, search), [targets, search]);
  const selectedTarget = targets.find((target) => target.value === value) ?? null;
  const selectedIsHidden = Boolean(selectedTarget) && !visibleTargets.includes(selectedTarget);

  function handleSearchChange(event) {
    const nextSearch = event.target.value;
    setSearch(nextSearch);
    const matches = filterBudgetTargets(targets, nextSearch);
    if (nextSearch.trim() && matches.length === 1) onChange?.(matches[0].value);
  }

  return (
    <div className="field budget-line-picker">
      <span>{tr("Ligne budgétaire", "Budget line")}</span>
      <input
        type="search"
        value={search}
        onChange={handleSearchChange}
        placeholder={tr("Rechercher une ligne (ex. hôtel, transport…)", "Search a line (e.g. hotel, transport…)")}
        aria-label={tr("Rechercher une ligne budgétaire", "Search a budget line")}
        autoComplete="off"
      />
      <select
        value={value}
        onChange={(event) => onChange?.(event.target.value)}
        aria-label={tr("Ligne budgétaire", "Budget line")}
      >
        <option value="">
          {visibleTargets.length
            ? tr("Choisir une ligne de dépense", "Choose an expense line")
            : tr("Aucune ligne ne correspond", "No matching line")}
        </option>
        {selectedIsHidden ? (
          <option value={selectedTarget.value}>
            {selectedTarget.rowLabel} · {selectedTarget.sectionName}
          </option>
        ) : null}
        {visibleTargets.map((target) => (
          <option key={target.value} value={target.value}>
            {target.rowLabel} · {target.sectionName}
          </option>
        ))}
      </select>
      {search.trim() ? (
        <small className="budget-line-picker__count">
          {tr(
            `${visibleTargets.length} ligne(s) sur ${targets.length}`,
            `${visibleTargets.length} of ${targets.length} line(s)`,
          )}
        </small>
      ) : null}
    </div>
  );
}

function buildInvoiceMailDraft({ invoice, target, senderName, tr }) {
  const title = invoice?.title || invoice?.fileName || tr("Facture", "Invoice");
  const url = getInvoiceDocumentUrl(invoice) || invoice?.resolvedUrl || "";
  const details = [
    target
      ? tr(`Ligne budgétaire : ${target.rowLabel} (${target.sectionName})`, `Budget line: ${target.rowLabel} (${target.sectionName})`)
      : "",
    invoice?.uploadedByName ? tr(`Déposée par : ${invoice.uploadedByName}`, `Uploaded by: ${invoice.uploadedByName}`) : "",
    invoice?.invoiceNote ? tr(`Note : ${invoice.invoiceNote}`, `Note: ${invoice.invoiceNote}`) : "",
    url ? tr(`Facture : ${url}`, `Invoice: ${url}`) : "",
  ].filter(Boolean);

  return {
    to: INVOICE_CONTACT.email,
    subject: tr(`Facture à traiter : ${title}`, `Invoice to process: ${title}`),
    body: [
      tr(`Bonjour ${INVOICE_CONTACT.firstName},`, `Hello ${INVOICE_CONTACT.firstName},`),
      "",
      tr(
        `Je range la facture « ${title} » dans le budget du meeting.`,
        `I am filing the invoice "${title}" in the meeting budget.`,
      ),
      ...details,
      "",
      tr("Merci et bonne journée,", "Thanks and have a nice day,"),
      senderName || "",
    ]
      .join("\n")
      .trim(),
  };
}

function InvoiceMailDialog({ invoice, target, senderName, onClose, onSent }) {
  const { tr } = useComLang();
  const [draft, setDraft] = useState(() => buildInvoiceMailDraft({ invoice, target, senderName, tr }));
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === "Escape" && !isSending) onClose?.();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isSending, onClose]);

  function handleChange(event) {
    const { name, value } = event.target;
    setDraft((current) => ({ ...current, [name]: value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setIsSending(true);
    setError("");
    try {
      await enqueueTransactionalMail({ to: draft.to.trim(), subject: draft.subject.trim(), body: draft.body });
      onSent?.(draft.to.trim());
    } catch (sendError) {
      console.error("Unable to send invoice mail", sendError);
      setError(sendError?.message || tr("L'envoi du mail a échoué.", "The email could not be sent."));
      setIsSending(false);
    }
  }

  const title = tr(`Envoyer un mail à ${INVOICE_CONTACT.firstName}`, `Email ${INVOICE_CONTACT.firstName}`);

  return (
    <div className="invoice-mail-dialog">
      <div className="invoice-mail-dialog__backdrop" onClick={() => !isSending && onClose?.()} />
      <form
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="invoice-mail-dialog__box section-stack"
        onSubmit={handleSubmit}
      >
        <h2>{title}</h2>
        <label className="field">
          <span>{tr("À", "To")}</span>
          <input name="to" type="email" required value={draft.to} onChange={handleChange} />
        </label>
        <label className="field">
          <span>{tr("Objet", "Subject")}</span>
          <input name="subject" required value={draft.subject} onChange={handleChange} />
        </label>
        <label className="field">
          <span>{tr("Message", "Message")}</span>
          <textarea name="body" required rows={10} value={draft.body} onChange={handleChange} />
        </label>
        {error ? <p className="panel-note invoice-mail-dialog__error">{error}</p> : null}
        <div className="table-actions table-actions--inline">
          <button className="button button--secondary" type="button" onClick={onClose} disabled={isSending}>
            {tr("Annuler", "Cancel")}
          </button>
          <button
            className="button button--primary"
            type="submit"
            disabled={isSending || !draft.to.trim() || !draft.subject.trim() || !draft.body.trim()}
          >
            {isSending ? tr("Envoi…", "Sending…") : tr("Envoyer", "Send")}
          </button>
        </div>
      </form>
    </div>
  );
}

function InvoiceUploadForm({
  editionId,
  currentUser,
  userProfile,
  assignedTeams = [],
  expenseTargets = [],
  defaultTargetId = "",
  onSaved,
}) {
  const { t } = useLanguage();
  const [formState, setFormState] = useState({
    title: "",
    note: "",
    fileUrl: "",
    fileName: "",
    filePath: "",
    mimeType: "",
    selectedTargetId: defaultTargetId,
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [status, setStatus] = useState("");

  const selectedTarget = useMemo(
    () => expenseTargets.find((target) => target.value === formState.selectedTargetId) ?? null,
    [expenseTargets, formState.selectedTargetId],
  );

  function handleChange(event) {
    const { name, value } = event.target;
    setFormState((current) => ({ ...current, [name]: value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!currentUser?.uid) return;
    if (!formState.fileUrl) {
      setStatus(t("invoiceAddFileFirst"));
      return;
    }

    setIsSubmitting(true);
    setStatus(t("invoiceSaving"));

    try {
      await addDoc(collection(db, "documents"), {
        documentType: "invoice",
        title: String(formState.title || "").trim() || formState.fileName || t("invoiceDefaultTitle"),
        reference: formState.fileUrl,
        fileName: formState.fileName,
        fileUrl: formState.fileUrl,
        filePath: formState.filePath,
        mimeType: formState.mimeType,
        scope: "private",
        teams: Array.isArray(assignedTeams) ? assignedTeams.filter(Boolean) : [],
        visibility: "Facture privée",
        editionId: String(editionId || "").trim(),
        uploadedByUid: String(currentUser.uid || "").trim(),
        uploadedByName: getDisplayName(userProfile, currentUser.email),
        ownerUid: String(currentUser.uid || "").trim(),
        invoiceNote: String(formState.note || "").trim(),
        invoiceStatus: selectedTarget ? "linked" : "unclassified",
        linkedBudgetEditionId: selectedTarget?.editionId || "",
        linkedBudgetCollectionKey: selectedTarget?.collectionKey || "",
        linkedBudgetRowId: selectedTarget?.rowId || "",
        linkedBudgetRowLabel: selectedTarget?.rowLabel || "",
        linkedBudgetSectionName: selectedTarget?.sectionName || "",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      setFormState({
        title: "",
        note: "",
        fileUrl: "",
        fileName: "",
        filePath: "",
        mimeType: "",
        selectedTargetId: defaultTargetId,
      });
      setStatus(selectedTarget ? t("invoiceSavedLinked") : t("invoiceSavedUnlinked"));
      onSaved?.();
    } catch (error) {
      console.error("Unable to save invoice document", error);
      setStatus(t("invoiceSaveFailed"));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="section-stack invoice-upload-form" onSubmit={handleSubmit}>
      <div className="field">
        <span>{t("invoiceTitleLabel")}</span>
        <input
          name="title"
          placeholder={t("invoiceTitlePlaceholder")}
          value={formState.title}
          onChange={handleChange}
        />
      </div>

      <div className="field">
        <span>{t("invoiceFileLabel")}</span>
        <FileUpload
          value={formState.fileUrl}
          onChange={(url) => setFormState((current) => ({ ...current, fileUrl: url }))}
          onUploadComplete={(file) =>
            setFormState((current) => ({
              ...current,
              fileUrl: file.url,
              fileName: file.fileName,
              filePath: file.filePath,
              mimeType: file.mimeType,
              title: current.title || file.fileName,
            }))
          }
          accept=".pdf,image/*"
          storagePath={`budget-invoices/${String(editionId || "active").trim() || "active"}`}
          label={t("invoiceUploadLabel")}
          helperText={t("invoiceUploadHelper")}
        />
      </div>

      {expenseTargets.length ? (
        <div className="field">
          <span>{t("invoiceExpenseLineLabel")}</span>
          <select name="selectedTargetId" value={formState.selectedTargetId} onChange={handleChange}>
            <option value="">{t("invoiceClassifyLater")}</option>
            {expenseTargets.map((target) => (
              <option key={target.value} value={target.value}>
                {target.rowLabel} · {target.sectionName}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <div className="field">
        <span>{t("invoiceNoteLabel")}</span>
        <textarea
          name="note"
          placeholder={t("invoiceNotePlaceholder")}
          rows={3}
          value={formState.note}
          onChange={handleChange}
        />
      </div>

      <div className="table-actions table-actions--inline invoice-upload-form__actions">
        <button className="button button--primary" type="submit" disabled={isSubmitting}>
          {isSubmitting ? t("invoiceSubmitting") : t("invoiceSubmitButton")}
        </button>
      </div>

      {status ? <p className="panel-note">{status}</p> : null}
    </form>
  );
}

function InvoiceInlineList({ invoices = [], canManage = false, onDetach }) {
  const { t } = useLanguage();

  if (!invoices.length) {
    return <span className="budget-invoice-list__empty">—</span>;
  }

  return (
    <div className="budget-invoice-list">
      {invoices.map((invoice) => {
        const consultationUrl = getInvoiceDocumentUrl(invoice);

        return (
          <div className="budget-invoice-pill" key={invoice.id}>
            <button
              className="budget-invoice-pill__link"
              type="button"
              onClick={() => {
                if (!consultationUrl) return;
                window.open(consultationUrl, "_blank", "noopener,noreferrer");
              }}
            >
              {invoice.fileName || invoice.title || t("invoiceDefaultTitle")}
            </button>
            {canManage ? (
              <button
                className="budget-invoice-pill__detach"
                type="button"
                onClick={() => onDetach?.(invoice)}
                aria-label={t("invoiceDetachAria").replace("{name}", invoice.fileName || invoice.title || t("invoiceDefaultTitle"))}
                title={t("invoiceDetachTitle")}
              >
                ×
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export {
  BudgetLinePicker,
  buildBudgetExpenseTargetOptions,
  INVOICE_CONTACT,
  InvoiceMailDialog,
  formatInvoiceStatusLabel,
  getInvoiceDocumentUrl,
  InvoiceInlineList,
  InvoiceUploadForm,
};
