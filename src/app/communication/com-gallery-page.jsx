// Galerie photos flaphoto.net en lecture seule (porté de myFLA : app/communication/galerie).
// L'album ouvert est dans l'adresse (?album=…) pour pouvoir partager le lien.
import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { GalleryBrowser } from "./com-gallery.jsx";
import { useComLang } from "./com-i18n.js";
import { ComPageHeader } from "./com-ui.jsx";

export function ComGalleryPage() {
  const { tr } = useComLang();
  const [searchParams, setSearchParams] = useSearchParams();
  const albumId = searchParams.get("album");
  const openAlbum = useCallback((id) => setSearchParams(id ? { album: id } : {}), [setSearchParams]);

  return (
    <>
      <ComPageHeader
        title={tr("Galerie photos", "Photo gallery")}
        description={tr(
          "Albums publics de flaphoto.net, la galerie de la fédération (lecture seule). Pour une publication, choisis les photos depuis sa page : le crédit du photographe est repris automatiquement.",
          "Public albums from flaphoto.net, the federation's photo gallery (read-only). To add photos to a publication, pick them from its page: the photographer credit is added automatically.",
        )}
      />
      <GalleryBrowser albumId={albumId} onOpenAlbum={openAlbum} />
    </>
  );
}
