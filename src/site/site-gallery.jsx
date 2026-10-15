import { useCallback, useEffect, useRef, useState } from "react";

// Photos come from the CMCM category of the FLA gallery (flaphoto.net),
// through the /api/gallery proxy (netlify/functions/flaphoto-gallery.mjs).
const GALLERY_API = "/api/gallery";
const FLA_GALLERY_URL = "https://flaphoto.net/galerie/index.php?/category/520";

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function useGalleryAlbums() {
  const [state, setState] = useState({ albums: [], loading: true, error: null });

  useEffect(() => {
    let cancelled = false;
    fetchJson(GALLERY_API)
      .then((data) => { if (!cancelled) setState({ albums: data.albums || [], loading: false, error: null }); })
      .catch((error) => { if (!cancelled) setState({ albums: [], loading: false, error }); });
    return () => { cancelled = true; };
  }, []);

  return state;
}

function useAlbumImages(albumId) {
  const [state, setState] = useState({ albumId: null, images: [], total: 0, page: 0, loading: false, error: null });
  // Guards against a second request for the same page before the re-render.
  const pendingRef = useRef(null);

  useEffect(() => {
    if (!albumId) return undefined;
    let cancelled = false;
    fetchJson(`${GALLERY_API}?album=${albumId}&page=0`)
      .then((data) => {
        if (!cancelled) setState({ albumId, images: data.images, total: data.total, page: 0, loading: false, error: null });
      })
      .catch((error) => {
        if (!cancelled) setState({ albumId, images: [], total: 0, page: 0, loading: false, error });
      });
    return () => { cancelled = true; };
  }, [albumId]);

  // Until the first page of a newly picked album arrives, show it as loading.
  if (state.albumId !== albumId) {
    return { albumId, images: [], total: 0, page: 0, loading: Boolean(albumId), error: null, loadMore() {} };
  }

  function loadMore() {
    const { albumId: currentAlbum, page, images, total, loading } = state;
    const nextPage = page + 1;
    const key = `${currentAlbum}:${nextPage}`;
    if (loading || images.length >= total || pendingRef.current === key) return;
    pendingRef.current = key;
    setState((cur) => ({ ...cur, loading: true }));
    fetchJson(`${GALLERY_API}?album=${currentAlbum}&page=${nextPage}`)
      .then((data) => {
        setState((cur) => (cur.albumId === currentAlbum
          ? { ...cur, images: [...cur.images, ...data.images], page: nextPage, loading: false }
          : cur));
      })
      .catch((error) => setState((cur) => ({ ...cur, loading: false, error })))
      .finally(() => { pendingRef.current = null; });
  }

  return { ...state, loadMore };
}

function Lightbox({ images, total, index, onClose, onMove }) {
  const image = images[index];

  useEffect(() => {
    function onKey(event) {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowRight") onMove(1);
      if (event.key === "ArrowLeft") onMove(-1);
    }
    window.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose, onMove]);

  if (!image) return null;

  return (
    <div className="site-gallery-lightbox" role="dialog" aria-modal="true" aria-label="Photo viewer" onClick={onClose}>
      <button type="button" className="site-gallery-lightbox__close" aria-label="Close" onClick={onClose}>×</button>
      <button
        type="button"
        className="site-gallery-lightbox__nav site-gallery-lightbox__nav--prev"
        aria-label="Previous photo"
        disabled={index === 0}
        onClick={(event) => { event.stopPropagation(); onMove(-1); }}
      >‹</button>
      <figure className="site-gallery-lightbox__figure" onClick={(event) => event.stopPropagation()}>
        <img src={image.medium} alt="" width={image.width} height={image.height} />
        <figcaption>
          <span>{image.photographer ? `Photo: ${image.photographer} / FLA` : "Photo: FLA"}</span>
          <span className="site-gallery-lightbox__count">{index + 1} / {total}</span>
          <a href={image.pageUrl} target="_blank" rel="noopener noreferrer">View on flaphoto.net ↗</a>
        </figcaption>
      </figure>
      <button
        type="button"
        className="site-gallery-lightbox__nav site-gallery-lightbox__nav--next"
        aria-label="Next photo"
        disabled={index >= images.length - 1}
        onClick={(event) => { event.stopPropagation(); onMove(1); }}
      >›</button>
    </div>
  );
}

