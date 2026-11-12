// Panneau « Personne sans candidature » (Affectations) : la création est
// dans direct-assignment.js.
import { useEffect, useState } from "react";
import { searchUserAccounts } from "./organisation-hooks";
import { LEAD_ROLE, MEMBER_ROLE, createDirectMember, findActiveUserByEmail } from "./direct-assignment";

const EMPTY = { firstName: "", lastName: "", email: "", teamName: "", memberRole: LEAD_ROLE };

function DirectTeamLeadPanel({ teams, editionId, isAdmin, syncTeams, syncProfile, onClose }) {
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
      const outcome = await createDirectMember(
        { ...form, editionId, canInvite: isAdmin },
        { teams: syncTeams, profile: syncProfile },
      );
      const who = `${form.firstName.trim()} ${form.lastName.trim()}`;
      if (outcome.linked) {
        setResult({
          tone: "success",
          text: `${who} : ${form.memberRole.toLowerCase()} de ${form.teamName} (compte existant, aucun e-mail envoyé).${form.memberRole === LEAD_ROLE ? " « Mon équipe » est disponible à sa prochaine connexion." : ""}`,
        });
      } else if (outcome.invited) {
        setResult({
          tone: outcome.mailSent ? "success" : "warning",
          text: outcome.mailSent
            ? `${who} : ${form.memberRole.toLowerCase()} de ${form.teamName}. Lien d'activation envoyé à ${form.email.trim().toLowerCase()} (valable 7 jours).`
              : `${who} : ${form.memberRole.toLowerCase()} de ${form.teamName}, mais l'e-mail n'est pas parti : partagez ce lien.`,
          link: outcome.activationUrl,
        });
      } else {
        setResult({ tone: "warning", text: `${who} : ${form.memberRole.toLowerCase()} de ${form.teamName}. Un admin doit lui envoyer le lien d'activation (Utilisateurs & rôles › Inviter).` });
      }
      setForm(EMPTY);
    } catch (createError) {
      console.error(createError);
      setResult({
        tone: "error",
        text:
          createError.message === "already-applied"
            ? "Cette personne a déjà une fiche bénévole cette année : ajoutez-la depuis la carte de l'équipe ci-dessous."
            : "La fiche n'a pas pu être créée. Réessayez dans un instant.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="assign-lead" onSubmit={submit}>
      <div className="assign-lead__head">
        <strong>Personne sans candidature</strong>
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
        <select aria-label="Fonction" value={form.memberRole} onChange={(event) => setForm({ ...form, memberRole: event.target.value })}>
          <option value={LEAD_ROLE}>Chef d'équipe</option>
          <option value={MEMBER_ROLE}>Bénévole</option>
        </select>
        <select aria-label="Équipe" value={form.teamName} onChange={(event) => setForm({ ...form, teamName: event.target.value })}>
          <option value="">Équipe…</option>
          {teams.map((team) => (
            <option key={team.id} value={team.roleName}>
              {team.roleName}
            </option>
          ))}
        </select>
        <button className="button button--primary" disabled={busy || checking} type="submit">
          {busy ? "Enregistrement…" : existingUser ? (form.memberRole === LEAD_ROLE ? "Nommer chef d'équipe" : "Affecter") : isAdmin ? "Créer et envoyer le lien" : "Créer la fiche"}
        </button>
      </div>
      {typedEmail && !checking ? (
        <p className="assign-lead__hint">
          {existingUser
            ? `Compte existant (${[existingUser.firstName, existingUser.lastName].filter(Boolean).join(" ") || existingUser.email}) : la personne est affectée directement, sans lien ni e-mail.`
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

export { DirectTeamLeadPanel };
