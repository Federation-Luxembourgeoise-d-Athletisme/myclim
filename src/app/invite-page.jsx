import { useEffect, useState } from "react";
import { createUserWithEmailAndPassword } from "firebase/auth";
import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { useNavigate, useSearchParams } from "react-router-dom";
import { auth, db } from "../services/firebase";
import { buildUserSearchTokens } from "./invite-helpers";
import { useLanguage } from "./language-context";
import { useTr } from "./use-tr";

// Libellés d'accès enregistrés en français sur l'invitation, affichés dans la
// langue choisie.
const ROLE_LABEL_EN = [
  ["Chef d'équipe", "Team leader"],
  ["Bénévole", "Volunteer"],
  ["Membre de l'organisation", "Organisation member"],
  ["Gestionnaire", "Manager"],
];

function translateRoleLabel(label, language) {
  if (language === "fr") return label;
  return ROLE_LABEL_EN.reduce((text, [fr, en]) => text.split(fr).join(en), String(label || ""));
}

export function InvitePage() {
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  const navigate = useNavigate();
  const tr = useTr();
  const { language, setLanguage } = useLanguage();

  const [invitation, setInvitation] = useState(null);
  const [invitationId, setInvitationId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) { setError(["Lien invalide ou expiré.", "This link is invalid or has expired."]); setLoading(false); return; }
    async function load() {
      try {
        // L'id de l'invitation est son token : les règles n'autorisent que ce
        // get, la collection n'est pas listable.
        const d = await getDoc(doc(db, "invitations", token));
        const data = d.exists() ? d.data() : null;
        if (!data || data.status !== "pending") { setError(["Ce lien d'invitation est invalide ou a déjà été utilisé.", "This invitation link is invalid or has already been used."]); return; }
        const expiresAt = data.expiresAt?.toDate?.() || new Date(data.expiresAt);
        if (expiresAt && expiresAt < new Date()) { setError(["Ce lien d'invitation a expiré. Contactez un administrateur.", "This invitation link has expired. Please contact an administrator."]); return; }
        setInvitation(data);
        setInvitationId(d.id);
        setFirstName(data.firstName || "");
        setLastName(data.lastName || "");
      } catch (e) {
        setError(["Impossible de vérifier l'invitation. Réessayez plus tard.", "The invitation could not be checked. Please try again later."]);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [token]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (password !== confirm) { setError(["Les mots de passe ne correspondent pas.", "The passwords do not match."]); return; }
    if (password.length < 8) { setError(["Le mot de passe doit contenir au moins 8 caractères.", "The password must be at least 8 characters long."]); return; }
    setError("");
    setSubmitting(true);
    try {
      const credential = await createUserWithEmailAndPassword(auth, invitation.email, password);
      const uid = credential.user.uid;
      const roles = Array.isArray(invitation.roles) ? invitation.roles : [];
      const profile = {
        uid,
        email: invitation.email,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        userTypes: roles.length ? roles : ["benevole"],
        // Les règles Firestore vérifient les rôles accordés contre cette invitation.
        invitationId,
        // Chef d'équipe nommé directement : son équipe, posée à la création
        // (les règles n'acceptent que celle de l'invitation).
        ...(invitation.leadTeam
          ? {
              assignedRole: invitation.leadTeam,
              assignedTeams: [invitation.leadTeam],
              teamRole: "Chef d'équipe",
              leadTeams: [invitation.leadTeam],
              workflowStatus: "Affecté",
            }
          : invitation.memberTeam
            ? {
                assignedRole: invitation.memberTeam,
                assignedTeams: [invitation.memberTeam],
                teamRole: "Bénévole",
                workflowStatus: "Affecté",
              }
            : {}),
        accountStatus: "active",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        searchTokens: buildUserSearchTokens({
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          email: invitation.email,
        }),
      };
      await setDoc(doc(db, "users", uid), profile, { merge: true });
      await updateDoc(doc(db, "invitations", invitationId), {
        status: "accepted",
        acceptedAt: serverTimestamp(),
        acceptedByUid: uid,
      });
      // Chef d'équipe nommé directement : sa fiche bénévole (déjà affectée)
      // est reliée à son nouveau compte.
      if (invitation.applicationId) {
        try {
          await updateDoc(doc(db, "volunteerApplications", invitation.applicationId), { uid, updatedAt: serverTimestamp() });
        } catch (linkError) {
          console.error("Unable to link the volunteer application", linkError);
        }
      }
      setDone(true);
      setTimeout(() => navigate("/app", { replace: true }), 2000);
    } catch (e) {
      if (e.code === "auth/email-already-in-use") {
        setError(["Un compte existe déjà avec cette adresse. Connectez-vous sur /login.", "An account already exists with this address. Please sign in at /login."]);
      } else {
        setError(e.message ? [e.message, e.message] : ["Une erreur est survenue.", "Something went wrong."]);
      }
    } finally {
      setSubmitting(false);
    }
  }

  const errorText = Array.isArray(error) ? tr(error[0], error[1]) : error;
  // Choix de la langue : une personne invitée n'a pas encore de préférence.
  const languageSwitch = (
    <div style={{ display: "flex", justifyContent: "flex-end", gap: 4, marginBottom: 8 }}>
      {["en", "fr"].map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => setLanguage(option)}
          aria-pressed={language === option}
          style={{
            padding: "3px 10px",
            borderRadius: 999,
            border: "1px solid #d5dee8",
            background: language === option ? "#17324a" : "#fff",
            color: language === option ? "#fff" : "#17324a",
            fontSize: "0.75rem",
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          {option.toUpperCase()}
        </button>
      ))}
    </div>
  );

  const containerStyle = {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#f4f7fb",
    padding: "24px 16px",
  };
  const cardStyle = {
    background: "#fff",
    borderRadius: 20,
    padding: "40px 36px",
    maxWidth: 440,
    width: "100%",
    boxShadow: "0 4px 32px rgba(0,0,0,0.10)",
  };
  const labelStyle = {
    display: "block",
    fontSize: "0.78rem",
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: "#546770",
    marginBottom: 6,
  };
  const inputStyle = {
    width: "100%",
    padding: "10px 14px",
    borderRadius: 8,
    border: "1px solid rgba(0,0,0,0.15)",
    fontSize: "0.9rem",
    fontFamily: "inherit",
    boxSizing: "border-box",
  };

  if (loading) {
    return (
      <div style={containerStyle}>
        <div style={cardStyle}>
          <p style={{ textAlign: "center", color: "#546770" }}>{tr("Vérification de l'invitation…", "Checking your invitation…")}</p>
        </div>
      </div>
    );
  }

  if (error && !invitation) {
    return (
      <div style={containerStyle}>
        <div style={cardStyle}>
          {languageSwitch}
          <div style={{ textAlign: "center", marginBottom: 24 }}>
            <div style={{ fontSize: "2.5rem", marginBottom: 12 }}>⚠️</div>
            <h1 style={{ fontSize: "1.2rem", fontWeight: 700, margin: "0 0 12px 0" }}>{tr("Invitation invalide", "Invalid invitation")}</h1>
            <p style={{ color: "#546770", lineHeight: 1.6 }}>{errorText}</p>
          </div>
          <a href="/login" style={{ display: "block", textAlign: "center", color: "#1066cc", fontSize: "0.9rem" }}>
            {tr("Aller à la page de connexion →", "Go to the sign-in page →")}
          </a>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div style={containerStyle}>
        <div style={{ ...cardStyle, textAlign: "center" }}>
          <div style={{ fontSize: "2.5rem", marginBottom: 12 }}>✅</div>
          <h1 style={{ fontSize: "1.2rem", fontWeight: 700, margin: "0 0 12px 0" }}>{tr("Compte activé !", "Account activated!")}</h1>
          <p style={{ color: "#546770", lineHeight: 1.6 }}>{tr("Redirection vers votre espace…", "Taking you to your space…")}</p>
        </div>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <div style={cardStyle}>
        {languageSwitch}
        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ width: 56, height: 56, borderRadius: "50%", background: "linear-gradient(135deg,#0d6fb8,#e30d25)", display: "inline-flex", alignItems: "center", justifyContent: "center", marginBottom: 16 }}>
            <span style={{ fontSize: "1.6rem" }}>🔐</span>
          </div>
          <h1 style={{ fontSize: "1.4rem", fontWeight: 800, margin: "0 0 8px 0" }}>{tr("Activer mon compte", "Activate my account")}</h1>
          <p style={{ color: "#546770", fontSize: "0.9rem", lineHeight: 1.5 }}>
            {tr("Choisissez votre mot de passe pour accéder à MyCLIM.", "Choose your password to access MyCLIM.")}
          </p>
        </div>

        <form onSubmit={handleSubmit} style={{ display: "grid", gap: 16 }}>
          {/* Email readonly */}
          <div>
            <label style={labelStyle}>{tr("Adresse e-mail", "E-mail address")}</label>
            <input
              style={{ ...inputStyle, background: "#f6f9fc", color: "#546770" }}
              value={invitation?.email || ""}
              readOnly
            />
          </div>

          {/* Name fields */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label style={labelStyle}>{tr("Prénom", "First name")}</label>
              <input style={inputStyle} value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder={tr("Prénom", "First name")} />
            </div>
            <div>
              <label style={labelStyle}>{tr("Nom", "Last name")}</label>
              <input style={inputStyle} value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder={tr("Nom", "Last name")} />
            </div>
          </div>

          {/* Roles preview */}
          {Array.isArray(invitation?.roleLabels) && invitation.roleLabels.length > 0 && (
            <div style={{ padding: "12px 16px", background: "#f6f9fc", borderRadius: 8, border: "1px solid #dbe4f0" }}>
              <span style={{ fontSize: "0.75rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#546770" }}>
                {tr("Accès attribués", "Your access")}
              </span>
              <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 6 }}>
                {invitation.roleLabels.map((r) => (
                  <span key={r} style={{ fontSize: "0.8rem", background: "#e8f0fe", color: "#1066cc", padding: "2px 10px", borderRadius: 99, fontWeight: 600 }}>{translateRoleLabel(r, language)}</span>
                ))}
              </div>
            </div>
          )}

          {/* Password */}
          <div>
            <label style={labelStyle}>{tr("Mot de passe *", "Password *")}</label>
            <input type="password" style={inputStyle} value={password} onChange={(e) => setPassword(e.target.value)} placeholder={tr("8 caractères minimum", "At least 8 characters")} required minLength={8} />
          </div>
          <div>
            <label style={labelStyle}>{tr("Confirmer le mot de passe *", "Confirm the password *")}</label>
            <input type="password" style={inputStyle} value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder={tr("Répétez le mot de passe", "Repeat the password")} required />
          </div>

          {error && (
            <div style={{ background: "#fff0f0", border: "1px solid #f87171", borderRadius: 8, padding: "12px 16px", color: "#b91c1c", fontSize: "0.875rem" }}>
              {errorText}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            style={{ padding: "13px 24px", background: "#e30d25", color: "#fff", border: "none", borderRadius: 999, fontWeight: 700, fontSize: "0.95rem", cursor: submitting ? "default" : "pointer", opacity: submitting ? 0.7 : 1 }}
          >
            {submitting ? tr("Activation en cours…", "Activating…") : tr("Activer mon compte →", "Activate my account →")}
          </button>
        </form>
      </div>
    </div>
  );
}
