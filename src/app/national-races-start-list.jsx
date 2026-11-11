import { Fragment } from "react";
import { getBestTimeSummary, isNationalRacePacer } from "./national-races-helpers";
import { NATIONAL_RACE_MAX_HEATS, NATIONAL_RACE_MAX_LANES, buildNationalRaceStartList } from "./national-races-heats";
import { useNationalRacesAdminCopy } from "./national-races-admin-copy";

// Séries et couloirs d'une course : réglage admin (séries / couloirs) puis
// startlist dense par série, couloirs vides compris, et les retenus non placés.
// Les contrôles (couloir pris, série complète) sont faits par onPlace.
const range = (count) => Array.from({ length: count }, (_, index) => index + 1);

function AthleteCells({ request }) {
  const { copy } = useNationalRacesAdminCopy();
  const best = getBestTimeSummary(request);
  return (
    <>
      <td>
        <span className="natx-sl__name">{request.lastName.toUpperCase()} {request.firstName}</span>
        {isNationalRacePacer(request) ? <span className="natx-tag natx-tag--pacer">{copy.pacer}</span> : null}
      </td>
      <td className="natx-muted">{request.isLuxLicensed ? `LUX · ${request.club || "-"}` : [request.foreignCountry, request.foreignClub].filter(Boolean).join(" · ") || "-"}</td>
      <td>{best ? <span className="natx-time">{best.time}</span> : <span className="natx-muted">-</span>}</td>
    </>
  );
}

function PlacementSelects({ request, heats, lanes, takenLanes, onPlace, disabled }) {
  const { copy } = useNationalRacesAdminCopy();
  const text = copy.heats;
  const name = `${request.firstName} ${request.lastName}`;
  return (
    <>
      <td>
        <select
          aria-label={`${text.colHeat} · ${name}`}
          className="natx-sl__select"
          disabled={disabled}
          value={request.heat ?? ""}
          onChange={(event) => onPlace(request, event.target.value ? Number(event.target.value) : null, null)}
        >
          <option value="">{text.none}</option>
          {range(heats).map((heat) => <option key={heat} value={heat}>{heat}</option>)}
        </select>
      </td>
      <td>
        <select
          aria-label={`${text.colLane} · ${name}`}
          className="natx-sl__select"
          disabled={disabled || !request.heat || request.heat > heats}
          value={request.heat && request.heat <= heats ? request.lane ?? "" : ""}
          onChange={(event) => onPlace(request, request.heat, event.target.value ? Number(event.target.value) : null)}
        >
          <option value="">{text.none}</option>
          {range(lanes).map((lane) => (
            <option key={lane} value={lane}>{lane}{takenLanes?.has(lane) && lane !== request.lane ? ` ${text.laneTaken}` : ""}</option>
          ))}
        </select>
      </td>
    </>
  );
}

