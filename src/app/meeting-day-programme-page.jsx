import { useEffect, useMemo, useRef, useState } from "react";
import { serverTimestamp, setDoc } from "firebase/firestore";
import { useTeamConfiguration } from "./config-hooks";
import { useSiteEditionYear } from "./edition";
import { useMeetingEditions } from "./meeting-history-hooks";
import { programmeDocRef, useSundayProgramme } from "./meeting-day-programme-hooks";
import legacySunday2026 from "./sunday-2026-legacy.json";
import {
  COQUE_PLACES,
  GENERAL_COLUMN_KEY,
  PROGRAMME_CATEGORIES,
  PROGRAMME_END,
  PROGRAMME_START,
  PROGRAMME_STEP,
  activityMatchesColumn,
  buildProgrammeColumns,
  getCategory,
  getColumnActivities,
  getProgrammeTimeOptions,
  getTeamSubRoleNames,
  getTrackEntries,
  getVolunteerColumns,
  getVolunteerTimeline,
  importLegacySunday,
  layoutLanes,
  normalizeProgramme,
  toMinutes,
  toTimeLabel,
} from "./meeting-day-programme";

// Équipes & affectations › Programme du dimanche : la grille du jour du
// meeting (maquette design/programme validée par Margot le 09/11/2026).

const ROW_PX = 20;
const SAVE_DELAY_MS = 600;

