import { useEffect, useMemo, useRef, useState } from "react";
import { saveOrganisationTeams, useOrganisationTeams } from "./organisation-hooks";
import { buildDefaultOrganisationTeams, memberDisplayName, normalizeMember } from "./organisation-teams";

// Équipes & affectations › Équipes organisation : le staff, la communication,
// les étudiants LUNEX, Apex, la TV… (décision de Margot du 09/11/2026 :
// dans Équipes, à côté des équipes bénévoles). Un membre = prénom + nom,
// et un e-mail s'il a un compte MyCLIM (il voit alors les tâches de son
// équipe dans le Rétroplanning).

const SAVE_DELAY_MS = 700;

function newId(prefix) {
  return `${prefix}-${globalThis.crypto?.randomUUID?.().slice(0, 8) || Math.random().toString(36).slice(2, 10)}`;
}

const EMPTY_MEMBER = { firstName: "", lastName: "", email: "", phone: "" };

export function OrganisationTeamsPage() {
  const { teams: remoteTeams, exists, loading, error } = useOrganisationTeams(true);
  const [draft, setDraft] = useState(null);
  const [selectedId, setSelectedId] = useState("");
  const [newMember, setNewMember] = useState(EMPTY_MEMBER);
  const [saveState, setSaveState] = useState("");
  const saveTimer = useRef(null);
  const saveVersion = useRef(0);

  const teams = useMemo(() => draft || remoteTeams, [draft, remoteTeams]);
  const selected = teams.find((team) => team.id === selectedId) || teams[0] || null;

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
    updateTeam(selected.id, { members: [...selected.members, normalizeMember({ ...newMember, id: newId("m") })] });
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
                <th className="orgt-center">Chef</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {selected.members.length === 0 ? (
                <tr>
                  <td className="orgt-muted" colSpan={6}>
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

          <form className="orgt-add" onSubmit={addMember}>
            <input placeholder="Prénom" value={newMember.firstName} onChange={(event) => setNewMember({ ...newMember, firstName: event.target.value })} />
            <input placeholder="Nom" value={newMember.lastName} onChange={(event) => setNewMember({ ...newMember, lastName: event.target.value })} />
            <input
              placeholder="E-mail (facultatif)"
              type="email"
              value={newMember.email}
              onChange={(event) => setNewMember({ ...newMember, email: event.target.value })}
            />
            <button className="ath-btn ath-btn--primary" type="submit">
              Ajouter
            </button>
          </form>
          <p className="orgt-hint">
            Avec un e-mail de compte MyCLIM, le membre voit les tâches de son équipe dans le Rétroplanning et peut en changer
            le statut.
          </p>
        </div>
      ) : null}
    </section>
  );
}