function NationalRaceStartList({ race, raceRequests, config, isAdmin, isBusy, notice, onPlace, onSaveConfig }) {
  const { copy, fill } = useNationalRacesAdminCopy();
  const text = copy.heats;
  const startList = buildNationalRaceStartList(raceRequests, config);
  const total = startList.placedCount + startList.unplaced.length;
  const unplacedRequests = startList.unplaced.map((entry) => entry.request);

  return (
    <div className="natx-board">
      <div className="natx-toolbar">
        {isAdmin ? (
          <>
            <label className="natx-sl__setting">
              {text.settingsHeats}
              <select disabled={isBusy} value={config.heats} onChange={(event) => onSaveConfig(race, { heats: Number(event.target.value), lanes: config.lanes })}>
                {range(NATIONAL_RACE_MAX_HEATS).map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
            <label className="natx-sl__setting">
              {text.settingsLanes}
              <select disabled={isBusy} value={config.lanes} onChange={(event) => onSaveConfig(race, { heats: config.heats, lanes: Number(event.target.value) })}>
                {range(NATIONAL_RACE_MAX_LANES).map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
          </>
        ) : (
          <>
            <span className="natx-fact">{text.settingsHeats} <b>{config.heats}</b></span>
            <span className="natx-fact">{text.settingsLanes} <b>{config.lanes}</b></span>
            <span className="natx-muted">{text.settingsAdminOnly}</span>
          </>
        )}
        <span className="natx-spacer" />
        <span className="natx-muted">{text.hint}</span>
        <span className="natx-fact"><b>{fill(text.placed, { placed: startList.placedCount, total })}</b></span>
      </div>
      {/* Erreur de placement (couloir pris, série complète) au plus près de la startlist. */}
      {notice ? <p className="natx-alert natx-alert--danger natx-sl__notice" role="alert">{notice}</p> : null}

      {!total ? (
        <p className="natx-empty natx-sl__empty">{text.emptyRace}</p>
      ) : (
        <div className="natx-table-wrap">
          <table className="natx-table natx-sl">
            <thead>
              <tr>
                <th className="natx-sl__lane">{text.colLane}</th>
                <th>{text.colAthlete}</th>
                <th>{text.colLicence}</th>
                <th>{text.colBest}</th>
                <th className="natx-sl__pick">{text.colHeat}</th>
                <th className="natx-sl__pick">{text.colLane}</th>
                <th aria-label={copy.ui.colActions} />
              </tr>
            </thead>
            <tbody>
              {startList.heats.map((heatRow) => {
                const takenLanes = new Set(heatRow.entries.map((entry) => entry.lane));
                return (
                  <Fragment key={heatRow.heat}>
                    <tr className={`natx-sl__heat${heatRow.full ? " natx-sl__heat--full" : ""}`}>
                      <th colSpan={7} scope="rowgroup">
                        <span>{fill(text.heatTitle, { heat: heatRow.heat })}</span>
                        <span className="natx-sl__count">{fill(text.heatCount, { count: heatRow.entries.length, lanes: heatRow.lanes })}</span>
                        {heatRow.full ? (
                          <span className="natx-tag natx-tag--full">{text.heatFull}</span>
                        ) : (
                          <span className="natx-sl__free">{fill(text.heatFree, { lanes: heatRow.freeLanes.join(", ") })}</span>
                        )}
                      </th>
                    </tr>
                    {range(heatRow.lanes).map((lane) => {
                      const entry = heatRow.entries.find((item) => item.lane === lane);
                      if (!entry) {
                        return (
                          <tr key={lane} className="natx-sl__row natx-sl__row--empty">
                            <td className="natx-sl__lane">{lane}</td>
                            <td colSpan={3}>
                              {unplacedRequests.length ? (
                                <select
                                  aria-label={`${fill(text.heatTitle, { heat: heatRow.heat })} · ${text.colLane} ${lane}`}
                                  className="natx-sl__select natx-sl__select--wide"
                                  disabled={isBusy}
                                  value=""
                                  onChange={(event) => {
                                    const request = unplacedRequests.find((item) => item.id === event.target.value);
                                    if (request) onPlace(request, heatRow.heat, lane);
                                  }}
                                >
                                  <option value="">{text.none}</option>
                                  {unplacedRequests.map((request) => (
                                    <option key={request.id} value={request.id}>
                                      {request.lastName.toUpperCase()} {request.firstName}{isNationalRacePacer(request) ? ` (${copy.pacerShort})` : ""}
                                    </option>
                                  ))}
                                </select>
                              ) : <span className="natx-muted">-</span>}
                            </td>
                            <td colSpan={3} />
                          </tr>
                        );
                      }
                      return (
                        <tr key={lane} className="natx-sl__row">
                          <td className="natx-sl__lane">{lane}</td>
                          <AthleteCells request={entry.request} />
                          <PlacementSelects
                            disabled={isBusy}
                            heats={config.heats}
                            lanes={config.lanes}
                            request={entry.request}
                            takenLanes={takenLanes}
                            onPlace={onPlace}
                          />
                          <td className="natx-row-actions">
                            <button className="natx-link" disabled={isBusy} type="button" onClick={() => onPlace(entry.request, null, null)}>{text.remove}</button>
                          </td>
                        </tr>
                      );
                    })}
                  </Fragment>
                );
              })}
              <tr className="natx-sl__heat natx-sl__heat--unplaced">
                <th colSpan={7} scope="rowgroup">
                  <span>{text.unplacedTitle}</span>
                  <span className="natx-sl__count">{startList.unplaced.length}</span>
                </th>
              </tr>
              {startList.unplaced.length ? (
                startList.unplaced.map(({ request, reason }) => {
                  const heatRow = startList.heats.find((row) => row.heat === request.heat);
                  return (
                    <tr key={request.id} className="natx-sl__row">
                      <td className="natx-sl__lane">-</td>
                      <AthleteCells request={request} />
                      <PlacementSelects
                        disabled={isBusy}
                        heats={config.heats}
                        lanes={config.lanes}
                        request={request}
                        takenLanes={heatRow ? new Set(heatRow.entries.map((entry) => entry.lane)) : null}
                        onPlace={onPlace}
                      />
                      <td className="natx-row-actions">
                        {reason ? <span className="natx-tag natx-tag--danger">{reason === "duplicate" ? text.reasonDuplicate : text.reasonOutOfRange}</span> : null}
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr><td className="natx-muted natx-sl__none" colSpan={7}>{text.unplacedEmpty}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export { NationalRaceStartList };
