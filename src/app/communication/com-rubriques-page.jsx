// Rubriques récurrentes (porté de myFLA : app/communication/rubriques/page.tsx).
// Le « calendrier type 2026 » de la fédération n'est pas repris : propre à la FLA.
import { useMemo, useState } from "react";
import { createRubrique, deleteRubrique, setRubriqueActive, updateRubrique } from "./com-actions.js";
import { memberName, useCommunicationTeam, useRubriques } from "./com-data.js";
import { dayName, todayYmd } from "./com-dates.js";
import { CANAUX, CANAL_LABELS, PUB_TYPES, PUB_TYPE_LABELS } from "./com-domain.js";
import { pick, useComLang } from "./com-i18n.js";
import { ruleLabel } from "./com-recurrence.js";
import { Avatar, ComPageHeader, Dialog, Toast, Toggle, TypeTag } from "./com-ui.jsx";
import { useToast } from "./com-ui-helpers.js";

export function ComRubriquesPage() {
  const { rubriques, loading } = useRubriques();
  const team = useCommunicationTeam();
  const teamById = useMemo(() => new Map(team.map((u) => [u.uid, u])), [team]);
  const [editing, setEditing] = useState(null);
  const [toast, setToast] = useToast();
  const { lang, tr } = useComLang();

  async function run(action, success) {
    try {
      await action();
      setToast(success);
    } catch (error) {
      console.error(error);
      setToast(tr("L'enregistrement a échoué. Réessaie.", "Saving failed. Please try again."));
    }
  }

  return (
    <>
      <ComPageHeader
        title={tr("Rubriques récurrentes", "Recurring series")}
        description={tr(
          "Elles remplissent le calendrier automatiquement (ex. compte à rebours chaque lundi). Un changement de rythme s'applique à partir d'aujourd'hui : les dates passées ne bougent pas.",
          "They fill the calendar automatically (e.g. a countdown every Monday). A schedule change applies from today: past dates stay as they are.",
        )}
        actions={
          <button type="button" className="button button--primary button--small" onClick={() => setEditing("new")}>
            {tr("+ Rubrique", "+ Series")}
          </button>
        }
      />

      {!loading && !rubriques.length ? <p className="com-empty">{tr("Aucune rubrique pour l'instant.", "No recurring series yet.")}</p> : null}

      {rubriques.length ? (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>{tr("Rubrique", "Series")}</th>
                <th>{tr("Rythme", "Schedule")}</th>
                <th>{tr("Type", "Type")}</th>
                <th>{tr("Canaux", "Channels")}</th>
                <th>{tr("Responsable", "Owner")}</th>
                <th>{tr("Active", "Active")}</th>
                <th>{tr("Actions", "Actions")}</th>
              </tr>
            </thead>
            <tbody>
              {rubriques.map((r) => {
                const resp = r.responsableUid ? teamById.get(r.responsableUid) : undefined;
                return (
                  <tr key={r.id} style={r.active ? undefined : { color: "#8095a1" }}>
                    <td>
                      <strong>{r.titre}</strong>
                    </td>
                    <td>{ruleLabel(r.rule, lang)}</td>
                    <td>
                      <TypeTag type={r.type} />
                    </td>
                    <td>
                      <span className="com-row" style={{ gap: 4 }}>
                        {r.canaux.map((c) => (
                          <span key={c} className="com-canal">
                            {pick(CANAL_LABELS[c]?.short, lang) || c}
                          </span>
                        ))}
                      </span>
                    </td>
                    <td>
                      {resp ? (
                        <span className="com-row">
                          <Avatar user={resp} />
                          {memberName(resp)}
                        </span>
                      ) : (
                        <span className="com-muted">{tr("À définir", "Not assigned")}</span>
                      )}
                    </td>
                    <td>
                      <label className="com-row">
                        <input
                          type="checkbox"
                          role="switch"
                          checked={r.active}
                          aria-label={tr(`Activer ${r.titre}`, `Activate ${r.titre}`)}
                          onChange={() =>
                            run(
                              () => setRubriqueActive(r.id, !r.active),
                              r.active ? tr("Rubrique désactivée", "Series deactivated") : tr("Rubrique activée", "Series activated"),
                            )
                          }
                        />
                        {r.active ? tr("Oui", "Yes") : tr("Non", "No")}
                      </label>
                    </td>
                    <td>
                      <button type="button" className="button button--secondary button--small" onClick={() => setEditing(r)}>
                        {tr("Modifier", "Edit")}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {editing ? (
        <RubriqueForm
          rubrique={editing === "new" ? null : editing}
          team={team}
          onClose={() => setEditing(null)}
          onSave={async (data) => {
            if (editing === "new") await run(() => createRubrique(data), tr("Rubrique créée", "Series created"));
            else await run(() => updateRubrique(editing, data, todayYmd()), tr("Rubrique mise à jour", "Series updated"));
            setEditing(null);
          }}
          onDelete={
            editing === "new"
              ? undefined
              : async () => {
                  await run(() => deleteRubrique(editing.id), tr("Rubrique supprimée", "Series deleted"));
                  setEditing(null);
                }
          }
        />
      ) : null}

      <Toast message={toast} />
    </>
  );
}

const ORDINALS = [
  [1, { fr: "1re semaine", en: "1st week" }],
  [2, { fr: "2e", en: "2nd" }],
  [3, { fr: "3e", en: "3rd" }],
  [4, { fr: "4e", en: "4th" }],
  [5, { fr: "5e", en: "5th" }],
];

function RubriqueForm({ rubrique, team, onClose, onSave, onDelete }) {
  const { lang, tr } = useComLang();
  const [form, setForm] = useState(
    rubrique
      ? { titre: rubrique.titre, type: rubrique.type, canaux: rubrique.canaux, responsableUid: rubrique.responsableUid || null, rule: rubrique.rule, active: rubrique.active }
      : { titre: "", type: "post", canaux: ["fb", "ig"], responsableUid: null, rule: { kind: "weekly", dow: 1 }, active: true },
  );
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const rule = form.rule;
  const setRule = (next) => setForm((f) => ({ ...f, rule: next }));
  const nth = rule.kind === "monthly" ? rule.nth : [];

  async function handleSubmit(event) {
    event.preventDefault();
    if (rule.kind === "monthly" && !rule.nth.length) return;
    setSaving(true);
    try {
      await onSave({ ...form, titre: form.titre.trim() });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog title={rubrique ? tr("Modifier la rubrique", "Edit series") : tr("Nouvelle rubrique", "New recurring series")} onClose={onClose} wide>
      <form className="com-stack" onSubmit={handleSubmit}>
        <label className="com-field">
          {tr("Titre", "Title")}
          <input
            className="com-input"
            required
            autoFocus
            maxLength={200}
            placeholder={tr("Ex. Compte à rebours", "E.g. Countdown")}
            value={form.titre}
            onChange={(e) => setForm({ ...form, titre: e.target.value })}
          />
        </label>

        <div className="com-grid-2">
          <label className="com-field">
            {tr("Fréquence", "Frequency")}
            <select
              className="com-input"
              value={rule.kind}
              onChange={(e) => {
                const kind = e.target.value;
                setRule(kind === "monthly" ? { kind, dow: rule.dow, nth: [1] } : { kind, dow: rule.dow });
              }}
            >
              <option value="weekly">{tr("Chaque semaine", "Every week")}</option>
              <option value="monthly">{tr("Certaines semaines du mois", "Some weeks of the month")}</option>
              <option value="last">{tr("Dernière semaine du mois", "Last week of the month")}</option>
            </select>
          </label>
          <label className="com-field">
            {tr("Jour", "Day")}
            <select className="com-input" value={rule.dow} onChange={(e) => setRule({ ...rule, dow: Number(e.target.value) })}>
              {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                <option key={d} value={d}>
                  {dayName(d, lang)}
                </option>
              ))}
            </select>
          </label>
          <label className="com-field">
            {tr("Type", "Type")}
            <select className="com-input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              {PUB_TYPES.map((t) => (
                <option key={t} value={t}>
                  {pick(PUB_TYPE_LABELS[t], lang)}
                </option>
              ))}
            </select>
          </label>
        </div>

        {rule.kind === "monthly" ? (
          <div className="com-field">
            {tr("Semaines du mois", "Weeks of the month")}
            <div className="com-row">
              {ORDINALS.map(([n, label]) => (
                <Toggle key={n} on={nth.includes(n)} onClick={() => setRule({ ...rule, nth: nth.includes(n) ? nth.filter((x) => x !== n) : [...nth, n].sort() })}>
                  {pick(label, lang)}
                </Toggle>
              ))}
            </div>
            {!nth.length ? <span className="com-error">{tr("Choisis au moins une semaine.", "Pick at least one week.")}</span> : null}
          </div>
        ) : null}

        <p className="com-empty" style={{ background: "#f4f8fb" }}>
          {tr("Rythme : ", "Schedule: ")}
          <strong>{ruleLabel(rule, lang)}</strong>
        </p>

        <div className="com-field">
          {tr("Canaux", "Channels")}
          <div className="com-row">
            {CANAUX.map((c) => (
              <Toggle
                key={c}
                on={form.canaux.includes(c)}
                onClick={() => setForm((f) => ({ ...f, canaux: f.canaux.includes(c) ? f.canaux.filter((x) => x !== c) : [...f.canaux, c] }))}
              >
                {pick(CANAL_LABELS[c].label, lang)}
              </Toggle>
            ))}
          </div>
        </div>

        <label className="com-field">
          {tr("Responsable par défaut", "Default owner")}
          <select className="com-input" value={form.responsableUid || ""} onChange={(e) => setForm({ ...form, responsableUid: e.target.value || null })}>
            <option value="">{tr("À définir", "Not assigned")}</option>
            {team.map((u) => (
              <option key={u.uid} value={u.uid}>
                {memberName(u)}
              </option>
            ))}
          </select>
        </label>

        <div className="com-row" style={{ justifyContent: "space-between" }}>
          {onDelete ? (
            confirmDelete ? (
              <span className="com-row">
                {tr(
                  "Supprimer la rubrique ? Les dates déjà personnalisées restent dans le calendrier.",
                  "Delete this series? Dates you already customised stay in the calendar.",
                )}
                <button type="button" className="button button--danger-soft button--small" onClick={onDelete}>
                  {tr("Confirmer", "Confirm")}
                </button>
                <button type="button" className="com-btn-ghost" onClick={() => setConfirmDelete(false)}>
                  {tr("Garder", "Keep")}
                </button>
              </span>
            ) : (
              <button type="button" className="button button--danger-soft button--small" onClick={() => setConfirmDelete(true)}>
                {tr("Supprimer", "Delete")}
              </button>
            )
          ) : (
            <span />
          )}
          <div className="com-row">
            <button type="button" className="com-btn-ghost" onClick={onClose}>
              {tr("Annuler", "Cancel")}
            </button>
            <button type="submit" className="button button--primary button--small" disabled={saving}>
              {saving ? tr("Enregistrement…", "Saving…") : tr("Enregistrer", "Save")}
            </button>
          </div>
        </div>
      </form>
    </Dialog>
  );
}
