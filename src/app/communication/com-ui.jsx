// Module Communication : petits composants partagés (porté de myFLA,
// components/communication/ui.tsx, use-escape.ts et validation-panel.tsx — badge).
import { COM_SECTIONS, typeColor, useEscape } from "./com-ui-helpers.js";
import { NavLink } from "react-router-dom";
import { PUB_TYPE_LABELS, STATUT_LABELS } from "./com-domain.js";
import { memberName } from "./com-data.js";

export function ComNav({ openTasks = 0 }) {
  return (
    <nav className="com-nav" aria-label="Module Communication">
      {COM_SECTIONS.map((section) => (
        <NavLink
          key={section.to}
          to={section.to}
          end={section.end}
          className={({ isActive }) => `com-nav__link ${isActive ? "is-active" : ""}`}
        >
          {section.label}
          {section.to.endsWith("/taches") && openTasks > 0 ? (
            <span className="com-nav__badge" aria-label={`${openTasks} tâches à faire`}>
              {openTasks}
            </span>
          ) : null}
        </NavLink>
      ))}
    </nav>
  );
}

export function ComPageHeader({ title, description, actions }) {
  return (
    <div className="com-page-header">
      <div>
        <p className="com-eyebrow">Communication</p>
        <h1>{title}</h1>
        {description ? <p className="com-muted">{description}</p> : null}
      </div>
      {actions ? <div className="com-row">{actions}</div> : null}
    </div>
  );
}

export function TypeTag({ type }) {
  return (
    <span className="com-type-tag" style={typeColor(type)}>
      <span className="com-swatch" aria-hidden="true" />
      {PUB_TYPE_LABELS[type]}
    </span>
  );
}

export function StatusPill({ statut }) {
  return (
    <span className="com-status">
      <span className={`com-st ${statut}`} aria-hidden="true" />
      {STATUT_LABELS[statut]}
    </span>
  );
}

const HUES = [199, 330, 150, 28, 260, 0, 95];
export function Avatar({ user }) {
  if (!user) return null;
  const uid = String(user.uid || "");
  const hue = HUES[[...uid].reduce((n, c) => n + c.charCodeAt(0), 0) % HUES.length];
  return (
    <span title={memberName(user)} className="com-avatar" style={{ background: `hsl(${hue} 55% 40%)` }}>
      {String(user.firstName || user.email || "?").slice(0, 1).toUpperCase()}
    </span>
  );
}

export function Toggle({ on, onClick, disabled, children }) {
  return (
    <button type="button" disabled={disabled} aria-pressed={on} onClick={onClick} className={`com-toggle ${on ? "is-on" : ""}`}>
      {children}
    </button>
  );
}

export function Dialog({ title, onClose, children, wide = false }) {
  useEscape(onClose);
  return (
    <div className="com-dialog">
      <div className="com-dialog__backdrop" onClick={onClose} />
      <div role="dialog" aria-label={title} className={`com-dialog__box ${wide ? "is-wide" : ""}`}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function Toast({ message }) {
  if (!message) return null;
  return (
    <div role="status" className="com-toast">
      {message}
    </div>
  );
}

const BADGES = {
  demandee: { label: "À valider", short: "?", tone: "warn" },
  validee: { label: "Validé", short: "✓", tone: "ok" },
  a_revoir: { label: "À revoir", short: "↺", tone: "danger" },
};

export function ValidationBadge({ validation, compact = false }) {
  if (!validation || !BADGES[validation.etat]) return null;
  const badge = BADGES[validation.etat];
  return (
    <span className={`com-badge com-badge--${badge.tone} ${compact ? "is-compact" : ""}`} title={badge.label} aria-label={badge.label}>
      {compact ? badge.short : badge.label}
    </span>
  );
}
