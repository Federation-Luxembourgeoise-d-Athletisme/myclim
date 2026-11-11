import { useEffect, useMemo, useState } from "react";
import { useTr } from "./use-tr";
import { BADGE_CATEGORIES } from "./accreditation-config";
import { attachPlanIcons, CTRL_BADGE_NAMES, normalizePlanElements, PLAN_PRINT_CSS, planBoxHtml, planDesc } from "./coque-plan/coque-plan-data";
import { saveCoquePlan, useCoquePlan } from "./coque-plan/coque-plan-hooks";
import "./accreditation-checkpoints.css";

// Accréditations › Contrôles : la règle de chaque point de contrôle. On laisse passer un badge
// qui porte un des numéros de zone cochés, ou un badge d'un type accepté d'office (ex. badge VIP,
// qui ne porte pas de numéro). Tout autre badge est refusé. Pas de comptage : on contrôle le badge.
// Enregistré sur les points de contrôle du plan (zoneNums, badgeTypes) : la légende du plan
// « Points de contrôle » se remplit toute seule.

const VIP_COLOR = "#b8912a";
const BADGE_TYPES = [
  { key: "vip", color: VIP_COLOR },
  ...BADGE_CATEGORIES.map((category) => ({ key: category.key, color: category.color })),
].filter((type) => CTRL_BADGE_NAMES[type.key]);

