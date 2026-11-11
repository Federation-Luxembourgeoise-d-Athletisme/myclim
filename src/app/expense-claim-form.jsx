import { useMemo, useState } from "react";
import { MultiFileDrop } from "./multi-file-drop";
import { saveClaimDraft, submitClaim } from "./expense-claims-hooks";
import {
  DECOMPTE_RECIPIENT,
  MAX_CLAIM_LINES,
  claimProblemLabel,
  computeClaimTotals,
  formatAmount,
  formatIban,
  getClaimSubmitProblems,
  isValidIban,
  normalizeClaim,
} from "./expense-claims";
import { useLanguage } from "./language-context";
import { useTr } from "./use-tr";

// Formulaire de décompte (modèle « Décompte vierge 2026 ») : identité,
// domicile, IBAN, banque, motif, dépenses, justificatifs, certification.
// Un décompte préparé par un organisateur garde son motif et ses montants ;
// la personne complète ses coordonnées et ajoute ses justificatifs.

const EMPTY_LINE = { date: "", place: "", detail: "", amount: "" };

// Seul message d'erreur renvoyé par submitClaim (expense-claims-hooks.js).
const MAIL_ERROR_EN = "The claim is saved, but the e-mail didn't go out. Margot will see it in the tracking list.";

function buildInitialClaim({ claim, currentUser, userProfile, privateProfile, editionYear, receipts = [] }) {
  const base = normalizeClaim(claim || {});
  return {
    ...base,
    id: claim?.id || "",
    history: claim?.history || [],
    editionYear: base.editionYear || Number(editionYear) || null,
    ownerUid: base.ownerUid || currentUser?.uid || "",
    ownerEmail: base.ownerEmail || String(currentUser?.email || "").toLowerCase(),
    ownerFirstName: base.ownerFirstName || userProfile?.firstName || "",
    ownerLastName: base.ownerLastName || userProfile?.lastName || "",
    address: base.address || privateProfile?.address || "",
    iban: formatIban(base.iban || privateProfile?.iban || ""),
    bank: base.bank || privateProfile?.bank || "",
    lines: base.lines.length ? base.lines.map((line) => ({ ...line, amount: line.amount || "" })) : [{ ...EMPTY_LINE }],
    receipts: [...base.receipts, ...receipts],
    certified: false,
  };
}

