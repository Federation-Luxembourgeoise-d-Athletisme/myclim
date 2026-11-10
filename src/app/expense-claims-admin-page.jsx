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

// Pilotage › Décomptes (admin et rôle budget) : la liste de suivi des
// remboursements — vérifier, transmettre au secrétariat, marquer payé,
// télécharger l'Excel ou le PDF — et la préparation de décomptes pour des
// personnes choisies (ex. « Forfait 1 jour – Transport 300 € »).

function formatWhen(claim) {
  const seconds = claim.submittedAt?.seconds || claim.updatedAt?.seconds;
  return seconds ? new Date(seconds * 1000).toLocaleDateString("fr-FR", { day: "numeric", month: "short" }) : "—";
}

const NEXT_LABEL = { submitted: "Marquer vérifié", checked: "Transmis au secrétariat", sent_secretary: "Marquer payé" };
const EMPTY_PRESET_LINE = { date: "", place: "", detail: "", amount: "" };

function PresetForm({ editionYear, byName, onClose }) {
  const [people, setPeople] = useState([]);
  const [peopleError, setPeopleError] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState([]);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
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
      .catch(() => setPeopleError("Impossible de charger la liste des comptes."));
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
      setMessage(
        `${selected.length} décompte(s) envoyé(s) dans l'espace des personnes choisies.${mailFailures ? ` ${mailFailures} e-mail(s) de prévenance non parti(s).` : ""}`,
      );
      setSelected([]);
    } catch (error) {
      console.error(error);
      setMessage("La préparation a échoué. Réessayez dans un instant.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mdp-panel xc-preset-form">
      <h3>Préparer un décompte</h3>
      <p className="mdp-muted">Chaque personne choisie reçoit sa copie dans « Mes décomptes » (et un e-mail) : elle complète ses coordonnées, ajoute ses justificatifs et vous le renvoie.</p>
      <label className="mdp-field">
        <span>Motif</span>
        <input placeholder="ex. Chef d'équipe — meeting du 17 janvier" value={reason} onChange={(event) => setReason(event.target.value)} />
      </label>
      <div className="mdp-field">
        <span>Lignes (fixées)</span>
        {lines.map((line, index) => (
          <div key={index} className="xc-preset-line">
            <input
              placeholder="Détail (ex. Transport)"
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
              <button className="ath-icon-btn ath-icon-btn--danger" type="button" onClick={() => setLines(lines.filter((_, i) => i !== index))}>
                ✕
              </button>
            ) : null}
          </div>
        ))}
        <button className="mdp-linkbtn" type="button" onClick={() => setLines([...lines, { ...EMPTY_PRESET_LINE }])}>
          + ligne
        </button>
        <small className="mdp-muted">Total par personne : {formatAmount(total)}</small>
      </div>
      <label className="mdp-field">
        <span>Message pour la personne (facultatif)</span>
        <textarea rows="2" value={note} onChange={(event) => setNote(event.target.value)} />
      </label>
      <div className="mdp-field">
        <span>Personnes ({selected.length} choisie(s))</span>
        <input placeholder="Rechercher un nom, un e-mail…" value={search} onChange={(event) => setSearch(event.target.value)} />
        {peopleError ? <p className="mdp-status--error">{peopleError}</p> : null}
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
          Envoyer à {selected.length || "…"} personne(s)
        </button>
        <button className="mdp-btn mdp-panel__close" type="button" onClick={onClose}>
          Fermer
        </button>
      </div>
    </div>
  );
}

