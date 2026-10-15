// Removes the empty border (transparent or white) around an uploaded logo, so
// that the logo itself, not its margins, is what gets sized on the site.
// Runs in the browser on the local file, before upload.

const SCAN_MAX_SIDE = 1200;
const OUTPUT_MAX_SIDE = 1600;
const ALPHA_THRESHOLD = 16;
const WHITE_THRESHOLD = 245;
const KEEP_MARGIN = 0.02;

function isTrimmableType(type) {
  return type === "image/png" || type === "image/webp" || type === "image/jpeg";
}

function isBackgroundPixel(data, index, transparentBackground) {
  const alpha = data[index + 3];
  if (alpha < ALPHA_THRESHOLD) return true;
  if (transparentBackground) return false;
  return data[index] >= WHITE_THRESHOLD && data[index + 1] >= WHITE_THRESHOLD && data[index + 2] >= WHITE_THRESHOLD;
}

/**
 * Finds the content box in RGBA pixel data. The background is transparent when
 * the corners are transparent, otherwise white when the corners are white.
 * Logos on any other background (e.g. a coloured badge) are left untouched.
 */
export function findLogoContentBounds(data, width, height) {
  const corners = [0, width - 1, (height - 1) * width, height * width - 1].map((pixel) => pixel * 4);
  const transparentBackground = corners.every((index) => data[index + 3] < ALPHA_THRESHOLD);
  const whiteBackground = corners.every((index) => isBackgroundPixel(data, index, false));
  if (!transparentBackground && !whiteBackground) return null;

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (isBackgroundPixel(data, (y * width + x) * 4, transparentBackground)) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  if (maxX < 0) return null;
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Logo export failed."))), "image/png");
  });
}

/**
 * Returns a trimmed PNG copy of the logo, or the original file when it is not
 * a raster image, has no empty border, or cannot be read.
 */
export async function trimLogoFile(file) {
  if (!file || !isTrimmableType(file.type) || typeof createImageBitmap !== "function") return file;

  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file;
  }

  try {
    const scanScale = Math.min(1, SCAN_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const scanWidth = Math.max(1, Math.round(bitmap.width * scanScale));
    const scanHeight = Math.max(1, Math.round(bitmap.height * scanScale));
    const scanCanvas = document.createElement("canvas");
    scanCanvas.width = scanWidth;
    scanCanvas.height = scanHeight;
    const scanContext = scanCanvas.getContext("2d", { willReadFrequently: true });
    scanContext.drawImage(bitmap, 0, 0, scanWidth, scanHeight);
    const bounds = findLogoContentBounds(scanContext.getImageData(0, 0, scanWidth, scanHeight).data, scanWidth, scanHeight);
    if (!bounds) return file;

    // Back to original pixels, keeping a thin margin so edges are not clipped.
    const margin = Math.round(Math.max(bounds.width, bounds.height) * KEEP_MARGIN);
    const left = Math.max(0, (bounds.x - margin) / scanScale);
    const top = Math.max(0, (bounds.y - margin) / scanScale);
    const right = Math.min(bitmap.width, (bounds.x + bounds.width + margin) / scanScale);
    const bottom = Math.min(bitmap.height, (bounds.y + bounds.height + margin) / scanScale);
    const cropWidth = right - left;
    const cropHeight = bottom - top;

    const keepsAlmostEverything = cropWidth * cropHeight > bitmap.width * bitmap.height * 0.95;
    const isOversized = Math.max(bitmap.width, bitmap.height) > OUTPUT_MAX_SIDE;
    if (keepsAlmostEverything && !isOversized) return file;

    const outputScale = Math.min(1, OUTPUT_MAX_SIDE / Math.max(cropWidth, cropHeight));
    const outputCanvas = document.createElement("canvas");
    outputCanvas.width = Math.max(1, Math.round(cropWidth * outputScale));
    outputCanvas.height = Math.max(1, Math.round(cropHeight * outputScale));
    outputCanvas.getContext("2d").drawImage(bitmap, left, top, cropWidth, cropHeight, 0, 0, outputCanvas.width, outputCanvas.height);

    const blob = await canvasToBlob(outputCanvas);
    const baseName = file.name.replace(/\.[^.]+$/, "") || "logo";
    return new File([blob], `${baseName}.png`, { type: "image/png" });
  } catch {
    return file;
  } finally {
    bitmap.close?.();
  }
}
