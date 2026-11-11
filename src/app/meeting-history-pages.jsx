import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "../context/auth-context";
import { eventAnchorId, eventLabel } from "./statistics-compute";
import { useStatisticsEdition } from "./statistics-edition";
import { formatEditionLabel } from "./meeting-edition-utils";
import { canAccessStatistics, getActiveRoles } from "./navigation";
import {
  MEETING_EDITIONS_COL,
  closeEdition,
  deleteResult,
  getOfficialWinnersFromResults,
  rebuildMeetingRecords,
  resetAndReseedWinners,
  reseedMeetingYearFromJson,
  saveResult,
  seedMeetingDatabase,
  setEditionVisibility,
  syncWinnersForYear,
  useAllWinners,
  useMeetingEditions,
  useMeetingRecords,
  useMeetingResultsForYear,
} from "./meeting-history-hooks";
import { useAthleteRegistry } from "./athlete-portal-hooks";
import { useLanguage } from "./language-context";
import { useTr } from "./use-tr";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Canonical discipline order:
 *  1. Track events sorted by distance (shortest → longest)
 *  2. Field events sorted alphabetically
 *  3. Anything else at the end, alphabetically
 */
const DISCIPLINE_ORDER = [
  "50 m", "60 m", "60 m hurdles",
  "200 m", "200 m - Special Olympics",
  "400 m", "800 m", "1000 m", "1500 m", "3000 m", "5000 m",
  // field events follow alphabetically — handled by fallback
];

const RECORD_TRACK_ORDER = [
  "50m",
  "60m",
  "60m hurdles",
  "200m",
  "200m - Special Olympics",
  "400m",
  "400m hurdles",
  "400m - Special Olympics",
  "800m",
  "800m - Special Olympics",
  "1000m",
  "1500m",
  "3000m",
  "5000m",
];

function disciplineSortKey(name) {
  const idx = DISCIPLINE_ORDER.indexOf(name);
  if (idx !== -1) return `0_${String(idx).padStart(3, "0")}`;
  // Field events and unknowns: group after track, sort alpha
  return `1_${name}`;
}

function normalizeRecordDiscipline(name) {
  return String(name || "")
    .replace(/(\d)\s+(m\b)/gi, "$1$2")
    .replace(/Hurdles/g, "hurdles")
    .trim();
}

function recordDisciplineSortKey(name) {
  const normalized = normalizeRecordDiscipline(name);
  const trackIndex = RECORD_TRACK_ORDER.indexOf(normalized);
  if (trackIndex !== -1) return `0_${String(trackIndex).padStart(3, "0")}`;
  return `1_${normalized.toLowerCase()}`;
}

function compareRecordsDisplay(a, b) {
  const genderOrder = { W: 0, M: 1, X: 2 };
  const genderDiff = (genderOrder[a.gender] ?? 9) - (genderOrder[b.gender] ?? 9);
  if (genderDiff !== 0) return genderDiff;

  const disciplineDiff = recordDisciplineSortKey(a.discipline).localeCompare(recordDisciplineSortKey(b.discipline));
  if (disciplineDiff !== 0) return disciplineDiff;

  return String(a.fullName || "").localeCompare(String(b.fullName || ""));
}

/** Compare two discipline+gender group objects for display order.
 *  Within the same discipline, Women first. */
function compareDisciplineGender(a, b) {
  const dk = disciplineSortKey(a.discipline).localeCompare(disciplineSortKey(b.discipline));
  if (dk !== 0) return dk;
  // same discipline: W before M before mixed/other
  const genderOrder = { W: 0, M: 1, X: 2 };
  const gc = (genderOrder[a.gender] ?? 9) - (genderOrder[b.gender] ?? 9);
  if (gc !== 0) return gc;
  const roundOrder = { Final: 0, Heat: 1 };
  const rc = (roundOrder[a.round] ?? 9) - (roundOrder[b.round] ?? 9);
  if (rc !== 0) return rc;
  const aSection = String(a.finalGroup || a.heat || "");
  const bSection = String(b.finalGroup || b.heat || "");
  return aSection.localeCompare(bSection, undefined, { numeric: true });
}

function normalizeRoundLabel(round) {
  const value = String(round || "").trim().toLowerCase();
  if (value === "heat") return "Heat";
  if (value === "final") return "Final";
  return String(round || "").trim();
}

function isHeatRound(round) {
  return normalizeRoundLabel(round) === "Heat";
}

function isFinalRound(round) {
  return normalizeRoundLabel(round) === "Final";
}

function sectionOrderValue(token) {
  const value = String(token || "").trim().toUpperCase();
  if (!value) return 0;
  if (value === "1" || value === "A") return 1;
  if (value === "2" || value === "B") return 2;
  if (value === "3" || value === "C") return 3;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric;
  return 99;
}

function compareSectionGroups(a, b) {
  return sectionOrderValue(a.finalGroup || a.heat) - sectionOrderValue(b.finalGroup || b.heat);
}

function formatSectionLabel(group, tr) {
  if (group.round === "Heat") return group.heat ? tr(`Série ${group.heat}`, `Heat ${group.heat}`) : tr("Série", "Heat");
  if (group.finalGroup) return tr(`Finale ${group.finalGroup}`, `Final ${group.finalGroup}`);
  if (isFinalRound(group.round)) return tr("Finale", "Final");
  return group.round || "";
}

function getDisplayRank(result) {
  return result?.sectionRank || result?.rank || null;
}

function formatSectionCell(result) {
  if (isHeatRound(result?.round)) return result?.heat || "—";
  if (result?.finalGroup) return result.finalGroup;
  return "—";
}

function formatEditionDate(value, language) {
  const locale = language === "fr" ? "fr-LU" : "en-GB";
  if (!value) return "—";

  if (typeof value === "string") return value;

  if (typeof value?.toDate === "function") {
    return value.toDate().toLocaleDateString(locale);
  }

  if (typeof value?.seconds === "number") {
    return new Date(value.seconds * 1000).toLocaleDateString(locale);
  }

  return "—";
}

const FLAG_BASE = "https://flagcdn.com/20x15";
const NOC_TO_ISO2 = {
  ALG: "dz", AND: "ad", ARG: "ar", AUS: "au", AUT: "at",
  BAH: "bs", BEL: "be", BGR: "bg", BLR: "by", BRA: "br", BUL: "bg",
  CAN: "ca", CHI: "cl", CHN: "cn", CIV: "ci", COL: "co", CRO: "hr",
  CYP: "cy", CZE: "cz",
  DEN: "dk", DEU: "de",
  ESP: "es", EST: "ee", ETH: "et",
  FIN: "fi", FRA: "fr",
  GBR: "gb", GER: "de", GHA: "gh", GRE: "gr",
  HUN: "hu",
  IRL: "ie", ISR: "il", ITA: "it",
  JAM: "jm", JPN: "jp",
  KEN: "ke", KOR: "kr",
  LAT: "lv", LBR: "lr", LTU: "lt", LUX: "lu",
  MAR: "ma", MDA: "md", MRI: "mu",
  NED: "nl", NGR: "ng", NLD: "nl", NOR: "no", NZL: "nz",
  POL: "pl", POR: "pt", PRT: "pt",
  QAT: "qa",
  ROM: "ro", ROU: "ro", RSA: "za", RUS: "ru",
  SLO: "si", SRB: "rs", STP: "st", SUI: "ch", SVK: "sk", SWE: "se",
  TUR: "tr",
  UKR: "ua", USA: "us",
  ZAF: "za", ZIM: "zw",
};

function FlagImg({ noc }) {
  const iso = NOC_TO_ISO2[noc?.toUpperCase()];
  if (!iso) return <span style={{ fontSize: "0.75rem", color: "#888" }}>{noc || ""}</span>;
  return (
    <img
      src={`${FLAG_BASE}/${iso}.png`}
      alt={noc}
      width={20}
      height={15}
      style={{ verticalAlign: "middle", marginRight: 4, borderRadius: 2 }}
      onError={(e) => { e.target.style.display = "none"; }}
    />
  );
}

function RankBadge({ rank }) {
  const safeRank = Number(rank);
  const hasRank = Number.isFinite(safeRank) && safeRank > 0;
  const colors = { 1: "#f5c842", 2: "#b0b8c1", 3: "#cd7f32" };
  const bg = colors[safeRank] || "#e5e7eb";
  const color = hasRank && safeRank <= 3 ? "#1a1a1a" : "#374151";
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      width: 24, height: 24, borderRadius: "50%",
      background: bg, color, fontWeight: 700, fontSize: "0.78rem",
    }}>
      {hasRank ? safeRank : "—"}
    </span>
  );
}

function GenderTag({ gender }) {
  const tr = useTr();
  const label = gender === "W" ? tr("Femmes", "Women") : gender === "M" ? tr("Hommes", "Men") : tr("Mixte", "Mixed");
  const background = gender === "W" ? "#fce7f3" : gender === "M" ? "#dbeafe" : "#ecfeff";
  const color = gender === "W" ? "#be185d" : gender === "M" ? "#1d4ed8" : "#0f766e";
  return (
    <span style={{
      display: "inline-block",
      padding: "1px 7px",
      borderRadius: 20,
      fontSize: "0.72rem",
      fontWeight: 700,
      background,
      color,
      letterSpacing: "0.04em",
    }}>
      {label}
    </span>
  );
}

