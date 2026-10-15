/**
 * Netlify Function — CMCM photo gallery proxy
 *
 * Reads the FLA photo gallery (flaphoto.net, a Piwigo install) and exposes
 * only the "CMCM Luxembourg Indoor Meeting" category and its sub-albums. The
 * browser cannot call Piwigo directly (no CORS headers), and going through here
 * also keeps the rest of the FLA gallery out of the site.
 *
 * Routes (via netlify.toml redirect; served by a Vite middleware in dev):
 *   GET /api/gallery
 *     → { albums: [{ id, name, year, count, cover, photographers: [{ id, name, count }] }] }
 *   GET /api/gallery?album=<id>&page=<n>
 *     → { album, page, perPage, total, images: [{ id, width, height, thumb, medium, pageUrl, photographer }] }
 */

const PIWIGO_WS = "https://flaphoto.net/galerie/ws.php";
const CMCM_CATEGORY_ID = 520;
const PER_PAGE = 60;
const TREE_TTL_MS = 10 * 60 * 1000;

let treeCache = null;

function json(status, payload, cacheSeconds = 0) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": cacheSeconds
        ? `public, max-age=${cacheSeconds}, s-maxage=${cacheSeconds * 6}`
        : "no-store",
    },
  });
}

async function piwigo(method, params = {}) {
  const url = new URL(PIWIGO_WS);
  url.searchParams.set("format", "json");
  url.searchParams.set("method", method);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));

  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Piwigo HTTP ${res.status} on ${method}`);
  const body = await res.json();
  if (body.stat !== "ok") throw new Error(`Piwigo error on ${method}: ${body.message || body.stat}`);
  return body.result;
}

// "CMCM indoor meeting 2026" → 2026; "Harry Daemen (FLA)" → "Harry Daemen".
function yearFromName(name) {
  const match = String(name || "").match(/\b(19|20)\d{2}\b/);
  return match ? Number(match[0]) : null;
}

function cleanName(name) {
  return String(name || "").replace(/\s*\(FLA\)\s*$/i, "").trim();
}

async function loadTree() {
  if (treeCache && Date.now() - treeCache.loadedAt < TREE_TTL_MS) return treeCache;

  const { categories } = await piwigo("pwg.categories.getList", {
    cat_id: CMCM_CATEGORY_ID,
    recursive: "true",
  });

  const editions = categories.filter((c) => Number(c.id_uppercat) === CMCM_CATEGORY_ID);
  const albums = editions
    .map((edition) => ({
      id: Number(edition.id),
      name: edition.name,
      year: yearFromName(edition.name),
      count: Number(edition.total_nb_images) || 0,
      cover: edition.tn_url || null,
      photographers: categories
        .filter((c) => Number(c.id_uppercat) === Number(edition.id))
        .map((c) => ({ id: Number(c.id), name: cleanName(c.name), count: Number(c.total_nb_images) || 0 }))
        .filter((c) => c.count > 0),
    }))
    .filter((album) => album.count > 0)
    .sort((a, b) => (b.year || 0) - (a.year || 0));

  // Every album id that belongs to the CMCM tree, with its display name.
  const allowed = new Map(categories.map((c) => [Number(c.id), cleanName(c.name)]));
  allowed.delete(CMCM_CATEGORY_ID);

  treeCache = { albums, allowed, loadedAt: Date.now() };
  return treeCache;
}

function normalizeImage(image, names) {
  const d = image.derivatives || {};
  const photographerId = (image.categories || []).map((c) => Number(c.id)).find((id) => names.has(id));
  return {
    id: image.id,
    width: d.medium?.width || image.width,
    height: d.medium?.height || image.height,
    thumb: d.small?.url || d.thumb?.url || null,
    medium: d.medium?.url || d.large?.url || image.element_url,
    pageUrl: image.page_url,
    photographer: photographerId ? names.get(photographerId) : null,
  };
}

export default async function handler(req) {
  const url = new URL(req.url);
  const albumParam = url.searchParams.get("album");

  try {
    const tree = await loadTree();

    if (!albumParam) return json(200, { albums: tree.albums }, 600);

    const albumId = Number(albumParam);
    if (!tree.allowed.has(albumId)) return json(404, { error: "Unknown album" });

    const page = Math.max(0, Number.parseInt(url.searchParams.get("page") || "0", 10) || 0);
    const result = await piwigo("pwg.categories.getImages", {
      cat_id: albumId,
      recursive: "true",
      per_page: PER_PAGE,
      page,
      order: "date_creation asc, id asc",
    });

    return json(200, {
      album: albumId,
      page,
      perPage: PER_PAGE,
      total: Number(result.paging?.total_count) || 0,
      images: (result.images || []).map((image) => normalizeImage(image, tree.allowed)),
    }, 600);
  } catch (err) {
    console.error("[flaphoto-gallery]", err.message);
    return json(502, { error: "Could not load the photo gallery.", detail: err.message });
  }
}
