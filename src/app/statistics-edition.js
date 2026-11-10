import { useSearchParams } from "react-router-dom";

/**
 * Édition affichée dans le module Statistiques, gardée dans l'adresse
 * (?edition=2026 ; absente = toutes les éditions) pour être partagée par
 * tous les onglets.
 */
export function useStatisticsEdition() {
  const [searchParams, setSearchParams] = useSearchParams();
  const raw = searchParams.get("edition");
  const edition = raw && /^\d{4}$/.test(raw) ? Number(raw) : null;
  function setEdition(year) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (year) next.set("edition", String(year));
      else next.delete("edition");
      return next;
    }, { replace: true });
  }
  return { edition, setEdition };
}
