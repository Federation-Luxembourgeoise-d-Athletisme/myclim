import { Fragment, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { collection, collectionGroup, doc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "../services/firebase";
import { buildAppUrl } from "../services/app-url";
import { buildBusinessRacePortalPath } from "./business-race-helpers";
import { useActiveEdition } from "./edition";
import { useTr } from "./use-tr";
import { useLanguage } from "./language-context";
import {
  BUSINESS_RACE_MAX_TEAMS,
  BUSINESS_RACE_PACKS,
  RUNNERS_PER_TEAM,
  buildBusinessRacePortalFields,
  buildBusinessRaceTeams,
  getBusinessRacePack,
  getBusinessRaceTeamCount,
  getBusinessRaceTeamLabel,
  getBusinessRaceTeamStatus,
  buildTeamKey,
  getTeamTrainings,
  isBusinessRacePortal,
  listBusinessRaceRunners,
  runnerIsFilled,
} from "./business-race-helpers";
import {
  buildVipFullName,
  buildVipPortalId,
  computeVipPortalPlaces,
  createEmptyVipPortalContact,
  getVipPortalContacts,
  normalizeVipPlacesCap,
  normalizeVipPortalContacts,
  parseVipPlacesCap,
  vipPortalAllowsCompanions,
} from "./vip-helpers";
import { saveBusinessRaceSettings, useBusinessRaceSettings } from "./business-race-settings";
import "./business-race.css";

// Date longue pour l'écran (« jeudi 7 janvier 2027 »).
function formatLongDate(isoDate, language) {
  if (!isoDate) return "";
  const date = new Date(`${isoDate}T12:00:00`);
  if (Number.isNaN(date.getTime())) return isoDate;
  return date.toLocaleDateString(language === "fr" ? "fr-LU" : "en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

function createEmptyForm() {
  const pack = BUSINESS_RACE_PACKS[0];
  return {
    organizationName: "",
    businessRacePack: pack.id,
    businessRaceTeams: String(pack.teams),
    vipPlacesCap: String(pack.vipPlacesCap),
    standardPlacesCap: String(pack.standardPlacesCap),
    companionsAllowed: false,
    contact: createEmptyVipPortalContact(),
    notes: "",
  };
}

function capLabel(cap) {
  return cap === null ? "∞" : String(cap);
}

function BusinessRaceAdminPage() {
  const tr = useTr();
  const { language } = useLanguage();
  const { activeEditionId, activeEditionLabel } = useActiveEdition(true);
  const [portals, setPortals] = useState([]);
  const [teamsByPortal, setTeamsByPortal] = useState({});
  const [entriesByPortal, setEntriesByPortal] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [form, setForm] = useState(null);
  const [editingId, setEditingId] = useState("");
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState({});
  const [copiedId, setCopiedId] = useState("");
  const { settings, saved: settingsSaved } = useBusinessRaceSettings();
  const [settingsDraft, setSettingsDraft] = useState(null);
  const [settingsSaving, setSettingsSaving] = useState(false);

  useEffect(() => {
    const unsubscribePortals = onSnapshot(
      collection(db, "vipPartnerPortals"),
      (snapshot) => {
        setPortals(
          snapshot.docs
            .map((entry) => ({ id: entry.id, ...entry.data() }))
            .filter(isBusinessRacePortal)
            .sort((left, right) => String(left.organizationName || left.id).localeCompare(String(right.organizationName || right.id), "fr")),
        );
        setLoading(false);
      },
      (snapshotError) => {
        console.error("Business Race portals load failed", snapshotError);
        setError(tr("Impossible de charger les entreprises.", "Unable to load the companies."));
        setLoading(false);
      },
    );
    const groupByPortal = (snapshot) => {
      const next = {};
      snapshot.docs
        .filter((entry) => entry.ref.path.startsWith("vipPartnerPortals/"))
        .forEach((entry) => {
          const portalId = entry.ref.path.split("/")[1] || "";
          (next[portalId] ||= []).push({ id: entry.id, portalId, ...entry.data() });
        });
      return next;
    };
    const unsubscribeTeams = onSnapshot(
      collectionGroup(db, "teams"),
      (snapshot) => setTeamsByPortal(groupByPortal(snapshot)),
      (snapshotError) => console.error("Business Race teams load failed", snapshotError),
    );
    const unsubscribeEntries = onSnapshot(
      collectionGroup(db, "entries"),
      (snapshot) => setEntriesByPortal(groupByPortal(snapshot)),
      (snapshotError) => console.error("Business Race guests load failed", snapshotError),
    );
    return () => {
      unsubscribePortals();
      unsubscribeTeams();
      unsubscribeEntries();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rows = useMemo(
    () =>
      portals.map((portal) => {
        const teams = buildBusinessRaceTeams(portal, teamsByPortal[portal.id] || []);
        const statuses = teams.map((team) => getBusinessRaceTeamStatus(team));
        const places = computeVipPortalPlaces(portal, entriesByPortal[portal.id] || []);
        return {
          portal,
          teams,
          statuses,
          places,
          runners: statuses.reduce((sum, status) => sum + status.filled, 0),
          completeTeams: statuses.filter((status) => status.complete).length,
          contact: getVipPortalContacts(portal)[0] || null,
        };
      }),
    [portals, teamsByPortal, entriesByPortal],
  );

  const totals = useMemo(
    () => ({
      companies: rows.length,
      teams: rows.reduce((sum, row) => sum + row.teams.length, 0),
      completeTeams: rows.reduce((sum, row) => sum + row.completeTeams, 0),
      runners: rows.reduce((sum, row) => sum + row.runners, 0),
      vip: rows.reduce((sum, row) => sum + row.places.seats.vip, 0),
      standard: rows.reduce((sum, row) => sum + row.places.seats.standard, 0),
    }),
    [rows],
  );

  function packLabel(packId) {
    const pack = getBusinessRacePack(packId);
    if (!pack) return "—";
    return language === "fr" ? pack.labelFr : pack.labelEn;
  }

  function startCreate() {
    setEditingId("");
    setStatusMessage("");
    setError("");
    setForm(createEmptyForm());
  }

  function startEdit(portal) {
    setEditingId(portal.id);
    setStatusMessage("");
    setError("");
    setForm({
      organizationName: portal.organizationName || "",
      businessRacePack: getBusinessRacePack(portal.businessRacePack) ? portal.businessRacePack : "custom",
      businessRaceTeams: String(getBusinessRaceTeamCount(portal)),
      vipPlacesCap: normalizeVipPlacesCap(portal.vipPlacesCap) ?? "",
      standardPlacesCap: normalizeVipPlacesCap(portal.standardPlacesCap) ?? "",
      companionsAllowed: vipPortalAllowsCompanions(portal),
      contact: getVipPortalContacts(portal)[0] || createEmptyVipPortalContact(),
      notes: portal.notes || "",
    });
  }

  function changeForm(event) {
    const { name, value, type, checked } = event.target;
    setForm((current) => ({ ...current, [name]: type === "checkbox" ? checked : value }));
  }

  // Choisir un pack reprend ses valeurs (équipes, VIP, normales), modifiables ensuite.
  function changePack(event) {
    const pack = getBusinessRacePack(event.target.value);
    setForm((current) => ({
      ...current,
      businessRacePack: event.target.value,
      ...(pack && pack.id !== "custom"
        ? { businessRaceTeams: String(pack.teams), vipPlacesCap: String(pack.vipPlacesCap), standardPlacesCap: String(pack.standardPlacesCap) }
        : {}),
    }));
  }

  function changeContact(event) {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, contact: { ...current.contact, [name]: value } }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setStatusMessage("");
    const organizationName = form.organizationName.trim();
    const portalId = editingId || buildVipPortalId(organizationName);
    if (!portalId) {
      setError(tr("Indiquez le nom de l'entreprise.", "Enter the company name."));
      return;
    }
    const existing = portals.find((portal) => portal.id === portalId);
    const existingPortal = editingId ? existing : null;
    if (!editingId && existing) {
      setError(tr("Cette entreprise a déjà un portail.", "This company already has a portal."));
      return;
    }
    // Les autres personnes de contact (saisies par l'entreprise) sont gardées.
    const otherContacts = existingPortal ? getVipPortalContacts(existingPortal).slice(1) : [];
    const contacts = normalizeVipPortalContacts([form.contact, ...otherContacts]);
    const mainContact = contacts[0] || createEmptyVipPortalContact();
    setSaving(true);
    try {
      await setDoc(
        doc(db, "vipPartnerPortals", portalId),
        {
          organizationName,
          ...buildBusinessRacePortalFields(form),
          vipPlacesCap: parseVipPlacesCap(form.vipPlacesCap) ?? 0,
          standardPlacesCap: parseVipPlacesCap(form.standardPlacesCap) ?? 0,
          companionsAllowed: Boolean(form.companionsAllowed),
          contacts,
          contactName: buildVipFullName(mainContact),
          contactEmail: mainContact.email,
          contactPhone: mainContact.phone,
          notes: form.notes.trim(),
          updatedAt: serverTimestamp(),
          ...(existingPortal ? {} : { createdAt: serverTimestamp(), hasPassword: false, editionId: activeEditionId || "" }),
        },
        { merge: true },
      );
      if (!existingPortal) {
        await setDoc(doc(db, "vipPartnerPortalSecrets", portalId), { accessPassword: "", updatedAt: serverTimestamp() }, { merge: true });
      }
      setStatusMessage(
        existingPortal
          ? tr(`${organizationName} mis à jour.`, `${organizationName} updated.`)
          : tr(`${organizationName} ajouté : copiez son lien et envoyez-le à l'entreprise.`, `${organizationName} added: copy its link and send it to the company.`),
      );
      setForm(null);
      setEditingId("");
      if (!existingPortal) setExpanded((current) => ({ ...current, [portalId]: true }));
    } catch (saveError) {
      console.error("Business Race portal save failed", saveError);
      setError(tr("Impossible d'enregistrer l'entreprise.", "Unable to save the company."));
    } finally {
      setSaving(false);
    }
  }

  const settingsView = settingsDraft || settings;

  function changeSettings(event) {
    const { name, value } = event.target;
    setSettingsDraft((current) => ({ ...(current || settings), [name]: value }));
  }

  function updateTraining(id, patch) {
    setSettingsDraft((current) => {
      const base = current || settings;
      return { ...base, trainings: base.trainings.map((training) => (training.id === id ? { ...training, ...patch } : training)) };
    });
  }

  function toggleTrainingTeam(id, teamKey) {
    const training = settingsView.trainings.find((item) => item.id === id);
    if (!training) return;
    const teamKeys = training.teamKeys.includes(teamKey) ? training.teamKeys.filter((key) => key !== teamKey) : [...training.teamKeys, teamKey];
    updateTraining(id, { teamKeys });
  }

  function addTraining() {
    setSettingsDraft((current) => {
      const base = current || settings;
      const last = base.trainings[base.trainings.length - 1];
      return {
        ...base,
        trainings: [...base.trainings, { id: `training-${Date.now()}`, date: last?.date || "", time: last?.time || "", place: last?.place || "", note: "", teamKeys: [] }],
      };
    });
  }

  function removeTraining(id) {
    setSettingsDraft((current) => {
      const base = current || settings;
      return { ...base, trainings: base.trainings.filter((training) => training.id !== id) };
    });
  }

  // Toutes les équipes prévues (pour cocher à qui s'applique un entraînement).
  const teamOptions = rows.flatMap((row) => {
    const organization = row.portal.organizationName || row.portal.id;
    return row.teams.map((team) => {
      const label = getBusinessRaceTeamLabel(team, organization, row.teams.length);
      return {
        key: buildTeamKey(row.portal.id, team.teamNumber),
        portalId: row.portal.id,
        teamNumber: team.teamNumber,
        label: label === organization ? organization : `${organization} · ${label}`,
      };
    });
  });
  const teamsWithoutTraining = teamOptions.filter((option) => !getTeamTrainings(settingsView, option.portalId, option.teamNumber).length);

  async function handleSettingsSubmit(event) {
    event.preventDefault();
    setSettingsSaving(true);
    setError("");
    try {
      await saveBusinessRaceSettings(settingsDraft || settings);
      setSettingsDraft(null);
      setStatusMessage(tr("Dates enregistrées : elles s'affichent sur les portails des entreprises.", "Dates saved: they show on the companies' portals."));
    } catch (saveError) {
      console.error("Business Race settings save failed", saveError);
      setError(tr("Impossible d'enregistrer les dates.", "Unable to save the dates."));
    } finally {
      setSettingsSaving(false);
    }
  }

  async function copyLink(portalId) {
    try {
      await navigator.clipboard.writeText(buildAppUrl(buildBusinessRacePortalPath(portalId)));
      setCopiedId(portalId);
      window.setTimeout(() => setCopiedId(""), 1500);
    } catch {
      setCopiedId("");
    }
  }

  async function exportStartList() {
    const ExcelJSModule = await import("exceljs");
    const ExcelJS = ExcelJSModule.default ?? ExcelJSModule;
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Business Race");
    sheet.columns = [
      { header: tr("Entreprise", "Company"), key: "organization", width: 28 },
      { header: tr("Équipe", "Team"), key: "team", width: 26 },
      { header: tr("Passage", "Leg"), key: "leg", width: 12 },
      { header: tr("Prénom", "First name"), key: "firstName", width: 18 },
      { header: tr("Nom", "Last name"), key: "lastName", width: 20 },
      { header: tr("Genre", "Gender"), key: "gender", width: 8 },
    ];
    sheet.getRow(1).font = { bold: true };
    listBusinessRaceRunners(portals, teamsByPortal).forEach((runner) => {
      sheet.addRow({
        organization: runner.organization,
        team: runner.teamLabel,
        leg: runner.isReserve ? tr("Remplaçant", "Reserve") : `${runner.leg} × 200 m`,
        firstName: runner.firstName,
        lastName: runner.lastName,
        gender: runner.gender,
      });
    });
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `business-race-${activeEditionId || "edition"}.xlsx`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  const genderLabel = (gender) => (gender === "F" ? tr("F", "W") : gender === "M" ? tr("H", "M") : "?");
  const stateLabel = (status) =>
    status.complete
      ? tr("Complète", "Complete")
      : status.state === "empty"
        ? tr("À remplir", "To fill in")
        : status.filled === RUNNERS_PER_TEAM && !status.genderOk
          ? tr(`${status.women} F / ${status.men} H`, `${status.women} W / ${status.men} M`)
          : `${status.filled} / ${RUNNERS_PER_TEAM}`;

  return (
    <div className="page br-admin">
      <header className="br-admin-head">
        <div>
          <p className="eyebrow">{tr("Pré-programme", "Pre-programme")}{activeEditionLabel ? ` · ${activeEditionLabel}` : ""}</p>
          <h1>Business Race</h1>
        </div>
        <dl className="br-kpis">
          <div><dt>{tr("Entreprises", "Companies")}</dt><dd>{totals.companies}</dd></div>
          <div><dt>{tr("Équipes", "Teams")}</dt><dd>{totals.completeTeams}<small> / {totals.teams}</small></dd></div>
          <div><dt>{tr("Coureurs", "Runners")}</dt><dd>{totals.runners}</dd></div>
          <div><dt>{tr("Pers. VIP", "VIP people")}</dt><dd>{totals.vip}</dd></div>
          <div><dt>{tr("Pers. normales", "Standard people")}</dt><dd>{totals.standard}</dd></div>
        </dl>
      </header>

      <details className="br-explainer">
        <summary>{tr("Comment ça marche", "How it works")}</summary>
        <ul>
          <li>{tr("Ajoutez chaque entreprise avec son pack : nombre d'équipes, invitations VIP et normales. Tout reste modifiable.", "Add each company with its pack: number of teams, VIP and standard invitations. Everything can be changed later.")}</li>
          <li>{tr("Copiez son lien et envoyez-le au contact : l'entreprise y nomme ses équipes, inscrit ses coureurs (2 femmes, 2 hommes, 1 remplaçant) et ses invités.", "Copy its link and send it to the contact: the company names its teams, registers its runners (2 women, 2 men, 1 reserve) and its guests.")}</li>
          <li>{tr("Les invités arrivent d'eux-mêmes dans VIP (liste, badges, visite) et à la Caisse (places normales). Les coureurs ont leur badge « Business Race » dans Accréditations.", "Guests flow automatically into VIP (list, badges, tour) and the Cash desk (standard places). Runners get their “Business Race” badge in Accreditations.")}</li>
          <li>{tr("Le mot de passe d'un portail et les demandes de places supplémentaires se gèrent dans VIP › Portails partenaires.", "A portal's password and extra place requests are handled in VIP › Partner portals.")}</li>
        </ul>
      </details>

      {error ? <p className="form-error">{error}</p> : null}
      {statusMessage ? <p className="br-flash">{statusMessage}</p> : null}

      <form className="br-panel br-dates" onSubmit={handleSettingsSubmit}>
        <header className="br-panel__head">
          <h3>{tr("Dates clés", "Key dates")}</h3>
          <span>{tr("Affichées sur le portail de chaque entreprise ; elles ne peuvent pas les modifier.", "Shown on every company's portal; companies can't change them.")}</span>
          {!settingsSaved ? <span className="br-chip br-chip--warn">{tr("Pas encore enregistrées", "Not saved yet")}</span> : null}
        </header>
        <div className="br-dates__deadline">
          <label className="br-field">
            <span>{tr("Équipes modifiables jusqu'au", "Teams editable until")}</span>
            <input type="date" name="teamsDeadline" value={settingsView.teamsDeadline} onChange={changeSettings} />
          </label>
          <p className="br-muted">
            <strong>{formatLongDate(settingsView.teamsDeadline, language) || tr("Pas de date limite", "No deadline")}</strong>
            {" — "}
            {tr("après cette date, les entreprises ne peuvent plus modifier leurs équipes ; vous, si.", "after this date, companies can no longer change their teams; you still can.")}
          </p>
        </div>
        <div className="br-trainings">
          <div className="br-trainings__head">
            <h4>{tr("Entraînements (passage de témoin)", "Trainings (baton passing)")}</h4>
            <span className="br-muted">{tr("Une ligne par créneau. Sans équipe cochée, la ligne vaut pour toutes les équipes qui n'ont pas de créneau à elles.", "One line per slot. With no team ticked, the line applies to every team without a slot of its own.")}</span>
          </div>
          {settingsView.trainings.map((training, index) => (
            <div key={training.id} className="br-training">
              <span className="br-training__num">{index + 1}</span>
              <div className="br-training__fields">
                <label className="br-field">
                  <span>{tr("Date", "Date")}</span>
                  <input type="date" value={training.date} onChange={(event) => updateTraining(training.id, { date: event.target.value })} />
                </label>
                <label className="br-field">
                  <span>{tr("Heure", "Time")}</span>
                  <input type="time" value={training.time} onChange={(event) => updateTraining(training.id, { time: event.target.value })} />
                </label>
                <label className="br-field">
                  <span>{tr("Lieu", "Place")}</span>
                  <input value={training.place} onChange={(event) => updateTraining(training.id, { place: event.target.value })} placeholder={tr("Coque, piste d'échauffement", "Coque, warm-up track")} />
                </label>
                <label className="br-field">
                  <span>{tr("Info pour les équipes", "Note for the teams")}</span>
                  <input value={training.note} onChange={(event) => updateTraining(training.id, { note: event.target.value })} placeholder={tr("Tenue de sport…", "Sportswear…")} />
                </label>
              </div>
              <div className="br-training__teams">
                <span className="br-training__label">
                  {training.teamKeys.length
                    ? tr(`${training.teamKeys.length} équipe(s)`, `${training.teamKeys.length} team(s)`)
                    : tr("Toutes les équipes", "All teams")}
                </span>
                {teamOptions.length ? (
                  teamOptions.map((option) => {
                    const on = training.teamKeys.includes(option.key);
                    return (
                      <button
                        key={option.key}
                        type="button"
                        aria-pressed={on}
                        className={`br-team-pick${on ? " is-on" : ""}`}
                        onClick={() => toggleTrainingTeam(training.id, option.key)}
                      >
                        {on ? "✓ " : ""}{option.label}
                      </button>
                    );
                  })
                ) : (
                  <span className="br-muted">{tr("Les équipes apparaîtront ici une fois les entreprises ajoutées.", "Teams will show here once companies are added.")}</span>
                )}
              </div>
              <button
                type="button"
                className="br-training__remove"
                aria-label={tr("Supprimer cet entraînement", "Remove this training")}
                title={tr("Supprimer cet entraînement", "Remove this training")}
                onClick={() => removeTraining(training.id)}
              >
                ×
              </button>
            </div>
          ))}
          {teamsWithoutTraining.length ? (
            <p className="br-trainings__warn">
              {tr("Sans entraînement : ", "No training: ")}{teamsWithoutTraining.map((option) => option.label).join(", ")}
            </p>
          ) : null}
          <button type="button" className="br-link br-trainings__add" onClick={addTraining}>
            {tr("+ Ajouter un entraînement", "+ Add a training")}
          </button>
        </div>
        <footer className="br-panel__bar">
          <span className="br-panel__hint">
            {settingsDraft ? tr("Modifications non enregistrées", "Unsaved changes") : ""}
          </span>
          {settingsDraft ? <button type="button" className="br-btn" onClick={() => setSettingsDraft(null)}>{tr("Annuler", "Cancel")}</button> : null}
          <button type="submit" className="br-btn br-btn--primary" disabled={settingsSaving || (settingsSaved && !settingsDraft)}>
            {settingsSaving ? "…" : tr("Enregistrer", "Save")}
          </button>
        </footer>
      </form>

      <div className="br-toolbar">
        <h2>{tr("Entreprises", "Companies")} <span className="br-count">{rows.length}</span></h2>
        <span className="br-toolbar__spacer" />
        <button type="button" className="br-btn" disabled={!totals.runners} onClick={exportStartList}>
          {tr("Exporter les coureurs (Excel)", "Export runners (Excel)")}
        </button>
        <button type="button" className="br-btn br-btn--primary" onClick={startCreate}>
          {tr("+ Ajouter une entreprise", "+ Add a company")}
        </button>
      </div>

      {form ? (
        <form className="br-panel" onSubmit={handleSubmit}>
          <header className="br-panel__head">
            <h3>{editingId ? tr(`Modifier ${form.organizationName || editingId}`, `Edit ${form.organizationName || editingId}`) : tr("Nouvelle entreprise", "New company")}</h3>
            <span>{tr("Le pack remplit les équipes et les places ; tout reste modifiable.", "The pack fills in teams and places; everything stays editable.")}</span>
          </header>
          <div className="br-panel__body">
            <section className="br-panel__section">
              <h4>{tr("Entreprise & pack", "Company & pack")}</h4>
              <div className="br-panel__row br-panel__row--main">
                <label className="br-field">
                  <span>{tr("Entreprise", "Company")} *</span>
                  <input name="organizationName" required autoFocus={!editingId} value={form.organizationName} onChange={changeForm} />
                </label>
                <label className="br-field">
                  <span>{tr("Pack", "Pack")}</span>
                  <select name="businessRacePack" value={form.businessRacePack} onChange={changePack}>
                    {BUSINESS_RACE_PACKS.map((pack) => (
                      <option key={pack.id} value={pack.id}>{language === "fr" ? pack.labelFr : pack.labelEn}</option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="br-panel__row br-panel__row--nums">
                <label className="br-field">
                  <span>{tr("Équipes", "Teams")}</span>
                  <input name="businessRaceTeams" type="number" min="1" max={BUSINESS_RACE_MAX_TEAMS} required value={form.businessRaceTeams} onChange={changeForm} />
                </label>
                <label className="br-field">
                  <span>{tr("Invitations VIP", "VIP invitations")}</span>
                  <input name="vipPlacesCap" type="number" min="0" value={form.vipPlacesCap} onChange={changeForm} />
                </label>
                <label className="br-field">
                  <span>{tr("Invitations normales", "Standard invitations")}</span>
                  <input name="standardPlacesCap" type="number" min="0" value={form.standardPlacesCap} onChange={changeForm} />
                </label>
              </div>
              <label className="br-check">
                <input name="companionsAllowed" type="checkbox" checked={Boolean(form.companionsAllowed)} onChange={changeForm} />
                {tr("+1 accompagnant par invitation", "+1 companion per invitation")}
              </label>
            </section>
            <section className="br-panel__section">
              <h4>{tr("Contact dans l'entreprise", "Company contact")}</h4>
              <div className="br-panel__row br-panel__row--two">
                <label className="br-field"><span>{tr("Prénom", "First name")}</span><input name="firstName" value={form.contact.firstName} onChange={changeContact} /></label>
                <label className="br-field"><span>{tr("Nom", "Last name")}</span><input name="lastName" value={form.contact.lastName} onChange={changeContact} /></label>
                <label className="br-field"><span>{tr("E-mail", "E-mail")}</span><input name="email" type="email" value={form.contact.email} onChange={changeContact} /></label>
                <label className="br-field"><span>{tr("Téléphone", "Phone")}</span><input name="phone" type="tel" value={form.contact.phone} onChange={changeContact} /></label>
              </div>
              <label className="br-field">
                <span>{tr("Remarques internes", "Internal notes")}</span>
                <input name="notes" value={form.notes} onChange={changeForm} placeholder={tr("Facture, déjeuner, team building…", "Invoice, lunch, team building…")} />
              </label>
            </section>
          </div>
          <footer className="br-panel__bar">
            <button type="button" className="br-btn" onClick={() => { setForm(null); setEditingId(""); }}>{tr("Annuler", "Cancel")}</button>
            <button type="submit" className="br-btn br-btn--primary" disabled={saving}>{saving ? "…" : tr("Enregistrer", "Save")}</button>
          </footer>
        </form>
      ) : null}

      <div className="br-card br-card--flush">
        {loading ? (
          <p className="br-muted br-pad">{tr("Chargement…", "Loading…")}</p>
        ) : !rows.length ? (
          <p className="br-muted br-pad">{tr("Aucune entreprise pour le moment. Ajoutez la première avec « + Ajouter une entreprise ».", "No company yet. Add the first one with “+ Add a company”.")}</p>
        ) : (
          <div className="br-table-wrap">
            <table className="br-table">
              <thead>
                <tr>
                  <th>{tr("Entreprise", "Company")}</th>
                  <th>{tr("Pack", "Pack")}</th>
                  <th>{tr("Équipes", "Teams")}</th>
                  <th className="is-num">{tr("Coureurs", "Runners")}</th>
                  <th className="is-num">VIP</th>
                  <th className="is-num">{tr("Normales", "Standard")}</th>
                  <th>{tr("Lien du portail", "Portal link")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const { portal } = row;
                  const isOpen = Boolean(expanded[portal.id]);
                  const organization = portal.organizationName || portal.id;
                  return (
                    <Fragment key={portal.id}>
                      <tr className={isOpen ? "is-open" : ""}>
                        <td>
                          <button type="button" className="br-row-toggle" aria-expanded={isOpen} onClick={() => setExpanded((current) => ({ ...current, [portal.id]: !isOpen }))}>
                            <span className="br-caret" aria-hidden="true">{isOpen ? "▾" : "▸"}</span>
                            <strong>{organization}</strong>
                          </button>
                          <span className="br-sub">
                            {row.contact ? [buildVipFullName(row.contact), row.contact.email].filter(Boolean).join(" · ") : tr("Pas de contact", "No contact")}
                          </span>
                          <button type="button" className="br-link" onClick={() => startEdit(portal)}>{tr("Modifier", "Edit")}</button>
                        </td>
                        <td>{packLabel(portal.businessRacePack)}</td>
                        <td>
                          <div className="br-team-chips">
                            {row.teams.map((team, index) => (
                              <span key={team.id} className={`br-chip br-chip--${row.statuses[index].complete ? "ok" : row.statuses[index].state === "empty" ? "empty" : "warn"}`} title={getBusinessRaceTeamLabel(team, organization, row.teams.length)}>
                                {row.teams.length > 1 ? `${team.teamNumber} · ` : ""}{stateLabel(row.statuses[index])}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="is-num">{row.runners}<small> / {row.teams.length * RUNNERS_PER_TEAM}</small></td>
                        <td className="is-num">{row.places.used.vip}<small> / {capLabel(row.places.caps.vip)}</small></td>
                        <td className="is-num">{row.places.used.standard}<small> / {capLabel(row.places.caps.standard)}</small></td>
                        <td>
                          <div className="br-link-cell">
                            <button type="button" className="br-btn br-btn--small" onClick={() => copyLink(portal.id)}>
                              {copiedId === portal.id ? tr("Copié ✓", "Copied ✓") : tr("Copier", "Copy")}
                            </button>
                            <a className="br-btn br-btn--small br-btn--ghost" href={buildBusinessRacePortalPath(portal.id)} target="_blank" rel="noreferrer">{tr("Ouvrir", "Open")}</a>
                          </div>
                        </td>
                      </tr>
                      {isOpen ? (
                        <tr className="br-detail-row">
                          <td colSpan={7}>
                            <div className="br-detail">
                              {row.teams.map((team, index) => {
                                const status = row.statuses[index];
                                return (
                                  <div key={team.id} className="br-team">
                                    <div className="br-team__head">
                                      <strong>{getBusinessRaceTeamLabel(team, organization, row.teams.length)}</strong>
                                      <span className={`br-chip br-chip--${status.complete ? "ok" : status.state === "empty" ? "empty" : "warn"}`}>{stateLabel(status)}</span>
                                    </div>
                                    <ol className="br-team__legs">
                                      {team.runners.map((runner, legIndex) => (
                                        <li key={legIndex} className={runnerIsFilled(runner) ? "" : "is-empty"}>
                                          <span className="br-leg">{legIndex + 1}</span>
                                          {runnerIsFilled(runner) ? `${runner.firstName} ${runner.lastName}` : "—"}
                                          {runnerIsFilled(runner) ? <span className={`br-gender br-gender--${runner.gender || "x"}`}>{genderLabel(runner.gender)}</span> : null}
                                          {runnerIsFilled(runner) && runner.vip ? <span className="br-vip-tag" title={tr("Place VIP : badge VIP en plus de l'accréditation", "VIP place: VIP badge on top of the accreditation")}>VIP</span> : null}
                                        </li>
                                      ))}
                                      <li className={runnerIsFilled(team.reserve) ? "is-reserve" : "is-reserve is-empty"}>
                                        <span className="br-leg">R</span>
                                        {runnerIsFilled(team.reserve) ? `${team.reserve.firstName} ${team.reserve.lastName}` : tr("Pas de remplaçant", "No reserve")}
                                        {runnerIsFilled(team.reserve) ? <span className={`br-gender br-gender--${team.reserve.gender || "x"}`}>{genderLabel(team.reserve.gender)}</span> : null}
                                        {runnerIsFilled(team.reserve) && team.reserve.vip ? <span className="br-vip-tag">VIP</span> : null}
                                      </li>
                                    </ol>
                                  </div>
                                );
                              })}
                              <div className="br-team br-team--guests">
                                <div className="br-team__head"><strong>{tr("Invités", "Guests")}</strong></div>
                                <p className="br-muted">
                                  {tr(
                                    `${row.places.used.vip} invitation(s) VIP (${row.places.seats.vip} pers.), ${row.places.used.standard} normale(s) (${row.places.seats.standard} pers.).`,
                                    `${row.places.used.vip} VIP invitation(s) (${row.places.seats.vip} people), ${row.places.used.standard} standard (${row.places.seats.standard} people).`,
                                  )}
                                </p>
                                <Link className="br-link" to="/app/vip">{tr("Voir dans VIP →", "See in VIP →")}</Link>
                                {portal.notes ? <p className="br-note">“{portal.notes}”</p> : null}
                              </div>
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export { BusinessRaceAdminPage };
