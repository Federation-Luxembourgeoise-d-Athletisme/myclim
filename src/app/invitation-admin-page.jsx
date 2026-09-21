import { useEffect, useState } from "react";
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { db } from "../services/firebase";
import { getAppBaseUrl } from "../services/app-url";
import { platformRoleOptions } from "./seed-data";

const ROLE_LABEL = Object.fromEntries(platformRoleOptions.map((r) => [r.value, r.label]));
const STATUS_LABEL = { pending: "En attente", accepted: "Acceptée", cancelled: "Annulée" };
const STATUS_COLOR = { pending: "#f59e0b", accepted: "#16a34a", cancelled: "#6b7280" };

function formatDate(ts) {
  if (!ts) return "—";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/* ── Create invitation form ──────────────────────────────── */
function InviteForm({ onSaved, onCancel }) {
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [roles, setRoles] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null); // { activationUrl, mailSent }

  function toggleRole(value) {
    setRoles((prev) => prev.includes(value) ? prev.filter((r) => r !== value) : [...prev, value]);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!email.trim()) { setError("L'adresse e-mail est requise."); return; }
    if (roles.length === 0) { setError("Sélectionnez au moins un module."); return; }
    setSaving(true);
    setError("");

    try {
      const token = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      const invitationRef = doc(collection(db, "invitations"));

      await setDoc(invitationRef, {
        email: email.trim().toLowerCase(),
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        roles,
        roleLabels: roles.map((r) => ROLE_LABEL[r] || r),
        token,
        status: "pending",
        createdAt: serverTimestamp(),
        expiresAt,
      });

      const activationUrl = `${getAppBaseUrl()}/invite?token=${token}`;

      let mailSent = false;
      try {
        const { enqueueTransactionalMail, buildInvitationMail } = await import("../services/mailQueue");
        await enqueueTransactionalMail(buildInvitationMail({
          email: email.trim().toLowerCase(),
          firstName: firstName.trim(),
          roles: roles.map((r) => ROLE_LABEL[r] || r),
          activationUrl,
        }));
        mailSent = true;
      } catch {
        // Mail failed — invitation saved, show link for manual sharing
      }

      setResult({ activationUrl, mailSent, toEmail: email.trim().toLowerCase() });
    } catch (e) {
      setError(e.message || "Erreur lors de la création de l'invitation.");
    } finally {
      setSaving(false);
    }
  }

  const labelStyle = { fontSize: "0.78rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#546770", display: "block", marginBottom: 6 };
  const inputStyle = { width: "100%", padding: "10px 14px", borderRadius: 8, border: "1px solid rgba(0,0,0,0.15)", fontSize: "0.9rem", fontFamily: "inherit", boxSizing: "border-box" };

  if (result) {
    return (
      <div style={{ background: result.mailSent ? "#f0fdf4" : "#fffbeb", border: `1px solid ${result.mailSent ? "#86efac" : "#fcd34d"}`, borderRadius: 16, padding: 32, maxWidth: 560 }}>
        <div style={{ fontSize: "2rem", marginBottom: 8 }}>{result.mailSent ? "✅" : "⚠️"}</div>
        <p style={{ fontWeight: 700, color: result.mailSent ? "#16a34a" : "#92400e", marginBottom: 8 }}>
          {result.mailSent
            ? `Invitation envoyée à ${result.toEmail}`
            : "Invitation créée — envoi du mail impossible"}
        </p>
        {!result.mailSent && (
          <>
            <p style={{ fontSize: "0.875rem", color: "#78350f", marginBottom: 16, lineHeight: 1.6 }}>
              Le service mail est indisponible, mais l'invitation est bien enregistrée. Partagez ce lien directement avec la personne — il expire dans 7 jours.
            </p>
            <div style={{ display: "flex", gap: 8, alignItems: "center", background: "#fff", border: "1px solid #fcd34d", borderRadius: 8, padding: "10px 14px" }}>
              <code style={{ flex: 1, fontSize: "0.78rem", wordBreak: "break-all", color: "#1066cc" }}>
                {result.activationUrl}
              </code>
              <button
                onClick={() => { navigator.clipboard.writeText(result.activationUrl); }}
                style={{ flexShrink: 0, padding: "6px 12px", background: "#1066cc", color: "#fff", border: "none", borderRadius: 6, fontSize: "0.78rem", fontWeight: 700, cursor: "pointer" }}
              >
                Copier
              </button>
            </div>
          </>
        )}
        <button onClick={onSaved} className="btn btn-ghost" style={{ marginTop: 20 }}>
          Retour à la liste
        </button>
      </div>
    );
  }

  return (
    <div style={{ background: "#fff", border: "1px solid rgba(0,0,0,0.1)", borderRadius: 16, padding: 32, maxWidth: 560 }}>
      <h3 style={{ margin: "0 0 24px 0", fontSize: "1rem", fontWeight: 700 }}>Nouvelle invitation</h3>
      <form onSubmit={handleSubmit} style={{ display: "grid", gap: 16 }}>
        <div>
          <label style={labelStyle}>Adresse e-mail *</label>
          <input type="email" style={inputStyle} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="prenom.nom@example.com" required />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <label style={labelStyle}>Prénom</label>
            <input style={inputStyle} value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="Prénom" />
          </div>
          <div>
            <label style={labelStyle}>Nom</label>
            <input style={inputStyle} value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Nom" />
          </div>
        </div>

        <div>
          <label style={{ ...labelStyle, marginBottom: 12 }}>Modules &amp; accès *</label>
          <div style={{ display: "grid", gap: 8 }}>
            {platformRoleOptions.map((opt) => (
              <label
                key={opt.value}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "10px 14px",
                  borderRadius: 8,
                  border: `1px solid ${roles.includes(opt.value) ? "#1066cc" : "rgba(0,0,0,0.12)"}`,
                  background: roles.includes(opt.value) ? "#f0f5ff" : "#fafafa",
                  cursor: "pointer",
                  userSelect: "none",
                }}
              >
                <input
                  type="checkbox"
                  checked={roles.includes(opt.value)}
                  onChange={() => toggleRole(opt.value)}
                  style={{ width: 16, height: 16, accentColor: "#1066cc" }}
                />
                <div>
                  <div style={{ fontSize: "0.875rem", fontWeight: 600 }}>{opt.label}</div>
                  <div style={{ fontSize: "0.78rem", color: "#546770" }}>{getRoleDescription(opt.value)}</div>
                </div>
              </label>
            ))}
          </div>
        </div>

        {error && (
          <div style={{ background: "#fff0f0", border: "1px solid #f87171", borderRadius: 8, padding: "12px 16px", color: "#b91c1c", fontSize: "0.875rem" }}>
            {error}
          </div>
        )}

        <div style={{ display: "flex", gap: 10, paddingTop: 4 }}>
          <button type="submit" disabled={saving} className="btn btn-primary">
            {saving ? "Envoi en cours…" : "✉️ Envoyer l'invitation"}
          </button>
          <button type="button" onClick={onCancel} className="btn btn-ghost">Annuler</button>
        </div>
      </form>
    </div>
  );
}

