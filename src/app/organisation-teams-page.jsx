import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../context/auth-context";
import { getActiveRoles } from "./navigation";
import {
  grantMemberAccess,
  saveOrganisationTeams,
  searchUserAccounts,
  sendMemberInvitation,
  useMemberAccounts,
  useOrganisationTeams,
} from "./organisation-hooks";
import {
  ORGANISATION_ACCESS,
  buildDefaultOrganisationTeams,
  getAccessOption,
  getMemberAccountStatus,
  memberDisplayName,
  normalizeMember,
} from "./organisation-teams";

// Équipes & affectations › Équipes organisation : le staff, la communication,
// les étudiants LUNEX, Apex, la TV… (décision de Margot du 09/11/2026 :
// dans Équipes, à côté des équipes bénévoles). Un membre = prénom + nom,
// et un e-mail s'il a un compte MyCLIM (il voit alors les tâches de son
// équipe dans le Rétroplanning).
// Comptes (Margot, 12/11/2026) : chaque membre a un accès (pas de compte,
// Organisation, Staff FLA ou LUNEX Student) ; un admin peut lier un compte existant, lui
// donner le rôle qui va avec, ou envoyer un lien d'activation.

const SAVE_DELAY_MS = 700;

function newId(prefix) {
  return `${prefix}-${globalThis.crypto?.randomUUID?.().slice(0, 8) || Math.random().toString(36).slice(2, 10)}`;
}

const EMPTY_MEMBER = { firstName: "", lastName: "", email: "", phone: "", access: "" };

const STATUS_LABELS = {
  active: "Compte actif",
  "missing-role": "Compte sans cet accès",
  invited: "Lien envoyé",
  none: "Pas encore de compte",
  "no-access": "—",
};

// État du compte d'un membre, et l'action qui va avec (admin seulement).
function MemberAccountCell({ status, isAdmin, busy, onGrant, onSend }) {
  if (status === "no-email") return <span className="orgt-muted">E-mail manquant</span>;
  return (
    <>
      <span className={`orgt-status orgt-status--${status}`}>{STATUS_LABELS[status]}</span>
      {isAdmin && status === "missing-role" ? (
        <button className="ath-link" disabled={busy} type="button" onClick={onGrant}>
          Donner l'accès
        </button>
      ) : null}
      {isAdmin && (status === "none" || status === "invited") ? (
        <button className="ath-link" disabled={busy} type="button" onClick={onSend}>
          {status === "invited" ? "Renvoyer" : "Envoyer le lien"}
        </button>
      ) : null}
    </>
  );
}

