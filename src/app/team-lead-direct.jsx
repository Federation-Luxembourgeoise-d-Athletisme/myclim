import { useEffect, useState } from "react";
import { searchUserAccounts } from "./organisation-hooks";
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
  // Compte MyCLIM déjà existant pour l'e-mail saisi : on le relie, sans lien.
  const [account, setAccount] = useState({ email: "", user: null });
  const [search, setSearch] = useState("");
  const [matches, setMatches] = useState([]);
  const typedEmail = form.email.trim().toLowerCase();
  const existingUser = account.email === typedEmail ? account.user : null;
  const checking = /^\S+@\S+\.\S+$/.test(typedEmail) && account.email !== typedEmail;

  useEffect(() => {
    if (!/^\S+@\S+\.\S+$/.test(typedEmail)) return undefined;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      findActiveUserByEmail(typedEmail)
        .then((user) => !cancelled && setAccount({ email: typedEmail, user }))
        .catch(() => !cancelled && setAccount({ email: typedEmail, user: null }));
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [typedEmail]);

  useEffect(() => {
    if (search.trim().length < 2) return undefined;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      searchUserAccounts(search)
        .then((users) => !cancelled && setMatches(users))
        .catch(() => !cancelled && setMatches([]));
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [search]);

  function pickAccount(user) {
    const email = String(user.email || "").toLowerCase();
    setForm({ ...form, firstName: user.firstName || "", lastName: user.lastName || "", email });
    setAccount({ email, user });
    setSearch("");
    setMatches([]);
  }

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
        setResult({ tone: "success", text: `${who} est maintenant chef d'équipe de ${form.teamName} (compte existant, aucun e-mail envoyé). « Mon équipe » est disponible à sa prochaine connexion.` });
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
      <div className="assign-lead__search">
        <input
          aria-label="Chercher un compte existant"
          placeholder="Déjà un compte MyCLIM ? Cherchez son nom ou son e-mail…"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            if (event.target.value.trim().length < 2) setMatches([]);
          }}
        />
        {matches.length ? (
          <ul className="assign-lead__results">
            {matches.map((user) => (
              <li key={user.id}>
                <button type="button" onClick={() => pickAccount(user)}>
                  <strong>{[user.firstName, user.lastName].filter(Boolean).join(" ") || user.email}</strong>
                  <span>{user.email}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
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
        <button className="button button--primary" disabled={busy || checking} type="submit">
          {busy ? "Enregistrement…" : existingUser ? "Nommer chef d'équipe" : isAdmin ? "Créer et envoyer le lien" : "Créer la fiche"}
        </button>
      </div>
      {typedEmail && !checking ? (
        <p className="assign-lead__hint">
          {existingUser
            ? `Compte existant (${[existingUser.firstName, existingUser.lastName].filter(Boolean).join(" ") || existingUser.email}) : la personne est nommée chef d'équipe directement, sans lien ni e-mail.`
            : isAdmin
              ? "Pas encore de compte avec cet e-mail : un lien d'activation lui sera envoyé."
              : "Pas encore de compte avec cet e-mail : un admin devra lui envoyer le lien d'activation."}
        </p>
      ) : null}
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
