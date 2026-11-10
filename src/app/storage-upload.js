import { auth, STORAGE_UPLOAD_ENDPOINT } from "../services/firebase";

// Envoi d'un fichier vers le stockage (même service que FileUpload) ;
// renvoie { fileUrl, fileName, filePath, mimeType }.
export async function uploadFileToStorage(file, storagePath) {
  const user = auth.currentUser;
  if (!user) throw new Error("Session expirée : reconnectez-vous.");
  const response = await fetch(STORAGE_UPLOAD_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${await user.getIdToken()}`,
      "Content-Type": file.type || "application/octet-stream",
      "X-Upload-Path": storagePath,
      "X-File-Name": encodeURIComponent(file.name),
    },
    body: file,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.url) throw new Error(payload?.message || `L'envoi de « ${file.name} » a échoué.`);
  return { fileUrl: payload.url, fileName: payload.fileName || file.name, filePath: payload.filePath || "", mimeType: payload.mimeType || file.type };
}
