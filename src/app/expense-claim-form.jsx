import { useMemo, useState } from "react";
import { MultiFileDrop } from "./multi-file-drop";
import { saveClaimDraft, submitClaim } from "./expense-claims-hooks";
import {
  DECOMPTE_RECIPIENT,
  MAX_CLAIM_LINES,
  computeClaimTotals,
  formatAmount,
  formatIban,
  getClaimSubmitProblems,
  isValidIban,
  normalizeClaim,
} from "./expense-claims";

// Formulaire de décompte (modèle « Décompte vierge 2026 ») : identité,
// domicile, IBAN, banque, motif, dépenses, justificatifs, certification.
// Un décompte préparé par un organisateur garde son motif et ses montants ;
// la personne complète ses coordonnées et ajoute ses justificatifs.

const EMPTY_LINE = { date: "", place: "", detail: "", amount: "" };

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
      setMessage("Brouillon enregistré. Vous pouvez le reprendre plus tard dans Mes décomptes.");
    } catch (error) {
      console.error(error);
      setMessage("L'enregistrement a échoué. Réessayez dans un instant.");
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    if (problems.length) return;
    setBusy(true);
    setMessage("Envoi…");
    try {
      const { id, mailError } = await submitClaim(form, { appUrl: window.location.origin });
      setMessage(mailError || `Décompte envoyé à ${DECOMPTE_RECIPIENT}. Vous suivez son avancement dans Mes décomptes.`);
      onDone?.(id);
    } catch (error) {
      console.error(error);
      setMessage("L'envoi a échoué. Votre saisie est conservée : réessayez dans un instant.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="xc-form">
      {isPreset ? (
        <div className="xc-preset">
          <strong>Décompte préparé par {form.preset.byName || "l'organisation"}</strong>
          {form.preset.note ? <p>{form.preset.note}</p> : null}
          <p>Le motif et les montants sont fixés. Complétez vos coordonnées, ajoutez vos justificatifs, puis envoyez.</p>
        </div>
      ) : null}

      <fieldset className="xc-block">
        <legend>Vos coordonnées</legend>
        <div className="xc-grid">
          <label className="xc-field">
            <span>Prénom</span>
            <input value={form.ownerFirstName} onChange={(event) => set("ownerFirstName", event.target.value)} />
          </label>
          <label className="xc-field">
            <span>Nom</span>
            <input value={form.ownerLastName} onChange={(event) => set("ownerLastName", event.target.value)} />
          </label>
          <label className="xc-field xc-field--wide">
            <span>Domicile (adresse complète)</span>
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
            {ibanTyped && !isValidIban(form.iban) ? <small className="xc-error">Cet IBAN ne semble pas valide.</small> : null}
          </label>
          <label className="xc-field">
            <span>Banque + BIC</span>
            <input placeholder="ex. BCEE · BCEELULL" value={form.bank} onChange={(event) => set("bank", event.target.value)} />
          </label>
        </div>
        <p className="xc-hint">Votre adresse et votre IBAN sont gardés dans votre profil privé pour le prochain décompte (visibles par vous et par la trésorerie seulement).</p>
      </fieldset>

      <fieldset className="xc-block">
        <legend>Dépenses</legend>
        <label className="xc-field xc-field--wide">
          <span>Motif des dépenses</span>
          <input
            disabled={isPreset}
            placeholder="ex. Courses pour la buvette, transport des athlètes…"
            value={form.reason}
            onChange={(event) => set("reason", event.target.value)}
          />
        </label>
        <table className="xc-lines">
          <thead>
            <tr>
              <th>Date</th>
              <th>Lieu</th>
              <th>Détail</th>
              <th className="xc-num">Montant (€)</th>
              <th aria-label="Retirer" />
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
                      aria-label="Retirer la ligne"
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
            + Ligne
          </button>
        ) : null}
        <dl className="xc-totals">
          <div>
            <dt>Total des dépenses</dt>
            <dd>{formatAmount(totals.total)}</dd>
          </div>
          <div>
            <dt>Acompte déjà reçu</dt>
            <dd>
              {isPreset ? (
                formatAmount(totals.advance)
              ) : (
                <input inputMode="decimal" value={form.advance || ""} placeholder="0" onChange={(event) => set("advance", event.target.value)} />
              )}
            </dd>
          </div>
          <div className="xc-totals__pay">
            <dt>Montant à payer</dt>
            <dd>{formatAmount(totals.toPay)}</dd>
          </div>
        </dl>
      </fieldset>

      <fieldset className="xc-block">
        <legend>Factures et justificatifs ({form.receipts.length})</legend>
        {form.receipts.length ? (
          <ul className="xc-receipts">
            {form.receipts.map((receipt) => (
              <li key={receipt.fileUrl}>
                <a href={receipt.fileUrl} rel="noreferrer" target="_blank">
                  {receipt.fileName}
                </a>
                <button
                  aria-label={`Retirer ${receipt.fileName}`}
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
          hint="PDF ou photos · plusieurs fichiers à la fois · 20 Mo max chacun"
          label="Glissez vos factures ici, ou cliquez pour les choisir"
          storagePath={`expense-claims/${form.ownerUid || "inconnu"}`}
          onUploaded={(files) => set("receipts", [...form.receipts, ...files])}
        />
      </fieldset>

      <label className="xc-certify">
        <input checked={form.certified} type="checkbox" onChange={(event) => set("certified", event.target.checked)} />
        <span>
          Je certifie que ces dépenses sont exactes et ont été faites pour la FLA / le CMCM Luxembourg Indoor Meeting.
          <small>Vaut signature : votre nom et la date d'envoi sont ajoutés au décompte.</small>
        </span>
      </label>

      {problems.length ? <p className="xc-missing">À compléter avant l'envoi : {problems.join(" · ")}</p> : null}
      {message ? <p className="xc-message">{message}</p> : null}

      <div className="xc-actions">
        <button className="ath-btn ath-btn--primary" disabled={busy || problems.length > 0} type="button" onClick={send}>
          Envoyer le décompte
        </button>
        <button className="ath-btn" disabled={busy} type="button" onClick={saveDraft}>
          Enregistrer le brouillon
        </button>
        {onCancel ? (
          <button className="ath-link" type="button" onClick={onCancel}>
            Fermer
          </button>
        ) : null}
        <span className="xc-actions__to">Envoyé à {DECOMPTE_RECIPIENT}, qui le vérifie puis le transmet au secrétariat pour paiement.</span>
      </div>
    </div>
  );
}
