// Official ticket pricing for the CMCM Luxembourg Indoor Meeting.
// Update this file when the organizing committee revises the pricing grid —
// it is the single source of truth for prices shown on the public site.
export const TICKET_PRICING = {
  earlyBirdDeadline: "18/12/2026",
  earlyBirdDeadlineLabel: "Dec 18, 2026",
  // Luxembourg time. Before saleOpensAt the ticket bar announces the sale
  // instead of selling; after earlyBirdEndsAt it shows the online price.
  saleOpensAt: "2026-11-17T10:00:00+01:00",
  saleOpensLabel: "17 November, 10:00",
  earlyBirdEndsAt: "2026-12-18T23:59:59+01:00",
  earlyBirdEndsLabel: "18 December",
  under18: {
    earlyBird: 0,
    online: 0,
    onSite: 0,
  },
  regular: {
    earlyBird: 8,
    online: 12,
    onSite: 15,
  },
  vip: {
    earlyBird: 60,
    online: 75,
    onSite: 90,
  },
};
