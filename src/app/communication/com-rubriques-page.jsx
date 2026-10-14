// Rubriques récurrentes (porté de myFLA : app/communication/rubriques/page.tsx).
// Le « calendrier type 2026 » de la fédération n'est pas repris : propre à la FLA.
import { useMemo, useState } from "react";
import { createRubrique, deleteRubrique, setRubriqueActive, updateRubrique } from "./com-actions.js";
import { memberName, useCommunicationTeam, useRubriques } from "./com-data.js";
import { JOURS, todayYmd } from "./com-dates.js";
import { CANAUX, CANAL_LABELS, PUB_TYPES, PUB_TYPE_LABELS } from "./com-domain.js";
import { ruleLabel } from "./com-recurrence.js";
import { Avatar, ComPageHeader, Dialog, Toast, Toggle, TypeTag, useToast } from "./com-ui.jsx";

export function ComRubriquesPage() {
  const { rubriques, loading } = useRubriques();
  const team = useCommunicationTeam();
  const teamById = useMemo(() => new Map(team.map((u) => [u.uid, u])), [team]);
  const [editing, setEditing] = useState(null);
  const [toast, setToast] = useToast();

  async function run(action, success) {
    try {
      await action();
      setToast(success);
    } catch (error) {
      console.error(error);
      setToast("L'enregistrement a échoué. Réessaie.");
    }
  }

  return (
    <>
      <ComPageHeader
        title="Rubriques récurrentes"
        description="Elles remplissent le calendrier automatiquement (ex. compte à rebours chaque lundi). Un changement de rythme s'applique à partir d'aujourd'hui : les dates passées ne bougent pas."
        actions={
          <button type="button" className="button button--primary button--small" onClick={() => setEditing("new")}>
            + Rubrique
          </button>
        }
      />

      {!loading && !rubriques.length ? <p className="com-empty">Aucune rubrique pour l'instant.</p> : null}

      {rubriques.length ? (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Rubrique</th>
                <th>Rythme</th>
                <th>Type</th>
                <th>Canaux</th>
                <th>Responsable</th>
                <th>Active</th>
                <th>Actions</th>
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
                    <td>{ruleLabel(r.rule)}</td>
                    <td>
                      <TypeTag type={r.type} />
                    </td>
                    <td>
                      <span className="com-row" style={{ gap: 4 }}>
                        {r.canaux.map((c) => (
                          <span key={c} className="com-canal">
                            {CANAL_LABELS[c]?.short || c}
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
                        <span className="com-muted">À définir</span>
                      )}
                    </td>
                    <td>
                      <label className="com-row">
                        <input
                          type="checkbox"
                          role="switch"
                          checked={r.active}
                          aria-label={`Activer ${r.titre}`}
                          onChange={() => run(() => setRubriqueActive(r.id, !r.active), r.active ? "Rubrique désactivée" : "Rubrique activée")}
                        />
                        {r.active ? "Oui" : "Non"}
                      </label>
                    </td>
                    <td>
                      <button type="button" className="button button--secondary button--small" onClick={() => setEditing(r)}>
                        Modifier
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
            if (editing === "new") await run(() => createRubrique(data), "Rubrique créée");
            else await run(() => updateRubrique(editing, data, todayYmd()), "Rubrique mise à jour");
            setEditing(null);
          }}
          onDelete={
            editing === "new"
              ? undefined
              : async () => {
                  await run(() => deleteRubrique(editing.id), "Rubrique supprimée");
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
  [1, "1re semaine"],
  [2, "2e"],
  [3, "3e"],
  [4, "4e"],
  [5, "5e"],
];

function RubriqueForm({ rubrique, team, onClose, onSave, onDelete }) {
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
    <Dialog title={rubrique ? "Modifier la rubrique" : "Nouvelle rubrique"} onClose={onClose} wide>
      <form className="com-stack" onSubmit={handleSubmit}>
        <label className="com-field">
          Titre
          <input className="com-input" required autoFocus maxLength={200} placeholder="Ex. Compte à rebours" value={form.titre} onChange={(e) => setForm({ ...form, titre: e.target.value })} />
        </label>

        <div className="com-grid-2">
          <label className="com-field">
            Fréquence
            <select
              className="com-input"
              value={rule.kind}
              onChange={(e) => {
                const kind = e.target.value;
                setRule(kind === "monthly" ? { kind, dow: rule.dow, nth: [1] } : { kind, dow: rule.dow });
              }}
            >
              <option value="weekly">Chaque semaine</option>
              <option value="monthly">Certaines semaines du mois</option>
              <option value="last">Dernière semaine du mois</option>
            </select>
          </label>
          <label className="com-field">
            Jour
            <select className="com-input" value={rule.dow} onChange={(e) => setRule({ ...rule, dow: Number(e.target.value) })}>
              {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                <option key={d} value={d}>
                  {JOURS[d]}
                </option>
              ))}
            </select>
          </label>
          <label className="com-field">
            Type
            <select className="com-input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              {PUB_TYPES.map((t) => (
                <option key={t} value={t}>
                  {PUB_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </label>
        </div>

        {rule.kind === "monthly" ? (
          <div className="com-field">
            Semaines du mois
            <div className="com-row">
              {ORDINALS.map(([n, label]) => (
                <Toggle key={n} on={nth.includes(n)} onClick={() => setRule({ ...rule, nth: nth.includes(n) ? nth.filter((x) => x !== n) : [...nth, n].sort() })}>
                  {label}
                </Toggle>
              ))}
            </div>
            {!nth.length ? <span className="com-error">Choisis au moins une semaine.</span> : null}
          </div>
        ) : null}

        <p className="com-empty" style={{ background: "#f4f8fb" }}>
          Rythme : <strong>{ruleLabel(rule)}</strong>
        </p>

        <div className="com-field">
          Canaux
          <div className="com-row">
            {CANAUX.map((c) => (
              <Toggle
                key={c}
                on={form.canaux.includes(c)}
                onClick={() => setForm((f) => ({ ...f, canaux: f.canaux.includes(c) ? f.canaux.filter((x) => x !== c) : [...f.canaux, c] }))}
              >
                {CANAL_LABELS[c].label}
              </Toggle>
            ))}
          </div>
        </div>

        <label className="com-field">
          Responsable par défaut
          <select className="com-input" value={form.responsableUid || ""} onChange={(e) => setForm({ ...form, responsableUid: e.target.value || null })}>
            <option value="">À définir</option>
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
                Supprimer la rubrique ? Les dates déjà personnalisées restent dans le calendrier.
                <button type="button" className="button button--danger-soft button--small" onClick={onDelete}>
                  Confirmer
                </button>
                <button type="button" className="com-btn-ghost" onClick={() => setConfirmDelete(false)}>
                  Garder
                </button>
              </span>
            ) : (
              <button type="button" className="button button--danger-soft button--small" onClick={() => setConfirmDelete(true)}>
                Supprimer
              </button>
            )
          ) : (
            <span />
          )}
          <div className="com-row">
            <button type="button" className="com-btn-ghost" onClick={onClose}>
              Annuler
            </button>
            <button type="submit" className="button button--primary button--small" disabled={saving}>
              {saving ? "Enregistrement…" : "Enregistrer"}
            </button>
          </div>
        </div>
      </form>
    </Dialog>
  );
}
