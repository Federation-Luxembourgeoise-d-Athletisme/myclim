import { useEffect, useMemo, useRef, useState } from "react";
import { useTr } from "../use-tr";
import {
  attachPlanIcons,
  CUSTOM_ICON_PREFIX,
  normalizePlanElements,
  PLAN_DEFAULT_ELEMENTS,
  PLAN_FACILITIES,
  PLAN_H,
  PLAN_ICONS,
  PLAN_LINE_STYLES,
  PLAN_W,
  PLAN_LEVELS,
  PLAN_MAPS,
  PLAN_PALETTE,
  planColorOf,
  planHasIcon,
  planIconHtml,
  planIconSvg,
  planPictoBg,
  planShowsText,
} from "./coque-plan-data";
import { saveCoquePlan, useCoquePlan } from "./coque-plan-hooks";
import { ICON_FILE_TYPES, processIconFile } from "./coque-plan-icon-upload";
import { PlanCanvas, PlanLegend } from "./coque-plan-view";

// Libellés FR / EN de l'éditeur
const GROUPS = [
  ["zone", "Zones d'accès", "Access zones"],
  ["facility", "Piste et aires", "Track & field"],
  ["area", "Zones de stand", "Stand areas"],
  ["mark", "Repères", "Markers"],
  ["door", "Flèches d'entrée", "Entrance arrows"],
  ["line", "Lignes", "Lines"],
  ["ctrl", "Points de contrôle", "Checkpoints"],
];
const KIND_TITLES = {
  zone: ["Zone d'accès", "Access zone"],
  area: ["Zone de stand", "Stand area"],
  mark: ["Repère", "Marker"],
  door: ["Flèche d'entrée", "Entrance arrow"],
  ctrl: ["Point de contrôle", "Checkpoint"],
  facility: ["Aire de la piste", "Track & field area"],
  line: ["Ligne", "Line"],
};
const MAP_LABELS_EN = { web: "Website", vol: "Volunteers", acc: "Accreditations", ctrl: "Checkpoints" };
const MAP_WHO_EN = {
  web: "Public: entrance, stands, toilets (arcades level)",
  vol: "The public map + welcome desks and restricted access",
  acc: "Badge backs: access zones (all levels)",
  ctrl: "Badge check set-up",
};
const LEVELS_EN = { piste: "Track (R-1)", rdc: "Arcades (entrance)", etage: "Gallery (R+1)" };

