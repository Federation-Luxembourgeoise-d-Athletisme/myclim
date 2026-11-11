import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { doc, getDoc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "../services/firebase";
import { buildAppUrl } from "../services/app-url";
import { useSiteEditionYear } from "./edition";
import { FileUpload } from "./file-upload";
import { inferEditionDisplayNumber } from "./meeting-edition-utils";
import meetingEditionsSeed from "../data/meetingEditions.json";
import { useMeetingEditions } from "./meeting-history-hooks";
import { normalizeAccreditationConfigurationPayload } from "./accreditation-config";
import { ACCREDITATION_CONFIGURATION_DOC_PATH } from "./seed-data";
import { useLanguage } from "./language-context";
import { useTr } from "./use-tr";

// Ressource QR des badges qui doit mener au roadbook (voir accreditation-config).
const BADGE_QR_RESOURCE_ID = "athlete-roadbook";
import {
  CALL_TIME_COLUMNS,
  LABEL_FIELDS,
  ROADBOOK_COLLECTION,
  ROADBOOK_SECTION_IDS,
  SCHEDULE_ITEM_ICONS,
  cloneDefaultRoadbook,
  formatScheduleDay,
  getAccreditationZoneNames,
  normalizeRoadbook,
  parseCallTimeRows,
  roadbookFromPreviousEdition,
  withAccreditationZones,
} from "./athlete-roadbook-shared";
import { useCoquePlan } from "./coque-plan/coque-plan-hooks";
import { PlanCanvas } from "./coque-plan/coque-plan-view";

const TABS = [
  { id: "general", label: "Infos générales", labelEn: "General info" },
  { id: "bookings", label: "Kiné & places", labelEn: "Physio & seats" },
  { id: "arrival", label: "Arrivée & départ", labelEn: "Arrival & departure" },
  { id: "schedule", label: "Programme", labelEn: "Schedule" },
  { id: "competition", label: "Compétition", labelEn: "Competition" },
  { id: "venue", label: "La Coque", labelEn: "Coque" },
  { id: "calltimes", label: "Call times", labelEn: "Call times" },
  { id: "extra", label: "Sections libres", labelEn: "Custom sections" },
  { id: "labels", label: "Titres & sections", labelEn: "Titles & sections" },
];

// Libellés anglais (back-office) des champs LABEL_FIELDS et des icônes du
// programme, définis dans athlete-roadbook-shared en français.
const LABEL_FIELDS_EN = {
  heroEyebrow: "Page top eyebrow",
  titleLead: "Title (1st word)",
  titleAccent: "Title (word in red)",
  fromAirport: "“From the airport” card",
  toAirport: "“To the airport” card",
  tramHours: "“Tram hours” card",
  fromTrainStation: "“From the train station” card",
  toTrainStation: "“To the train station” card",
  accessZones: "Access zones title",
  timetableEmpty: "Timetable not published yet",
  callTimesEmpty: "Call times not published yet",
  livePhotos: "Photos link",
  emagazine: "E-magazine link",
  liveResults: "Live results link",
  emergency: "Emergency contact (default)",
  bookingsEyebrow: "“Bookings” menu group",
  physioTitle: "Physio booking title",
  ticketsTitle: "Guest seats title",
  quickPhysio: "Physio quick-access button",
  quickTickets: "Guest seats quick-access button",
};

const SCHEDULE_ICON_LABELS_EN = {
  gym: "Gym",
  coque: "Coque",
  lunch: "Lunch",
  dinner: "Dinner",
  shuttle: "Shuttle",
  physio: "Physio",
  info: "Info",
};

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

// Champ de texte du roadbook (en anglais : la page est en anglais). Lit et
// écrit le brouillon via le contexte, pour rester un composant stable (pas
// recréé à chaque rendu, donc sans perte de focus). Les textes français déjà
// enregistrés sont conservés tels quels dans les données, sans être affichés.
const RoadbookDraftContext = createContext(null);

function L({ label, path, multiline = false, hint }) {
  const { draft, update } = useContext(RoadbookDraftContext);
  const value = getIn(draft, path) || { en: "", fr: "" };
  const Tag = multiline ? "textarea" : "input";
  return (
    <label className="roadbook-admin-single">
      <span>{label}</span>
      <Tag rows={multiline ? 4 : undefined} value={value.en || ""} onChange={(event) => update([...path, "en"], event.target.value)} />
      {hint ? <small className="roadbook-admin-field__hint">{hint}</small> : null}
    </label>
  );
}

// Champ texte simple (libellés, titres de section) : chemin vers une chaîne.
function T({ label, path, placeholder }) {
  const { draft, update } = useContext(RoadbookDraftContext);
  return (
    <label className="roadbook-admin-single">
      <span>{label}</span>
      <input value={getIn(draft, path) || ""} placeholder={placeholder} onChange={(event) => update(path, event.target.value)} />
    </label>
  );
}

function CopyLink({ label, url }) {
  const tr = useTr();
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }
  return (
    <div className="roadbook-admin-link">
      <span>{label}</span>
      <a href={url} target="_blank" rel="noreferrer">{url}</a>
      <button type="button" className="button button--secondary button--small" onClick={copy}>
        {copied ? tr("Copié ✓", "Copied ✓") : tr("Copier", "Copy")}
      </button>
    </div>
  );
}

