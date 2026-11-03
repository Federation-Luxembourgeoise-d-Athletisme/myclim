export const DEFAULT_SPONSOR_MEDIA_SETTINGS = {
  logoFit: "contain",
  logoPositionX: 50,
  logoPositionY: 50,
  logoScale: 100,
};

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function normalizeNumber(value, fallback) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

export function getSponsorMediaSettings(sponsor = {}) {
  const fit = sponsor.logoFit === "cover" ? "cover" : DEFAULT_SPONSOR_MEDIA_SETTINGS.logoFit;
  const positionX = clamp(normalizeNumber(sponsor.logoPositionX, DEFAULT_SPONSOR_MEDIA_SETTINGS.logoPositionX), 0, 100);
  const positionY = clamp(normalizeNumber(sponsor.logoPositionY, DEFAULT_SPONSOR_MEDIA_SETTINGS.logoPositionY), 0, 100);
  const scale = clamp(normalizeNumber(sponsor.logoScale, DEFAULT_SPONSOR_MEDIA_SETTINGS.logoScale), 60, 200);

  return {
    logoFit: fit,
    logoPositionX: positionX,
    logoPositionY: positionY,
    logoScale: scale,
  };
}

// Share of the box area every logo should cover, whatever its proportions.
const LOGO_TARGET_AREA = 0.4;
const LOGO_MAX_WIDTH = 0.95;
const LOGO_MAX_HEIGHT = 0.9;
// At equal area a long, thin logo reads lighter, so wide logos get a little more.
const WIDE_LOGO_BONUS = 0.2;

/**
 * Size a logo so that every logo has the same visual weight: a square logo and
 * a very wide one cover about the same area, instead of both being stretched
 * to the box edges. The area is capped by what a square logo can reach in the
 * box, so square logos are not left lighter than the others. The manual zoom
 * fine-tunes that size but never lets the logo leave its box.
 */
export function computeLogoSize({ boxWidth, boxHeight, ratio, scale = 100 }) {
  if (!(boxWidth > 0) || !(boxHeight > 0) || !(ratio > 0)) return null;

  const baseArea = Math.min(
    LOGO_TARGET_AREA * boxWidth * boxHeight,
    (LOGO_MAX_HEIGHT * boxHeight) ** 2,
    (LOGO_MAX_WIDTH * boxWidth) ** 2,
  );
  const area = baseArea * Math.max(1, ratio) ** WIDE_LOGO_BONUS;
  const zoom = clamp(normalizeNumber(scale, 100), 60, 200) / 100;
  let width = Math.sqrt(area * ratio) * zoom;
  let height = width / ratio;

  const fit = Math.min(1, (boxWidth * LOGO_MAX_WIDTH) / width, (boxHeight * LOGO_MAX_HEIGHT) / height);
  width *= fit;
  height *= fit;

  return { width: Math.round(width), height: Math.round(height) };
}

// Manual mode: the admin sets the logo size herself, as a share of its box
// (100 % = the whole logo fits the box edge to edge; above 100 % the empty
// margins of the file are cropped), and can shift it inside the box.
export const DEFAULT_MANUAL_LOGO = { logoBoxScale: 100, logoOffsetX: 0, logoOffsetY: 0 };

export function getManualLogoSettings(sponsor = {}) {
  if (sponsor.logoMode !== "manual") return null;
  return {
    logoBoxScale: clamp(normalizeNumber(sponsor.logoBoxScale, DEFAULT_MANUAL_LOGO.logoBoxScale), 20, 300),
    logoOffsetX: clamp(normalizeNumber(sponsor.logoOffsetX, 0), -50, 50),
    logoOffsetY: clamp(normalizeNumber(sponsor.logoOffsetY, 0), -50, 50),
  };
}

/**
 * Style of a manually sized logo. The image keeps the exact size of its box
 * (so no layout ever moves); it is scaled and shifted with a transform, and a
 * clip-path keeps only what falls inside the box, whatever the parent's
 * overflow.
 */
export function computeManualLogoStyle({ boxWidth, boxHeight, logoBoxScale, logoOffsetX, logoOffsetY }) {
  if (!(boxWidth > 0) || !(boxHeight > 0)) return null;
  const scale = logoBoxScale / 100;
  const dx = (logoOffsetX / 100) * boxWidth;
  const dy = (logoOffsetY / 100) * boxHeight;
  // Box window [0, W] × [0, H] expressed in the image's own coordinates.
  const toLocal = (value, size, shift) => size / 2 + (value - size / 2 - shift) / scale;
  const left = Math.max(0, toLocal(0, boxWidth, dx));
  const right = Math.max(0, boxWidth - toLocal(boxWidth, boxWidth, dx));
  const top = Math.max(0, toLocal(0, boxHeight, dy));
  const bottom = Math.max(0, boxHeight - toLocal(boxHeight, boxHeight, dy));

  return {
    width: boxWidth,
    height: boxHeight,
    maxWidth: "none",
    maxHeight: "none",
    objectFit: "contain",
    transform: `translate(${dx}px, ${dy}px) scale(${scale})`,
    transformOrigin: "50% 50%",
    clipPath: `inset(${top}px ${right}px ${bottom}px ${left}px)`,
  };
}

export function getSponsorMediaStyle(sponsor = {}) {
  const { logoFit, logoPositionX, logoPositionY, logoScale } = getSponsorMediaSettings(sponsor);

  return {
    objectFit: logoFit,
    objectPosition: `${logoPositionX}% ${logoPositionY}%`,
    transform: `scale(${logoScale / 100})`,
    transformOrigin: `${logoPositionX}% ${logoPositionY}%`,
  };
}
