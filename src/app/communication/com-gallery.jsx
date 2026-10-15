// Galerie flaphoto.net (porté de myFLA : gallery-browser.tsx, photos-panel.tsx,
// photo-lightbox.tsx en version simplifiée).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MAX_PUBLICATION_PHOTOS, creditLine, loadGalleryAlbums, loadGalleryPhotos, toPublicationPhoto } from "./com-social.js";
import { useEscape } from "./com-ui-helpers.js";

const fmtCount = (n) => `${Number(n).toLocaleString("fr-FR")} photo${n > 1 ? "s" : ""}`;
const fmtDate = (value) =>
  value ? new Date(String(value).replace(" ", "T")).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" }) : "";
const normalize = (value) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// Navigation dans les albums : page « Galerie photos » et fenêtre de choix d'une publication.
// selection : { selectedIds: Set, onToggle(photo) } pour cocher des photos.
export function GalleryBrowser({ albumId, onOpenAlbum, heading, selection }) {
  const [albums, setAlbums] = useState(null);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    loadGalleryAlbums()
      .then((list) => !cancelled && setAlbums(list))
      .catch((e) => {
        if (cancelled) return;
        setAlbums([]);
        setError(e?.message || "La galerie flaphoto.net est injoignable pour le moment.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const byId = useMemo(() => new Map((albums || []).map((a) => [a.id, a])), [albums]);
  const childrenOf = useMemo(() => {
    const map = new Map();
    for (const a of albums || []) map.set(a.parentId, [...(map.get(a.parentId) || []), a]);
    return map;
  }, [albums]);
  const path = useMemo(() => {
    const chain = [];
    for (let a = albumId ? byId.get(albumId) : undefined; a; a = a.parentId ? byId.get(a.parentId) : undefined) chain.unshift(a);
    return chain;
  }, [albumId, byId]);

  const open = useCallback(
    (id) => {
      setQuery("");
      onOpenAlbum(id);
    },
    [onOpenAlbum],
  );

  const album = albumId ? byId.get(albumId) : undefined;
  const children = childrenOf.get(album?.id ?? null) || [];
  // Un album d'événement contient un sous-album par photographe : proposés en filtres.
  const photographerFolders = children.length > 0 && children.every((c) => c.nbChildren === 0);

  const results = useMemo(() => {
    const q = normalize(query.trim());
    if (q.length < 2 || !albums) return null;
    return albums
      .filter((a) => a.totalImages > 0 && normalize(a.name).includes(q))
      .sort((a, b) => String(b.lastDate || "").localeCompare(String(a.lastDate || "")))
      .slice(0, 60);
  }, [albums, query]);

  const pathLabel = (a) => {
    const names = [];
    for (let p = a.parentId ? byId.get(a.parentId) : undefined; p; p = p.parentId ? byId.get(p.parentId) : undefined) names.unshift(p.name);
    return names.join(" › ");
  };

  return (
    <>
      <header className="com-row" style={{ justifyContent: "space-between", alignItems: "flex-end" }}>
        {heading}
        <input type="search" className="com-input" style={{ maxWidth: 300 }} placeholder="Rechercher un album (ex. CMCM)…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Rechercher un album" />
      </header>

      {error ? <p className="com-empty com-warn-box">{error}</p> : null}

      {albums === null ? (
        <p className="com-muted">Chargement des albums…</p>
      ) : results ? (
        <section className="com-stack">
          <h2 className="com-section-title">
            {results.length ? `${results.length}${results.length === 60 ? "+" : ""} album${results.length > 1 ? "s" : ""}` : "Aucun album trouvé"}
          </h2>
          <AlbumGrid albums={results} onOpen={open} subtitle={pathLabel} />
        </section>
      ) : (
        <>
          <nav aria-label="Fil d'Ariane" className="com-row" style={{ gap: 4 }}>
            <button type="button" className="com-btn-ghost" onClick={() => open(null)}>
              Tous les albums
            </button>
            {path.map((a, i) => (
              <span key={a.id} className="com-row" style={{ gap: 4 }}>
                <span className="com-muted">›</span>
                {i === path.length - 1 ? (
                  <strong style={{ padding: "8px 4px" }}>{a.name}</strong>
                ) : (
                  <button type="button" className="com-btn-ghost" onClick={() => open(a.id)}>
                    {a.name}
                  </button>
                )}
              </span>
            ))}
          </nav>

          {albumId && !album ? <p className="com-muted">Cet album n'existe plus.</p> : null}

          {album ? (
            <div className="com-row com-muted" style={{ fontSize: "0.85rem" }}>
              <span>{fmtCount(album.totalImages)}</span>
              {album.lastDate ? <span>· mis à jour le {fmtDate(album.lastDate)}</span> : null}
              {album.piwigoUrl ? (
                <a href={album.piwigoUrl} target="_blank" rel="noreferrer" className="com-link">
                  · Ouvrir sur flaphoto.net ↗
                </a>
              ) : null}
            </div>
          ) : null}

          {album && (photographerFolders || album.nbImages > 0) ? (
            <AlbumPhotos key={album.id} album={album} folders={photographerFolders ? children : []} selection={selection} />
          ) : (
            <AlbumGrid albums={children} onOpen={open} />
          )}
        </>
      )}
    </>
  );
}

function AlbumGrid({ albums, onOpen, subtitle }) {
  if (!albums.length) return null;
  return (
    <div className="com-album-grid">
      {albums.map((a) => (
        <button key={a.id} type="button" className="com-album" onClick={() => onOpen(a.id)}>
          <span className="com-album__thumb">{a.thumbUrl ? <img src={a.thumbUrl} alt="" loading="lazy" /> : null}</span>
          <span className="com-album__text">
            {subtitle ? <small className="com-muted">{subtitle(a)}</small> : null}
            <b>{a.name}</b>
            <small className="com-muted">
              {fmtCount(a.totalImages)}
              {a.lastDate ? ` · ${fmtDate(a.lastDate)}` : ""}
            </small>
          </span>
        </button>
      ))}
    </div>
  );
}

// Photos d'un album (sous-albums compris), chargées par pages au fil du défilement.
function AlbumPhotos({ album, folders, selection }) {
  const [source, setSource] = useState(album.id);
  const [photos, setPhotos] = useState([]);
  const [total, setTotal] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [openIndex, setOpenIndex] = useState(null);
  const nextPage = useRef(0);
  const loaded = useRef(0);
  const loadingRef = useRef(false);
  // Incrémenté à chaque changement de photographe : une réponse arrivée trop tard est ignorée.
  const generation = useRef(0);
  const sentinel = useRef(null);
  const done = total !== null && photos.length >= total;

  const loadMore = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    const gen = generation.current;
    try {
      const result = await loadGalleryPhotos(source, nextPage.current);
      if (gen !== generation.current) return;
      nextPage.current += 1;
      loaded.current += result.photos.length;
      setPhotos((prev) => [...prev, ...result.photos]);
      // Page vide : Piwigo n'a plus rien, même si son total annonçait davantage.
      setTotal(result.photos.length ? result.total : loaded.current);
    } catch (e) {
      if (gen === generation.current) setError(e?.message || "Chargement impossible.");
    } finally {
      if (gen === generation.current) {
        loadingRef.current = false;
        setLoading(false);
      }
    }
  }, [source]);

  // Changement de photographe : on repart de la première page.
  useEffect(() => {
    generation.current += 1;
    nextPage.current = 0;
    loaded.current = 0;
    loadingRef.current = false;
    setOpenIndex(null);
    setPhotos([]);
    setTotal(null);
    setError(null);
    loadMore();
  }, [loadMore]);

  useEffect(() => {
    const node = sentinel.current;
    if (!node || done || error) return undefined;
    const observer = new IntersectionObserver((entries) => entries[0]?.isIntersecting && loadMore(), { rootMargin: "600px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [done, error, loadMore, photos.length]);

  return (
    <section className="com-stack">
      {folders.length ? (
        <div className="com-row" role="group" aria-label="Photographe">
          {[{ id: album.id, name: "Toutes les photos", totalImages: album.totalImages }, ...folders].map((f) => (
            <button key={f.id} type="button" className={`com-toggle ${source === f.id ? "is-on" : ""}`} aria-pressed={source === f.id} onClick={() => setSource(f.id)}>
              {f.name} <span className="com-muted">{f.totalImages}</span>
            </button>
          ))}
        </div>
      ) : null}

      {error ? <p className="com-empty com-warn-box">{error}</p> : null}
      {total === 0 ? <p className="com-muted">Aucune photo dans cet album.</p> : null}

      <div className="com-photo-grid">
        {photos.map((p, i) => {
          const selected = selection?.selectedIds.has(p.id) || false;
          return (
            <div key={p.id} className={`com-photo ${selected ? "is-selected" : ""}`}>
              <button
                type="button"
                className="com-photo__main"
                onClick={() => (selection ? selection.onToggle(p) : setOpenIndex(i))}
                aria-label={selection ? `${selected ? "Retirer" : "Choisir"} ${p.file}` : `Agrandir ${p.file}`}
                aria-pressed={selection ? selected : undefined}
              >
                <img src={p.thumbUrl} alt="" loading="lazy" />
              </button>
              {selection ? (
                <>
                  <span className="com-photo__check" aria-hidden="true">
                    ✓
                  </span>
                  <button type="button" className="com-photo__zoom" aria-label={`Agrandir ${p.file}`} onClick={() => setOpenIndex(i)}>
                    ⤢
                  </button>
                </>
              ) : null}
            </div>
          );
        })}
      </div>

      <div ref={sentinel} className="com-row" style={{ justifyContent: "center", padding: 8 }}>
        {loading ? <span className="com-muted">Chargement des photos…</span> : null}
        {!loading && !done && error ? (
          <button
            type="button"
            className="button button--secondary button--small"
            onClick={() => {
              setError(null);
              loadMore();
            }}
          >
            Réessayer
          </button>
        ) : null}
        {done && photos.length ? <span className="com-muted" style={{ fontSize: "0.75rem" }}>{fmtCount(photos.length)}</span> : null}
      </div>

      {openIndex !== null && photos[openIndex] ? (
        <PhotoLightbox
          photos={photos}
          index={openIndex}
          total={total ?? photos.length}
          selection={selection}
          onIndex={(i) => {
            setOpenIndex(i);
            if (i >= photos.length - 5 && !done) loadMore();
          }}
          onClose={() => setOpenIndex(null)}
        />
      ) : null}
    </section>
  );
}

function PhotoLightbox({ photos, index, total, selection, onIndex, onClose }) {
  const photo = photos[index];
  useEscape(onClose);
  useEffect(() => {
    const onKey = (event) => {
      if (event.key === "ArrowLeft" && index > 0) onIndex(index - 1);
      if (event.key === "ArrowRight" && index < photos.length - 1) onIndex(index + 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, onIndex, photos.length]);
  const selected = selection?.selectedIds.has(photo.id) || false;

  return (
    <div className="com-lightbox" role="dialog" aria-label="Photo" onClick={onClose}>
      <img src={photo.largeUrl || photo.thumbUrl} alt="" onClick={(e) => e.stopPropagation()} />
      <div className="com-lightbox__bar" onClick={(e) => e.stopPropagation()}>
        <span>
          {index + 1} / {total}
          {photo.albumName ? ` · ${photo.albumName}` : ""}
        </span>
        <span className="com-row">
          <button type="button" className="com-btn-ghost" disabled={index === 0} onClick={() => onIndex(index - 1)} aria-label="Photo précédente">
            ‹
          </button>
          <button type="button" className="com-btn-ghost" disabled={index >= photos.length - 1} onClick={() => onIndex(index + 1)} aria-label="Photo suivante">
            ›
          </button>
          {selection ? (
            <button type="button" className={`com-toggle ${selected ? "is-on" : ""}`} onClick={() => selection.onToggle(photo)}>
              {selected ? "✓ Choisie" : "Choisir"}
            </button>
          ) : null}
          {photo.downloadUrl ? (
            <a href={photo.downloadUrl} rel="noreferrer" className="com-btn-ghost">
              Télécharger en HD
            </a>
          ) : null}
          <button type="button" className="com-btn-ghost" onClick={onClose}>
            Fermer
          </button>
        </span>
      </div>
    </div>
  );
}

// Dernier album ouvert dans la fenêtre de choix : on y revient à l'ouverture suivante.
let lastPickerAlbum = null;

// Photos de la galerie jointes à une publication. L'ordre compte : la première
// sert de visuel quand aucun visuel Canva n'est ajouté.
export function PhotosPanel({ photos, hasVisuel, onChange }) {
  const [picking, setPicking] = useState(false);
  const [copied, setCopied] = useState(false);
  const [dragged, setDragged] = useState(null);
  const credit = creditLine(photos);

  async function copyCredit() {
    if (!credit) return;
    try {
      await navigator.clipboard.writeText(credit);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Presse-papiers refusé : le crédit reste lisible à l'écran.
    }
  }

  function move(id, to) {
    const from = photos.findIndex((p) => p.id === id);
    if (from < 0 || to < 0 || to >= photos.length || from === to) return;
    const next = [...photos];
    const [photo] = next.splice(from, 1);
    next.splice(to, 0, photo);
    onChange(next);
  }

  return (
    <section className="com-card com-stack">
      <div className="com-row" style={{ justifyContent: "space-between" }}>
        <strong style={{ fontSize: "1.1rem" }}>
          Photos de la galerie {photos.length ? <span className="com-muted">· {photos.length}</span> : null}
        </strong>
        <button type="button" className="button button--secondary button--small" onClick={() => setPicking(true)}>
          {photos.length ? "Modifier la sélection" : "Choisir dans la galerie"}
        </button>
      </div>

      {photos.length ? (
        <>
          <ul className="com-picked">
            {photos.map((p, i) => (
              <li
                key={p.id}
                draggable
                onDragStart={(e) => {
                  setDragged(p.id);
                  e.dataTransfer.effectAllowed = "move";
                }}
                onDragEnd={() => setDragged(null)}
                onDragOver={(e) => dragged && e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragged) move(dragged, i);
                  setDragged(null);
                }}
                style={dragged === p.id ? { opacity: 0.4 } : undefined}
              >
                <div className="com-picked__img">
                  <img src={p.thumbUrl} alt="" loading="lazy" draggable={false} />
                  {i === 0 && !hasVisuel ? <span className="com-picked__badge">Visuel du post</span> : null}
                  <div className="com-picked__actions">
                    {i > 0 ? (
                      <button type="button" onClick={() => move(p.id, i - 1)} aria-label="Avancer la photo">
                        ←
                      </button>
                    ) : null}
                    {i < photos.length - 1 ? (
                      <button type="button" onClick={() => move(p.id, i + 1)} aria-label="Reculer la photo">
                        →
                      </button>
                    ) : null}
                    <a href={p.largeUrl} target="_blank" rel="noreferrer" aria-label="Voir en grand">
                      ⤢
                    </a>
                    {p.downloadUrl ? (
                      <a href={p.downloadUrl} rel="noreferrer" aria-label="Télécharger en HD">
                        ⬇
                      </a>
                    ) : null}
                    <button type="button" onClick={() => onChange(photos.filter((x) => x.id !== p.id))} aria-label="Retirer la photo">
                      ✕
                    </button>
                  </div>
                </div>
                {p.credit ? <small className="com-muted">{p.credit}</small> : null}
              </li>
            ))}
          </ul>
          {credit ? (
            <div className="com-row com-empty" style={{ justifyContent: "space-between", background: "#f4f8fb" }}>
              <span>
                <span className="com-muted">Crédit à mentionner · </span>
                {credit}
              </span>
              <button type="button" className="com-btn-ghost" onClick={copyCredit}>
                {copied ? "Copié ✓" : "Copier"}
              </button>
            </div>
          ) : null}
          {photos.length > 1 ? (
            <p className="com-muted" style={{ fontSize: "0.75rem" }}>
              Glisser pour réordonner.{hasVisuel ? "" : " La première photo sert de visuel tant qu'aucun visuel Canva n'est ajouté."}
            </p>
          ) : null}
        </>
      ) : (
        <p className="com-muted">Aucune photo choisie. Choisis-les dans la galerie flaphoto.net : le nom du photographe est repris pour le crédit.</p>
      )}

      {picking ? (
        <PhotoPicker
          initial={photos}
          onClose={() => setPicking(false)}
          onConfirm={(next) => {
            onChange(next);
            setPicking(false);
          }}
        />
      ) : null}
    </section>
  );
}

function PhotoPicker({ initial, onClose, onConfirm }) {
  const [albumId, setAlbumId] = useState(lastPickerAlbum);
  // Map ordonnée : les photos gardent l'ordre dans lequel on les a choisies.
  const [selected, setSelected] = useState(() => new Map(initial.map((p) => [p.id, p])));
  const [limitReached, setLimitReached] = useState(false);
  useEscape(onClose);

  const openAlbum = useCallback((id) => {
    lastPickerAlbum = id;
    setAlbumId(id);
    document.getElementById("photo-picker-scroll")?.scrollTo({ top: 0 });
  }, []);

  const toggle = useCallback((photo) => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(photo.id)) next.delete(photo.id);
      else if (next.size >= MAX_PUBLICATION_PHOTOS) {
        setLimitReached(true);
        return prev;
      } else next.set(photo.id, toPublicationPhoto(photo));
      setLimitReached(false);
      return next;
    });
  }, []);

  return (
    <div className="com-picker" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Choisir des photos dans la galerie" className="com-picker__box" onClick={(e) => e.stopPropagation()}>
        <div id="photo-picker-scroll" className="com-picker__scroll com-stack">
          <GalleryBrowser
            albumId={albumId}
            onOpenAlbum={openAlbum}
            selection={{ selectedIds: new Set(selected.keys()), onToggle: toggle }}
            heading={<h2 style={{ margin: 0 }}>Choisir des photos</h2>}
          />
        </div>
        <div className="com-picker__bottom">
          <span className="com-muted">
            {selected.size ? `${selected.size} photo${selected.size > 1 ? "s" : ""} choisie${selected.size > 1 ? "s" : ""}` : "Clique sur les photos pour les choisir."}
            {limitReached ? <strong style={{ color: "#8a5a00", marginLeft: 8 }}>Maximum {MAX_PUBLICATION_PHOTOS} photos.</strong> : null}
          </span>
          <div className="com-row">
            <button type="button" className="com-btn-ghost" onClick={onClose}>
              Annuler
            </button>
            <button type="button" className="button button--primary button--small" onClick={() => onConfirm([...selected.values()])}>
              Valider
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
