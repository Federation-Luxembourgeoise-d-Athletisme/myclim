import { useEffect, useMemo, useState } from "react";
import { arrayUnion, doc, onSnapshot, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import { db } from "../services/firebase";
import { TEAM_CONFIGURATION_DOC_PATH, VOLUNTEER_ALERT_LOG_DOC_PATH } from "./seed-data";
import { defaultTeamRoles, getAvailableTeamRoles, normalizeTeamConfigurationPayload } from "./team-config";
import { mapVolunteerApplicationToAdminVolunteer } from "./volunteer-helpers";
import { useVolunteerApplicationsList } from "./volunteer-hooks";
import { useAuth } from "../context/auth-context";
import { useActiveEdition } from "./edition";
import { getActiveRoles } from "./navigation";
import { DirectTeamLeadPanel } from "./team-lead-direct";
import {
  buildAddTeamPatch,
  buildMemberRolePatch,
  buildRemoveTeamPatch,
  buildTeamBoard,
  getAssignedTeams,
  getMemberRole,
  getStatusAfterInform,
  needsInforming,
  suggestTeams,
} from "./volunteer-assignment-helpers";

// Équipes & affectations › Affectations : le seul endroit où l'on affecte,
// change la fonction, retire et informe les bénévoles (maquette
// design/affectations, validée par Margot le 09/11/2026). Bénévoles à placer
// à gauche (glisser-déposer ou liste), équipes et leurs besoins à droite.

const DRAG_TYPE = "text/x-myclim-volunteer";

function fullName(volunteer) {
  return `${volunteer.firstName} ${volunteer.lastName}`.trim() || volunteer.email || "Sans nom";
}

function isSundayConfirmed(volunteer) {
  return String(volunteer.sundayAvailability || "").startsWith("Oui");
}

// Même entrée que la vue Candidatures : l'onglet Alertes et les
// accréditations s'en servent quand un bénévole perd sa dernière équipe.
function buildRemovalAlert(volunteer, reason) {
  const now = new Date();
  return {
    id: `volunteer-alert-${volunteer.id}-${now.getTime()}`,
    volunteerId: volunteer.id,
    volunteerName: fullName(volunteer),
    volunteerEmail: volunteer.email || "",
    previousRoles: getAssignedTeams(volunteer),
    previousTeamRoleAssignments: volunteer.teamRoleAssignments || {},
    previousWorkflowStatus: volunteer.workflowStatus || "",
    alertType: "assignment_removed",
    reason,
    createdAt: now.toISOString(),
  };
}

function describeError(error) {
  return error?.message ? ` (${error.message})` : "";
}

export function VolunteerAssignmentsPage({
  loadMailQueueModule,
  syncVolunteerAssignmentToUserProfile,
  syncVolunteerAssignmentsToTeamConfiguration,
}) {
  const { applications, loading, error } = useVolunteerApplicationsList(true);
  const { userProfile } = useAuth();
  const isAdmin = getActiveRoles(userProfile).includes("admin");
  const { activeEditionId } = useActiveEdition(true);
  const [leadPanelOpen, setLeadPanelOpen] = useState(false);
  const [teams, setTeams] = useState(defaultTeamRoles);
  const [optimistic, setOptimistic] = useState({});
  const [search, setSearch] = useState("");
  const [preferenceFilter, setPreferenceFilter] = useState("");
  const [languageFilter, setLanguageFilter] = useState("");
  const [sundayOnly, setSundayOnly] = useState(false);
  const [incompleteOnly, setIncompleteOnly] = useState(false);
  const [dropTeam, setDropTeam] = useState("");
  const [status, setStatus] = useState(null);
  const [sending, setSending] = useState(false);

  useEffect(
    () =>
      onSnapshot(
        doc(db, ...TEAM_CONFIGURATION_DOC_PATH),
        (snapshot) =>
          setTeams(snapshot.exists() ? normalizeTeamConfigurationPayload(snapshot.data()).roles : defaultTeamRoles),
        () => setTeams(defaultTeamRoles),
      ),
    [],
  );

  // Les changements s'affichent tout de suite ; la liste Firestore les
  // confirme ensuite (l'état optimiste est alors abandonné).
  const volunteers = useMemo(
    () =>
      applications.map((application) => {
        const volunteer = mapVolunteerApplicationToAdminVolunteer(application);
        return optimistic[volunteer.id] ? { ...volunteer, ...optimistic[volunteer.id] } : volunteer;
      }),
    [applications, optimistic],
  );
  useEffect(() => {
    const timeoutId = window.setTimeout(() => setOptimistic({}), 0);
    return () => window.clearTimeout(timeoutId);
  }, [applications]);

  const board = useMemo(() => buildTeamBoard(teams, volunteers), [teams, volunteers]);
  const activeVolunteers = useMemo(() => volunteers.filter((volunteer) => volunteer.workflowStatus !== "Annulé"), [volunteers]);
  const toInform = useMemo(() => activeVolunteers.filter(needsInforming), [activeVolunteers]);
  const totals = useMemo(
    () =>
      board.reduce(
        (sum, entry) => ({
          needed: sum.needed + entry.needed,
          placed: sum.placed + Math.min(entry.placed, entry.needed || entry.placed),
          missing: sum.missing + entry.missing,
        }),
        { needed: 0, placed: 0, missing: 0 },
      ),
    [board],
  );

  const preferenceOptions = useMemo(
    () => [...new Set(activeVolunteers.flatMap((volunteer) => volunteer.missionPreferences))].sort((a, b) => a.localeCompare(b, "fr")),
    [activeVolunteers],
  );
  const languageOptions = useMemo(
    () => [...new Set(activeVolunteers.flatMap((volunteer) => volunteer.languages))].sort((a, b) => a.localeCompare(b, "fr")),
    [activeVolunteers],
  );

  const pool = useMemo(() => {
    const query = search.trim().toLowerCase();
    return activeVolunteers
      .filter((volunteer) => getAssignedTeams(volunteer).length === 0)
      .filter((volunteer) => !query || `${fullName(volunteer)} ${volunteer.email}`.toLowerCase().includes(query))
      .filter((volunteer) => !preferenceFilter || volunteer.missionPreferences.includes(preferenceFilter))
      .filter((volunteer) => !languageFilter || volunteer.languages.includes(languageFilter))
      .filter((volunteer) => !sundayOnly || isSundayConfirmed(volunteer))
      .sort((left, right) => `${left.lastName} ${left.firstName}`.localeCompare(`${right.lastName} ${right.firstName}`, "fr"));
  }, [activeVolunteers, languageFilter, preferenceFilter, search, sundayOnly]);

  const unassignedCount = activeVolunteers.filter((volunteer) => getAssignedTeams(volunteer).length === 0).length;
  const visibleBoard = incompleteOnly ? board.filter((entry) => entry.missing > 0 || entry.missingLead) : board;
  const sortedActive = useMemo(
    () =>
      [...activeVolunteers].sort(
        (left, right) =>
          Number(getAssignedTeams(left).length > 0) - Number(getAssignedTeams(right).length > 0) ||
          `${left.lastName} ${left.firstName}`.localeCompare(`${right.lastName} ${right.firstName}`, "fr"),
      ),
    [activeVolunteers],
  );

  async function persist(volunteer, patch, alertReason = "") {
    if (!patch) return;
    setOptimistic((current) => ({ ...current, [volunteer.id]: { ...current[volunteer.id], ...patch } }));
    try {
      if (alertReason) {
        await setDoc(
          doc(db, ...VOLUNTEER_ALERT_LOG_DOC_PATH),
          {
            entries: arrayUnion(buildRemovalAlert(volunteer, alertReason)),
            updatedAt: serverTimestamp(),
          },
          { merge: true },
        );
      }
      await updateDoc(doc(db, "volunteerApplications", volunteer.id), { ...patch, updatedAt: serverTimestamp() });
      const next = { ...volunteer, ...patch };
      await Promise.all([syncVolunteerAssignmentsToTeamConfiguration(next), syncVolunteerAssignmentToUserProfile(next)]);
      return true;
    } catch (persistError) {
      console.error("Impossible d'enregistrer l'affectation.", persistError);
      setOptimistic((current) => {
        const rest = { ...current };
        delete rest[volunteer.id];
        return rest;
      });
      setStatus({ tone: "error", text: `L'affectation de ${fullName(volunteer)} n'a pas pu être enregistrée${describeError(persistError)}.` });
      return false;
    }
  }

  function findVolunteer(id) {
    return volunteers.find((volunteer) => volunteer.id === id);
  }

  async function addToTeam(volunteerId, teamName) {
    const volunteer = findVolunteer(volunteerId);
    if (!volunteer || !teamName) return;
    const patch = buildAddTeamPatch(volunteer, teamName);
    if (!patch) return;
    setStatus(null);
    if (await persist(volunteer, patch)) {
      setStatus({ tone: "info", text: `${fullName(volunteer)} est affecté(e) à ${teamName}.` });
    }
  }

  async function removeFromTeam(volunteer, teamName) {
    const patch = buildRemoveTeamPatch(volunteer, teamName);
    if (!patch) return;
    setStatus(null);
    const lastTeam = patch.assignedRoles.length === 0;
    if (await persist(volunteer, patch, lastTeam ? `Retrait de l'équipe ${teamName}.` : "")) {
      setStatus({
        tone: "info",
        text: lastTeam
          ? `${fullName(volunteer)} est retiré(e) de ${teamName} et revient dans « À affecter ».`
          : `${fullName(volunteer)} est retiré(e) de ${teamName}.`,
      });
    }
  }

  function changeMemberRole(volunteer, teamName, memberRole) {
    setStatus(null);
    persist(volunteer, buildMemberRolePatch(volunteer, teamName, memberRole));
  }

  async function sendAssignmentMails() {
    if (!toInform.length) return;
    if (!window.confirm(`Envoyer l'e-mail d'affectation à ${toInform.length} bénévole(s) ?`)) return;
    setSending(true);
    setStatus(null);
    const failures = [];
    let sent = 0;
    try {
      const { buildVolunteerRoleAssignmentMail, enqueueTransactionalMail } = await loadMailQueueModule();
      for (const volunteer of toInform) {
        try {
          const teamsOfVolunteer = getAssignedTeams(volunteer);
          const [primaryTeam, ...otherTeams] = teamsOfVolunteer;
          const primaryRole = getMemberRole(volunteer, primaryTeam);
          if (volunteer.email) {
            await enqueueTransactionalMail(
              buildVolunteerRoleAssignmentMail({
                email: volunteer.email,
                firstName: volunteer.firstName,
                assignedRole: primaryTeam,
                teamRole: primaryRole,
                otherTeams: otherTeams.map((name) => ({ name, role: getMemberRole(volunteer, name) })),
              }),
            );
          }
          const ok = await persist(volunteer, {
            workflowStatus: getStatusAfterInform(volunteer),
            teamEmailSent: true,
            lastMailSentRole: primaryTeam,
            lastMailSentTeamRole: primaryRole,
            lastMailSentAt: serverTimestamp(),
          });
          if (ok) sent += 1;
          else failures.push(fullName(volunteer));
        } catch (mailError) {
          failures.push(`${fullName(volunteer)}${describeError(mailError)}`);
        }
      }
    } catch (moduleError) {
      failures.push(`module e-mail${describeError(moduleError)}`);
    }
    setSending(false);
    setStatus(
      failures.length
        ? { tone: "error", text: `${sent} e-mail(s) envoyé(s), ${failures.length} échec(s) : ${failures.join(", ")}.` }
        : { tone: "info", text: `${sent} e-mail(s) d'affectation envoyé(s). Ces bénévoles passent à « Informé ».` },
    );
  }

  function onDragStart(event, volunteerId) {
    event.dataTransfer.setData(DRAG_TYPE, volunteerId);
    event.dataTransfer.effectAllowed = "copyMove";
  }

  function teamDropProps(teamName) {
    return {
      onDragOver: (event) => {
        if (!event.dataTransfer.types.includes(DRAG_TYPE)) return;
        event.preventDefault();
        if (dropTeam !== teamName) setDropTeam(teamName);
      },
      onDragLeave: (event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setDropTeam("");
      },
      onDrop: (event) => {
        event.preventDefault();
        setDropTeam("");
        addToTeam(event.dataTransfer.getData(DRAG_TYPE), teamName);
      },
    };
  }

  if (loading) return <p className="assign-empty">Chargement des bénévoles…</p>;
  if (error) return <p className="assign-status assign-status--error">Impossible de charger les candidatures.</p>;

  return (
    <div className="assign">
      <div className="assign-bar">
        <span className="assign-kpi"><b>{totals.needed}</b> places</span>
        <span className="assign-kpi"><b>{totals.placed}</b> affectés</span>
        <span className="assign-kpi assign-kpi--warn"><b>{totals.missing}</b> manquants</span>
        <span className="assign-kpi assign-kpi--amber"><b>{toInform.length}</b> à informer</span>
        <button className="button button--secondary assign-bar__lead" type="button" onClick={() => setLeadPanelOpen((open) => !open)}>
          + Chef d'équipe sans candidature
        </button>
        <button
          className="button button--primary assign-bar__send"
          disabled={!toInform.length || sending}
          type="button"
          onClick={sendAssignmentMails}
        >
          {sending ? "Envoi…" : `Envoyer les e-mails d'affectation (${toInform.length})`}
        </button>
      </div>

      {leadPanelOpen ? (
        <DirectTeamLeadPanel
          editionId={activeEditionId}
          isAdmin={isAdmin}
          syncProfile={syncVolunteerAssignmentToUserProfile}
          syncTeams={syncVolunteerAssignmentsToTeamConfiguration}
          teams={teams}
          onClose={() => setLeadPanelOpen(false)}
        />
      ) : null}

      {status ? <p className={`assign-status assign-status--${status.tone}`}>{status.text}</p> : null}

      <div className="assign-board">
        <aside className="assign-pool">
          <h3>À affecter <span className="assign-count">{unassignedCount}</span></h3>
          <div className="assign-filters">
            <input placeholder="Rechercher un nom" type="search" value={search} onChange={(event) => setSearch(event.target.value)} />
            <select value={preferenceFilter} onChange={(event) => setPreferenceFilter(event.target.value)}>
              <option value="">Toutes les préférences</option>
              {preferenceOptions.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
            <select value={languageFilter} onChange={(event) => setLanguageFilter(event.target.value)}>
              <option value="">Toutes les langues</option>
              {languageOptions.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
            <label className="assign-check">
              <input checked={sundayOnly} type="checkbox" onChange={(event) => setSundayOnly(event.target.checked)} />
              Seulement les dispos le dimanche
            </label>
          </div>
          {pool.length ? null : <p className="assign-empty">Personne à affecter avec ces filtres.</p>}
          {pool.map((volunteer) => {
            const suggestions = suggestTeams(volunteer, board);
            return (
              <article key={volunteer.id} className="assign-person" draggable onDragStart={(event) => onDragStart(event, volunteer.id)}>
                <div className="assign-person__name">
                  <strong>{fullName(volunteer)}</strong>
                  {isSundayConfirmed(volunteer) ? null : <span className="status-pill status-pill--warn">Pas dispo dimanche</span>}
                </div>
                <p className="assign-person__meta">
                  {volunteer.languages.join(", ") || "Langues non renseignées"}
                  {volunteer.missionPreferences.length ? ` · préfère ${volunteer.missionPreferences.join(", ")}` : ""}
                </p>
                {suggestions.length ? (
                  <div className="assign-suggest">
                    {suggestions.map((suggestion) => (
                      <button
                        key={suggestion.teamName}
                        aria-label={`Affecter ${fullName(volunteer)} à ${suggestion.teamName}`}
                        className="assign-chip"
                        title={[suggestion.prefers ? "préférence" : "", suggestion.speaks ? "langues de l'équipe" : ""].filter(Boolean).join(" + ")}
                        type="button"
                        onClick={() => addToTeam(volunteer.id, suggestion.teamName)}
                      >
                        + {suggestion.teamName}
                      </button>
                    ))}
                  </div>
                ) : null}
                <select aria-label={`Affecter ${fullName(volunteer)}`} value="" onChange={(event) => addToTeam(volunteer.id, event.target.value)}>
                  <option value="">Affecter à…</option>
                  {board.map((entry) => (
                    <option key={entry.team.id} value={entry.team.roleName}>
                      {entry.team.roleName} {entry.missing ? `(manque ${entry.missing})` : "(complète)"}
                    </option>
                  ))}
                </select>
              </article>
            );
          })}
          <p className="assign-note">Glissez un bénévole sur une équipe, ou choisissez-la dans la liste. Un bénévole déjà affecté peut rejoindre une autre équipe depuis sa ligne (« + équipe »).</p>
        </aside>

        <section className="assign-teams">
          <h3>
            Équipes <span className="assign-count">{board.length}</span>
            <label className="assign-check assign-check--right">
              <input checked={incompleteOnly} type="checkbox" onChange={(event) => setIncompleteOnly(event.target.checked)} />
              Seulement les équipes incomplètes
            </label>
          </h3>
          <div className="assign-grid">
            {visibleBoard.map((entry) => {
              const { team } = entry;
              const memberRoles = getAvailableTeamRoles(team);
              const info = [team.shiftTime && `Horaire ${team.shiftTime}`, team.briefingTime && `briefing ${team.briefingTime}`, team.requiredLanguages.length && team.requiredLanguages.join(", ")]
                .filter(Boolean)
                .join(" · ");
              return (
                <article key={team.id} className={`assign-team${dropTeam === team.roleName ? " assign-team--drop" : ""}`} {...teamDropProps(team.roleName)}>
                  <div className="assign-team__head">
                    <strong>{team.roleName}</strong>
                    {entry.missingLead ? <span className="status-pill status-pill--danger">Chef manquant</span> : null}
                    <span className={`assign-team__need${entry.missing ? " assign-team__need--miss" : " assign-team__need--full"}`}>
                      {entry.placed}/{entry.needed}{entry.missing ? ` · manque ${entry.missing}` : ""}
                    </span>
                  </div>
                  <div className="assign-gauge"><i style={{ width: `${entry.needed ? Math.min(100, (entry.placed / entry.needed) * 100) : 100}%` }} /></div>
                  {info ? <p className="assign-team__info">{info}</p> : null}
                  {entry.members.length ? null : <p className="assign-empty">Personne pour l'instant.</p>}
                  {entry.members.map(({ volunteer, memberRole }) => {
                    const otherTeams = getAssignedTeams(volunteer).filter((name) => name !== team.roleName);
                    const addableTeams = board.filter((other) => !getAssignedTeams(volunteer).includes(other.team.roleName));
                    return (
                      <div key={volunteer.id} className="assign-member">
                        <span className="assign-member__name">
                          {fullName(volunteer)}
                          {otherTeams.length ? <small>aussi {otherTeams.join(", ")}</small> : null}
                        </span>
                        <select aria-label={`Fonction de ${fullName(volunteer)}`} value={memberRole} onChange={(event) => changeMemberRole(volunteer, team.roleName, event.target.value)}>
                          {[...new Set([...memberRoles, memberRole])].map((role) => <option key={role} value={role}>{role}</option>)}
                        </select>
                        <span className={`status-pill ${volunteer.teamEmailSent ? "status-pill--ok" : "status-pill--warn"}`}>
                          {volunteer.teamEmailSent ? "Informé" : "À informer"}
                        </span>
                        <select aria-label={`Autre équipe pour ${fullName(volunteer)}`} className="assign-member__more" value="" onChange={(event) => addToTeam(volunteer.id, event.target.value)}>
                          <option value="">+ équipe</option>
                          {addableTeams.map((other) => <option key={other.team.id} value={other.team.roleName}>{other.team.roleName}</option>)}
                        </select>
                        <button aria-label={`Retirer ${fullName(volunteer)} de ${team.roleName}`} className="assign-member__remove" title="Retirer de l'équipe" type="button" onClick={() => removeFromTeam(volunteer, team.roleName)}>
                          ×
                        </button>
                      </div>
                    );
                  })}
                  <select aria-label={`Ajouter à ${team.roleName}`} className="assign-team__add" value="" onChange={(event) => addToTeam(event.target.value, team.roleName)}>
                    <option value="">Ajouter un bénévole…</option>
                    {sortedActive
                      .filter((volunteer) => !getAssignedTeams(volunteer).includes(team.roleName))
                      .map((volunteer) => (
                        <option key={volunteer.id} value={volunteer.id}>
                          {fullName(volunteer)}{getAssignedTeams(volunteer).length ? ` (déjà ${getAssignedTeams(volunteer).join(", ")})` : ""}
                        </option>
                      ))}
                  </select>
                </article>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