export function OrganisationTeamsPage() {
  const { userProfile } = useAuth();
  const isAdmin = getActiveRoles(userProfile).includes("admin");
  const { teams: remoteTeams, exists, loading, error } = useOrganisationTeams(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [busyMemberId, setBusyMemberId] = useState("");
  const [inviteResult, setInviteResult] = useState(null);
  const [accountSearch, setAccountSearch] = useState("");
  const [accountResults, setAccountResults] = useState([]);
  const [draft, setDraft] = useState(null);
  const [selectedId, setSelectedId] = useState("");
  const [newMember, setNewMember] = useState(EMPTY_MEMBER);
  const [saveState, setSaveState] = useState("");
  const saveTimer = useRef(null);
  const saveVersion = useRef(0);

  const teams = useMemo(() => draft || remoteTeams, [draft, remoteTeams]);
  const selected = teams.find((team) => team.id === selectedId) || teams[0] || null;
  const accounts = useMemberAccounts((selected?.members || []).map((member) => member.email), { canReadInvitations: isAdmin, refreshKey });
  // Sans choix : accès Organisation si un e-mail est saisi, LUNEX Student dans
  // l'équipe des étudiants LUNEX, sinon pas de compte.
  const newMemberAccess =
    newMember.access || (!newMember.email.trim() ? "none" : selected?.id === "lunex" ? "lunex" : "organisation");

  // Recherche d'un compte existant à lier (au moins 2 lettres).
  useEffect(() => {
    if (accountSearch.trim().length < 2) return undefined;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      searchUserAccounts(accountSearch)
        .then((users) => !cancelled && setAccountResults(users))
        .catch(() => !cancelled && setAccountResults([]));
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [accountSearch]);

  function statusOf(member) {
    return getMemberAccountStatus(member, {
      user: accounts.usersByEmail[member.email] || null,
      invitation: accounts.invitationsByEmail[member.email] || null,
    });
  }

  async function sendLink(member) {
    const option = getAccessOption(member.access);
    const warning = option.role === "gestionnaire" ? `\n\n${option.label} = gestionnaire : accès à toute la gestion sauf le budget.` : "";
    if (!window.confirm(`Envoyer un lien d'activation à ${memberDisplayName(member)} (${member.email}), accès « ${option.label} » ?${warning}`)) return;
    setBusyMemberId(member.id);
    try {
      const result = await sendMemberInvitation(member, accounts.invitationsByEmail[member.email]);
      setInviteResult({ ...result, name: memberDisplayName(member), email: member.email });
      setRefreshKey((value) => value + 1);
    } catch (sendError) {
      console.error(sendError);
      setInviteResult({ error: "L'invitation n'a pas pu être créée. Réessayez dans un instant.", name: memberDisplayName(member) });
    } finally {
      setBusyMemberId("");
    }
  }

  async function giveAccess(member) {
    const option = getAccessOption(member.access);
    const user = accounts.usersByEmail[member.email];
    const warning = option.role === "gestionnaire" ? ` ${option.label} = gestionnaire : accès à toute la gestion sauf le budget.` : "";
    if (!window.confirm(`Ajouter l'accès « ${option.label} » au compte de ${memberDisplayName(member)} ?${warning}`)) return;
    setBusyMemberId(member.id);
    try {
      await grantMemberAccess(user, member);
      setRefreshKey((value) => value + 1);
    } catch (grantError) {
      console.error(grantError);
      window.alert("Le rôle n'a pas pu être ajouté.");
    } finally {
      setBusyMemberId("");
    }
  }

  function linkAccount(user) {
    setNewMember({
      firstName: user.firstName || "",
      lastName: user.lastName || "",
      email: String(user.email).toLowerCase(),
      phone: user.phone || "",
      access: "",
    });
    setAccountSearch("");
    setAccountResults([]);
  }

  useEffect(() => () => window.clearTimeout(saveTimer.current), []);

  function update(mutator) {
    const next = mutator(structuredClone(teams));
    setDraft(next);
    setSaveState("Enregistrement…");
    saveVersion.current += 1;
    const version = saveVersion.current;
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(async () => {
      try {
        await saveOrganisationTeams(next);
        if (version !== saveVersion.current) return;
        setSaveState("Enregistré");
        setDraft(null);
      } catch (saveError) {
        console.error("Impossible d'enregistrer les équipes de l'organisation.", saveError);
        setSaveState("L'enregistrement a échoué. Réessayez dans un instant.");
      }
    }, SAVE_DELAY_MS);
  }

  function updateTeam(teamId, patch) {
    update((current) => current.map((team) => (team.id === teamId ? { ...team, ...patch } : team)));
  }

  function updateMember(memberId, patch) {
    updateTeam(selected.id, {
      members: selected.members.map((member) => (member.id === memberId ? { ...member, ...patch } : member)),
    });
  }

  function addTeam() {
    const id = newId("org");
    update((current) => [...current, { id, name: "Nouvelle équipe", description: "", members: [] }]);
    setSelectedId(id);
  }

  function addMember(event) {
    event.preventDefault();
    if (!newMember.firstName.trim() && !newMember.lastName.trim()) return;
    updateTeam(selected.id, { members: [...selected.members, normalizeMember({ ...newMember, access: newMemberAccess, id: newId("m") })] });
    setNewMember(EMPTY_MEMBER);
  }

  if (loading) return <p className="mdp-status">Chargement des équipes de l'organisation…</p>;
  if (error) return <p className="mdp-status mdp-status--error">{error}</p>;

  if (!exists && !draft) {
    return (
      <section className="mdp-empty">
        <h3>Équipes de l'organisation</h3>
        <p>
          Le staff, la communication, les étudiants LUNEX, Apex, la TV, les juges… Elles servent de colonnes au Planning et
          de périmètre au Rétroplanning. Partez des équipes de l'an dernier (fichier « Task and Organisation »), puis
          ajoutez les membres.
        </p>
        <div className="mdp-empty__actions">
          <button className="button button--primary" type="button" onClick={() => update(() => buildDefaultOrganisationTeams())}>
            Créer les équipes de l'an dernier
          </button>
          <button className="button button--secondary" type="button" onClick={addTeam}>
            Commencer vide
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="orgt">
      <div className="orgt-list">
        <div className="orgt-list__head">
          <strong>{teams.length} équipes</strong>
          <span className="mdp-bar__save">{saveState}</span>
          <button className="ath-btn" type="button" onClick={addTeam}>
            + Équipe
          </button>
        </div>
        <table className="data-table data-table--sheet orgt-table">
          <thead>
            <tr>
              <th>Équipe</th>
              <th className="orgt-num">Membres</th>
              <th>Chef(s)</th>
            </tr>
          </thead>
          <tbody>
            {teams.map((team) => {
              const leads = team.members.filter((member) => member.lead).map(memberDisplayName);
              return (
                <tr
                  key={team.id}
                  className={team.id === selected?.id ? "orgt-row--active" : ""}
                  onClick={() => setSelectedId(team.id)}
                >
                  <td className="orgt-name">{team.name}</td>
                  <td className="orgt-num">{team.members.length}</td>
                  <td className={leads.length ? "" : "orgt-muted"}>{leads.join(", ") || "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {selected ? (
        <div className="orgt-detail">
          <div className="orgt-detail__form">
            <label className="mdp-field">
              <span>Nom de l'équipe</span>
              <input value={selected.name} onChange={(event) => updateTeam(selected.id, { name: event.target.value })} />
            </label>
            <label className="mdp-field orgt-detail__desc">
              <span>Rôle / description</span>
              <input
                placeholder="ex. installation de la Coque, intercoms…"
                value={selected.description}
                onChange={(event) => updateTeam(selected.id, { description: event.target.value })}
              />
            </label>
            <button
              className="ath-link ath-link--danger orgt-detail__delete"
              type="button"
              onClick={() => {
                if (!window.confirm(`Supprimer l'équipe « ${selected.name} » ? Ses colonnes du Planning et son périmètre dans le Rétroplanning ne seront plus affichés.`)) return;
                update((current) => current.filter((team) => team.id !== selected.id));
                setSelectedId("");
              }}
            >
              Supprimer l'équipe
            </button>
          </div>

          <table className="data-table data-table--sheet orgt-members">
            <thead>
              <tr>
                <th>Prénom</th>
                <th>Nom</th>
                <th>E-mail (compte MyCLIM)</th>
                <th>Téléphone</th>
                <th>Accès</th>
                <th>Compte</th>
                <th className="orgt-center">Chef</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {selected.members.length === 0 ? (
                <tr>
                  <td className="orgt-muted" colSpan={8}>
                    Aucun membre. Ajoutez-les ci-dessous ; l'e-mail est facultatif.
                  </td>
                </tr>
              ) : null}
              {selected.members.map((member) => (
                <tr key={member.id}>
                  <td>
                    <input className="orgt-input" value={member.firstName} onChange={(event) => updateMember(member.id, { firstName: event.target.value })} />
                  </td>
                  <td>
                    <input className="orgt-input" value={member.lastName} onChange={(event) => updateMember(member.id, { lastName: event.target.value })} />
                  </td>
                  <td>
                    <input
                      className="orgt-input"
                      type="email"
                      value={member.email}
                      onChange={(event) => updateMember(member.id, { email: event.target.value.trim().toLowerCase() })}
                    />
                  </td>
                  <td>
                    <input className="orgt-input" value={member.phone} onChange={(event) => updateMember(member.id, { phone: event.target.value })} />
                  </td>
                  <td>
                    <select
                      aria-label="Accès"
                      className="orgt-input orgt-access"
                      value={member.access}
                      onChange={(event) => updateMember(member.id, { access: event.target.value })}
                    >
                      {ORGANISATION_ACCESS.map((option) => (
                        <option key={option.value} title={option.help || ""} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="orgt-account">
                    <MemberAccountCell
                      busy={busyMemberId === member.id}
                      isAdmin={isAdmin}
                      status={member.access === "none" ? "no-access" : !member.email ? "no-email" : statusOf(member)}
                      onGrant={() => giveAccess(member)}
                      onSend={() => sendLink(member)}
                    />
                  </td>
                  <td className="orgt-center">
                    <input
                      aria-label="Chef d'équipe"
                      checked={member.lead}
                      type="checkbox"
                      onChange={(event) => updateMember(member.id, { lead: event.target.checked })}
                    />
                  </td>
                  <td className="orgt-center">
                    <button
                      aria-label={`Retirer ${memberDisplayName(member)}`}
                      className="ath-icon-btn ath-icon-btn--danger"
                      title="Retirer de l'équipe"
                      type="button"
                      onClick={() => updateTeam(selected.id, { members: selected.members.filter((item) => item.id !== member.id) })}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {inviteResult ? (
            <div className={`orgt-invite${inviteResult.error || !inviteResult.mailSent ? " orgt-invite--warn" : ""}`}>
              {inviteResult.error ? (
                <span>{inviteResult.error}</span>
              ) : (
                <>
                  <span>
                    {inviteResult.mailSent
                      ? `Lien d'activation envoyé à ${inviteResult.email}.`
                      : `Invitation créée pour ${inviteResult.name}, mais l'e-mail n'est pas parti : partagez ce lien.`}{" "}
                    Valable 7 jours.
                  </span>
                  <code>{inviteResult.activationUrl}</code>
                  <button className="ath-btn" type="button" onClick={() => navigator.clipboard?.writeText(inviteResult.activationUrl)}>
                    Copier le lien
                  </button>
                </>
              )}
              <button aria-label="Fermer" className="ath-icon-btn" type="button" onClick={() => setInviteResult(null)}>
                ✕
              </button>
            </div>
          ) : null}

          <div className="orgt-link">
            <input
              placeholder="Lier un compte existant : nom ou e-mail…"
              value={accountSearch}
              onChange={(event) => {
                setAccountSearch(event.target.value);
                if (event.target.value.trim().length < 2) setAccountResults([]);
              }}
            />
            {accountResults.length ? (
              <ul className="orgt-link__results">
                {accountResults.map((user) => (
                  <li key={user.id}>
                    <button type="button" onClick={() => linkAccount(user)}>
                      <strong>{[user.firstName, user.lastName].filter(Boolean).join(" ") || user.email}</strong>
                      <span>{user.email}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <form className="orgt-add" onSubmit={addMember}>
            <input placeholder="Prénom" value={newMember.firstName} onChange={(event) => setNewMember({ ...newMember, firstName: event.target.value })} />
            <input placeholder="Nom" value={newMember.lastName} onChange={(event) => setNewMember({ ...newMember, lastName: event.target.value })} />
            <input
              placeholder="E-mail (facultatif)"
              type="email"
              value={newMember.email}
              onChange={(event) => setNewMember({ ...newMember, email: event.target.value })}
            />
            <select
              aria-label="Accès du nouveau membre"
              value={newMemberAccess}
              onChange={(event) => setNewMember({ ...newMember, access: event.target.value })}
            >
              {ORGANISATION_ACCESS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <button className="ath-btn ath-btn--primary" type="submit">
              Ajouter
            </button>
          </form>
          <p className="orgt-hint">
            Accès <strong>Organisation</strong> : le membre voit son planning, les tâches de son équipe dans le Rétroplanning
            (et peut en changer le statut) et ses décomptes. <strong>Staff FLA</strong> et <strong>LUNEX Student</strong> : rôle gestionnaire, toute la gestion
            sauf le budget.{" "}
            {isAdmin ? "« Envoyer le lien » crée son compte avec ces droits." : "Seul un admin peut envoyer les liens d'activation."}
          </p>
        </div>
      ) : null}
    </section>
  );
}
