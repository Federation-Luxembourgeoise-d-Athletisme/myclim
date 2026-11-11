import { useEffect, useMemo, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "../services/firebase";
import { useAuth } from "../context/auth-context";
import { useSiteEditionYear } from "./edition";
import { downloadClaimExcel, printClaimPdf } from "./expense-claim-export";
import { createPresetClaims, sendClaimInvoicesToBudget, setClaimStatus, useAllExpenseClaims } from "./expense-claims-hooks";
import {
  CLAIM_STATUSES,
  NEXT_STATUS,
  claimOwnerName,
  computeClaimTotals,
  formatAmount,
  formatIban,
  getClaimStatus,
  getReceiptsNotInBudget,
  summarizeClaims,
  toAmount,
} from "./expense-claims";
import { useLanguage } from "./language-context";
import { useTr } from "./use-tr";

// Pilotage › Décomptes (admin et rôle budget) : la liste de suivi des
// remboursements — vérifier, transmettre au secrétariat, marquer payé,
// télécharger l'Excel ou le PDF — et la préparation de décomptes pour des
// personnes choisies (ex. « Forfait 1 jour – Transport 300 € »).

function dateLocale(language) {
  return language === "fr" ? "fr-FR" : "en-GB";
}

function formatWhen(claim, language) {
  const seconds = claim.submittedAt?.seconds || claim.updatedAt?.seconds;
  return seconds ? new Date(seconds * 1000).toLocaleDateString(dateLocale(language), { day: "numeric", month: "short" }) : "—";
}

const NEXT_LABEL = {
  submitted: ["Marquer vérifié", "Mark as checked"],
  checked: ["Transmis au secrétariat", "Passed to the secretariat"],
};
const EMPTY_PRESET_LINE = { date: "", place: "", detail: "", amount: "" };
// Erreur de chargement renvoyée par useAllExpenseClaims (expense-claims-hooks.js).
const LOAD_ERROR_EN = { "Impossible de charger les décomptes.": "Unable to load the expense claims." };

function PresetForm({ editionYear, byName, onClose }) {
  const tr = useTr();
  const { language } = useLanguage();
  const [people, setPeople] = useState([]);
  const [peopleError, setPeopleError] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState([]);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  // Valeur pré-remplie, envoyée telle quelle sur le décompte (document FLA en français).
  const [lines, setLines] = useState([{ ...EMPTY_PRESET_LINE, detail: "Forfait 1 jour" }]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    getDocs(collection(db, "users"))
      .then((snapshot) =>
        setPeople(
          snapshot.docs
            .map((entry) => ({ uid: entry.id, ...entry.data() }))
            .map((user) => ({ uid: user.uid, firstName: user.firstName || "", lastName: user.lastName || "", email: String(user.email || "").toLowerCase() }))
            .filter((user) => user.email)
            .sort((left, right) => `${left.lastName} ${left.firstName}`.localeCompare(`${right.lastName} ${right.firstName}`, "fr")),
        ),
      )
      .catch(() => setPeopleError(true));
  }, []);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return people.filter((person) => !needle || `${person.firstName} ${person.lastName} ${person.email}`.toLowerCase().includes(needle)).slice(0, 60);
  }, [people, search]);
  const total = toAmount(lines.reduce((sum, line) => sum + toAmount(line.amount), 0));
  const ready = reason.trim() && selected.length && lines.some((line) => line.detail.trim() && toAmount(line.amount));

  async function send() {
    setBusy(true);
    setMessage("");
    const count = selected.length;
    try {
      const { mailFailures } = await createPresetClaims({
        people: people.filter((person) => selected.includes(person.uid)),
        reason: reason.trim(),
        lines: lines.filter((line) => line.detail.trim() || toAmount(line.amount)),
        note: note.trim(),
        byName,
        editionYear,
        appUrl: window.location.origin,
      });
      setMessage(tr(
        `${count} décompte(s) envoyé(s) dans l'espace des personnes choisies.${mailFailures ? ` ${mailFailures} e-mail(s) de prévenance non parti(s).` : ""}`,
        `${count} expense claim${count === 1 ? "" : "s"} sent to the chosen people's space.${mailFailures ? ` ${mailFailures} notification e-mail${mailFailures === 1 ? "" : "s"} didn't go out.` : ""}`,
      ));
      setSelected([]);
    } catch (error) {
      console.error(error);
      setMessage(tr("La préparation a échoué. Réessayez dans un instant.", "Preparing failed. Please try again in a moment."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mdp-panel xc-preset-form">
      <h3>{tr("Préparer un décompte", "Prepare an expense claim")}</h3>
      <p className="mdp-muted">{tr(
        "Chaque personne choisie reçoit sa copie dans « Mes décomptes » (et un e-mail) : elle complète ses coordonnées, ajoute ses justificatifs et vous le renvoie.",
        "Each chosen person gets their copy in “My expense claims” (and an e-mail): they fill in their details, add their receipts and send it back to you.",
      )}</p>
      <label className="mdp-field">
        <span>{tr("Motif", "Reason")}</span>
        <input
          placeholder={tr("ex. Chef d'équipe — meeting du 17 janvier", "e.g. Team leader — meeting on 17 January")}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </label>
      <div className="mdp-field">
        <span>{tr("Lignes (fixées)", "Lines (fixed)")}</span>
        {lines.map((line, index) => (
          <div key={index} className="xc-preset-line">
            <input
              placeholder={tr("Détail (ex. Transport)", "Detail (e.g. Transport)")}
              value={line.detail}
              onChange={(event) => setLines(lines.map((item, i) => (i === index ? { ...item, detail: event.target.value } : item)))}
            />
            <input
              inputMode="decimal"
              placeholder="€"
              value={line.amount}
              onChange={(event) => setLines(lines.map((item, i) => (i === index ? { ...item, amount: event.target.value } : item)))}
            />
            {lines.length > 1 ? (
              <button
                aria-label={tr("Retirer la ligne", "Remove the line")}
                className="ath-icon-btn ath-icon-btn--danger"
                type="button"
                onClick={() => setLines(lines.filter((_, i) => i !== index))}
              >
                ✕
              </button>
            ) : null}
          </div>
        ))}
        <button className="mdp-linkbtn" type="button" onClick={() => setLines([...lines, { ...EMPTY_PRESET_LINE }])}>
          {tr("+ ligne", "+ line")}
        </button>
        <small className="mdp-muted">{tr("Total par personne :", "Total per person:")} {formatAmount(total, language)}</small>
      </div>
      <label className="mdp-field">
        <span>{tr("Message pour la personne (facultatif)", "Message for the person (optional)")}</span>
        <textarea rows="2" value={note} onChange={(event) => setNote(event.target.value)} />
      </label>
      <div className="mdp-field">
        <span>{tr(`Personnes (${selected.length} choisie(s))`, `People (${selected.length} chosen)`)}</span>
        <input placeholder={tr("Rechercher un nom, un e-mail…", "Search a name, an e-mail…")} value={search} onChange={(event) => setSearch(event.target.value)} />
        {peopleError ? (
          <p className="mdp-status--error">{tr("Impossible de charger la liste des comptes.", "Unable to load the list of accounts.")}</p>
        ) : null}
        <div className="mdp-collist xc-people">
          {filtered.map((person) => (
            <label key={person.uid}>
              <input
                checked={selected.includes(person.uid)}
                type="checkbox"
                onChange={(event) =>
                  setSelected(event.target.checked ? [...selected, person.uid] : selected.filter((uid) => uid !== person.uid))
                }
              />
              {[person.firstName, person.lastName].filter(Boolean).join(" ") || person.email}
              <small className="mdp-muted"> · {person.email}</small>
            </label>
          ))}
        </div>
      </div>
      {message ? <p className="mdp-muted">{message}</p> : null}
      <div className="mdp-panel__actions">
        <button className="mdp-btn mdp-btn--primary" disabled={!ready || busy} type="button" onClick={send}>
          {tr(
            `Envoyer à ${selected.length || "…"} personne(s)`,
            `Send to ${selected.length || "…"} ${selected.length === 1 ? "person" : "people"}`,
          )}
        </button>
        <button className="mdp-btn mdp-panel__close" type="button" onClick={onClose}>
          {tr("Fermer", "Close")}
        </button>
      </div>
    </div>
  );
}

export function ExpenseClaimsAdminPage() {
  const tr = useTr();
  const { language } = useLanguage();
  const { userProfile, currentUser } = useAuth();
  // Nom écrit sur les décomptes préparés et dans l'historique (donnée enregistrée).
  const byName = [userProfile?.firstName, userProfile?.lastName].filter(Boolean).join(" ") || currentUser?.email || "Organisation";
  const { siteEditionYear } = useSiteEditionYear();
  const { claims, loading, error } = useAllExpenseClaims(true);
  const [statusFilter, setStatusFilter] = useState("open");
  const [selectedId, setSelectedId] = useState(() => new URLSearchParams(window.location.search).get("d") || "");
  const [panel, setPanel] = useState(() => (new URLSearchParams(window.location.search).get("d") ? "claim" : ""));
  const [busy, setBusy] = useState(false);
  const money = (value) => formatAmount(value, language);
  const statusLabel = (value) => {
    const status = getClaimStatus(value);
    return tr(status.label, status.labelEn);
  };

  const summary = useMemo(() => summarizeClaims(claims), [claims]);
  const filtered = claims.filter((claim) =>
    statusFilter === "open"
      ? ["submitted", "checked"].includes(claim.status)
      : statusFilter
        ? claim.status === statusFilter
        : true,
  );
  const selected = claims.find((claim) => claim.id === selectedId) || null;

  async function changeStatus(claim, status) {
    setBusy(true);
    try {
      await setClaimStatus(claim, status, byName, currentUser?.uid || "");
    } catch (statusError) {
      console.error(statusError);
      window.alert(tr("Le changement de statut a échoué.", "Changing the status failed."));
    } finally {
      setBusy(false);
    }
  }

  async function sendToBudget(claim) {
    setBusy(true);
    try {
      await sendClaimInvoicesToBudget(claim, { uid: currentUser?.uid || "" });
    } catch (sendError) {
      console.error(sendError);
      window.alert(tr("L'envoi des factures au budget a échoué.", "Sending the invoices to the budget failed."));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="mdp-status">{tr("Chargement des décomptes…", "Loading the expense claims…")}</p>;
  if (error) return <p className="mdp-status mdp-status--error">{tr(error, LOAD_ERROR_EN[error] || error)}</p>;

  const notInBudget = selected ? getReceiptsNotInBudget(selected).length : 0;

  return (
    <section className="rp">
      <div className="rp-summary">
        <span>
          <strong>{summary.toCheck}</strong> {tr("à vérifier", "to check")}
        </span>
        <span>{money(summary.openAmount)} {tr("à traiter", "to process")}</span>
        <span className="rp-summary__done">{money(summary.sentAmount)} {tr("transmis au secrétariat", "passed to the secretariat")}</span>
        {summary.waiting ? (
          <span>{tr(
            `${summary.waiting} préparé(s), en attente de la personne`,
            `${summary.waiting} prepared, waiting for the person`,
          )}</span>
        ) : null}
      </div>
      <div className="ath-sheet">
        <div className="ath-toolbar">
          <select className="ath-filter" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="open">{tr("À traiter (envoyés, vérifiés)", "To process (sent, checked)")}</option>
            <option value="">{tr("Tous", "All")}</option>
            {CLAIM_STATUSES.map((status) => (
              <option key={status.value} value={status.value}>
                {tr(status.label, status.labelEn)}
              </option>
            ))}
          </select>
          <span className="ath-toolbar__spacer" />
          <span className="ath-toolbar__count">
            {tr(`${filtered.length} décompte(s)`, `${filtered.length} claim${filtered.length === 1 ? "" : "s"}`)}
          </span>
          <button
            className="ath-btn ath-btn--primary"
            type="button"
            onClick={() => {
              setPanel("preset");
              setSelectedId("");
            }}
          >
            {tr("Préparer un décompte", "Prepare an expense claim")}
          </button>
        </div>
        <div className="rp-body">
          <div className="table-wrap rp-tablewrap">
            <table className="data-table data-table--sheet rp-table xc-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>{tr("Personne", "Person")}</th>
                  <th>{tr("Motif", "Reason")}</th>
                  <th className="rp-num">{tr("À payer", "To pay")}</th>
                  <th className="rp-num">{tr("Justif.", "Receipts")}</th>
                  <th>{tr("Statut", "Status")}</th>
                  <th aria-label={tr("Téléchargements", "Downloads")} />
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td className="orgt-muted" colSpan={7}>
                      {tr("Aucun décompte avec ce filtre.", "No expense claim with this filter.")}
                    </td>
                  </tr>
                ) : null}
                {filtered.map((claim) => (
                  <tr
                    key={claim.id}
                    className={claim.id === selectedId ? "orgt-row--active" : ""}
                    onClick={() => {
                      setSelectedId(claim.id);
                      setPanel("claim");
                    }}
                  >
                    <td className="rp-date">{formatWhen(claim, language)}</td>
                    <td className="ath-name">{claimOwnerName(claim)}</td>
                    <td className="rp-action">{claim.reason || "—"}</td>
                    <td className="rp-num">{money(computeClaimTotals(claim).toPay)}</td>
                    <td className="rp-num">{claim.receipts.length}</td>
                    <td>
                      <span className={`xc-status xc-status--${getClaimStatus(claim.status).tone}`}>{statusLabel(claim.status)}</span>
                    </td>
                    <td onClick={(event) => event.stopPropagation()}>
                      <button className="ath-link" type="button" onClick={() => downloadClaimExcel(claim)}>
                        Excel
                      </button>
                      <button className="ath-link" type="button" onClick={() => printClaimPdf(claim)}>
                        PDF
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {panel === "preset" ? <PresetForm byName={byName} editionYear={Number(siteEditionYear) || null} onClose={() => setPanel("")} /> : null}

          {panel === "claim" && selected ? (
            <div className="mdp-panel rp-panel xc-detail">
              <h3>{claimOwnerName(selected)}</h3>
              <p className="mdp-muted">{selected.ownerEmail}</p>
              <dl className="xc-detail__meta">
                <dt>{tr("Motif", "Reason")}</dt>
                <dd>{selected.reason || "—"}</dd>
                <dt>{tr("Domicile", "Home address")}</dt>
                <dd>{selected.address || "—"}</dd>
                <dt>IBAN</dt>
                <dd>{formatIban(selected.iban) || "—"}</dd>
                <dt>{tr("Banque + BIC", "Bank + BIC")}</dt>
                <dd>{selected.bank || "—"}</dd>
              </dl>
              <table className="xc-detail__lines">
                <tbody>
                  {selected.lines.map((line, index) => (
                    <tr key={index}>
                      <td>{line.detail}</td>
                      <td className="rp-num">{money(line.amount)}</td>
                    </tr>
                  ))}
                  {selected.advance ? (
                    <tr>
                      <td>{tr("Acompte reçu", "Advance received")}</td>
                      <td className="rp-num">− {money(selected.advance)}</td>
                    </tr>
                  ) : null}
                  <tr className="xc-detail__total">
                    <td>{tr("À payer", "To pay")}</td>
                    <td className="rp-num">{money(computeClaimTotals(selected).toPay)}</td>
                  </tr>
                </tbody>
              </table>
              <p className="mdp-collist__group">{tr("Justificatifs", "Receipts")} ({selected.receipts.length})</p>
              <ul className="xc-receipts">
                {selected.receipts.map((receipt) => (
                  <li key={receipt.fileUrl}>
                    <a href={receipt.fileUrl} rel="noreferrer" target="_blank">
                      {receipt.fileName}
                    </a>
                    {selected.budgetInvoiceIds[receipt.fileUrl] ? <span className="xc-inbudget">{tr("dans le budget ✓", "in the budget ✓")}</span> : null}
                  </li>
                ))}
              </ul>
              {notInBudget && !["preset", "draft", "submitted"].includes(selected.status) ? (
                <button className="mdp-btn xc-tobudget" disabled={busy} type="button" onClick={() => sendToBudget(selected)}>
                  {tr(
                    `Envoyer ${notInBudget} facture(s) au budget pour les classer`,
                    `Send ${notInBudget} invoice${notInBudget === 1 ? "" : "s"} to the budget to file ${notInBudget === 1 ? "it" : "them"}`,
                  )}
                </button>
              ) : selected.status === "submitted" ? (
                <p className="mdp-muted">{tr(
                  "En le marquant vérifié, chaque justificatif devient une facture « à classer » dans Budget.",
                  "Once you mark it checked, each receipt becomes an invoice “to file” in Budget.",
                )}</p>
              ) : null}
              <p className="mdp-collist__group">{tr("Historique", "History")}</p>
              <ul className="xc-history">
                {selected.history.map((entry, index) => (
                  <li key={index}>
                    {new Date(entry.at).toLocaleDateString(dateLocale(language), { day: "numeric", month: "short" })} · {statusLabel(entry.status)} · {entry.byName}
                  </li>
                ))}
              </ul>
              <div className="mdp-panel__actions xc-detail__actions">
                {NEXT_STATUS[selected.status] ? (
                  <button className="mdp-btn mdp-btn--primary" disabled={busy} type="button" onClick={() => changeStatus(selected, NEXT_STATUS[selected.status])}>
                    {tr(...NEXT_LABEL[selected.status])}
                  </button>
                ) : null}
                {["submitted", "checked"].includes(selected.status) ? (
                  <button className="mdp-btn mdp-btn--danger" disabled={busy} type="button" onClick={() => changeStatus(selected, "rejected")}>
                    {tr("À corriger", "To correct")}
                  </button>
                ) : null}
                <button className="mdp-btn" type="button" onClick={() => downloadClaimExcel(selected)}>
                  Excel
                </button>
                <button className="mdp-btn" type="button" onClick={() => printClaimPdf(selected)}>
                  PDF
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
