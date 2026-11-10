import { useMemo, useState } from "react";
import { useAuth } from "../context/auth-context";
import { useSiteEditionYear } from "./edition";
import { useMeetingEditions } from "./meeting-history-hooks";
import { useAllDayProgrammes } from "./meeting-day-programme-hooks";
import { PLANNING_DAYS, getCategory, getOrganisationTimeline, getPlanningDayDate } from "./meeting-day-programme";
import { useMyOrganisationTeams } from "./organisation-hooks";

// Mon espace › Mon planning : pour un membre d'une équipe de l'organisation
// (staff, étudiants LUNEX — qui sont gestionnaires —, Apex…), les activités de
// ses équipes jour par jour, de la CLIM Week au lundi après le meeting, plus
// le Général ces jours-là. Lecture seule ; le Planning complet reste dans
// Équipes & affectations.

function formatDay(day, date) {
  const label = day.key === "sunday" ? "Dimanche · meeting" : day.label;
  return date ? `${label} ${date.toLocaleDateString("fr-FR", { day: "numeric", month: "long" })}` : label;
}

export function MyPlanningPage() {
  const { currentUser } = useAuth();
  const { teams: myTeams, loading: teamsLoading } = useMyOrganisationTeams(currentUser?.email);
  const { siteEditionYear, loading: yearLoading } = useSiteEditionYear();
  const { editions } = useMeetingEditions();
  const year = siteEditionYear || editions[0]?.year || null;
  const edition = editions.find((item) => Number(item.year || item.id) === Number(year)) || null;
  const allDays = useAllDayProgrammes(year);
  const [teamFilter, setTeamFilter] = useState("");

  const shownTeams = useMemo(() => myTeams.filter((team) => !teamFilter || team.id === teamFilter), [myTeams, teamFilter]);
  const days = useMemo(
    () =>
      PLANNING_DAYS.map((day) => {
        const entry = allDays[day.key];
        if (!entry?.exists || !entry.programme) return null;
        const timeline = getOrganisationTimeline(entry.programme.activities, shownTeams);
        return timeline.length ? { day, date: getPlanningDayDate(edition?.date, day.key), timeline } : null;
      }).filter(Boolean),
    [allDays, shownTeams, edition],
  );

  if (teamsLoading || yearLoading) return <p className="mdp-status">Chargement de votre planning…</p>;

  if (!myTeams.length) {
    return (
      <section className="mdp-empty">
        <h3>Mon planning</h3>
        <p>
          Vous ne faites partie d'aucune équipe de l'organisation. Demandez à un organisateur de vous ajouter (avec cet
          e-mail : {currentUser?.email}) dans Équipes & affectations › Équipes organisation.
        </p>
      </section>
    );
  }

  return (
    <section className="myp">
      <div className="myp-head">
        <p className="mdp-team__eyebrow">CLIM Week {year}</p>
        <h2>Mon planning</h2>
        <p className="mdp-muted">
          Les activités de {myTeams.length > 1 ? "vos équipes" : "votre équipe"}, plus les moments pour tout le monde
          (bordure pointillée). Lecture seule.
        </p>
        {myTeams.length > 1 ? (
          <div className="mdp-seg myp-teams">
            <button className={!teamFilter ? "is-on" : ""} type="button" onClick={() => setTeamFilter("")}>
              Toutes mes équipes
            </button>
            {myTeams.map((team) => (
              <button key={team.id} className={teamFilter === team.id ? "is-on" : ""} type="button" onClick={() => setTeamFilter(team.id)}>
                {team.name}
              </button>
            ))}
          </div>
        ) : (
          <p className="myp-team">
            Équipe : <strong>{myTeams[0].name}</strong>
            {myTeams[0].lead ? " · chef d'équipe" : ""}
          </p>
        )}
      </div>

      {days.length === 0 ? <p className="mdp-muted">Rien n'est encore planifié pour {myTeams.length > 1 ? "vos équipes" : "votre équipe"}.</p> : null}

      {days.map(({ day, date, timeline }) => (
        <div key={day.key} className={`myp-day${day.key === "sunday" ? " myp-day--meeting" : ""}`}>
          <h3>{formatDay(day, date)}</h3>
          <div className="mdp-timeline">
            {timeline.map((activity) => {
              const category = getCategory(activity.category);
              return (
                <div key={activity.id} className="mdp-timeline__row">
                  <span className="mdp-timeline__time">{activity.allDay ? "Journée" : `${activity.start} – ${activity.end}`}</span>
                  <div
                    className={`mdp-timeline__body${activity.general ? " mdp-timeline__body--general" : ""}`}
                    style={{ background: category.background, borderLeftColor: category.border }}
                  >
                    <strong>
                      {activity.title}
                      {activity.general ? <span className="mdp-muted"> · tout le monde</span> : null}
                      {!activity.general && myTeams.length > 1 && !teamFilter ? (
                        <span className="mdp-muted"> · {activity.teams.join(", ")}</span>
                      ) : null}
                    </strong>
                    {[activity.people, activity.place, activity.owner, activity.note].some(Boolean) ? (
                      <span>
                        {[activity.people, activity.place, activity.owner && `Resp. ${activity.owner}`, activity.note].filter(Boolean).join(" · ")}
                      </span>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </section>
  );
}