async function downloadQrCode(url, filename) {
  const QRCode = (await import("qrcode")).default;
  const dataUrl = await QRCode.toDataURL(url, { margin: 2, width: 1024 });
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

const SECTION_LABELS_FR = {
  arrival: "Arrivée & départ",
  schedule: "Programme",
  competition: "Compétition",
  venue: "La Coque",
  timetable: "Horaire",
  calltimes: "Call times",
  links: "Photos & liens",
};

const SECTION_LABELS_EN = {
  arrival: "Arrival & departure",
  schedule: "Schedule",
  competition: "Competition",
  venue: "Coque",
  timetable: "Timetable",
  calltimes: "Call times",
  links: "Photos & links",
};

const LOAD_ERROR = "roadbook-load-error";

function AthleteRoadbookAdminPage({ Panel }) {
  const tr = useTr();
  const { language } = useLanguage();
  const { siteEditionYear, loading: siteYearLoading } = useSiteEditionYear();
  const { editions, loading: editionsLoading } = useMeetingEditions();
  const { elements: coquePlanElements } = useCoquePlan();
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
        // Clé traduite à l'affichage (tr n'est pas une dépendance stable).
        setError(LOAD_ERROR);
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

  async function save(nextDraft = draft, message = tr("Roadbook enregistré.", "Roadbook saved.")) {
    if (!nextDraft || !editionId) return;
    setSaving(true);
    setError("");
    try {
      const toSave = withAccreditationZones(nextDraft, accreditationZoneNames);
      await setDoc(doc(db, ROADBOOK_COLLECTION, editionId), { ...toSave, editionId, updatedAt: serverTimestamp() });
      setDirty(false);
      setStatusMessage(message);
    } catch (saveError) {
      console.error("Athlete roadbook save failed", saveError);
      setError(tr("Enregistrement impossible. Vérifie ta connexion puis réessaie.", "Could not save. Check your connection and try again."));
    } finally {
      setSaving(false);
    }
  }

  // QR « Roadbook athlete » des badges d'accréditation : on affiche vers quoi
  // il pointe et on permet de le régler sur le lien du roadbook en un clic.
  const roadbookUrl = buildAppUrl("/roadbook");
  const [badgeQr, setBadgeQr] = useState(undefined);
  // Zones d'accès des accréditations (ordre = numéros du plan des badges).
  const [accreditationZoneNames, setAccreditationZoneNames] = useState([]);
  useEffect(() => {
    const unsubscribe = onSnapshot(
      doc(db, ...ACCREDITATION_CONFIGURATION_DOC_PATH),
      (snapshot) => {
        const configuration = normalizeAccreditationConfigurationPayload(snapshot.exists() ? snapshot.data() : {});
        const resource = configuration.qrResources.find((entry) => entry.id === BADGE_QR_RESOURCE_ID);
        setBadgeQr(resource ? { url: resource.targetType === "url" ? resource.url : "", type: resource.targetType } : null);
        setAccreditationZoneNames(getAccreditationZoneNames(configuration.zones));
      },
      () => setBadgeQr(null),
    );
    return unsubscribe;
  }, []);

  async function pointBadgeQrToRoadbook() {
    setError("");
    try {
      const reference = doc(db, ...ACCREDITATION_CONFIGURATION_DOC_PATH);
      const snapshot = await getDoc(reference);
      const configuration = normalizeAccreditationConfigurationPayload(snapshot.exists() ? snapshot.data() : {});
      const qrResources = configuration.qrResources.map((resource) =>
        resource.id === BADGE_QR_RESOURCE_ID ? { ...resource, targetType: "url", url: roadbookUrl, documentId: "" } : resource,
      );
      await setDoc(reference, { qrResources, updatedAt: serverTimestamp() }, { merge: true });
      setStatusMessage(tr("Le QR « Roadbook athlete » des badges pointe maintenant vers le roadbook.", "The badges' “Roadbook athlete” QR now points to the roadbook."));
    } catch (qrError) {
      console.error("Badge QR update failed", qrError);
      setError(tr("Impossible de mettre à jour le QR des badges.", "Unable to update the badge QR."));
    }
  }

  // Édition précédente (la plus récente avant celle-ci, hors éditions annulées).
  const previousEdition = useMemo(() => {
    const currentYear = Number(edition?.year || edition?.id);
    if (!currentYear) return null;
    return editions
      .filter((candidate) => !candidate.cancelled && Number(candidate.year || candidate.id) < currentYear)
      .sort((left, right) => Number(right.year || right.id) - Number(left.year || left.id))[0] || null;
  }, [editions, edition]);

  // On repart du roadbook de l'an dernier s'il a été enregistré ; sinon du
  // contenu 2026 corrigé intégré à l'app.
  async function createFromTemplate() {
    setSaving(true);
    let initial = null;
    let message = tr(
      "Roadbook créé à partir du contenu 2026 corrigé. Vérifie les horaires avant de publier.",
      "Roadbook created from the corrected 2026 content. Check the times before publishing.",
    );
    try {
      if (previousEdition) {
        const previous = await getDoc(doc(db, ROADBOOK_COLLECTION, String(previousEdition.id)));
        if (previous.exists()) {
          initial = roadbookFromPreviousEdition(previous.data());
          const previousLabel = previousEdition.year || previousEdition.id;
          message = tr(
            `Roadbook créé à partir de celui de ${previousLabel} (call times et lien photos à refaire). Vérifie les horaires avant de publier.`,
            `Roadbook created from the ${previousLabel} one (call times and photos link to redo). Check the times before publishing.`,
          );
        }
      }
    } catch (loadError) {
      console.warn("Previous roadbook not readable, using the built-in content", loadError);
    }
    setSaving(false);
    const next = initial || cloneDefaultRoadbook();
    setDraft(next);
    save(next, message);
  }

  function togglePublished() {
    const nextStatus = draft.status === "published" ? "draft" : "published";
    const next = { ...draft, status: nextStatus };
    setDraft(next);
    save(
      next,
      nextStatus === "published"
        ? tr("Roadbook publié : les athlètes peuvent le consulter.", "Roadbook published: athletes can now view it.")
        : tr("Roadbook repassé en brouillon.", "Roadbook moved back to draft."),
    );
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
        setError(tr("Colonne « Event » (ou « Épreuve ») introuvable. Utilise le modèle Excel.", "“Event” column (or “Épreuve”) not found. Use the Excel template."));
        return;
      }
      setDraft((current) => ({ ...current, callTimes: result.rows, callTimesFileName: file.name }));
      setDirty(true);
      setCallTimesReport({ count: result.rows.length, missingColumns: result.missingColumns, fileName: file.name });
    } catch (importError) {
      console.error("Call times import failed", importError);
      setError(tr("Impossible de lire ce fichier Excel.", "Unable to read this Excel file."));
    }
  }

  if (siteYearLoading || editionsLoading || (editionId && stored === undefined)) {
    return (
      <div className="page">
        <p>{tr("Chargement du roadbook…", "Loading the roadbook…")}</p>
      </div>
    );
  }

  const dayLanguage = language === "fr" ? "fr" : "en";
  const editionNumber = inferEditionDisplayNumber(edition, [...editions, ...meetingEditionsSeed]);
  const editionDate = edition?.date?.toDate?.() || (edition?.date ? new Date(edition.date) : null);
  const timetableCount = Array.isArray(edition?.timetable) ? edition.timetable.length : 0;
  const previewUrl = buildAppUrl("/roadbook?preview=1");
  // Lien court et stable d'une année à l'autre (il suit l'édition du site).
  const publicUrl = roadbookUrl;
  const badgeQrOk = badgeQr?.url === publicUrl;
  // Zones enregistrées dans le roadbook différentes de celles des accréditations.
  const zonesOutdated = Boolean(
    draft &&
      draft.venue.source !== "custom" &&
      accreditationZoneNames.length &&
      String(draft.venue.zones?.en || "") !== accreditationZoneNames.join("\n"),
  );

  return (
    <RoadbookDraftContext.Provider value={{ draft, update }}>
    <div className="page">
      <section className="page-header">
        <div>
          <p className="eyebrow">{tr("Accréditations · Athlètes", "Accreditations · Athletes")}</p>
          <h1>{tr("Roadbook athlètes", "Athlete roadbook")}</h1>
          <p>
            {tr(
              "Page en anglais, entièrement modifiable ici. Dans les textes, une ligne = un point de liste.",
              "English page, fully editable here. In the texts, one line = one bullet point.",
            )}
          </p>
        </div>
      </section>

      {error ? <p className="form-error">{error === LOAD_ERROR ? tr("Impossible de charger le roadbook.", "Unable to load the roadbook.") : error}</p> : null}
      {statusMessage ? <p className="panel-note panel-note--success">{statusMessage}</p> : null}

      <Panel
        title={tr("Lien à partager", "Link to share")}
        subtitle={
          draft?.status === "published"
            ? tr("Le roadbook est publié : ces liens sont actifs.", "The roadbook is published: these links are live.")
            : tr(
                "Le roadbook est en brouillon : les athlètes verront « pas encore disponible » tant qu'il n'est pas publié.",
                "The roadbook is a draft: athletes will see “not available yet” until it is published.",
              )
        }
        actions={
          <button type="button" className="button button--secondary button--small" onClick={() => downloadQrCode(publicUrl, "roadbook-qr.png")}>
            {tr("Télécharger le QR", "Download QR code")}
          </button>
        }
      >
        <div className="roadbook-admin-links">
          <CopyLink label="Roadbook" url={publicUrl} />
          <CopyLink label={tr("Réservation kiné", "Physio booking")} url={`${publicUrl}#physio`} />
          <CopyLink label={tr("Places invités", "Guest seats")} url={`${publicUrl}#tickets`} />
        </div>
        <p className="panel-note">
          {tr(
            "Le même lien sert chaque année : il affiche toujours l'édition courante du site.",
            "The same link works every year: it always shows the site's current edition.",
          )}
        </p>
        {badgeQr === undefined ? null : badgeQr === null ? (
          <p className="panel-note">
            {tr("QR « Roadbook athlete » introuvable dans les réglages d'accréditation.", "“Roadbook athlete” QR not found in the accreditation settings.")}
          </p>
        ) : (
          <div className="roadbook-admin-bar">
            <span className={`status-pill ${badgeQrOk ? "status-pill--ok" : "status-pill--pending"}`}>
              {badgeQrOk
                ? tr("QR des badges : pointe vers ce lien", "Badge QR: points to this link")
                : badgeQr.url
                  ? tr("QR des badges : autre lien", "Badge QR: other link")
                  : tr("QR des badges : ancienne image, pas de lien", "Badge QR: old image, no link")}
            </span>
            {badgeQrOk ? null : (
              <button type="button" className="button button--secondary button--small" onClick={pointBadgeQrToRoadbook}>
                {tr("Mettre ce lien sur le QR des badges", "Use this link on the badge QR")}
              </button>
            )}
          </div>
        )}
      </Panel>

      <Panel
        title={`${tr("Édition", "Edition")} ${edition?.year || editionId || "—"}`}
        subtitle={tr(
          "Date, lieu, horaire et live results : ceux saisis dans Édition (onglets Infos et Programme), rien à ressaisir ici.",
          "Date, venue, timetable and live results: taken from Edition (Info and Programme tabs), nothing to re-enter here.",
        )}
        actions={
          <div className="roadbook-admin-bar__actions">
            <Link className="button button--secondary button--small" to="/app/edition">
              {tr("Infos de l'édition", "Edition info")}
            </Link>
            <Link className="button button--secondary button--small" to="/app/edition/programme">
              {tr("Horaire", "Timetable")}
            </Link>
          </div>
        }
      >
        <div className="roadbook-admin-facts">
          <span>{tr("Numéro :", "Number:")} <strong>{editionNumber ? `${tr("Édition", "Edition")} ${editionNumber}` : "—"}</strong></span>
          <span>
            {tr("Date :", "Date:")}{" "}
            <strong>
              {editionDate && !Number.isNaN(editionDate.getTime())
                ? editionDate.toLocaleDateString(language === "fr" ? "fr-LU" : "en-GB", { day: "numeric", month: "long", year: "numeric" })
                : tr("à renseigner", "to be set")}
            </strong>
          </span>
          <span>{tr("Lieu :", "Venue:")} <strong>{edition?.venue || tr("à renseigner", "to be set")}</strong></span>
          <span>
            {tr("Horaire :", "Timetable:")}{" "}
            <strong>
              {timetableCount
                ? tr(`${timetableCount} ligne(s)`, timetableCount === 1 ? "1 row" : `${timetableCount} rows`)
                : tr("pas encore saisi", "not entered yet")}
            </strong>
          </span>
          <span>Live results : <strong>{edition?.resultsUrl ? tr("lien défini", "link set") : tr("pas encore de lien", "no link yet")}</strong></span>
        </div>
      </Panel>

      {!draft ? (
        <Panel title={tr("Pas encore de roadbook pour cette édition", "No roadbook for this edition yet")}>
          <p className="panel-note">
            {previousEdition
              ? tr(
                  `Le roadbook repart de celui de ${previousEdition.year || previousEdition.id} s'il a été enregistré, sinon du contenu 2026 corrigé (trajets, programme, règles, zones). Il reste en brouillon tant que tu ne le publies pas.`,
                  `The roadbook starts from the ${previousEdition.year || previousEdition.id} one if it was saved, otherwise from the corrected 2026 content (travel, schedule, rules, zones). It stays a draft until you publish it.`,
                )
              : tr(
                  "Le roadbook repart de celui de l'an dernier s'il a été enregistré, sinon du contenu 2026 corrigé (trajets, programme, règles, zones). Il reste en brouillon tant que tu ne le publies pas.",
                  "The roadbook starts from last year's one if it was saved, otherwise from the corrected 2026 content (travel, schedule, rules, zones). It stays a draft until you publish it.",
                )}
          </p>
          <button className="button button--primary" type="button" disabled={saving} onClick={createFromTemplate}>
            {tr("Créer le roadbook", "Create the roadbook")}
          </button>
        </Panel>
      ) : (
        <>
          <div className="roadbook-admin-bar">
            <span className={`status-pill ${draft.status === "published" ? "status-pill--ok" : "status-pill--pending"}`}>
              {draft.status === "published" ? tr("Publié", "Published") : tr("Brouillon", "Draft")}
            </span>
            {dirty ? <span className="roadbook-admin-bar__dirty">{tr("Modifications non enregistrées", "Unsaved changes")}</span> : null}
            {!dirty && zonesOutdated ? (
              <span className="roadbook-admin-bar__dirty">
                {tr("Zones modifiées dans les accréditations : enregistre pour les mettre à jour", "Zones changed in the accreditations: save to update them")}
              </span>
            ) : null}
            <div className="roadbook-admin-bar__actions">
              <a className="button button--secondary button--small" href={previewUrl} target="_blank" rel="noreferrer">
                {tr("Aperçu", "Preview")}
              </a>
              <button className="button button--secondary button--small" type="button" disabled={saving} onClick={togglePublished}>
                {draft.status === "published" ? tr("Repasser en brouillon", "Back to draft") : tr("Publier", "Publish")}
              </button>
              <button className="button button--primary button--small" type="button" disabled={saving || (!dirty && !zonesOutdated)} onClick={() => save()}>
                {saving ? tr("Enregistrement…", "Saving…") : tr("Enregistrer", "Save")}
              </button>
            </div>
          </div>

          <div className="admin-subtabs" role="tablist" aria-label={tr("Parties du roadbook", "Roadbook parts")}>
            {TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={`admin-subtab ${activeTab === tab.id ? "admin-subtab--active" : ""}`}
                onClick={() => setActiveTab(tab.id)}
              >
                {tr(tab.label, tab.labelEn)}
              </button>
            ))}
          </div>

          {activeTab === "general" ? (
            <Panel title={tr("Infos générales", "General info")}>
              <L label={tr("Introduction (sous le titre)", "Introduction (below the title)")} path={["intro"]} multiline />
              <label className="roadbook-admin-single">
                <span>{tr("Hôtel des athlètes", "Athletes' hotel")}</span>
                <input value={draft.hotel} onChange={(event) => update(["hotel"], event.target.value)} />
              </label>
              <L label={tr("Libellé du contact d'urgence", "Emergency contact label")} path={["emergency", "label"]} />
              <div className="roadbook-admin-row">
                <label className="roadbook-admin-single">
                  <span>{tr("Nom du contact d'urgence", "Emergency contact name")}</span>
                  <input value={draft.emergency.name} onChange={(event) => update(["emergency", "name"], event.target.value)} />
                </label>
                <label className="roadbook-admin-single">
                  <span>{tr("Téléphone d'urgence", "Emergency phone")}</span>
                  <input type="tel" value={draft.emergency.phone} placeholder="+352 …" onChange={(event) => update(["emergency", "phone"], event.target.value)} />
                </label>
              </div>
              <L label={tr("Texte photos", "Photos text")} path={["photos", "text"]} multiline />
              <label className="roadbook-admin-single">
                <span>{tr("Lien de la galerie photos", "Photo gallery link")}</span>
                <input type="url" value={draft.photos.url} placeholder="https://…" onChange={(event) => update(["photos", "url"], event.target.value)} />
              </label>
              <div className="roadbook-admin-row">
                <label className="roadbook-admin-single">
                  <span>{tr("Lien e-magazine (vide = e-magazine du site)", "E-magazine link (empty = the site's e-magazine)")}</span>
                  <input type="url" value={draft.links.emagazineUrl} onChange={(event) => update(["links", "emagazineUrl"], event.target.value)} />
                </label>
                <label className="roadbook-admin-single">
                  <span>{tr("Lien live results (vide = lien de l'édition)", "Live results link (empty = the edition's link)")}</span>
                  <input type="url" value={draft.links.liveResultsUrl} onChange={(event) => update(["links", "liveResultsUrl"], event.target.value)} />
                </label>
              </div>
            </Panel>
          ) : null}

          {activeTab === "bookings" ? (
            <Panel
              title={tr("Kiné & places", "Physio & seats")}
              subtitle={tr(
                "Boutons d'accès rapide en haut du roadbook et sections « My bookings » (réservation kiné, 2 places gratuites pour les invités).",
                "Quick-access buttons at the top of the roadbook and “My bookings” sections (physio booking, 2 free seats for guests).",
              )}
            >
              <div className="roadbook-admin-row">
                <T label={tr("Bouton d'accès kiné", "Physio access button")} path={["labels", "quickPhysio"]} />
                <T label={tr("Bouton d'accès places invités", "Guest seats access button")} path={["labels", "quickTickets"]} />
              </div>
              <div className="roadbook-admin-row">
                <T label={tr("Titre de la section kiné", "Physio section title")} path={["labels", "physioTitle"]} />
                <T label={tr("Titre de la section places", "Seats section title")} path={["labels", "ticketsTitle"]} />
                <T label={tr("Groupe du menu", "Menu group")} path={["labels", "bookingsEyebrow"]} />
              </div>
              <div className="roadbook-admin-row">
                <label className="roadbook-admin-single">
                  <span>{tr("Places en plus : lien de billetterie (facultatif)", "Extra seats: ticketing link (optional)")}</span>
                  <input
                    type="url"
                    value={draft.bookings.extraTicketsUrl}
                    placeholder="https://…"
                    onChange={(event) => update(["bookings", "extraTicketsUrl"], event.target.value)}
                  />
                </label>
                <T label={tr("Texte du bouton places en plus", "Extra seats button text")} path={["bookings", "extraTicketsLabel"]} />
              </div>
              <p className="panel-note">
                {tr("Les créneaux kiné se gèrent dans", "Physio slots are managed in")} <Link to="/app/kine">{tr("Kiné", "Physio")}</Link>
                {tr(
                  " ; les invités des athlètes arrivent dans la liste « Invités des athlètes » de la caisse. Sans lien de billetterie, le bouton « places en plus » n'apparaît pas.",
                  "; athletes' guests appear in the “Athletes' guests” list at the box office. Without a ticketing link, the “extra seats” button is hidden.",
                )}
              </p>
            </Panel>
          ) : null}

          {activeTab === "labels" ? (
            <>
              <Panel
                title="Sections"
                subtitle={tr(
                  "Afficher ou masquer chaque section, et changer ses titres (menu de gauche et page).",
                  "Show or hide each section and change its titles (left menu and page).",
                )}
              >
                {ROADBOOK_SECTION_IDS.map((id) => (
                  <div key={id} className="roadbook-admin-item">
                    <div className="roadbook-admin-item__head">
                      <label className="roadbook-admin-check">
                        <input
                          type="checkbox"
                          checked={draft.sections[id].visible !== false}
                          onChange={(event) => update(["sections", id, "visible"], event.target.checked)}
                        />
                        <strong>{tr(SECTION_LABELS_FR[id], SECTION_LABELS_EN[id] || SECTION_LABELS_FR[id])}</strong>
                        {id === "timetable" ? <small> {tr("(contenu repris de l'édition du site)", "(content taken from the site's edition)")}</small> : null}
                      </label>
                    </div>
                    <div className="roadbook-admin-row">
                      <T label={tr("Sur-titre", "Eyebrow")} path={["sections", id, "eyebrow"]} />
                      <T label={tr("Titre", "Title")} path={["sections", id, "title"]} />
                      <T label="Menu" path={["sections", id, "nav"]} />
                    </div>
                  </div>
                ))}
              </Panel>
              <Panel title={tr("Libellés de la page", "Page labels")} subtitle={tr("Tous les petits textes fixes du roadbook.", "All the small fixed texts of the roadbook.")}>
                <div className="roadbook-admin-grid">
                  {LABEL_FIELDS.map(([key, label]) => (
                    <T key={key} label={tr(label, LABEL_FIELDS_EN[key] || label)} path={["labels", key]} />
                  ))}
                </div>
              </Panel>
            </>
          ) : null}

          {activeTab === "extra" ? (
            <Panel
              title={tr("Sections libres", "Custom sections")}
              subtitle={tr(
                "Pour ajouter une information qui n'entre dans aucune section (accréditation, repas, dopage…). Elles s'affichent avant « Photos & links ».",
                "To add information that fits no other section (accreditation, meals, anti-doping…). They appear before “Photos & links”.",
              )}
              actions={
                <button
                  className="button button--secondary button--small"
                  type="button"
                  onClick={() =>
                    update(["extraSections"], [
                      ...draft.extraSections,
                      { id: newId("extra"), eyebrow: "", title: "", text: "", imageUrl: "", linkUrl: "", linkLabel: "", visible: true },
                    ])
                  }
                >
                  {tr("Ajouter une section", "Add a section")}
                </button>
              }
            >
              {draft.extraSections.length === 0 ? <p className="panel-note">{tr("Aucune section libre pour l'instant.", "No custom sections yet.")}</p> : null}
              {draft.extraSections.map((section, index) => (
                <div key={section.id} className="roadbook-admin-item">
                  <div className="roadbook-admin-item__head">
                    <label className="roadbook-admin-check">
                      <input
                        type="checkbox"
                        checked={section.visible !== false}
                        onChange={(event) => update(["extraSections", index, "visible"], event.target.checked)}
                      />
                      {tr("Afficher", "Show")}
                    </label>
                    <button type="button" className="button button--secondary button--small" onClick={() => update(["extraSections"], moveItem(draft.extraSections, index, -1))}>↑</button>
                    <button type="button" className="button button--secondary button--small" onClick={() => update(["extraSections"], moveItem(draft.extraSections, index, 1))}>↓</button>
                    <button
                      type="button"
                      className="button button--danger-soft button--small"
                      onClick={() => window.confirm(tr("Supprimer cette section ?", "Delete this section?")) && update(["extraSections"], draft.extraSections.filter((_, itemIndex) => itemIndex !== index))}
                    >
                      {tr("Supprimer", "Delete")}
                    </button>
                  </div>
                  <div className="roadbook-admin-row">
                    <T label={tr("Sur-titre", "Eyebrow")} path={["extraSections", index, "eyebrow"]} />
                    <T label={tr("Titre", "Title")} path={["extraSections", index, "title"]} />
                  </div>
                  <label className="roadbook-admin-single">
                    <span>{tr("Texte (une ligne = un point de liste)", "Text (one line = one bullet point)")}</span>
                    <textarea rows={4} value={section.text} onChange={(event) => update(["extraSections", index, "text"], event.target.value)} />
                  </label>
                  <div className="roadbook-admin-row">
                    <label className="roadbook-admin-single">
                      <span>{tr("Lien (facultatif)", "Link (optional)")}</span>
                      <input type="url" value={section.linkUrl} placeholder="https://…" onChange={(event) => update(["extraSections", index, "linkUrl"], event.target.value)} />
                    </label>
                    <T label={tr("Texte du lien", "Link text")} path={["extraSections", index, "linkLabel"]} />
                  </div>
                  <FileUpload
                    value={section.imageUrl}
                    onChange={(url) => update(["extraSections", index, "imageUrl"], url)}
                    accept="image/*"
                    storagePath="athlete-roadbook"
                    label={tr("Image (facultatif)", "Image (optional)")}
                    helperText="Image · Max 20 MB"
                  />
                </div>
              ))}
            </Panel>
          ) : null}

          {activeTab === "arrival" ? (
            <Panel title={tr("Arrivée & départ", "Arrival & departure")}>
              <L label={tr("Point de rendez-vous", "Meeting point")} path={["arrival", "meetingPoint"]} multiline />
              <L label={tr("Depuis l'aéroport", "From the airport")} path={["arrival", "fromAirport"]} multiline />
              <L label={tr("Vers l'aéroport", "To the airport")} path={["arrival", "toAirport"]} multiline />
              <L label={tr("Horaires du tram", "Tram hours")} path={["arrival", "tramHours"]} multiline />
              <L label={tr("Depuis la gare", "From the train station")} path={["arrival", "fromTrainStation"]} multiline />
              <L label={tr("Vers la gare", "To the train station")} path={["arrival", "toTrainStation"]} multiline />
              <div className="roadbook-admin-row">
                <FileUpload
                  value={draft.arrival.airportMapUrl}
                  onChange={(url) => update(["arrival", "airportMapUrl"], url)}
                  accept="image/*"
                  storagePath="athlete-roadbook"
                  label={tr("Plan de l'aéroport", "Airport map")}
                  helperText="Image · Max 20 MB"
                />
                <FileUpload
                  value={draft.arrival.trainStationMapUrl}
                  onChange={(url) => update(["arrival", "trainStationMapUrl"], url)}
                  accept="image/*"
                  storagePath="athlete-roadbook"
                  label={tr("Plan de la gare", "Train station map")}
                  helperText="Image · Max 20 MB"
                />
              </div>
            </Panel>
          ) : null}

          {activeTab === "schedule" ? (
            <Panel
              title={tr("Programme des athlètes", "Athlete schedule")}
              subtitle={tr(
                "Les intitulés des jours sont calculés depuis la date de l'édition (J−2, J−1, jour de compétition).",
                "Day names are worked out from the edition date (D−2, D−1, competition day).",
              )}
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
                  {tr("Ajouter un jour", "Add a day")}
                </button>
              }
            >
              {draft.schedule.map((day, dayIndex) => (
                <fieldset key={day.id} className="roadbook-admin-day">
                  <legend>{formatScheduleDay(edition?.date, day.offsetDays, dayLanguage)}</legend>
                  <div className="roadbook-admin-row">
                    <label className="roadbook-admin-single">
                      <span>{tr("Jour (par rapport à la compétition)", "Day (relative to the competition)")}</span>
                      <select value={day.offsetDays} onChange={(event) => update(["schedule", dayIndex, "offsetDays"], Number(event.target.value))}>
                        {[-4, -3, -2, -1, 0, 1].map((offset) => (
                          <option key={offset} value={offset}>
                            {offset === 0
                              ? tr("Jour de compétition", "Competition day")
                              : `${tr("J", "D")}${offset > 0 ? "+" : "−"}${Math.abs(offset)}`} · {formatScheduleDay(edition?.date, offset, dayLanguage)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="roadbook-admin-check">
                      <input type="checkbox" checked={day.highlight} onChange={(event) => update(["schedule", dayIndex, "highlight"], event.target.checked)} />
                      {tr("Mettre en avant (rouge)", "Highlight (red)")}
                    </label>
                  </div>
                  <L label={tr("Accès à la Coque", "Access to the Coque")} path={["schedule", dayIndex, "access"]} />
                  {day.items.map((item, itemIndex) => (
                    <div key={item.id} className="roadbook-admin-item">
                      <div className="roadbook-admin-item__head">
                        <select value={item.icon} onChange={(event) => update(["schedule", dayIndex, "items", itemIndex, "icon"], event.target.value)}>
                          {SCHEDULE_ITEM_ICONS.map((icon) => (
                            <option key={icon.value} value={icon.value}>{icon.emoji} {tr(icon.label, SCHEDULE_ICON_LABELS_EN[icon.value] || icon.label)}</option>
                          ))}
                        </select>
                        <button type="button" className="button button--secondary button--small" onClick={() => update(["schedule", dayIndex, "items"], moveItem(day.items, itemIndex, -1))}>↑</button>
                        <button type="button" className="button button--secondary button--small" onClick={() => update(["schedule", dayIndex, "items"], moveItem(day.items, itemIndex, 1))}>↓</button>
                        <button type="button" className="button button--danger-soft button--small" onClick={() => update(["schedule", dayIndex, "items"], day.items.filter((_, index) => index !== itemIndex))}>{tr("Retirer", "Remove")}</button>
                      </div>
                      <L label={tr("Titre", "Title")} path={["schedule", dayIndex, "items", itemIndex, "title"]} />
                      <L label={tr("Détails (une ligne par horaire)", "Details (one line per time)")} path={["schedule", dayIndex, "items", itemIndex, "lines"]} multiline />
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
                      {tr("Ajouter une ligne", "Add a line")}
                    </button>
                    <button type="button" className="button button--secondary button--small" onClick={() => update(["schedule"], moveItem(draft.schedule, dayIndex, -1))}>{tr("Monter le jour", "Move day up")}</button>
                    <button
                      type="button"
                      className="button button--danger-soft button--small"
                      onClick={() => window.confirm(tr("Supprimer ce jour et ses lignes ?", "Delete this day and its lines?")) && update(["schedule"], draft.schedule.filter((_, index) => index !== dayIndex))}
                    >
                      {tr("Supprimer le jour", "Delete the day")}
                    </button>
                  </div>
                </fieldset>
              ))}
            </Panel>
          ) : null}

          {activeTab === "competition" ? (
            <Panel
              title={tr("Informations compétition", "Competition information")}
              actions={
                <button
                  className="button button--secondary button--small"
                  type="button"
                  onClick={() => update(["competitionInfo"], [...draft.competitionInfo, { id: newId("ci"), event: { en: "", fr: "" }, rule: { en: "", fr: "" } }])}
                >
                  {tr("Ajouter une épreuve", "Add an event")}
                </button>
              }
            >
              {draft.competitionInfo.map((entry, index) => (
                <div key={entry.id} className="roadbook-admin-item">
                  <div className="roadbook-admin-item__head">
                    <button type="button" className="button button--secondary button--small" onClick={() => update(["competitionInfo"], moveItem(draft.competitionInfo, index, -1))}>↑</button>
                    <button type="button" className="button button--secondary button--small" onClick={() => update(["competitionInfo"], moveItem(draft.competitionInfo, index, 1))}>↓</button>
                    <button type="button" className="button button--danger-soft button--small" onClick={() => update(["competitionInfo"], draft.competitionInfo.filter((_, itemIndex) => itemIndex !== index))}>{tr("Retirer", "Remove")}</button>
                  </div>
                  <L label={tr("Épreuve", "Event")} path={["competitionInfo", index, "event"]} />
                  <L label={tr("Règle", "Rule")} path={["competitionInfo", index, "rule"]} />
                </div>
              ))}
            </Panel>
          ) : null}

          {activeTab === "venue" ? (
            <Panel
              title={tr("La Coque", "Coque")}
              subtitle={tr(
                "Zones d'accès et plan : repris des accréditations par défaut, pour rester identiques aux badges.",
                "Access zones and map: taken from the accreditations by default, so they match the badges.",
              )}
            >
              <L label={tr("Comment s'y rendre", "How to get there")} path={["venue", "intro"]} multiline />
              <div className="roadbook-admin-row">
                <label className="roadbook-admin-check">
                  <input
                    type="radio"
                    name="venue-source"
                    checked={draft.venue.source !== "custom"}
                    onChange={() => update(["venue", "source"], "accreditation")}
                  />
                  {tr("Reprendre les zones et le plan des accréditations", "Use the accreditation zones and map")}
                </label>
                <label className="roadbook-admin-check">
                  <input
                    type="radio"
                    name="venue-source"
                    checked={draft.venue.source === "custom"}
                    onChange={() => update(["venue", "source"], "custom")}
                  />
                  {tr("Saisir des zones et un plan propres au roadbook", "Enter zones and a map just for the roadbook")}
                </label>
              </div>
              {draft.venue.source !== "custom" ? (
                <div className="roadbook-admin-venue">
                  <div>
                    <p className="roadbook-admin-single"><span>{tr("Zones d'accès (accréditations)", "Access zones (accreditations)")}</span></p>
                    {accreditationZoneNames.length ? (
                      <ol className="roadbook-admin-zones">
                        {accreditationZoneNames.map((zone) => <li key={zone}>{zone}</li>)}
                      </ol>
                    ) : (
                      <p className="panel-note">{tr("Zones des accréditations pas encore chargées.", "Accreditation zones not loaded yet.")}</p>
                    )}
                    <p className="panel-note">
                      {tr("Pour les changer :", "To change them:")} <Link to="/app/accreditations">{tr("Accréditations", "Accreditations")}</Link>.{" "}
                      {tr("Elles sont recopiées dans le roadbook à chaque enregistrement.", "They are copied into the roadbook on every save.")}
                    </p>
                  </div>
                  <div className="roadbook-admin-plan">
                    <PlanCanvas elements={coquePlanElements} mapKey="acc" crop lang="en" />
                  </div>
                </div>
              ) : (
                <>
                  <L
                    label={tr("Zones d'accès (une par ligne, dans l'ordre des numéros du plan)", "Access zones (one per line, in the order of the map numbers)")}
                    path={["venue", "zones"]}
                    multiline
                  />
                  <FileUpload
                    value={draft.venue.planImageUrl}
                    onChange={(url) => update(["venue", "planImageUrl"], url)}
                    accept="image/*"
                    storagePath="athlete-roadbook"
                    label={tr("Plan de la Coque", "Coque map")}
                    helperText="Image · Max 20 MB"
                  />
                </>
              )}
            </Panel>
          ) : null}

          {activeTab === "calltimes" ? (
            <Panel
              title="Call times"
              subtitle={tr(
                "Import depuis Excel : première ligne d'en-têtes avec les colonnes du tableau 2026 (anglais ou français). Les heures au format Excel sont converties.",
                "Excel import: first row of headers with the 2026 table columns (English or French). Excel-format times are converted.",
              )}
              actions={
                <div className="roadbook-admin-day__actions">
                  <button className="button button--secondary button--small" type="button" onClick={downloadCallTimesTemplate}>
                    {tr("Télécharger le modèle", "Download the template")}
                  </button>
                  <label className="button button--primary button--small roadbook-admin-file">
                    {tr("Importer un Excel", "Import an Excel file")}
                    <input type="file" accept=".xlsx,.xls,.csv" onChange={handleCallTimesFile} />
                  </label>
                </div>
              }
            >
              {callTimesReport ? (
                <p className="panel-note">
                  {callTimesReport.fileName} :{" "}
                  {tr(
                    `${callTimesReport.count} épreuve(s) lue(s).`,
                    callTimesReport.count === 1 ? "1 event read." : `${callTimesReport.count} events read.`,
                  )}
                  {callTimesReport.missingColumns.length
                    ? ` ${tr("Colonnes absentes :", "Missing columns:")} ${callTimesReport.missingColumns.join(", ")}.`
                    : ""}{" "}
                  {tr("Pense à enregistrer.", "Remember to save.")}
                </p>
              ) : draft.callTimesFileName ? (
                <p className="panel-note">{tr("Dernier import :", "Last import:")} {draft.callTimesFileName}</p>
              ) : null}
              {draft.callTimes.length ? (
                <div className="table-wrap">
                  <table className="data-table roadbook-admin-calltimes">
                    <thead>
                      <tr>
                        {CALL_TIME_COLUMNS.map((column) => (
                          <th key={column.key}>{column.label.en}</th>
                        ))}
                        <th aria-label="Actions" />
                      </tr>
                    </thead>
                    <tbody>
                      {draft.callTimes.map((row, rowIndex) => (
                        <tr key={row.id || rowIndex}>
                          {CALL_TIME_COLUMNS.map((column) => (
                            <td key={column.key}>
                              <input
                                value={row[column.key] || ""}
                                aria-label={column.label.en}
                                onChange={(event) => update(["callTimes", rowIndex, column.key], event.target.value)}
                              />
                            </td>
                          ))}
                          <td>
                            <button
                              type="button"
                              className="button button--danger-soft button--small"
                              onClick={() => update(["callTimes"], draft.callTimes.filter((_, index) => index !== rowIndex))}
                            >
                              ✕
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="panel-note">
                  {tr(
                    "Aucun call time pour l'instant : importe l'Excel ou ajoute les lignes à la main.",
                    "No call times yet: import the Excel file or add the rows by hand.",
                  )}
                </p>
              )}
              <div>
                <button
                  type="button"
                  className="button button--secondary button--small"
                  onClick={() =>
                    update(["callTimes"], [
                      ...draft.callTimes,
                      CALL_TIME_COLUMNS.reduce((row, column) => ({ ...row, [column.key]: "" }), { id: newId("ct") }),
                    ])
                  }
                >
                  {tr("Ajouter une ligne", "Add a row")}
                </button>
              </div>
            </Panel>
          ) : null}
        </>
      )}
    </div>
    </RoadbookDraftContext.Provider>
  );
}

export { AthleteRoadbookAdminPage };