/* ── Bulk import (list of e-mails) ───────────────────────── */
function parseBulkInput(raw) {
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const seen = new Set();
  const rows = [];
  const invalidLines = [];

  raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line) => {
      const parts = line.split(/[,;\t]/).map((p) => p.trim());
      const [email, firstName = "", lastName = ""] = parts;
      const normalized = (email || "").toLowerCase();
      if (!emailRe.test(normalized)) {
        invalidLines.push(line);
        return;
      }
      if (seen.has(normalized)) return;
      seen.add(normalized);
      rows.push({ email: normalized, firstName, lastName });
    });

  return { rows, invalidLines };
}

function BulkInviteForm({ onSaved, onCancel }) {
  const [raw, setRaw] = useState("");
  const [roles, setRoles] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState(null); // { done, total }
  const [results, setResults] = useState(null); // { succeeded: [], failed: [], mailFailed: [] }

  function toggleRole(value) {
    setRoles((prev) => prev.includes(value) ? prev.filter((r) => r !== value) : [...prev, value]);
  }

  function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setRaw((prev) => (prev ? prev + "\n" : "") + String(reader.result || ""));
    reader.readAsText(file);
    e.target.value = "";
  }

  const { rows, invalidLines } = parseBulkInput(raw);

  async function handleSubmit(e) {
    e.preventDefault();
    if (rows.length === 0) { setError("Ajoutez au moins une adresse e-mail valide."); return; }
    if (roles.length === 0) { setError("Sélectionnez au moins un module."); return; }
    setSaving(true);
    setError("");
    setProgress({ done: 0, total: rows.length });

    const succeeded = [];
    const failed = [];
    const mailFailed = [];
    const roleLabels = roles.map((r) => ROLE_LABEL[r] || r);
    const { enqueueTransactionalMail, buildInvitationMail } = await import("../services/mailQueue");

    for (const row of rows) {
      try {
        const token = crypto.randomUUID();
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        const invitationRef = doc(collection(db, "invitations"));

        await setDoc(invitationRef, {
          email: row.email,
          firstName: row.firstName,
          lastName: row.lastName,
          roles,
          roleLabels,
          token,
          status: "pending",
          createdAt: serverTimestamp(),
          expiresAt,
        });

        const activationUrl = `${getAppBaseUrl()}/invite?token=${token}`;
        succeeded.push(row.email);

        try {
          await enqueueTransactionalMail(buildInvitationMail({
            email: row.email,
            firstName: row.firstName,
            roles: roleLabels,
            activationUrl,
          }));
        } catch {
          mailFailed.push({ email: row.email, activationUrl });
        }
      } catch (rowErr) {
        failed.push({ email: row.email, message: rowErr.message || "Erreur" });
      }
      setProgress((p) => ({ done: (p?.done || 0) + 1, total: rows.length }));
    }

    setResults({ succeeded, failed, mailFailed });
    setSaving(false);
  }

  const labelStyle = { fontSize: "0.78rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#546770", display: "block", marginBottom: 6 };
  const inputStyle = { width: "100%", padding: "10px 14px", borderRadius: 8, border: "1px solid rgba(0,0,0,0.15)", fontSize: "0.9rem", fontFamily: "inherit", boxSizing: "border-box" };

  if (results) {
    return (
      <div style={{ background: "#fff", border: "1px solid rgba(0,0,0,0.1)", borderRadius: 16, padding: 32, maxWidth: 640 }}>
        <h3 style={{ margin: "0 0 16px 0", fontSize: "1rem", fontWeight: 700 }}>Résultat de l'import</h3>
        <p style={{ fontSize: "0.9rem", marginBottom: 16 }}>
          <strong style={{ color: "#16a34a" }}>{results.succeeded.length}</strong> invitation(s) créée(s) sur {rows.length + results.failed.length > 0 ? results.succeeded.length + results.failed.length : rows.length}.
          {results.mailFailed.length > 0 && (
            <> <strong style={{ color: "#92400e" }}>{results.mailFailed.length}</strong> mail(s) non envoyé(s) — lien à partager manuellement.</>
          )}
        </p>

        {results.mailFailed.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ ...labelStyle, marginBottom: 8 }}>Liens à partager manuellement</div>
            <div style={{ display: "grid", gap: 8, maxHeight: 220, overflowY: "auto" }}>
              {results.mailFailed.map(({ email, activationUrl }) => (
                <div key={email} style={{ display: "flex", gap: 8, alignItems: "center", background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: 8, padding: "8px 12px" }}>
                  <span style={{ fontSize: "0.78rem", fontWeight: 700, flexShrink: 0 }}>{email}</span>
                  <code style={{ flex: 1, fontSize: "0.72rem", wordBreak: "break-all", color: "#1066cc" }}>{activationUrl}</code>
                  <button
                    onClick={() => navigator.clipboard.writeText(activationUrl)}
                    style={{ flexShrink: 0, padding: "4px 10px", background: "#1066cc", color: "#fff", border: "none", borderRadius: 6, fontSize: "0.72rem", fontWeight: 700, cursor: "pointer" }}
                  >
                    Copier
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {results.failed.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ ...labelStyle, marginBottom: 8, color: "#b91c1c" }}>Échecs</div>
            <div style={{ display: "grid", gap: 4 }}>
              {results.failed.map(({ email, message }) => (
                <div key={email} style={{ fontSize: "0.8rem", color: "#b91c1c" }}>{email} — {message}</div>
              ))}
            </div>
          </div>
        )}

        <button onClick={onSaved} className="btn btn-ghost" style={{ marginTop: 8 }}>
          Retour à la liste
        </button>
      </div>
    );
  }

  return (
    <div style={{ background: "#fff", border: "1px solid rgba(0,0,0,0.1)", borderRadius: 16, padding: 32, maxWidth: 640 }}>
      <h3 style={{ margin: "0 0 8px 0", fontSize: "1rem", fontWeight: 700 }}>Import en masse</h3>
      <p style={{ fontSize: "0.82rem", color: "#546770", margin: "0 0 20px 0" }}>
        Une adresse par ligne, ou <code>email, prénom, nom</code> séparés par une virgule. Vous pouvez aussi importer un fichier .csv ou .txt.
      </p>
      <form onSubmit={handleSubmit} style={{ display: "grid", gap: 16 }}>
        <div>
          <label style={labelStyle}>Liste d'adresses e-mail *</label>
          <textarea
            style={{ ...inputStyle, minHeight: 160, resize: "vertical", fontFamily: "monospace" }}
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            placeholder={"prenom.nom@example.com\njean.dupont@example.com, Jean, Dupont"}
          />
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 8 }}>
            <label className="btn btn-ghost btn-sm" style={{ cursor: "pointer" }}>
              📄 Importer un fichier
              <input type="file" accept=".csv,.txt" onChange={handleFile} style={{ display: "none" }} />
            </label>
            {raw.trim() && (
              <span style={{ fontSize: "0.78rem", color: "#546770" }}>
                {rows.length} adresse(s) valide(s){invalidLines.length > 0 ? `, ${invalidLines.length} ligne(s) ignorée(s)` : ""}
              </span>
            )}
          </div>
          {invalidLines.length > 0 && (
            <p style={{ fontSize: "0.75rem", color: "#b91c1c", marginTop: 6 }}>
              Lignes ignorées (adresse invalide) : {invalidLines.slice(0, 5).join(" · ")}{invalidLines.length > 5 ? "…" : ""}
            </p>
          )}
        </div>

        <div>
          <label style={{ ...labelStyle, marginBottom: 12 }}>Modules &amp; accès (appliqués à tout le monde) *</label>
          <div style={{ display: "grid", gap: 8 }}>
            {platformRoleOptions.map((opt) => (
              <label
                key={opt.value}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "10px 14px",
                  borderRadius: 8,
                  border: `1px solid ${roles.includes(opt.value) ? "#1066cc" : "rgba(0,0,0,0.12)"}`,
                  background: roles.includes(opt.value) ? "#f0f5ff" : "#fafafa",
                  cursor: "pointer",
                  userSelect: "none",
                }}
              >
                <input
                  type="checkbox"
                  checked={roles.includes(opt.value)}
                  onChange={() => toggleRole(opt.value)}
                  style={{ width: 16, height: 16, accentColor: "#1066cc" }}
                />
                <div>
                  <div style={{ fontSize: "0.875rem", fontWeight: 600 }}>{opt.label}</div>
                  <div style={{ fontSize: "0.78rem", color: "#546770" }}>{getRoleDescription(opt.value)}</div>
                </div>
              </label>
            ))}
          </div>
        </div>

        {error && (
          <div style={{ background: "#fff0f0", border: "1px solid #f87171", borderRadius: 8, padding: "12px 16px", color: "#b91c1c", fontSize: "0.875rem" }}>
            {error}
          </div>
        )}

        <div style={{ display: "flex", gap: 10, paddingTop: 4, alignItems: "center" }}>
          <button type="submit" disabled={saving || rows.length === 0} className="btn btn-primary">
            {saving ? `Envoi en cours… (${progress?.done || 0}/${progress?.total || rows.length})` : `✉️ Envoyer ${rows.length || ""} invitation${rows.length > 1 ? "s" : ""}`}
          </button>
          <button type="button" onClick={onCancel} className="btn btn-ghost" disabled={saving}>Annuler</button>
        </div>
      </form>
    </div>
  );
}

