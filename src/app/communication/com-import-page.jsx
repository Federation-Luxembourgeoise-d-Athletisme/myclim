// Import du plan de communication Excel : on choisit le fichier, on vérifie
// l'aperçu, puis on crée les publications et les tâches. Chaque ligne a un
// identifiant fixe (xlsx-…) : réimporter le fichier ne crée pas de doublon et
// ne touche pas aux éléments déjà importés (et peut-être modifiés depuis).
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "../../services/firebase";
import { useAuth } from "../../context/auth-context";
import { useEvenements } from "./com-data.js";
import { fmtShort } from "./com-dates.js";
import { COM_COLLECTIONS, PUB_TYPE_LABELS, STATUT_LABELS } from "./com-domain.js";
import { useComLang, pick } from "./com-i18n.js";
import { IMPORT_SHEETS, parseCommunicationPlan } from "./com-import.js";
import { ComPageHeader } from "./com-ui.jsx";

const DEFAULT_EVENT_DATE = "2027-01-17";
const IMPORT_CHANNELS = ["ig", "fb"];

// Date du meeting : l'événement « Meeting » du module s'il existe.
function meetingDate(events) {
  const meeting = events.find((e) => /meeting/i.test(e.titre || "") && /^\d{4}-\d{2}-\d{2}$/.test(e.dateDebut || ""));
  return meeting?.dateDebut || DEFAULT_EVENT_DATE;
}

async function readWorkbook(file) {
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
  return Object.fromEntries(
    workbook.SheetNames.map((name) => [name, XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, defval: "", raw: false })]),
  );
}