function formatSavedAt(value) {
  const date = value?.toDate ? value.toDate() : null;
  if (!date) return "";
  return date.toLocaleString("fr-LU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

// Éditeur des plans de la Coque : un seul jeu de repères, coché pour chacun des 4 plans.
// Les modifications restent locales jusqu'à « Enregistrer » (plusieurs personnes peuvent éditer).
export function CoquePlanEditor({ currentUserLabel = "" }) {
  const tr = useTr();
  const plan = useCoquePlan();
  const [elements, setElements] = useState(plan.rawElements);
  const [icons, setIcons] = useState(plan.icons);
  const [dirty, setDirty] = useState(false);
  const [published, setPublished] = useState(plan.published);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [mapKey, setMapKey] = useState("web");
  const [selectedId, setSelectedId] = useState(null);
  const [showGhosts, setShowGhosts] = useState(true);
  const canvasRef = useRef(null);
  const dragRef = useRef(null);
  const handleRef = useRef(null);

  // Tant qu'on n'a rien modifié, on suit la version enregistrée (mises à jour des autres comprises).
  useEffect(() => {
    if (!dirty) {
      setElements(plan.rawElements);
      setIcons(plan.icons);
      setPublished(plan.published);
    }
  }, [plan.rawElements, plan.icons, plan.published, dirty]);

  // Repères avec l'image de leur icône perso, pour l'affichage
  const shownElements = useMemo(() => attachPlanIcons(elements, icons), [elements, icons]);
  const selected = shownElements.find((el) => el.id === selectedId) || null;
  const currentMap = PLAN_MAPS.find((m) => m.key === mapKey);
  const mapLabel = (m) => tr(m.label, MAP_LABELS_EN[m.key]);

  function change(updater) {
    setElements((current) => updater(current));
    setDirty(true);
    setMessage("");
  }
  const patch = (id, values) => change((list) => list.map((el) => (el.id === id ? { ...el, ...values } : el)));
  const toggleMap = (id, key) =>
    change((list) => list.map((el) => (el.id === id ? { ...el, maps: { ...el.maps, [key]: !el.maps[key] } } : el)));
  function changeIcons(updater) {
    setIcons((current) => updater(current));
    setDirty(true);
    setMessage("");
  }

  function addElement(kind) {
    const id = `${kind}-${Date.now().toString(36)}`;
    const maps = Object.fromEntries(PLAN_MAPS.map((m) => [m.key, m.key === mapKey]));
    const base = { id, kind, x: 50, y: 45, level: "rdc", desc: "", maps };
    const extra = kind === "line"
      ? { label: tr("Barrière", "Barrier"), color: "#4a5d6c", style: "barrier", dx: 60, dy: 0 }
      : kind === "area"
      ? { label: tr("Nouveau stand", "New stand"), color: PLAN_PALETTE[2], w: 140, h: 90 }
      : kind === "door"
        ? { label: tr("Entrée", "Entrance"), color: "#4a5d6c", angle: 0 }
        : { label: tr("Nouveau repère", "New marker"), color: PLAN_PALETTE[2], icon: "", rot: 0 };
    change((list) => [...list, { ...base, ...extra }]);
    setSelectedId(id);
  }

  async function save() {
    setSaving(true);
    try {
      // Les icônes perso que plus aucun repère n'utilise restent dans la bibliothèque (réutilisables)
      await saveCoquePlan(elements, currentUserLabel, published, icons);
      setDirty(false);
      setMessage(tr("Plan enregistré.", "Map saved."));
    } catch (error) {
      setMessage(
        error?.code === "permission-denied"
          ? tr("Enregistrement refusé : seuls les admins et gestionnaires peuvent modifier le plan.", "Save refused: only admins and managers can edit the map.")
          : `${tr("Enregistrement impossible", "Could not save")} : ${error?.message || error}`,
      );
    } finally {
      setSaving(false);
    }
  }

  function cancel() {
    setElements(plan.rawElements);
    setIcons(plan.icons);
    setPublished(plan.published);
    setDirty(false);
    setMessage(tr("Modifications annulées.", "Changes discarded."));
  }

  function resetToDefault() {
    if (!window.confirm(tr(
      "Remettre tous les repères du plan de départ ? Les repères ajoutés ou déplacés seront perdus (après Enregistrer).",
      "Put back all the starting markers? Added or moved markers will be lost (after Save).",
    ))) return;
    change(() => normalizePlanElements(PLAN_DEFAULT_ELEMENTS));
    setSelectedId(null);
  }

  // Glisser-déposer : position en % du plan
  function onElementPointerDown(event, el) {
    event.preventDefault();
    setSelectedId(el.id);
    dragRef.current = { id: el.id, node: event.currentTarget, moved: false };
    event.currentTarget.classList.add("is-dragging");
    canvasRef.current?.setPointerCapture?.(event.pointerId);
  }
  // Extrémités d'une ligne : l'autre bout ne bouge pas
  function onHandlePointerDown(event, el, sign) {
    event.preventDefault();
    event.stopPropagation();
    const X = (el.x / 100) * PLAN_W;
    const Y = (el.y / 100) * PLAN_H;
    handleRef.current = { id: el.id, ox: X - sign * el.dx, oy: Y - sign * el.dy, sign };
    canvasRef.current?.setPointerCapture?.(event.pointerId);
  }
  function onPointerMove(event) {
    const handle = handleRef.current;
    if (handle && canvasRef.current) {
      const rect = canvasRef.current.getBoundingClientRect();
      const px = Math.min(PLAN_W, Math.max(0, ((event.clientX - rect.left) / rect.width) * PLAN_W));
      const py = Math.min(PLAN_H, Math.max(0, ((event.clientY - rect.top) / rect.height) * PLAN_H));
      const round = (v) => Math.round(v * 10) / 10;
      patch(handle.id, {
        x: round((((px + handle.ox) / 2) / PLAN_W) * 1000) / 10,
        y: round((((py + handle.oy) / 2) / PLAN_H) * 1000) / 10,
        dx: round((handle.sign * (px - handle.ox)) / 2),
        dy: round((handle.sign * (py - handle.oy)) / 2),
      });
      return;
    }
    const drag = dragRef.current;
    if (!drag || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = Math.min(99, Math.max(1, ((event.clientX - rect.left) / rect.width) * 100));
    const y = Math.min(99, Math.max(1, ((event.clientY - rect.top) / rect.height) * 100));
    drag.moved = true;
    drag.x = Math.round(x * 100) / 100;
    drag.y = Math.round(y * 100) / 100;
    drag.node.style.left = `${drag.x}%`;
    drag.node.style.top = `${drag.y}%`;
  }
  function onPointerUp() {
    handleRef.current = null;
    const drag = dragRef.current;
    if (!drag) return;
    drag.node.classList.remove("is-dragging");
    dragRef.current = null;
    if (drag.moved) patch(drag.id, { x: drag.x, y: drag.y });
  }

  const savedAt = formatSavedAt(plan.updatedAt);
  const savedNote = plan.saved
    ? `${tr("Enregistré", "Saved")}${savedAt ? ` ${tr("le", "on")} ${savedAt}` : ""}${plan.updatedBy ? ` ${tr("par", "by")} ${plan.updatedBy}` : ""}`
    : tr("Plan de départ (pas encore enregistré)", "Starting map (not saved yet)");

  return (
    <div className="coque-plan-editor">
      <div className="cpe-bar">
        <div className="cpe-maps" role="tablist" aria-label={tr("Plan affiché", "Map shown")}>
          {PLAN_MAPS.map((m) => (
            <button key={m.key} type="button" className={m.key === mapKey ? "is-on" : ""} onClick={() => setMapKey(m.key)}>
              <b>{m.short}</b>{mapLabel(m)}
            </button>
          ))}
        </div>
        <label className="cpe-publish" title={tr("Le plan « Site internet » s'affiche sur la page The Event du site", "The Website map shows on the site's The Event page")}>
          <input type="checkbox" checked={published} onChange={(event) => { setPublished(event.target.checked); setDirty(true); setMessage(""); }} />
          {tr("Publié sur le site", "Published on the site")}
        </label>
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
          <h3>{tr("Éléments du plan", "Map items")}</h3>
          {GROUPS.map(([kind, fr, en]) => {
            const rows = shownElements.filter((el) => el.kind === kind);
            if (!rows.length && kind !== "mark") return null;
            return (
              <div key={kind}>
                <div className="cpe-group">
                  <span>{tr(fr, en)}</span>
                  {PLAN_MAPS.map((m) => <b key={m.key} title={mapLabel(m)}>{m.short}</b>)}
                </div>
                {rows.map((el) => (
                  <div key={el.id} className={`cpe-row ${el.id === selectedId ? "is-selected" : ""}`} onClick={() => setSelectedId(el.id)}>
                    {planHasIcon(el) ? (
                      <span className="cpe-chip" style={{ background: planPictoBg(el, planColorOf(el)) }} dangerouslySetInnerHTML={{ __html: planIconHtml(el) }} />
                    ) : (
                      <span
                        className={`cpe-chip ${kind === "ctrl" || kind === "facility" ? "is-square" : ""} ${kind === "line" ? "is-line" : ""}`}
                        style={{ background: kind === "facility" ? "#8db4de" : planColorOf(el) }}
                      >
                        {kind === "zone" ? el.num : kind === "ctrl" ? el.label : kind === "door" ? "➜" : ""}
                      </span>
                    )}
                    <span className="cpe-row__name">
                      {kind === "ctrl" ? `${tr("Contrôle", "Check")} ${el.label}` : kind === "facility" ? tr(PLAN_FACILITIES[el.facility].label, PLAN_FACILITIES[el.facility].en) : el.label}
                      {el.level !== "rdc" ? <span className="cpe-level">{el.level === "etage" ? "R+1" : "R-1"}</span> : null}
                    </span>
                    {PLAN_MAPS.map((m) => (
                      <button
                        key={m.key}
                        type="button"
                        className={`cpe-vis ${el.maps[m.key] ? "is-on" : ""} ${m.key === mapKey ? "is-current" : ""}`}
                        title={el.maps[m.key] ? tr(`Retirer du plan ${m.label}`, `Remove from the ${MAP_LABELS_EN[m.key]} map`) : tr(`Ajouter au plan ${m.label}`, `Add to the ${MAP_LABELS_EN[m.key]} map`)}
                        onClick={(event) => { event.stopPropagation(); toggleMap(el.id, m.key); }}
                      >
                        {m.short}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            );
          })}
          <div className="cpe-adds">
            <button type="button" className="cpe-btn" onClick={() => addElement("mark")}>+ {tr("Repère", "Marker")}</button>
            <button type="button" className="cpe-btn" onClick={() => addElement("area")}>+ {tr("Zone de stand", "Stand area")}</button>
            <button type="button" className="cpe-btn" onClick={() => addElement("door")}>+ {tr("Flèche d'entrée", "Entrance arrow")}</button>
            <button type="button" className="cpe-btn" onClick={() => addElement("line")}>+ {tr("Ligne (barrière, séparation)", "Line (barrier, separation)")}</button>
            <button type="button" className="cpe-btn cpe-btn--danger" onClick={resetToDefault}>{tr("Revenir au plan de départ", "Back to the starting map")}</button>
          </div>
        </aside>

        <section className="cpe-stage">
          <div className="cpe-stage__bar">
            <span><b>{mapLabel(currentMap)}</b> · {tr(currentMap.who, MAP_WHO_EN[currentMap.key])}</span>
            <label><input type="checkbox" checked={showGhosts} onChange={(event) => setShowGhosts(event.target.checked)} /> {tr("Montrer le reste en transparence", "Show the rest faded")}</label>
          </div>
          <div className="cpe-canvas" onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
            <PlanCanvas
              ref={canvasRef}
              elements={showGhosts ? shownElements : shownElements.filter((el) => el.maps[mapKey])}
              isGhost={(el) => !el.maps[mapKey]}
              selectedId={selectedId}
              onElementPointerDown={onElementPointerDown}
            >
              {selected?.kind === "line"
                ? [-1, 1].map((sign) => (
                    <span
                      key={sign}
                      className="cpe-handle"
                      title={tr("Tirer pour allonger ou tourner la ligne", "Drag to lengthen or turn the line")}
                      style={{
                        left: `${(((selected.x / 100) * PLAN_W + sign * selected.dx) / PLAN_W) * 100}%`,
                        top: `${(((selected.y / 100) * PLAN_H + sign * selected.dy) / PLAN_H) * 100}%`,
                      }}
                      onPointerDown={(event) => onHandlePointerDown(event, selected, sign)}
                    />
                  ))
                : null}
            </PlanCanvas>
          </div>
          <div className="cpe-legend">
            <PlanLegend elements={shownElements} mapKey={mapKey} />
          </div>
        </section>

        <aside className="cpe-panel cpe-detail">
          {selected ? (
            <ElementDetail
              el={selected}
              icons={icons}
              onPatch={(values) => patch(selected.id, values)}
              onToggleMap={(key) => toggleMap(selected.id, key)}
              onAddIcon={(icon) => { changeIcons((list) => [...list, icon]); patch(selected.id, { icon: `${CUSTOM_ICON_PREFIX}${icon.id}` }); }}
              onPatchIcon={(id, values) => changeIcons((list) => list.map((icon) => (icon.id === id ? { ...icon, ...values } : icon)))}
              onDeleteIcon={(id) => {
                const key = `${CUSTOM_ICON_PREFIX}${id}`;
                const used = elements.filter((el) => el.icon === key).length;
                if (!window.confirm(tr(
                  `Supprimer cette icône de la bibliothèque ?${used ? ` Les ${used} repère(s) qui l'utilisent repasseront en étiquette de texte.` : ""}`,
                  `Delete this icon from the library?${used ? ` The ${used} marker(s) using it go back to a text label.` : ""}`,
                ))) return;
                changeIcons((list) => list.filter((icon) => icon.id !== id));
                change((list) => list.map((el) => (el.icon === key ? { ...el, icon: "" } : el)));
              }}
              onDelete={() => {
                if (!window.confirm(tr(`Supprimer « ${selected.label} » du plan ?`, `Delete "${selected.label}" from the map?`))) return;
                change((list) => list.filter((el) => el.id !== selected.id));
                setSelectedId(null);
              }}
            />
          ) : (
            <>
              <h3>{tr("Élément", "Item")}</h3>
              <p className="cpe-empty">{tr(
                "Clique sur un repère du plan ou de la liste pour le modifier. Fais-le glisser sur le plan pour le déplacer.",
                "Click a marker on the map or in the list to edit it. Drag it on the map to move it.",
              )}</p>
              <details className="cpe-help" style={{ marginTop: 10 }}>
                <summary>{tr("Comment ça marche", "How it works")}</summary>
                <p>{tr(
                  "Un seul plan sert aux 4 usages : site internet (S), bénévoles (B), verso des badges (A) et points de contrôle (C). Les cases de la liste disent sur quel plan chaque repère apparaît.",
                  "One map serves 4 uses: website (S), volunteers (B), badge backs (A) and checkpoints (C). The boxes in the list say on which map each marker appears.",
                )}</p>
                <p>{tr(
                  "Un plan = un niveau : on montre le niveau des arcades (l'entrée). Seul le verso des badges réunit les zones de tous les niveaux.",
                  "One map = one level: we show the arcades level (the entrance). Only the badge backs bring together the zones of every level.",
                )}</p>
                <p>{tr("Sur le plan, un ou deux mots ou une icône ; le détail va dans la légende.", "On the map, one or two words or an icon; the detail goes in the legend.")}</p>
              </details>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}

// Affichage d'un repère : étiquette de texte, icône de la bibliothèque ou icône perso (+ ajout).
function IconPicker({ el, icons, onPatch, onAddIcon, onPatchIcon, onDeleteIcon }) {
  const tr = useTr();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);
  const color = planColorOf(el);
  const current = icons.find((icon) => `${CUSTOM_ICON_PREFIX}${icon.id}` === el.icon) || null;

  async function onFile(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError("");
    setBusy(true);
    try {
      onAddIcon(await processIconFile(file));
    } catch (err) {
      setError(
        err?.message === "size"
          ? tr("Fichier trop lourd (2 Mo max).", "File too large (2 MB max).")
          : err?.message === "type"
            ? tr("Format accepté : SVG, PNG, JPG ou WebP.", "Accepted formats: SVG, PNG, JPG or WebP.")
            : tr("Image illisible.", "Could not read the image."),
      );
    } finally {
      setBusy(false);
    }
  }

  const option = (key, title, content, bg = color, extra = "") => (
    <button
      key={key}
      type="button"
      className={`cpe-icon ${el.icon === key ? "is-on" : ""} ${extra}`}
      title={title}
      aria-label={title}
      aria-pressed={el.icon === key}
      onClick={() => onPatch({ icon: key })}
    >
      <span style={{ background: bg }} dangerouslySetInnerHTML={typeof content === "string" ? { __html: content } : undefined}>
        {typeof content === "string" ? undefined : content}
      </span>
    </button>
  );

  return (
    <div className="cpe-field">
      <span>{tr("Affichage", "Display")} <small>{tr("une icône prend moins de place", "an icon takes less room")}</small></span>
      <div className="cpe-icons">
        {option("", tr("Étiquette de texte", "Text label"), "Aa", "#fff", "is-text")}
        {Object.entries(PLAN_ICONS).map(([key, icon]) => option(key, tr(icon.label, icon.en), planIconSvg(key)))}
        {icons.map((icon) => {
          const key = `${CUSTOM_ICON_PREFIX}${icon.id}`;
          const fake = { icon: key, iconImg: { src: icon.mono ? icon.srcMono || icon.src : icon.src, mono: icon.mono && Boolean(icon.srcMono) } };
          return option(key, tr(icon.label, icon.labelEn || icon.label), planIconHtml(fake), planPictoBg(fake, color), "is-custom");
        })}
        <button
          type="button"
          className="cpe-icon is-add"
          title={tr("Ajouter une icône (SVG, PNG, JPG)", "Add an icon (SVG, PNG, JPG)")}
          aria-label={tr("Ajouter une icône", "Add an icon")}
          disabled={busy}
          onClick={() => fileRef.current?.click()}
        >
          <span>+</span>
        </button>
        <input ref={fileRef} type="file" accept={ICON_FILE_TYPES} hidden onChange={onFile} />
      </div>
      <em className="cpe-icons__name">
        {el.icon === "" ? tr("Étiquette de texte", "Text label") : PLAN_ICONS[el.icon] ? tr(PLAN_ICONS[el.icon].label, PLAN_ICONS[el.icon].en) : current ? tr("Mon icône", "My icon") : ""}
      </em>
      {el.icon ? (
        <div className="cpe-seg cpe-seg--inline" role="group" aria-label={tr("Icône seule ou avec texte", "Icon alone or with text")}>
          <button type="button" className={!el.showText ? "is-on" : ""} onClick={() => onPatch({ showText: false })}>{tr("Icône seule", "Icon only")}</button>
          <button type="button" className={el.showText ? "is-on" : ""} onClick={() => onPatch({ showText: true })}>{tr("Icône + texte", "Icon + text")}</button>
        </div>
      ) : null}
      {error ? <em className="cpe-error">{error}</em> : null}
      {current ? (
        <div className="cpe-custom">
          <input
            type="text"
            value={current.label}
            maxLength={30}
            placeholder={tr("Nom de l'icône", "Icon name")}
            aria-label={tr("Nom de l'icône", "Icon name")}
            onChange={(event) => onPatchIcon(current.id, { label: event.target.value })}
          />
          <label title={tr("Silhouette blanche sur la couleur du repère, comme les autres icônes", "White silhouette on the marker colour, like the other icons")}>
            <input type="checkbox" checked={current.mono} disabled={!current.srcMono} onChange={(event) => onPatchIcon(current.id, { mono: event.target.checked })} />
            {tr("En blanc", "White")}
          </label>
          <button type="button" className="cpe-link cpe-link--danger" onClick={() => onDeleteIcon(current.id)}>{tr("Retirer de la bibliothèque", "Remove from library")}</button>
        </div>
      ) : null}
    </div>
  );
}

// Rotation d'une étiquette de texte : curseur, valeur exacte, raccourcis.
export function RotationField({ value, onChange }) {
  const tr = useTr();
  const set = (next) => onChange(Math.max(-180, Math.min(180, Math.round(Number(next) || 0))));
  return (
    <div className="cpe-field">
      <span>{tr("Rotation", "Rotation")} <small>{tr("degrés, sens des aiguilles d'une montre", "degrees, clockwise")}</small></span>
      <div className="cpe-rotate">
        <input type="range" min={-90} max={90} step={5} value={Math.max(-90, Math.min(90, value))} onChange={(event) => set(event.target.value)} aria-label={tr("Rotation", "Rotation")} />
        <input type="number" min={-180} max={180} value={value} onChange={(event) => set(event.target.value)} aria-label={tr("Rotation en degrés", "Rotation in degrees")} />
        <div className="cpe-seg">
          {[-90, -45, 0, 45, 90].map((deg) => (
            <button key={deg} type="button" className={value === deg ? "is-on" : ""} onClick={() => set(deg)}>{deg > 0 ? `+${deg}` : deg}°</button>
          ))}
        </div>
      </div>
    </div>
  );
}

function ElementDetail({ el, icons, onPatch, onToggleMap, onAddIcon, onPatchIcon, onDeleteIcon, onDelete }) {
  const tr = useTr();
  const short = el.kind === "mark" || el.kind === "area" || el.kind === "line";
  // Aire de la piste : dessin fixe, on choisit seulement sur quels plans elle apparaît
  if (el.kind === "facility") {
    const facility = PLAN_FACILITIES[el.facility];
    return (
      <>
        <h3>{tr(...KIND_TITLES.facility)}</h3>
        <p className="cpe-facility-name">{tr(facility.label, facility.en)}</p>
        <div className="cpe-field">
          <span>{tr("Visible sur", "Shown on")}</span>
          <div className="cpe-checks">
            {PLAN_MAPS.map((m) => (
              <label key={m.key}><input type="checkbox" checked={el.maps[m.key]} onChange={() => onToggleMap(m.key)} /> {tr(m.label, MAP_LABELS_EN[m.key])}</label>
            ))}
          </div>
        </div>
        <p className="cpe-empty">{tr("Le plan détaillé de l'infield (juges) viendra dans un onglet à part.", "The detailed infield plan (judges) will come in a separate tab.")}</p>
      </>
    );
  }
  return (
    <>
      <h3>{tr(...KIND_TITLES[el.kind])}</h3>
      {el.kind === "line" ? (
        <label className="cpe-field">
          <span>{tr("Type de ligne", "Line type")} <small>{tr("tirer les carrés bleus sur le plan", "drag the blue squares on the map")}</small></span>
          <select value={el.style} onChange={(event) => onPatch({ style: event.target.value })}>
            {Object.entries(PLAN_LINE_STYLES).map(([key, style]) => <option key={key} value={key}>{tr(style.label, style.en)}</option>)}
          </select>
        </label>
      ) : null}
      {el.kind === "zone" ? (
        <label className="cpe-field">
          <span>{tr("Numéro (badge)", "Number (badge)")}</span>
          <select value={el.num} onChange={(event) => onPatch({ num: Number(event.target.value) })}>
            {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
      ) : null}
      <label className="cpe-field">
        <span>{el.kind === "zone" ? tr("Nom de la zone", "Zone name") : el.kind === "line" ? tr("Nom dans la légende", "Name in the legend") : tr("Texte sur le plan", "Text on the map")} {short ? <small>{tr("1 ou 2 mots", "1 or 2 words")}</small> : null}</span>
        <input type="text" value={el.label} maxLength={short ? 16 : 30} onChange={(event) => onPatch({ label: event.target.value })} />
      </label>
      <label className="cpe-field">
        <span>{el.kind === "ctrl" ? tr("Ce qu'on contrôle ici", "What is checked here") : tr("Légende", "Legend")} <small>{el.kind === "ctrl" ? tr("vide = zones liées dans l'onglet Contrôles", "empty = zones linked in the Checkpoints tab") : tr("le détail, à côté du plan", "the detail, next to the map")}</small></span>
        <textarea value={el.desc} onChange={(event) => onPatch({ desc: event.target.value })} />
      </label>
      {el.kind !== "door" ? (
        <>
          <label className="cpe-field">
            <span>{tr("Texte en anglais", "English text")} <small>{tr("site, badges, roadbook ; vide = texte ci-dessus", "site, badges, roadbook; empty = text above")}</small></span>
            <input type="text" value={el.labelEn || ""} maxLength={short ? 16 : 30} onChange={(event) => onPatch({ labelEn: event.target.value })} />
          </label>
          {el.kind !== "zone" ? (
            <label className="cpe-field">
              <span>{tr("Légende en anglais", "English legend")}</span>
              <textarea value={el.descEn || ""} onChange={(event) => onPatch({ descEn: event.target.value })} />
            </label>
          ) : null}
        </>
      ) : null}
      {el.kind === "mark" ? (
        <IconPicker el={el} icons={icons} onPatch={onPatch} onAddIcon={onAddIcon} onPatchIcon={onPatchIcon} onDeleteIcon={onDeleteIcon} />
      ) : null}
      {planShowsText(el) ? <RotationField value={el.rot || 0} onChange={(rot) => onPatch({ rot })} /> : null}
      {el.kind === "area" && !el.shape ? (
        <div className="cpe-field">
          <span>{tr("Taille", "Size")} <small>{tr("unités du plan (la piste fait ~380 de large)", "map units (the track is ~380 wide)")}</small></span>
          <div className="cpe-inline">
            <input type="number" value={el.w} onChange={(event) => onPatch({ w: Number(event.target.value) || 20 })} /> ×
            <input type="number" value={el.h} onChange={(event) => onPatch({ h: Number(event.target.value) || 20 })} />
          </div>
        </div>
      ) : null}
      {el.kind === "door" ? (
        <label className="cpe-field">
          <span>{tr("Direction", "Direction")} <small>{tr("0 droite · 90 bas · 180 gauche · 270 haut", "0 right · 90 down · 180 left · 270 up")}</small></span>
          <input type="number" value={el.angle} onChange={(event) => onPatch({ angle: Number(event.target.value) || 0 })} />
        </label>
      ) : null}
      <label className="cpe-field">
        <span>{tr("Niveau", "Level")}</span>
        <select value={el.level} onChange={(event) => onPatch({ level: event.target.value })}>
          {Object.entries(PLAN_LEVELS).map(([key, label]) => <option key={key} value={key}>{tr(label, LEVELS_EN[key])}</option>)}
        </select>
      </label>
      {el.kind !== "zone" ? (
        <div className="cpe-field">
          <span>{tr("Couleur", "Colour")}</span>
          <div className="cpe-colors">
            {PLAN_PALETTE.map((color) => (
              <button key={color} type="button" className={color === el.color ? "is-on" : ""} style={{ background: color }} aria-label={color} onClick={() => onPatch({ color })} />
            ))}
          </div>
        </div>
      ) : null}
      <div className="cpe-field">
        <span>{tr("Visible sur", "Shown on")}</span>
        <div className="cpe-checks">
          {PLAN_MAPS.map((m) => (
            <label key={m.key}><input type="checkbox" checked={el.maps[m.key]} onChange={() => onToggleMap(m.key)} /> {tr(m.label, MAP_LABELS_EN[m.key])}</label>
          ))}
        </div>
      </div>
      <button type="button" className="cpe-btn cpe-btn--danger" onClick={onDelete}>{tr("Supprimer cet élément", "Delete this item")}</button>
    </>
  );
}
