import { useEffect, useMemo, useRef, useState } from "react";
import { useTr } from "../use-tr";
import { useLanguage } from "../language-context";
import { PLAN_ICONS, PLAN_LINE_STYLES, PLAN_PALETTE, planIconSvg } from "./coque-plan-data";
import { JUDGES_BOX, JUDGES_FACILITIES, jAreaSize, jPoint, jText, jTransform, judgesPlanSvg, teamColor } from "./coque-judges-plan-data";
import { judgesPlanDefaults, saveJudgesPlan, useJudgesPlan } from "./coque-judges-plan-hooks";
import { judgesPlanPrintHtml } from "./coque-judges-plan-print";
import { RotationField } from "./coque-plan-editor";
import { PlanMarker } from "./coque-plan-view";
import "./coque-plan.css";
import "./coque-judges-plan.css";

const KIND_TITLES = {
  judge: ["Juge", "Judge"],
  mark: ["Repère", "Marker"],
  area: ["Zone", "Area"],
  door: ["Flèche d'entrée", "Entrance arrow"],
  line: ["Ligne", "Line"],
};

function formatSavedAt(value) {
  const date = value?.toDate ? value.toDate() : null;
  if (!date) return "";
  return date.toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

// Plan de l'infield pour les juges : positions des juges par équipe et repères autour de la piste.
// Comme les plans de la Coque, les modifications restent locales jusqu'à « Enregistrer ».
export function JudgesPlanEditor({ currentUserLabel = "" }) {
  const tr = useTr();
  const { language } = useLanguage();
  const lang = language === "fr" ? "fr" : "en";
  const plan = useJudgesPlan();
  const [elements, setElements] = useState(plan.elements);
  const [teams, setTeams] = useState(plan.teams);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [selected, setSelected] = useState(null); // { type: "el" | "team", id }
  // Bâtiment de la salle des juges (plan d'architecte) : tracé chargé à part
  const [details, setDetails] = useState("");
  useEffect(() => {
    let alive = true;
    import("./coque-plan-details").then((mod) => alive && setDetails(mod.PLAN_DETAILS)).catch(() => {});
    return () => { alive = false; };
  }, []);
  const canvasRef = useRef(null);
  const dragRef = useRef(null);
  const handleRef = useRef(null);

  useEffect(() => {
    if (!dirty) {
      setElements(plan.elements);
      setTeams(plan.teams);
    }
  }, [plan.elements, plan.teams, dirty]);

  const selectedEl = selected?.type === "el" ? elements.find((el) => el.id === selected.id) || null : null;
  const selectedTeam = selected?.type === "team" ? teams.find((t) => t.id === selected.id) || null : null;
  // Équipe mise en avant : celle choisie, ou celle du juge choisi ; les autres juges passent en transparence
  const focusTeam = selectedTeam?.id || (selectedEl?.kind === "judge" ? selectedEl.team : null);

  function markDirty() {
    setDirty(true);
    setMessage("");
  }
  function change(updater) {
    setElements((current) => updater(current));
    markDirty();
  }
  function changeTeams(updater) {
    setTeams((current) => updater(current));
    markDirty();
  }
  const patch = (id, values) => change((list) => list.map((el) => (el.id === id ? { ...el, ...values } : el)));
  const patchTeam = (id, values) => changeTeams((list) => list.map((t) => (t.id === id ? { ...t, ...values } : t)));
  const newId = (prefix) => `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

  function addJudge(teamId) {
    const mates = elements.filter((el) => el.kind === "judge" && el.team === teamId);
    const last = mates[mates.length - 1];
    const used = new Set(mates.map((el) => el.label));
    let n = 1;
    while (used.has(String(n))) n += 1;
    const id = newId("j");
    change((list) => [...list, {
      id, kind: "judge", team: teamId, label: String(n), labelEn: "", desc: "", descEn: "",
      x: last ? Math.min(97, last.x + 3) : 50, y: last ? last.y : 50,
    }]);
    setSelected({ type: "el", id });
  }
  function addTeam() {
    const id = newId("team");
    changeTeams((list) => [...list, { id, label: tr("Nouvelle équipe", "New team"), labelEn: "", color: PLAN_PALETTE[list.length % PLAN_PALETTE.length] }]);
    setSelected({ type: "team", id });
  }
  function addElement(kind) {
    const id = newId(kind);
    const base = { id, kind, x: 50, y: 50, desc: "", descEn: "", labelEn: "" };
    const extra = kind === "line"
      ? { label: tr("Barrière", "Barrier"), color: "#4a5d6c", style: "barrier", dx: 50, dy: 0 }
      : kind === "area"
        ? { label: tr("Zone", "Area"), color: PLAN_PALETTE[2], w: 76, h: 56 }
        : kind === "door"
          ? { label: tr("Entrée", "Entry"), color: "#0f8a5f", angle: 270 }
          : { label: tr("Repère", "Marker"), color: PLAN_PALETTE[1], icon: "", rot: 0, showText: false };
    change((list) => [...list, { ...base, ...extra }]);
    setSelected({ type: "el", id });
  }
  function duplicate(el) {
    const id = newId(el.kind === "judge" ? "j" : el.kind);
    change((list) => [...list, { ...el, id, x: Math.min(97, el.x + 3) }]);
    setSelected({ type: "el", id });
  }
  function removeEl(el) {
    const name = jText(el, el.kind === "judge" ? "desc" : "label", lang) || jText(el, "label", lang);
    if (!window.confirm(tr(`Supprimer « ${name} » du plan ?`, `Delete "${name}" from the plan?`))) return;
    change((list) => list.filter((item) => item.id !== el.id));
    setSelected(null);
  }
  function removeTeam(team) {
    const count = elements.filter((el) => el.kind === "judge" && el.team === team.id).length;
    if (!window.confirm(tr(
      `Supprimer l'équipe « ${team.label} »${count ? ` et ses ${count} juge(s)` : ""} ?`,
      `Delete the team "${team.labelEn || team.label}"${count ? ` and its ${count} judge(s)` : ""}?`,
    ))) return;
    changeTeams((list) => list.filter((t) => t.id !== team.id));
    change((list) => list.filter((el) => !(el.kind === "judge" && el.team === team.id)));
    setSelected(null);
  }

  async function save() {
    setSaving(true);
    try {
      await saveJudgesPlan(elements, teams, currentUserLabel);
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
    setElements(plan.elements);
    setTeams(plan.teams);
    setDirty(false);
    setMessage(tr("Modifications annulées.", "Changes discarded."));
  }
  function resetToDefault() {
    if (!window.confirm(tr(
      "Remettre le plan de départ (équipes, juges, repères) ? Ce qui a été ajouté ou déplacé sera perdu (après Enregistrer).",
      "Put back the starting plan (teams, judges, markers)? What was added or moved will be lost (after Save).",
    ))) return;
    const defaults = judgesPlanDefaults();
    setTeams(defaults.teams);
    setElements(defaults.elements);
    markDirty();
    setSelected(null);
  }
  function print() {
    const win = window.open("", "_blank", "width=900,height=1100");
    if (win) {
      win.document.write(judgesPlanPrintHtml(elements, teams, { lang, details }));
      win.document.close();
      return;
    }
    // Fenêtres bloquées : impression depuis un cadre invisible dans la page
    document.getElementById("judges-plan-print-frame")?.remove();
    const frame = document.createElement("iframe");
    frame.id = "judges-plan-print-frame";
    frame.title = "print";
    frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;";
    frame.onload = () => setTimeout(() => frame.contentWindow?.print(), 250);
    frame.srcdoc = judgesPlanPrintHtml(elements, teams, { lang, details, autoPrint: false });
    document.body.appendChild(frame);
  }

  // Glisser-déposer (position en % du cadre) et extrémités des lignes (unités du plan)
  function onElementPointerDown(event, el) {
    event.preventDefault();
    event.stopPropagation();
    setSelected({ type: "el", id: el.id });
    const canvas = event.currentTarget.closest(".judges-plan");
    dragRef.current = { id: el.id, node: event.currentTarget, canvas, moved: false };
    event.currentTarget.classList.add("is-dragging");
    canvas?.setPointerCapture?.(event.pointerId);
  }
  function onHandlePointerDown(event, el, sign) {
    event.preventDefault();
    event.stopPropagation();
    const { X, Y } = jPoint(el);
    handleRef.current = { id: el.id, ox: X - sign * el.dx, oy: Y - sign * el.dy, sign };
    canvasRef.current?.setPointerCapture?.(event.pointerId);
  }
  function onPointerMove(event) {
    const handle = handleRef.current;
    if (handle && canvasRef.current) {
      const rect = canvasRef.current.getBoundingClientRect();
      const px = JUDGES_BOX.x + Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)) * JUDGES_BOX.w;
      const py = JUDGES_BOX.y + Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)) * JUDGES_BOX.h;
      const round = (v) => Math.round(v * 10) / 10;
      patch(handle.id, {
        x: round((((px + handle.ox) / 2 - JUDGES_BOX.x) / JUDGES_BOX.w) * 100),
        y: round((((py + handle.oy) / 2 - JUDGES_BOX.y) / JUDGES_BOX.h) * 100),
        dx: round((handle.sign * (px - handle.ox)) / 2),
        dy: round((handle.sign * (py - handle.oy)) / 2),
      });
      return;
    }
    const drag = dragRef.current;
    if (!drag?.canvas) return;
    const rect = drag.canvas.getBoundingClientRect();
    drag.moved = true;
    drag.x = Math.round(Math.min(99, Math.max(1, ((event.clientX - rect.left) / rect.width) * 100)) * 100) / 100;
    drag.y = Math.round(Math.min(99, Math.max(1, ((event.clientY - rect.top) / rect.height) * 100)) * 100) / 100;
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

  const baseHtml = useMemo(() => judgesPlanSvg(elements, lang, details), [elements, lang, details]);
  const judges = elements.filter((el) => el.kind === "judge");
  const others = elements.filter((el) => ["area", "mark", "door", "line"].includes(el.kind));
  const drawn = [...others.filter((el) => el.kind === "area"), ...others.filter((el) => el.kind !== "area"), ...judges];
  const deselect = (event) => { if (event.target === event.currentTarget || event.target.closest(".coque-plan__layer")) setSelected(null); };
  const renderItems = (list) => list.map((el) => {
    const ghost = focusTeam && el.kind === "judge" && el.team !== focusTeam;
    const classes = ["coque-plan__el", ghost ? "is-ghost" : "", selected?.id === el.id ? "is-selected" : ""].join(" ");
    const size = el.kind === "area" ? jAreaSize(el) : {};
    return (
      <div
        key={el.id}
        className={classes}
        style={{ left: `${el.x}%`, top: `${el.y}%`, ...size, transform: jTransform(el) }}
        title={el.kind === "judge" ? `${jText(teams.find((t) => t.id === el.team), "label", lang)} · ${jText(el, "desc", lang)}` : undefined}
        onPointerDown={(event) => onElementPointerDown(event, el)}
      >
        {el.kind === "judge" ? (
          <span className="cp-judge" style={{ background: teamColor(teams, el.team) }}>{jText(el, "label", lang)}</span>
        ) : (
          <PlanMarker el={el} lang={lang} color={el.color} />
        )}
      </div>
    );
  });

  const savedAt = formatSavedAt(plan.updatedAt);
  const savedNote = plan.saved
    ? `${tr("Enregistré", "Saved")}${savedAt ? ` ${tr("le", "on")} ${savedAt}` : ""}${plan.updatedBy ? ` ${tr("par", "by")} ${plan.updatedBy}` : ""}`
    : tr("Plan de départ (pas encore enregistré)", "Starting plan (not saved yet)");

  return (
    <div className="coque-plan-editor jpe">
      <div className="cpe-bar">
        <div className="jpe-title">
          <b>{tr("Plan de l'infield — juges", "Infield plan — judges")}</b>
          <span>{tr("Salle, gradins et infield · positions des juges par équipe", "Hall, stands and infield · judge positions by team")}</span>
        </div>
        <div className={`cpe-status ${dirty ? "is-dirty" : ""}`}>
          {plan.loading ? tr("Chargement…", "Loading…") : dirty ? message || tr("Modifications non enregistrées", "Unsaved changes") : message || savedNote}
          <button type="button" className="cpe-btn" onClick={print}>{tr("Imprimer (A4)", "Print (A4)")}</button>
          {dirty ? <button type="button" className="cpe-btn" onClick={cancel} disabled={saving}>{tr("Annuler", "Cancel")}</button> : null}
          <button type="button" className="cpe-btn cpe-btn--primary" onClick={save} disabled={saving || (!dirty && plan.saved)}>
            {saving ? tr("Enregistrement…", "Saving…") : tr("Enregistrer", "Save")}
          </button>
        </div>
      </div>
      {plan.error ? <p className="panel-note">{plan.error}</p> : null}

      <div className="cpe-layout">
        <aside className="cpe-panel jpe-list">
          <h3>{tr("Équipes de juges", "Judge teams")}</h3>
          {teams.map((team) => {
            const rows = judges.filter((el) => el.team === team.id);
            return (
              <div key={team.id} className="jpe-team">
                <div className={`jpe-team__head ${selected?.type === "team" && selected.id === team.id ? "is-selected" : ""}`} onClick={() => setSelected({ type: "team", id: team.id })}>
                  <span className="jpe-swatch" style={{ background: team.color }} />
                  <span className="cpe-row__name">{jText(team, "label", lang)}</span>
                  <small>{rows.length}</small>
                  <button
                    type="button"
                    className="jpe-add"
                    title={tr("Ajouter un juge à cette équipe", "Add a judge to this team")}
                    aria-label={tr("Ajouter un juge", "Add a judge")}
                    onClick={(event) => { event.stopPropagation(); addJudge(team.id); }}
                  >
                    +
                  </button>
                </div>
                {rows.map((el) => (
                  <div key={el.id} className={`jpe-row ${selected?.id === el.id ? "is-selected" : ""}`} onClick={() => setSelected({ type: "el", id: el.id })}>
                    <span className="cp-judge cp-judge--chip" style={{ background: team.color }}>{jText(el, "label", lang)}</span>
                    <span className="cpe-row__name">{jText(el, "desc", lang) || <em>{tr("rôle à préciser", "role to set")}</em>}</span>
                  </div>
                ))}
              </div>
            );
          })}
          <div className="cpe-adds">
            <button type="button" className="cpe-btn" onClick={addTeam}>+ {tr("Équipe", "Team")}</button>
          </div>

          <h3 className="jpe-h3">{tr("Aires de concours", "Event areas")}</h3>
          <div className="cpe-checks jpe-facilities">
            {elements.filter((el) => el.kind === "facility").map((el) => (
              <label key={el.id}>
                <input type="checkbox" checked={!el.hidden} onChange={() => patch(el.id, { hidden: !el.hidden })} />
                {tr(JUDGES_FACILITIES[el.facility].label, JUDGES_FACILITIES[el.facility].en)}
              </label>
            ))}
          </div>

          <h3 className="jpe-h3">{tr("Repères", "Markers")}</h3>
          {others.map((el) => (
            <div key={el.id} className={`jpe-row ${selected?.id === el.id ? "is-selected" : ""}`} onClick={() => setSelected({ type: "el", id: el.id })}>
              {el.kind === "mark" && PLAN_ICONS[el.icon] ? (
                <span className="cpe-chip" style={{ background: el.color }} dangerouslySetInnerHTML={{ __html: planIconSvg(el.icon) }} />
              ) : (
                <span className={`cpe-chip ${el.kind === "area" ? "is-square" : ""} ${el.kind === "line" ? "is-line" : ""}`} style={{ background: el.color }}>
                  {el.kind === "door" ? "➜" : ""}
                </span>
              )}
              <span className="cpe-row__name">{jText(el, "label", lang)}</span>
            </div>
          ))}
          <div className="cpe-adds">
            <button type="button" className="cpe-btn" onClick={() => addElement("mark")}>+ {tr("Repère", "Marker")}</button>
            <button type="button" className="cpe-btn" onClick={() => addElement("area")}>+ {tr("Zone (salle, stockage, scène)", "Area (room, storage, stage)")}</button>
            <button type="button" className="cpe-btn" onClick={() => addElement("door")}>+ {tr("Flèche d'entrée", "Entrance arrow")}</button>
            <button type="button" className="cpe-btn" onClick={() => addElement("line")}>+ {tr("Ligne (barrière, séparation)", "Line (barrier, separation)")}</button>
            <button type="button" className="cpe-btn cpe-btn--danger" onClick={resetToDefault}>{tr("Revenir au plan de départ", "Back to the starting plan")}</button>
          </div>
        </aside>

        <section className="cpe-stage">
          <div className="cpe-stage__bar">
            <span><b>{tr("Coque", "Coque")}</b> · {tr("niveau 0 autour de la piste, infield en détail ; fais glisser juges et repères, clique une équipe pour la mettre en avant", "level 0 around the track, infield in detail; drag judges and markers, click a team to highlight it")}</span>
            {focusTeam ? <button type="button" className="cpe-link" onClick={() => setSelected(null)}>{tr("Tout afficher", "Show all")}</button> : null}
          </div>
          <div className="cpe-canvas jpe-canvas" onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
            <div ref={canvasRef} className="judges-plan" onPointerDown={deselect}>
              <div className="coque-plan__layer" dangerouslySetInnerHTML={{ __html: baseHtml }} />
              {renderItems(drawn)}
              {selectedEl?.kind === "line"
                ? [-1, 1].map((sign) => {
                    const { X, Y } = jPoint(selectedEl);
                    return (
                      <span
                        key={sign}
                        className="cpe-handle"
                        title={tr("Tirer pour allonger ou tourner la ligne", "Drag to lengthen or turn the line")}
                        style={{
                          left: `${((X + sign * selectedEl.dx - JUDGES_BOX.x) / JUDGES_BOX.w) * 100}%`,
                          top: `${((Y + sign * selectedEl.dy - JUDGES_BOX.y) / JUDGES_BOX.h) * 100}%`,
                        }}
                        onPointerDown={(event) => onHandlePointerDown(event, selectedEl, sign)}
                      />
                    );
                  })
                : null}
            </div>
          </div>
        </section>

        <aside className="cpe-panel cpe-detail">
          {selectedTeam ? (
            <TeamDetail
              team={selectedTeam}
              count={judges.filter((el) => el.team === selectedTeam.id).length}
              onPatch={(values) => patchTeam(selectedTeam.id, values)}
              onAddJudge={() => addJudge(selectedTeam.id)}
              onDelete={() => removeTeam(selectedTeam)}
            />
          ) : selectedEl ? (
            <ElementDetail
              el={selectedEl}
              teams={teams}
              onPatch={(values) => patch(selectedEl.id, values)}
              onDuplicate={() => duplicate(selectedEl)}
              onDelete={() => removeEl(selectedEl)}
            />
          ) : (
            <>
              <h3>{tr("Élément", "Item")}</h3>
              <p className="cpe-empty">{tr(
                "Clique sur un juge, un repère ou une équipe pour le modifier. Fais glisser sur le plan pour déplacer.",
                "Click a judge, a marker or a team to edit it. Drag on the plan to move.",
              )}</p>
              <details className="cpe-help" style={{ marginTop: 10 }}>
                <summary>{tr("Comment ça marche", "How it works")}</summary>
                <p>{tr(
                  "Chaque juge est un rond de la couleur de son équipe, avec une lettre ou un numéro (C = chef de concours). Son rôle va dans la légende.",
                  "Each judge is a dot in the team colour, with a letter or number (C = chief judge). The role goes in the legend.",
                )}</p>
                <p>{tr(
                  "Les aires de concours sont à la même place que sur les plans de la Coque. « Imprimer (A4) » sort le plan et la légende sur une page, dans la langue de l'interface.",
                  "The event areas are in the same place as on the Coque maps. \"Print (A4)\" puts the plan and the legend on one page, in the interface language.",
                )}</p>
              </details>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}

function ColorField({ value, onChange }) {
  const tr = useTr();
  return (
    <div className="cpe-field">
      <span>{tr("Couleur", "Colour")}</span>
      <div className="cpe-colors">
        {PLAN_PALETTE.map((color) => (
          <button key={color} type="button" className={color === value ? "is-on" : ""} style={{ background: color }} aria-label={color} onClick={() => onChange(color)} />
        ))}
      </div>
    </div>
  );
}

function TextPair({ label, hint, fr, en, max, multiline = false, onChange }) {
  const tr = useTr();
  const Input = multiline ? "textarea" : "input";
  return (
    <>
      <label className="cpe-field">
        <span>{label} {hint ? <small>{hint}</small> : null}</span>
        <Input type="text" value={fr} maxLength={max} onChange={(event) => onChange("fr", event.target.value)} />
      </label>
      <label className="cpe-field">
        <span>{label} · EN <small>{tr("vide = texte français", "empty = French text")}</small></span>
        <Input type="text" value={en} maxLength={max} onChange={(event) => onChange("en", event.target.value)} />
      </label>
    </>
  );
}

function TeamDetail({ team, count, onPatch, onAddJudge, onDelete }) {
  const tr = useTr();
  return (
    <>
      <h3>{tr("Équipe de juges", "Judge team")}</h3>
      <TextPair
        label={tr("Nom", "Name")}
        fr={team.label}
        en={team.labelEn}
        max={40}
        onChange={(lang, value) => onPatch(lang === "fr" ? { label: value } : { labelEn: value })}
      />
      <ColorField value={team.color} onChange={(color) => onPatch({ color })} />
      <p className="cpe-empty">{tr(`${count} juge(s) sur le plan.`, `${count} judge(s) on the plan.`)}</p>
      <div className="jpe-actions">
        <button type="button" className="cpe-btn" onClick={onAddJudge}>+ {tr("Juge", "Judge")}</button>
        <button type="button" className="cpe-btn cpe-btn--danger" onClick={onDelete}>{tr("Supprimer l'équipe", "Delete team")}</button>
      </div>
    </>
  );
}

function ElementDetail({ el, teams, onPatch, onDuplicate, onDelete }) {
  const tr = useTr();
  const isJudge = el.kind === "judge";
  return (
    <>
      <h3>{tr(...KIND_TITLES[el.kind])}</h3>
      {isJudge ? (
        <>
          <label className="cpe-field">
            <span>{tr("Équipe", "Team")}</span>
            <select value={el.team} onChange={(event) => onPatch({ team: event.target.value })}>
              {teams.map((team) => <option key={team.id} value={team.id}>{tr(team.label, team.labelEn || team.label)}</option>)}
            </select>
          </label>
          <div className="cpe-field">
            <span>{tr("Sur le rond", "On the dot")} <small>{tr("1 à 3 caractères : C, 1, PF…", "1 to 3 characters: C, 1, PF…")}</small></span>
            <div className="jpe-pair">
              <input type="text" value={el.label} maxLength={3} aria-label="FR" onChange={(event) => onPatch({ label: event.target.value })} />
              <input type="text" value={el.labelEn} maxLength={3} placeholder="EN" aria-label="EN" onChange={(event) => onPatch({ labelEn: event.target.value })} />
            </div>
          </div>
          <TextPair
            label={tr("Rôle", "Role")}
            hint={tr("dans la légende", "in the legend")}
            fr={el.desc}
            en={el.descEn}
            max={80}
            onChange={(lang, value) => onPatch(lang === "fr" ? { desc: value } : { descEn: value })}
          />
        </>
      ) : (
        <>
          {el.kind === "line" ? (
            <label className="cpe-field">
              <span>{tr("Type de ligne", "Line type")} <small>{tr("tirer les carrés bleus sur le plan", "drag the blue squares on the plan")}</small></span>
              <select value={el.style} onChange={(event) => onPatch({ style: event.target.value })}>
                {Object.entries(PLAN_LINE_STYLES).map(([key, style]) => <option key={key} value={key}>{tr(style.label, style.en)}</option>)}
              </select>
            </label>
          ) : null}
          <TextPair
            label={tr("Texte sur le plan", "Text on the plan")}
            hint={tr("1 ou 2 mots", "1 or 2 words")}
            fr={el.label}
            en={el.labelEn}
            max={20}
            onChange={(lang, value) => onPatch(lang === "fr" ? { label: value } : { labelEn: value })}
          />
          <TextPair
            label={tr("Légende", "Legend")}
            hint={tr("le détail, à côté du plan", "the detail, next to the plan")}
            fr={el.desc}
            en={el.descEn}
            multiline
            onChange={(lang, value) => onPatch(lang === "fr" ? { desc: value } : { descEn: value })}
          />
          {el.kind === "mark" ? (
            <div className="cpe-field">
              <span>{tr("Affichage", "Display")}</span>
              <div className="cpe-icons">
                <button type="button" className={`cpe-icon is-text ${!el.icon ? "is-on" : ""}`} title={tr("Étiquette de texte", "Text label")} onClick={() => onPatch({ icon: "", showText: false })}>
                  <span style={{ background: "#fff" }}>Aa</span>
                </button>
                {Object.entries(PLAN_ICONS).map(([key, icon]) => (
                  <button key={key} type="button" className={`cpe-icon ${el.icon === key ? "is-on" : ""}`} title={tr(icon.label, icon.en)} aria-label={tr(icon.label, icon.en)} onClick={() => onPatch({ icon: key })}>
                    <span style={{ background: el.color }} dangerouslySetInnerHTML={{ __html: planIconSvg(key) }} />
                  </button>
                ))}
              </div>
              {el.icon ? (
                <div className="cpe-seg cpe-seg--inline" role="group">
                  <button type="button" className={!el.showText ? "is-on" : ""} onClick={() => onPatch({ showText: false })}>{tr("Icône seule", "Icon only")}</button>
                  <button type="button" className={el.showText ? "is-on" : ""} onClick={() => onPatch({ showText: true })}>{tr("Icône + texte", "Icon + text")}</button>
                </div>
              ) : null}
            </div>
          ) : null}
          {el.kind === "mark" || el.kind === "area" ? <RotationField value={el.rot || 0} onChange={(rot) => onPatch({ rot })} /> : null}
          {el.kind === "area" && !el.shape ? (
            <div className="cpe-field">
              <span>{tr("Taille", "Size")} <small>{tr("unités du plan (≈ 8 par mètre)", "plan units (≈ 8 per metre)")}</small></span>
              <div className="cpe-inline">
                <input type="number" value={el.w} onChange={(event) => onPatch({ w: Math.max(20, Number(event.target.value) || 20) })} /> ×
                <input type="number" value={el.h} onChange={(event) => onPatch({ h: Math.max(20, Number(event.target.value) || 20) })} />
              </div>
            </div>
          ) : null}
          {el.kind === "door" ? (
            <label className="cpe-field">
              <span>{tr("Direction", "Direction")} <small>{tr("0 droite · 90 bas · 180 gauche · 270 haut", "0 right · 90 down · 180 left · 270 up")}</small></span>
              <input type="number" value={el.angle} onChange={(event) => onPatch({ angle: Number(event.target.value) || 0 })} />
            </label>
          ) : null}
          <ColorField value={el.color} onChange={(color) => onPatch({ color })} />
        </>
      )}
      <div className="jpe-actions">
        <button type="button" className="cpe-btn" onClick={onDuplicate}>{tr("Dupliquer", "Duplicate")}</button>
        <button type="button" className="cpe-btn cpe-btn--danger" onClick={onDelete}>{tr("Supprimer", "Delete")}</button>
      </div>
    </>
  );
}