export function ExpenseClaimForm({ claim, currentUser, userProfile, privateProfile, editionYear, initialReceipts, onDone, onCancel }) {
  const tr = useTr();
  const { language } = useLanguage();
  const [form, setForm] = useState(() =>
    buildInitialClaim({ claim, currentUser, userProfile, privateProfile, editionYear, receipts: initialReceipts }),
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const isPreset = Boolean(form.preset);
  const normalized = useMemo(() => normalizeClaim(form), [form]);
  const totals = computeClaimTotals(normalized);
  const problems = getClaimSubmitProblems(normalized);
  const ibanTyped = form.iban.replace(/\s/g, "").length >= 15;
  const money = (value) => formatAmount(value, language);

  function set(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function setLine(index, patch) {
    setForm((current) => ({ ...current, lines: current.lines.map((line, i) => (i === index ? { ...line, ...patch } : line)) }));
  }

  async function saveDraft() {
    setBusy(true);
    setMessage("");
    try {
      const id = await saveClaimDraft({ ...form, status: form.status === "preset" ? "preset" : "draft" });
      setForm((current) => ({ ...current, id }));
      setMessage(tr(
        "Brouillon enregistré. Vous pouvez le reprendre plus tard dans Mes décomptes.",
        "Draft saved. You can pick it up later in My expense claims.",
      ));
    } catch (error) {
      console.error(error);
      setMessage(tr("L'enregistrement a échoué. Réessayez dans un instant.", "Saving failed. Please try again in a moment."));
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    if (problems.length) return;
    setBusy(true);
    setMessage(tr("Envoi…", "Sending…"));
    try {
      const { id, mailError } = await submitClaim(form, { appUrl: window.location.origin });
      setMessage(
        mailError
          ? tr(mailError, MAIL_ERROR_EN)
          : tr(
              `Décompte envoyé à ${DECOMPTE_RECIPIENT}. Vous suivez son avancement dans Mes décomptes.`,
              `Expense claim sent to ${DECOMPTE_RECIPIENT}. You can follow it in My expense claims.`,
            ),
      );
      onDone?.(id);
    } catch (error) {
      console.error(error);
      setMessage(tr(
        "L'envoi a échoué. Votre saisie est conservée : réessayez dans un instant.",
        "Sending failed. What you typed is kept: please try again in a moment.",
      ));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="xc-form">
      {isPreset ? (
        <div className="xc-preset">
          <strong>{tr("Décompte préparé par", "Expense claim prepared by")} {form.preset.byName || tr("l'organisation", "the organisers")}</strong>
          {form.preset.note ? <p>{form.preset.note}</p> : null}
          <p>{tr(
            "Le motif et les montants sont fixés. Complétez vos coordonnées, ajoutez vos justificatifs, puis envoyez.",
            "The reason and amounts are set. Fill in your details, add your receipts, then send it.",
          )}</p>
        </div>
      ) : null}

      <fieldset className="xc-block">
        <legend>{tr("Vos coordonnées", "Your details")}</legend>
        <div className="xc-grid">
          <label className="xc-field">
            <span>{tr("Prénom", "First name")}</span>
            <input value={form.ownerFirstName} onChange={(event) => set("ownerFirstName", event.target.value)} />
          </label>
          <label className="xc-field">
            <span>{tr("Nom", "Last name")}</span>
            <input value={form.ownerLastName} onChange={(event) => set("ownerLastName", event.target.value)} />
          </label>
          <label className="xc-field xc-field--wide">
            <span>{tr("Domicile (adresse complète)", "Home address (full)")}</span>
            <input value={form.address} onChange={(event) => set("address", event.target.value)} />
          </label>
          <label className="xc-field">
            <span>IBAN</span>
            <input
              className={ibanTyped && !isValidIban(form.iban) ? "xc-invalid" : ""}
              placeholder="LU00 0000 0000 0000 0000"
              value={form.iban}
              onBlur={() => set("iban", formatIban(form.iban))}
              onChange={(event) => set("iban", event.target.value)}
            />
            {ibanTyped && !isValidIban(form.iban) ? (
              <small className="xc-error">{tr("Cet IBAN ne semble pas valide.", "This IBAN doesn't look valid.")}</small>
            ) : null}
          </label>
          <label className="xc-field">
            <span>{tr("Banque + BIC", "Bank + BIC")}</span>
            <input placeholder={tr("ex. BCEE · BCEELULL", "e.g. BCEE · BCEELULL")} value={form.bank} onChange={(event) => set("bank", event.target.value)} />
          </label>
        </div>
        <p className="xc-hint">{tr(
          "Votre adresse et votre IBAN sont gardés dans votre profil privé pour le prochain décompte (visibles par vous et par la trésorerie seulement).",
          "Your address and IBAN are kept in your private profile for the next claim (visible only to you and the treasury).",
        )}</p>
      </fieldset>

      <fieldset className="xc-block">
        <legend>{tr("Dépenses", "Expenses")}</legend>
        <label className="xc-field xc-field--wide">
          <span>{tr("Motif des dépenses", "Reason for the expenses")}</span>
          <input
            disabled={isPreset}
            placeholder={tr("ex. Courses pour la buvette, transport des athlètes…", "e.g. Shopping for the bar, athlete transport…")}
            value={form.reason}
            onChange={(event) => set("reason", event.target.value)}
          />
        </label>
        <table className="xc-lines">
          <thead>
            <tr>
              <th>Date</th>
              <th>{tr("Lieu", "Place")}</th>
              <th>{tr("Détail", "Detail")}</th>
              <th className="xc-num">{tr("Montant (€)", "Amount (€)")}</th>
              <th aria-label={tr("Retirer", "Remove")} />
            </tr>
          </thead>
          <tbody>
            {form.lines.map((line, index) => (
              <tr key={index}>
                <td>
                  <input disabled={isPreset} type="date" value={line.date} onChange={(event) => setLine(index, { date: event.target.value })} />
                </td>
                <td>
                  <input disabled={isPreset} value={line.place} onChange={(event) => setLine(index, { place: event.target.value })} />
                </td>
                <td>
                  <input disabled={isPreset} value={line.detail} onChange={(event) => setLine(index, { detail: event.target.value })} />
                </td>
                <td className="xc-num">
                  <input
                    disabled={isPreset}
                    inputMode="decimal"
                    value={line.amount}
                    onChange={(event) => setLine(index, { amount: event.target.value })}
                  />
                </td>
                <td>
                  {!isPreset && form.lines.length > 1 ? (
                    <button
                      aria-label={tr("Retirer la ligne", "Remove the line")}
                      className="ath-icon-btn ath-icon-btn--danger"
                      type="button"
                      onClick={() => set("lines", form.lines.filter((_, i) => i !== index))}
                    >
                      ✕
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!isPreset && form.lines.length < MAX_CLAIM_LINES ? (
          <button className="ath-btn" type="button" onClick={() => set("lines", [...form.lines, { ...EMPTY_LINE }])}>
            {tr("+ Ligne", "+ Line")}
          </button>
        ) : null}
        <dl className="xc-totals">
          <div>
            <dt>{tr("Total des dépenses", "Total expenses")}</dt>
            <dd>{money(totals.total)}</dd>
          </div>
          <div>
            <dt>{tr("Acompte déjà reçu", "Advance already received")}</dt>
            <dd>
              {isPreset ? (
                money(totals.advance)
              ) : (
                <input inputMode="decimal" value={form.advance || ""} placeholder="0" onChange={(event) => set("advance", event.target.value)} />
              )}
            </dd>
          </div>
          <div className="xc-totals__pay">
            <dt>{tr("Montant à payer", "Amount to pay")}</dt>
            <dd>{money(totals.toPay)}</dd>
          </div>
        </dl>
      </fieldset>

      <fieldset className="xc-block">
        <legend>{tr("Factures et justificatifs", "Invoices and receipts")} ({form.receipts.length})</legend>
        {form.receipts.length ? (
          <ul className="xc-receipts">
            {form.receipts.map((receipt) => (
              <li key={receipt.fileUrl}>
                <a href={receipt.fileUrl} rel="noreferrer" target="_blank">
                  {receipt.fileName}
                </a>
                <button
                  aria-label={`${tr("Retirer", "Remove")} ${receipt.fileName}`}
                  className="ath-icon-btn ath-icon-btn--danger"
                  type="button"
                  onClick={() => set("receipts", form.receipts.filter((item) => item.fileUrl !== receipt.fileUrl))}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <MultiFileDrop
          hint={tr("PDF ou photos · plusieurs fichiers à la fois · 20 Mo max chacun", "PDF or photos · several files at once · 20 MB max each")}
          label={tr("Glissez vos factures ici, ou cliquez pour les choisir", "Drop your invoices here, or click to choose them")}
          storagePath={`expense-claims/${form.ownerUid || "inconnu"}`}
          onUploaded={(files) => set("receipts", [...form.receipts, ...files])}
        />
      </fieldset>

      <label className="xc-certify">
        <input checked={form.certified} type="checkbox" onChange={(event) => set("certified", event.target.checked)} />
        <span>
          {tr(
            "Je certifie que ces dépenses sont exactes et ont été faites pour la FLA / le CMCM Luxembourg Indoor Meeting.",
            "I certify that these expenses are correct and were made for the FLA / the CMCM Luxembourg Indoor Meeting.",
          )}
          <small>{tr(
            "Vaut signature : votre nom et la date d'envoi sont ajoutés au décompte.",
            "Counts as your signature: your name and the sending date are added to the claim.",
          )}</small>
        </span>
      </label>

      {problems.length ? (
        <p className="xc-missing">
          {tr("À compléter avant l'envoi :", "Still needed before sending:")} {problems.map((problem) => claimProblemLabel(problem, tr)).join(" · ")}
        </p>
      ) : null}
      {message ? <p className="xc-message">{message}</p> : null}

      <div className="xc-actions">
        <button className="ath-btn ath-btn--primary" disabled={busy || problems.length > 0} type="button" onClick={send}>
          {tr("Envoyer le décompte", "Send the expense claim")}
        </button>
        <button className="ath-btn" disabled={busy} type="button" onClick={saveDraft}>
          {tr("Enregistrer le brouillon", "Save the draft")}
        </button>
        {onCancel ? (
          <button className="ath-link" type="button" onClick={onCancel}>
            {tr("Fermer", "Close")}
          </button>
        ) : null}
        <span className="xc-actions__to">{tr(
          `Envoyé à ${DECOMPTE_RECIPIENT}, qui le vérifie puis le transmet au secrétariat pour paiement.`,
          `Sent to ${DECOMPTE_RECIPIENT}, who checks it and passes it to the secretariat for payment.`,
        )}</span>
      </div>
    </div>
  );
}
