import { useRef, useState } from "react";
import { auth, STORAGE_UPLOAD_ENDPOINT } from "../services/firebase";

/**
 * FileUpload — drag-and-drop or click-to-select file uploader backed by Firebase Storage.
 *
 * Props:
 *   value        string   current URL (shows "existing file" state)
 *   onChange     fn(url)  called with the public download URL after upload completes
 *   accept       string   MIME type filter, e.g. "application/pdf"
 *   storagePath  string   Firebase Storage folder, e.g. "press-releases"
 *   label        string   field label
 *   prepareFile  fn(file) optional async transform applied before upload (e.g. trim a logo)
 */
export function FileUpload({
  value,
  onChange,
  onUploadComplete,
  prepareFile,
  accept = "application/pdf",
  storagePath = "uploads",
  label = "File",
  helperText = "PDF files only · Max 20 MB",
}) {
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef(null);
  const activeAttemptIdRef = useRef(0);

  const labelStyle = {
    fontSize: "0.78rem",
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: "#546770",
    display: "block",
    marginBottom: 6,
  };

  function isAttemptActive(attemptId) {
    return activeAttemptIdRef.current === attemptId;
  }

  function finishAttempt(attemptId) {
    if (activeAttemptIdRef.current === attemptId) {
      activeAttemptIdRef.current += 1;
    }
  }

  function formatUploadError(err) {
    const code = err?.code || "";

    if (code === "storage/unauthorized" || code === "storage/unauthenticated") {
      return "Votre session n'est plus valide pour le dépôt de fichiers. Reconnectez-vous puis réessayez.";
    }

    if (code === "storage/retry-limit-exceeded") {
      return "Firebase Storage ne répond pas assez vite. Réessayez dans quelques instants.";
    }

    if (code === "storage/direct-upload-timeout") {
      return "Le dépôt du fichier a expiré avant réponse de Firebase Storage.";
    }

    if (code === "storage/bucket-not-found" || code === "storage/project-not-found") {
      return "Le bucket Firebase Storage configuré pour ce projet est introuvable.";
    }

    return err?.message || "Upload impossible pour le moment.";
  }

  async function completeUpload(file, payload, attemptId) {
    if (!isAttemptActive(attemptId)) return;
    onChange(payload.url);
    onUploadComplete?.({
      url: payload.url,
      fileName: payload.fileName || file.name,
      filePath: payload.filePath || "",
      mimeType: payload.mimeType || file.type || "",
    });
    finishAttempt(attemptId);
    setStatusMessage("");
    setIsUploading(false);
  }

  async function uploadFile(selectedFile) {
    if (!selectedFile) return;

    const attemptId = activeAttemptIdRef.current + 1;
    activeAttemptIdRef.current = attemptId;
    setError("");
    setIsUploading(true);

    try {
      let file = selectedFile;
      if (prepareFile) {
        setStatusMessage("Préparation du fichier…");
        file = await prepareFile(selectedFile);
        if (!isAttemptActive(attemptId)) return;
      }

      setStatusMessage("Vérification de la session…");
      const user = auth.currentUser;
      if (!user) {
        throw Object.assign(new Error("User is not authenticated."), { code: "storage/unauthenticated" });
      }

      const idToken = await user.getIdToken();
      if (!isAttemptActive(attemptId)) return;

      setStatusMessage("Envoi du fichier…");

      const response = await Promise.race([
        fetch(STORAGE_UPLOAD_ENDPOINT, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${idToken}`,
            "Content-Type": file.type || "application/octet-stream",
            "X-Upload-Path": storagePath,
            "X-File-Name": encodeURIComponent(file.name),
          },
          body: file,
        }),
        new Promise((_, reject) => {
          window.setTimeout(() => {
            reject(
              Object.assign(new Error("Direct upload timed out."), {
                code: "storage/direct-upload-timeout",
              }),
            );
          }, 20000);
        }),
      ]);

      if (!isAttemptActive(attemptId)) return;

      if (!response?.ok) {
        let payload = null;
        try {
          payload = await response.json();
        } catch {
          payload = null;
        }

        throw Object.assign(
          new Error(payload?.message || `Upload HTTP ${response.status}`),
          { code: payload?.error || "storage/upload-via-function-failed" },
        );
      }

      const payload = await response.json();
      if (!payload?.url || !payload?.filePath) {
        throw Object.assign(new Error("Réponse d'upload incomplète."), {
          code: "storage/upload-via-function-invalid-response",
        });
      }

      setStatusMessage("Finalisation…");
      await completeUpload(file, payload, attemptId);
    } catch (err) {
      if (!isAttemptActive(attemptId)) return;
      finishAttempt(attemptId);
      setError(formatUploadError(err));
      setStatusMessage("");
      setIsUploading(false);
    }
  }

  function handleDrop(event) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) uploadFile(file);
  }

  return (
    <div className="file-upload">
      <label className="file-upload__label" style={labelStyle}>{label}</label>

      <div
        className={`file-upload__dropzone ${dragging ? "file-upload__dropzone--dragging" : ""} ${isUploading ? "file-upload__dropzone--uploading" : ""} ${value ? "file-upload__dropzone--filled" : ""}`}
        onClick={() => !isUploading && inputRef.current?.click()}
        onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
      >
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          className="file-upload__input"
          onChange={(event) => uploadFile(event.target.files?.[0])}
        />

        {isUploading ? (
          <div className="file-upload__progress">
            <div className="file-upload__progress-label">{statusMessage || "Envoi du fichier…"}</div>
            <div className="file-upload__progress-bar">
              <div className="file-upload__progress-fill file-upload__progress-fill--indeterminate" />
            </div>
          </div>
        ) : value ? (
          <div className="file-upload__ready">
            <span className="file-upload__ready-badge">Fichier prêt</span>
            <button
              className="file-upload__icon-link"
              type="button"
              title="Ouvrir le fichier actuel"
              aria-label="Ouvrir le fichier actuel"
              onClick={(event) => {
                event.stopPropagation();
                window.open(value, "_blank", "noopener,noreferrer");
              }}
            >
              <span aria-hidden="true">↗</span>
            </button>
            <span className="file-upload__ready-hint">Cliquer ou déposer pour remplacer</span>
          </div>
        ) : (
          <div className="file-upload__empty">
            <div className="file-upload__empty-icon" aria-hidden="true">⌁</div>
            <div className="file-upload__empty-title">Déposer ou sélectionner un fichier</div>
            <div className="file-upload__empty-hint">{helperText}</div>
          </div>
        )}
      </div>

      {error ? <p className="file-upload__error">{error}</p> : null}
    </div>
  );
}
