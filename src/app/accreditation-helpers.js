import accreditationPlanUrl from "../assets/accreditation-plan.png";
import accreditationQrPhotosUrl from "../assets/accreditation-qr-photos.png";
import accreditationQrResultsLiveAthleteUrl from "../assets/accreditation-qr-results-live-athlete.png";
import accreditationQrRoadbookUrl from "../assets/accreditation-qr-roadbook.png";
import meetingLogoBleuUrl from "../assets/accreditation-meeting-bleu.png";
import meetingLogoNoirUrl from "../assets/accreditation-meeting-noir.png";
import meetingLogoPrincipalUrl from "../assets/accreditation-meeting-principal.png";
import meetingLogoRougeUrl from "../assets/accreditation-meeting-rouge.png";
import sponsorsStripUrl from "../assets/accreditation-sponsors-strip.png";
import { extractRolesFromProfile } from "./utils.js";
import { normalizeSubRoles } from "./team-config.js";

function sortAccreditationZones(zones) {
  return [...zones].sort((left, right) => {
    if (left.order !== right.order) return left.order - right.order;
    return left.name.localeCompare(right.name);
  });
}

function getRoleByNameFromRoles(roles, roleName, normalizeComparableValue) {
  return roles.find((role) => normalizeComparableValue(role?.roleName) === normalizeComparableValue(roleName)) ?? null;
}

function getRoleZoneIdsByNameFromConfig(roleName, roles, roleZoneAssignments, normalizeComparableValue) {
  const matchingRole = getRoleByNameFromRoles(roles, roleName, normalizeComparableValue);
  if (!matchingRole) return [];
  return roleZoneAssignments[matchingRole.id] ?? [];
}

function getAccreditationFinalZoneIds({ assignedRoles, roles, zones, roleZoneAssignments, override, normalizeComparableValue }) {
  const inheritedZoneIds = normalizeSubRoles(
    assignedRoles.flatMap((roleName) =>
      getRoleZoneIdsByNameFromConfig(roleName, roles, roleZoneAssignments, normalizeComparableValue),
    ),
  );
  const normalizedOverride = override ?? { addZoneIds: [], removeZoneIds: [], badgeStatus: "A produire" };

  return sortAccreditationZones(zones)
    .map((zone) => zone.id)
    .filter((zoneId) => {
      if (normalizedOverride.removeZoneIds.includes(zoneId)) return false;
      return inheritedZoneIds.includes(zoneId) || normalizedOverride.addZoneIds.includes(zoneId);
    });
}

function buildAccreditationUsers(users, teamAssignments) {
  const usersById = new Map();

  users.forEach((user) => {
    const assignedRoles = normalizeSubRoles(
      Array.isArray(user?.assignedTeams) ? user.assignedTeams : user?.assignedRole ? [user.assignedRole] : [],
    );
    const profileRoles = extractRolesFromProfile(user);
    const shouldAppearInAccreditations =
      assignedRoles.length > 0 ||
      profileRoles.some((role) => ["benevole", "chef_equipe", "gestionnaire", "admin"].includes(role));

    if (!shouldAppearInAccreditations) return;

    usersById.set(String(user.id || user.uid || "").trim(), {
      id: String(user.id || user.uid || "").trim(),
      uid: String(user.uid || user.id || "").trim(),
      firstName: String(user.firstName || ""),
      lastName: String(user.lastName || ""),
      email: String(user.email || ""),
      phone: String(user.phone || ""),
      presence: user?.presence && typeof user.presence === "object" ? user.presence : {},
      assignedRoles,
      assignedRole: assignedRoles[0] || "",
      assignmentStatus: String(user.assignmentStatus || (assignedRoles.length ? "Proposé" : "En attente")),
      workflowStatus: String(user.workflowStatus || ""),
      teamRole: String(user.teamRole || "Bénévole"),
      teamRoleAssignments:
        user?.teamRoleAssignments && typeof user.teamRoleAssignments === "object" ? user.teamRoleAssignments : {},
    });
  });

  teamAssignments.forEach((assignment) => {
    const userId = String(assignment?.id || "").trim();
    if (!userId) return;

    const existing = usersById.get(userId) ?? {
      id: userId,
      uid: userId,
      firstName: String(assignment?.firstName || ""),
      lastName: String(assignment?.lastName || ""),
      email: String(assignment?.email || ""),
      phone: String(assignment?.phone || ""),
      presence: {},
      assignedRoles: [],
      assignedRole: "",
      assignmentStatus: "Proposé",
      workflowStatus: "",
      teamRole: "Bénévole",
      teamRoleAssignments: {},
    };

    const nextAssignedRoles = normalizeSubRoles([...existing.assignedRoles, assignment?.assignedRole].filter(Boolean));
    const nextAssignedRole = existing.assignedRole || nextAssignedRoles[0] || "";

    usersById.set(userId, {
      ...existing,
      assignedRoles: nextAssignedRoles,
      assignedRole: nextAssignedRole,
      assignmentStatus:
        nextAssignedRoles.length > 0 && (!existing.assignmentStatus || existing.assignmentStatus === "En attente")
          ? "Proposé"
          : existing.assignmentStatus || "En attente",
      teamRoleAssignments: assignment?.assignedRole
        ? {
            ...existing.teamRoleAssignments,
            [assignment.assignedRole]: String(assignment?.teamRole || existing.teamRole || "Bénévole"),
          }
        : existing.teamRoleAssignments,
      teamRole:
        (nextAssignedRole && assignment?.assignedRole === nextAssignedRole
          ? String(assignment?.teamRole || "")
          : "") || existing.teamRole,
    });
  });

  return [...usersById.values()].sort((left, right) => {
    const leftName = `${left.lastName} ${left.firstName}`.trim() || left.email;
    const rightName = `${right.lastName} ${right.firstName}`.trim() || right.email;
    return leftName.localeCompare(rightName, "fr", { sensitivity: "base" });
  });
}

