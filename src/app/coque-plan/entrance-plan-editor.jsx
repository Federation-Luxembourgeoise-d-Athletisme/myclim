import { useEffect, useMemo, useRef, useState } from "react";
import { useTr } from "../use-tr";
import { PLAN_ICONS, planIconSvg } from "./coque-plan-data";
import {
  barrierCount,
  ENTRANCE_COLORS,
  ENTRANCE_DEFAULT_ITEMS,
  ENTRANCE_LINE_STYLES,
  ENTRANCE_NEW_COLOR,
  ENTRANCE_VIEW,
  entranceLabel,
  entranceSvg,
  entranceTotals,
  entranceTotalsText,
  FURNITURE,
  lineMeters,
  normalizeEntranceItem,
  UNITS_PER_M,
} from "./entrance-plan-data";
import { saveEntrancePlan, useEntrancePlan } from "./entrance-plan-hooks";
import { printEntrancePlan } from "./entrance-plan-print";
import "./coque-plan.css";

const GROUPS = [
  ["zone", "Files et zones", "Queues & areas"],
  ["mark", "Accueils et repères", "Desks & markers"],
  ["line", "Barrières et lignes", "Barriers & lines"],
  ["furniture", "Mobilier", "Furniture"],
];
const KIND_TITLES = {
  zone: ["File / zone", "Queue / area"],
  mark: ["Accueil / repère", "Desk / marker"],
  line: ["Ligne", "Line"],
  furniture: ["Mobilier", "Furniture"],
};
const LEGEND_LINE_LABELS = { barrier: ["Barrière", "Barrier"], separation: ["Séparation", "Separation"], rope: ["Corde", "Rope"], flow: ["Sens de passage", "Walking direction"] };

const r1 = (v) => Math.round(v * 10) / 10;
const isTyping = (target) => target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

