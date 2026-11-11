import { forwardRef, useMemo } from "react";
import {
  PLAN_CROP,
  PLAN_H,
  PLAN_W,
  planBaseSvg,
  planColorOf,
  planCtrlText,
  planDesc,
  planElTransform,
  planHasIcon,
  planIconHtml,
  planLabel,
  planLegendItems,
  planPictoBg,
  planPos,
  planShapesSvg,
} from "./coque-plan-data";
import "./coque-plan.css";

// Ce qui est posé sur le plan pour un repère : numéro de zone, icône, étiquette, flèche, contrôle.
export function PlanMarker({ el, color = planColorOf(el), lang = "fr" }) {
  const label = planLabel(el, lang);
  if (el.kind === "zone") return <span className="cp-zone" style={{ background: color }}>{el.num}</span>;
  if (el.kind === "ctrl") return <span className="cp-ctrl" style={{ background: color }}>{label}</span>;
  if (el.kind === "door") {
    return (
      <span className="cp-door" style={{ background: color }} title={label}>
        <span style={{ display: "inline-block", transform: `rotate(${el.angle || 0}deg)` }}>➜</span>
      </span>
    );
  }
  if (el.kind === "area" && el.shape) return <span className="cp-area-label" style={{ color }}>{label}</span>;
  if (el.kind === "area") {
    return <span className="cp-area" style={{ background: `${color}1f`, borderColor: color, color }}>{label}</span>;
  }
  if (planHasIcon(el)) {
    return (
      <span
        className={`cp-picto ${el.iconImg ? "cp-picto--img" : ""}`}
        style={{ background: planPictoBg(el, color) }}
        title={label}
        dangerouslySetInnerHTML={{ __html: planIconHtml(el) }}
      />
    );
  }
  return <span className="cp-pill" style={{ background: color }}>{label}</span>;
}

const areasFirst = (list) => [...list.filter((el) => el.kind === "area"), ...list.filter((el) => el.kind !== "area")];

// Le plan : fond de carte + zones dessinées + repères positionnés en % (indépendant de la taille).
// mapKey filtre les repères d'un des 4 plans ; sans mapKey (éditeur), tout est affiché et ce qui
// n'est pas sur le plan courant passe en transparence via isGhost.
export const PlanCanvas = forwardRef(function PlanCanvas(
  { elements, mapKey, crop = false, base = {}, colorFor, isGhost, selectedId, className = "", lang = "fr", onElementPointerDown, ...rest },
  ref,
) {
  const shown = mapKey ? elements.filter((el) => el.maps?.[mapKey]) : elements;
  const { infield, warmup } = base;
  const baseHtml = useMemo(() => planBaseSvg({ infield, warmup, crop, lang }), [infield, warmup, crop, lang]);
  const shapesHtml = planShapesSvg(mapKey ? shown : elements.filter((el) => !isGhost?.(el)), crop);
  return (
    <div ref={ref} className={`coque-plan ${crop ? "coque-plan--crop" : ""} ${className}`} {...rest}>
      <div className="coque-plan__layer" dangerouslySetInnerHTML={{ __html: baseHtml }} />
      {shapesHtml ? <div className="coque-plan__layer" dangerouslySetInnerHTML={{ __html: shapesHtml }} /> : null}
      {areasFirst(shown).map((el) => {
        const { x, y } = planPos(el, crop);
        if (y < 0 || y > 100) return null;
        const size = el.kind === "area" && !el.shape
          ? { width: `${(el.w / PLAN_W) * 100}%`, height: `${(el.h / (crop ? PLAN_CROP.h : PLAN_H)) * 100}%` }
          : {};
        const classes = ["coque-plan__el", isGhost?.(el) ? "is-ghost" : "", el.id === selectedId ? "is-selected" : ""].join(" ");
        return (
          <div
            key={el.id}
            className={classes}
            style={{ left: `${x}%`, top: `${y}%`, ...size, transform: planElTransform(el) }}
            data-id={el.id}
            onPointerDown={onElementPointerDown ? (event) => onElementPointerDown(event, el) : undefined}
          >
            <PlanMarker el={el} lang={lang} color={colorFor ? colorFor(el) : planColorOf(el)} />
          </div>
        );
      })}
    </div>
  );
});

export function PlanLegend({ elements, mapKey, compact = false, lang = "fr" }) {
  const lines = planLegendItems(elements, mapKey, lang);
  if (!lines.length) return null;
  return (
    <div className={`cp-legend ${compact ? "cp-legend--compact" : ""}`}>
      {lines.map(({ key, el, where }) => (
        <div key={key} className="cp-legend__row">
          <span className="cp-legend__key">
            {el.kind === "area" && el.shape ? (
              <span className="cp-legend__swatch" style={{ background: el.bg === "piste" ? "#2f78c4" : `${el.color}55` }} />
            ) : (
              <PlanMarker el={el} lang={lang} />
            )}
          </span>
          <span className="cp-legend__text">
            {el.kind === "zone" || planHasIcon(el) || el.kind === "area" ? <b>{planLabel(el, lang)}</b> : null}
            {el.kind === "ctrl" && !planDesc(el, lang) ? (
              planCtrlText(el, elements, lang) || <em className="cp-legend__todo">{lang === "en" ? "to complete: link it to zones in Checkpoints" : "à compléter : zones à lier dans Contrôles"}</em>
            ) : null}
            {planDesc(el, lang) ? <>{el.kind === "zone" || planHasIcon(el) || el.kind === "area" ? " — " : ""}{planDesc(el, lang)}</> : null}
            {!planDesc(el, lang) && el.kind === "mark" && !planHasIcon(el) ? planLabel(el, lang) : null}
            {where ? <small>{where}</small> : null}
          </span>
        </div>
      ))}
    </div>
  );
}
