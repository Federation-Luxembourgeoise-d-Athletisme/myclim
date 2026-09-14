import cmcmLogo from "../assets/cmcm-logo.png";
import signatureMargot from "../assets/signature-margot.png";

function normalizePresenceRecord(record = {}) {
  const normalizedStatus = ["present", "absent"].includes(String(record?.status || "").trim().toLowerCase())
    ? String(record.status).trim().toLowerCase()
    : "absent";

  return {
    status: normalizedStatus,
    checkedInAt: record?.checkedInAt || null,
    checkedInBy: String(record?.checkedInBy || "").trim(),
    accreditationDeliveredAt: record?.accreditationDeliveredAt || null,
    accreditationDeliveredBy: String(record?.accreditationDeliveredBy || "").trim(),
    tshirtDeliveredAt: record?.tshirtDeliveredAt || null,
    tshirtDeliveredBy: String(record?.tshirtDeliveredBy || "").trim(),
    lunchCollectedAt: record?.lunchCollectedAt || null,
    lunchCollectedBy: String(record?.lunchCollectedBy || "").trim(),
    departureTime: String(record?.departureTime || "").trim(),
    departureRecordedAt: record?.departureRecordedAt || null,
    departureRecordedBy: String(record?.departureRecordedBy || "").trim(),
    missionCompletedAt: record?.missionCompletedAt || null,
    missionCompletedBy: String(record?.missionCompletedBy || "").trim(),
  };
}

function getPresenceStatusLabel(status, normalizeComparableValue) {
  return normalizeComparableValue(status) === "present" ? "Présent" : "Absent";
}

function getPresenceStatusClass(status, normalizeComparableValue) {
  return normalizeComparableValue(status) === "present" ? "status-pill status-pill--ok" : "status-pill status-pill--danger";
}

function isPresenceLocked(record) {
  return Boolean(record?.missionCompletedAt);
}

