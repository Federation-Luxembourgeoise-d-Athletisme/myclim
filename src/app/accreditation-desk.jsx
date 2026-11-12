import { useMemo, useState } from "react";

// Guichet des accréditations, le jour J (Margot, 12/11/2026 : une page à part,
// ouverte seulement depuis le bouton « Guichet » du module). On tape le nom de
// la personne, on voit la boîte où son badge est rangé, on clique « Remis ».
// Seuls les badges imprimés apparaissent ici.

function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

export function AccreditationDesk({ rows, storageLocations, onBack }) {
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
          ← Module accréditations
        </button>
        <h2>Guichet des accréditations</h2>
        <span className="acc-desk__counts">
          <strong>{counts.done}</strong> à remettre · <strong>{counts.given}</strong> remis
        </span>
      </div>
      <input
        aria-label="Rechercher une personne"
        autoFocus
        className="acc-desk__search"
        placeholder="Nom de la personne qui vient chercher son badge…"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <label className="acc-desk__toggle">
        <input checked={showGiven} type="checkbox" onChange={(event) => setShowGiven(event.target.checked)} />
        Afficher aussi les badges déjà remis
      </label>
      <div className="acc-desk__list">
        {shown.length === 0 ? (
          <p className="acc-desk__empty">
            {needle ? "Aucun badge imprimé à ce nom. Vérifiez l'orthographe, ou s'il est encore « à imprimer » dans le module." : "Aucun badge à remettre."}
          </p>
        ) : null}
        {shown.map((row) => (
          <div key={row.key} className={`acc-desk__row${row.step === "given" ? " acc-desk__row--given" : ""}`}>
            <div className="acc-desk__who">
              <strong>{row.name}</strong>
              <span>
                {row.kind}
                {row.role ? ` · ${row.role}` : ""}
              </span>
            </div>
            <label className="acc-desk__box">
              <span>Boîte</span>
              <select value={row.location} onChange={(event) => row.setLocation(event.target.value)}>
                <option value="">À ranger…</option>
                {storageLocations.map((location) => (
                  <option key={location} value={location}>
                    {location}
                  </option>
                ))}
              </select>
            </label>
            {row.step === "done" ? (
              <button className="button button--primary" type="button" onClick={row.handOver}>
                Remis
              </button>
            ) : (
              <span className="acc-step acc-step--given">Remis</span>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