function buildAccreditationRoleLabel(roleNames = []) {
  if (!roleNames.length) return "";
  if (roleNames.length === 1) return roleNames[0];
  return `${roleNames.slice(0, -1).join(", ")} et ${roleNames[roleNames.length - 1]}`;
}

function isAccreditationRoleConfirmed(volunteer, normalizeComparableValue) {
  const assignmentStatus = normalizeComparableValue(volunteer?.assignmentStatus);
  const workflowStatus = normalizeComparableValue(volunteer?.workflowStatus);
  return assignmentStatus === "confirme" || workflowStatus === "confirme";
}

function getConfirmedAccreditationRoleNames(volunteer, normalizeComparableValue) {
  return isAccreditationRoleConfirmed(volunteer, normalizeComparableValue)
    ? normalizeSubRoles(volunteer?.assignedRoles || [volunteer?.assignedRole].filter(Boolean))
    : [];
}

function getBadgeRoleLabel(volunteer, override, normalizeComparableValue) {
  const manualLabel = String(override?.badgeLabel || "").trim();
  if (manualLabel) return manualLabel;

  const confirmedRoles = getConfirmedAccreditationRoleNames(volunteer, normalizeComparableValue);
  if (confirmedRoles.length) return buildAccreditationRoleLabel(confirmedRoles);

  const assignedRoles = normalizeSubRoles(volunteer?.assignedRoles || [volunteer?.assignedRole].filter(Boolean));
  return buildAccreditationRoleLabel(assignedRoles);
}

