import { useRef, useState } from "react";
import { uploadFileToStorage } from "./storage-upload";
import { useTr } from "./use-tr";

// Zone de dépôt de plusieurs fichiers (glisser-déposer ou clic). Chaque fichier
// est envoyé dès qu'il est déposé ; onUploaded reçoit la liste des fichiers envoyés.
export function MultiFileDrop({ storagePath, accept = ".pdf,image/*", maxBytes = 20 * 1024 * 1024, label, hint, onUploaded, disabled = false }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const tr = useTr();

  async function handleFiles(fileList) {
    const files = [...(fileList || [])];
    if (!files.length) return;
    setError("");
    const tooBig = files.filter((file) => file.size > maxBytes);
    if (tooBig.length) setError(`${tr(`Trop lourd (max ${Math.round(maxBytes / 1024 / 1024)} Mo) :`, `Too large (max ${Math.round(maxBytes / 1024 / 1024)} MB):`)} ${tooBig.map((file) => file.name).join(", ")}`);
    const accepted = files.filter((file) => file.size <= maxBytes);
    setBusy(accepted.length);
    const uploaded = [];
    for (const file of accepted) {
      try {
        uploaded.push(await uploadFileToStorage(file, storagePath));
      } catch (uploadError) {
        setError(uploadError.message);
      } finally {
        setBusy((count) => Math.max(0, count - 1));
      }
    }
    if (uploaded.length) onUploaded(uploaded);
  }

  return (
    <div className="mfd">
      <button
        className={`mfd__zone${dragging ? " mfd__zone--drag" : ""}`}
        disabled={disabled || busy > 0}
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          handleFiles(event.dataTransfer.files);
        }}
      >
        <strong>{busy > 0 ? tr(`Envoi en cours… (${busy})`, `Uploading… (${busy})`) : label || tr("Glissez vos fichiers ici, ou cliquez pour les choisir", "Drop your files here, or click to choose them")}</strong>
        {hint ? <small>{hint}</small> : null}
      </button>
      <input
        ref={inputRef}
        accept={accept}
        hidden
        multiple
        type="file"
        onChange={(event) => {
          handleFiles(event.target.files);
          event.target.value = "";
        }}
      />
      {error ? <p className="mfd__error">{error}</p> : null}
    </div>
  );
}
