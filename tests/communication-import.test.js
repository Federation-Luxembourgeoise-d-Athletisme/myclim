import test from "node:test";
import assert from "node:assert/strict";

import {
  parseCalendarSheet,
  parseCommunicationPlan,
  parseMilestonesSheet,
  parseWeekendSheet,
  typeFromFormat,
} from "../src/app/communication/com-import.js";

const EVENT = { eventDate: "2027-01-17" };
const HEADER = ["MONTH", "WEEK", "DAY", "CONTENT PILLAR", "THEME", "FORMAT", "STATUS"];

test("calendar rows resolve week ranges, day numbers and weekdays", () => {
  const rows = [
    HEADER,
    ["PRE-EVENT"],
    ["October", "19-25th", "", "", "", "", "To Do"],
    ["", "21th", "Wed", "Awareness & info", "Announcement video", "Video", "To Do"],
    ["", "26-31th", "Mon", "Awareness & info", "Event Poster reveal", "Post/ carrousel", "To Do"],
    ["", "27th", "Thu", "Athletes & people", "Our 2026 Champions", "Carrousel", "To Do"],
    ["November", "9-15th", "", "Athletes & people", "2026 throwback", "Post", "Posted"],
    ["December", "30th-4th", "Mon", "Athletes & people", "Highlight of Meet and Greet", "Video", "To Do"],
    ["", "5", "Sat", "Awareness & info", "Business race", "Carrousel", "To Do"],
    ["", "24", "Thur", "history", "", "Post", "To Do"],
    [">Jan", "1", "Fri", "New Year", "Happy New Year", "Story", "To Do"],
  ];
  const items = parseCalendarSheet(rows, EVENT);
  const byTitle = Object.fromEntries(items.map((item) => [item.titre, item]));

  assert.equal(items.length, 8);
  assert.equal(byTitle["Announcement video"].date, "2026-10-21");
  assert.equal(byTitle["Announcement video"].type, "video");
  assert.equal(byTitle["Event Poster reveal"].date, "2026-10-26");
  // « 27th Thu » : le 27 octobre 2026 est un mardi, le jeudi de la semaine l'emporte.
  assert.equal(byTitle["Our 2026 Champions"].date, "2026-10-29");
  assert.equal(byTitle["Our 2026 Champions"].adjusted, true);
  assert.match(byTitle["Our 2026 Champions"].notes, /27th Thu/);
  // Semaine sans jour : le lundi, à confirmer.
  assert.equal(byTitle["2026 throwback"].date, "2026-11-09");
  assert.equal(byTitle["2026 throwback"].undated, true);
  assert.equal(byTitle["2026 throwback"].statut, "done");
  // « December | 30th-4th » commence le 30 novembre.
  assert.equal(byTitle["Highlight of Meet and Greet"].date, "2026-11-30");
  assert.equal(byTitle["Business race"].date, "2026-12-05");
  // Sans thème : le pilier sert de titre.
  assert.equal(byTitle.History.date, "2026-12-24");
  assert.equal(byTitle["Happy New Year"].date, "2027-01-01");
  assert.equal(byTitle["Happy New Year"].type, "story");
});

test("weekend rows are moved onto the next meeting and keep their times", () => {
  const rows = [
    ["DAY", "THEME", "FORMAT", "WHO", "Idea"],
    ["16", "Press Conference", "IG Story"],
    ["17", "13:30 Business Race Training with David", "IG Story + Footages for next year"],
    ["17", "Room tour of the Coque", "Reels", "", "We are in the Coque"],
    ["", "EVENT DAY"],
    ["BEFORE", "It's Meet Day", "IG Story"],
    ["", "14:00 Doors Opens", "IG Story"],
    ["AFTER", "One day in CMCM as a Volunteer", "Reels"],
  ];
  const items = parseWeekendSheet(rows, EVENT);
  assert.deepEqual(
    items.map((item) => [item.date, item.heure, item.titre]),
    [
      ["2027-01-15", null, "Press Conference"],
      ["2027-01-16", "13:30", "Business Race Training with David"],
      ["2027-01-16", null, "Room tour of the Coque"],
      ["2027-01-17", null, "It's Meet Day"],
      ["2027-01-17", "14:00", "Doors Opens"],
      ["2027-01-18", null, "One day in CMCM as a Volunteer"],
    ],
  );
  assert.match(items[2].notes, /Idea: We are in the Coque/);
});

test("milestones become to-do tasks due at the end of their month or around the meeting", () => {
  const rows = [
    ["MONTH", "PHASE", "TASKS", "STATUS"],
    ["October", "Foundations & Kickoff", "", ""],
    ["", "", "Finalize communications plan.", "TRUE"],
    ["15th", "", "Launch “Save the Date” teaser.", "TRUE"],
    ["December", "Ticketing & Engagement Push", "", ""],
    ["", "", "Finalize signage with d’Coque.", "FALSE"],
    ["", "Event day", "", ""],
    ["", "", "Live coverage on all channels.", "FALSE"],
  ];
  const tasks = parseMilestonesSheet(rows, EVENT);
  assert.deepEqual(
    tasks.map((task) => [task.echeance, task.titre, task.statut]),
    [
      ["2026-10-31", "Finalize communications plan", "todo"],
      ["2026-10-15", "Launch “Save the Date” teaser", "todo"],
      ["2026-12-31", "Finalize signage with Coque", "todo"],
      ["2027-01-17", "Live coverage on all channels", "todo"],
    ],
  );
});

test("the whole plan skips weekend ideas already in the calendar", () => {
  const sheets = {
    "UPDATED CALENDAR 27": [HEADER, ["January", "15", "Friday", "Conference", "Press Conference", "Photos", "To Do"]],
    "Content Calendar Fri-Sun": [["DAY", "THEME"], ["16", "press conference", "IG Story"], ["17", "Training Stories", "IG Story"]],
  };
  const plan = parseCommunicationPlan(sheets, EVENT);
  assert.deepEqual(
    plan.publications.map((item) => item.titre),
    ["Press Conference", "Training Stories"],
  );
  assert.deepEqual(plan.missingSheets, ["Milestones"]);
  assert.equal(new Set(plan.publications.map((item) => item.importId)).size, 2);
});

test("formats map to publication types", () => {
  assert.equal(typeFromFormat("Post/ carrousel, Story"), "post");
  assert.equal(typeFromFormat("Story + Reels"), "video");
  assert.equal(typeFromFormat("IG Story"), "story");
  assert.equal(typeFromFormat("Live"), "video");
  assert.equal(typeFromFormat(""), "post");
});