const escapeHtml = (value) =>
  String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function AccreditationCheckpoints({ zones, currentUserLabel = "", canEdit = true }) {
  const tr = useTr();
  const plan = useCoquePlan();
  const [elements, setElements] = useState(plan.rawElements);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [selectedId, setSelectedId] = useState("");

  useEffect(() => {
    if (!dirty) setElements(plan.rawElements);
  }, [plan.rawElements, dirty]);

  const lang = tr("fr", "en");
  const checkpoints = useMemo(
    () => elements.filter((el) => el.kind === "ctrl").sort((a, b) => a.label.localeCompare(b.label, "fr")),
    [elements],
  );
  const selected = checkpoints.find((el) => el.id === selectedId) || checkpoints[0] || null;
  const typeName = (key) => (key === "vip" ? tr("Badge VIP", "VIP badge") : CTRL_BADGE_NAMES[key]);
  const typeColor = (key) => BADGE_TYPES.find((type) => type.key === key)?.color || "#4a5d6c";

  // Zone gardée par aucun contrôle : à signaler
  const guarded = new Set(checkpoints.flatMap((el) => el.zoneNums || []));
  const unguarded = zones.filter((zone) => !guarded.has(zone.order));

  function change(updater) {
    setElements((list) => updater(list));
    setDirty(true);
    setMessage("");
  }
  const toggleIn = (list = [], value) => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  const toggleZone = (ctrlId, num) =>
    change((list) => list.map((el) => (el.id === ctrlId ? { ...el, zoneNums: toggleIn(el.zoneNums, num).sort((a, b) => a - b) } : el)));
  const toggleType = (ctrlId, key) =>
    change((list) => list.map((el) => (el.id === ctrlId ? { ...el, badgeTypes: toggleIn(el.badgeTypes, key) } : el)));

  function addCheckpoint() {
    const used = new Set(checkpoints.map((el) => el.label));
    const letter = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").find((l) => !used.has(l)) || String(checkpoints.length + 1);
    const id = `ctrl-${Date.now().toString(36)}`;
    // Posé au milieu du plan « Points de contrôle » : à placer ensuite dans l'onglet Plans
    change((list) => [...list, { id, kind: "ctrl", label: letter, desc: "", color: "#0a2540", level: "rdc", x: 50, y: 50, zoneNums: [], badgeTypes: [], maps: { web: false, vol: false, acc: false, ctrl: true } }]);
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

  // La règle en une phrase : « 1 ou 2 · badge VIP »
  function ruleParts(ctrl) {
    return [...(ctrl.zoneNums || []).map(String), ...(ctrl.badgeTypes || []).map(typeName)];
  }

  // Fiche imprimée pour le bénévole posté au contrôle : la règle, le plan, rien d'autre.
  function printSheets(list) {
    const shownElements = attachPlanIcons(elements, plan.icons);
    const sheets = list.map((ctrl) => {
      const nums = ctrl.zoneNums || [];
      const types = ctrl.badgeTypes || [];
      const where = planDesc(ctrl, lang);
      const highlighted = shownElements.map((el) => (el.kind === "ctrl" ? { ...el, color: el.id === ctrl.id ? "#c8102e" : "#c3ccd3" } : el));
      const zoneItems = zones
        .filter((zone) => nums.includes(zone.order))
        .map((zone) => `<li><span class="num">${zone.order}</span>${escapeHtml(zone.name)}</li>`)
        .join("");
      const typeItems = types
        .map((key) => `<li><span class="type" style="background:${typeColor(key)}"></span>${escapeHtml(typeName(key))}</li>`)
        .join("");
      return `<section class="sheet">
        <header><div class="letter">${escapeHtml(ctrl.label)}</div><div><h1>${tr("Point de contrôle", "Checkpoint")} ${escapeHtml(ctrl.label)}</h1>${where ? `<p>${escapeHtml(where)}</p>` : ""}</div></header>
        <div class="cols">
          <div class="plan">${planBoxHtml(highlighted, { mapKey: "ctrl", crop: true, lang })}</div>
          <div>
            <div class="box yes">
              <h2>${tr("On laisse passer", "Let through")}</h2>
              ${zoneItems ? `<p class="sub">${tr("Badge qui porte le numéro", "Badge showing the number")}</p><ul>${zoneItems}</ul>` : ""}
              ${typeItems ? `<p class="sub">${zoneItems ? tr("ou, quel que soit le numéro", "or, whatever the number") : tr("Badges", "Badges")}</p><ul>${typeItems}</ul>` : ""}
              ${!zoneItems && !typeItems ? `<p class="sub">${tr("Rien de coché : à compléter dans Accréditations › Contrôles", "Nothing ticked yet: complete in Accreditations › Checkpoints")}</p>` : ""}
            </div>
            <div class="box no">
              <h2>${tr("On refuse", "Turn away")}</h2>
              <p class="sub">${tr("Tout autre badge, ou pas de badge.", "Any other badge, or no badge.")}</p>
            </div>
            <p class="note">${tr("En cas de doute : appeler le responsable accréditations.", "If in doubt: call the accreditation manager.")}</p>
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
      header { display: flex; gap: 5mm; align-items: center; border-bottom: .5mm solid #0b1b2b; padding-bottom: 3mm; margin-bottom: 6mm; }
      .letter { width: 18mm; height: 18mm; border-radius: 3mm; background: #0b1b2b; color: #fff; display: grid; place-items: center; font: 800 30pt/1 "Barlow Condensed", Arial, sans-serif; }
      h1 { margin: 0; font-size: 18pt; } header p { margin: 1mm 0 0; color: #4a5d6c; font-size: 10pt; }
      .cols { display: grid; grid-template-columns: 95mm 1fr; gap: 7mm; }
      .plan { height: 135mm; }
      .box { border-radius: 2.5mm; padding: 4mm 5mm; margin-bottom: 5mm; }
      .box.yes { background: #eaf6f0; border-left: 1.5mm solid #0f8a5f; }
      .box.no { background: #fbeced; border-left: 1.5mm solid #c8102e; }
      h2 { margin: 0 0 2mm; font-size: 14pt; }
      .sub { margin: 2mm 0 1.5mm; font-size: 10pt; color: #4a5d6c; }
      ul { list-style: none; margin: 0; padding: 0; }
      li { display: flex; align-items: center; gap: 3mm; padding: 1.2mm 0; font-size: 13pt; font-weight: 600; }
      .num { width: 10mm; height: 10mm; border-radius: 50%; background: #c8102e; color: #fff; display: grid; place-items: center; font: 800 18pt/1 "Barlow Condensed", Arial, sans-serif; }
      .type { width: 10mm; height: 6mm; border-radius: 1mm; }
      .note { font-size: 9.5pt; color: #4a5d6c; }
      ${PLAN_PRINT_CSS}
    </style></head><body>${sheets}<script>window.onload = () => setTimeout(() => window.print(), 300);</${"script"}></body></html>`);
    win.document.close();
  }

  return (
    <div className="ctl">
      <div className="ctl-bar">
        <p className="ctl-intro">{tr(
          "Pour chaque point de contrôle : les numéros de zone qui passent, et les badges acceptés d'office (ex. le badge VIP, sans numéro). Tout autre badge est refusé.",
          "For each checkpoint: the zone numbers that go through, and the badges always accepted (e.g. the VIP badge, which has no number). Any other badge is turned away.",
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
                <th className="ctl-matrix__types">{tr("Acceptés d'office", "Always accepted")}</th>
              </tr>
            </thead>
            <tbody>
              {checkpoints.map((ctrl) => (
                <tr key={ctrl.id} className={ctrl.id === selected?.id ? "is-selected" : ""} onClick={() => setSelectedId(ctrl.id)}>
                  <td className="ctl-matrix__name">
                    <span className="ctl-letter">{ctrl.label}</span>
                    <span className="ctl-where">{planDesc(ctrl, lang) || (ruleParts(ctrl).length ? ruleParts(ctrl).join(" · ") : <em>{tr("rien de coché", "nothing ticked")}</em>)}</span>
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
                          title={on ? tr(`${ctrl.label} ne laisse plus passer le ${zone.order}`, `${ctrl.label} no longer lets ${zone.order} through`) : tr(`${ctrl.label} laisse passer le ${zone.order} (${zone.name})`, `${ctrl.label} lets ${zone.order} (${zone.name}) through`)}
                          onClick={(event) => { event.stopPropagation(); toggleZone(ctrl.id, zone.order); }}
                        >
                          {on ? "✓" : ""}
                        </button>
                      </td>
                    );
                  })}
                  <td className="ctl-matrix__types">
                    {(ctrl.badgeTypes || []).map((key) => (
                      <span key={key} className="ctl-type" style={{ "--type": typeColor(key) }}>{typeName(key)}</span>
                    ))}
                  </td>
                </tr>
              ))}
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
            "Les nouveaux points sont posés au centre du plan « Points de contrôle » : déplacez-les dans l'onglet Plans.",
            "New checkpoints are placed in the middle of the Checkpoints map: move them in the Plans tab.",
          )}</p>
        </div>

        <aside className="ctl-card ctl-detail">
          {selected ? (
            <>
              <div className="ctl-detail__head">
                <span className="ctl-letter ctl-letter--lg">{selected.label}</span>
                <h3>{tr("Point de contrôle", "Checkpoint")} {selected.label}</h3>
                <button type="button" className="cpe-btn" onClick={() => printSheets([selected])}>{tr("Fiche", "Sheet")}</button>
              </div>
              <div className="ctl-rule is-yes">
                <h4>{tr("On laisse passer", "Let through")}</h4>
                {(selected.zoneNums || []).length ? (
                  <div className="ctl-nums">
                    {selected.zoneNums.map((n) => <span key={n} className="ctl-zone ctl-zone--lg">{n}</span>)}
                  </div>
                ) : null}
                {(selected.badgeTypes || []).length ? (
                  <p className="ctl-rule__or">{(selected.zoneNums || []).length ? tr("ou, quel que soit le numéro :", "or, whatever the number:") : null} {selected.badgeTypes.map(typeName).join(", ")}</p>
                ) : null}
                {!ruleParts(selected).length ? <p className="ctl-rule__or">{tr("Rien de coché.", "Nothing ticked.")}</p> : null}
              </div>
              <div className="ctl-rule is-no">
                <h4>{tr("On refuse", "Turn away")}</h4>
                <p className="ctl-rule__or">{tr("Tout autre badge, ou pas de badge.", "Any other badge, or no badge.")}</p>
              </div>
              <div className="cpe-field ctl-types">
                <span>{tr("Badges acceptés d'office", "Always accepted badges")} <small>{tr("quel que soit le numéro", "whatever the number")}</small></span>
                <div className="ctl-type-list">
                  {BADGE_TYPES.map((type) => {
                    const on = (selected.badgeTypes || []).includes(type.key);
                    return (
                      <button
                        key={type.key}
                        type="button"
                        className={`ctl-type ctl-type--btn ${on ? "is-on" : ""}`}
                        style={{ "--type": type.color }}
                        aria-pressed={on}
                        disabled={!canEdit}
                        onClick={() => toggleType(selected.id, type.key)}
                      >
                        {typeName(type.key)}
                      </button>
                    );
                  })}
                </div>
              </div>
            </>
          ) : (
            <p className="ctl-empty">{tr("Choisissez un point de contrôle.", "Pick a checkpoint.")}</p>
          )}
        </aside>
      </div>
    </div>
  );
}
