import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildProgrammeColumns,
  getOrganisationTimeline,
  getPlanningDayDate,
  importLegacyDay,
  normalizeProgramme,
  sortActivitiesForList,
} from "../src/app/meeting-day-programme.js";
import {
  buildDefaultOrganisationTeams,
  buildMembershipByEmail,
  findOrganisationTeam,
  getPerimeterEmails,
  normalizeOrganisationTeams,
} from "../src/app/organisation-teams.js";
import {
  daysFromMeeting,
  formatDMinus,
  groupTasksByMonth,
  importLegacyTasks,
  isTaskLate,
  summarizeTasks,
} from "../src/app/retroplanning.js";

const legacy = JSON.parse(readFileSync(new URL("../src/app/planning-2026-legacy.json", import.meta.url), "utf8"));
const volunteerTeams = [
  { id: "accueil", roleName: "Accueil & billetterie", subRoles: [] },
  { id: "callroom", roleName: "Call room", subRoles: [] },
];
const orgTeams = buildDefaultOrganisationTeams();

test("planning days are dated from the meeting Sunday", () => {
  assert.equal(getPlanningDayDate("2027-01-17", "friday").getDate(), 15);
  assert.equal(getPlanningDayDate("2027-01-17", "mon-before").getDate(), 11);
  assert.equal(getPlanningDayDate("2027-01-17", "mon-after").getDate(), 18);
  assert.equal(getPlanningDayDate("", "friday"), null);
});

test("an old Sunday document keeps its volunteer columns and shows no organisation column", () => {
  const programme = normalizeProgramme({ activities: [] }, "sunday");
  assert.equal(programme.mode, "grid");
  const kinds = buildProgrammeColumns(volunteerTeams, programme, orgTeams).map((column) => column.kind);
  assert.deepEqual(kinds, ["general", "team", "team"]);
  assert.equal(normalizeProgramme({}, "thu-before").mode, "list");
});

test("Saturday import maps Apex, TV and Officials to organisation teams and hides volunteer teams", () => {
  const programme = importLegacyDay("saturday", legacy, volunteerTeams, orgTeams, findOrganisationTeam);
  const columns = buildProgrammeColumns(volunteerTeams, programme, orgTeams);
  const names = columns.map((column) => column.name);
  assert.ok(names.includes("Apex"));
  assert.ok(names.includes("TV"));
  assert.ok(names.includes("Juges & officiels"));
  assert.ok(names.includes("Étudiants LUNEX"), "CLIM Week lines go to the LUNEX column");
  assert.ok(!names.includes("Accueil & billetterie"));
  assert.ok(programme.activities.some((activity) => activity.title === "Athlete Training Welcoming" && activity.people === "LUNEX (2)"));
});

test("CLIM Week lines without a time become all-day items, listed first", () => {
  const programme = importLegacyDay("sunday", { ...legacy, sunday: { columns: [], activities: [] } }, volunteerTeams, orgTeams, findOrganisationTeam);
  const entrance = programme.activities.find((activity) => activity.title === "Entrance");
  assert.equal(entrance.allDay, true);
  assert.equal(sortActivitiesForList(programme.activities)[0].allDay, true);
  const monday = importLegacyDay("mon-before", legacy, volunteerTeams, orgTeams, findOrganisationTeam);
  assert.equal(monday.mode, "list");
  assert.equal(monday.activities[0].title, "Accreditation printing");
  assert.equal(monday.activities[0].start, "10:00");
});

test("organisation teams match last year's names and give perimeter e-mails", () => {
  const teams = normalizeOrganisationTeams({
    teams: [
      { id: "lunex", name: "Étudiants LUNEX", members: [{ firstName: "Ana", lastName: "Silva", email: "Ana@Example.test" }] },
      { id: "communication", name: "Communication", members: [{ firstName: "Lou", lastName: "Weber" }] },
    ],
  });
  assert.equal(findOrganisationTeam(teams, "Master Lunex")?.id, "lunex");
  assert.equal(findOrganisationTeam(teams, "communication")?.id, "communication");
  assert.equal(findOrganisationTeam(teams, "Unknown"), null);
  assert.deepEqual(getPerimeterEmails(teams, ["lunex", "communication"]), ["ana@example.test"]);
});

test("tasks: D-minus, late flag, month groups and last year's import", () => {
  assert.equal(formatDMinus(daysFromMeeting("2026-11-17", "2027-01-17")), "J-61");
  assert.equal(formatDMinus(daysFromMeeting("2027-01-17", "2027-01-17")), "Jour J");
  assert.equal(formatDMinus(daysFromMeeting("2027-01-20", "2027-01-17")), "J+3");
  assert.equal(isTaskLate({ deadline: "2026-11-01", status: "todo" }, "2026-11-09"), true);
  assert.equal(isTaskLate({ deadline: "2026-11-01", status: "done" }, "2026-11-09"), false);
  const groups = groupTasksByMonth([
    { deadline: "2026-12-02", action: "b", status: "todo" },
    { deadline: "2026-11-20", action: "a", status: "todo" },
  ]);
  assert.deepEqual(groups.map((group) => group.label), ["Novembre 2026", "Décembre 2026"]);
  const rows = importLegacyTasks(legacy.tasks, { meetingDate: "2027-01-17", editionYear: 2027, orgTeams, findOrgTeam: findOrganisationTeam });
  assert.equal(rows.length, legacy.tasks.length);
  const poster = rows.find((row) => row.action.startsWith("Official Poster ready"));
  assert.equal(poster.deadline, "2026-09-29");
  assert.ok(rows.find((row) => row.action.startsWith("Contact Companies")).perimeter.includes("lunex"));
  assert.equal(summarizeTasks(rows, "2026-11-09").todo, rows.length);
  assert.deepEqual(importLegacyTasks(legacy.tasks, { meetingDate: "", editionYear: 2027 }), []);
});

test("an organisation member sees their team's activities plus general ones, only on days with their team", () => {
  const saturday = importLegacyDay("saturday", legacy, volunteerTeams, orgTeams, findOrganisationTeam);
  const timeline = getOrganisationTimeline(saturday.activities, [{ id: "lunex", name: "Étudiants LUNEX" }]);
  assert.ok(timeline.some((activity) => activity.title === "Athlete Training Welcoming" && activity.teams[0] === "Étudiants LUNEX"));
  assert.ok(timeline.every((activity) => activity.general || activity.teams.length));
  assert.deepEqual(getOrganisationTimeline(saturday.activities, [{ id: "durabilite", name: "Durabilité" }]), []);
});

test("membership by e-mail lists each member's teams once, with the lead flag", () => {
  const byEmail = buildMembershipByEmail(
    normalizeOrganisationTeams({
      teams: [
        {
          id: "lunex",
          name: "Étudiants LUNEX",
          members: [{ firstName: "Ana", lastName: "Silva", email: "Ana@x.test", lead: true }, { firstName: "Sans", lastName: "Mail" }],
        },
        { id: "communication", name: "Communication", members: [{ firstName: "Ana", lastName: "Silva", email: "ana@x.test" }] },
      ],
    }),
  );
  assert.deepEqual(Object.keys(byEmail), ["ana@x.test"]);
  assert.deepEqual(byEmail["ana@x.test"].map((team) => [team.id, team.lead]), [["lunex", true], ["communication", false]]);
});
