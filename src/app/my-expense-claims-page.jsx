import { useState } from "react";
import { useAuth } from "../context/auth-context";
import { useSiteEditionYear } from "./edition";
import { ExpenseClaimForm } from "./expense-claim-form";
import { downloadClaimExcel, printClaimPdf } from "./expense-claim-export";
import { useMyExpenseClaims, useMyPrivateProfile } from "./expense-claims-hooks";
import { computeClaimTotals, formatAmount, getClaimStatus } from "./expense-claims";

// Mon espace › Mes décomptes : demander un remboursement (décompte), compléter
// un décompte préparé par l'organisation, suivre ceux déjà envoyés.

function formatWhen(claim) {
  const seconds = claim.submittedAt?.seconds || claim.updatedAt?.seconds;
  return seconds ? new Date(seconds * 1000).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" }) : "—";
}

export function MyExpenseClaimsPage() {
  const { currentUser, userProfile } = useAuth();
  const { siteEditionYear } = useSiteEditionYear();
  const { claims, loading, error } = useMyExpenseClaims(currentUser?.uid);
  const { profile, loading: profileLoading } = useMyPrivateProfile(currentUser?.uid);
  const [openId, setOpenId] = useState(() => (new URLSearchParams(window.location.search).get("nouveau") ? "new" : ""));

  if (loading || profileLoading) return <p className="mdp-status">Chargement de vos décomptes…</p>;
  if (error) return <p className="mdp-status mdp-status--error">{error}</p>;

  const toComplete = claims.filter((claim) => ["preset", "draft", "rejected"].includes(claim.status));
  const sent = claims.filter((claim) => !["preset", "draft", "rejected"].includes(claim.status));
  const open = openId === "new" ? null : claims.find((claim) => claim.id === openId);

  if (openId) {
    return (
      <section className="xc-page">
        <button className="ath-link" type="button" onClick={() => setOpenId("")}>
          ← Mes décomptes
        </button>
        <h2>{open?.status === "preset" ? "Décompte à compléter" : open ? "Reprendre le décompte" : "Nouveau décompte"}</h2>
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
          <h2>Mes décomptes</h2>
          <p className="mdp-muted">
            Vous avez avancé une dépense pour le meeting ? Faites un décompte avec vos factures : il est envoyé à Margot, qui le
            vérifie puis le transmet au secrétariat de la FLA pour le remboursement.
          </p>
        </div>
        <button className="ath-btn ath-btn--primary" type="button" onClick={() => setOpenId("new")}>
          + Nouveau décompte
        </button>
      </div>

      {toComplete.length ? (
        <div className="xc-list">
          <h3>À compléter ({toComplete.length})</h3>
          {toComplete.map((claim) => (
            <button key={claim.id} className="xc-card xc-card--todo" type="button" onClick={() => setOpenId(claim.id)}>
              <span className={`xc-status xc-status--${getClaimStatus(claim.status).tone}`}>{getClaimStatus(claim.status).label}</span>
              <strong>{claim.reason || "Décompte sans motif"}</strong>
              <span>{formatAmount(computeClaimTotals(claim).toPay)}</span>
              {claim.preset ? <small>Préparé par {claim.preset.byName}</small> : null}
            </button>
          ))}
        </div>
      ) : null}

      <div className="xc-list">
        <h3>Envoyés ({sent.length})</h3>
        {sent.length === 0 ? <p className="mdp-muted">Aucun décompte envoyé pour l'instant.</p> : null}
        {sent.map((claim) => (
          <div key={claim.id} className="xc-card">
            <span className={`xc-status xc-status--${getClaimStatus(claim.status).tone}`}>{getClaimStatus(claim.status).label}</span>
            <strong>{claim.reason}</strong>
            <span>{formatAmount(computeClaimTotals(claim).toPay)}</span>
            <small>Envoyé le {formatWhen(claim)} · {claim.receipts.length} justificatif(s)</small>
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
