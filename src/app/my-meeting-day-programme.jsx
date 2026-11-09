import { useMemo } from "react";
import { useTeamConfiguration } from "./config-hooks";
import { useSiteEditionYear } from "./edition";
import { useLanguage } from "./language-context";
import { useSundayProgramme } from "./meeting-day-programme-hooks";
import { buildProgrammeColumns, getCategory, getVolunteerColumns, getVolunteerTimeline } from "./meeting-day-programme";

// Espace bénévole (Mes affectations) : le programme du dimanche de ses
// équipes + les activités générales, en lecture seule. Décision de Margot
// du 09/11/2026 : « seulement leur équipe et les trucs généraux ».
// assignments : [{ assignedRole, teamRole }] du bénévole connecté.
export function MyMeetingDayProgramme({ assignments = [] }) {
  const { t } = useLanguage();
  const { siteEditionYear } = useSiteEditionYear();
  const { roles } = useTeamConfiguration();
  const { programme, exists } = useSundayProgramme(siteEditionYear);

  const timeline = useMemo(() => {
    if (!programme || !assignments.length) return [];
    const teamNames = assignments.map((assignment) => assignment.assignedRole).filter(Boolean);
    const teamRoles = Object.fromEntries(assignments.map((assignment) => [assignment.assignedRole, assignment.teamRole]));
    const columns = getVolunteerColumns(buildProgrammeColumns(roles, programme), teamNames, teamRoles);
    return getVolunteerTimeline(programme.activities, columns);
  }, [assignments, programme, roles]);

  if (!siteEditionYear || !exists || !assignments.length) return null;

  return (
    <section className="mdp-team mdp-team--volunteer">
      <p className="mdp-team__eyebrow">{t("myProgrammeEyebrow")}</p>
      <h3>{t("myProgrammeTitle")}</h3>
      <p className="mdp-muted">{t("myProgrammeSubtitle")}</p>
      <div className="mdp-timeline">
        {timeline.length === 0 ? <p className="mdp-muted">{t("myProgrammeEmpty")}</p> : null}
        {timeline.map((activity) => {
          const category = getCategory(activity.category);
          return (
            <div key={activity.id} className="mdp-timeline__row">
              <span className="mdp-timeline__time">
                {activity.start} – {activity.end}
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
    </section>
  );
}