function formatSavedAt(value) {
  const date = value?.toDate ? value.toDate() : null;
  if (!date) return "";
  return date.toLocaleString("fr-LU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

// Rotation d'un point (degrés) : poignées des zones tournées
function rotate(px, py, deg) {
  const a = (deg * Math.PI) / 180;
  return [px * Math.cos(a) - py * Math.sin(a), px * Math.sin(a) + py * Math.cos(a)];
}

// Plan de l'entrée (Accréditations › Plan entrée) : files, accueils, barrières et mobilier du jour J,
// zoomé sur le hall de la Coque. Modifications locales jusqu'à « Enregistrer ».
export function EntrancePlanEditor({ currentUserLabel = "" }) {
  const tr = useTr();
  const lang = tr("fr", "en");
  const plan = useEntrancePlan();
  const [items, setItems] = useState(plan.items);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [grid, setGrid] = useState(false);
  const stageRef = useRef(null);
  const dragRef = useRef(null);

  useEffect(() => {
    if (!dirty) setItems(plan.items);
  }, [plan.items, dirty]);

  const selected = items.find((item) => item.id === selectedId) || null;
  const totals = useMemo(() => entranceTotals(items), [items]);

  function change(updater) {
    setItems((current) => updater(current));
    setDirty(true);
    setMessage("");
  }
  const patch = (id, values) => change((list) => list.map((item) => (item.id === id ? normalizeEntranceItem({ ...item, ...values }) : item)));

  function addItem(kind, extra = {}) {
    const id = `${kind}-${Date.now().toString(36)}`;
    const { x, y, w, h } = ENTRANCE_VIEW;
    const base = { id, kind, x: Math.round(x + w * 0.62), y: Math.round(y + h * 0.5) };
    const defaults = {
      zone: { label: tr("Nouvelle file", "New queue"), color: ENTRANCE_NEW_COLOR, w: 60, h: 22 },
      mark: { label: tr("Accueil", "Welcome"), color: ENTRANCE_NEW_COLOR, icon: "", showText: true },
      line: { style: "barrier", label: "", color: "#4a5d6c", dx: 2 * UNITS_PER_M, dy: 0 },
      furniture: { type: "table", count: 1, rot: 0 },
    }[kind];
    const item = normalizeEntranceItem({ ...base, ...defaults, ...extra });
    change((list) => [...list, item]);
    setSelectedId(id);
  }

  function duplicate(item) {
    const id = `${item.kind}-${Date.now().toString(36)}`;
    change((list) => [...list, normalizeEntranceItem({ ...item, id, x: item.x + 6, y: item.y + 6 })]);
    setSelectedId(id);
  }

  function remove(item) {
    change((list) => list.filter((el) => el.id !== item.id));
    setSelectedId(null);
  }

  async function save() {
    setSaving(true);
    try {
      await saveEntrancePlan(items, currentUserLabel);
      setDirty(false);
      setMessage(tr("Plan enregistré.", "Plan saved."));
    } catch (error) {
      setMessage(
        error?.code === "permission-denied"
          ? tr("Enregistrement refusé : seuls les admins et gestionnaires peuvent modifier le plan.", "Save refused: only admins and managers can edit the plan.")
          : `${tr("Enregistrement impossible", "Could not save")} : ${error?.message || error}`,
      );
    } finally {
      setSaving(false);
    }
  }

  function cancel() {
    setItems(plan.items);
    setDirty(false);
    setMessage(tr("Modifications annulées.", "Changes discarded."));
  }

  function resetToDefault() {
    if (!window.confirm(tr(
      "Repartir du plan de départ ? Tout ce qui a été placé sera remplacé (après Enregistrer).",
      "Start again from the starting plan? Everything placed will be replaced (after Save).",
    ))) return;
    change(() => ENTRANCE_DEFAULT_ITEMS);
    setSelectedId(null);
  }

  // ─── Souris : déplacer, tirer les bouts d'une ligne, redimensionner une zone ───────────────
  function svgPoint(event) {
    const svg = stageRef.current?.querySelector("svg");
    if (!svg) return null;
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const p = point.matrixTransform(svg.getScreenCTM().inverse());
    return { x: p.x, y: p.y };
  }
  const snap = (v) => (grid ? Math.round(v / (UNITS_PER_M / 4)) * (UNITS_PER_M / 4) : r1(v));

  function onPointerDown(event) {
    if (event.button !== 0) return;
    const target = event.target.closest?.("[data-handle], [data-resize], [data-id]");
    const p = svgPoint(event);
    if (!target || !p) {
      setSelectedId(null);
      return;
    }
    event.preventDefault();
    stageRef.current.setPointerCapture?.(event.pointerId);
    if (target.dataset.handle && selected) {
      const sign = Number(target.dataset.handle);
      dragRef.current = { mode: "end", id: selected.id, ox: selected.x - sign * selected.dx, oy: selected.y - sign * selected.dy, sign };
      return;
    }
    if (target.dataset.resize && selected) {
      dragRef.current = { mode: "resize", id: selected.id, cx: selected.x, cy: selected.y, rot: selected.rot || 0 };
      return;
    }
    const item = items.find((el) => el.id === target.dataset.id);
    if (!item) return;
    setSelectedId(item.id);
    dragRef.current = { mode: "move", id: item.id, offX: p.x - item.x, offY: p.y - item.y };
  }

  function onPointerMove(event) {
    const drag = dragRef.current;
    if (!drag) return;
    const p = svgPoint(event);
    if (!p) return;
    if (drag.mode === "move") {
      patch(drag.id, { x: snap(p.x - drag.offX), y: snap(p.y - drag.offY) });
    } else if (drag.mode === "end") {
      const px = snap(p.x);
      const py = snap(p.y);
      patch(drag.id, {
        x: r1((px + drag.ox) / 2),
        y: r1((py + drag.oy) / 2),
        dx: r1((drag.sign * (px - drag.ox)) / 2),
        dy: r1((drag.sign * (py - drag.oy)) / 2),
      });
    } else if (drag.mode === "resize") {
      const [lx, ly] = rotate(p.x - drag.cx, p.y - drag.cy, -drag.rot);
      patch(drag.id, { w: snap(Math.max(4, 2 * Math.abs(lx))), h: snap(Math.max(4, 2 * Math.abs(ly))) });
    }
  }
  const onPointerUp = () => { dragRef.current = null; };

  // ─── Clavier : flèches (1 unité, Maj = 1 m), R tourner, Suppr, Ctrl+D dupliquer ────────────
  useEffect(() => {
    function onKey(event) {
      if (!selected || isTyping(event.target)) return;
      const step = event.shiftKey ? UNITS_PER_M : 1;
      const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      if (moves[event.key]) {
        event.preventDefault();
        patch(selected.id, { x: selected.x + moves[event.key][0], y: selected.y + moves[event.key][1] });
      } else if ((event.key === "r" || event.key === "R") && "rot" in selected && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        patch(selected.id, { rot: (selected.rot || 0) + (event.shiftKey ? -15 : 15) });
      } else if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        remove(selected);
      } else if ((event.ctrlKey || event.metaKey) && (event.key === "d" || event.key === "D")) {
        event.preventDefault();
        duplicate(selected);
      } else if (event.key === "Escape") {
        setSelectedId(null);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Poignées de la sélection, dessinées dans le SVG
  let handles = "";
  if (selected?.kind === "line") {
    handles = [-1, 1]
      .map((sign) => `<rect data-handle="${sign}" class="ep-handle" x="${r1(selected.x + sign * selected.dx - 2.2)}" y="${r1(selected.y + sign * selected.dy - 2.2)}" width="4.4" height="4.4" rx=".6" />`)
      .join("");
  } else if (selected?.kind === "zone") {
    const [hx, hy] = rotate(selected.w / 2, selected.h / 2, selected.rot || 0);
    handles = `<rect data-resize="1" class="ep-handle ep-handle--resize" x="${r1(selected.x + hx - 2.2)}" y="${r1(selected.y + hy - 2.2)}" width="4.4" height="4.4" rx=".6" />`;
  }
  const svg = entranceSvg(items, { lang, grid, selectedId, extra: handles });

  const savedAt = formatSavedAt(plan.updatedAt);
  const savedNote = plan.saved
    ? `${tr("Enregistré", "Saved")}${savedAt ? ` ${tr("le", "on")} ${savedAt}` : ""}${plan.updatedBy ? ` ${tr("par", "by")} ${plan.updatedBy}` : ""}`
    : tr("Plan de départ (pas encore enregistré)", "Starting plan (not saved yet)");
  const totalsParts = entranceTotalsText(totals, lang);

  const rowName = (item) => {
    if (item.kind === "furniture") {
      const def = FURNITURE[item.type];
      return `${tr(def.label, def.en)}${item.count > 1 ? ` ×${item.count}` : ""}`;
    }
    if (item.kind === "line") {
      const name = entranceLabel(item, lang) || tr(...LEGEND_LINE_LABELS[item.style]);
      return item.style === "barrier" ? `${name} · ${barrierCount(item)} × 2 m` : `${name} · ${r1(lineMeters(item))} m`;
    }
    return entranceLabel(item, lang) || tr("(sans texte)", "(no text)");
  };

  return (
    <div className="coque-plan-editor entrance-plan-editor">
      <div className="cpe-bar">
        <div className="ep-title">
          <b>{tr("Plan de l'entrée", "Entrance plan")}</b>
          <span>{tr("Hall de la Coque · mise en place du jour J", "Coque entrance hall · meeting-day set-up")}</span>
        </div>
        <label className="cpe-publish" title={tr("Grille de 1 m ; les éléments s'y calent par 25 cm", "1 m grid; items snap every 25 cm")}>
          <input type="checkbox" checked={grid} onChange={(event) => setGrid(event.target.checked)} />
          {tr("Grille 1 m", "1 m grid")}
        </label>
        <div className="cpe-seg ep-print" role="group" aria-label={tr("Imprimer en A4", "Print in A4")}>
          <button type="button" onClick={() => printEntrancePlan(items, { lang: "fr" })}>{tr("Imprimer A4 · FR", "Print A4 · FR")}</button>
          <button type="button" onClick={() => printEntrancePlan(items, { lang: "en" })}>EN</button>
        </div>
        <div className={`cpe-status ${dirty ? "is-dirty" : ""}`}>
          {plan.loading ? tr("Chargement…", "Loading…") : dirty ? message || tr("Modifications non enregistrées", "Unsaved changes") : message || savedNote}
          {dirty ? <button type="button" className="cpe-btn" onClick={cancel} disabled={saving}>{tr("Annuler", "Cancel")}</button> : null}
          <button type="button" className="cpe-btn cpe-btn--primary" onClick={save} disabled={saving || (!dirty && plan.saved)}>
            {saving ? tr("Enregistrement…", "Saving…") : tr("Enregistrer", "Save")}
          </button>
        </div>
      </div>
      {plan.error ? <p className="panel-note">{plan.error}</p> : null}

      <div className="cpe-layout">
        <aside className="cpe-panel">
          <h3>{tr("Éléments", "Items")}</h3>
          {GROUPS.map(([kind, fr, en]) => {
            const rows = items.filter((item) => item.kind === kind);
            if (!rows.length) return null;
            return (
              <div key={kind}>
                <div className="cpe-group ep-group"><span>{tr(fr, en)}</span><b>{rows.length}</b></div>
                {rows.map((item) => (
                  <div key={item.id} className={`cpe-row ep-row ${item.id === selectedId ? "is-selected" : ""}`} onClick={() => setSelectedId(item.id)}>
                    <ItemChip item={item} />
                    <span className="cpe-row__name">{rowName(item)}</span>
                  </div>
                ))}
              </div>
            );
          })}
          <div className="ep-adds">
            <span>{tr("Ajouter", "Add")}</span>
            <button type="button" className="cpe-btn" onClick={() => addItem("zone")}>{tr("File / zone", "Queue / area")}</button>
            <button type="button" className="cpe-btn" onClick={() => addItem("mark")}>{tr("Accueil / repère", "Desk / marker")}</button>
            <button type="button" className="cpe-btn" onClick={() => addItem("line")}>{tr("Barrière", "Barrier")}</button>
            <button type="button" className="cpe-btn" onClick={() => addItem("line", { style: "flow", color: "#0f8a5f" })}>{tr("Flèche", "Arrow")}</button>
            <button type="button" className="cpe-btn" onClick={() => addItem("line", { style: "rope", color: "#c8102e" })}>{tr("Corde", "Rope")}</button>
            <button type="button" className="cpe-btn" onClick={() => addItem("furniture", { type: "table" })}>{tr("Table", "Table")}</button>
            <button type="button" className="cpe-btn" onClick={() => addItem("furniture", { type: "chair", count: 2 })}>{tr("Chaises", "Chairs")}</button>
            <button type="button" className="cpe-btn" onClick={() => addItem("furniture", { type: "bench" })}>{tr("Banc bas", "Low bench")}</button>
            <button type="button" className="cpe-btn" onClick={() => addItem("furniture", { type: "high" })}>{tr("Mange-debout", "High table")}</button>
            <button type="button" className="cpe-btn" onClick={() => addItem("furniture", { type: "rollup" })}>Roll-up</button>
          </div>
          <button type="button" className="cpe-btn cpe-btn--danger ep-reset" onClick={resetToDefault}>{tr("Revenir au plan de départ", "Back to the starting plan")}</button>
        </aside>

        <section className="cpe-stage">
          <div className="cpe-stage__bar">
            <span>{tr("Glisser pour déplacer · carrés bleus : bouts des lignes, coin des zones", "Drag to move · blue squares: line ends, zone corner")}</span>
            <span className="ep-keys">{tr("Flèches · Maj = 1 m · R tourner · Ctrl+D dupliquer · Suppr", "Arrows · Shift = 1 m · R rotate · Ctrl+D duplicate · Del")}</span>
          </div>
          <div
            ref={stageRef}
            className="ep-canvas"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            dangerouslySetInnerHTML={{ __html: svg }}
          />
          <div className="ep-totals">
            <b>{tr("Matériel", "Equipment")}</b>
            {totalsParts.length ? totalsParts.map((part) => <span key={part}>{part}</span>) : <em>{tr("rien de placé", "nothing placed")}</em>}
          </div>
        </section>

        <aside className="cpe-panel cpe-detail">
          {selected ? (
            <ItemDetail
              item={selected}
              onPatch={(values) => patch(selected.id, values)}
              onDuplicate={() => duplicate(selected)}
              onDelete={() => remove(selected)}
            />
          ) : (
            <>
              <h3>{tr("Élément", "Item")}</h3>
              <p className="cpe-empty">{tr(
                "Clique sur un élément du plan ou de la liste pour le modifier. Le mobilier est dessiné à sa vraie taille (échelle en bas à gauche du plan).",
                "Click an item on the plan or in the list to edit it. Furniture is drawn at its real size (scale bar at the bottom left of the plan).",
              )}</p>
              <details className="cpe-help" style={{ marginTop: 10 }}>
                <summary>{tr("Comment ça marche", "How it works")}</summary>
                <p>{tr(
                  "Files et zones : rectangles en pointillés (files d'attente, zone Kids race). Accueils : étiquettes, avec ou sans icône. Barrières : un trait par barrière de 2 m, le compte est fait tout seul.",
                  "Queues and areas: dashed rectangles (queues, Kids race area). Desks: labels, with or without an icon. Barriers: one mark per 2 m barrier, counted automatically.",
                )}</p>
                <p>{tr(
                  "Le texte détaillé (légende) apparaît sous le plan imprimé, avec la liste du matériel à prévoir.",
                  "The detailed text (legend) shows under the printed plan, with the list of equipment needed.",
                )}</p>
                <p>{tr(
                  "Échelle approximative : le fond est retracé du plan d'architecte, à vérifier sur place.",
                  "Approximate scale: the base is traced from the architect plan, to check on site.",
                )}</p>
              </details>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}

// Pastille de la liste : couleur et forme selon le type
function ItemChip({ item }) {
  if (item.kind === "mark" && PLAN_ICONS[item.icon]) {
    return <span className="cpe-chip" style={{ background: item.color }} dangerouslySetInnerHTML={{ __html: planIconSvg(item.icon) }} />;
  }
  if (item.kind === "line") return <span className="ep-chip-line" style={{ "--line": item.color }} data-style={item.style} />;
  if (item.kind === "furniture") return <span className={`ep-chip-furn ep-chip-furn--${item.type}`} />;
  if (item.kind === "zone") return <span className="ep-chip-zone" style={{ borderColor: item.color, background: `${item.color}22` }} />;
  return <span className="cpe-chip" style={{ background: item.color }} />;
}

function RotationButtons({ value, onChange }) {
  const tr = useTr();
  return (
    <div className="cpe-field">
      <span>{tr("Rotation", "Rotation")} <small>{tr("degrés · touche R = +15°", "degrees · R key = +15°")}</small></span>
      <div className="cpe-rotate">
        <input type="number" min={-180} max={180} step={5} value={value} onChange={(event) => onChange(Number(event.target.value) || 0)} aria-label={tr("Rotation en degrés", "Rotation in degrees")} />
        <div className="cpe-seg">
          {[-90, -45, 0, 45, 90, 180].map((deg) => (
            <button key={deg} type="button" className={value === deg || (deg === 180 && value === -180) ? "is-on" : ""} onClick={() => onChange(deg)}>{deg > 0 && deg < 180 ? `+${deg}` : deg}°</button>
          ))}
        </div>
      </div>
    </div>
  );
}

function ItemDetail({ item, onPatch, onDuplicate, onDelete }) {
  const tr = useTr();
  const meters = (units) => r1(units / UNITS_PER_M);
  const texts = (
    <>
      <label className="cpe-field">
        <span>{item.kind === "line" ? tr("Nom dans la légende", "Name in the legend") : tr("Texte sur le plan", "Text on the plan")} <small>{tr("court", "short")}</small></span>
        <input type="text" value={item.label} maxLength={40} onChange={(event) => onPatch({ label: event.target.value })} />
      </label>
      <label className="cpe-field">
        <span>{tr("Texte en anglais", "English text")} <small>{tr("vide = texte ci-dessus", "empty = text above")}</small></span>
        <input type="text" value={item.labelEn} maxLength={40} onChange={(event) => onPatch({ labelEn: event.target.value })} />
      </label>
      <label className="cpe-field">
        <span>{tr("Légende", "Legend")} <small>{tr("le détail, sous le plan imprimé", "the detail, under the printed plan")}</small></span>
        <textarea value={item.desc} onChange={(event) => onPatch({ desc: event.target.value })} />
      </label>
      <label className="cpe-field">
        <span>{tr("Légende en anglais", "English legend")}</span>
        <textarea value={item.descEn} onChange={(event) => onPatch({ descEn: event.target.value })} />
      </label>
    </>
  );
  const colors = (
    <div className="cpe-field">
      <span>{tr("Couleur", "Colour")}</span>
      <div className="cpe-colors">
        {ENTRANCE_COLORS.map((color) => (
          <button key={color} type="button" className={color === item.color ? "is-on" : ""} style={{ background: color }} aria-label={color} onClick={() => onPatch({ color })} />
        ))}
      </div>
    </div>
  );

  return (
    <>
      <h3>{tr(...KIND_TITLES[item.kind])}</h3>
      {item.kind === "furniture" ? (
        <>
          <label className="cpe-field">
            <span>{tr("Type", "Type")}</span>
            <select
              value={item.type}
              onChange={(event) => {
                const def = FURNITURE[event.target.value];
                onPatch({ type: event.target.value, wCm: def.w, dCm: def.d });
              }}
            >
              {Object.entries(FURNITURE).map(([key, def]) => <option key={key} value={key}>{tr(def.label, def.en)}</option>)}
            </select>
          </label>
          <div className="cpe-field">
            <span>{tr("Nombre", "Number")} <small>{tr("côte à côte", "side by side")}</small></span>
            <div className="ep-stepper">
              <button type="button" className="cpe-btn" onClick={() => onPatch({ count: item.count - 1 })} disabled={item.count <= 1}>−</button>
              <input type="number" min={1} max={30} value={item.count} onChange={(event) => onPatch({ count: Number(event.target.value) || 1 })} />
              <button type="button" className="cpe-btn" onClick={() => onPatch({ count: item.count + 1 })}>+</button>
            </div>
          </div>
          <div className="cpe-field">
            <span>{tr("Taille d'une pièce", "Size of one piece")} <small>cm</small></span>
            <div className="cpe-inline">
              <input type="number" value={item.wCm} onChange={(event) => onPatch({ wCm: Number(event.target.value) || 10 })} aria-label={tr("Longueur (cm)", "Length (cm)")} /> ×
              <input type="number" value={item.dCm} onChange={(event) => onPatch({ dCm: Number(event.target.value) || 10 })} aria-label={tr("Profondeur (cm)", "Depth (cm)")} />
            </div>
          </div>
          <RotationButtons value={item.rot} onChange={(rot) => onPatch({ rot })} />
          {item.type === "chair" ? <p className="cpe-empty">{tr("Le trait foncé est le dossier.", "The dark edge is the backrest.")}</p> : null}
        </>
      ) : null}

      {item.kind === "line" ? (
        <>
          <label className="cpe-field">
            <span>{tr("Type de ligne", "Line type")} <small>{tr("tirer les carrés bleus", "drag the blue squares")}</small></span>
            <select value={item.style} onChange={(event) => onPatch({ style: event.target.value })}>
              {Object.entries(ENTRANCE_LINE_STYLES).map(([key, style]) => <option key={key} value={key}>{tr(style.label, style.en)}</option>)}
            </select>
          </label>
          <p className="ep-measure">
            {r1(lineMeters(item))} m
            {item.style === "barrier" ? <> · <b>{barrierCount(item)}</b> {tr("barrière(s) de 2 m", "barrier(s) of 2 m")}</> : null}
          </p>
          {colors}
          {texts}
        </>
      ) : null}

      {item.kind === "zone" ? (
        <>
          {texts}
          <div className="cpe-field">
            <span>{tr("Taille", "Size")} <small>{tr("mètres · ou tirer le coin bleu", "metres · or drag the blue corner")}</small></span>
            <div className="cpe-inline">
              <input type="number" step={0.5} value={meters(item.w)} onChange={(event) => onPatch({ w: (Number(event.target.value) || 0.5) * UNITS_PER_M })} aria-label={tr("Largeur (m)", "Width (m)")} /> ×
              <input type="number" step={0.5} value={meters(item.h)} onChange={(event) => onPatch({ h: (Number(event.target.value) || 0.5) * UNITS_PER_M })} aria-label={tr("Hauteur (m)", "Height (m)")} />
            </div>
          </div>
          <RotationButtons value={item.rot} onChange={(rot) => onPatch({ rot })} />
          {colors}
        </>
      ) : null}

      {item.kind === "mark" ? (
        <>
          {texts}
          <div className="cpe-field">
            <span>{tr("Icône", "Icon")}</span>
            <div className="cpe-icons">
              <button type="button" className={`cpe-icon is-text ${!item.icon ? "is-on" : ""}`} title={tr("Texte seul", "Text only")} onClick={() => onPatch({ icon: "", showText: true })}>
                <span style={{ background: "#fff" }}>Aa</span>
              </button>
              {Object.entries(PLAN_ICONS).map(([key, icon]) => (
                <button key={key} type="button" className={`cpe-icon ${item.icon === key ? "is-on" : ""}`} title={tr(icon.label, icon.en)} aria-label={tr(icon.label, icon.en)} onClick={() => onPatch({ icon: key })}>
                  <span style={{ background: item.color }} dangerouslySetInnerHTML={{ __html: planIconSvg(key) }} />
                </button>
              ))}
            </div>
            {item.icon ? (
              <div className="cpe-seg cpe-seg--inline" role="group">
                <button type="button" className={!item.showText ? "is-on" : ""} onClick={() => onPatch({ showText: false })}>{tr("Icône seule", "Icon only")}</button>
                <button type="button" className={item.showText ? "is-on" : ""} onClick={() => onPatch({ showText: true })}>{tr("Icône + texte", "Icon + text")}</button>
              </div>
            ) : null}
          </div>
          <RotationButtons value={item.rot} onChange={(rot) => onPatch({ rot })} />
          {colors}
        </>
      ) : null}

      <div className="ep-actions">
        <button type="button" className="cpe-btn" onClick={onDuplicate}>{tr("Dupliquer", "Duplicate")}</button>
        <button type="button" className="cpe-btn cpe-btn--danger" onClick={onDelete}>{tr("Supprimer", "Delete")}</button>
      </div>
    </>
  );
}
