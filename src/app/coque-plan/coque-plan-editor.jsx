import { useEffect, useRef, useState } from "react";
import {
  normalizePlanElements,
  PLAN_DEFAULT_ELEMENTS,
  PLAN_ICONS,
  PLAN_LEVELS,
  PLAN_MAPS,
  PLAN_PALETTE,
  planColorOf,
  planIconSvg,
} from "./coque-plan-data";
import { saveCoquePlan, useCoquePlan } from "./coque-plan-hooks";
import { PlanCanvas, PlanLegend } from "./coque-plan-view";

const GROUPS = [
  ["zone", "Zones d'accès"],
  ["area", "Zones de stand"],
  ["mark", "Repères"],
  ["door", "Flèches d'entrée"],
  ["ctrl", "Points de contrôle"],
];
const KIND_TITLES = { zone: "Zone d'accès", area: "Zone de stand", mark: "Repère", door: "Flèche d'entrée", ctrl: "Point de contrôle" };

function formatSavedAt(value) {
  const date = value?.toDate ? value.toDate() : null;
  if (!date) return "";
  return date.toLocaleString("fr-LU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

// Éditeur des plans de la Coque : un seul jeu de repères, coché pour chacun des 4 plans.
// Les modifications restent locales jusqu'à « Enregistrer » (plusieurs personnes peuvent éditer).
export function CoquePlanEditor({ currentUserLabel = "" }) {
  const plan = useCoquePlan();
  const [elements, setElements] = useState(plan.elements);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [mapKey, setMapKey] = useState("web");
  const [selectedId, setSelectedId] = useState(null);
  const [showGhosts, setShowGhosts] = useState(true);
  const canvasRef = useRef(null);
  const dragRef = useRef(null);

  // Tant qu'on n'a rien modifié, on suit la version enregistrée (mises à jour des autres comprises).
  useEffect(() => {
    if (!dirty) setElements(plan.elements);
  }, [plan.elements, dirty]);

  const selected = elements.find((el) => el.id === selectedId) || null;
  const currentMap = PLAN_MAPS.find((m) => m.key === mapKey);

  function change(updater) {
    setElements((current) => updater(current));
    setDirty(true);
    setMessage("");
  }
  const patch = (id, values) => change((list) => list.map((el) => (el.id === id ? { ...el, ...values } : el)));
  const toggleMap = (id, key) =>
    change((list) => list.map((el) => (el.id === id ? { ...el, maps: { ...el.maps, [key]: !el.maps[key] } } : el)));

  function addElement(kind) {
    const id = `${kind}-${Date.now().toString(36)}`;
    const maps = Object.fromEntries(PLAN_MAPS.map((m) => [m.key, m.key === mapKey]));
    const base = { id, kind, x: 50, y: 45, level: "rdc", desc: "", maps };
    const extra = kind === "area"
      ? { label: "Nouveau stand", color: PLAN_PALETTE[2], w: 140, h: 90 }
      : kind === "door"
        ? { label: "Entrée", color: "#4a5d6c", angle: 0 }
        : { label: "Nouveau repère", color: PLAN_PALETTE[2], icon: "" };
    change((list) => [...list, { ...base, ...extra }]);
    setSelectedId(id);
  }

  async function save() {
    setSaving(true);
    try {
      await saveCoquePlan(elements, currentUserLabel);
      setDirty(false);
      setMessage("Plan enregistré.");
    } catch (error) {
      setMessage(
        error?.code === "permission-denied"
          ? "Enregistrement refusé : seuls les admins et gestionnaires peuvent modifier le plan."
          : `Enregistrement impossible : ${error?.message || error}`,
      );
    } finally {
      setSaving(false);
    }
  }

  function cancel() {
    setElements(plan.elements);
    setDirty(false);
    setMessage("Modifications annulées.");
  }

  function resetToDefault() {
    if (!window.confirm("Remettre tous les repères du plan de départ ? Les repères ajoutés ou déplacés seront perdus (après Enregistrer).")) return;
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
  function onPointerMove(event) {
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
    const drag = dragRef.current;
    if (!drag) return;
    drag.node.classList.remove("is-dragging");
    dragRef.current = null;
    if (drag.moved) patch(drag.id, { x: drag.x, y: drag.y });
  }

  const savedAt = formatSavedAt(plan.updatedAt);

  return (
    <div className="coque-plan-editor">
      <div className="cpe-bar">
        <div className="cpe-maps" role="tablist" aria-label="Plan affiché">
          {PLAN_MAPS.map((m) => (
            <button key={m.key} type="button" className={m.key === mapKey ? "is-on" : ""} onClick={() => setMapKey(m.key)}>
              <b>{m.short}</b>{m.label}
            </button>
          ))}
        </div>
        <div className={`cpe-status ${dirty ? "is-dirty" : ""}`}>
          {plan.loading ? "Chargement…" : dirty ? message || "Modifications non enregistrées" : message || (plan.saved ? `Enregistré${savedAt ? ` le ${savedAt}` : ""}${plan.updatedBy ? ` par ${plan.updatedBy}` : ""}` : "Plan de départ (pas encore enregistré)")}
          {dirty ? <button type="button" className="cpe-btn" onClick={cancel} disabled={saving}>Annuler</button> : null}
          <button type="button" className="cpe-btn cpe-btn--primary" onClick={save} disabled={saving || (!dirty && plan.saved)}>
            {saving ? "Enregistrement…" : "Enregistrer"}
          </button>
        </div>
      </div>
      {plan.error ? <p className="panel-note">{plan.error}</p> : null}

      <div className="cpe-layout">
        <aside className="cpe-panel">
          <h3>Éléments du plan</h3>
          {GROUPS.map(([kind, title]) => {
            const rows = elements.filter((el) => el.kind === kind);
            if (!rows.length && kind !== "mark") return null;
            return (
              <div key={kind}>
                <div className="cpe-group">
                  <span>{title}</span>
                  {PLAN_MAPS.map((m) => <b key={m.key} title={m.label}>{m.short}</b>)}
                </div>
                {rows.map((el) => (
                  <div key={el.id} className={`cpe-row ${el.id === selectedId ? "is-selected" : ""}`} onClick={() => setSelectedId(el.id)}>
                    {PLAN_ICONS[el.icon] ? (
                      <span className="cpe-chip" style={{ background: planColorOf(el) }} dangerouslySetInnerHTML={{ __html: planIconSvg(el.icon) }} />
                    ) : (
                      <span className={`cpe-chip ${kind === "ctrl" ? "is-square" : ""}`} style={{ background: planColorOf(el) }}>
                        {kind === "zone" ? el.num : kind === "ctrl" ? el.label : kind === "door" ? "➜" : ""}
                      </span>
                    )}
                    <span className="cpe-row__name">
                      {kind === "ctrl" ? `Contrôle ${el.label}` : el.label}
                      {el.level !== "rdc" ? <span className="cpe-level">{el.level === "etage" ? "R+1" : "R-1"}</span> : null}
                    </span>
                    {PLAN_MAPS.map((m) => (
                      <button
                        key={m.key}
                        type="button"
                        className={`cpe-vis ${el.maps[m.key] ? "is-on" : ""} ${m.key === mapKey ? "is-current" : ""}`}
                        title={`${el.maps[m.key] ? "Retirer du" : "Ajouter au"} plan ${m.label}`}
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
            <button type="button" className="cpe-btn" onClick={() => addElement("mark")}>+ Repère</button>
            <button type="button" className="cpe-btn" onClick={() => addElement("area")}>+ Zone de stand</button>
            <button type="button" className="cpe-btn" onClick={() => addElement("door")}>+ Flèche d&apos;entrée</button>
            <button type="button" className="cpe-btn cpe-btn--danger" onClick={resetToDefault}>Revenir au plan de départ</button>
          </div>
        </aside>

        <section className="cpe-stage">
          <div className="cpe-stage__bar">
            <span><b>{currentMap.label}</b> · {currentMap.who}</span>
            <label><input type="checkbox" checked={showGhosts} onChange={(event) => setShowGhosts(event.target.checked)} /> Montrer le reste en transparence</label>
          </div>
          <div className="cpe-canvas" onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
            <PlanCanvas
              ref={canvasRef}
              elements={showGhosts ? elements : elements.filter((el) => el.maps[mapKey])}
              isGhost={(el) => !el.maps[mapKey]}
              selectedId={selectedId}
              onElementPointerDown={onElementPointerDown}
            />
          </div>
          <div className="cpe-legend">
            <PlanLegend elements={elements} mapKey={mapKey} />
          </div>
        </section>

        <aside className="cpe-panel cpe-detail">
          {selected ? (
            <ElementDetail
              el={selected}
              onPatch={(values) => patch(selected.id, values)}
              onToggleMap={(key) => toggleMap(selected.id, key)}
              onDelete={() => {
                if (!window.confirm(`Supprimer « ${selected.label} » du plan ?`)) return;
                change((list) => list.filter((el) => el.id !== selected.id));
                setSelectedId(null);
              }}
            />
          ) : (
            <>
              <h3>Élément</h3>
              <p className="cpe-empty">Clique sur un repère du plan ou de la liste pour le modifier. Fais-le glisser sur le plan pour le déplacer.</p>
              <details className="cpe-help" style={{ marginTop: 10 }}>
                <summary>Comment ça marche</summary>
                <p>Un seul plan sert aux 4 usages : site internet (S), bénévoles (B), verso des badges (A) et points de contrôle (C). Les cases de la liste disent sur quel plan chaque repère apparaît.</p>
                <p>Un plan = un niveau : on montre le niveau des arcades (l&apos;entrée). Seul le verso des badges réunit les zones de tous les niveaux.</p>
                <p>Sur le plan, un ou deux mots ou une icône ; le détail va dans la légende.</p>
              </details>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}

function ElementDetail({ el, onPatch, onToggleMap, onDelete }) {
  const short = el.kind === "mark" || el.kind === "area";
  return (
    <>
      <h3>{KIND_TITLES[el.kind]}</h3>
      {el.kind === "zone" ? (
        <label className="cpe-field">
          <span>Numéro (badge)</span>
          <select value={el.num} onChange={(event) => onPatch({ num: Number(event.target.value) })}>
            {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
      ) : null}
      <label className="cpe-field">
        <span>{el.kind === "zone" ? "Nom de la zone" : "Texte sur le plan"} {short ? <small>1 ou 2 mots</small> : null}</span>
        <input type="text" value={el.label} maxLength={short ? 16 : 30} onChange={(event) => onPatch({ label: event.target.value })} />
      </label>
      <label className="cpe-field">
        <span>{el.kind === "ctrl" ? "Ce qu'on contrôle ici" : "Légende"} <small>{el.kind === "ctrl" ? "ex. accès Infield et Warm-up" : "le détail, à côté du plan"}</small></span>
        <textarea value={el.desc} onChange={(event) => onPatch({ desc: event.target.value })} />
      </label>
      {el.kind === "mark" ? (
        <label className="cpe-field">
          <span>Affichage <small>une icône prend moins de place</small></span>
          <select value={el.icon || ""} onChange={(event) => onPatch({ icon: event.target.value })}>
            <option value="">Étiquette de texte</option>
            {Object.entries(PLAN_ICONS).map(([key, icon]) => <option key={key} value={key}>Icône : {icon.label}</option>)}
          </select>
        </label>
      ) : null}
      {el.kind === "area" && !el.shape ? (
        <div className="cpe-field">
          <span>Taille <small>unités du plan (la piste fait ~380 de large)</small></span>
          <div className="cpe-inline">
            <input type="number" value={el.w} onChange={(event) => onPatch({ w: Number(event.target.value) || 20 })} /> ×
            <input type="number" value={el.h} onChange={(event) => onPatch({ h: Number(event.target.value) || 20 })} />
          </div>
        </div>
      ) : null}
      {el.kind === "door" ? (
        <label className="cpe-field">
          <span>Direction <small>0 droite · 90 bas · 180 gauche · 270 haut</small></span>
          <input type="number" value={el.angle} onChange={(event) => onPatch({ angle: Number(event.target.value) || 0 })} />
        </label>
      ) : null}
      <label className="cpe-field">
        <span>Niveau</span>
        <select value={el.level} onChange={(event) => onPatch({ level: event.target.value })}>
          {Object.entries(PLAN_LEVELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
      </label>
      {el.kind !== "zone" ? (
        <div className="cpe-field">
          <span>Couleur</span>
          <div className="cpe-colors">
            {PLAN_PALETTE.map((color) => (
              <button key={color} type="button" className={color === el.color ? "is-on" : ""} style={{ background: color }} aria-label={color} onClick={() => onPatch({ color })} />
            ))}
          </div>
        </div>
      ) : null}
      <div className="cpe-field">
        <span>Visible sur</span>
        <div className="cpe-checks">
          {PLAN_MAPS.map((m) => (
            <label key={m.key}><input type="checkbox" checked={el.maps[m.key]} onChange={() => onToggleMap(m.key)} /> {m.label}</label>
          ))}
        </div>
      </div>
      <button type="button" className="cpe-btn cpe-btn--danger" onClick={onDelete}>Supprimer cet élément</button>
    </>
  );
}