function newId(prefix) {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2)}`;
}

function ActivityBlock({ activity, lane, laneCount, selected, onSelect, showMulti }) {
  const category = getCategory(activity.category);
  const top = ((toMinutes(activity.start) - PROGRAMME_START) / PROGRAMME_STEP) * ROW_PX;
  const height = Math.max(((toMinutes(activity.end) - toMinutes(activity.start)) / PROGRAMME_STEP) * ROW_PX - 1, ROW_PX - 1);
  const width = 100 / laneCount;
  const details = [activity.place, activity.owner && `Resp. ${activity.owner}`, activity.note].filter(Boolean).join(" · ");
  return (
    <button
      className={`mdp-block${selected ? " mdp-block--selected" : ""}`}
      style={{
        top,
        height,
        left: `calc(${lane * width}% + 2px)`,
        width: `calc(${width}% - 4px)`,
        background: category.background,
        borderLeftColor: category.border,
      }}
      title={`${activity.start}–${activity.end} · ${activity.title}${details ? ` · ${details}` : ""}`}
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onSelect(activity.id);
      }}
    >
      <small>{activity.start}</small> {activity.title}
      {showMulti && activity.columns.length > 1 ? <span className="mdp-block__multi">×{activity.columns.length}</span> : null}
      {activity.place && height > 34 ? <small className="mdp-block__place">{activity.place}</small> : null}
    </button>
  );
}

export function MeetingDayProgrammePage() {
  const { siteEditionYear, loading: yearLoading } = useSiteEditionYear();
  const { editions } = useMeetingEditions();
  const { roles: teams } = useTeamConfiguration();
  const year = siteEditionYear || editions[0]?.year || null;
  const edition = editions.find((item) => Number(item.year || item.id) === Number(year)) || null;
  const { programme: remoteProgramme, exists, loading, error } = useSundayProgramme(year);

  const [draft, setDraft] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [hiddenCategories, setHiddenCategories] = useState(() => new Set());
  const [view, setView] = useState("grid");
  const [teamViewKey, setTeamViewKey] = useState("");
  const [sidePanel, setSidePanel] = useState("activity");
  const [newColumnName, setNewColumnName] = useState("");
  const [saveState, setSaveState] = useState("");
  const saveTimer = useRef(null);
  const saveVersion = useRef(0);

  // Le brouillon local sert à l'édition ; il suit Firestore tant qu'on ne tape pas.
  const programme = draft || remoteProgramme;
  const columns = useMemo(() => (programme ? buildProgrammeColumns(teams, programme) : []), [programme, teams]);
  const trackEntries = useMemo(() => getTrackEntries(edition?.timetable), [edition]);
  const timeOptions = useMemo(() => getProgrammeTimeOptions(), []);
  const rows = (PROGRAMME_END - PROGRAMME_START) / PROGRAMME_STEP;
  const selected = programme?.activities.find((activity) => activity.id === selectedId) || null;

  useEffect(() => () => window.clearTimeout(saveTimer.current), []);

  function update(mutator) {
    const next = normalizeProgramme(mutator(structuredClone(programme)));
    setDraft(next);
    setSaveState("Enregistrement…");
    saveVersion.current += 1;
    const version = saveVersion.current;
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(async () => {
      try {
        await setDoc(programmeDocRef(year), { ...next, updatedAt: serverTimestamp() });
        // Une saisie arrivée pendant l'enregistrement garde son brouillon.
        if (version !== saveVersion.current) return;
        setSaveState("Enregistré");
        setDraft(null);
      } catch (saveError) {
        console.error("Impossible d'enregistrer le programme du dimanche.", saveError);
        setSaveState("L'enregistrement a échoué. Réessayez dans un instant.");
      }
    }, SAVE_DELAY_MS);
  }

  function updateSelected(patch) {
    update((current) => {
      current.activities = current.activities.map((activity) => {
        if (activity.id !== selectedId) return activity;
        const next = { ...activity, ...patch };
        if (toMinutes(next.end) <= toMinutes(next.start)) next.end = toTimeLabel(Math.min(toMinutes(next.start) + PROGRAMME_STEP, PROGRAMME_END));
        return next;
      });
      return current;
    });
  }

  function addActivity(columnKey, start = "10:00") {
    const id = newId("act");
    const startMinutes = toMinutes(start);
    update((current) => {
      current.activities.push({
        id,
        title: "Nouvelle activité",
        start,
        end: toTimeLabel(Math.min(startMinutes + 30, PROGRAMME_END)),
        category: "other",
        place: "",
        owner: "",
        note: "",
        columns: columnKey ? [columnKey] : [GENERAL_COLUMN_KEY],
      });
      return current;
    });
    setSelectedId(id);
    setSidePanel("activity");
    setView("grid");
  }

  function importLastYear() {
    if (exists && !window.confirm("Remplacer le programme actuel par le dimanche de l'an dernier ?")) return;
    update(() => importLegacySunday(legacySunday2026, teams));
  }

  if (yearLoading || loading) return <p className="mdp-status">Chargement du programme du dimanche…</p>;
  if (!year) return <p className="mdp-status">Choisissez d'abord l'édition affichée dans Site web › Édition.</p>;
  if (error) return <p className="mdp-status mdp-status--error">{error}</p>;

  if (!exists && !draft) {
    return (
      <section className="mdp-empty">
        <h3>Programme du dimanche {year}</h3>
        <p>
          Le programme est vide. Partez du dimanche de l'an dernier (fichier « Task and Organisation »), puis ajustez
          les horaires et les activités.
        </p>
        <div className="mdp-empty__actions">
          <button className="button button--primary" type="button" onClick={importLastYear}>
            Importer le dimanche de l'an dernier
          </button>
          <button className="button button--secondary" type="button" onClick={() => update((current) => current)}>
            Commencer vide
          </button>
        </div>
      </section>
    );
  }

  const volunteerColumnsChoices = columns.filter((column) => column.kind === "team" || column.kind === "subrole");
  const teamColumn = volunteerColumnsChoices.find((column) => column.key === teamViewKey) || volunteerColumnsChoices[0];
  const teamTimeline = teamColumn
    ? getVolunteerTimeline(
        programme.activities,
        getVolunteerColumns(columns, [teamColumn.teamName], teamColumn.kind === "subrole" ? { [teamColumn.teamName]: teamColumn.name } : {}),
      )
    : [];

  return (
    <section className="mdp">
      <div className="mdp-bar">
        <div className="mdp-seg">
          <button className={view === "grid" ? "is-on" : ""} type="button" onClick={() => setView("grid")}>
            Grille
          </button>
          <button className={view === "team" ? "is-on" : ""} type="button" onClick={() => setView("team")}>
            Vue d'une équipe
          </button>
        </div>
        {view === "team" ? (
          <select value={teamColumn?.key || ""} onChange={(event) => setTeamViewKey(event.target.value)}>
            {volunteerColumnsChoices.map((column) => (
              <option key={column.key} value={column.key}>
                {column.kind === "subrole" ? `${column.teamName} › ${column.name}` : column.name}
              </option>
            ))}
          </select>
        ) : null}
        <div className="mdp-cats">
          {PROGRAMME_CATEGORIES.map((category) => (
            <button
              key={category.value}
              className={`mdp-cat${hiddenCategories.has(category.value) ? " mdp-cat--off" : ""}`}
              title={hiddenCategories.has(category.value) ? "Afficher" : "Masquer"}
              type="button"
              onClick={() =>
                setHiddenCategories((current) => {
                  const next = new Set(current);
                  if (next.has(category.value)) next.delete(category.value);
                  else next.add(category.value);
                  return next;
                })
              }
            >
              <i style={{ background: category.border }} />
              {category.label}
            </button>
          ))}
        </div>
        <span className="mdp-bar__save">{saveState}</span>
        <button className="mdp-btn" type="button" onClick={() => setSidePanel(sidePanel === "columns" ? "activity" : "columns")}>
          Colonnes
        </button>
        <button className="mdp-btn" type="button" onClick={() => window.print()}>
          Imprimer
        </button>
        <button className="mdp-btn mdp-btn--primary" type="button" onClick={() => addActivity(null)}>
          + Activité
        </button>
      </div>

      {view === "team" && teamColumn ? (
        <div className="mdp-team">
          <p className="mdp-team__eyebrow">Ce que voient le chef d'équipe et les bénévoles · lecture seule</p>
          <h3>
            {teamColumn.kind === "subrole" ? `${teamColumn.teamName} › ` : ""}
            {teamColumn.name} — dimanche {year}
          </h3>
          <p className="mdp-muted">Leur équipe + les activités générales (bordure pointillée), dans leur espace MyCLIM.</p>
          <div className="mdp-timeline">
            {teamTimeline.length === 0 ? <p className="mdp-muted">Aucune activité.</p> : null}
            {teamTimeline.map((activity) => {
              const category = getCategory(activity.category);
              return (
                <div key={activity.id} className="mdp-timeline__row">
                  <span className="mdp-timeline__time">
                    {activity.start} – {activity.end}
                  </span>
                  <div
                    className={`mdp-timeline__body${activity.general ? " mdp-timeline__body--general" : ""}`}
                    style={{ background: category.background, borderLeftColor: category.border }}
                  >
                    <strong>
                      {activity.title}
                      {activity.general ? <span className="mdp-muted"> · général</span> : null}
                    </strong>
                    <span>{[activity.place, activity.owner && `Resp. ${activity.owner}`, activity.note].filter(Boolean).join(" · ") || category.label}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="mdp-board">
          <div className="mdp-gridwrap">
            <div className="mdp-grid" style={{ gridTemplateColumns: `46px 160px repeat(${columns.length}, 132px)` }}>
              <div className="mdp-hcell mdp-hcell--time" />
              <div className="mdp-hcell mdp-hcell--track">
                Programme piste<small>timetable de l'édition {year}</small>
              </div>
              {columns.map((column) => (
                <div key={column.key} className={`mdp-hcell mdp-hcell--${column.kind}`} title={column.name}>
                  {column.kind === "subrole" ? <span className="mdp-hcell__team">{column.teamName} ›</span> : null}
                  {column.name}
                  {column.kind === "general" ? <small>visible par toutes les équipes</small> : null}
                  {column.kind === "extra" ? <small>colonne libre</small> : null}
                </div>
              ))}

              <div className="mdp-tcol">
                {Array.from({ length: rows }, (_, index) => {
                  const minute = PROGRAMME_START + index * PROGRAMME_STEP;
                  return (
                    <div key={minute} className={`mdp-tlabel${minute % 60 === 0 ? " mdp-tlabel--hour" : ""}`}>
                      {minute % 30 === 0 ? toTimeLabel(minute) : ""}
                    </div>
                  );
                })}
              </div>

              <div className="mdp-col mdp-col--track">
                {Array.from({ length: rows }, (_, index) => {
                  const minute = PROGRAMME_START + index * PROGRAMME_STEP;
                  const entries = trackEntries.filter(
                    (entry) => toMinutes(entry.time) >= minute && toMinutes(entry.time) < minute + PROGRAMME_STEP,
                  );
                  const text = entries.map((entry) => `${entry.time} ${entry.label}`).join("\n");
                  return (
                    <div key={minute} className={`mdp-slot${(minute + PROGRAMME_STEP) % 60 === 0 ? " mdp-slot--hour" : ""}`} title={text}>
                      {entries.length ? (
                        <span className="mdp-track">
                          {entries.at(0).time} {entries.at(0).label}
                          {entries.length > 1 ? ` +${entries.length - 1}` : ""}
                        </span>
                      ) : null}
                    </div>
                  );
                })}
                {trackEntries.length === 0 ? <p className="mdp-track__empty">Timetable de l'édition pas encore saisi (Site web › Édition).</p> : null}
              </div>

              {columns.map((column) => {
                const activities = getColumnActivities(programme.activities, column).filter(
                  (activity) => !hiddenCategories.has(activity.category),
                );
                const { laneById, laneCount } = layoutLanes(activities);
                return (
                  <div key={column.key} className={`mdp-col mdp-col--${column.kind}`}>
                    {Array.from({ length: rows }, (_, index) => {
                      const minute = PROGRAMME_START + index * PROGRAMME_STEP;
                      return (
                        <button
                          key={minute}
                          aria-label={`Ajouter une activité à ${toTimeLabel(minute)} dans ${column.name}`}
                          className={`mdp-slot mdp-slot--add${(minute + PROGRAMME_STEP) % 60 === 0 ? " mdp-slot--hour" : ""}`}
                          type="button"
                          onClick={() => addActivity(column.key, toTimeLabel(minute))}
                        />
                      );
                    })}
                    {activities.map((activity) => (
                      <ActivityBlock
                        key={activity.id}
                        activity={activity}
                        lane={laneById.get(activity.id)}
                        laneCount={laneCount}
                        selected={activity.id === selectedId}
                        showMulti
                        onSelect={(id) => {
                          setSelectedId(id);
                          setSidePanel("activity");
                        }}
                      />
                    ))}
                  </div>
                );
              })}
            </div>
          </div>

          <aside className="mdp-panel">
            {sidePanel === "columns" ? (
              <>
                <h3>Colonnes</h3>
                <p className="mdp-muted">Les équipes viennent d'Équipes. Une équipe détaillée a une colonne par sous-rôle.</p>
                <div className="mdp-teams">
                  {teams.map((team) => {
                    const split = programme.splitTeamIds.includes(team.id);
                    const subRoles = getTeamSubRoleNames(team, programme);
                    return (
                      <div key={team.id} className="mdp-teams__row">
                        <label>
                          <input
                            checked={split}
                            type="checkbox"
                            onChange={(event) =>
                              update((current) => {
                                current.splitTeamIds = event.target.checked
                                  ? [...current.splitTeamIds, team.id]
                                  : current.splitTeamIds.filter((id) => id !== team.id);
                                return current;
                              })
                            }
                          />
                          {team.roleName}
                        </label>
                        {split ? (
                          <div className="mdp-teams__subs">
                            {subRoles.map((subRole) => (
                              <span key={subRole} className="mdp-tag">
                                {subRole}
                              </span>
                            ))}
                            <input
                              placeholder="+ sous-rôle (Entrée)"
                              onKeyDown={(event) => {
                                const value = event.currentTarget.value.trim();
                                if (event.key !== "Enter" || !value) return;
                                event.preventDefault();
                                event.currentTarget.value = "";
                                update((current) => {
                                  current.subRoleColumns[team.id] = [...(current.subRoleColumns[team.id] || []), value];
                                  return current;
                                });
                              }}
                            />
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
                <h3 className="mdp-panel__sub">Colonnes libres</h3>
                <p className="mdp-muted">Hors bénévoles : staff, prestataires, technique…</p>
                {programme.extraColumns.map((column) => (
                  <div key={column.id} className="mdp-extra">
                    <input
                      aria-label="Nom de la colonne"
                      value={column.name}
                      onChange={(event) =>
                        update((current) => {
                          current.extraColumns = current.extraColumns.map((item) =>
                            item.id === column.id ? { ...item, name: event.target.value || " " } : item,
                          );
                          return current;
                        })
                      }
                    />
                    <button
                      className="mdp-btn mdp-btn--danger"
                      title="Supprimer la colonne"
                      type="button"
                      onClick={() => {
                        const key = `extra:${column.id}`;
                        const used = programme.activities.filter((activity) => activity.columns.includes(key)).length;
                        if (!window.confirm(`Supprimer la colonne « ${column.name} » ? ${used} activité(s) y sont rattachées.`)) return;
                        update((current) => {
                          current.extraColumns = current.extraColumns.filter((item) => item.id !== column.id);
                          current.activities = current.activities
                            .map((activity) => ({ ...activity, columns: activity.columns.filter((item) => item !== key) }))
                            .filter((activity) => activity.columns.length);
                          return current;
                        });
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))}
                <div className="mdp-extra">
                  <input placeholder="Nouvelle colonne (ex. Apex)" value={newColumnName} onChange={(event) => setNewColumnName(event.target.value)} />
                  <button
                    className="mdp-btn"
                    type="button"
                    onClick={() => {
                      const name = newColumnName.trim();
                      if (!name) return;
                      update((current) => {
                        current.extraColumns.push({ id: newId("col"), name });
                        return current;
                      });
                      setNewColumnName("");
                    }}
                  >
                    Ajouter
                  </button>
                </div>
                <button className="mdp-btn mdp-panel__import" type="button" onClick={importLastYear}>
                  Réimporter le dimanche de l'an dernier
                </button>
              </>
            ) : selected ? (
              <>
                <h3>Activité</h3>
                <label className="mdp-field">
                  <span>Titre</span>
                  <input value={selected.title} onChange={(event) => updateSelected({ title: event.target.value })} />
                </label>
                <div className="mdp-field-row">
                  <label className="mdp-field">
                    <span>Début</span>
                    <select value={selected.start} onChange={(event) => updateSelected({ start: event.target.value })}>
                      {timeOptions.map((time) => (
                        <option key={time}>{time}</option>
                      ))}
                    </select>
                  </label>
                  <label className="mdp-field">
                    <span>Fin</span>
                    <select value={selected.end} onChange={(event) => updateSelected({ end: event.target.value })}>
                      {timeOptions.map((time) => (
                        <option key={time}>{time}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <label className="mdp-field">
                  <span>Catégorie</span>
                  <select value={selected.category} onChange={(event) => updateSelected({ category: event.target.value })}>
                    {PROGRAMME_CATEGORIES.map((category) => (
                      <option key={category.value} value={category.value}>
                        {category.label}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="mdp-field-row">
                  <label className="mdp-field">
                    <span>Lieu (liste ou texte)</span>
                    <input list="mdp-places" value={selected.place} onChange={(event) => updateSelected({ place: event.target.value })} />
                    <datalist id="mdp-places">
                      {COQUE_PLACES.map((place) => (
                        <option key={place} value={place} />
                      ))}
                    </datalist>
                  </label>
                  <label className="mdp-field">
                    <span>Responsable</span>
                    <input value={selected.owner} onChange={(event) => updateSelected({ owner: event.target.value })} />
                  </label>
                </div>
                <label className="mdp-field">
                  <span>Note / consignes</span>
                  <textarea rows="2" value={selected.note} onChange={(event) => updateSelected({ note: event.target.value })} />
                </label>
                <div className="mdp-field">
                  <span>
                    Colonnes ({selected.columns.length}){" "}
                    <button
                      className="mdp-linkbtn"
                      type="button"
                      onClick={() =>
                        updateSelected({
                          columns: [
                            ...new Set([
                              ...selected.columns,
                              ...columns.filter((column) => column.kind === "team" || column.kind === "subrole").map((column) => column.key),
                            ]),
                          ],
                        })
                      }
                    >
                      toutes les équipes
                    </button>
                  </span>
                  <div className="mdp-collist">
                    {[
                      ["general", "Général"],
                      ["team", "Équipes"],
                      ["subrole", "Sous-rôles"],
                      ["extra", "Colonnes libres"],
                    ].map(([kind, label]) => {
                      const group = columns.filter((column) => column.kind === kind);
                      if (!group.length) return null;
                      return (
                        <div key={kind}>
                          <p className="mdp-collist__group">{label}</p>
                          {group.map((column) => (
                            <label key={column.key}>
                              <input
                                checked={activityMatchesColumn(selected, column)}
                                type="checkbox"
                                onChange={(event) =>
                                  updateSelected({
                                    columns: event.target.checked
                                      ? [...selected.columns, column.key]
                                      : selected.columns.filter(
                                          (key) => key !== column.key && !(column.kind === "subrole" && key === `team:${column.teamId}`),
                                        ),
                                  })
                                }
                              />
                              {column.kind === "subrole" ? `${column.teamName} › ${column.name}` : column.name}
                            </label>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div className="mdp-panel__actions">
                  <button
                    className="mdp-btn"
                    type="button"
                    onClick={() => {
                      const id = newId("act");
                      update((current) => {
                        current.activities.push({ ...selected, id, columns: [...selected.columns] });
                        return current;
                      });
                      setSelectedId(id);
                    }}
                  >
                    Dupliquer
                  </button>
                  <button
                    className="mdp-btn mdp-btn--danger"
                    type="button"
                    onClick={() => {
                      if (!window.confirm(`Supprimer « ${selected.title} » (${selected.columns.length} colonne(s)) ?`)) return;
                      update((current) => {
                        current.activities = current.activities.filter((activity) => activity.id !== selected.id);
                        return current;
                      });
                      setSelectedId(null);
                    }}
                  >
                    Supprimer
                  </button>
                  <button className="mdp-btn mdp-panel__close" type="button" onClick={() => setSelectedId(null)}>
                    Fermer
                  </button>
                </div>
              </>
            ) : (
              <>
                <h3>Activité</h3>
                <p className="mdp-muted">
                  Cliquez sur un bloc pour le modifier, ou sur une case vide pour ajouter une activité à cette heure dans cette colonne.
                </p>
                <p className="mdp-muted">
                  {programme.activities.length} activités · {columns.length} colonnes · 8:00 à 20:00 par 15 min.
                </p>
              </>
            )}
          </aside>
        </div>
      )}
    </section>
  );
}

