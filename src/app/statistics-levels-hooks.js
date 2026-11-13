import { useMemo } from "react";
import { useAllMeetingResults, useAllWinners, useMeetingEditions, useMeetingRecords } from "./meeting-history-hooks";
import { useAthletes } from "./athlete-portal-hooks";
import { useActiveEdition } from "./edition";
import { buildSpeakerSheets, computeEditionLive } from "./statistics-levels";
import { getEditionDisplayNumber } from "./meeting-edition-utils";
import { useStatisticsEdition } from "./statistics-edition";
import { useLanguage } from "./language-context";

// Données des pages « Par niveau » et Animation (fiches speaker, édition en direct).

// Résultats historiques sans les éditions annulées.
function useHistory() {
  const { editions, loading: editionsLoading } = useMeetingEditions();
  const { results, loading: resultsLoading, error } = useAllMeetingResults();
  const usable = useMemo(() => {
    const hidden = new Set(editions.filter((e) => e.cancelled).map((e) => Number(e.year)));
    return results.filter((row) => !hidden.has(Number(row.year)));
  }, [results, editions]);
  return { results: usable, loading: editionsLoading || resultsLoading, error };
}

// Engagés + historique + programme horaire de l'édition affichée
// (?edition=…, sinon l'édition active) : partagé par les pages Animation.
function useSpeakerData() {
  const { language } = useLanguage();
  const { edition } = useStatisticsEdition();
  const { activeEditionId, loading: editionLoading } = useActiveEdition(true);
  const year = edition || Number(activeEditionId) || new Date().getFullYear();
  const { athletes, loading: athletesLoading } = useAthletes(!editionLoading, String(year));
  const { results, loading: resultsLoading, error } = useHistory();
  const { records, loading: recordsLoading } = useMeetingRecords();
  const { winners, loading: winnersLoading } = useAllWinners();
  const { editions, loading: editionsLoading } = useMeetingEditions();
  const loading = editionLoading || athletesLoading || resultsLoading || recordsLoading || winnersLoading || editionsLoading;
  const editionDoc = editions.find((e) => Number(e.year ?? e.id) === Number(year)) || null;

  const data = useMemo(() => {
    if (loading) return null;
    const timetable = Array.isArray(editionDoc?.timetable) ? editionDoc.timetable : [];
    const speaker = buildSpeakerSheets({ athletes, results, records, winners, year, timetable, language });
    const live = computeEditionLive({ sheets: speaker.sheets, results, year, editionNumber: getEditionDisplayNumber(editionDoc), language });
    return { ...speaker, live };
  }, [loading, athletes, results, records, winners, year, editionDoc, language]);

  return { year, data, loading, error, editions };
}

export { useHistory, useSpeakerData };
