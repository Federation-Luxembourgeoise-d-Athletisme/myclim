import { useState } from "react";
import { useAuth } from "../context/auth-context";
import { useSiteEditionYear } from "./edition";
import { ExpenseClaimForm } from "./expense-claim-form";
import { downloadClaimExcel, printClaimPdf } from "./expense-claim-export";
import { useMyExpenseClaims, useMyPrivateProfile } from "./expense-claims-hooks";
import { computeClaimTotals, formatAmount, getClaimStatus } from "./expense-claims";
import { useLanguage } from "./language-context";
import { useTr } from "./use-tr";

// Mon espace › Mes décomptes : demander un remboursement (décompte), compléter
// un décompte préparé par l'organisation, suivre ceux déjà envoyés.

function formatWhen(claim, language) {
  const seconds = claim.submittedAt?.seconds || claim.updatedAt?.seconds;
  return seconds
    ? new Date(seconds * 1000).toLocaleDateString(language === "fr" ? "fr-FR" : "en-GB", { day: "numeric", month: "short", year: "numeric" })
    : "—";
}

// Erreur de chargement renvoyée par useMyExpenseClaims (expense-claims-hooks.js).
const LOAD_ERROR_EN = { "Impossible de charger les décomptes.": "Unable to load the expense claims." };

export function MyExpenseClaimsPage() {
  const tr = useTr();
  const { language } = useLanguage();
  const { currentUser, userProfile } = useAuth();
  const { siteEditionYear } = useSiteEditionYear();
  const { claims, loading, error } = useMyExpenseClaims(currentUser?.uid);
  const { profile, loading: profileLoading } = useMyPrivateProfile(currentUser?.uid);
  const [openId, setOpenId] = useState(() => (new URLSearchParams(window.location.search).get("nouveau") ? "new" : ""));
  const statusLabel = (claim) => {
    const status = getClaimStatus(claim.status);
    return tr(status.label, status.labelEn);
  };

  if (loading || profileLoading) return <p className="mdp-status">{tr("Chargement de vos décomptes…", "Loading your expense claims…")}</p>;
  if (error) return <p className="mdp-status mdp-status--error">{tr(error, LOAD_ERROR_EN[error] || error)}</p>;

  const toComplete = claims.filter((claim) => ["preset", "draft", "rejected"].includes(claim.status));
  const sent = claims.filter((claim) => !["preset", "draft", "rejected"].includes(claim.status));
  const open = openId === "new" ? null : claims.find((claim) => claim.id === openId);

  if (openId) {
    return (
      <section className="xc-page">
        <button className="ath-link" type="button" onClick={() => setOpenId("")}>
          ← {tr("Mes décomptes", "My expense claims")}
        </button>
        <h2>
          {open?.status === "preset"
            ? tr("Décompte à compléter", "Expense claim to complete")
            : open
              ? tr("Reprendre le décompte", "Resume the expense claim")
              : tr("Nouveau décompte", "New expense claim")}
        </h2>
        <ExpenseClaimForm
          key={openId}
          claim={open}
          currentUser={currentUser}
          editionYear={siteEditionYear}
          privateProfile={profile}
          userProfile={userProfile}
          onCancel={() => setOpenId("")}
          onDone={() => window.setTimeout(() => setOpenId(""), 2500)}
        />
      </section>
    );
  }

  return (
    <section className="xc-page">
      <div className="xc-page__head">
        <div>
          <h2>{tr("Mes décomptes", "My expense claims")}</h2>
          <p className="mdp-muted">
            {tr(
              "Vous avez avancé une dépense pour le meeting ? Faites un décompte avec vos factures : il est envoyé à Margot, qui le vérifie puis le transmet au secrétariat de la FLA pour le remboursement.",
              "Did you pay for something for the meeting? Make an expense claim with your invoices: it goes to Margot, who checks it and passes it to the FLA secretariat for reimbursement.",
            )}
          </p>
        </div>
        <button className="ath-btn ath-btn--primary" type="button" onClick={() => setOpenId("new")}>
          {tr("+ Nouveau décompte", "+ New expense claim")}
        </button>
      </div>

      {toComplete.length ? (
        <div className="xc-list">
          <h3>{tr("À compléter", "To complete")} ({toComplete.length})</h3>
          {toComplete.map((claim) => (
            <button key={claim.id} className="xc-card xc-card--todo" type="button" onClick={() => setOpenId(claim.id)}>
              <span className={`xc-status xc-status--${getClaimStatus(claim.status).tone}`}>{statusLabel(claim)}</span>
              <strong>{claim.reason || tr("Décompte sans motif", "Expense claim without a reason")}</strong>
              <span>{formatAmount(computeClaimTotals(claim).toPay, language)}</span>
              {claim.preset ? <small>{tr("Préparé par", "Prepared by")} {claim.preset.byName}</small> : null}
            </button>
          ))}
        </div>
      ) : null}

      <div className="xc-list">
        <h3>{tr("Envoyés", "Sent")} ({sent.length})</h3>
        {sent.length === 0 ? <p className="mdp-muted">{tr("Aucun décompte envoyé pour l'instant.", "No expense claim sent yet.")}</p> : null}
        {sent.map((claim) => (
          <div key={claim.id} className="xc-card">
            <span className={`xc-status xc-status--${getClaimStatus(claim.status).tone}`}>{statusLabel(claim)}</span>
            <strong>{claim.reason}</strong>
            <span>{formatAmount(computeClaimTotals(claim).toPay, language)}</span>
            <small>
              {tr(
                `Envoyé le ${formatWhen(claim, language)} · ${claim.receipts.length} justificatif(s)`,
                `Sent on ${formatWhen(claim, language)} · ${claim.receipts.length} receipt${claim.receipts.length === 1 ? "" : "s"}`,
              )}
            </small>
            <span className="xc-card__actions">
              <button className="ath-link" type="button" onClick={() => downloadClaimExcel(claim)}>
                Excel
              </button>
              <button className="ath-link" type="button" onClick={() => printClaimPdf(claim)}>
                PDF
              </button>
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