function getAccreditationStatusClass(status) {
  switch (String(status || "").trim()) {
    case "Dans la file":
      return "workflow-pill workflow-pill--assigned";
    case "Imprimé":
    case "Remis":
      return "workflow-pill workflow-pill--confirmed";
    case "Annulé":
    case "Imprimé à détruire":
      return "workflow-pill workflow-pill--cancelled";
    default:
      return "workflow-pill workflow-pill--received";
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function buildAccreditationPrintHistoryMarkup(items, formatDateTimeForDisplay) {
  const rows = items
    .map(
      (item) => `
        <tr>
          <td>${escapeHtml(item.name || "-")}</td>
          <td>${escapeHtml(item.roleLabel || "-")}</td>
          <td>${escapeHtml((item.zoneLabels || []).join(", ") || "-")}</td>
          <td>${escapeHtml(item.printedAt ? formatDateTimeForDisplay(item.printedAt) : "-")}</td>
          <td>${escapeHtml(item.generatedBy || "-")}</td>
        </tr>
      `,
    )
    .join("");

  return `<!doctype html>
  <html lang="fr">
    <head>
      <meta charset="utf-8" />
      <title>Liste des impressions effectuées</title>
      <style>
        @page { size: A4 portrait; margin: 12mm; }
        body { margin: 0; font-family: Arial, sans-serif; color: #102936; }
        h1 { margin: 0 0 6mm; font-size: 20pt; }
        p { margin: 0 0 8mm; color: #4d6671; }
        table { width: 100%; border-collapse: collapse; }
        th, td { text-align: left; padding: 3mm; border-bottom: 0.4mm solid #d8e3e8; vertical-align: top; }
        th { text-transform: uppercase; font-size: 9pt; letter-spacing: 0.05em; color: #617985; }
        td { font-size: 10.5pt; }
      </style>
    </head>
    <body>
      <h1>Liste des impressions effectuées</h1>
      <p>${escapeHtml(`Total: ${items.length} badge(s)`)}</p>
      <table>
        <thead>
          <tr>
            <th>Personne</th>
            <th>Rôle badge</th>
            <th>Zones</th>
            <th>Imprimé le</th>
            <th>Généré par</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <script>
        window.onload = () => {
          window.print();
        };
      </script>
    </body>
  </html>`;
}

function toggleIdInList(list, value) {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

function formatZoneLabel(zone) {
  return `${zone.order}. ${zone.name}`;
}

function chunkItems(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function renderZonePills(zoneLabels, className = "") {
  return zoneLabels.map((zoneLabel) => `<span class="${className}">${escapeHtml(zoneLabel)}</span>`).join("");
}

function getBadgeResourceCards(item) {
  const sharedResultsCard = {
    src: accreditationQrResultsLiveAthleteUrl,
    title: "Resultats live",
    subtitle: "Suivi des performances",
  };

  if (Array.isArray(item?.resourceCards)) {
    return item.resourceCards.filter((card) => card?.src && card?.title);
  }

  if (item?.includeVolunteerResources) {
    return [
      sharedResultsCard,
      {
        src: accreditationQrRoadbookUrl,
        title: "Volunteer roadbook",
        subtitle: "Infos utiles benevoles",
      },
      {
        src: accreditationQrPhotosUrl,
        title: "Photos live",
        subtitle: "Album evenement",
      },
    ];
  }

  return [sharedResultsCard];
}

function normalizePrintableLabel(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function buildBadgePrintMarkup(items, options = {}) {
  const pages = chunkItems(items, 4);
  const legendZoneLabels = Array.isArray(options.legendZoneLabels) ? options.legendZoneLabels : [];

  const renderLegendPills = (authorizedLabels = []) =>
    legendZoneLabels.length
      ? legendZoneLabels
          .map((zoneLabel) => {
            const activeClass = authorizedLabels.includes(zoneLabel)
              ? "print-badge__legend-pill print-badge__legend-pill--active"
              : "print-badge__legend-pill";
            return `<span class="${activeClass}">${escapeHtml(zoneLabel)}</span>`;
          })
          .join("")
      : renderZonePills(authorizedLabels, "print-badge__legend-pill print-badge__legend-pill--active");

  const resolveMeetingLogo = (authorizedLabels = []) => {
    const normalizedAuthorizedLabels = authorizedLabels.map(normalizePrintableLabel);
    const normalizedLegendLabels = legendZoneLabels.map(normalizePrintableLabel).filter(Boolean);
    const hasAnyZone = normalizedAuthorizedLabels.length > 0;
    const hasInfield = normalizedAuthorizedLabels.some((label) => label.includes("infield"));
    const hasAllZones =
      normalizedLegendLabels.length > 0 &&
      normalizedLegendLabels.every((label) => normalizedAuthorizedLabels.includes(label));

    if (!hasAnyZone) return meetingLogoNoirUrl;
    if (hasAllZones) return meetingLogoPrincipalUrl;
    if (hasInfield) return meetingLogoBleuUrl;
    return meetingLogoRougeUrl;
  };

  const renderFrontBadge = (item) => `
    <article class="print-badge print-badge--front">
      <div class="print-badge__topline">
        <div class="print-badge__eyebrow">CMCM Luxembourg Indoor Meeting 2027</div>
        <div class="print-badge__eyebrow print-badge__eyebrow--muted">Accreditation officielle</div>
      </div>
      <div class="print-badge__brand">
        <img src="${resolveMeetingLogo(item.zoneLabels)}" alt="CMCM Luxembourg Indoor Meeting" />
      </div>
      <div class="print-badge__identity">
        <div class="print-badge__role">${escapeHtml(item.role || "Accreditation")}</div>
        <div class="print-badge__name">${escapeHtml(item.name || " ")}</div>
      </div>
      <div class="print-badge__access-card">
        <div class="print-badge__access-label">Zones d'acces</div>
        <div class="print-badge__zones">
          ${renderZonePills(item.zoneLabels, "print-badge__zone-pill")}
        </div>
      </div>
      <div class="print-badge__sponsors">
        <div class="print-badge__sponsors-label">Avec le soutien de</div>
        <div class="print-badge__sponsors-strip">
          <img src="${sponsorsStripUrl}" alt="FLA, European Athletics, Coque, Ville de Luxembourg, CMCM et Luxembourg" />
        </div>
      </div>
    </article>
  `;

  const renderBackBadge = (item) => `
    <article class="print-badge print-badge--back">
      <div class="print-badge__back-head">
        <div class="print-badge__back-title">Plan d'acces</div>
        <div class="print-badge__back-role">${escapeHtml(item.role || "Accreditation")}</div>
      </div>
      <div class="print-badge__back-legend">
        <div class="print-badge__back-label">Legende des zones</div>
        <div class="print-badge__legend-grid">
          ${renderLegendPills(item.zoneLabels)}
        </div>
      </div>
      <div class="print-badge__back-plan">
        <img src="${accreditationPlanUrl}" alt="Plan accreditation" />
      </div>
      ${
        getBadgeResourceCards(item).length
          ? `
      <div class="print-badge__resource-strip">
        ${getBadgeResourceCards(item)
          .map(
            (card) => `
        <div class="print-badge__resource-card">
          <img src="${card.src}" alt="${escapeHtml(card.alt || card.title)}" />
          <div class="print-badge__resource-text">
            <strong>${escapeHtml(card.title)}</strong>
            <span>${escapeHtml(card.subtitle || "")}</span>
          </div>
        </div>`,
          )
          .join("")}
      </div>`
          : ""
      }
    </article>
  `;

  const frontPages = pages
    .map(
      (page) => `
        <section class="print-sheet">
          ${page.map(renderFrontBadge).join("")}
        </section>
      `,
    )
    .join("");

  const backPages = pages
    .map(
      (page) => `
        <section class="print-sheet print-sheet--back">
          ${page.map(renderBackBadge).join("")}
        </section>
      `,
    )
    .join("");

  return `<!doctype html>
  <html lang="fr">
    <head>
      <meta charset="utf-8" />
      <title>Impression accreditations</title>
      <style>
        @page { size: A4 portrait; margin: 10mm; }
        * { box-sizing: border-box; }
        body {
          margin: 0;
          font-family: Arial, sans-serif;
          color: #111;
          background: #fff;
        }
        .print-sheet {
          width: 190mm;
          min-height: 277mm;
          display: grid;
          grid-template-columns: repeat(2, 92mm);
          grid-template-rows: repeat(2, 135.5mm);
          gap: 6mm;
          justify-content: space-between;
          align-content: space-between;
          break-after: page;
          page-break-after: always;
        }
        .print-sheet:last-child {
          break-after: auto;
          page-break-after: auto;
        }
        .print-badge {
          border: 0.55mm solid #d6e2ea;
          border-radius: 8mm;
          overflow: hidden;
          width: 92mm;
          min-height: 135.5mm;
          height: 135.5mm;
          display: flex;
          flex-direction: column;
          padding: 6mm;
          background: linear-gradient(180deg, #ffffff, #fbfdff);
          box-shadow: inset 0 0 0 0.4mm rgba(255, 255, 255, 0.94);
        }
        .print-badge--front {
          gap: 4mm;
        }
        .print-badge__topline {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 5mm;
          padding-bottom: 3mm;
          border-bottom: 0.45mm solid #dce8ef;
        }
        .print-badge__eyebrow {
          font-size: 7.1pt;
          font-weight: 700;
          text-transform: uppercase;
          color: #15364a;
          letter-spacing: 0.08em;
        }
        .print-badge__eyebrow--muted {
          color: #6f8794;
          text-align: right;
        }
        .print-badge__brand {
          display: flex;
          justify-content: center;
          align-items: center;
          min-height: 19mm;
          padding: 0.5mm 0 1.5mm;
        }
        .print-badge__brand img {
          width: 58mm;
          max-width: 100%;
          height: auto;
          object-fit: contain;
        }
        .print-badge__identity {
          display: grid;
          gap: 3mm;
          padding: 2mm 0 0.5mm;
        }
        .print-badge__role {
          font-size: 11.5pt;
          line-height: 1.12;
          font-weight: 800;
          text-transform: uppercase;
          color: #163549;
          letter-spacing: 0.02em;
        }
        .print-badge__name {
          min-height: 13mm;
          font-size: 15pt;
          line-height: 1.04;
          font-weight: 800;
          text-transform: uppercase;
          color: #091923;
          border-left: 1.1mm solid #1590cf;
          padding-left: 3mm;
        }
        .print-badge__access-card {
          display: grid;
          gap: 2.2mm;
          padding: 3mm;
          border-radius: 4mm;
          background: #f4f9fc;
          border: 0.45mm solid #d8e8f0;
        }
        .print-badge__access-label {
          font-size: 6.8pt;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: #64808f;
        }
        .print-badge__zones {
          display: flex;
          flex-wrap: wrap;
          gap: 2.6mm;
        }
        .print-badge__sponsors {
          margin-top: auto;
          display: grid;
          gap: 1.6mm;
          padding-top: 2.4mm;
          border-top: 0.35mm solid #e2ebf1;
        }
        .print-badge__sponsors-label {
          font-size: 5.8pt;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.07em;
          color: #8aa0ae;
        }
        .print-badge__sponsors-strip {
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 13mm;
          width: 100%;
          margin: 0 auto;
        }
        .print-badge__sponsors-strip img {
          display: block;
          width: 100%;
          max-width: 70mm;
          height: auto;
          object-fit: contain;
          object-position: center;
          margin: 0 auto;
        }
        .print-badge__zone-pill {
          border: 0.45mm solid #c9dbe7;
          border-radius: 999px;
          padding: 1.1mm 2.2mm;
          font-size: 6.8pt;
          font-weight: 700;
          background: #ffffff;
          color: #163549;
        }
        .print-badge__legend-pill {
          border: 0.35mm solid #d7e3ea;
          border-radius: 999px;
          padding: 0.7mm 1.7mm;
          font-size: 5.8pt;
          font-weight: 700;
          background: #ffffff;
          color: #7a8f9b;
        }
        .print-badge__legend-pill--active {
          border-color: #a7d0e6;
          background: #edf7fc;
          color: #12384d;
        }
        .print-badge--back {
          gap: 3mm;
          background: linear-gradient(180deg, #ffffff, #f9fcfe);
          color: #11374b;
        }
        .print-badge__back-head {
          display: grid;
          gap: 1.5mm;
          padding-bottom: 3mm;
          border-bottom: 0.45mm solid #dce8ef;
        }
        .print-badge__back-title {
          font-size: 7pt;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: #587487;
        }
        .print-badge__back-role {
          font-size: 10.5pt;
          font-weight: 800;
          text-transform: uppercase;
        }
        .print-badge__back-legend {
          margin-top: 1mm;
          display: grid;
          gap: 1.5mm;
        }
        .print-badge__back-label {
          font-size: 6.8pt;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: #6a8291;
        }
        .print-badge__legend-grid {
          display: flex;
          flex-wrap: wrap;
          gap: 1.3mm;
        }
        .print-badge__back-plan {
          flex: 1;
          display: flex;
          align-items: stretch;
          justify-content: center;
          padding: 0;
          min-height: 0;
        }
        .print-badge__back-plan img {
          width: 100%;
          height: 100%;
          object-fit: contain;
        }
        .print-badge__resource-strip {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 1.2mm;
          margin-top: auto;
          padding-top: 1.4mm;
        }
        .print-badge__resource-card {
          display: grid;
          grid-template-columns: 1fr;
          gap: 1mm;
          align-items: start;
          justify-items: center;
          padding: 1.2mm 1mm;
          border-radius: 2.4mm;
          background: #f6fafc;
          border: 0.35mm solid #d8e8f0;
        }
        .print-badge__resource-card img {
          width: 13.5mm;
          height: 13.5mm;
          object-fit: contain;
          background: #fff;
          border-radius: 2mm;
        }
        .print-badge__resource-text {
          display: grid;
          gap: 0.3mm;
          min-width: 0;
          text-align: center;
        }
        .print-badge__resource-text strong {
          font-size: 5.2pt;
          color: #12384d;
          line-height: 1.1;
        }
        .print-badge__resource-text span {
          font-size: 4.6pt;
          color: #6a8291;
          line-height: 1.1;
        }
      </style>
    </head>
    <body>
      ${frontPages}
      ${backPages}
      <script>
        window.onload = () => {
          window.print();
        };
      </script>
    </body>
  </html>`;
}

export {
  buildAccreditationPrintHistoryMarkup,
  buildAccreditationRoleLabel,
  buildAccreditationUsers,
  buildBadgePrintMarkup,
  formatZoneLabel,
  getAccreditationFinalZoneIds,
  getAccreditationStatusClass,
  getBadgeRoleLabel,
  getConfirmedAccreditationRoleNames,
  sortAccreditationZones,
  toggleIdInList,
};
