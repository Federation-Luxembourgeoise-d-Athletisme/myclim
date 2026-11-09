import { useMemo } from "react";
import { useTeamConfiguration } from "./config-hooks";
import { useSiteEditionYear } from "./edition";
import { useLanguage } from "./language-context";
import { useMeetingEditions } from "./meeting-history-hooks";
import { useAllDayProgrammes } from "./meeting-day-programme-hooks";
import { PLANNING_DAYS, buildProgrammeColumns, getCategory, getVolunteerColumns, getVolunteerTimeline } from "./meeting-day-programme";

const DAY_LABELS_EN = {
  "mon-before": "Monday",
  "tue-before": "Tuesday",
  "wed-before": "Wednesday",
  "thu-before": "Thursday",
  friday: "Friday",
  saturday: "Saturday",
  sunday: "Sunday · meeting day",
  "mon-after": "Monday (after)",
};

// Espace bénévole (Mes affectations) : le planning de ses équipes + les
// activités générales, en lecture seule. Décision de Margot du 09/11/2026 :
// « seulement leur équipe et les trucs généraux ». Le dimanche est toujours
// affiché ; un autre jour seulement si son équipe y a une activité.
// assignments : [{ assignedRole, teamRole }] du bénévole connecté.
export function MyMeetingDayProgramme({ assignments = [] }) {
  const { t, language } = useLanguage();
  const { siteEditionYear } = useSiteEditionYear();
  const { editions } = useMeetingEditions();
  // Même édition que la page Planning des organisateurs.
  const year = siteEditionYear || editions[0]?.year || null;
  const { roles } = useTeamConfiguration();
  const allDays = useAllDayProgrammes(year);

  const days = useMemo(() => {
    if (!assignments.length) return [];
    const teamNames = assignments.map((assignment) => assignment.assignedRole).filter(Boolean);
    const teamRoles = Object.fromEntries(assignments.map((assignment) => [assignment.assignedRole, assignment.teamRole]));
    return PLANNING_DAYS.map((day) => {
      const entry = allDays[day.key];
      if (!entry?.exists || !entry.programme) return null;
      const columns = getVolunteerColumns(buildProgrammeColumns(roles, entry.programme), teamNames, teamRoles);
      const timeline = getVolunteerTimeline(entry.programme.activities, columns);
      const hasTeamActivity = timeline.some((activity) => !activity.general);
      if (day.key !== "sunday" && !hasTeamActivity) return null;
      return { day, timeline };
    }).filter(Boolean);
  }, [allDays, assignments, roles]);

  if (!year || !assignments.length || !days.length) return null;

  return (
    <section className="mdp-team mdp-team--volunteer">
      <p className="mdp-team__eyebrow">{t("myProgrammeEyebrow")}</p>
      <h3>{t("myProgrammeTitle")}</h3>
      <p className="mdp-muted">{t("myProgrammeSubtitle")}</p>
      {days.map(({ day, timeline }) => (
        <div key={day.key} className="mdp-team__day">
          {days.length > 1 ? <h4>{language === "en" ? DAY_LABELS_EN[day.key] : day.label}</h4> : null}
          <div className="mdp-timeline">
            {timeline.length === 0 ? <p className="mdp-muted">{t("myProgrammeEmpty")}</p> : null}
            {timeline.map((activity) => {
              const category = getCategory(activity.category);
              return (
                <div key={activity.id} className="mdp-timeline__row">
                  <span className="mdp-timeline__time">
                    {activity.allDay ? t("myProgrammeAllDay") : `${activity.start} – ${activity.end}`}
                  </span>
                  <div
                    className={`mdp-timeline__body${activity.general ? " mdp-timeline__body--general" : ""}`}
                    style={{ background: category.background, borderLeftColor: category.border }}
                  >
                    <strong>
                      {activity.title}
                      {activity.general ? <span className="mdp-muted"> · {t("myProgrammeGeneral")}</span> : null}
                    </strong>
                    {[activity.place, activity.owner, activity.note].some(Boolean) ? (
                      <span>{[activity.place, activity.owner && `${t("myProgrammeOwner")} ${activity.owner}`, activity.note].filter(Boolean).join(" · ")}</span>
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
