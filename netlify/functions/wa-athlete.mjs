/**
 * Netlify Function — World Athletics athlete proxy
 *
 * Fetches PBs and SBs for a single athlete and normalizes them into the shape
 * MyCLIM's frontend expects (see fetchAthleteFromWaService in
 * src/app/athlete-portal-hooks.js): { personalBests, seasonBests } arrays of
 * { discipline, disciplineCode, mark, wind, notLegal, venue, date, resultScore, indoor }.
 *
 * Route (via netlify.toml redirect):
 *   GET /api/wa/athlete/:waid/performances
 *   → /.netlify/functions/wa-athlete?waid=:waid
 *
 * Backed by https://worldathletics.nimarion.de (open-source wrapper around
 * World Athletics' internal GraphQL API — see
 * https://github.com/nimarion/worldathletics). We used to call WA's internal
 * GraphQL endpoint directly, but that hostname (and API key) rotate and stop
 * resolving without notice — this wrapper handles that churn for us instead
 * of us having to reverse-engineer and keep refreshing it ourselves.
 */

const WA_API_BASE = "https://worldathletics.nimarion.de";

function json(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, x-api-key",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
    },
  });
}

async function waGet(path) {
  const res = await fetch(`${WA_API_BASE}${path}`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`WA HTTP ${res.status} on ${path}: ${detail}`);
  }
  return res.json();
}

function normalizePerformance(p) {
  const venue = [p.location?.city, p.location?.country].filter(Boolean).join(", ");
  return {
    discipline: p.discipline || null,
    disciplineCode: p.disciplineCode || null,
    mark: p.mark || null,
    wind: p.wind ?? null,
    notLegal: p.legal === false,
    venue: venue || null,
    date: p.date || null,
    resultScore: p.resultScore ?? null,
    indoor: Boolean(p.location?.indoor),
  };
}

async function fetchAthlete(waid) {
  const id = Number(waid);
  if (!Number.isInteger(id) || id <= 0) throw new Error("Invalid WAID");

  const athlete = await waGet(`/athletes/${id}`);

  // Season bests: the athlete profile only carries the current season, so we
  // pull individual results for the last 3 years and let the caller pick the
  // best per year/discipline (same approach as the previous implementation).
  const currentYear = new Date().getFullYear();
  const years = [currentYear, currentYear - 1, currentYear - 2];

  const yearResults = await Promise.allSettled(
    years.map((year) => waGet(`/athletes/${id}/results?year=${year}`)),
  );

  const seasonBests = yearResults.flatMap((res, i) => {
    if (res.status !== "fulfilled") {
      console.warn(`[wa-athlete] results fetch failed for WAID ${id} year ${years[i]}: ${res.reason?.message}`);
      return [];
    }
    return (Array.isArray(res.value) ? res.value : []).map(normalizePerformance);
  });

  return {
    firstName: athlete.firstname || null,
    lastName: athlete.lastname || null,
    birthDate: athlete.birthdate || null,
    countryCode: athlete.country || null,
    personalBests: (athlete.personalbests || []).map(normalizePerformance),
    seasonBests,
  };
}

export default async function handler(req) {
  if (req.method === "OPTIONS") return json(204, {});
  if (req.method !== "GET") return json(405, { error: "Method not allowed." });

  const url = new URL(req.url);
  let waid = url.searchParams.get("waid");
  if (!waid) {
    const m = url.pathname.match(/\/(\d{7,10})(?:\/|$)/);
    waid = m?.[1] ?? null;
  }

  if (!waid || isNaN(Number(waid)) || Number(waid) <= 0) {
    return json(400, { error: `Missing or invalid waid (url: ${url.pathname}${url.search})` });
  }

  try {
    const athlete = await fetchAthlete(waid);
    return json(200, {
      waid: Number(waid),
      firstName: athlete.firstName,
      lastName: athlete.lastName,
      birthDate: athlete.birthDate,
      countryCode: athlete.countryCode,
      source: "live",
      personalBests: athlete.personalBests,
      seasonBests: athlete.seasonBests,
    });
  } catch (err) {
    console.error(`[wa-athlete] Error for WAID ${waid}:`, err.message);
    return json(502, {
      error: "Could not fetch athlete data from World Athletics.",
      detail: err.message,
    });
  }
}
