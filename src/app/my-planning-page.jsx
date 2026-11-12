import { useMemo, useState } from "react";
import { useAuth } from "../context/auth-context";
import { useSiteEditionYear } from "./edition";
import { useMeetingEditions } from "./meeting-history-hooks";
import { useAllDayProgrammes } from "./meeting-day-programme-hooks";
import { PLANNING_DAYS, getCategory, getOrganisationTimeline, getPlanningDayDate } from "./meeting-day-programme";
import { useMyOrganisationTeams } from "./organisation-hooks";
import { useLanguage } from "./language-context";
import { useTr } from "./use-tr";

const DAY_LABEL_EN = {
  "mon-before": "Monday",
  "tue-before": "Tuesday",
  "wed-before": "Wednesday",
  "thu-before": "Thursday",
  friday: "Friday",
  saturday: "Saturday",
  sunday: "Sunday · meeting",
  "mon-after": "Monday (after)",
};

// Mon espace › Mon planning : pour un membre d'une équipe de l'organisation
// (staff, étudiants LUNEX — qui sont gestionnaires —, Apex…), les activités de
// ses équipes jour par jour, de la CLIM Week au lundi après le meeting, plus
// le Général ces jours-là. Lecture seule ; le Planning complet reste dans
// Équipes & affectations.

function formatDay(day, date, language) {
  const label = language === "fr" ? (day.key === "sunday" ? "Dimanche · meeting" : day.label) : DAY_LABEL_EN[day.key] || day.label;
  const locale = language === "fr" ? "fr-FR" : "en-GB";
  return date ? `${label} ${date.toLocaleDateString(locale, { day: "numeric", month: "long" })}` : label;
}

export function MyPlanningPage() {
  const { currentUser } = useAuth();
  const tr = useTr();
  const { language } = useLanguage();
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

  if (teamsLoading || yearLoading) return <p className="mdp-status">{tr("Chargement de votre planning…", "Loading your schedule…")}</p>;

  if (!myTeams.length) {
    return (
      <section className="mdp-empty">
        <h3>{tr("Mon planning", "My schedule")}</h3>
        <p>
          {tr(
            `Vous ne faites partie d'aucune équipe de l'organisation. Demandez à un organisateur de vous ajouter (avec cet e-mail : ${currentUser?.email}) dans Équipes & affectations › Équipes organisation.`,
            `You are not in any organisation team yet. Ask an organiser to add you (with this e-mail: ${currentUser?.email}).`,
          )}
        </p>
      </section>
    );
  }

  return (
    <section className="myp">
      <div className="myp-head">
        <p className="mdp-team__eyebrow">CLIM Week {year}</p>
        <h2>{tr("Mon planning", "My schedule")}</h2>
        <p className="mdp-muted">
          {myTeams.length > 1
            ? tr("Les activités de vos équipes, plus les moments pour tout le monde (bordure pointillée). Lecture seule.", "Your teams' activities, plus the moments for everyone (dotted border). Read only.")
            : tr("Les activités de votre équipe, plus les moments pour tout le monde (bordure pointillée). Lecture seule.", "Your team's activities, plus the moments for everyone (dotted border). Read only.")}
        </p>
        {myTeams.length > 1 ? (
          <div className="mdp-seg myp-teams">
            <button className={!teamFilter ? "is-on" : ""} type="button" onClick={() => setTeamFilter("")}>
              {tr("Toutes mes équipes", "All my teams")}
            </button>
            {myTeams.map((team) => (
              <button key={team.id} className={teamFilter === team.id ? "is-on" : ""} type="button" onClick={() => setTeamFilter(team.id)}>
                {team.name}
              </button>
            ))}
          </div>
        ) : (
          <p className="myp-team">
            {tr("Équipe", "Team")} : <strong>{myTeams[0].name}</strong>
            {myTeams[0].lead ? tr(" · chef d'équipe", " · team leader") : ""}
          </p>
        )}
      </div>

      {days.length === 0 ? (
        <p className="mdp-muted">
          {myTeams.length > 1
            ? tr("Rien n'est encore planifié pour vos équipes.", "Nothing is planned for your teams yet.")
            : tr("Rien n'est encore planifié pour votre équipe.", "Nothing is planned for your team yet.")}
        </p>
      ) : null}

      {days.map(({ day, date, timeline }) => (
        <div key={day.key} className={`myp-day${day.key === "sunday" ? " myp-day--meeting" : ""}`}>
          <h3>{formatDay(day, date, language)}</h3>
          <div className="mdp-timeline">
            {timeline.map((activity) => {
              const category = getCategory(activity.category);
              return (
                <div key={activity.id} className="mdp-timeline__row">
                  <span className="mdp-timeline__time">{activity.allDay ? tr("Journée", "All day") : `${activity.start} – ${activity.end}`}</span>
                  <div
                    className={`mdp-timeline__body${activity.general ? " mdp-timeline__body--general" : ""}`}
                    style={{ background: category.background, borderLeftColor: category.border }}
                  >
                    <strong>
                      {activity.title}
                      {activity.general ? <span className="mdp-muted">{tr(" · tout le monde", " · everyone")}</span> : null}
                      {!activity.general && myTeams.length > 1 && !teamFilter ? (
                        <span className="mdp-muted"> · {activity.teams.join(", ")}</span>
                      ) : null}
                    </strong>
                    {[activity.people, activity.place, activity.owner, activity.note].some(Boolean) ? (
                      <span>
                        {[activity.people, activity.place, activity.owner && tr(`Resp. ${activity.owner}`, `Lead: ${activity.owner}`), activity.note].filter(Boolean).join(" · ")}
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