export function ExpenseClaimsAdminPage() {
  const { userProfile, currentUser } = useAuth();
  const byName = [userProfile?.firstName, userProfile?.lastName].filter(Boolean).join(" ") || currentUser?.email || "Organisation";
  const { siteEditionYear } = useSiteEditionYear();
  const { claims, loading, error } = useAllExpenseClaims(true);
  const [statusFilter, setStatusFilter] = useState("open");
  const [selectedId, setSelectedId] = useState(() => new URLSearchParams(window.location.search).get("d") || "");
  const [panel, setPanel] = useState(() => (new URLSearchParams(window.location.search).get("d") ? "claim" : ""));
  const [busy, setBusy] = useState(false);

  const summary = useMemo(() => summarizeClaims(claims), [claims]);
  const filtered = claims.filter((claim) =>
    statusFilter === "open"
      ? ["submitted", "checked", "sent_secretary"].includes(claim.status)
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
      window.alert("Le changement de statut a échoué.");
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
      window.alert("L'envoi des factures au budget a échoué.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="mdp-status">Chargement des décomptes…</p>;
  if (error) return <p className="mdp-status mdp-status--error">{error}</p>;

  return (
    <section className="rp">
      <div className="rp-summary">
        <span>
          <strong>{summary.toCheck}</strong> à vérifier
        </span>
        <span>{formatAmount(summary.openAmount)} en cours de paiement</span>
        <span className="rp-summary__done">{formatAmount(summary.paidAmount)} payés</span>
        {summary.waiting ? <span>{summary.waiting} préparé(s), en attente de la personne</span> : null}
      </div>
      <div className="ath-sheet">
        <div className="ath-toolbar">
          <select className="ath-filter" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="open">En cours (envoyés → payés)</option>
            <option value="">Tous</option>
            {CLAIM_STATUSES.map((status) => (
              <option key={status.value} value={status.value}>
                {status.label}
              </option>
            ))}
          </select>
          <span className="ath-toolbar__spacer" />
          <span className="ath-toolbar__count">{filtered.length} décompte(s)</span>
          <button
            className="ath-btn ath-btn--primary"
            type="button"
            onClick={() => {
              setPanel("preset");
              setSelectedId("");
            }}
          >
            Préparer un décompte
          </button>
        </div>
        <div className="rp-body">
          <div className="table-wrap rp-tablewrap">
            <table className="data-table data-table--sheet rp-table xc-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Personne</th>
                  <th>Motif</th>
                  <th className="rp-num">À payer</th>
                  <th className="rp-num">Justif.</th>
                  <th>Statut</th>
                  <th aria-label="Téléchargements" />
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td className="orgt-muted" colSpan={7}>
                      Aucun décompte avec ce filtre.
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
                    <td className="rp-date">{formatWhen(claim)}</td>
                    <td className="ath-name">{claimOwnerName(claim)}</td>
                    <td className="rp-action">{claim.reason || "—"}</td>
                    <td className="rp-num">{formatAmount(computeClaimTotals(claim).toPay)}</td>
                    <td className="rp-num">{claim.receipts.length}</td>
                    <td>
                      <span className={`xc-status xc-status--${getClaimStatus(claim.status).tone}`}>{getClaimStatus(claim.status).label}</span>
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
                <dt>Motif</dt>
                <dd>{selected.reason || "—"}</dd>
                <dt>Domicile</dt>
                <dd>{selected.address || "—"}</dd>
                <dt>IBAN</dt>
                <dd>{formatIban(selected.iban) || "—"}</dd>
                <dt>Banque + BIC</dt>
                <dd>{selected.bank || "—"}</dd>
              </dl>
              <table className="xc-detail__lines">
                <tbody>
                  {selected.lines.map((line, index) => (
                    <tr key={index}>
                      <td>{line.detail}</td>
                      <td className="rp-num">{formatAmount(line.amount)}</td>
                    </tr>
                  ))}
                  {selected.advance ? (
                    <tr>
                      <td>Acompte reçu</td>
                      <td className="rp-num">− {formatAmount(selected.advance)}</td>
                    </tr>
                  ) : null}
                  <tr className="xc-detail__total">
                    <td>À payer</td>
                    <td className="rp-num">{formatAmount(computeClaimTotals(selected).toPay)}</td>
                  </tr>
                </tbody>
              </table>
              <p className="mdp-collist__group">Justificatifs ({selected.receipts.length})</p>
              <ul className="xc-receipts">
                {selected.receipts.map((receipt) => (
                  <li key={receipt.fileUrl}>
                    <a href={receipt.fileUrl} rel="noreferrer" target="_blank">
                      {receipt.fileName}
                    </a>
                    {selected.budgetInvoiceIds[receipt.fileUrl] ? <span className="xc-inbudget">dans le budget ✓</span> : null}
                  </li>
                ))}
              </ul>
              {getReceiptsNotInBudget(selected).length && !["preset", "draft", "submitted"].includes(selected.status) ? (
                <button className="mdp-btn xc-tobudget" disabled={busy} type="button" onClick={() => sendToBudget(selected)}>
                  Envoyer {getReceiptsNotInBudget(selected).length} facture(s) au budget pour les classer
                </button>
              ) : selected.status === "submitted" ? (
                <p className="mdp-muted">En le marquant vérifié, chaque justificatif devient une facture « à classer » dans Budget.</p>
              ) : null}
              <p className="mdp-collist__group">Historique</p>
              <ul className="xc-history">
                {selected.history.map((entry, index) => (
                  <li key={index}>
                    {new Date(entry.at).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })} · {getClaimStatus(entry.status).label} · {entry.byName}
                  </li>
                ))}
              </ul>
              <div className="mdp-panel__actions xc-detail__actions">
                {NEXT_STATUS[selected.status] ? (
                  <button className="mdp-btn mdp-btn--primary" disabled={busy} type="button" onClick={() => changeStatus(selected, NEXT_STATUS[selected.status])}>
                    {NEXT_LABEL[selected.status]}
                  </button>
                ) : null}
                {["submitted", "checked"].includes(selected.status) ? (
                  <button className="mdp-btn mdp-btn--danger" disabled={busy} type="button" onClick={() => changeStatus(selected, "rejected")}>
                    À corriger
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
