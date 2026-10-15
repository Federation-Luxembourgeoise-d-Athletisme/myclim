// Galerie photos flaphoto.net en lecture seule (porté de myFLA : app/communication/galerie).
// L'album ouvert est dans l'adresse (?album=…) pour pouvoir partager le lien.
import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { GalleryBrowser } from "./com-gallery.jsx";
import { ComPageHeader } from "./com-ui.jsx";

export function ComGalleryPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const albumId = searchParams.get("album");
  const openAlbum = useCallback((id) => setSearchParams(id ? { album: id } : {}), [setSearchParams]);

  return (
    <>
      <ComPageHeader
        title="Galerie photos"
        description="Albums publics de flaphoto.net, la galerie de la fédération (lecture seule). Pour une publication, choisis les photos depuis sa page : le crédit du photographe est repris automatiquement."
      />
      <GalleryBrowser albumId={albumId} onOpenAlbum={openAlbum} />
    </>
  );
}
