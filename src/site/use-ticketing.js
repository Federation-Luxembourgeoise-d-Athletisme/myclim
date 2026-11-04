import { useEffect, useState } from "react";
import { useSiteEditionYear } from "../app/edition";
import { useMeetingEditions } from "../app/meeting-history-hooks";
import { useLinksPageSettings } from "./site-hooks";
import { TICKET_PRICING } from "./ticket-pricing-config";
import { formatDoorsTime, getDoorsOpenDate, getTicketPhase } from "./ticketing-utils";

function useNow(intervalMs) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

function formatDay(value) {
  const date = value?.toDate ? value.toDate() : value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "Europe/Luxembourg" });
}

// Edition promoted on the site (same rule as the layout and the homepage hero),
// ticket link and doors time from the admin « Page liens » settings.
export function useTicketing() {
  const { editions } = useMeetingEditions();
  const { siteEditionYear } = useSiteEditionYear();
  const { settings } = useLinksPageSettings();
  const now = useNow(30000);
  const configuredEdition = siteEditionYear
    ? editions.find((edition) => Number(edition.year || edition.id) === Number(siteEditionYear)) || null
    : null;
  const edition = configuredEdition || editions[0] || null;
  const editionDate = edition?.date || null;
  const phase = getTicketPhase(TICKET_PRICING, editionDate, now);
  const doorsOpen = getDoorsOpenDate(editionDate, settings.access.doors.en);
  const ticketUrl = settings.tickets.url;
  return {
    now,
    phase,
    editionDate,
    editionDay: formatDay(editionDate),
    doorsOpen,
    doorsTime: formatDoorsTime(doorsOpen),
    access: settings.access,
    // Before the sale opens, buttons lead to the ticket info on the Event page.
    canBuy: phase !== "presale" && phase !== "past" && Boolean(ticketUrl),
    ticketUrl,
  };
}
