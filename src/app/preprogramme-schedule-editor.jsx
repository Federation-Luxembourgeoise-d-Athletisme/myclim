import { useState } from "react";

// Lignes proposées quand l'édition n'a pas encore de déroulé : à compléter
// avec les heures, et à masquer au besoin (case « Afficher »).
const DEFAULT_PREPROGRAMME_SCHEDULE = [
  { time: "", labelEn: "Youth races — U12 / U14", labelFr: "Courses jeunes — U12 / U14", visible: true },
  { time: "", labelEn: "National races — 60 m / 800 m", labelFr: "Courses nationales — 60 m / 800 m", visible: true },
  { time: "", labelEn: "Special Olympics race", labelFr: "Course Special Olympics", visible: true },
  { time: "", labelEn: "Business Race — mixed 4 × 200 m relay", labelFr: "Business Race — relais mixte 4 × 200 m", visible: true },
  { time: "", labelEn: "Influencer Race against Lux stars", labelFr: "Influencer Race contre les stars lux", visible: true },
  { time: "", labelEn: "Main programme starts", labelFr: "Début du programme principal", visible: true },
];

const inputStyle = {
  padding: "6px 8px",
  border: "1px solid #d1d5db",
  borderRadius: 6,
  fontSize: "0.8rem",
  minWidth: 0,
};

function normalizeSchedule(value) {
  return Array.isArray(value) && value.length
    ? value.map((line) => ({
        time: String(line?.time || ""),
        labelEn: String(line?.labelEn || ""),
        labelFr: String(line?.labelFr || ""),
        visible: line?.visible !== false,
      }))
    : DEFAULT_PREPROGRAMME_SCHEDULE;
}

// Déroulé du pré-programme affiché sur la page publique /programme. Chaque
// ligne peut être masquée ; sans ligne visible, le bloc disparaît du site.
function PreprogrammeScheduleEditor({ schedule, onSave }) {
  const [lines, setLines] = useState(() => normalizeSchedule(schedule));
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("");
  // Le parent remonte l'éditeur à chaque changement d'édition (key), donc
  // l'état local suffit : après un enregistrement, Firestore renvoie les mêmes lignes.
  const isUnsaved = JSON.stringify(lines) !== JSON.stringify(normalizeSchedule(schedule)) || !Array.isArray(schedule) || !schedule.length;

  function updateLine(index, field, value) {
    setLines((current) => current.map((line, lineIndex) => (lineIndex === index ? { ...line, [field]: value } : line)));
    setMessage("");
  }

  function moveLine(index, offset) {
    setLines((current) => {
      const target = index + offset;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  async function handleSave() {
    setIsSaving(true);
    setMessage("");
    try {
      await onSave(lines.filter((line) => line.labelEn.trim() || line.labelFr.trim()));
      setMessage("Déroulé enregistré.");
    } catch {
      setMessage("Le déroulé n'a pas pu être enregistré.");
    } finally {
      setIsSaving(false);
    }
  }

  const visibleCount = lines.filter((line) => line.visible).length;

  return (
    <div style={{ padding: "16px 20px", background: "#f8fafc", borderRadius: 10, border: "1px solid #e2e8f0" }}>
      <div style={{ fontWeight: 700, fontSize: "0.85rem", color: "#374151", marginBottom: 4 }}>
        Pré-programme — déroulé affiché sur le site
      </div>
      <p style={{ fontSize: "0.75rem", color: "#6b7280", margin: "0 0 12px" }}>
        Heure facultative (une ligne sans heure s'affiche dans l'ordre de la liste). Décochez « Afficher » pour cacher une ligne
        {visibleCount ? "" : " — aucune ligne visible : le bloc n'apparaît pas sur le site"}.
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "70px minmax(0, 1fr) minmax(0, 1fr) 80px 96px", gap: 6, alignItems: "center" }}>
        <span style={{ fontSize: "0.7rem", color: "#6b7280" }}>Heure</span>
        <span style={{ fontSize: "0.7rem", color: "#6b7280" }}>Texte anglais</span>
        <span style={{ fontSize: "0.7rem", color: "#6b7280" }}>Texte français</span>
        <span style={{ fontSize: "0.7rem", color: "#6b7280" }}>Afficher</span>
        <span />
        {lines.map((line, index) => (
          <div key={index} style={{ display: "contents" }}>
            <input aria-label="Heure" placeholder="14:00" style={inputStyle} value={line.time} onChange={(event) => updateLine(index, "time", event.target.value)} />
            <input aria-label="Texte anglais" style={inputStyle} value={line.labelEn} onChange={(event) => updateLine(index, "labelEn", event.target.value)} />
            <input aria-label="Texte français" style={inputStyle} value={line.labelFr} onChange={(event) => updateLine(index, "labelFr", event.target.value)} />
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.8rem" }}>
              <input checked={line.visible} type="checkbox" onChange={(event) => updateLine(index, "visible", event.target.checked)} />
              Oui
            </label>
            <span style={{ display: "flex", gap: 4 }}>
              <button aria-label="Monter" className="btn btn--secondary" style={{ fontSize: "0.75rem", padding: "2px 6px" }} type="button" onClick={() => moveLine(index, -1)}>↑</button>
              <button aria-label="Descendre" className="btn btn--secondary" style={{ fontSize: "0.75rem", padding: "2px 6px" }} type="button" onClick={() => moveLine(index, 1)}>↓</button>
              <button
                aria-label="Supprimer la ligne"
                className="btn btn--secondary"
                style={{ fontSize: "0.75rem", padding: "2px 6px", color: "#dc2626" }}
                type="button"
                onClick={() => setLines((current) => current.filter((_, lineIndex) => lineIndex !== index))}
              >
                ✕
              </button>
            </span>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12, flexWrap: "wrap" }}>
        <button
          className="btn btn--secondary"
          style={{ fontSize: "0.8rem" }}
          type="button"
          onClick={() => setLines((current) => [...current, { time: "", labelEn: "", labelFr: "", visible: true }])}
        >
          + Ajouter une ligne
        </button>
        <span style={{ flex: 1 }} />
        {message ? <span style={{ fontSize: "0.75rem", color: "#6b7280" }}>{message}</span> : null}
        {isUnsaved ? <span style={{ fontSize: "0.75rem", color: "#b45309" }}>Non enregistré</span> : null}
        <button className="btn btn--primary" disabled={isSaving} style={{ fontSize: "0.8rem" }} type="button" onClick={handleSave}>
          {isSaving ? "…" : "Enregistrer le déroulé"}
        </button>
      </div>
    </div>
  );
}

export { DEFAULT_PREPROGRAMME_SCHEDULE, PreprogrammeScheduleEditor };
