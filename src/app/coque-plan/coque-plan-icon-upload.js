// Icône ajoutée depuis l'éditeur : le fichier (SVG, PNG, JPG, WebP) est redessiné en PNG de 96 px
// dans le navigateur. On n'enregistre jamais le SVG lui-même (pas de script possible), seulement
// l'image. Deux versions : les couleurs d'origine, et une silhouette blanche (comme les icônes de
// base, posée sur la couleur du repère).
const SIZE = 96;
const MAX_FILE = 2 * 1024 * 1024;
export const ICON_FILE_TYPES = "image/svg+xml,image/png,image/jpeg,image/webp";

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image"));
    img.src = url;
  });
}

export async function processIconFile(file) {
  if (!file || !ICON_FILE_TYPES.split(",").includes(file.type)) throw new Error("type");
  if (file.size > MAX_FILE) throw new Error("size");
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    // Un SVG sans largeur/hauteur a une taille nulle : on le dessine au format carré
    const w = img.naturalWidth || SIZE;
    const h = img.naturalHeight || SIZE;
    const scale = Math.min(SIZE / w, SIZE / h);
    const canvas = document.createElement("canvas");
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, (SIZE - w * scale) / 2, (SIZE - h * scale) / 2, w * scale, h * scale);
    const src = canvas.toDataURL("image/png");

    // Silhouette blanche. Fond opaque (dessin noir sur blanc) : le foncé devient le tracé ;
    // fond transparent : la forme garde sa transparence.
    const data = ctx.getImageData(0, 0, SIZE, SIZE);
    const px = data.data;
    const corner = (x, y) => px[(y * SIZE + x) * 4 + 3];
    const opaque = [corner(0, 0), corner(SIZE - 1, 0), corner(0, SIZE - 1), corner(SIZE - 1, SIZE - 1)].every((a) => a > 200);
    for (let i = 0; i < px.length; i += 4) {
      const lum = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
      const alpha = opaque ? Math.max(0, Math.min(255, (255 - lum) * 1.6)) * (px[i + 3] / 255) : px[i + 3];
      px[i] = 255;
      px[i + 1] = 255;
      px[i + 2] = 255;
      px[i + 3] = alpha;
    }
    ctx.putImageData(data, 0, 0);
    const srcMono = canvas.toDataURL("image/png");
    const label = file.name.replace(/\.[a-z0-9]+$/i, "").replace(/[-_]+/g, " ").trim().slice(0, 30) || "Icône";
    return { id: `i${Date.now().toString(36)}`, label, labelEn: "", src, srcMono, mono: true };
  } finally {
    URL.revokeObjectURL(url);
  }
}
