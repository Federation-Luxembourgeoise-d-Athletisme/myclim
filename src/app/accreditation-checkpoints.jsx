import { useEffect, useMemo, useState } from "react";
import { useTr } from "./use-tr";
import { attachPlanIcons, normalizePlanElements, PLAN_PRINT_CSS, planBoxHtml, planCtrlText, planDesc } from "./coque-plan/coque-plan-data";
import { saveCoquePlan, useCoquePlan } from "./coque-plan/coque-plan-hooks";
import "./accreditation-checkpoints.css";

// Accréditations › Contrôles : chaque point de contrôle garde une ou plusieurs zones du badge.
// Qui passe en découle tout seul : un badge passe s'il porte au moins une de ces zones.
// Les liens sont enregistrés sur les points de contrôle du plan (zoneNums), donc la légende du
// plan « Points de contrôle » se remplit aussi toute seule.

const FAMILIES = [
  ["vol", "Bénévoles", "Volunteers"],
  ["judge", "Juges", "Judges"],
  ["press", "Presse", "Press"],
  ["vip", "Invités VIP", "VIP guests"],
  ["lot", "Badges non nominatifs", "Non-named badges"],
];

const escapeHtml = (value) =>
  String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Badges regroupés (famille + libellé) avec, pour un point de contrôle, combien passent.
function groupHolders(holders, zoneOrderById, guardedNums) {
  const groups = new Map();
  for (const holder of holders) {
    const key = `${holder.family}|${holder.group}`;
    if (!groups.has(key)) groups.set(key, { key, family: holder.family, label: holder.group, lot: Boolean(holder.lot), total: 0, admitted: 0, admittedNames: [], refusedNames: [] });
    const group = groups.get(key);
    const nums = holder.zoneIds.map((id) => zoneOrderById.get(id)).filter(Boolean);
    const passes = nums.some((n) => guardedNums.includes(n));
    group.total += 1;
    if (passes) {
      group.admitted += 1;
      group.admittedNames.push(holder.name);
    } else {
      group.refusedNames.push(holder.name);
    }
  }
  return [...groups.values()].sort((a, b) => a.label.localeCompare(b.label, "fr"));
}

