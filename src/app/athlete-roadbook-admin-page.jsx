import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { doc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "../services/firebase";
import { buildAppUrl } from "../services/app-url";
import { useSiteEditionYear } from "./edition";
import { FileUpload } from "./file-upload";
import { inferEditionDisplayNumber } from "./meeting-edition-utils";
import meetingEditionsSeed from "../data/meetingEditions.json";
import { useMeetingEditions } from "./meeting-history-hooks";
import {
  CALL_TIME_COLUMNS,
  ROADBOOK_COLLECTION,
  SCHEDULE_ITEM_ICONS,
  cloneDefaultRoadbook,
  formatScheduleDay,
  normalizeRoadbook,
  parseCallTimeRows,
} from "./athlete-roadbook-shared";

const TABS = [
  { id: "general", label: "Infos générales" },
  { id: "arrival", label: "Arrivée & départ" },
  { id: "schedule", label: "Programme" },
  { id: "competition", label: "Compétition" },
  { id: "venue", label: "La Coque" },
  { id: "calltimes", label: "Call times" },
];

function newId(prefix) {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function setIn(object, path, value) {
  const [head, ...rest] = path;
  if (!rest.length) return Array.isArray(object) ? object.map((item, index) => (index === head ? value : item)) : { ...object, [head]: value };
  const next = setIn(object[head], rest, value);
  return Array.isArray(object) ? object.map((item, index) => (index === head ? next : item)) : { ...object, [head]: next };
}

function getIn(object, path) {
  return path.reduce((current, key) => current?.[key], object);
}

function moveItem(list, index, delta) {
  const target = index + delta;
  if (target < 0 || target >= list.length) return list;
  const next = [...list];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

async function downloadCallTimesTemplate() {
  const ExcelJSModule = await import("exceljs");
  const ExcelJS = ExcelJSModule.default ?? ExcelJSModule;
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Call times");
  sheet.columns = CALL_TIME_COLUMNS.map((column) => ({ header: column.label.en, key: column.key, width: column.key === "event" ? 24 : 16 }));
  sheet.getRow(1).font = { bold: true };
  sheet.addRow({ event: "60m Heat 1 Women", firstCall: "15:43", lastCall: "15:50", officialCall: "15:53", callRoomOut: "16:00", warmUp: "16:01 - 16:04", presentation: "16:04", start: "16:06" });
  const buffer = await workbook.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "modele-call-times.xlsx";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

// Champ bilingue EN/FR. Lit et écrit le brouillon via le contexte, pour rester
// un composant stable (pas recréé à chaque rendu, donc sans perte de focus).
const RoadbookDraftContext = createContext(null);

function L({ label, path, multiline = false, hint }) {
  const { draft, update } = useContext(RoadbookDraftContext);
  const value = getIn(draft, path) || { en: "", fr: "" };
  const Tag = multiline ? "textarea" : "input";
  return (
    <div className="roadbook-admin-field">
      <span className="roadbook-admin-field__label">{label}</span>
      <div className="roadbook-admin-field__langs">
        {["en", "fr"].map((language) => (
          <label key={language}>
            <small>{language.toUpperCase()}</small>
            <Tag rows={multiline ? 4 : undefined} value={value[language] || ""} onChange={(event) => update([...path, language], event.target.value)} />
          </label>
        ))}
      </div>
      {hint ? <small className="roadbook-admin-field__hint">{hint}</small> : null}
    </div>
  );
}

function AthleteRoadbookAdminPage({ Panel }) {
  const { siteEditionYear, loading: siteYearLoading } = useSiteEditionYear();
  const { editions, loading: editionsLoading } = useMeetingEditions();
  const [stored, setStored] = useState(undefined);
  const [draft, setDraft] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [activeTab, setActiveTab] = useState("general");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [callTimesReport, setCallTimesReport] = useState(null);

  // Même édition que la page publique et le reste du site public.
  const edition = useMemo(() => {
    const configured = siteEditionYear
      ? editions.find((candidate) => Number(candidate.year || candidate.id) === Number(siteEditionYear))
      : null;
    return configured || editions[0] || null;
  }, [editions, siteEditionYear]);
  const editionId = edition ? String(edition.id) : "";

  useEffect(() => {
    if (!editionId) return undefined;
    setStored(undefined);
    const unsubscribe = onSnapshot(
      doc(db, ROADBOOK_COLLECTION, editionId),
      (snapshot) => setStored(snapshot.exists() ? snapshot.data() : null),
      (snapshotError) => {
        console.error("Unable to load the athlete roadbook", snapshotError);
        setError("Impossible de charger le roadbook.");
      },
    );
    return unsubscribe;
  }, [editionId]);

  useEffect(() => {
    if (stored === undefined || dirty) return;
    setDraft(stored ? normalizeRoadbook(stored) : null);
  }, [dirty, stored]);

  function update(path, value) {
    setDraft((current) => setIn(current, path, value));
    setDirty(true);
    setStatusMessage("");
  }

  async function save(nextDraft = draft, message = "Roadbook enregistré.") {
    if (!nextDraft || !editionId) return;
    setSaving(true);
    setError("");
    try {
      await setDoc(doc(db, ROADBOOK_COLLECTION, editionId), { ...nextDraft, editionId, updatedAt: serverTimestamp() });
      setDirty(false);
      setStatusMessage(message);
    } catch (saveError) {
      console.error("Athlete roadbook save failed", saveError);
      setError("Enregistrement impossible. Vérifie ta connexion puis réessaie.");
    } finally {
      setSaving(false);
    }
  }

  function createFromTemplate() {
    const initial = cloneDefaultRoadbook();
    setDraft(initial);
    save(initial, "Roadbook créé à partir du contenu 2026 corrigé. Vérifie les horaires avant de publier.");
  }

  function togglePublished() {
    const nextStatus = draft.status === "published" ? "draft" : "published";
    const next = { ...draft, status: nextStatus };
    setDraft(next);
    save(next, nextStatus === "published" ? "Roadbook publié : les athlètes peuvent le consulter." : "Roadbook repassé en brouillon.");
  }

  async function handleCallTimesFile(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError("");
    try {
      const { read, utils } = await import("xlsx");
      const workbook = read(await file.arrayBuffer());
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = utils.sheet_to_json(sheet, { header: 1, defval: "", raw: true });
      const result = parseCallTimeRows(rows);
      if (result.error) {
        setError("Colonne « Event » (ou « Épreuve ») introuvable. Utilise le modèle Excel.");
        return;
      }
      setDraft((current) => ({ ...current, callTimes: result.rows, callTimesFileName: file.name }));
      setDirty(true);
      setCallTimesReport({ count: result.rows.length, missingColumns: result.missingColumns, fileName: file.name });
    } catch (importError) {
      console.error("Call times import failed", importError);
      setError("Impossible de lire ce fichier Excel.");
    }
  }

  if (siteYearLoading || editionsLoading || (editionId && stored === undefined)) {
    return (
      <div className="page">
        <p>Chargement du roadbook…</p>
      </div>
    );
  }

  const editionNumber = inferEditionDisplayNumber(edition, [...editions, ...meetingEditionsSeed]);
  const editionDate = edition?.date?.toDate?.() || (edition?.date ? new Date(edition.date) : null);
  const timetableCount = Array.isArray(edition?.timetable) ? edition.timetable.length : 0;
  const previewUrl = buildAppUrl("/athletes/roadbook?preview=1");
  const publicUrl = buildAppUrl("/athletes/roadbook");

  return (
    <RoadbookDraftContext.Provider value={{ draft, update }}>
    <div className="page">
      <section className="page-header">
        <div>
          <p className="eyebrow">Accréditations · Athlètes</p>
          <h1>Roadbook athlètes</h1>
          <p>
            Page publique <a href={publicUrl} target="_blank" rel="noreferrer">{publicUrl}</a>, à mettre derrière le QR
            « Roadbook athlete » des badges. Textes en anglais et en français ; une ligne = un point de liste.
          </p>
        </div>
      </section>

      {error ? <p className="form-error">{error}</p> : null}
      {statusMessage ? <p className="panel-note panel-note--success">{statusMessage}</p> : null}

      <Panel
        title={`Édition ${edition?.year || editionId || "—"}`}
        subtitle="Repris automatiquement de Site web → Édition courante (rien à ressaisir ici)."
        actions={
          <Link className="button button--secondary button--small" to="/app/website/edition">
            Modifier l'édition
          </Link>
        }
      >
        <div className="roadbook-admin-facts">
          <span>Numéro : <strong>{editionNumber ? `Édition ${editionNumber}` : "—"}</strong></span>
          <span>Date : <strong>{editionDate && !Number.isNaN(editionDate.getTime()) ? editionDate.toLocaleDateString("fr-LU", { day: "numeric", month: "long", year: "numeric" }) : "à renseigner"}</strong></span>
          <span>Lieu : <strong>{edition?.venue || "à renseigner"}</strong></span>
          <span>Horaire : <strong>{timetableCount ? `${timetableCount} ligne(s)` : "pas encore saisi"}</strong></span>
          <span>Live results : <strong>{edition?.resultsUrl ? "lien défini" : "pas encore de lien"}</strong></span>
        </div>
      </Panel>

      {!draft ? (
        <Panel title="Pas encore de roadbook pour cette édition">
          <p className="panel-note">
            Le roadbook sera pré-rempli avec le contenu 2026 corrigé (trajets, programme, règles, zones). Il reste en
            brouillon tant que tu ne le publies pas.
          </p>
          <button className="button button--primary" type="button" disabled={saving} onClick={createFromTemplate}>
            Créer le roadbook
          </button>
        </Panel>
      ) : (
        <>
          <div className="roadbook-admin-bar">
            <span className={`status-pill ${draft.status === "published" ? "status-pill--ok" : "status-pill--pending"}`}>
              {draft.status === "published" ? "Publié" : "Brouillon"}
            </span>
            {dirty ? <span className="roadbook-admin-bar__dirty">Modifications non enregistrées</span> : null}
            <div className="roadbook-admin-bar__actions">
              <a className="button button--secondary button--small" href={previewUrl} target="_blank" rel="noreferrer">
                Aperçu
              </a>
              <button className="button button--secondary button--small" type="button" disabled={saving} onClick={togglePublished}>
                {draft.status === "published" ? "Repasser en brouillon" : "Publier"}
              </button>
              <button className="button button--primary button--small" type="button" disabled={saving || !dirty} onClick={() => save()}>
                {saving ? "Enregistrement…" : "Enregistrer"}
              </button>
            </div>
          </div>

          <div className="admin-subtabs" role="tablist" aria-label="Parties du roadbook">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={`admin-subtab ${activeTab === tab.id ? "admin-subtab--active" : ""}`}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {activeTab === "general" ? (
            <Panel title="Infos générales">
              <L label="Introduction (sous le titre)" path={["intro"]} multiline />
              <label className="roadbook-admin-single">
                <span>Hôtel des athlètes</span>
                <input value={draft.hotel} onChange={(event) => update(["hotel"], event.target.value)} />
              </label>
              <L label="Libellé du contact d'urgence" path={["emergency", "label"]} />
              <div className="roadbook-admin-row">
                <label className="roadbook-admin-single">
                  <span>Nom du contact d'urgence</span>
                  <input value={draft.emergency.name} onChange={(event) => update(["emergency", "name"], event.target.value)} />
                </label>
                <label className="roadbook-admin-single">
                  <span>Téléphone d'urgence</span>
                  <input type="tel" value={draft.emergency.phone} placeholder="+352 …" onChange={(event) => update(["emergency", "phone"], event.target.value)} />
                </label>
              </div>
              <L label="Texte photos" path={["photos", "text"]} multiline />
              <label className="roadbook-admin-single">
                <span>Lien de la galerie photos</span>
                <input type="url" value={draft.photos.url} placeholder="https://…" onChange={(event) => update(["photos", "url"], event.target.value)} />
              </label>
              <div className="roadbook-admin-row">
                <label className="roadbook-admin-single">
                  <span>Lien e-magazine (vide = e-magazine du site)</span>
                  <input type="url" value={draft.links.emagazineUrl} onChange={(event) => update(["links", "emagazineUrl"], event.target.value)} />
                </label>
                <label className="roadbook-admin-single">
                  <span>Lien live results (vide = lien de l'édition)</span>
                  <input type="url" value={draft.links.liveResultsUrl} onChange={(event) => update(["links", "liveResultsUrl"], event.target.value)} />
                </label>
              </div>
            </Panel>
          ) : null}

          {activeTab === "arrival" ? (
            <Panel title="Arrivée & départ">
              <L label="Point de rendez-vous" path={["arrival", "meetingPoint"]} multiline />
              <L label="Depuis l'aéroport" path={["arrival", "fromAirport"]} multiline />
              <L label="Vers l'aéroport" path={["arrival", "toAirport"]} multiline />
              <L label="Horaires du tram" path={["arrival", "tramHours"]} multiline />
              <L label="Depuis la gare" path={["arrival", "fromTrainStation"]} multiline />
              <L label="Vers la gare" path={["arrival", "toTrainStation"]} multiline />
              <div className="roadbook-admin-row">
                <FileUpload
                  value={draft.arrival.airportMapUrl}
                  onChange={(url) => update(["arrival", "airportMapUrl"], url)}
                  accept="image/*"
                  storagePath="athlete-roadbook"
                  label="Plan de l'aéroport"
                  helperText="Image · Max 20 MB"
                />
                <FileUpload
                  value={draft.arrival.trainStationMapUrl}
                  onChange={(url) => update(["arrival", "trainStationMapUrl"], url)}
                  accept="image/*"
                  storagePath="athlete-roadbook"
                  label="Plan de la gare"
                  helperText="Image · Max 20 MB"
                />
              </div>
            </Panel>
          ) : null}

          {activeTab === "schedule" ? (
            <Panel
              title="Programme des athlètes"
              subtitle="Les intitulés des jours sont calculés depuis la date de l'édition (J−2, J−1, jour de compétition)."
              actions={
                <button
                  className="button button--secondary button--small"
                  type="button"
                  onClick={() =>
                    update(["schedule"], [
                      ...draft.schedule,
                      { id: newId("day"), offsetDays: 1, access: { en: "", fr: "" }, highlight: false, items: [] },
                    ])
                  }
                >
                  Ajouter un jour
                </button>
              }
            >
              {draft.schedule.map((day, dayIndex) => (
                <fieldset key={day.id} className="roadbook-admin-day">
                  <legend>{formatScheduleDay(edition?.date, day.offsetDays, "fr")}</legend>
                  <div className="roadbook-admin-row">
                    <label className="roadbook-admin-single">
                      <span>Jour (par rapport à la compétition)</span>
                      <select value={day.offsetDays} onChange={(event) => update(["schedule", dayIndex, "offsetDays"], Number(event.target.value))}>
                        {[-4, -3, -2, -1, 0, 1].map((offset) => (
                          <option key={offset} value={offset}>
                            {offset === 0 ? "Jour de compétition" : `J${offset > 0 ? "+" : "−"}${Math.abs(offset)}`} · {formatScheduleDay(edition?.date, offset, "fr")}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="roadbook-admin-check">
                      <input type="checkbox" checked={day.highlight} onChange={(event) => update(["schedule", dayIndex, "highlight"], event.target.checked)} />
                      Mettre en avant (rouge)
                    </label>
                  </div>
                  <L label="Accès à la Coque" path={["schedule", dayIndex, "access"]} />
                  {day.items.map((item, itemIndex) => (
                    <div key={item.id} className="roadbook-admin-item">
                      <div className="roadbook-admin-item__head">
                        <select value={item.icon} onChange={(event) => update(["schedule", dayIndex, "items", itemIndex, "icon"], event.target.value)}>
                          {SCHEDULE_ITEM_ICONS.map((icon) => (
                            <option key={icon.value} value={icon.value}>{icon.emoji} {icon.label}</option>
                          ))}
                        </select>
                        <button type="button" className="button button--secondary button--small" onClick={() => update(["schedule", dayIndex, "items"], moveItem(day.items, itemIndex, -1))}>↑</button>
                        <button type="button" className="button button--secondary button--small" onClick={() => update(["schedule", dayIndex, "items"], moveItem(day.items, itemIndex, 1))}>↓</button>
                        <button type="button" className="button button--danger-soft button--small" onClick={() => update(["schedule", dayIndex, "items"], day.items.filter((_, index) => index !== itemIndex))}>Retirer</button>
                      </div>
                      <L label="Titre" path={["schedule", dayIndex, "items", itemIndex, "title"]} />
                      <L label="Détails (une ligne par horaire)" path={["schedule", dayIndex, "items", itemIndex, "lines"]} multiline />
                    </div>
                  ))}
                  <div className="roadbook-admin-day__actions">
                    <button
                      type="button"
                      className="button button--secondary button--small"
                      onClick={() =>
                        update(["schedule", dayIndex, "items"], [
                          ...day.items,
                          { id: newId("item"), icon: "info", title: { en: "", fr: "" }, lines: { en: "", fr: "" } },
                        ])
                      }
                    >
                      Ajouter une ligne
                    </button>
                    <button type="button" className="button button--secondary button--small" onClick={() => update(["schedule"], moveItem(draft.schedule, dayIndex, -1))}>Monter le jour</button>
                    <button
                      type="button"
                      className="button button--danger-soft button--small"
                      onClick={() => window.confirm("Supprimer ce jour et ses lignes ?") && update(["schedule"], draft.schedule.filter((_, index) => index !== dayIndex))}
                    >
                      Supprimer le jour
                    </button>
                  </div>
                </fieldset>
              ))}
            </Panel>
          ) : null}

          {activeTab === "competition" ? (
            <Panel
              title="Informations compétition"
              actions={
                <button
                  className="button button--secondary button--small"
                  type="button"
                  onClick={() => update(["competitionInfo"], [...draft.competitionInfo, { id: newId("ci"), event: { en: "", fr: "" }, rule: { en: "", fr: "" } }])}
                >
                  Ajouter une épreuve
                </button>
              }
            >
              {draft.competitionInfo.map((entry, index) => (
                <div key={entry.id} className="roadbook-admin-item">
                  <div className="roadbook-admin-item__head">
                    <button type="button" className="button button--secondary button--small" onClick={() => update(["competitionInfo"], moveItem(draft.competitionInfo, index, -1))}>↑</button>
                    <button type="button" className="button button--secondary button--small" onClick={() => update(["competitionInfo"], moveItem(draft.competitionInfo, index, 1))}>↓</button>
                    <button type="button" className="button button--danger-soft button--small" onClick={() => update(["competitionInfo"], draft.competitionInfo.filter((_, itemIndex) => itemIndex !== index))}>Retirer</button>
                  </div>
                  <L label="Épreuve" path={["competitionInfo", index, "event"]} />
                  <L label="Règle" path={["competitionInfo", index, "rule"]} />
                </div>
              ))}
            </Panel>
          ) : null}

          {activeTab === "venue" ? (
            <Panel title="La Coque" subtitle="Le plan du roadbook est propre aux athlètes (différent de celui des accréditations).">
              <L label="Comment s'y rendre" path={["venue", "intro"]} multiline />
              <L label="Zones d'accès (une par ligne, dans l'ordre des numéros du plan)" path={["venue", "zones"]} multiline />
              <FileUpload
                value={draft.venue.planImageUrl}
                onChange={(url) => update(["venue", "planImageUrl"], url)}
                accept="image/*"
                storagePath="athlete-roadbook"
                label="Plan de la Coque"
                helperText="Image · Max 20 MB"
              />
            </Panel>
          ) : null}

          {activeTab === "calltimes" ? (
            <Panel
              title="Call times"
              subtitle="Import depuis Excel : première ligne d'en-têtes avec les colonnes du tableau 2026 (anglais ou français). Les heures au format Excel sont converties."
              actions={
                <div className="roadbook-admin-day__actions">
                  <button className="button button--secondary button--small" type="button" onClick={downloadCallTimesTemplate}>
                    Télécharger le modèle
                  </button>
                  <label className="button button--primary button--small roadbook-admin-file">
                    Importer un Excel
                    <input type="file" accept=".xlsx,.xls,.csv" onChange={handleCallTimesFile} />
                  </label>
                </div>
              }
            >
              {callTimesReport ? (
                <p className="panel-note">
                  {callTimesReport.fileName} : {callTimesReport.count} épreuve(s) lue(s).
                  {callTimesReport.missingColumns.length ? ` Colonnes absentes : ${callTimesReport.missingColumns.join(", ")}.` : ""} Pense à
                  enregistrer.
                </p>
              ) : draft.callTimesFileName ? (
                <p className="panel-note">Dernier import : {draft.callTimesFileName}</p>
              ) : null}
              {draft.callTimes.length ? (
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        {CALL_TIME_COLUMNS.map((column) => (
                          <th key={column.key}>{column.label.fr}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {draft.callTimes.map((row) => (
                        <tr key={row.id || row.event}>
                          {CALL_TIME_COLUMNS.map((column) => (
                            <td key={column.key}>{row[column.key]}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="panel-note">Aucun call time importé pour l'instant.</p>
              )}
            </Panel>
          ) : null}
        </>
      )}
    </div>
    </RoadbookDraftContext.Provider>
  );
}

export { AthleteRoadbookAdminPage };
