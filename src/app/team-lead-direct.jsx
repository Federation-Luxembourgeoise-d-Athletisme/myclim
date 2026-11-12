import { useState } from "react";
import { addDoc, collection, doc, getDocs, limit, query, serverTimestamp, setDoc, where } from "firebase/firestore";
import { db } from "../services/firebase";
import { getAppBaseUrl } from "../services/app-url";

// Chef d'équipe nommé directement (Margot, 12/11/2026 : « Jane Doe sera
// cheffe de la VIP team, je sais où elle va, pourquoi lui faire remplir le
// formulaire bénévole ? »). On crée sa fiche bénévole déjà affectée comme
// « Chef d'équipe » ; si la personne a déjà un compte, la fiche y est reliée et le
// rôle chef_equipe suit l'affectation ; sinon un admin lui envoie un lien
// d'activation (rôles benevole + chef_equipe) qui relie la fiche à son compte.

const LEAD_ROLE = "Chef d'équipe";

async function findActiveUserByEmail(email) {
  const snapshot = await getDocs(query(collection(db, "users"), where("email", "==", email), limit(5)));
  const entry = snapshot.docs.find((item) => {
    const data = item.data();
    return data.accountStatus !== "disabled" && (!data.uid || data.uid === item.id);
  });
  return entry ? { id: entry.id, ...entry.data() } : null;
}

async function createDirectTeamLead({ firstName, lastName, email, teamName, editionId, canInvite }, sync) {
  const normalizedEmail = email.trim().toLowerCase();
  const user = await findActiveUserByEmail(normalizedEmail);
  const existing = await getDocs(query(collection(db, "volunteerApplications"), where("email", "==", normalizedEmail), limit(5)));
  if (existing.docs.some((entry) => String(entry.data().editionId || "") === String(editionId || ""))) {
    throw new Error("already-applied");
  }
  const application = {
    editionId,
    uid: user?.id || "",
    firstName: firstName.trim(),
    lastName: lastName.trim(),
    email: normalizedEmail,
    phone: "",
    languages: [],
    availability: [],
    assignedRole: teamName,
    assignedRoles: [teamName],
    teamRole: LEAD_ROLE,
    teamRoleAssignments: { [teamName]: LEAD_ROLE },
    assignmentStatus: "Confirmé",
    workflowStatus: "Affecté",
    directTeamLead: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  const created = await addDoc(collection(db, "volunteerApplications"), application);
  const volunteer = { ...application, id: created.id };
  await Promise.all([sync.teams(volunteer), user ? sync.profile(volunteer) : Promise.resolve()]);
  if (user) return { linked: true };
  if (!canInvite) return { linked: false, invited: false };

  const token = crypto.randomUUID();
  await setDoc(doc(db, "invitations", token), {
    email: normalizedEmail,
    firstName: application.firstName,
    lastName: application.lastName,
    roles: ["benevole", "chef_equipe"],
    roleLabels: [`Chef d'équipe · ${teamName}`],
    token,
    status: "pending",
    source: "directTeamLead",
    applicationId: created.id,
    leadTeam: teamName,
    createdAt: serverTimestamp(),
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  });
  const activationUrl = `${getAppBaseUrl()}/invite?token=${token}`;
  let mailSent = false;
  try {
    const { enqueueTransactionalMail, buildInvitationMail } = await import("../services/mailQueue");
    await enqueueTransactionalMail(
      buildInvitationMail({ email: normalizedEmail, firstName: application.firstName, roles: [`Chef d'équipe · ${teamName}`], activationUrl }),
    );
    mailSent = true;
  } catch (mailError) {
    console.error("Unable to send the team lead invitation", mailError);
  }
  return { linked: false, invited: true, activationUrl, mailSent };
}

const EMPTY = { firstName: "", lastName: "", email: "", teamName: "" };

export function DirectTeamLeadPanel({ teams, editionId, isAdmin, syncTeams, syncProfile, onClose }) {
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  async function submit(event) {
    event.preventDefault();
    if (!form.firstName.trim() || !form.lastName.trim() || !form.email.trim() || !form.teamName) {
      setResult({ tone: "error", text: "Prénom, nom, e-mail et équipe sont nécessaires." });
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      const outcome = await createDirectTeamLead(
        { ...form, editionId, canInvite: isAdmin },
        { teams: syncTeams, profile: syncProfile },
      );
      const who = `${form.firstName.trim()} ${form.lastName.trim()}`;
      if (outcome.linked) {
        setResult({ tone: "success", text: `${who} a déjà un compte : chef d'équipe de ${form.teamName}, avec accès à « Mon équipe ».` });
      } else if (outcome.invited) {
        setResult({
          tone: outcome.mailSent ? "success" : "warning",
          text: outcome.mailSent
            ? `${who} : chef d'équipe de ${form.teamName}. Lien d'activation envoyé à ${form.email.trim().toLowerCase()} (valable 7 jours).`
              : `${who} : chef d'équipe de ${form.teamName}, mais l'e-mail n'est pas parti : partagez ce lien.`,
          link: outcome.activationUrl,
        });
      } else {
        setResult({ tone: "warning", text: `${who} : chef d'équipe de ${form.teamName}. Un admin doit lui envoyer le lien d'activation (Utilisateurs & rôles › Inviter).` });
      }
      setForm(EMPTY);
    } catch (createError) {
      console.error(createError);
      setResult({
        tone: "error",
        text:
          createError.message === "already-applied"
            ? "Cette personne a déjà une fiche bénévole cette année : affectez-la comme « Chef d'équipe » dans la liste ci-dessous."
            : "La fiche n'a pas pu être créée. Réessayez dans un instant.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="assign-lead" onSubmit={submit}>
      <div className="assign-lead__head">
        <strong>Chef d'équipe sans candidature</strong>
        <span>Sa fiche bénévole est créée déjà affectée : pas de formulaire à remplir.</span>
        <button aria-label="Fermer" className="assign-lead__close" type="button" onClick={onClose}>
          ✕
        </button>
      </div>
      <div className="assign-lead__fields">
        <input aria-label="Prénom" placeholder="Prénom" value={form.firstName} onChange={(event) => setForm({ ...form, firstName: event.target.value })} />
        <input aria-label="Nom" placeholder="Nom" value={form.lastName} onChange={(event) => setForm({ ...form, lastName: event.target.value })} />
        <input aria-label="E-mail" placeholder="E-mail" type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
        <select aria-label="Équipe" value={form.teamName} onChange={(event) => setForm({ ...form, teamName: event.target.value })}>
          <option value="">Équipe…</option>
          {teams.map((team) => (
            <option key={team.id} value={team.roleName}>
              {team.roleName}
            </option>
          ))}
        </select>
        <button className="button button--primary" disabled={busy} type="submit">
          {busy ? "Création…" : isAdmin ? "Créer et envoyer le lien" : "Créer la fiche"}
        </button>
      </div>
      {result ? (
        <p className={`assign-status assign-status--${result.tone}`}>
          {result.text}
          {result.link ? (
            <>
              {" "}
              <code className="assign-lead__link">{result.link}</code>{" "}
              <button className="button button--secondary" type="button" onClick={() => navigator.clipboard?.writeText(result.link)}>
                Copier
              </button>
            </>
          ) : null}
        </p>
      ) : null}
    </form>
  );
}