function getRoleDescription(role) {
  const descriptions = {
    admin: "Accès complet à toute la plateforme",
    budget: "Accès au module budget sans droits administrateur globaux",
    gestionnaire: "Gestion des bénévoles, présences, accréditations",
    gestionnaire_site: "Gestion du site public : actualités, partenaires, communiqués",
    chef_equipe: "Gestion de son équipe et pointage des présences",
    benevole: "Dossier bénévole, affectations, documents",
    parent_u14: "Inscription et suivi des enfants pré-programme",
  };
  return descriptions[role] || "";
}

/* ── Invitations list ────────────────────────────────────── */
export function InvitationAdminPage({ Panel }) {
  const [invitations, setInvitations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [bulkCreating, setBulkCreating] = useState(false);
  const [actionStatus, setActionStatus] = useState("");
  const [resendFallbackUrl, setResendFallbackUrl] = useState("");

  useEffect(() => {
    const q = query(collection(db, "invitations"), orderBy("createdAt", "desc"));
    const unsub = onSnapshot(q, (snap) => {
      setInvitations(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setLoading(false);
    });
    return unsub;
  }, []);

  async function handleResend(invitation) {
    setActionStatus("Renvoi en cours…");
    setResendFallbackUrl("");

    // 1. Renouveler le token en Firestore
    let activationUrl = "";
    try {
      const token = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      await updateDoc(doc(db, "invitations", invitation.id), {
        token,
        status: "pending",
        expiresAt,
        resentAt: serverTimestamp(),
      });
      activationUrl = `${getAppBaseUrl()}/invite?token=${token}`;
    } catch (firestoreErr) {
      setActionStatus(`Erreur : ${firestoreErr.message}`);
      return;
    }

    // 2. Envoyer le mail (optionnel — affiche le lien si ça échoue)
    try {
      const { enqueueTransactionalMail, buildInvitationMail } = await import("../services/mailQueue");
      await enqueueTransactionalMail(buildInvitationMail({
        email: invitation.email,
        firstName: invitation.firstName,
        roles: Array.isArray(invitation.roleLabels) ? invitation.roleLabels : [],
        activationUrl,
      }));
      setActionStatus("Invitation renvoyée ✓");
      setTimeout(() => setActionStatus(""), 3000);
    } catch (_mailErr) {
      setResendFallbackUrl(activationUrl);
      setActionStatus("Mail indisponible — partagez ce lien directement :");
    }
  }

  async function handleCancel(invitation) {
    if (!window.confirm(`Annuler l'invitation de ${invitation.email} ?`)) return;
    await updateDoc(doc(db, "invitations", invitation.id), { status: "cancelled" });
  }

  async function handleDelete(invitation) {
    if (!window.confirm(`Supprimer définitivement l'invitation de ${invitation.email} ?`)) return;
    await deleteDoc(doc(db, "invitations", invitation.id));
  }

  const pending = invitations.filter((i) => i.status === "pending");
  const others = invitations.filter((i) => i.status !== "pending");

  if (creating) {
    return (
      <Panel title="Inviter un utilisateur">
        <InviteForm onSaved={() => setCreating(false)} onCancel={() => setCreating(false)} />
      </Panel>
    );
  }

  if (bulkCreating) {
    return (
      <Panel title="Import en masse">
        <BulkInviteForm onSaved={() => setBulkCreating(false)} onCancel={() => setBulkCreating(false)} />
      </Panel>
    );
  }

  return (
    <Panel
      title="Invitations"
      subtitle="Pré-enregistrez un compte et envoyez un lien d'activation par e-mail."
      actions={
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-ghost" onClick={() => setBulkCreating(true)}>
            📄 Import en masse
          </button>
          <button className="btn btn-primary" onClick={() => setCreating(true)}>
            + Nouvelle invitation
          </button>
        </div>
      }
    >
      {actionStatus && (
        <div style={{ marginBottom: 16 }}>
          <p style={{ padding: "10px 16px", background: resendFallbackUrl ? "#fffbeb" : "#f0fdf4", border: `1px solid ${resendFallbackUrl ? "#fcd34d" : "#86efac"}`, borderRadius: 8, color: resendFallbackUrl ? "#92400e" : "#16a34a", fontSize: "0.875rem", margin: 0 }}>
            {actionStatus}
          </p>
          {resendFallbackUrl && (
            <div style={{ display: "flex", gap: 8, alignItems: "center", background: "#fff", border: "1px solid #fcd34d", borderRadius: 8, padding: "10px 14px", marginTop: 8 }}>
              <code style={{ flex: 1, fontSize: "0.75rem", wordBreak: "break-all", color: "#1066cc" }}>{resendFallbackUrl}</code>
              <button
                onClick={() => { navigator.clipboard.writeText(resendFallbackUrl); setResendFallbackUrl(""); setActionStatus("Lien copié ✓"); setTimeout(() => setActionStatus(""), 2000); }}
                style={{ flexShrink: 0, padding: "6px 12px", background: "#1066cc", color: "#fff", border: "none", borderRadius: 6, fontSize: "0.78rem", fontWeight: 700, cursor: "pointer" }}
              >
                Copier
              </button>
            </div>
          )}
        </div>
      )}

      {loading ? (
        <p style={{ color: "#546770" }}>Chargement…</p>
      ) : invitations.length === 0 ? (
        <div style={{ textAlign: "center", padding: "48px 0", color: "#546770" }}>
          <p>Aucune invitation pour le moment.</p>
          <button className="btn btn-primary" onClick={() => setCreating(true)} style={{ marginTop: 16 }}>
            + Nouvelle invitation
          </button>
        </div>
      ) : (
        <>
          {pending.length > 0 && (
            <>
              <h3 style={{ fontSize: "0.85rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#546770", margin: "0 0 12px 0" }}>
                En attente ({pending.length})
              </h3>
              <div className="table-wrap" style={{ marginBottom: 32 }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>E-mail</th>
                      <th>Nom</th>
                      <th>Modules</th>
                      <th>Envoyée le</th>
                      <th>Expire le</th>
                      <th style={{ width: 160 }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pending.map((inv) => (
                      <InvitationRow
                        key={inv.id}
                        invitation={inv}
                        onResend={handleResend}
                        onCancel={handleCancel}
                        onDelete={handleDelete}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {others.length > 0 && (
            <>
              <h3 style={{ fontSize: "0.85rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#546770", margin: "0 0 12px 0" }}>
                Historique
              </h3>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>E-mail</th>
                      <th>Nom</th>
                      <th>Modules</th>
                      <th>Statut</th>
                      <th>Date</th>
                      <th style={{ width: 80 }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {others.map((inv) => (
                      <InvitationRow
                        key={inv.id}
                        invitation={inv}
                        onResend={handleResend}
                        onCancel={handleCancel}
                        onDelete={handleDelete}
                        history
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </Panel>
  );
}

function InvitationRow({ invitation: inv, onResend, onCancel, onDelete, history }) {
  const name = [inv.firstName, inv.lastName].filter(Boolean).join(" ") || "—";
  const roles = Array.isArray(inv.roleLabels) ? inv.roleLabels : [];
  const expiresAt = inv.expiresAt?.toDate ? inv.expiresAt.toDate() : inv.expiresAt ? new Date(inv.expiresAt) : null;
  const expired = expiresAt && expiresAt < new Date();

  return (
    <tr>
      <td style={{ fontWeight: 600, fontSize: "0.875rem" }}>{inv.email}</td>
      <td style={{ fontSize: "0.875rem" }}>{name}</td>
      <td>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          {roles.length
            ? roles.map((r) => (
                <span key={r} style={{ fontSize: "0.75rem", background: "#e8f0fe", color: "#1066cc", padding: "2px 8px", borderRadius: 99, fontWeight: 600, whiteSpace: "nowrap" }}>{r}</span>
              ))
            : <span style={{ color: "#999", fontSize: "0.8rem" }}>—</span>}
        </div>
      </td>
      <td style={{ fontSize: "0.8rem", color: "#546770" }}>{formatDate(inv.createdAt)}</td>
      {history ? (
        <td>
          <span style={{ fontSize: "0.8rem", fontWeight: 700, color: STATUS_COLOR[inv.status] || "#546770" }}>
            {STATUS_LABEL[inv.status] || inv.status}
          </span>
        </td>
      ) : (
        <td style={{ fontSize: "0.8rem", color: expired ? "#e8001c" : "#546770" }}>
          {expiresAt ? expiresAt.toLocaleDateString("fr-FR") : "—"}
          {expired && <span style={{ marginLeft: 6, color: "#e8001c", fontWeight: 700 }}>Expiré</span>}
        </td>
      )}
      <td>
        <div style={{ display: "flex", gap: 6 }}>
          {inv.status !== "accepted" && (
            <button className="btn btn-sm btn-secondary" onClick={() => onResend(inv)} title="Renvoyer l'invitation">
              ↺ Renvoyer
            </button>
          )}
          {inv.status === "pending" && (
            <button className="btn btn-sm btn-ghost" onClick={() => onCancel(inv)} title="Annuler">
              ✕
            </button>
          )}
          {inv.status !== "pending" && (
            <button className="btn btn-sm btn-danger" onClick={() => onDelete(inv)} title="Supprimer">
              Suppr.
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}