export function ComImportPage() {
  const { lang, tr } = useComLang();
  const { currentUser } = useAuth();
  const uid = currentUser?.uid || "";
  const events = useEvenements();
  const [eventDate, setEventDate] = useState("");
  const [sheets, setSheets] = useState(null);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const date = eventDate || meetingDate(events);
  const plan = useMemo(() => (sheets ? parseCommunicationPlan(sheets, { eventDate: date }) : null), [sheets, date]);

  async function onFile(file) {
    setError("");
    setResult(null);
    setSheets(null);
    if (!file) return;
    try {
      const read = await readWorkbook(file);
      if (!Object.values(IMPORT_SHEETS).some((name) => read[name])) {
        setError(
          tr(
            `Aucun onglet reconnu. Le fichier doit contenir « ${IMPORT_SHEETS.calendar} », « ${IMPORT_SHEETS.weekend} » ou « ${IMPORT_SHEETS.milestones} ».`,
            `No recognised tab. The file must contain “${IMPORT_SHEETS.calendar}”, “${IMPORT_SHEETS.weekend}” or “${IMPORT_SHEETS.milestones}”.`,
          ),
        );
        return;
      }
      setSheets(read);
      setFileName(file.name);
    } catch (readError) {
      console.error("Excel import read failed", readError);
      setError(tr("Impossible de lire ce fichier. Est-ce bien un fichier Excel (.xlsx) ?", "This file could not be read. Is it an Excel file (.xlsx)?"));
    }
  }

  async function runImport() {
    if (!plan) return;
    setBusy(true);
    setError("");
    const counts = { publications: 0, tasks: 0, skipped: 0 };
    try {
      for (const item of plan.publications) {
        const ref = doc(db, COM_COLLECTIONS.publications, item.importId);
        if ((await getDoc(ref)).exists()) {
          counts.skipped += 1;
          continue;
        }
        await setDoc(ref, {
          titre: item.titre.slice(0, 200),
          date: item.date,
          heure: item.heure,
          type: item.type,
          canaux: IMPORT_CHANNELS,
          statut: item.statut,
          assigneUids: [],
          notes: item.notes,
          texte: "",
          eventId: null,
          partnerIds: [],
          checks: {},
          rubriqueId: null,
          occurrenceDate: null,
          annulee: false,
          importedFrom: fileName,
          createdBy: uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        counts.publications += 1;
      }
      for (const task of plan.tasks) {
        const ref = doc(db, COM_COLLECTIONS.tasks, task.importId);
        if ((await getDoc(ref)).exists()) {
          counts.skipped += 1;
          continue;
        }
        await setDoc(ref, {
          titre: task.titre,
          echeance: task.echeance,
          statut: task.statut,
          notes: task.notes,
          assigneUid: null,
          eventId: null,
          importedFrom: fileName,
          createdBy: uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        counts.tasks += 1;
      }
      setResult(counts);
    } catch (importError) {
      console.error("Excel import failed", importError);
      setError(
        tr(
          "L'import s'est arrêté en cours de route. Relance-le : ce qui est déjà importé ne sera pas recréé.",
          "The import stopped part-way. Run it again: what was already imported will not be created twice.",
        ),
      );
      setResult(counts);
    } finally {
      setBusy(false);
    }
  }

  const undated = plan ? plan.publications.filter((p) => p.undated).length : 0;
  const adjusted = plan ? plan.publications.filter((p) => p.adjusted).length : 0;

  return (
    <>
      <ComPageHeader
        title={tr("Importer le plan de communication", "Import the communication plan")}
        description={tr(
          "Importe le calendrier préparé dans Excel : les publications arrivent dans le calendrier éditorial (Instagram + Facebook), les jalons dans les tâches. Tu peux réimporter le fichier sans créer de doublons.",
          "Import the calendar prepared in Excel: publications go to the editorial calendar (Instagram + Facebook), milestones to the tasks. You can import the file again without creating duplicates.",
        )}
      />

      <section className="com-card com-stack">
        <div className="com-grid-2">
          <label className="com-field">
            {tr("Fichier Excel (.xlsx)", "Excel file (.xlsx)")}
            <input
              type="file"
              className="com-input"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(event) => onFile(event.target.files?.[0])}
            />
          </label>
          <label className="com-field">
            {tr("Date du meeting", "Meeting date")}
            <input type="date" className="com-input" value={date} onChange={(event) => setEventDate(event.target.value)} />
            <span className="com-muted" style={{ fontWeight: 400, fontSize: "0.8rem" }}>
              {tr(
                "Sert à placer le week-end du meeting et les échéances de janvier.",
                "Used to place the meeting weekend and the January deadlines.",
              )}
            </span>
          </label>
        </div>
        {error ? <p className="com-error">{error}</p> : null}
      </section>

      {plan ? (
        <>
          <section className="com-card com-stack">
            <p className="com-section-title" style={{ margin: 0 }}>
              {tr("Aperçu", "Preview")}
            </p>
            <p style={{ margin: 0 }}>
              {tr(
                `${plan.publications.length} publications et ${plan.tasks.length} tâches seront créées.`,
                `${plan.publications.length} publications and ${plan.tasks.length} tasks will be created.`,
              )}
            </p>
            {undated || adjusted ? (
              <p className="com-empty com-warn-box">
                {undated
                  ? tr(
                      `${undated} publications n'ont qu'une semaine dans le fichier : elles sont placées le lundi, avec « Date to be confirmed » dans les notes. `,
                      `${undated} publications only have a week in the file: they are placed on the Monday, with “Date to be confirmed” in the notes. `,
                    )
                  : ""}
                {adjusted
                  ? tr(
                      `${adjusted} dates ne correspondaient pas au jour de la semaine indiqué (reste de l'an dernier) : le jour de la semaine a été gardé, voir les notes.`,
                      `${adjusted} dates did not match the weekday given (left over from last year): the weekday was kept, see the notes.`,
                    )
                  : ""}
              </p>
            ) : null}
            {plan.missingSheets.length ? (
              <p className="com-muted" style={{ margin: 0 }}>
                {tr("Onglets absents du fichier : ", "Tabs missing from the file: ")}
                {plan.missingSheets.join(", ")}
              </p>
            ) : null}
            <div className="com-row">
              <button type="button" className="button button--primary button--small" disabled={busy || !uid} onClick={runImport}>
                {busy ? tr("Import en cours…", "Importing…") : tr("Importer", "Import")}
              </button>
              {result ? (
                <span role="status">
                  {tr(
                    `${result.publications} publications et ${result.tasks} tâches créées${result.skipped ? `, ${result.skipped} déjà importées` : ""}.`,
                    `${result.publications} publications and ${result.tasks} tasks created${result.skipped ? `, ${result.skipped} already imported` : ""}.`,
                  )}{" "}
                  <Link className="com-link" to="/app/communication">
                    {tr("Voir le calendrier", "Open the calendar")}
                  </Link>
                </span>
              ) : null}
            </div>
          </section>

          <section className="com-card com-stack">
            <p className="com-section-title" style={{ margin: 0 }}>
              {tr("Publications", "Publications")} ({plan.publications.length})
            </p>
            <div style={{ overflowX: "auto" }}>
              <table className="com-import-table">
                <thead>
                  <tr>
                    <th>{tr("Date", "Date")}</th>
                    <th>{tr("Titre", "Title")}</th>
                    <th>{tr("Type", "Type")}</th>
                    <th>{tr("Statut", "Status")}</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.publications.map((item) => (
                    <tr key={item.importId}>
                      <td>
                        {fmtShort(item.date, lang)}
                        {item.heure ? ` · ${item.heure}` : ""}
                        {item.undated ? <span title={tr("Date à confirmer", "Date to be confirmed")}> ⚠︎</span> : null}
                        {item.adjusted ? <span title={tr("Date ajustée", "Date adjusted")}> ↺</span> : null}
                      </td>
                      <td>{item.titre}</td>
                      <td>{pick(PUB_TYPE_LABELS[item.type], lang)}</td>
                      <td>{pick(STATUT_LABELS[item.statut], lang)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {plan.tasks.length ? (
            <section className="com-card com-stack">
              <p className="com-section-title" style={{ margin: 0 }}>
                {tr("Tâches", "Tasks")} ({plan.tasks.length})
              </p>
              <p className="com-muted" style={{ margin: 0 }}>
                {tr(
                  "Les cases cochées dans l'onglet Milestones concernaient l'édition précédente : toutes les tâches sont importées « À faire ».",
                  "The ticks in the Milestones tab were for the previous edition: all tasks are imported as “To do”.",
                )}
              </p>
              <div style={{ overflowX: "auto" }}>
                <table className="com-import-table">
                  <thead>
                    <tr>
                      <th>{tr("Échéance", "Due")}</th>
                      <th>{tr("Tâche", "Task")}</th>
                      <th>{tr("Phase", "Phase")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plan.tasks.map((task) => (
                      <tr key={task.importId}>
                        <td>{fmtShort(task.echeance, lang)}</td>
                        <td>{task.titre}</td>
                        <td>{task.notes.replace(/^Phase: /, "")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}
        </>
      ) : null}
    </>
  );
}
