import { useMemo, useState } from "react";
import { useTr } from "./use-tr";

// Guichet des accréditations, le jour J (Margot, 12/11/2026 : une page à part,
// ouverte seulement depuis le bouton « Guichet » du module). On tape le nom de
// la personne, on voit la boîte où son badge est rangé, on clique « Remis ».
// Seuls les badges imprimés apparaissent ici. En français et en anglais : le
// guichet peut être tenu par des bénévoles qui ne parlent pas français.

// Types de badge (row.kind, en français) affichés dans la langue choisie.
const KIND_EN = { "Bénévole": "Volunteer", "Juge": "Judge", "Presse": "Press", "Course nationale": "National race" };

function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

export function AccreditationDesk({ rows, storageLocations, onBack }) {
  const tr = useTr();
  const [search, setSearch] = useState("");
  const [showGiven, setShowGiven] = useState(false);
  const needle = normalize(search.trim());
  const counts = useMemo(
    () => ({ done: rows.filter((row) => row.step === "done").length, given: rows.filter((row) => row.step === "given").length }),
    [rows],
  );
  const shown = rows
    .filter((row) => (showGiven ? true : row.step === "done"))
    .filter((row) => !needle || normalize(`${row.name} ${row.role}`).includes(needle))
    .sort((left, right) => left.name.localeCompare(right.name, "fr"));

  return (
    <section className="acc-desk">
      <div className="acc-desk__head">
        <button className="acc-desk__back" type="button" onClick={onBack}>
          {tr("← Module accréditations", "← Accreditations module")}
        </button>
        <h2>{tr("Guichet des accréditations", "Accreditation desk")}</h2>
        <span className="acc-desk__counts">
          <strong>{counts.done}</strong> {tr("à remettre", "to hand over")} · <strong>{counts.given}</strong> {tr("remis", "handed over")}
        </span>
      </div>
      <input
        aria-label={tr("Rechercher une personne", "Search for a person")}
        autoFocus
        className="acc-desk__search"
        placeholder={tr("Nom de la personne qui vient chercher son badge…", "Name of the person collecting their badge…")}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <label className="acc-desk__toggle">
        <input checked={showGiven} type="checkbox" onChange={(event) => setShowGiven(event.target.checked)} />
        {tr("Afficher aussi les badges déjà remis", "Also show badges already handed over")}
      </label>
      <div className="acc-desk__list">
        {shown.length === 0 ? (
          <p className="acc-desk__empty">
            {needle
              ? tr(
                  "Aucun badge imprimé à ce nom. Vérifiez l'orthographe, ou s'il est encore « à imprimer » dans le module.",
                  "No printed badge under this name. Check the spelling, or whether it is still \"to print\" in the module.",
                )
              : tr("Aucun badge à remettre.", "No badge to hand over.")}
          </p>
        ) : null}
        {shown.map((row) => (
          <div key={row.key} className={`acc-desk__row${row.step === "given" ? " acc-desk__row--given" : ""}`}>
            <div className="acc-desk__who">
              <strong>{row.name}</strong>
              <span>
                {tr(row.kind, KIND_EN[row.kind] || row.kind)}
                {row.role ? ` · ${row.role}` : ""}
              </span>
            </div>
            <label className="acc-desk__box">
              <span>{tr("Boîte", "Box")}</span>
              <select value={row.location} onChange={(event) => row.setLocation(event.target.value)}>
                <option value="">{tr("À ranger…", "To file…")}</option>
                {storageLocations.map((location) => (
                  <option key={location} value={location}>
                    {location}
                  </option>
                ))}
              </select>
            </label>
            {row.step === "done" ? (
              <button className="button button--primary" type="button" onClick={row.handOver}>
                {tr("Remis", "Handed over")}
              </button>
            ) : (
              <span className="acc-step acc-step--given">{tr("Remis", "Handed over")}</span>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