function SeedButton({ onSeed, seeding, seedLog }) {
  const tr = useTr();
  return (
    <div>
      <button
        className="btn btn--primary"
        onClick={onSeed}
        disabled={seeding}
        style={{ marginBottom: "0.5rem" }}
      >
        {seeding ? tr("Import…", "Importing…") : tr("🌱 Importer les données historiques", "🌱 Import historical data")}
      </button>
      {seedLog.length > 0 && (
        <div style={{
          marginTop: "0.5rem",
          background: "#f8fafc",
          border: "1px solid #e2e8f0",
          borderRadius: 8,
          padding: "0.75rem 1rem",
          fontFamily: "monospace",
          fontSize: "0.8rem",
          color: "#374151",
          maxHeight: 160,
          overflowY: "auto",
        }}>
          {seedLog.map((line, i) => (
            <div key={i}>{line}</div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Result form ──────────────────────────────────────────────────────────────

const EMPTY_RESULT = { discipline: "", gender: "M", round: "", heat: "", rank: 1, lastName: "", firstName: "", noc: "", result: "", yob: "", points: "" };

function ResultForm({ year, initial, onSave, onCancel }) {
  const tr = useTr();
  const [data, setData] = useState({ ...EMPTY_RESULT, year: Number(year), ...initial });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const set = (field, value) => setData((p) => ({ ...p, [field]: value }));

  async function handleSave() {
    if (!data.discipline.trim()) { setError(tr("Discipline requise.", "Event required.")); return; }
    if (!data.lastName.trim()) { setError(tr("Nom requis.", "Last name required.")); return; }
    setSaving(true); setError("");
    try {
      await onSave({ ...data, year: Number(year), rank: Number(data.rank) || 1, yob: data.yob ? Number(data.yob) : null, points: data.points !== "" ? Number(data.points) : null });
    } catch (e) {
      setError(e.message || tr("Erreur lors de la sauvegarde.", "Error while saving."));
    } finally {
      setSaving(false);
    }
  }

  const inp = { padding: "7px 10px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: "0.875rem", fontFamily: "inherit", width: "100%" };

  return (
    <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 12, padding: 20, marginTop: 12 }}>
      <p style={{ fontWeight: 700, marginBottom: 14, fontSize: "0.9rem" }}>{initial?.id ? tr("Modifier un résultat", "Edit result") : tr("Ajouter un résultat", "Add result")} — {year}</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 10 }}>
        <div>
          <label style={{ fontSize: "0.72rem", fontWeight: 700, textTransform: "uppercase", display: "block", marginBottom: 4 }}>{tr("Discipline *", "Event *")}</label>
          <input style={inp} value={data.discipline} onChange={(e) => set("discipline", e.target.value)} placeholder={tr("ex: 60m", "e.g. 60m")} />
        </div>
        <div>
          <label style={{ fontSize: "0.72rem", fontWeight: 700, textTransform: "uppercase", display: "block", marginBottom: 4 }}>{tr("Genre", "Gender")}</label>
          <select style={inp} value={data.gender} onChange={(e) => set("gender", e.target.value)}>
            <option value="M">{tr("Hommes (M)", "Men (M)")}</option>
            <option value="W">{tr("Femmes (W)", "Women (W)")}</option>
          </select>
        </div>
        <div>
          <label style={{ fontSize: "0.72rem", fontWeight: 700, textTransform: "uppercase", display: "block", marginBottom: 4 }}>{tr("Tour", "Round")}</label>
          <input style={inp} value={data.round} onChange={(e) => set("round", e.target.value)} placeholder={tr("Final A / Final B / Heats combines…", "Final A / Final B / Combined heats…")} />
        </div>
        <div>
          <label style={{ fontSize: "0.72rem", fontWeight: 700, textTransform: "uppercase", display: "block", marginBottom: 4 }}>{tr("Série", "Heat")}</label>
          <input style={inp} value={data.heat} onChange={(e) => set("heat", e.target.value)} placeholder="S1 / S2 / S3…" />
        </div>
        <div>
          <label style={{ fontSize: "0.72rem", fontWeight: 700, textTransform: "uppercase", display: "block", marginBottom: 4 }}>{tr("Rang *", "Rank *")}</label>
          <input type="number" style={inp} value={data.rank} onChange={(e) => set("rank", e.target.value)} min={1} />
        </div>
        <div>
          <label style={{ fontSize: "0.72rem", fontWeight: 700, textTransform: "uppercase", display: "block", marginBottom: 4 }}>{tr("Nom *", "Last name *")}</label>
          <input style={inp} value={data.lastName} onChange={(e) => set("lastName", e.target.value)} placeholder={tr("NOM", "LAST NAME")} />
        </div>
        <div>
          <label style={{ fontSize: "0.72rem", fontWeight: 700, textTransform: "uppercase", display: "block", marginBottom: 4 }}>{tr("Prénom", "First name")}</label>
          <input style={inp} value={data.firstName} onChange={(e) => set("firstName", e.target.value)} placeholder={tr("Prénom", "First name")} />
        </div>
        <div>
          <label style={{ fontSize: "0.72rem", fontWeight: 700, textTransform: "uppercase", display: "block", marginBottom: 4 }}>NOC</label>
          <input style={inp} value={data.noc} onChange={(e) => set("noc", e.target.value.toUpperCase())} placeholder="FRA" maxLength={3} />
        </div>
        <div>
          <label style={{ fontSize: "0.72rem", fontWeight: 700, textTransform: "uppercase", display: "block", marginBottom: 4 }}>{tr("Résultat", "Result")}</label>
          <input style={inp} value={data.result} onChange={(e) => set("result", e.target.value)} placeholder="6.58" />
        </div>
        <div>
          <label style={{ fontSize: "0.72rem", fontWeight: 700, textTransform: "uppercase", display: "block", marginBottom: 4 }}>{tr("Année naissance", "Year of birth")}</label>
          <input type="number" style={inp} value={data.yob} onChange={(e) => set("yob", e.target.value)} placeholder="1998" />
        </div>
        <div>
          <label style={{ fontSize: "0.72rem", fontWeight: 700, textTransform: "uppercase", display: "block", marginBottom: 4 }}>Points</label>
          <input type="number" style={inp} value={data.points} onChange={(e) => set("points", e.target.value)} placeholder="—" />
        </div>
      </div>
      {error && <p style={{ color: "#dc2626", fontSize: "0.8rem", marginTop: 8 }}>{error}</p>}
      <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
        <button className="btn btn--primary" onClick={handleSave} disabled={saving} style={{ fontSize: "0.85rem" }}>
          {saving ? tr("Enregistrement…", "Saving…") : tr("Enregistrer", "Save")}
        </button>
        <button className="btn" onClick={onCancel} style={{ fontSize: "0.85rem" }}>{tr("Annuler", "Cancel")}</button>
      </div>
    </div>
  );
}

// ─── Meeting History page ─────────────────────────────────────────────────────

// Build a lookup index from athlete registry: "lastname_yob" → registry entry
function useRegistryIndex() {
  const { userProfile } = useAuth();
  const roles = getActiveRoles(userProfile);
  const canAccess = canAccessStatistics(roles);
  const { registry } = useAthleteRegistry(canAccess);
  return useMemo(() => {
    const idx = new Map();
    for (const a of registry) {
      const yob = a.birthYear ?? (a.birthDate ? Number(a.birthDate.slice(0, 4)) : null);
      const key = `${String(a.lastName || "").toLowerCase()}_${yob ?? ""}`;
      if (!idx.has(key)) idx.set(key, a);
    }
    return idx;
  }, [registry]);
}

function AthleteNameCell({ lastName, firstName, yob, registryIdx, style }) {
  const tr = useTr();
  const key = `${String(lastName || "").toLowerCase()}_${yob ?? ""}`;
  const entry = registryIdx?.get(key);
  const fullName = `${lastName || ""}${firstName ? " " + firstName : ""}`;

  if (entry?.waUrl) {
    return (
      <a
        href={entry.waUrl}
        target="_blank"
        rel="noopener noreferrer"
        style={{ ...style, color: "#1d4ed8", textDecoration: "none", fontWeight: 600 }}
        title={`${tr("Profil World Athletics", "World Athletics profile")}${entry.waid ? ` · WAID ${entry.waid}` : ""}`}
      >
        {fullName}
        <span style={{ marginLeft: 4, fontSize: "0.68rem", opacity: 0.55 }}>↗</span>
      </a>
    );
  }
  if (entry) {
    // In registry but no WA URL yet
    return (
      <span style={{ ...style, fontWeight: 600 }} title={tr("Dans la base athlètes", "In the athlete database")}>
        {fullName}
        <span style={{ marginLeft: 4, fontSize: "0.65rem", color: "#6b7280" }}>●</span>
      </span>
    );
  }
  return <span style={{ ...style, fontWeight: 600 }}>{fullName}</span>;
}

// ─── All known discipline options (for the edit dropdown) ────────────────────
const ALL_DISCIPLINES = [
  "50 m", "60 m", "60 m hurdles",
  "200 m", "400 m", "800 m", "1000 m", "1500 m", "3000 m", "5000 m",
  "High Jump", "Long Jump", "Pole Vault", "Shot Put", "Triple Jump",
];

// ─── Inline-editable result row ───────────────────────────────────────────────
function EditableResultRow({ r, onSaved, onDeleted }) {
  const tr = useTr();
  const [editing, setEditing]   = useState(false);
  const [saving,  setSaving]    = useState(false);
  const [draft,   setDraft]     = useState({});

  function startEdit() {
    setDraft({
      rank:       r.rank ?? "",
      discipline: r.discipline ?? "",
      gender:     r.gender ?? "W",
      result:     r.result ?? "",
      lastName:   r.lastName ?? "",
      firstName:  r.firstName ?? "",
      noc:        r.noc ?? "",
      yob:        r.yob ?? "",
    });
    setEditing(true);
  }

  function set(key, val) {
    setDraft((d) => ({ ...d, [key]: val }));
  }

  async function save() {
    setSaving(true);
    try {
      const fields = {
        rank:       Number(draft.rank) || 0,
        discipline: draft.discipline,
        gender:     draft.gender,
        result:     draft.result,
        lastName:   draft.lastName,
        firstName:  draft.firstName,
        noc:        draft.noc,
      };
      if (draft.yob !== "" && draft.yob != null) fields.yob = Number(draft.yob);
      await saveResult(r.id, fields);
      setEditing(false);
      onSaved?.();
    } catch (e) {
      alert(tr("Erreur : ", "Error: ") + e.message);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!window.confirm(tr(`Supprimer ${r.lastName} ${r.firstName} (${r.discipline} ${r.gender}) ?`, `Delete ${r.lastName} ${r.firstName} (${r.discipline} ${r.gender})?`))) return;
    setSaving(true);
    try {
      await deleteResult(r.id);
      onDeleted?.();
    } catch (e) {
      alert(tr("Erreur : ", "Error: ") + e.message);
      setSaving(false);
    }
  }

  const cellStyle = { padding: "0.25rem 0.4rem", verticalAlign: "middle" };
  const inputStyle = {
    width: "100%", padding: "0.22rem 0.4rem",
    border: "1.5px solid #93c5fd", borderRadius: 5,
    fontSize: "0.82rem", background: "#eff6ff",
  };

  if (!editing) {
    return (
      <tr key={r.id}>
        <td style={{ textAlign: "center" }}>
          <RankBadge rank={r.rank} />
        </td>
        <td style={{ fontSize: "0.78rem", color: "#888" }}>{r.discipline}</td>
        <td className="col-sticky col-sticky--last" style={{ fontWeight: 600 }}>
          {r.lastName}{r.firstName ? ` ${r.firstName}` : ""}
        </td>
        <td><FlagImg noc={r.noc} />{r.noc}</td>
        <td style={{ fontWeight: 600, fontFamily: "monospace" }}>{r.result || "—"}</td>
        <td style={{ color: "#888", fontSize: "0.82rem" }}>{r.yob || "—"}</td>
        <td>
          <button
            onClick={startEdit}
            title={tr("Modifier", "Edit")}
            style={{
              background: "none", border: "none", cursor: "pointer",
              padding: "2px 6px", borderRadius: 4, fontSize: "0.85rem",
              color: "#6b7280",
            }}
          >✏️</button>
          <button
            onClick={remove}
            disabled={saving}
            title={tr("Supprimer", "Delete")}
            style={{
              background: "none", border: "none", cursor: "pointer",
              padding: "2px 4px", borderRadius: 4, fontSize: "0.82rem",
              color: "#ef4444", marginLeft: 2,
            }}
          >🗑</button>
        </td>
      </tr>
    );
  }

  // Edit row — spans full width in a second <tr> to keep the layout stable
  return (
    <>
      <tr key={r.id} style={{ background: "#eff6ff" }}>
        <td style={cellStyle}>
          <input
            type="number" min={1} max={99}
            value={draft.rank}
            onChange={(e) => set("rank", e.target.value)}
            style={{ ...inputStyle, width: 44 }}
            title={tr("Classement", "Rank")}
          />
        </td>
        <td style={cellStyle}>
          <select
            value={draft.discipline}
            onChange={(e) => set("discipline", e.target.value)}
            style={{ ...inputStyle, minWidth: 100 }}
          >
            {ALL_DISCIPLINES.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
            {!ALL_DISCIPLINES.includes(draft.discipline) && (
              <option value={draft.discipline}>{draft.discipline}</option>
            )}
          </select>
        </td>
        <td style={cellStyle} className="col-sticky col-sticky--last">
          <div style={{ display: "flex", gap: "0.3rem", flexWrap: "wrap" }}>
            <input
              value={draft.lastName}
              onChange={(e) => set("lastName", e.target.value)}
              placeholder={tr("Nom", "Last name")}
              style={{ ...inputStyle, width: 90 }}
            />
            <input
              value={draft.firstName}
              onChange={(e) => set("firstName", e.target.value)}
              placeholder={tr("Prénom", "First name")}
              style={{ ...inputStyle, width: 80 }}
            />
          </div>
        </td>
        <td style={cellStyle}>
          <input
            value={draft.noc}
            onChange={(e) => set("noc", e.target.value.toUpperCase().slice(0, 3))}
            placeholder="NOC"
            maxLength={3}
            style={{ ...inputStyle, width: 48, textTransform: "uppercase" }}
          />
        </td>
        <td style={cellStyle}>
          <input
            value={draft.result}
            onChange={(e) => set("result", e.target.value)}
            placeholder={tr("Résultat", "Result")}
            style={{ ...inputStyle, width: 80 }}
          />
        </td>
        <td style={cellStyle}>
          <div style={{ display: "flex", gap: 4 }}>
            <select
              value={draft.gender}
              onChange={(e) => set("gender", e.target.value)}
              style={{ ...inputStyle, width: 56 }}
            >
              <option value="W">W</option>
              <option value="M">M</option>
            </select>
            <input
              type="number"
              value={draft.yob}
              onChange={(e) => set("yob", e.target.value)}
              placeholder={tr("Ann.", "YOB")}
              style={{ ...inputStyle, width: 60 }}
              title={tr("Année de naissance", "Year of birth")}
            />
          </div>
        </td>
        <td style={cellStyle}>
          <div style={{ display: "flex", gap: 4 }}>
            <button
              onClick={save}
              disabled={saving}
              style={{
                padding: "0.25rem 0.6rem", borderRadius: 5, border: "none",
                background: "#1d4ed8", color: "#fff",
                fontWeight: 700, fontSize: "0.78rem", cursor: "pointer",
              }}
            >{saving ? "…" : "✓"}</button>
            <button
              onClick={() => setEditing(false)}
              disabled={saving}
              style={{
                padding: "0.25rem 0.6rem", borderRadius: 5,
                border: "1px solid #d1d5db", background: "#fff",
                fontSize: "0.78rem", cursor: "pointer",
              }}
            >✕</button>
          </div>
        </td>
      </tr>
    </>
  );
}

// ─── Winners comparison panel ─────────────────────────────────────────────────

const _nd = (d) => (d || "").replace(/(\d)\s+(m\b)/gi, "$1$2").replace(/Hurdles/g, "hurdles").trim();
const _key = (disc, gender) => `${_nd(disc)}_${gender}`;

function WinnersComparisonPanel({ editions, allWinners, Panel }) {
  const tr = useTr();
  const [year, setYear] = useState(() => editions[0]?.year ?? null);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState(null);

  const { results, loading } = useMeetingResultsForYear(year);

  const rank1 = useMemo(() => getOfficialWinnersFromResults(results), [results]);

  const winnersByKey = useMemo(() => {
    const map = new Map();
    for (const w of allWinners) {
      if (w.year === year) map.set(_key(w.discipline, w.gender), w);
    }
    return map;
  }, [allWinners, year]);

  const rows = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const r of rank1) {
      const k = _key(r.discipline, r.gender);
      if (seen.has(k)) continue;
      seen.add(k);
      const w = winnersByKey.get(k);
      const rName = `${r.firstName || ""} ${r.lastName || ""}`.trim();
      const wName = w ? `${w.firstName || ""} ${w.lastName || ""}`.trim() : null;
      const rMark = r.result || r.mark || "";
      const wMark = w ? (w.result || w.mark || "") : null;
      out.push({ disc: _nd(r.discipline), gender: r.gender, rName, rMark, wName, wMark, nameMismatch: w && rName.toLowerCase() !== wName.toLowerCase(), markMismatch: w && rMark !== wMark, inResults: true, inWinners: !!w });
    }
    for (const [k, w] of winnersByKey) {
      if (!seen.has(k)) {
        out.push({ disc: _nd(w.discipline), gender: w.gender, rName: null, rMark: null, wName: `${w.firstName || ""} ${w.lastName || ""}`.trim(), wMark: w.result || w.mark || "", nameMismatch: false, markMismatch: false, inResults: false, inWinners: true });
      }
    }
    return out.sort((a, b) => a.disc.localeCompare(b.disc) || (a.gender === "W" ? -1 : 1));
  }, [rank1, winnersByKey]);

  const mismatches = rows.filter((r) => r.nameMismatch || r.markMismatch || !r.inWinners || !r.inResults).length;

  async function handleSync() {
    if (!window.confirm(tr(`Remplacer les vainqueurs ${year} par les résultats officiels (rang 1) ?`, `Replace the ${year} winners with the official results (rank 1)?`))) return;
    setSyncing(true); setSyncMsg(null);
    try {
      const n = await syncWinnersForYear(year, rank1);
      setSyncMsg(tr(`✅ ${n} vainqueurs synchronisés pour ${year}.`, `✅ ${n} winners synced for ${year}.`));
    } catch (e) {
      setSyncMsg(`❌ ${e.message}`);
    } finally { setSyncing(false); }
  }

  return (
    <Panel title={tr("Comparaison vainqueurs / résultats", "Winners / results comparison")} subtitle={tr("Divergences entre le PDF Hall of Winners (meetingWinners) et les résultats officiels (meetingResults rank=1)", "Differences between the Hall of Winners PDF (meetingWinners) and the official results (meetingResults rank=1)")}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 16 }}>
        <select className="input" value={year ?? ""} onChange={(e) => { setYear(Number(e.target.value)); setSyncMsg(null); }} style={{ minWidth: 120 }}>
          {editions.map((e) => <option key={e.year} value={e.year}>{e.year}</option>)}
        </select>
        {!loading && (
          <span style={{ fontSize: "0.82rem", color: mismatches > 0 ? "#b45309" : "#059669", fontWeight: 600 }}>
            {mismatches === 0 ? tr("✅ Tout correspond", "✅ Everything matches") : tr(`⚠️ ${mismatches} divergence(s)`, `⚠️ ${mismatches} ${mismatches === 1 ? "difference" : "differences"}`)}
          </span>
        )}
        <button className="btn btn--primary" onClick={handleSync} disabled={syncing || loading || rank1.length === 0} style={{ marginLeft: "auto", fontSize: "0.82rem" }}>
          {syncing ? tr("Synchro…", "Syncing…") : tr(`↓ Synchroniser ${year} depuis les résultats`, `↓ Sync ${year} from the results`)}
        </button>
      </div>
      {syncMsg && <p style={{ fontSize: "0.82rem", marginBottom: 12, color: syncMsg.startsWith("✅") ? "#059669" : "#dc2626" }}>{syncMsg}</p>}
      {loading ? <p style={{ color: "#6b7280", fontSize: "0.85rem" }}>{tr("Chargement…", "Loading…")}</p> : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
          <thead>
            <tr style={{ background: "#f9fafb" }}>
              {[tr("Épreuve", "Event"), "G", tr("Résultats (rang 1)", "Results (rank 1)"), tr("Perfs", "Marks"), tr("Vainqueurs (PDF)", "Winners (PDF)"), tr("Perfs", "Marks"), tr("Statut", "Status")].map((h, hi) => (
                <th key={hi} style={{ padding: "6px 10px", textAlign: "left", fontWeight: 700, fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.06em", color: "#6b7280", borderBottom: "1px solid #e5e7eb" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0
              ? <tr><td colSpan={7} style={{ padding: "24px", textAlign: "center", color: "#6b7280" }}>{tr(`Aucune donnée pour ${year}`, `No data for ${year}`)}</td></tr>
              : rows.map((r, i) => {
                const bg = !r.inResults ? "#fef3c7" : !r.inWinners ? "#ecfdf5" : (r.nameMismatch || r.markMismatch) ? "#fff7ed" : "#f0fdf4";
                const status = !r.inResults ? tr("❌ Absent des résultats", "❌ Missing from results") : !r.inWinners ? tr("➕ Nouveau dans résultats", "➕ New in results") : (r.nameMismatch || r.markMismatch) ? tr("⚠️ Divergence", "⚠️ Difference") : "✅ OK";
                return (
                  <tr key={i} style={{ background: bg, borderBottom: "1px solid #e5e7eb" }}>
                    <td style={{ padding: "6px 10px", fontWeight: 600 }}>{r.disc}</td>
                    <td style={{ padding: "6px 10px" }}><GenderTag gender={r.gender} /></td>
                    <td style={{ padding: "6px 10px", color: r.nameMismatch ? "#b45309" : undefined, fontWeight: r.nameMismatch ? 700 : undefined }}>{r.rName ?? "—"}</td>
                    <td style={{ padding: "6px 10px", fontStyle: "italic", color: r.markMismatch ? "#b45309" : undefined }}>{r.rMark ?? "—"}</td>
                    <td style={{ padding: "6px 10px", color: r.nameMismatch ? "#dc2626" : undefined }}>{r.wName ?? "—"}</td>
                    <td style={{ padding: "6px 10px", fontStyle: "italic", color: r.markMismatch ? "#dc2626" : undefined }}>{r.wMark ?? "—"}</td>
                    <td style={{ padding: "6px 10px", fontSize: "0.75rem", whiteSpace: "nowrap" }}>{status}</td>
                  </tr>
                );
              })
            }
          </tbody>
        </table>
      )}
    </Panel>
  );
}

// ─── Meeting History page ─────────────────────────────────────────────────────

// maintenance : "hide" (onglet Résultats) ou "only" (Réglages › Maintenance).
function MeetingHistoryPage({ Panel, maintenance }) {
  const tr = useTr();
  const { language } = useLanguage();
  const { userProfile } = useAuth();
  const roles = getActiveRoles(userProfile);
  const isAdmin = roles.includes("admin");

  const { editions, loading: editionsLoading } = useMeetingEditions();
  const { winners: allWinners } = useAllWinners();
  // Édition choisie dans la barre du module Statistiques (?edition=).
  const { edition: selectedYear } = useStatisticsEdition();
  const [closingYear, setClosingYear] = useState(null);
  const [closeStatus, setCloseStatus] = useState(null);
  const [seeding, setSeeding] = useState(false);
  const [seedLog, setSeedLog] = useState([]);
  const [addingResult, setAddingResult] = useState(false);
  const [editingResult, setEditingResult] = useState(null);
  const [editMode, setEditMode] = useState(false);
  const [expandedHeatGroups, setExpandedHeatGroups] = useState({});
  const registryIdx = useRegistryIndex();

  // « Toutes les éditions » : on montre la dernière édition déjà disputée
  // (pas celle de l'année prochaine, encore sans résultats).
  // Réglages › Maintenance garde l'ancienne cible : la dernière édition non clôturée.
  const effectiveYear = selectedYear
    ?? (maintenance === "only"
      ? editions.find((e) => !e.isClosed)?.year
      : editions.find((e) => !e.cancelled && e.year <= new Date().getFullYear())?.year)
    ?? editions[0]?.year
    ?? null;
  const location = useLocation();

  const { results, loading: resultsLoading } = useMeetingResultsForYear(effectiveYear);

  // Group results by discipline + gender + round
  const groups = useMemo(() => {
    const map = new Map();
    for (const r of results) {
      const round = normalizeRoundLabel(r.round);
      const key = `${r.discipline}||${r.gender}||${round}||${r.finalGroup || ""}||${r.heat || ""}`;
      if (!map.has(key)) {
        map.set(key, {
          discipline: r.discipline,
          gender: r.gender,
          round,
          heat: r.heat || "",
          finalGroup: r.finalGroup || "",
          rows: [],
        });
      }
      map.get(key).rows.push(r);
    }
    return [...map.values()]
      .map((group) => ({
        ...group,
        rows: [...group.rows].sort((a, b) => {
          const rankDiff = (getDisplayRank(a) ?? 999) - (getDisplayRank(b) ?? 999);
          if (rankDiff !== 0) return rankDiff;
          return `${a.lastName || ""} ${a.firstName || ""}`.localeCompare(`${b.lastName || ""} ${b.firstName || ""}`);
        }),
      }))
      .sort(compareDisciplineGender);
  }, [results]);

  const eventGroups = useMemo(() => {
    const map = new Map();
    for (const group of groups) {
      const key = `${group.discipline}||${group.gender}`;
      if (!map.has(key)) {
        map.set(key, {
          key,
          discipline: group.discipline,
          gender: group.gender,
          finals: [],
          heats: [],
          others: [],
        });
      }
      const entry = map.get(key);
      if (isFinalRound(group.round)) entry.finals.push(group);
      else if (isHeatRound(group.round)) entry.heats.push(group);
      else entry.others.push(group);
    }
    return [...map.values()]
      .map((entry) => ({
        ...entry,
        finals: [...entry.finals].sort(compareSectionGroups),
        heats: [...entry.heats].sort(compareSectionGroups),
        others: [...entry.others].sort(compareSectionGroups),
      }))
      .sort(compareDisciplineGender);
  }, [groups]);

  function toggleHeatDetails(eventKey) {
    setExpandedHeatGroups((prev) => ({ ...prev, [eventKey]: !prev[eventKey] }));
  }

  // Saut direct à une épreuve (index ci-dessus ou recherche : #evt-60m-W).
  function scrollToEvent(anchorId) {
    const row = document.getElementById(anchorId);
    if (!row) return;
    row.scrollIntoView({ behavior: "smooth", block: "start" });
    row.classList.add("stats-event-flash");
    setTimeout(() => row.classList.remove("stats-event-flash"), 1600);
  }

  const hashAnchor = location.hash ? decodeURIComponent(location.hash.slice(1)) : "";
  useEffect(() => {
    if (!hashAnchor || resultsLoading || !eventGroups.length) return undefined;
    const timer = setTimeout(() => scrollToEvent(hashAnchor), 80);
    return () => clearTimeout(timer);
  }, [hashAnchor, resultsLoading, eventGroups.length]);

  async function handleSeed() {
    setSeeding(true);
    setSeedLog([]);
    try {
      const result = await seedMeetingDatabase((msg) => setSeedLog((prev) => [...prev, msg]));
      setSeedLog((prev) => [...prev, `✅ ${result}`]);
    } catch (err) {
      setSeedLog((prev) => [...prev, tr(`❌ Erreur : ${err.message}`, `❌ Error: ${err.message}`)]);
    } finally {
      setSeeding(false);
    }
  }

  async function handleCloseEdition() {
    if (!effectiveYear || !results.length) return;
    const confirmed = window.confirm(
      tr(`Clôturer l'édition ${effectiveYear} ? Les participations seront enregistrées dans la base athlètes.`, `Close the ${effectiveYear} edition? Participations will be recorded in the athlete database.`),
    );
    if (!confirmed) return;
    setClosingYear(effectiveYear);
    setCloseStatus(null);
    try {
      const msg = await closeEdition(effectiveYear, results, (m) => setCloseStatus(m));
      setCloseStatus(msg);
    } catch (err) {
      setCloseStatus(tr(`Erreur : ${err.message}`, `Error: ${err.message}`));
    } finally {
      setClosingYear(null);
    }
  }

  async function handleSaveResult(data) {
    await saveResult(editingResult?.id || null, data);
    setAddingResult(false);
    setEditingResult(null);
  }

  async function handleDeleteResult(id, label) {
    if (!window.confirm(tr(`Supprimer ce résultat (${label}) ?`, `Delete this result (${label})?`))) return;
    await deleteResult(id);
  }

  async function handleToggleVisibility(year, currentVisible) {
    await setEditionVisibility(year, !currentVisible);
  }

  const selectedEdition = editions.find((e) => e.year === effectiveYear);

  function renderSectionRows(group, options = {}) {
    const useSectionPosition = options.useSectionPosition === true;
    return [
      <tr
        key={`grp-${group.discipline}-${group.gender}-${group.round}-${group.finalGroup}-${group.heat}`}
        id={options.anchorId}
        className="event-group-header"
        style={options.anchorId ? { scrollMarginTop: 48 } : undefined}
      >
        <td colSpan={isAdmin ? 9 : 8} style={{ paddingTop: "0.65rem", paddingBottom: "0.4rem" }}>
          <span style={{ fontWeight: 700, fontSize: "0.88rem", marginRight: 8 }}>
            {group.discipline}
          </span>
          <GenderTag gender={group.gender} />
          {formatSectionLabel(group, tr) && (
            <span style={{ marginLeft: 8, fontSize: "0.75rem", fontWeight: 600, color: "#6b7280", background: "#f3f4f6", padding: "1px 7px", borderRadius: 10 }}>
              {formatSectionLabel(group, tr)}
            </span>
          )}
        </td>
      </tr>,
      ...group.rows.map((r, index) => (
        <tr key={r.id}>
          <td style={{ textAlign: "center" }}>
            <RankBadge rank={useSectionPosition ? index + 1 : getDisplayRank(r)} />
          </td>
          <td style={{ fontSize: "0.78rem", color: "#888" }}>{r.discipline}</td>
          <td className="col-sticky col-sticky--last">
            <AthleteNameCell
              lastName={r.lastName}
              firstName={r.firstName}
              yob={r.yob}
              registryIdx={registryIdx}
            />
          </td>
          <td>
            <FlagImg noc={r.noc} />
            {r.noc}
          </td>
          <td style={{ fontWeight: 600, fontFamily: "monospace" }}>
            {r.result || "—"}
          </td>
          <td style={{ color: "#6b7280", fontSize: "0.75rem", textAlign: "center" }}>
            {formatSectionCell(r)}
          </td>
          <td style={{ color: "#888", fontSize: "0.82rem" }}>{r.yob || "—"}</td>
          <td style={{ color: "#888", fontSize: "0.82rem" }}>
            {r.points != null ? r.points : "—"}
          </td>
          {isAdmin && (
            <td style={{ whiteSpace: "nowrap" }}>
              <button
                onClick={() => { setEditingResult(r); setAddingResult(false); }}
                style={{ background: "none", border: "none", cursor: "pointer", fontSize: "0.75rem", color: "#6b7280", padding: "2px 4px" }}
                title={tr("Modifier", "Edit")}
              >✏️</button>
              <button
                onClick={() => handleDeleteResult(r.id, `${r.discipline} ${r.lastName}`)}
                style={{ background: "none", border: "none", cursor: "pointer", fontSize: "0.75rem", color: "#dc2626", padding: "2px 4px" }}
                title={tr("Supprimer", "Delete")}
              >🗑</button>
            </td>
          )}
        </tr>
      )),
    ];
  }

  const adminToolsPanel = (
    <section className="panel-grid panel-grid--1">
      <Panel title={tr("Admin — Base de données", "Admin — Database")} subtitle={tr("Importer et gérer les données historiques", "Import and manage historical data")}>
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div>
            <p className="panel-note" style={{ marginBottom: "0.5rem" }}>
              {tr(
                "Importez l'année sélectionnée depuis le JSON local, puis synchronisez automatiquement les vainqueurs et les records.",
                "Import the selected year from the local JSON, then automatically sync the winners and records.",
              )}
            </p>
            {effectiveYear && !selectedEdition?.cancelled ? (
              <button
                className="btn btn--primary"
                style={{ fontSize: "0.82rem" }}
                onClick={async () => {
                  if (!window.confirm(tr(`Importer ${effectiveYear} depuis le JSON local, synchroniser les vainqueurs puis recalculer tous les records ?`, `Import ${effectiveYear} from the local JSON, sync the winners, then recompute all records?`))) return;
                  setSeedLog([tr(`Import ${effectiveYear} depuis le JSON local…`, `Importing ${effectiveYear} from the local JSON…`)]);
                  setSeeding(true);
                  try {
                    const summary = await reseedMeetingYearFromJson(effectiveYear, (msg) => setSeedLog((p) => [...p, msg]));
                    setSeedLog((p) => [...p, tr(`✅ ${effectiveYear}: ${summary.results} résultats, ${summary.winners} vainqueurs, ${summary.records} records.`, `✅ ${effectiveYear}: ${summary.results} results, ${summary.winners} winners, ${summary.records} records.`)]);
                  } catch (err) {
                    setSeedLog((p) => [...p, `❌ ${err.message}`]);
                  } finally {
                    setSeeding(false);
                  }
                }}
                disabled={seeding}
              >
                {tr(`Importer ${effectiveYear} depuis le JSON + vainqueurs + records`, `Import ${effectiveYear} from the JSON + winners + records`)}
              </button>
            ) : (
              <p className="panel-note">{tr("Sélectionnez une édition active pour lancer l'import.", "Select an active edition to start the import.")}</p>
            )}
          </div>
          <div style={{ borderTop: "1px solid #e5e7eb", paddingTop: "0.75rem" }}>
            <p className="panel-note" style={{ marginBottom: "0.5rem" }}>
              <strong>{tr("Clôturer une édition", "Closing an edition")}</strong>{" "}
              {tr(
                "enregistre les participations dans la base athlètes. Choisissez une édition ci-dessus, puis cliquez sur « Clôturer l'édition » dans le panneau Résultats.",
                "records the participations in the athlete database. Choose an edition above, then click “Close edition” in the Results panel.",
              )}
            </p>
            <p className="panel-note" style={{ marginBottom: "0.5rem" }}>
              <strong>{tr("Visibilité dans les stats publiques :", "Visibility in the public stats:")}</strong>{" "}
              {tr("cochez/décochez la case « stats » sous chaque année dans le sélecteur d'édition.", "tick/untick the “stats” box under each year in the edition picker.")}
            </p>
            <details style={{ marginTop: "0.75rem" }}>
              <summary style={{ cursor: "pointer", fontSize: "0.82rem", fontWeight: 600, color: "#4b5563" }}>
                {tr("Maintenance avancée", "Advanced maintenance")}
              </summary>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginTop: "0.75rem" }}>
                <p className="panel-note" style={{ marginBottom: 0 }}>
                  {tr("À utiliser seulement pour corriger ou reconstruire la base historique.", "Use only to fix or rebuild the historical database.")}
                </p>
                <SeedButton onSeed={handleSeed} seeding={seeding} seedLog={seedLog} />
                <button
                  className="btn btn--danger"
                  style={{ fontSize: "0.82rem", width: "fit-content" }}
                  onClick={async () => {
                    if (!window.confirm(tr("Supprimer TOUS les vainqueurs et les réimporter depuis le JSON ? (les données 2026 seront perdues — relancer « Clôturer l'édition » ensuite)", "Delete ALL winners and re-import them from the JSON? (2026 data will be lost — run “Close edition” again afterwards)"))) return;
                    setSeedLog([]);
                    setSeeding(true);
                    try {
                      const result = await resetAndReseedWinners((msg) => setSeedLog((p) => [...p, msg]));
                      setSeedLog((p) => [...p, `✅ ${result}`]);
                    } catch (err) {
                      setSeedLog((p) => [...p, `❌ ${err.message}`]);
                    } finally {
                      setSeeding(false);
                    }
                  }}
                  disabled={seeding}
                >
                  {tr("🔄 Réinitialiser les vainqueurs (purge + réimport)", "🔄 Reset winners (purge + re-import)")}
                </button>
                <button
                  className="btn"
                  style={{ fontSize: "0.82rem", width: "fit-content" }}
                  onClick={async () => {
                    const years = editions.filter((e) => e.year >= 2004 && e.year <= 2018).map((e) => e.year);
                    if (!years.length) return;
                    if (!window.confirm(tr(`Masquer les années ${years.join(", ")} des statistiques ?`, `Hide the years ${years.join(", ")} from the statistics?`))) return;
                    await Promise.all(years.map((y) => setEditionVisibility(y, false)));
                  }}
                >
                  {tr("Masquer 2004–2018 des stats", "Hide 2004–2018 from the stats")}
                </button>
                <button
                  className="btn"
                  style={{ fontSize: "0.82rem", width: "fit-content" }}
                  onClick={async () => {
                    if (!window.confirm(tr("Recalculer tous les records à partir des résultats déjà en base ?", "Recompute all records from the results already in the database?"))) return;
                    setSeedLog([tr("Recalcul des records…", "Recomputing records…")]);
                    setSeeding(true);
                    try {
                      const n = await rebuildMeetingRecords((msg) => setSeedLog((p) => [...p, msg]));
                      setSeedLog((p) => [...p, tr(`✅ ${n} records recalculés.`, `✅ ${n} records recomputed.`)]);
                    } catch (err) {
                      setSeedLog((p) => [...p, `❌ ${err.message}`]);
                    } finally {
                      setSeeding(false);
                    }
                  }}
                  disabled={seeding}
                >
                  {tr("Recalculer les records", "Recompute records")}
                </button>
              </div>
            </details>
          </div>
          {effectiveYear && !selectedEdition?.cancelled && (
            <div style={{ borderTop: "1px solid #e5e7eb", paddingTop: "0.75rem" }}>
              <button
                className="btn"
                style={{ fontSize: "0.82rem", color: "#dc2626", borderColor: "#dc2626" }}
                onClick={async () => {
                  if (!window.confirm(tr(`Vous avez déjà importé ${effectiveYear}. Voulez-vous vraiment le relancer ?`, `You have already imported ${effectiveYear}. Do you really want to run it again?`))) return;
                  setSeedLog([tr(`Import ${effectiveYear} relancé…`, `Re-running the ${effectiveYear} import…`)]);
                  setSeeding(true);
                  try {
                    const summary = await reseedMeetingYearFromJson(effectiveYear, (msg) => setSeedLog((p) => [...p, msg]));
                    setSeedLog((p) => [...p, tr(`✅ ${effectiveYear}: ${summary.results} résultats, ${summary.winners} vainqueurs, ${summary.records} records.`, `✅ ${effectiveYear}: ${summary.results} results, ${summary.winners} winners, ${summary.records} records.`)]);
                  } catch (err) {
                    setSeedLog((p) => [...p, `❌ ${err.message}`]);
                  } finally {
                    setSeeding(false);
                  }
                }}
                disabled={seeding}
              >
                {tr(`Relancer l'import ${effectiveYear}`, `Re-run the ${effectiveYear} import`)}
              </button>
            </div>
          )}
        </div>
      </Panel>
    </section>
  );
  if (maintenance === "only") return adminToolsPanel;

  return (
    <div className="page">
      <section className="page-header">
        <div>
          <p className="eyebrow">{tr("Historique du meeting", "Meeting history")}</p>
          <h1>{tr("Résultats par édition", "Results by edition")}</h1>
          <p>{tr("Résultats complets de chaque édition du Luxembourg Indoor Meeting.", "Full results of every edition of the Luxembourg Indoor Meeting.")}</p>
        </div>
      </section>

      {/* Édition : choisie dans la barre du module Statistiques. */}
      {selectedEdition ? (
        selectedEdition.cancelled ? (
          <div className="notice-card notice-card--warn">
            <strong>{selectedEdition.year} — {tr("édition annulée", "edition cancelled")}</strong>
            {selectedEdition.note ? <p>{selectedEdition.note}</p> : null}
          </div>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem 1rem", alignItems: "center", fontSize: "0.85rem", color: "#555" }}>
            <strong style={{ color: "#17324a" }}>{tr("Édition", "Edition")} {selectedEdition.year}{selectedYear ? "" : tr(" (la plus récente)", " (latest)")}</strong>
            <span>📅 {formatEditionDate(selectedEdition.date, language)}</span>
            {selectedEdition.venue ? <span>🏟 {selectedEdition.venue}</span> : null}
            {formatEditionLabel(selectedEdition, { withHash: true }) && (
              <span>🏆 {formatEditionLabel(selectedEdition, { withHash: true })}</span>
            )}
            {selectedEdition.label && <span>🏅 {selectedEdition.label}</span>}
            {selectedEdition.isClosed && (
              <span style={{ background: "#dcfce7", color: "#15803d", padding: "2px 8px", borderRadius: 12, fontWeight: 600, fontSize: "0.75rem" }}>{tr("Clôturée", "Closed")}</span>
            )}
            {isAdmin && (
              <label title={tr("Visible dans les statistiques publiques du site", "Visible in the public statistics on the website")} style={{ display: "inline-flex", alignItems: "center", gap: 4, cursor: "pointer", fontSize: "0.78rem", color: "#6b7280" }}>
                <input
                  type="checkbox"
                  checked={selectedEdition.visibleInStats !== false}
                  onChange={() => handleToggleVisibility(selectedEdition.year, selectedEdition.visibleInStats !== false)}
                />
                {tr("visible sur le site public", "visible on the public website")}
              </label>
            )}
          </div>
        )
      ) : editionsLoading ? <p className="panel-note">{tr("Chargement des éditions…", "Loading editions…")}</p> : null}

      {eventGroups.length > 1 ? (
        <nav className="stats-event-index" aria-label={tr("Aller à une épreuve", "Go to an event")}>
          {eventGroups.map((eventGroup) => (
            <button
              key={eventGroup.key}
              type="button"
              onClick={() => scrollToEvent(eventAnchorId(eventGroup.discipline, eventGroup.gender))}
            >
              {eventLabel(eventGroup.discipline, eventGroup.gender, language)}
            </button>
          ))}
        </nav>
      ) : null}

      {/* Results */}
      <section className="panel-grid panel-grid--1">
        <Panel
          title={`${tr("Résultats", "Results")} — ${effectiveYear ?? "—"}`}
          subtitle={resultsLoading ? tr("Chargement…", "Loading…") : tr(`${results.length} lignes, ${groups.length} épreuves`, `${results.length} rows, ${groups.length} events`)}
          actions={
            isAdmin && effectiveYear && !selectedEdition?.cancelled ? (
              <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
                {closeStatus && (
                  <span style={{ fontSize: "0.8rem", color: "#15803d", maxWidth: 260 }}>
                    {closeStatus}
                  </span>
                )}
                <button
                  className="btn btn--secondary"
                  onClick={() => { setAddingResult(true); setEditingResult(null); }}
                  style={{ whiteSpace: "nowrap", fontSize: "0.82rem" }}
                >
                  {tr("+ Ajouter un résultat", "+ Add result")}
                </button>
                {results.length > 0 && (
                  <button
                    onClick={() => setEditMode((v) => !v)}
                    style={{
                      padding: "0.3rem 0.8rem", borderRadius: 8,
                      border: "1.5px solid",
                      borderColor: editMode ? "#f59e0b" : "#d1d5db",
                      background: editMode ? "#fef3c7" : "#fff",
                      color: editMode ? "#92400e" : "#374151",
                      fontWeight: editMode ? 700 : 400,
                      fontSize: "0.82rem", cursor: "pointer", whiteSpace: "nowrap",
                    }}
                  >
                    {editMode ? tr("✏️ Mode édition activé", "✏️ Edit mode on") : tr("✏️ Modifier les résultats", "✏️ Edit results")}
                  </button>
                )}
                {!selectedEdition?.isClosed && (
                  <button
                    className="btn btn--secondary"
                    onClick={handleCloseEdition}
                    disabled={closingYear === effectiveYear}
                    style={{ whiteSpace: "nowrap" }}
                  >
                    {closingYear === effectiveYear ? tr("Clôture…", "Closing…") : tr("🔒 Clôturer l'édition", "🔒 Close edition")}
                  </button>
                )}
              </div>
            ) : null
          }
        >
          {(addingResult || editingResult) && isAdmin && (
            <ResultForm
              year={effectiveYear}
              initial={editingResult || {}}
              onSave={handleSaveResult}
              onCancel={() => { setAddingResult(false); setEditingResult(null); }}
            />
          )}
          {resultsLoading ? (
            <p className="panel-note">{tr("Chargement des résultats…", "Loading results…")}</p>
          ) : results.length === 0 ? (
            <div className="notice-card">
              <strong>{tr(`Aucun résultat pour ${effectiveYear}`, `No results for ${effectiveYear}`)}</strong>
              <p>
                {isAdmin
                  ? tr("Utilisez « Importer les données historiques » (Réglages › Maintenance) pour importer les données, ou « + Ajouter un résultat » pour saisir à la main.", "Use “Import historical data” (Settings › Maintenance) to import the data, or “+ Add result” to enter results by hand.")
                  : tr("Les résultats de cette édition ne sont pas encore disponibles.", "The results of this edition are not available yet.")}
              </p>
            </div>
          ) : (
            <div className="table-wrap table-wrap--athletes" style={{ maxHeight: "calc(100vh - 320px)" }}>
              {editMode && (
                <div style={{
                  padding: "0.5rem 0.75rem", marginBottom: "0.5rem",
                  background: "#fef3c7", border: "1px solid #fde68a",
                  borderRadius: 8, fontSize: "0.82rem", color: "#92400e",
                }}>
                  ✏️ <strong>{tr("Mode édition activé", "Edit mode on")}</strong> —{" "}
                  {tr(
                    "cliquez sur ✏️ pour modifier une ligne, 🗑 pour supprimer. Les modifications sont enregistrées directement dans la base.",
                    "click ✏️ to edit a row, 🗑 to delete. Changes are saved directly to the database.",
                  )}
                </div>
              )}
              <table className="data-table">
                <thead>
                  <tr>
                    <th style={{ width: 36 }}>{tr("Rg", "Rk")}</th>
                    <th>{tr("Épreuve", "Event")}</th>
                    <th data-sticky-col="1" className="col-sticky col-sticky--last">{tr("Athlète", "Athlete")}</th>
                    <th>Nat.</th>
                    <th>{tr("Résultat", "Result")}</th>
                    <th style={{ width: 44 }}>{tr("Série", "Heat")}</th>
                    <th>{tr("AN.", "YOB")}</th>
                    <th>Pts</th>
                    {isAdmin && <th style={{ width: 80 }}></th>}
                  </tr>
                </thead>
                <tbody>
                  {eventGroups.flatMap((eventGroup) => {
                    const primarySections = eventGroup.finals.length
                      ? eventGroup.finals
                      : (eventGroup.others.length ? eventGroup.others : eventGroup.heats);
                    const qualifyingHeats = eventGroup.finals.length ? eventGroup.heats : [];
                    const showHeats = !!expandedHeatGroups[eventGroup.key];
                    const anchorId = eventAnchorId(eventGroup.discipline, eventGroup.gender);
                    const rows = primarySections.flatMap((group, index) => renderSectionRows(group, { anchorId: index === 0 ? anchorId : undefined }));

                    if (!qualifyingHeats.length) return rows;

                    rows.push(
                      <tr key={`toggle-${eventGroup.key}`}>
                        <td colSpan={isAdmin ? 9 : 8} style={{ padding: "0.15rem 0 0.65rem" }}>
                          <button
                            type="button"
                            onClick={() => toggleHeatDetails(eventGroup.key)}
                            style={{
                              border: "1px solid #dbe4ef",
                              background: "#f8fafc",
                              color: "#334155",
                              borderRadius: 999,
                              padding: "0.28rem 0.7rem",
                              fontSize: "0.78rem",
                              fontWeight: 600,
                              cursor: "pointer",
                            }}
                          >
                            {showHeats ? tr("Masquer les séries qualificatives", "Hide qualifying heats") : tr(`Voir les séries qualificatives (${qualifyingHeats.length})`, `Show qualifying heats (${qualifyingHeats.length})`)}
                          </button>
                        </td>
                      </tr>,
                    );

                    if (showHeats) {
                      qualifyingHeats.forEach((group) => {
                        rows.push(...renderSectionRows(group, { useSectionPosition: true }));
                      });
                    }

                    return rows;
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </section>

      {/* Winners comparison */}
      {isAdmin && editions.length > 0 && (
        <section className="panel-grid panel-grid--1">
          <WinnersComparisonPanel editions={editions} allWinners={allWinners} Panel={Panel} />
        </section>
      )}

      {/* Admin tools */}
      {isAdmin && maintenance !== "hide" ? adminToolsPanel : null}
    </div>
  );
}

// ─── Meeting Records page ─────────────────────────────────────────────────────

function MeetingRecordsPage({ Panel }) {
  const tr = useTr();
  const { records, loading } = useMeetingRecords();
  const [genderFilter, setGenderFilter] = useState("all");

  const displayed = useMemo(() => {
    const base = genderFilter === "all" ? records : records.filter((r) => r.gender === genderFilter);
    return [...base].sort(compareRecordsDisplay);
  }, [records, genderFilter]);

  return (
    <div className="page">
      <section className="page-header">
        <div>
          <p className="eyebrow">{tr("Historique du meeting", "Meeting history")}</p>
          <h1>{tr("Records du meeting", "Meeting records")}</h1>
          <p>{tr("Meilleures performances de tous les temps réalisées au Luxembourg Indoor Meeting.", "All-time best performances at the Luxembourg Indoor Meeting.")}</p>
        </div>
      </section>

      <section className="panel-grid panel-grid--1">
        <Panel
          title="Records"
          subtitle={loading ? tr("Chargement…", "Loading…") : `${displayed.length} records`}
          actions={
            <div style={{ display: "flex", gap: "0.5rem" }}>
              {["all", "W", "M"].map((g) => (
                <button
                  key={g}
                  onClick={() => setGenderFilter(g)}
                  style={{
                    padding: "0.3rem 0.75rem",
                    borderRadius: 16,
                    border: "1.5px solid",
                    cursor: "pointer",
                    fontWeight: genderFilter === g ? 700 : 400,
                    background: genderFilter === g ? "#1d4ed8" : "#f8fafc",
                    color: genderFilter === g ? "#fff" : "#374151",
                    borderColor: genderFilter === g ? "#1d4ed8" : "#cbd5e1",
                    fontSize: "0.82rem",
                  }}
                >
                  {g === "all" ? tr("Tous", "All") : g === "W" ? tr("Femmes", "Women") : tr("Hommes", "Men")}
                </button>
              ))}
            </div>
          }
        >
          {loading ? (
            <p className="panel-note">{tr("Chargement des records…", "Loading records…")}</p>
          ) : records.length === 0 ? (
            <div className="notice-card">
              <strong>{tr("Aucun record pour le moment", "No records yet")}</strong>
              <p>{tr("Importez les données historiques pour remplir les records.", "Import the historical data to fill in the records.")}</p>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{tr("Épreuve", "Event")}</th>
                    <th></th>
                    <th>Record</th>
                    <th>{tr("Athlète", "Athlete")}</th>
                    <th>Nat.</th>
                    <th>Date</th>
                    <th>{tr("Année", "Year")}</th>
                  </tr>
                </thead>
                <tbody>
                  {displayed.map((r) => (
                    <tr key={r.id}>
                      <td style={{ fontWeight: 600 }}>{r.discipline}</td>
                      <td><GenderTag gender={r.gender} /></td>
                      <td style={{ fontWeight: 700, fontFamily: "monospace", color: "#1d4ed8" }}>
                        {r.mark}
                      </td>
                      <td>{r.fullName}</td>
                      <td>
                        <FlagImg noc={r.noc} />
                        {r.noc}
                      </td>
                      <td style={{ color: "#666", fontSize: "0.83rem" }}>{r.date}</td>
                      <td style={{ color: "#888", fontSize: "0.83rem" }}>{r.year}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </section>
    </div>
  );
}

// ─── Meeting Winners page ─────────────────────────────────────────────────────

function MeetingWinnersPage({ Panel }) {
  const tr = useTr();
  const { winners, loading } = useAllWinners();
  const registryIdx = useRegistryIndex();
  const [genderFilter, setGenderFilter] = useState("all");
  const [disciplineFilter, setDisciplineFilter] = useState("all");
  const [search, setSearch] = useState("");

  // Collect unique disciplines for filter — sorted by canonical event order
  const disciplines = useMemo(() => {
    const set = new Set(winners.map((w) => w.discipline));
    return ["all", ...Array.from(set).sort((a, b) =>
      disciplineSortKey(a).localeCompare(disciplineSortKey(b))
    )];
  }, [winners]);

  const filtered = useMemo(() => {
    let list = winners;
    if (genderFilter !== "all") list = list.filter((w) => w.gender === genderFilter);
    if (disciplineFilter !== "all") list = list.filter((w) => w.discipline === disciplineFilter);
    if (search.trim()) {
      const q = search.toLowerCase().trim();
      list = list.filter((w) => {
        const hay = [w.lastName, w.firstName, w.noc, w.discipline, String(w.year)]
          .filter(Boolean).join(" ").toLowerCase();
        return hay.includes(q);
      });
    }
    return list;
  }, [winners, genderFilter, disciplineFilter, search]);

  // Count how many times each athlete has won (detect serial winners)
  const winCounts = useMemo(() => {
    const counts = {};
    for (const w of winners) {
      const k = `${String(w.lastName || "").toLowerCase()}_${String(w.firstName || "").toLowerCase()}`;
      counts[k] = (counts[k] || 0) + 1;
    }
    return counts;
  }, [winners]);

  function winnerKey(w) {
    return `${String(w.lastName || "").toLowerCase()}_${String(w.firstName || "").toLowerCase()}`;
  }

  // Group by discipline for the "all" view
  const grouped = useMemo(() => {
    if (disciplineFilter !== "all") return null; // flat list when filtered
    const map = new Map();
    for (const w of filtered) {
      const key = `${w.discipline}||${w.gender}`;
      if (!map.has(key)) map.set(key, { discipline: w.discipline, gender: w.gender, rows: [] });
      map.get(key).rows.push(w);
    }
    return [...map.values()].sort(compareDisciplineGender);
  }, [filtered, disciplineFilter]);

  return (
    <div className="page">
      <section className="page-header">
        <div>
          <p className="eyebrow">{tr("Historique du meeting", "Meeting history")}</p>
          <h1>Hall of Winners</h1>
          <p>{tr("Vainqueurs de chaque épreuve du Luxembourg Indoor Meeting (2003–2026).", "Winners of every event at the Luxembourg Indoor Meeting (2003–2026).")}</p>
        </div>
      </section>

      <section className="panel-grid panel-grid--1">
        <Panel
          title={tr("Vainqueurs", "Winners")}
          subtitle={loading ? tr("Chargement…", "Loading…") : tr(`${filtered.length} victoires`, `${filtered.length} wins`)}
        >
          {/* Filters */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", marginBottom: "1rem", alignItems: "flex-end" }}>
            {/* Gender */}
            <div>
              <label style={{ display: "block", fontSize: "0.72rem", fontWeight: 600, color: "#6b7280", marginBottom: 4 }}>
                {tr("GENRE", "GENDER")}
              </label>
              <div style={{ display: "flex", gap: "0.4rem" }}>
                {["all", "W", "M"].map((g) => (
                  <button
                    key={g}
                    onClick={() => setGenderFilter(g)}
                    style={{
                      padding: "0.28rem 0.7rem",
                      borderRadius: 14,
                      border: "1.5px solid",
                      cursor: "pointer",
                      fontWeight: genderFilter === g ? 700 : 400,
                      background: genderFilter === g ? "#1d4ed8" : "#f8fafc",
                      color: genderFilter === g ? "#fff" : "#374151",
                      borderColor: genderFilter === g ? "#1d4ed8" : "#cbd5e1",
                      fontSize: "0.8rem",
                    }}
                  >
                    {g === "all" ? tr("Tous", "All") : g === "W" ? tr("Femmes", "Women") : tr("Hommes", "Men")}
                  </button>
                ))}
              </div>
            </div>

            {/* Discipline */}
            <div>
              <label style={{ display: "block", fontSize: "0.72rem", fontWeight: 600, color: "#6b7280", marginBottom: 4 }}>
                {tr("ÉPREUVE", "EVENT")}
              </label>
              <select
                className="input"
                value={disciplineFilter}
                onChange={(e) => setDisciplineFilter(e.target.value)}
                style={{ padding: "0.28rem 0.6rem", minWidth: 160 }}
              >
                {disciplines.map((d) => (
                  <option key={d} value={d}>{d === "all" ? tr("Toutes les épreuves", "All events") : d}</option>
                ))}
              </select>
            </div>

            {/* Search */}
            <div style={{ flex: 1, minWidth: 200 }}>
              <label style={{ display: "block", fontSize: "0.72rem", fontWeight: 600, color: "#6b7280", marginBottom: 4 }}>
                {tr("RECHERCHER", "SEARCH")}
              </label>
              <input
                className="input"
                placeholder={tr("Nom, pays, année…", "Name, country, year…")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>

          {loading ? (
            <p className="panel-note">{tr("Chargement des vainqueurs…", "Loading winners…")}</p>
          ) : filtered.length === 0 ? (
            <div className="notice-card">
              <strong>{tr("Aucun vainqueur trouvé", "No winners found")}</strong>
              <p>{tr("Modifiez les filtres, ou importez d'abord les données historiques.", "Change the filters, or import the historical data first.")}</p>
            </div>
          ) : grouped ? (
            // Grouped by discipline
            <div className="table-wrap table-wrap--athletes" style={{ maxHeight: "calc(100vh - 380px)" }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{tr("Année", "Year")}</th>
                    <th>{tr("Épreuve", "Event")}</th>
                    <th data-sticky-col="1" className="col-sticky col-sticky--last">{tr("Vainqueur", "Winner")}</th>
                    <th>Nat.</th>
                    <th>{tr("Résultat", "Result")}</th>
                    <th>{tr("Victoires", "Wins")}</th>
                  </tr>
                </thead>
                <tbody>
                  {grouped.map((grp) => [
                    <tr key={`grp-${grp.discipline}-${grp.gender}`} className="event-group-header">
                      <td colSpan={6} style={{ paddingTop: "0.6rem", paddingBottom: "0.35rem" }}>
                        <span style={{ fontWeight: 700, fontSize: "0.88rem", marginRight: 8 }}>
                          {grp.discipline}
                        </span>
                        <GenderTag gender={grp.gender} />
                      </td>
                    </tr>,
                    ...grp.rows.map((w) => {
                      const wins = winCounts[winnerKey(w)] || 1;
                      return (
                        <tr key={w.id}>
                          <td style={{ fontWeight: 700, fontSize: "0.9rem", color: "#1d4ed8" }}>
                            {w.year}
                          </td>
                          <td style={{ fontSize: "0.75rem", color: "#888" }}>{w.discipline}</td>
                          <td className="col-sticky col-sticky--last">
                            <AthleteNameCell
                              lastName={w.lastName}
                              firstName={w.firstName}
                              yob={w.yob}
                              registryIdx={registryIdx}
                            />
                            {wins >= 3 && (
                              <span style={{
                                marginLeft: 6, fontSize: "0.68rem", fontWeight: 700,
                                background: "#fef3c7", color: "#92400e",
                                padding: "1px 5px", borderRadius: 8,
                              }} title={tr(`${wins}× vainqueur`, `${wins}× winner`)}>
                                ×{wins}
                              </span>
                            )}
                          </td>
                          <td>
                            <FlagImg noc={w.noc} />
                            {w.noc}
                          </td>
                          <td style={{ fontFamily: "monospace", fontWeight: 600 }}>
                            {w.result || "—"}
                          </td>
                          <td>
                            {wins >= 2 ? (
                              <span style={{
                                fontSize: "0.75rem", fontWeight: 700,
                                color: wins >= 3 ? "#92400e" : "#374151",
                              }}>
                                {wins}×
                              </span>
                            ) : (
                              <span style={{ color: "#ccc", fontSize: "0.75rem" }}>—</span>
                            )}
                          </td>
                        </tr>
                      );
                    }),
                  ])}
                </tbody>
              </table>
            </div>
          ) : (
            // Flat list when a specific discipline is selected
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{tr("Année", "Year")}</th>
                    <th>{tr("Épreuve", "Event")}</th>
                    <th></th>
                    <th>{tr("Vainqueur", "Winner")}</th>
                    <th>Nat.</th>
                    <th>{tr("Résultat", "Result")}</th>
                    <th>{tr("Victoires", "Wins")}</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((w) => {
                    const wins = winCounts[winnerKey(w)] || 1;
                    return (
                      <tr key={w.id}>
                        <td style={{ fontWeight: 700, color: "#1d4ed8" }}>{w.year}</td>
                        <td style={{ fontSize: "0.83rem" }}>{w.discipline}</td>
                        <td><GenderTag gender={w.gender} /></td>
                        <td>
                          <AthleteNameCell
                            lastName={w.lastName}
                            firstName={w.firstName}
                            yob={w.yob}
                            registryIdx={registryIdx}
                          />
                          {wins >= 3 && (
                            <span style={{
                              marginLeft: 6, fontSize: "0.68rem", fontWeight: 700,
                              background: "#fef3c7", color: "#92400e",
                              padding: "1px 5px", borderRadius: 8,
                            }} title={tr(`${wins}× vainqueur`, `${wins}× winner`)}>
                              ×{wins}
                            </span>
                          )}
                        </td>
                        <td>
                          <FlagImg noc={w.noc} />
                          {w.noc}
                        </td>
                        <td style={{ fontFamily: "monospace", fontWeight: 600 }}>{w.result || "—"}</td>
                        <td style={{ fontSize: "0.82rem", fontWeight: wins >= 2 ? 700 : 400, color: wins >= 3 ? "#92400e" : "#374151" }}>
                          {wins >= 2 ? `${wins}×` : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </section>
    </div>
  );
}

export { MeetingHistoryPage, MeetingRecordsPage, MeetingWinnersPage };