export function AccreditationCheckpoints({ zones, holders, currentUserLabel = "", canEdit = true }) {
  const tr = useTr();
  const plan = useCoquePlan();
  const [elements, setElements] = useState(plan.rawElements);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [openGroup, setOpenGroup] = useState("");

  useEffect(() => {
    if (!dirty) setElements(plan.rawElements);
  }, [plan.rawElements, dirty]);

  const lang = tr("fr", "en");
  const checkpoints = useMemo(
    () => elements.filter((el) => el.kind === "ctrl").sort((a, b) => a.label.localeCompare(b.label, "fr")),
    [elements],
  );
  const zoneOrderById = useMemo(() => new Map(zones.map((zone) => [zone.id, zone.order])), [zones]);
  const selected = checkpoints.find((el) => el.id === selectedId) || checkpoints[0] || null;

  // Pour chaque contrôle : badges qui passent / total (badges nominatifs ; les lots comptent pour 1)
  const stats = useMemo(() => {
    const result = new Map();
    for (const ctrl of checkpoints) {
      const groups = groupHolders(holders, zoneOrderById, ctrl.zoneNums || []);
      result.set(ctrl.id, {
        groups,
        admitted: groups.filter((g) => !g.lot).reduce((sum, g) => sum + g.admitted, 0),
        total: groups.filter((g) => !g.lot).reduce((sum, g) => sum + g.total, 0),
      });
    }
    return result;
  }, [checkpoints, holders, zoneOrderById]);

  // Zone gardée par aucun contrôle : à signaler
  const guardedEverywhere = new Set(checkpoints.flatMap((el) => el.zoneNums || []));
  const unguarded = zones.filter((zone) => !guardedEverywhere.has(zone.order));

  function change(updater) {
    setElements((list) => updater(list));
    setDirty(true);
    setMessage("");
  }
  function toggleZone(ctrlId, num) {
    change((list) =>
      list.map((el) => {
        if (el.id !== ctrlId) return el;
        const nums = el.zoneNums || [];
        return { ...el, zoneNums: nums.includes(num) ? nums.filter((n) => n !== num) : [...nums, num].sort((a, b) => a - b) };
      }),
    );
  }
  function addCheckpoint() {
    const used = new Set(checkpoints.map((el) => el.label));
    const letter = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").find((l) => !used.has(l)) || String(checkpoints.length + 1);
    const id = `ctrl-${Date.now().toString(36)}`;
    // Posé au milieu du plan « Points de contrôle » : à placer ensuite dans l'onglet Plans
    change((list) => [...list, { id, kind: "ctrl", label: letter, desc: "", color: "#0a2540", level: "rdc", x: 50, y: 50, zoneNums: [], maps: { web: false, vol: false, acc: false, ctrl: true } }]);
    setSelectedId(id);
  }

  async function save() {
    setSaving(true);
    try {
      await saveCoquePlan(normalizePlanElements(elements), currentUserLabel, plan.published, plan.icons);
      setDirty(false);
      setMessage(tr("Contrôles enregistrés.", "Checkpoints saved."));
    } catch (error) {
      setMessage(
        error?.code === "permission-denied"
          ? tr("Enregistrement refusé : seuls les admins et gestionnaires peuvent modifier les contrôles.", "Save refused: only admins and managers can edit checkpoints.")
          : `${tr("Enregistrement impossible", "Could not save")} : ${error?.message || error}`,
      );
    } finally {
      setSaving(false);
    }
  }
  function cancel() {
    setElements(plan.rawElements);
    setDirty(false);
    setMessage(tr("Modifications annulées.", "Changes discarded."));
  }

  // Fiche imprimée pour le bénévole posté au contrôle : la règle (numéros), le plan, qui passe.
  function printSheets(list) {
    const shownElements = attachPlanIcons(elements, plan.icons);
    const sheets = list.map((ctrl) => {
      const nums = ctrl.zoneNums || [];
      const st = stats.get(ctrl.id);
      const zoneLine = zones.filter((zone) => nums.includes(zone.order)).map((zone) => `<li><b>${zone.order}</b> ${escapeHtml(zone.name)}</li>`).join("");
      const groupsHtml = (filter) =>
        st.groups.filter(filter).map((g) => `<li>${escapeHtml(g.label)}${g.lot ? "" : ` <span>${filter === admittedFilter ? g.admitted : g.total - g.admitted}</span>`}</li>`).join("") || `<li class="none">—</li>`;
      const admittedFilter = (g) => g.admitted > 0;
      const refusedFilter = (g) => g.admitted < g.total;
      const where = planDesc(ctrl, lang);
      const highlighted = shownElements.map((el) => (el.kind === "ctrl" ? { ...el, color: el.id === ctrl.id ? "#c8102e" : "#c3ccd3" } : el));
      return `<section class="sheet">
        <header><div class="letter">${escapeHtml(ctrl.label)}</div><div><h1>${tr("Point de contrôle", "Checkpoint")} ${escapeHtml(ctrl.label)}</h1>${where ? `<p>${escapeHtml(where)}</p>` : ""}</div></header>
        <div class="rule">${nums.length
          ? `${tr("Laissez passer si le badge porte", "Let through if the badge shows")} <b>${nums.join(` ${tr("ou", "or")} `)}</b>`
          : tr("Aucune zone liée : à compléter dans Accréditations › Contrôles", "No zone linked yet: complete in Accreditations › Checkpoints")}</div>
        <div class="cols">
          <div class="plan">${planBoxHtml(highlighted, { mapKey: "ctrl", crop: true, lang })}</div>
          <div>
            <h2>${tr("Zones gardées", "Zones guarded")}</h2><ul class="zones">${zoneLine || `<li class="none">—</li>`}</ul>
            <h2>${tr("Passent", "Allowed")}</h2><ul>${groupsHtml(admittedFilter)}</ul>
            <h2>${tr("Ne passent pas", "Not allowed")}</h2><ul>${groupsHtml(refusedFilter)}</ul>
            <p class="note">${tr("En cas de doute : appeler le responsable accréditations. Ne jamais laisser passer un badge sans le bon numéro.", "If in doubt: call the accreditation manager. Never let a badge through without the right number.")}</p>
          </div>
        </div>
      </section>`;
    }).join("");
    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(`<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><title>${tr("Fiches contrôle", "Checkpoint sheets")}</title><style>
      @page { size: A4; margin: 12mm; }
      body { font-family: Barlow, Arial, sans-serif; color: #0b1b2b; margin: 0; }
      .sheet { page-break-after: always; }
      .sheet:last-child { page-break-after: auto; }
      header { display: flex; gap: 5mm; align-items: center; border-bottom: .5mm solid #0b1b2b; padding-bottom: 3mm; }
      .letter { width: 18mm; height: 18mm; border-radius: 3mm; background: #0b1b2b; color: #fff; display: grid; place-items: center; font: 800 30pt/1 "Barlow Condensed", Arial, sans-serif; }
      h1 { margin: 0; font-size: 18pt; } header p { margin: 1mm 0 0; color: #4a5d6c; font-size: 10pt; }
      .rule { margin: 5mm 0; padding: 4mm 5mm; background: #f2f5f8; border-left: 1.5mm solid #c8102e; font-size: 14pt; }
      .rule b { font: 800 22pt/1 "Barlow Condensed", Arial, sans-serif; color: #c8102e; }
      .cols { display: grid; grid-template-columns: 95mm 1fr; gap: 7mm; }
      .plan { height: 135mm; }
      h2 { font-size: 9pt; text-transform: uppercase; letter-spacing: .08em; color: #6c7f8d; margin: 4mm 0 1.5mm; }
      ul { list-style: none; margin: 0; padding: 0; font-size: 10pt; }
      li { display: flex; justify-content: space-between; gap: 3mm; padding: 1mm 0; border-bottom: .2mm solid #e3e9ee; }
      li span { color: #6c7f8d; } .zones li { justify-content: flex-start; } .zones b { width: 6mm; color: #c8102e; }
      .none { color: #8a9aa7; }
      .note { margin-top: 5mm; font-size: 9pt; color: #4a5d6c; }
      ${PLAN_PRINT_CSS}
    </style></head><body>${sheets}<script>window.onload = () => setTimeout(() => window.print(), 300);</${"script"}></body></html>`);
    win.document.close();
  }

  const selectedStats = selected ? stats.get(selected.id) : null;

  return (
    <div className="ctl">
      <div className="ctl-bar">
        <p className="ctl-intro">{tr(
          "Cochez les zones que chaque point de contrôle garde : un badge passe s'il porte au moins un de ces numéros. Les listes et la légende du plan suivent les accréditations.",
          "Tick the zones each checkpoint guards: a badge goes through if it shows at least one of those numbers. Lists and the map legend follow the accreditations.",
        )}</p>
        <div className={`ctl-status ${dirty ? "is-dirty" : ""}`}>
          {plan.loading ? tr("Chargement…", "Loading…") : message || (dirty ? tr("Modifications non enregistrées", "Unsaved changes") : "")}
          {dirty ? <button type="button" className="cpe-btn" onClick={cancel} disabled={saving}>{tr("Annuler", "Cancel")}</button> : null}
          {canEdit ? (
            <button type="button" className="cpe-btn cpe-btn--primary" onClick={save} disabled={saving || !dirty}>
              {saving ? tr("Enregistrement…", "Saving…") : tr("Enregistrer", "Save")}
            </button>
          ) : null}
        </div>
      </div>

      <div className="ctl-layout">
        <div className="ctl-card">
          <table className="ctl-matrix">
            <thead>
              <tr>
                <th className="ctl-matrix__name">{tr("Contrôle", "Checkpoint")}</th>
                {zones.map((zone) => (
                  <th key={zone.id} title={zone.name}>
                    <span className="ctl-zone">{zone.order}</span>
                    <small>{zone.name}</small>
                  </th>
                ))}
                <th className="ctl-matrix__count">{tr("Badges admis", "Badges allowed")}</th>
              </tr>
            </thead>
            <tbody>
              {checkpoints.map((ctrl) => {
                const st = stats.get(ctrl.id);
                return (
                  <tr key={ctrl.id} className={ctrl.id === selected?.id ? "is-selected" : ""} onClick={() => setSelectedId(ctrl.id)}>
                    <td className="ctl-matrix__name">
                      <span className="ctl-letter">{ctrl.label}</span>
                      <span className="ctl-where">{planDesc(ctrl, lang) || planCtrlText(ctrl, elements, lang) || <em>{tr("aucune zone", "no zone")}</em>}</span>
                    </td>
                    {zones.map((zone) => {
                      const on = (ctrl.zoneNums || []).includes(zone.order);
                      return (
                        <td key={zone.id} className="ctl-cell">
                          <button
                            type="button"
                            className={`ctl-tick ${on ? "is-on" : ""}`}
                            aria-pressed={on}
                            disabled={!canEdit}
                            title={on ? tr(`${ctrl.label} ne garde plus ${zone.name}`, `${ctrl.label} no longer guards ${zone.name}`) : tr(`${ctrl.label} garde ${zone.name}`, `${ctrl.label} guards ${zone.name}`)}
                            onClick={(event) => { event.stopPropagation(); toggleZone(ctrl.id, zone.order); }}
                          >
                            {on ? "✓" : ""}
                          </button>
                        </td>
                      );
                    })}
                    <td className="ctl-matrix__count">
                      <b>{st.admitted}</b>/{st.total}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!checkpoints.length ? <p className="ctl-empty">{tr("Aucun point de contrôle sur le plan.", "No checkpoint on the map yet.")}</p> : null}
          <div className="ctl-foot">
            {canEdit ? <button type="button" className="cpe-btn" onClick={addCheckpoint}>+ {tr("Point de contrôle", "Checkpoint")}</button> : null}
            <button type="button" className="cpe-btn" onClick={() => printSheets(checkpoints)} disabled={!checkpoints.length}>{tr("Imprimer toutes les fiches", "Print all sheets")}</button>
            {unguarded.length ? (
              <span className="ctl-warn">{tr("Gardée par aucun contrôle :", "Guarded by no checkpoint:")} {unguarded.map((zone) => `${zone.order} ${zone.name}`).join(", ")}</span>
            ) : null}
          </div>
          <p className="ctl-hint">{tr(
            "Les nouveaux points sont posés au centre du plan « Points de contrôle » : déplacez-les dans l'onglet Plans. Badges admis : badges nominatifs (bénévoles, juges, presse, VIP).",
            "New checkpoints are placed in the middle of the Checkpoints map: move them in the Plans tab. Badges allowed: named badges (volunteers, judges, press, VIP).",
          )}</p>
        </div>

        <aside className="ctl-card ctl-detail">
          {selected && selectedStats ? (
            <>
              <div className="ctl-detail__head">
                <span className="ctl-letter ctl-letter--lg">{selected.label}</span>
                <div>
                  <h3>{tr("Point de contrôle", "Checkpoint")} {selected.label}</h3>
                  <p>{(selected.zoneNums || []).length
                    ? <>{tr("Passe si le badge porte", "Goes through if the badge shows")} <b>{selected.zoneNums.join(` ${tr("ou", "or")} `)}</b></>
                    : tr("Aucune zone liée : personne n'est attendu ici.", "No zone linked: nobody is expected here.")}</p>
                </div>
                <button type="button" className="cpe-btn" onClick={() => printSheets([selected])}>{tr("Fiche", "Sheet")}</button>
              </div>
              {FAMILIES.map(([family, fr, en]) => {
                const groups = selectedStats.groups.filter((g) => g.family === family);
                if (!groups.length) return null;
                return (
                  <div key={family} className="ctl-family">
                    <h4>{tr(fr, en)}</h4>
                    {groups.map((g) => {
                      const state = g.admitted === 0 ? "no" : g.admitted === g.total ? "yes" : "part";
                      const open = openGroup === `${selected.id}|${g.key}`;
                      return (
                        <div key={g.key}>
                          <button type="button" className={`ctl-group is-${state}`} onClick={() => setOpenGroup(open ? "" : `${selected.id}|${g.key}`)} disabled={g.lot}>
                            <i aria-hidden="true">{state === "no" ? "✕" : "✓"}</i>
                            <span>{g.label}</span>
                            <small>{g.lot ? tr("lot", "batch") : `${g.admitted}/${g.total}`}</small>
                          </button>
                          {open ? (
                            <div className="ctl-names">
                              {g.admittedNames.length ? <p><b>{tr("Passent", "Allowed")} :</b> {g.admittedNames.join(", ")}</p> : null}
                              {g.refusedNames.length ? <p><b>{tr("Refusés", "Not allowed")} :</b> {g.refusedNames.join(", ")}</p> : null}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
              {!holders.length ? <p className="ctl-empty">{tr("Aucun badge pour l'instant.", "No badges yet.")}</p> : null}
            </>
          ) : (
            <p className="ctl-empty">{tr("Choisissez un point de contrôle.", "Pick a checkpoint.")}</p>
          )}
        </aside>
      </div>
    </div>
  );
}
