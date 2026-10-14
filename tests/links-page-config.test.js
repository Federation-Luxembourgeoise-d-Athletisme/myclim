import test from "node:test";
import assert from "node:assert/strict";

import {
  getNowOnTrack,
  isLiveDay,
  normalizeLinksPage,
  parseTimeToMinutes,
  resolvePhotos,
} from "../src/site/links-page-config.js";

// 30 janvier 2027 à Luxembourg (UTC+1 en hiver).
const at = (hhmm) => new Date(`2027-01-30T${hhmm}:00+01:00`);
const timetable = [
  { type: "header", label: "PRE-PROGRAM" },
  { type: "event", time: "15:00", event: "60m" },
  { type: "event", time: "16:42", event: "60m Hurdles" },
  { type: "event", time: "16:50", event: "Pole Vault" },
  { type: "event", time: "17:05", event: "800m" },
  { type: "event", time: "?", event: "Ignored" },
];

test("normalizeLinksPage fills defaults and keeps stored values", () => {
  const settings = normalizeLinksPage({ liveMode: "on", blocks: { now: false }, photos: { currentUrl: " https://x " } });
  assert.equal(settings.liveMode, "on");
  assert.equal(settings.blocks.now, false);
  assert.equal(settings.blocks.results, true);
  assert.equal(settings.photos.currentUrl, "https://x");
  assert.match(settings.photos.previousUrl, /flaphoto\.net/);
  assert.equal(settings.social.instagram, "https://www.instagram.com/cmcm_lux_indoor_meet/");
  assert.equal(normalizeLinksPage({ liveMode: "bogus" }).liveMode, "auto");
});

test("normalizeLinksPage lets an admin clear a default link", () => {
  assert.equal(normalizeLinksPage({ tickets: { url: "" } }).tickets.url, "");
});

test("isLiveDay follows the edition date in Luxembourg time, unless forced", () => {
  const edition = { date: "2027-01-30T00:00:00+01:00" };
  assert.equal(isLiveDay({ liveMode: "auto" }, edition, at("23:30")), true);
  assert.equal(isLiveDay({ liveMode: "auto" }, edition, new Date("2027-01-31T00:30:00+01:00")), false);
  assert.equal(isLiveDay({ liveMode: "on" }, null, at("10:00")), true);
  assert.equal(isLiveDay({ liveMode: "off" }, edition, at("16:00")), false);
  assert.equal(isLiveDay({ liveMode: "auto" }, {}, at("16:00")), false);
});

test("parseTimeToMinutes accepts 16:42, 16h42 and rejects junk", () => {
  assert.equal(parseTimeToMinutes("16:42"), 1002);
  assert.equal(parseTimeToMinutes("9h05"), 545);
  assert.equal(parseTimeToMinutes("?"), null);
});

test("getNowOnTrack returns the running event and the next ones", () => {
  const before = getNowOnTrack(timetable, at("14:00"));
  assert.equal(before.current, null);
  assert.deepEqual(before.upcoming.map((entry) => entry.time), ["15:00", "16:42", "16:50"]);

  const during = getNowOnTrack(timetable, at("16:45"));
  assert.equal(during.current.event, "60m Hurdles");
  assert.deepEqual(during.upcoming.map((entry) => entry.event), ["Pole Vault", "800m"]);

  assert.equal(getNowOnTrack(timetable, at("19:00")).finished, true);
  assert.equal(getNowOnTrack([], at("16:00")).current, null);
});

test("resolvePhotos prefers this year's gallery with its credit", () => {
  assert.deepEqual(resolvePhotos({ currentUrl: "", previousUrl: "https://old" }), { url: "https://old", kind: "previous", credit: "" });
  assert.deepEqual(resolvePhotos({ currentUrl: "https://new", currentCredit: "@x - Sprintshot", previousUrl: "https://old" }), {
    url: "https://new",
    kind: "current",
    credit: "@x - Sprintshot",
  });
  assert.equal(resolvePhotos({}), null);
});