function formatTimeForDisplay(value) {
  const normalizedValue = String(value || "").trim();
  return normalizedValue || "Non renseigné";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getRoundedParticipationHours(record, getTimestampMs) {
  const presence = normalizePresenceRecord(record);
  const arrivalTimestamp = getTimestampMs(presence.checkedInAt);
  if (!arrivalTimestamp) return 0;

  let departureTimestamp = 0;
  const departureValue = String(presence.departureTime || "").trim();

  if (/^\d{2}:\d{2}$/.test(departureValue)) {
    const arrivalDate = new Date(arrivalTimestamp);
    const [hours, minutes] = departureValue.split(":").map((item) => Number(item));
    const departureDate = new Date(arrivalDate);
    departureDate.setHours(hours, minutes, 0, 0);
    departureTimestamp = departureDate.getTime();
  } else if (presence.missionCompletedAt) {
    departureTimestamp = getTimestampMs(presence.missionCompletedAt);
  }

  if (!departureTimestamp || departureTimestamp <= arrivalTimestamp) return 0;

  const durationHours = (departureTimestamp - arrivalTimestamp) / (1000 * 60 * 60);
  return Math.max(1, Math.ceil(durationHours));
}

function buildParticipationCertificateMarkup({
  fullName,
  teamName,
  roleLabel,
  roundedHours,
  signatory,
  editionLabel,
  signatoryTitle,
  signatureImageUrl,
}) {
  const issueDate = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(new Date());

  const signatureLabel = signatory || "Margot Laporte";
  const editionDisplayLabel = String(editionLabel || "").trim() || "Edition 2027";
  const signatureRoleLabel = String(signatoryTitle || "").trim() || "Head of CMCM Luxembourg Indoor Meeting";
  const signatureImageSrc = String(signatureImageUrl || "").trim() || signatureMargot;

  return `<!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <title>Certificate of Participation</title>
      <style>
        @page { size: A4 portrait; margin: 18mm; }
        * { box-sizing: border-box; }
        body {
          margin: 0;
          font-family: "Aptos", "Segoe UI", Arial, sans-serif;
          color: #163748;
          background: #ffffff;
        }
        .certificate {
          min-height: 259mm;
          border: 0.8mm solid #d9e2ea;
          padding: 18mm;
          background: #fff;
        }
        .certificate__header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 12mm;
          margin-bottom: 14mm;
          padding-bottom: 8mm;
          border-bottom: 0.5mm solid #d9e2ea;
        }
        .certificate__brand {
          display: grid;
          gap: 3mm;
        }
        .certificate__logo {
          width: 22mm;
          height: 22mm;
          object-fit: contain;
        }
        .certificate__eyebrow {
          text-transform: uppercase;
          letter-spacing: 0.18em;
          font-size: 8.5pt;
          color: #6a7f8c;
          font-weight: 700;
        }
        .certificate__org {
          font-size: 11pt;
          color: #173849;
          font-weight: 700;
        }
        .certificate__edition {
          margin-top: 1mm;
          font-size: 10pt;
          color: #5f7480;
          font-weight: 600;
        }
        .certificate h1 {
          margin: 0 0 5mm;
          font-size: 24pt;
          line-height: 1.05;
          color: #103b58;
        }
        .certificate p {
          margin: 0 0 5mm;
          font-size: 12pt;
          line-height: 1.65;
          color: #23414c;
        }
        .certificate__name {
          margin: 12mm 0 8mm;
          font-size: 22pt;
          font-weight: 800;
          color: #d82f3f;
          letter-spacing: 0.01em;
        }
        .certificate__meta {
          display: grid;
          gap: 3mm;
          margin-top: 10mm;
          padding: 6mm 7mm;
          border-radius: 4mm;
          border: 0.4mm solid #d9e2ea;
          background: #fbfcfd;
        }
        .certificate__meta strong {
          color: #103b58;
        }
        .certificate__footer {
          margin-top: 20mm;
          display: flex;
          justify-content: space-between;
          gap: 12mm;
          align-items: end;
        }
        .certificate__signature-block {
          min-width: 90mm;
          text-align: left;
        }
        .certificate__signature-image {
          display: block;
          width: 44mm;
          max-width: 100%;
          height: auto;
          margin: 0 0 3mm;
          object-fit: contain;
        }
        .certificate__signature-line {
          border-top: 0.4mm solid #9db0bc;
          padding-top: 3mm;
        }
        .certificate__signature-name {
          font-weight: 700;
          color: #103b58;
          font-size: 11pt;
        }
        .certificate__signature-role {
          margin-top: 1mm;
          font-size: 9.5pt;
          color: #5a707d;
          line-height: 1.45;
        }
        .certificate__print-note {
          margin-top: 10mm;
          font-size: 8.8pt;
          color: #758a96;
        }
        @media print {
          .certificate__print-note {
            display: none;
          }
        }
      </style>
    </head>
    <body>
      <main class="certificate">
        <header class="certificate__header">
          <div class="certificate__brand">
            <img class="certificate__logo" src="${cmcmLogo}" alt="CMCM Luxembourg Indoor Meeting logo" />
            <div class="certificate__eyebrow">CMCM Luxembourg Indoor Meeting</div>
            <div class="certificate__org">Federation Luxembourgeoise d'Athletisme</div>
            <div class="certificate__edition">${escapeHtml(editionDisplayLabel)}</div>
          </div>
        </header>
        <h1>Certificate of Participation</h1>
        <p>This document certifies the volunteer contribution of</p>
        <div class="certificate__name">${escapeHtml(fullName || "Bénévole")}</div>
        <p>
          to the organisation of the meeting within the <strong>${escapeHtml(teamName || "Team not specified")}</strong>
          ${roleLabel ? ` team as <strong>${escapeHtml(roleLabel)}</strong>` : ""}.
        </p>
        <div class="certificate__meta">
          <div><strong>Validated volunteer hours:</strong> ${escapeHtml(String(roundedHours || 0))} hour(s), rounded up.</div>
          <div><strong>Issue date:</strong> ${escapeHtml(issueDate)}</div>
        </div>
        <div class="certificate__footer">
          <div>
            <p>Thank you for contributing to the success of the CMCM Luxembourg Indoor Meeting.</p>
          </div>
          <div class="certificate__signature-block">
            <img class="certificate__signature-image" src="${signatureImageSrc}" alt="${escapeHtml(signatureLabel)} signature" />
            <div class="certificate__signature-line">
              <div class="certificate__signature-name">${escapeHtml(signatureLabel)}</div>
              <div class="certificate__signature-role">${escapeHtml(signatureRoleLabel)}<br />for the Federation Luxembourgeoise d'Athletisme</div>
            </div>
          </div>
        </div>
        <p class="certificate__print-note">Use your browser print dialog to print or save this certificate as PDF.</p>
      </main>
    </body>
  </html>`;
}

export {
  buildParticipationCertificateMarkup,
  formatTimeForDisplay,
  getPresenceStatusClass,
  getPresenceStatusLabel,
  getRoundedParticipationHours,
  isPresenceLocked,
  normalizePresenceRecord,
};