export function SiteGallery() {
  const { albums, loading: albumsLoading, error: albumsError } = useGalleryAlbums();
  const [editionId, setEditionId] = useState(null);
  const [photographerId, setPhotographerId] = useState(null);
  const [openIndex, setOpenIndex] = useState(null);

  const edition = albums.find((a) => a.id === editionId) || albums[0] || null;
  const activeAlbumId = photographerId || edition?.id || null;
  const { images, total, loading, error, loadMore } = useAlbumImages(activeAlbumId);

  function selectEdition(id) {
    setEditionId(id);
    setPhotographerId(null);
    setOpenIndex(null);
  }

  function selectPhotographer(id) {
    setPhotographerId(id);
    setOpenIndex(null);
  }

  const closeLightbox = useCallback(() => setOpenIndex(null), []);
  const moveLightbox = useCallback((step) => {
    setOpenIndex((i) => Math.min(Math.max(i + step, 0), images.length - 1));
  }, [images.length]);

  // Fetch the next page while browsing towards the end of what is loaded.
  useEffect(() => {
    if (openIndex !== null && openIndex >= images.length - 3) loadMore();
  }, [openIndex, images.length, loadMore]);

  return (
    <>
      <section className="site-press-hero">
        <div className="site-container">
          <span className="site-eyebrow">Photos</span>
          <h1 className="site-heading">Gallery</h1>
          <p className="site-lead">
            Relive past editions of the CMCM Luxembourg Indoor Meeting through the photos of the FLA photographers.
          </p>
        </div>
      </section>

      <section className="site-section site-gallery">
        <div className="site-container">
          {albumsLoading ? (
            <p className="site-gallery__status">Loading the gallery…</p>
          ) : albumsError || !edition ? (
            <p className="site-gallery__status">
              The gallery can't be loaded right now. You can browse it directly on{" "}
              <a href={FLA_GALLERY_URL} target="_blank" rel="noopener noreferrer">flaphoto.net</a>.
            </p>
          ) : (
            <>
              <div className="site-gallery__editions" role="tablist" aria-label="Edition">
                {albums.map((album) => (
                  <button
                    key={album.id}
                    type="button"
                    role="tab"
                    aria-selected={album.id === edition.id}
                    className={`site-gallery__edition${album.id === edition.id ? " is-active" : ""}`}
                    onClick={() => selectEdition(album.id)}
                  >
                    {album.year || album.name}
                  </button>
                ))}
              </div>

              {edition.photographers.length > 1 ? (
                <div className="site-gallery__photographers" aria-label="Photographer">
                  <button
                    type="button"
                    className={`site-gallery__chip${!photographerId ? " is-active" : ""}`}
                    onClick={() => selectPhotographer(null)}
                  >
                    All <span>{edition.count}</span>
                  </button>
                  {edition.photographers.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className={`site-gallery__chip${photographerId === p.id ? " is-active" : ""}`}
                      onClick={() => selectPhotographer(p.id)}
                    >
                      {p.name} <span>{p.count}</span>
                    </button>
                  ))}
                </div>
              ) : null}

              {error && images.length === 0 ? (
                <p className="site-gallery__status">These photos can't be loaded right now.</p>
              ) : (
                <div className="site-gallery__grid">
                  {images.map((image, index) => (
                    <button
                      key={image.id}
                      type="button"
                      className="site-gallery__item"
                      aria-label={`Open photo ${index + 1}`}
                      onClick={() => setOpenIndex(index)}
                    >
                      <img src={image.thumb} alt="" loading="lazy" />
                    </button>
                  ))}
                </div>
              )}

              <div className="site-gallery__footer">
                {loading ? (
                  <p className="site-gallery__status">Loading photos…</p>
                ) : images.length < total ? (
                  <button type="button" className="site-btn site-btn--secondary" onClick={loadMore}>
                    Load more photos ({total - images.length} left)
                  </button>
                ) : null}
                <p className="site-gallery__credit">
                  Photos © FLA — Fédération Luxembourgeoise d'Athlétisme.{" "}
                  <a href={FLA_GALLERY_URL} target="_blank" rel="noopener noreferrer">Full gallery on flaphoto.net ↗</a>
                </p>
              </div>
            </>
          )}
        </div>
      </section>

      {openIndex !== null ? (
        <Lightbox images={images} total={total} index={openIndex} onClose={closeLightbox} onMove={moveLightbox} />
      ) : null}
    </>
  );
}
