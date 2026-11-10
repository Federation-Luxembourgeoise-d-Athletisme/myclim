import { useDeferredValue, useMemo, useState } from "react";
import { getDefaultSortDirection, sortRegistryRows } from "./athlete-registry-analysis";

// Filtres et tri de la page Base athlètes ; rows = [{ entry, stats, suspectReasons }].

const EMPTY_FILTERS = {
  search: "",
  nationality: "",
  gender: "",
  discipline: "",
  year: "",
  minEditions: "",
  waid: "",
  suspect: false,
};

// initialSearch : recherche venue de l'adresse (?recherche=, depuis la
// recherche du module Statistiques) ; une nouvelle valeur remplace la saisie.
function useRegistryFilters(rows, initialSearch = "") {
  const [filters, setFilters] = useState(() => ({ ...EMPTY_FILTERS, search: initialSearch }));
  const [appliedSearch, setAppliedSearch] = useState(initialSearch);
  if (initialSearch !== appliedSearch) {
    setAppliedSearch(initialSearch);
    setFilters((prev) => ({ ...prev, search: initialSearch }));
  }
  const [sortKey, setSortKey] = useState("name");
  const [sortDirection, setSortDirection] = useState(1);
  const deferredSearch = useDeferredValue(filters.search);

  const options = useMemo(() => {
    const nations = new Set();
    const disciplines = new Set();
    const years = new Set();
    rows.forEach(({ entry, stats }) => {
      if (entry.nationality) nations.add(String(entry.nationality).trim());
      stats.disciplines.forEach((discipline) => disciplines.add(discipline));
      stats.years.forEach((year) => years.add(year));
    });
    return {
      nations: [...nations].sort(),
      disciplines: [...disciplines].sort((a, b) => a.localeCompare(b)),
      years: [...years].sort((a, b) => b - a),
    };
  }, [rows]);

  const filteredRows = useMemo(() => {
    const query = deferredSearch.toLowerCase().trim();
    const minEditions = Number(filters.minEditions) || 0;
    const year = Number(filters.year) || 0;
    return rows.filter(({ entry, stats, suspectReasons }) => {
      if (filters.nationality && String(entry.nationality || "").trim() !== filters.nationality) return false;
      if (filters.gender && stats.gender !== filters.gender) return false;
      if (filters.discipline && !stats.disciplines.includes(filters.discipline)) return false;
      if (year && !stats.years.includes(year)) return false;
      if (minEditions && stats.editionCount < minEditions) return false;
      if (filters.waid === "with" && !entry.waid) return false;
      if (filters.waid === "without" && entry.waid) return false;
      if (filters.suspect && !suspectReasons.length) return false;
      if (!query) return true;
      const haystack = [entry.lastName, entry.firstName, entry.nationality, entry.waid, entry.birthDate, entry.birthYear]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [deferredSearch, filters, rows]);

  const sortedRows = useMemo(
    () => sortRegistryRows(filteredRows, sortKey, sortDirection),
    [filteredRows, sortDirection, sortKey],
  );

  function setFilter(key, value) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function changeSort(nextKey) {
    if (nextKey === sortKey) {
      setSortDirection((current) => -current);
      return;
    }
    setSortKey(nextKey);
    setSortDirection(getDefaultSortDirection(nextKey));
  }

  const hasFilters = Object.entries(filters).some(([key, value]) => value !== EMPTY_FILTERS[key]);

  return {
    filters,
    setFilter,
    resetFilters: () => setFilters(EMPTY_FILTERS),
    hasFilters,
    options,
    filteredRows,
    sortedRows,
    sortKey,
    sortDirection,
    changeSort,
    setSortKey: (key) => {
      setSortKey(key);
      setSortDirection(getDefaultSortDirection(key));
    },
  };
}

export { useRegistryFilters };
