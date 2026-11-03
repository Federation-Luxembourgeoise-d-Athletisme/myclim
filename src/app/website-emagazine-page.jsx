import { useEffect, useMemo, useRef, useState } from "react";
import { useActiveEdition, useSiteEditionYear } from "./edition";
import { fetchAllMeetingResults, useMeetingEditions, updateEdition } from "./meeting-history-hooks";
import { useAthleteRegistry, useAthletes } from "./athlete-portal-hooks";
import { useSponsors } from "../site/site-hooks";
import { FileUpload } from "./file-upload";
import { EmagazineStatsPanel } from "./website-emagazine-stats";
import "./website-emagazine-page.css";
import { emagazineStatsPageId, emagazineStatsPagesForEntry } from "../site/emagazine-stats";
import {
  buildMeetingStats,
  DEFAULT_CUTOUT_FRAME,
  DEFAULT_PHOTO_FRAME,
  fetchAthleteEventsFromWa,
  normalizePhotoFrame,
  photoFrameStyle,
  sameAthlete,
  searchWaAthletes,
  waCodeForEvent,
} from "../site/emagazine-athlete-data";
import {
  athleteDisplayName,
  buildAthleteLookup,
  buildEmagazinePageRegistry,
  buildOfficialStartlistGroups,
  normalizeEmagazineConfig,
} from "../site/site-emagazine-shared";

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function fieldLabelStyle() {
  return {
    fontSize: "0.75rem",
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: "#546770",
    display: "block",
    marginBottom: 6,
  };
}

function fieldInputStyle() {
  return {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 8,
    border: "1px solid #d5dee8",
    fontSize: "0.9rem",
    fontFamily: "inherit",
    boxSizing: "border-box",
    background: "#fff",
  };
}

function EmptyButton({ children, ...props }) {
  return (
    <button className="btn btn--secondary" type="button" style={{ fontSize: "0.8rem" }} {...props}>
      {children}
    </button>
  );
}

function moveItem(list, index, direction) {
  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= list.length) return list;
  const next = [...list];
  [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
  return next;
}

const A4_RATIO = 297 / 210;

// Imported pages are always shown on an A4 sheet: warn when the uploaded
// image is another format (it would show with white margins).
function A4FormatHint({ imageUrl }) {
  const [loaded, setLoaded] = useState(null);

  useEffect(() => {
    if (!imageUrl) return undefined;
    let cancelled = false;
    const image = new Image();
    image.onload = () => {
      if (!cancelled) setLoaded({ url: imageUrl, width: image.naturalWidth, height: image.naturalHeight });
    };
    image.src = imageUrl;
    return () => {
      cancelled = true;
    };
  }, [imageUrl]);

  const size = loaded?.url === imageUrl ? loaded : null;
  if (!size || !size.width) return null;
  const isA4 = Math.abs(size.height / size.width - A4_RATIO) / A4_RATIO <= 0.02;
  return (
    <p style={{ margin: 0, fontSize: "0.78rem", color: isA4 ? "#166534" : "#92400e" }}>
      {isA4
        ? `✅ A4 portrait format (${size.width} × ${size.height} px).`
        : `⚠️ Not A4 portrait (${size.width} × ${size.height} px): the page will show with white margins. Export it as A4 portrait (e.g. 2480 × 3508 px).`}
    </p>
  );
}

function SpecialRaceEditor({ title, race, onChange }) {
  const labelStyle = fieldLabelStyle();
  const inputStyle = fieldInputStyle();

  function set(field, value) {
    onChange({ ...race, [field]: value });
  }

  function updateParticipant(id, field, value) {
    onChange({
      ...race,
      participants: race.participants.map((participant) => (
        participant.id === id ? { ...participant, [field]: value } : participant
      )),
    });
  }

  function addParticipant() {
    onChange({
      ...race,
      participants: [
        ...race.participants,
        { id: `participant-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, lane: "", name: "", photoUrl: "", instagram: "", description: "", nationality: "", team: "" },
      ],
    });
  }

  function removeParticipant(id) {
    onChange({
      ...race,
      participants: race.participants.filter((participant) => participant.id !== id),
    });
  }

  return (
    <div style={{ display: "grid", gap: 16, padding: 18, border: "1px solid #dbe4ee", borderRadius: 14, background: "#fff" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ minWidth: 0, flex: "1 1 320px" }}>
          <h4 style={{ margin: 0, fontSize: "1rem", color: "#10253d" }}>{title}</h4>
          <p style={{ margin: "4px 0 0", color: "#6b7280", fontSize: "0.82rem" }}>
            This special race generates its own e-magazine start list page.
          </p>
        </div>
        <label style={{ display: "inline-flex", gap: 8, alignItems: "center", fontWeight: 700, fontSize: "0.85rem", marginLeft: "auto", flexShrink: 0, whiteSpace: "nowrap" }}>
          <input type="checkbox" checked={race.enabled} onChange={(event) => set("enabled", event.target.checked)} />
          Enabled
        </label>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 0.8fr", gap: 12 }}>
        <div>
          <label style={labelStyle}>Title</label>
          <input style={inputStyle} value={race.title} onChange={(event) => set("title", event.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>Subtitle</label>
          <input style={inputStyle} value={race.subtitle} onChange={(event) => set("subtitle", event.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>Event label</label>
          <input style={inputStyle} value={race.eventLabel} onChange={(event) => set("eventLabel", event.target.value)} placeholder="60m" />
        </div>
      </div>

      <div style={{ display: "grid", gap: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
          <strong style={{ color: "#10253d" }}>Participants</strong>
          <EmptyButton onClick={addParticipant}>+ Add participant</EmptyButton>
        </div>

        {race.participants.length === 0 ? (
          <p style={{ margin: 0, color: "#6b7280", fontSize: "0.82rem" }}>No participants entered yet.</p>
        ) : race.participants.map((participant) => (
          <div key={participant.id} style={{ display: "grid", gap: 10, padding: 14, border: "1px solid #e5edf5", borderRadius: 12, background: "#f8fbff" }}>
            <div style={{ display: "grid", gridTemplateColumns: "80px 1fr 120px", gap: 10 }}>
              <input style={inputStyle} value={participant.lane} onChange={(event) => updateParticipant(participant.id, "lane", event.target.value)} placeholder="Lane" />
              <input style={inputStyle} value={participant.name} onChange={(event) => updateParticipant(participant.id, "name", event.target.value)} placeholder="Name" />
              <input style={inputStyle} value={participant.nationality} onChange={(event) => updateParticipant(participant.id, "nationality", event.target.value)} placeholder="Nation" />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "start" }}>
              <input style={inputStyle} value={participant.photoUrl || ""} onChange={(event) => updateParticipant(participant.id, "photoUrl", event.target.value)} placeholder="Photo URL" />
              {participant.photoUrl ? (
                <img
                  src={participant.photoUrl}
                  alt={participant.name || "Participant preview"}
                  style={{ width: 54, height: 54, objectFit: "cover", borderRadius: 12, border: "1px solid #d5dee8", background: "#fff" }}
                />
              ) : null}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 10 }}>
              <input style={inputStyle} value={participant.instagram} onChange={(event) => updateParticipant(participant.id, "instagram", event.target.value)} placeholder="@instagram or handle" />
              <input style={inputStyle} value={participant.team} onChange={(event) => updateParticipant(participant.id, "team", event.target.value)} placeholder="Team / company" />
              <EmptyButton onClick={() => removeParticipant(participant.id)} style={{ color: "#c62828" }}>Remove</EmptyButton>
            </div>
            <input style={inputStyle} value={participant.description} onChange={(event) => updateParticipant(participant.id, "description", event.target.value)} placeholder="Profile / what they do" />
          </div>
        ))}
      </div>
    </div>
  );
}

// Framing of an athlete photo: drag the photo inside the frame, zoom with the
// slider. `cutout` frames the Luxembourg athlete portrait on its whole page.
function PhotoFramer({ url, frame, cutout = false, columns = 1, onChange }) {
  const defaults = cutout ? DEFAULT_CUTOUT_FRAME : DEFAULT_PHOTO_FRAME;
  const current = normalizePhotoFrame(frame, defaults);
  const drag = useRef(null);
  const height = 300;
  // Same proportions as the photo on the A4 page (794 × 1123).
  const width = Math.round(height * (cutout ? 794 : 794 / columns) / 1123);
  const pageScale = height / 1123;

  function update(patch) {
    onChange(normalizePhotoFrame({ ...current, ...patch }, defaults));
  }

  function handlePointerDown(event) {
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY, start: current };
  }

  function handlePointerMove(event) {
    if (!drag.current) return;
    const dx = event.clientX - drag.current.x;
    const dy = event.clientY - drag.current.y;
    const { start } = drag.current;
    if (cutout) {
      update({ x: start.x + dx / (4 * pageScale), y: start.y + dy / (6 * pageScale) });
    } else {
      // Dragging the photo to the right shows more of its left side.
      update({ x: start.x - (dx * 100) / width, y: start.y - (dy * 100) / height });
    }
  }

  function handlePointerUp() {
    drag.current = null;
  }

  const imageStyle = cutout
    ? {
      position: "absolute",
      left: 34 * pageScale,
      bottom: 0,
      height: 1000 * pageScale,
      width: "auto",
      transform: `translate(${(current.x - 50) * 4 * pageScale}px, ${(current.y - 50) * 6 * pageScale}px) scale(${current.zoom / 100})`,
      transformOrigin: "50% 100%",
    }
    : { width: "100%", height: "100%", objectFit: "cover", display: "block", ...photoFrameStyle(current) };

  if (!url) return null;

  return (
    <div style={{ display: "flex", gap: 14, alignItems: "flex-start", flexWrap: "wrap" }}>
      <div
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        title="Drag the photo to frame it"
        style={{
          position: "relative",
          width,
          height,
          flex: "none",
          overflow: "hidden",
          borderRadius: 8,
          border: "2px solid #10253d",
          background: cutout ? "#13253d" : "#e5e7eb",
          cursor: "grab",
          touchAction: "none",
          userSelect: "none",
        }}
      >
        <img src={url} alt="" draggable={false} style={{ ...imageStyle, pointerEvents: "none" }} />
      </div>
      <div style={{ display: "grid", gap: 8, minWidth: 160, flex: "1 1 160px" }}>
        <span style={{ fontSize: "0.8rem", color: "#546770" }}>Drag the photo in the frame to place it.</span>
        <label style={{ fontSize: "0.78rem", color: "#546770" }}>
          Zoom {current.zoom}%
          <span style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 4 }}>
            <EmptyButton onClick={() => update({ zoom: current.zoom - 10 })} aria-label="Zoom out">−</EmptyButton>
            <input
              type="range"
              min="100"
              max="300"
              step="5"
              value={current.zoom}
              onChange={(event) => update({ zoom: Number(event.target.value) })}
              style={{ flex: 1 }}
            />
            <EmptyButton onClick={() => update({ zoom: current.zoom + 10 })} aria-label="Zoom in">+</EmptyButton>
          </span>
        </label>
        <div>
          <EmptyButton onClick={() => onChange({ ...defaults })}>Reset framing</EmptyButton>
        </div>
      </div>
    </div>
  );
}

// Search box over the athlete database, with a World Athletics fallback.
function AthleteFinder({ athleteCards, onPick, disabled = false, placeholder = "Last or first name, from the athlete database" }) {
  const [search, setSearch] = useState("");
  const [waMatches, setWaMatches] = useState(null);
  const [message, setMessage] = useState("");
  const inputStyle = fieldInputStyle();

  const matches = useMemo(() => {
    const key = searchKey(search.trim());
    if (key.length < 2) return [];
    return athleteCards
      .filter((card) => searchKey(athleteDisplayName(card)).includes(key) || searchKey(`${card.lastName} ${card.firstName}`).includes(key))
      .slice(0, 8);
  }, [search, athleteCards]);

  async function searchWa() {
    setMessage("Searching World Athletics…");
    try {
      setWaMatches(await searchWaAthletes(search.trim()));
      setMessage("");
    } catch (error) {
      setMessage(error.message || "World Athletics did not answer.");
    }
  }

  function pick(person) {
    setSearch("");
    setWaMatches(null);
    onPick(person);
  }

  return (
    <div style={{ display: "grid", gap: 6 }}>
      <div style={{ display: "flex", gap: 8 }}>
        <input style={inputStyle} value={search} onChange={(event) => setSearch(event.target.value)} placeholder={placeholder} disabled={disabled} />
        <EmptyButton disabled={disabled || search.trim().length < 3} onClick={searchWa} style={{ fontSize: "0.8rem", whiteSpace: "nowrap" }}>
          Search on World Athletics
        </EmptyButton>
      </div>
      {message ? <span style={{ fontSize: "0.82rem", color: "#546770" }}>{message}</span> : null}
      {matches.length || waMatches ? (
        <div style={{ display: "grid", gap: 4, padding: 6, border: "1px solid #dbe4ee", borderRadius: 10, background: "#fff" }}>
          {matches.map((card) => (
            <button key={card._docId} type="button" className="emag-ed__page" onClick={() => pick(card)}>
              <span className="emag-ed__page-title">
                {athleteDisplayName(card)} {card.nationality ? `(${card.nationality})` : ""} {card.birthYear ? `· ${card.birthYear}` : ""}
                {card.waid ? "" : " · no WA ID"}
              </span>
            </button>
          ))}
          {(waMatches || []).map((person) => (
            <button key={person.waid} type="button" className="emag-ed__page" onClick={() => pick(person)}>
              <span className="emag-ed__page-title">
                World Athletics: {person.firstName} {person.lastName} ({person.country}){person.birthYear ? ` · ${person.birthYear}` : ""}
              </span>
            </button>
          ))}
          {waMatches && !waMatches.length ? <span style={{ fontSize: "0.82rem", color: "#6b7280" }}>Nobody found on World Athletics.</span> : null}
        </div>
      ) : null}
    </div>
  );
}

// Duel / 3 / 4 athletes: the athletes are saved with the page (name, flag,
// World Athletics PB in the page event, photo) so that the public sees them.
function HighlightEditor({ page, athleteCards, onChange }) {
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const labelStyle = fieldLabelStyle();
  const inputStyle = fieldInputStyle();
  const athleteSlotCount = page.type === "quatuor" ? 4 : page.type === "trio" ? 3 : page.type === "duel" ? 2 : 1;

  function set(field, value) {
    onChange({ ...page, [field]: value });
  }

  function setAthleteAt(index, athlete) {
    const next = [...page.athletes];
    next[index] = athlete;
    onChange({ ...page, athletes: next.filter(Boolean) });
  }

  async function pbFor(waid) {
    if (!waid || !page.event) return { pb: "", record: "" };
    const events = await fetchAthleteEventsFromWa(waid);
    const code = waCodeForEvent(page.event);
    const match = events.find((entry) => entry.disciplineCode === code)
      || events.find((entry) => entry.event.toLowerCase() === page.event.toLowerCase());
    return { pb: match?.pb || "", record: match?.record || "" };
  }

  async function pick(index, person) {
    setBusy("Loading the World Athletics PB…");
    setMessage("");
    const waid = person.waid ? String(person.waid) : "";
    let best = { pb: "", record: "" };
    try {
      best = await pbFor(waid);
      if (!waid) setMessage("No World Athletics ID in the database: search on World Athletics to get the PB.");
      else if (!page.event) setMessage("Fill in the event to get the PBs.");
      else if (!best.pb) setMessage(`No indoor ${page.event} PB on World Athletics.`);
    } catch (error) {
      setMessage(`World Athletics: ${error.message}`);
    }
    setAthleteAt(index, {
      id: waid ? `wa-${waid}` : `athlete-${index + 1}-${searchKey(person.lastName).replace(/[^a-z]/g, "")}`,
      firstName: person.firstName || "",
      lastName: person.lastName || "",
      nationality: person.nationality || person.country || "",
      waid,
      ...best,
      photoUrl: page.athletes[index]?.photoUrl || "",
    });
    setBusy("");
  }

  async function updatePbs() {
    setBusy("Updating the PBs from World Athletics…");
    setMessage("");
    try {
      const athletes = await Promise.all(page.athletes.map(async (athlete) => ({ ...athlete, ...(await pbFor(athlete.waid)) })));
      onChange({ ...page, athletes });
    } catch (error) {
      setMessage(`World Athletics: ${error.message}`);
    }
    setBusy("");
  }

  return (
    <EditorSection
      title={page.title || "Highlight page"}
      description="One full-height photo per athlete. Find each athlete by name: the flag and the PB in the page event come from World Athletics."
      actions={(
        <EmptyButton disabled={!page.event || !page.athletes.length || Boolean(busy)} onClick={updatePbs}>
          Update PBs from World Athletics
        </EmptyButton>
      )}
    >
      <div className="emag-ed__two-cols">
        <div>
          <label style={labelStyle}>Template</label>
          <select style={inputStyle} value={page.type} onChange={(event) => set("type", event.target.value)}>
            <option value="duel">Duel (2 athletes)</option>
            <option value="trio">3 athletes</option>
            <option value="quatuor">4 athletes</option>
          </select>
        </div>
        <div>
          <label style={labelStyle}>Event (for the PBs)</label>
          <input style={inputStyle} value={page.event} onChange={(event) => set("event", event.target.value)} placeholder="400m, 60m hurdles, Long Jump" />
        </div>
        <div>
          <label style={labelStyle}>Title</label>
          <input style={inputStyle} value={page.title} onChange={(event) => set("title", event.target.value)} placeholder="Athletes to watch" />
        </div>
        <div>
          <label style={labelStyle}>Subtitle</label>
          <input style={inputStyle} value={page.subtitle} onChange={(event) => set("subtitle", event.target.value)} placeholder="400m Men" />
        </div>
      </div>

      {busy || message ? <p style={{ margin: 0, fontSize: "0.84rem", color: busy ? "#1d4ed8" : "#92400e" }}>{busy || message}</p> : null}
      {!page.athletes.length && page.athleteIds.length ? (
        <p className="emag-ed__missing">Older page: pick the athletes again below so that the public sees them.</p>
      ) : null}

      <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(athleteSlotCount, 2)}, minmax(0, 1fr))`, gap: 12 }}>
        {Array.from({ length: athleteSlotCount }).map((_, index) => {
          const athlete = page.athletes[index];
          return (
            <div key={`${page.id}-athlete-${index}`} style={{ display: "grid", gap: 8, alignContent: "start", padding: 12, border: "1px solid #dbe4ee", borderRadius: 12, background: "#fff" }}>
              <label style={{ ...labelStyle, marginBottom: 0 }}>Athlete {index + 1}</label>
              {athlete ? (
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                  <span style={{ fontSize: "0.9rem", color: "#10253d" }}>
                    <strong>{athlete.firstName} {athlete.lastName}</strong> {athlete.nationality ? `(${athlete.nationality})` : ""}
                    <br />
                    <span style={{ color: "#6b7280", fontSize: "0.82rem" }}>
                      PB {page.event}: {athlete.pb ? `${athlete.pb}${athlete.record ? ` ${athlete.record}` : ""}` : "—"}
                    </span>
                  </span>
                  <EmptyButton onClick={() => onChange({ ...page, athletes: page.athletes.filter((_, position) => position !== index) })} style={{ color: "#c62828" }}>
                    Remove
                  </EmptyButton>
                </div>
              ) : null}
              {athlete || index === page.athletes.length ? (
                <AthleteFinder
                  athleteCards={athleteCards}
                  disabled={Boolean(busy)}
                  placeholder={athlete ? "Replace with…" : "Find the athlete by name"}
                  onPick={(person) => pick(index, person)}
                />
              ) : null}
              {athlete ? (
                <>
                  <FileUpload
                    value={athlete.photoUrl}
                    onChange={(url) => setAthleteAt(index, { ...athlete, photoUrl: url, photoFrame: { ...DEFAULT_PHOTO_FRAME } })}
                    accept="image/*"
                    storagePath="emagazine-athlete-photos"
                    label="Photo (portrait, full height of the page)"
                  />
                  <PhotoFramer
                    url={athlete.photoUrl}
                    frame={athlete.photoFrame}
                    columns={athleteSlotCount}
                    onChange={(photoFrame) => setAthleteAt(index, { ...athlete, photoFrame })}
                  />
                </>
              ) : null}
            </div>
          );
        })}
      </div>
    </EditorSection>
  );
}

function PartnerPageEditor({ page, sponsors, onChange }) {
  const labelStyle = fieldLabelStyle();
  const inputStyle = fieldInputStyle();

  function set(field, value) {
    onChange({ ...page, [field]: value });
  }

  return (
    <div style={{ display: "grid", gap: 14, padding: 18, border: "1px solid #dbe4ee", borderRadius: 14, background: "#fff" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <div>
          <h4 style={{ margin: 0, fontSize: "1rem", color: "#10253d" }}>{page.headline || "Partner page"}</h4>
          <p style={{ margin: "4px 0 0", color: "#6b7280", fontSize: "0.82rem" }}>Choose a sponsor and optionally add a dedicated visual/story.</p>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div>
          <label style={labelStyle}>Sponsor</label>
          <select style={inputStyle} value={page.sponsorId} onChange={(event) => set("sponsorId", event.target.value)}>
            <option value="">Select sponsor</option>
            {sponsors.map((sponsor) => (
              <option key={sponsor.id} value={sponsor.id}>{sponsor.name || sponsor.id}</option>
            ))}
          </select>
        </div>
        <div>
          <label style={labelStyle}>Headline</label>
          <input style={inputStyle} value={page.headline} onChange={(event) => set("headline", event.target.value)} placeholder="Headline shown on the page" />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
        <input style={inputStyle} value={page.imageUrl} onChange={(event) => set("imageUrl", event.target.value)} placeholder="Full page image URL" />
        <input style={inputStyle} value={page.ctaLabel} onChange={(event) => set("ctaLabel", event.target.value)} placeholder="CTA label" />
        <input style={inputStyle} value={page.ctaUrl} onChange={(event) => set("ctaUrl", event.target.value)} placeholder="CTA URL" />
      </div>

      <textarea
        style={{ ...inputStyle, minHeight: 90, resize: "vertical" }}
        value={page.body}
        onChange={(event) => set("body", event.target.value)}
        placeholder="Optional sponsor story / ad copy"
      />
    </div>
  );
}

const COUNTRY_NAMES = { LUX: "Luxembourg" };

function searchKey(value) {
  return String(value || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function AthletePageEditor({ page, athleteCards, onChange }) {
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const meetingResults = useRef(null);
  const labelStyle = fieldLabelStyle();
  const inputStyle = fieldInputStyle();
  const set = (patch) => onChange({ ...page, ...patch });

  async function meetingStatsFor(person) {
    meetingResults.current ||= await fetchAllMeetingResults();
    return buildMeetingStats(meetingResults.current.filter((row) => sameAthlete(row, person)));
  }

  async function waPatch(waid) {
    const events = await fetchAthleteEventsFromWa(waid);
    return { waid: String(waid), events, waUpdatedAt: new Date().toISOString().slice(0, 10) };
  }

  // Fills the page from the athlete database, then World Athletics.
  async function pick(person) {
    setBusy("Loading the athlete…");
    setMessage("");
    const nationality = person.nationality || person.country || "";
    let next = {
      ...page,
      firstName: person.firstName || page.firstName,
      lastName: person.lastName || page.lastName,
      country: COUNTRY_NAMES[nationality] || nationality || page.country,
      waid: person.waid ? String(person.waid) : "",
    };
    const problems = [];
    try {
      next.meetingStats = await meetingStatsFor(next);
    } catch (error) {
      problems.push(`meeting results: ${error.message}`);
    }
    if (next.waid) {
      try {
        next = { ...next, ...(await waPatch(next.waid)) };
      } catch (error) {
        problems.push(`World Athletics: ${error.message}`);
      }
    } else {
      problems.push("no World Athletics ID in the database: use \"Search on World Athletics\"");
    }
    onChange(next);
    setBusy("");
    setMessage(problems.length ? `Loaded, except ${problems.join("; ")}.` : "Loaded from the athlete database, World Athletics and the meeting results.");
  }

  async function run(label, task) {
    setBusy(label);
    setMessage("");
    try {
      await task();
    } catch (error) {
      setMessage(error.message || "Something went wrong.");
    } finally {
      setBusy("");
    }
  }

  const shownCount = page.events.filter((entry) => entry.shown).length;
  const stats = page.meetingStats;

  return (
    <EditorSection
      title="Luxembourg athlete"
      description="Search the athlete by name: the bests come from World Athletics and the history from the meeting results. Only the photo and the short text are typed in."
    >
      <div>
        <label style={labelStyle}>Find the athlete</label>
        <AthleteFinder athleteCards={athleteCards} onPick={pick} disabled={Boolean(busy)} />
      </div>

      {busy || message ? (
        <p style={{ margin: 0, fontSize: "0.84rem", color: busy ? "#1d4ed8" : "#546770" }}>{busy || message}</p>
      ) : null}

      <div className="emag-ed__two-cols">
        <div>
          <label style={labelStyle}>First name</label>
          <input style={inputStyle} value={page.firstName} onChange={(event) => set({ firstName: event.target.value })} />
        </div>
        <div>
          <label style={labelStyle}>Last name</label>
          <input style={inputStyle} value={page.lastName} onChange={(event) => set({ lastName: event.target.value })} />
        </div>
        <div>
          <label style={labelStyle}>Country</label>
          <input style={inputStyle} value={page.country} onChange={(event) => set({ country: event.target.value })} placeholder="Luxembourg" />
        </div>
        <div>
          <label style={labelStyle}>World Athletics ID</label>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input style={inputStyle} value={page.waid} onChange={(event) => set({ waid: event.target.value.replace(/\D/g, "") })} placeholder="14621598" />
            {page.waid ? (
              <a href={`https://worldathletics.org/athletes/_/${page.waid}`} target="_blank" rel="noopener noreferrer" style={{ fontSize: "0.8rem", whiteSpace: "nowrap" }}>
                WA profile
              </a>
            ) : null}
          </div>
        </div>
      </div>

      <FileUpload
        value={page.photoUrl}
        onChange={(url) => set({ photoUrl: url, photoFrame: { ...DEFAULT_CUTOUT_FRAME } })}
        accept="image/*"
        storagePath="emagazine-athletes"
        label="Photo (portrait, cut-out PNG, full body)"
      />
      <PhotoFramer url={page.photoUrl} frame={page.photoFrame} cutout onChange={(photoFrame) => set({ photoFrame })} />

      <div style={{ display: "grid", gap: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <label style={{ ...labelStyle, marginBottom: 0 }}>
            Indoor bests — World Athletics{page.waUpdatedAt ? `, updated ${page.waUpdatedAt}` : ""}
          </label>
          <EmptyButton
            disabled={!page.waid || Boolean(busy)}
            onClick={() => run("Loading World Athletics…", async () => set(await waPatch(page.waid)))}
          >
            Update from World Athletics
          </EmptyButton>
        </div>
        {page.events.length ? (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.86rem" }}>
            <thead>
              <tr style={{ textAlign: "left", color: "#6b7280" }}>
                <th style={{ padding: "4px 6px" }}>On the page</th>
                <th style={{ padding: "4px 6px" }}>Event</th>
                <th style={{ padding: "4px 6px" }}>PB</th>
                <th style={{ padding: "4px 6px" }}>Record</th>
                <th style={{ padding: "4px 6px" }}>SB</th>
              </tr>
            </thead>
            <tbody>
              {page.events.map((entry) => (
                <tr key={entry.id} style={{ borderTop: "1px solid #e5e7eb" }}>
                  <td style={{ padding: "6px" }}>
                    <input
                      type="checkbox"
                      checked={entry.shown}
                      disabled={!entry.shown && shownCount >= 3}
                      onChange={(event) => set({
                        events: page.events.map((item) => (item.id === entry.id ? { ...item, shown: event.target.checked } : item)),
                      })}
                      aria-label={`Show ${entry.event} on the page`}
                    />
                  </td>
                  <td style={{ padding: "6px", fontWeight: 700 }}>{entry.event}</td>
                  <td style={{ padding: "6px" }}>{entry.pb}{entry.pbYear ? ` (${entry.pbYear})` : ""}</td>
                  <td style={{ padding: "6px" }}>{entry.record || "—"}</td>
                  <td style={{ padding: "6px" }}>{entry.sb ? `${entry.sb} (${entry.sbYear})` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p style={{ margin: 0, fontSize: "0.84rem", color: "#6b7280" }}>Find the athlete above, or enter the World Athletics ID and update.</p>
        )}
        <p style={{ margin: 0, fontSize: "0.78rem", color: "#6b7280" }}>Up to 3 events on the page.</p>
      </div>

      <div style={{ display: "grid", gap: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <label style={{ ...labelStyle, marginBottom: 0, display: "flex", gap: 8, alignItems: "center" }}>
            <input type="checkbox" checked={page.showMeetingStats} onChange={(event) => set({ showMeetingStats: event.target.checked })} />
            At the meeting — from the meeting results
          </label>
          <EmptyButton
            disabled={!page.lastName || Boolean(busy)}
            onClick={() => run("Reading the meeting results…", async () => set({ meetingStats: await meetingStatsFor(page) }))}
          >
            Recalculate
          </EmptyButton>
        </div>
        <p style={{ margin: 0, fontSize: "0.86rem", color: "#10253d" }}>
          {stats
            ? `${stats.editions} edition(s) since ${stats.firstYear} · ${stats.wins} win(s) · best: ${stats.bests.map((best) => `${best.event} ${best.mark} (${best.year})`).join(", ")}`
            : "No result at the meeting found under this name."}
        </p>
      </div>

      <div>
        <label style={labelStyle}>Short text (optional)</label>
        <textarea
          style={{ ...inputStyle, minHeight: 80, resize: "vertical" }}
          value={page.text}
          onChange={(event) => set({ text: event.target.value })}
          placeholder="A few lines about the athlete, up to about 35 words"
        />
      </div>
    </EditorSection>
  );
}

const PAGE_SECTIONS = {
  core: "Opening",
  special: "Special races",
  athlete: "Luxembourg athletes",
  highlight: "Highlights",
  partner: "Partners",
  auto: "Start lists",
  closing: "Closing",
};

const STATUS_COLORS = {
  ready: "#16a34a",
  missing: "#f59e0b",
  off: "#9ca3af",
};

function highlightSlotCount(type) {
  return type === "quatuor" ? 4 : type === "trio" ? 3 : type === "duel" ? 2 : 1;
}

function wordCount(text) {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

// What still has to be filled in before a page looks finished in the magazine.
function pageReadiness(page, draft, startlistById) {
  const missing = [];
  if (page.id === "welcome") {
    if (!draft.welcome.body.trim()) missing.push("the message");
    if (!draft.welcome.personName.trim()) missing.push("the signatory's name");
    if (!draft.welcome.photoUrl) missing.push("the portrait");
  } else if (page.id === "thanks") {
    if (!draft.thanks.names.length) missing.push("the people to thank");
    if (!draft.thanks.closing.trim()) missing.push("the closing words");
  } else if (page.kind === "athlete") {
    const athlete = draft.athletePages.find((entry) => entry.id === page.sourceId);
    if (athlete) {
      if (!athlete.firstName.trim() || !athlete.lastName.trim()) missing.push("the name");
      if (!athlete.photoUrl) missing.push("the photo");
      if (!athlete.events.some((entry) => entry.shown)) missing.push("the World Athletics bests");
    }
  } else if (page.kind === "special") {
    const race = draft.specialRaces[page.id.replace("special:", "")];
    if (!race?.enabled) return { state: "off", missing: [] };
    if (!race.participants.length) missing.push("the participants");
  } else if (page.kind === "highlight") {
    const highlight = draft.highlightPages.find((entry) => entry.id === page.sourceId);
    if (highlight) {
      const slots = highlightSlotCount(highlight.type);
      if (highlight.athletes.length < slots) missing.push(`${slots - highlight.athletes.length} athlete(s)`);
      const withoutPhoto = highlight.athletes.filter((athlete) => !athlete.photoUrl).length;
      if (withoutPhoto) missing.push(`${withoutPhoto} athlete photo(s)`);
    }
  } else if (page.kind === "partner") {
    const partner = draft.partnerPages.find((entry) => entry.id === page.sourceId);
    if (!partner?.sponsorId) missing.push("the sponsor");
  } else if (page.kind === "auto") {
    const groupId = page.id.replace("official-startlist:", "");
    if (!draft.startlistPhotos[groupId]) missing.push("the event photo");
    if (!startlistById.get(groupId)?.entries.length) missing.push("athletes (none imported yet)");
  }
  return { state: missing.length ? "missing" : "ready", missing };
}

function StatusDot({ state }) {
  return (
    <span
      aria-hidden="true"
      style={{ width: 9, height: 9, borderRadius: "50%", flex: "none", background: STATUS_COLORS[state] }}
    />
  );
}

function EditorSection({ title, description, children, actions = null }) {
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "start", flexWrap: "wrap" }}>
        <div style={{ minWidth: 0, flex: "1 1 280px" }}>
          <h3 style={{ margin: 0, color: "#10253d" }}>{title}</h3>
          {description ? <p style={{ margin: "6px 0 0", color: "#6b7280", fontSize: "0.84rem" }}>{description}</p> : null}
        </div>
        {actions}
      </div>
      {children}
    </div>
  );
}

export function WebsiteEmagazinePage({ Panel }) {
  const { editions, loading: editionsLoading } = useMeetingEditions();
  const { siteEditionYear } = useSiteEditionYear();
  const { registry } = useAthleteRegistry(true);
  const { activeEditionId } = useActiveEdition();
  const { athletes } = useAthletes(true, activeEditionId);
  const { sponsors } = useSponsors(false);

  const defaultYear = siteEditionYear ?? editions.find((edition) => !edition.isClosed)?.year ?? editions[0]?.year ?? null;
  const [selectedYear, setSelectedYear] = useState(null);
  const effectiveYear = selectedYear ?? defaultYear;
  const selectedEdition = editions.find((edition) => edition.year === effectiveYear) ?? null;
  const [draft, setDraft] = useState(null);
  const [savedSnapshot, setSavedSnapshot] = useState("");
  const [saving, setSaving] = useState(false);
  const [statusSaving, setStatusSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [selectedPageId, setSelectedPageId] = useState("cover");
  const [showAudience, setShowAudience] = useState(false);
  const [previewFrame, setPreviewFrame] = useState(null);
  const [previewReady, setPreviewReady] = useState(false);

  useEffect(() => {
    if (!selectedEdition) return;
    const config = deepClone(normalizeEmagazineConfig(selectedEdition.emagazine, selectedEdition));
    setDraft(config);
    setSavedSnapshot(JSON.stringify(config));
  }, [selectedEdition]);

  const athleteCards = useMemo(
    () => [...buildAthleteLookup(registry, athletes).values()],
    [registry, athletes],
  );



  const activeSponsors = useMemo(
    () => sponsors.filter((sponsor) => sponsor.active),
    [sponsors],
  );

  const pageRegistry = useMemo(
    () => buildEmagazinePageRegistry(draft || normalizeEmagazineConfig(null, selectedEdition), selectedEdition),
    [draft, selectedEdition],
  );

  const pageRegistryMap = useMemo(
    () => new Map(pageRegistry.map((page) => [page.id, page])),
    [pageRegistry],
  );

  const visiblePages = useMemo(
    () => (draft?.pageOrder || []).map((pageId) => pageRegistryMap.get(pageId)).filter(Boolean),
    [draft?.pageOrder, pageRegistryMap],
  );

  const statsPageOrder = useMemo(
    () => (draft ? visiblePages.flatMap((page) => emagazineStatsPagesForEntry(page, draft)) : [])
      .map((page) => ({ statsId: emagazineStatsPageId(page.key), title: page.title })),
    [visiblePages, draft],
  );

  // Athletes only count for the edition the athlete portal is working on.
  const startlistById = useMemo(
    () => new Map(buildOfficialStartlistGroups(selectedEdition?.disciplines || [], athletes).map((group) => [group.id, group])),
    [selectedEdition?.disciplines, athletes],
  );

  const hiddenPages = useMemo(
    () => pageRegistry.filter((page) => !(draft?.pageOrder || []).includes(page.id)),
    [pageRegistry, draft?.pageOrder],
  );

  const readinessById = useMemo(
    () => new Map(draft ? pageRegistry.map((page) => [page.id, pageReadiness(page, draft, startlistById)]) : []),
    [pageRegistry, draft, startlistById],
  );

  const selectedPage = pageRegistryMap.get(selectedPageId) || visiblePages[0] || null;

  // The preview frame rebuilds the selected page from the unsaved draft.
  useEffect(() => {
    function handleMessage(event) {
      if (event.origin === window.location.origin && event.data?.type === "emag-frame-ready") setPreviewReady(true);
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  useEffect(() => {
    if (!previewFrame?.contentWindow || !previewReady || !draft || !selectedPage) return undefined;
    const timer = window.setTimeout(() => {
      previewFrame.contentWindow.postMessage(
        { type: "emag-draft", year: effectiveYear, config: draft, pageId: selectedPage.id },
        window.location.origin,
      );
    }, 250);
    return () => window.clearTimeout(timer);
  }, [previewFrame, previewReady, draft, selectedPage, effectiveYear]);

  if (editionsLoading || !selectedEdition || !draft) {
    return (
      <Panel title="E-magazine" subtitle="Loading the editorial configuration">
        <p className="panel-note">Preparing the current edition…</p>
      </Panel>
    );
  }

  const labelStyle = fieldLabelStyle();
  const inputStyle = fieldInputStyle();
  const isDirty = JSON.stringify(draft) !== savedSnapshot;
  const publicationStatus = selectedEdition.emagazineStatus || "published";
  const countedPages = visiblePages.filter((page) => readinessById.get(page.id)?.state !== "off");
  const readyCount = countedPages.filter((page) => readinessById.get(page.id)?.state === "ready").length;

  async function handleSave() {
    setSaving(true);
    setStatus("");
    try {
      await updateEdition(effectiveYear, { emagazine: draft });
      setSavedSnapshot(JSON.stringify(draft));
      setStatus("Saved");
    } catch (error) {
      setStatus(error.message || "Unable to save the e-magazine settings.");
    } finally {
      setSaving(false);
    }
  }

  async function handlePublicationStatusChange(nextStatus) {
    setStatusSaving(true);
    setStatus("");
    try {
      await updateEdition(effectiveYear, { emagazineStatus: nextStatus });
      setStatus(nextStatus === "published" ? "Published on the public site" : "Set offline");
    } catch (error) {
      setStatus(error.message || "Unable to update the e-magazine publication status.");
    } finally {
      setStatusSaving(false);
    }
  }

  function handleEditionChange(year) {
    if (isDirty && !window.confirm("You have unsaved changes. Switch edition and lose them?")) return;
    setSelectedYear(year);
    setSelectedPageId("cover");
  }

  function updatePageOrder(updater) {
    setDraft((current) => ({ ...current, pageOrder: updater(current.pageOrder || []) }));
  }

  function appendHighlightPage() {
    const id = `highlight-${Date.now()}`;
    setDraft((current) => ({
      ...current,
      highlightPages: [
        ...current.highlightPages,
        { id, type: "duel", title: "", subtitle: "", body: "", imageUrl: "", event: "", athletes: [], athleteIds: [], athletePhotos: {} },
      ],
      pageOrder: [...current.pageOrder, `highlight:${id}`],
    }));
    setSelectedPageId(`highlight:${id}`);
  }

  function appendAthletePage() {
    const id = `athlete-${Date.now()}`;
    setDraft((current) => ({
      ...current,
      athletePages: [
        ...current.athletePages,
        {
          id,
          firstName: "",
          lastName: "",
          country: "Luxembourg",
          waid: "",
          photoUrl: "",
          text: "",
          events: [],
          waUpdatedAt: "",
          meetingStats: null,
          showMeetingStats: true,
        },
      ],
      pageOrder: [...current.pageOrder, `athlete:${id}`],
    }));
    setSelectedPageId(`athlete:${id}`);
  }

  function appendPartnerPage() {
    const id = `partner-${Date.now()}`;
    setDraft((current) => ({
      ...current,
      partnerPages: [
        ...current.partnerPages,
        { id, sponsorId: "", headline: "", body: "", imageUrl: "", ctaLabel: "", ctaUrl: "" },
      ],
      pageOrder: [...current.pageOrder, `partner:${id}`],
    }));
    setSelectedPageId(`partner:${id}`);
  }

  function hideOrDeletePage(page) {
    if (page.kind === "highlight" || page.kind === "partner" || page.kind === "athlete") {
      if (!window.confirm(`Delete the page "${page.title}"?`)) return;
      const listKey = { highlight: "highlightPages", partner: "partnerPages", athlete: "athletePages" }[page.kind];
      setDraft((current) => ({
        ...current,
        [listKey]: current[listKey].filter((entry) => entry.id !== page.sourceId),
        pageOrder: current.pageOrder.filter((entry) => entry !== page.id),
        // A deleted 2026 sample page must not come back with the defaults.
        dismissedSamples: page.sourceId.startsWith("sample-")
          ? [...current.dismissedSamples, page.sourceId]
          : current.dismissedSamples,
      }));
      setSelectedPageId("cover");
      return;
    }
    updatePageOrder((currentOrder) => currentOrder.filter((entry) => entry !== page.id));
  }

  function appendSponsorPage() {
    const id = `sponsor-page-${Date.now()}`;
    setDraft((current) => ({
      ...current,
      sponsorPages: [...current.sponsorPages, { id, title: "", imageUrl: "" }],
    }));
  }

  function updateSponsorPage(id, field, value) {
    setDraft((current) => ({
      ...current,
      sponsorPages: current.sponsorPages.map((entry) => (entry.id === id ? { ...entry, [field]: value } : entry)),
    }));
  }

  function removeSponsorPage(id) {
    setDraft((current) => ({
      ...current,
      sponsorPages: current.sponsorPages.filter((entry) => entry.id !== id),
    }));
  }

  function setWelcome(field, value) {
    setDraft((current) => ({ ...current, welcome: { ...current.welcome, [field]: value } }));
  }

  function renderPageEditor(page) {
    if (page.id === "cover") {
      return (
        <EditorSection
          title="Cover"
          description="Built-in A4 cover: title, edition, date, venue and the main partners are filled in automatically around the key visual. Or upload a complete A4 page from the graphic designer: it then replaces the built-in cover."
        >
          <FileUpload
            value={draft.cover.visualUrl}
            onChange={(url) => setDraft((current) => ({ ...current, cover: { ...current.cover, visualUrl: url } }))}
            accept="image/*"
            storagePath="emagazine-imported-pages"
            label="Key visual (landscape) — empty = the website home hero banner"
          />
          <FileUpload
            value={draft.cover.imageUrl}
            onChange={(url) => setDraft((current) => ({ ...current, cover: { ...current.cover, imageUrl: url } }))}
            accept="image/*"
            storagePath="emagazine-imported-pages"
            label="Complete cover page (A4 image, optional)"
          />
          <A4FormatHint imageUrl={draft.cover.imageUrl} />
        </EditorSection>
      );
    }

    if (page.id === "welcome") {
      const words = wordCount(draft.welcome.body);
      return (
        <EditorSection title="Welcome page" description="The president's message (in English): text, portrait, name and function. Update it each edition.">
          <div className="emag-ed__two-cols">
            <div>
              <label style={labelStyle}>Title</label>
              <input style={inputStyle} value={draft.welcome.title} onChange={(event) => setWelcome("title", event.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>Intro line</label>
              <input style={inputStyle} value={draft.welcome.intro} onChange={(event) => setWelcome("intro", event.target.value)} placeholder="Short subtitle" />
            </div>
            <div>
              <label style={labelStyle}>Signed by (name)</label>
              <input style={inputStyle} value={draft.welcome.personName} onChange={(event) => setWelcome("personName", event.target.value)} placeholder="First and last name of the president" />
            </div>
            <div>
              <label style={labelStyle}>Function</label>
              <input style={inputStyle} value={draft.welcome.personTitle} onChange={(event) => setWelcome("personTitle", event.target.value)} placeholder="President, FLA" />
            </div>
          </div>
          <FileUpload
            value={draft.welcome.photoUrl}
            onChange={(url) => setWelcome("photoUrl", url)}
            accept="image/*"
            storagePath="emagazine-welcome"
            label="Portrait (square crop, face kept at the top)"
          />
          <div>
            <label style={labelStyle}>Message</label>
            <textarea
              style={{ ...inputStyle, minHeight: 260, resize: "vertical" }}
              value={draft.welcome.body}
              onChange={(event) => setWelcome("body", event.target.value)}
              placeholder="Leave an empty line between paragraphs"
            />
            <p style={{ margin: "6px 0 0", fontSize: "0.78rem", color: words > 380 ? "#92400e" : "#6b7280" }}>
              {words} words — up to about 330 words keep the normal text size; longer messages are printed smaller to stay on one A4 page.
            </p>
          </div>
        </EditorSection>
      );
    }

    if (page.id === "thanks") {
      const setThanks = (field, value) => setDraft((current) => ({ ...current, thanks: { ...current.thanks, [field]: value } }));
      return (
        <EditorSection title="Thank you" description="Closing page of the magazine. The partner logos at the bottom come from the partners database.">
          <div>
            <label style={labelStyle}>Title</label>
            <input style={inputStyle} value={draft.thanks.title} onChange={(event) => setThanks("title", event.target.value)} />
          </div>
          <FileUpload
            value={draft.thanks.photoUrl}
            onChange={(url) => setThanks("photoUrl", url)}
            accept="image/*"
            storagePath="emagazine-imported-pages"
            label="Photo (landscape) — empty = the volunteers photo of the website"
          />
          <div>
            <label style={labelStyle}>Intro</label>
            <textarea style={{ ...inputStyle, minHeight: 70, resize: "vertical" }} value={draft.thanks.intro} onChange={(event) => setThanks("intro", event.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>People and institutions thanked — one per line</label>
            <textarea
              style={{ ...inputStyle, minHeight: 220, resize: "vertical" }}
              value={draft.thanks.names.join("\n")}
              onChange={(event) => setThanks("names", event.target.value.split("\n"))}
            />
          </div>
          <div>
            <label style={labelStyle}>Closing words</label>
            <textarea style={{ ...inputStyle, minHeight: 100, resize: "vertical" }} value={draft.thanks.closing} onChange={(event) => setThanks("closing", event.target.value)} />
          </div>
        </EditorSection>
      );
    }

    if (page.id === "clubs") {
      return (
        <EditorSection title="Athletics clubs" description="&quot;Want to discover athletics?&quot;: the FLA clubs with email, website and phone, and the QR code of the 2026 magazine. The list is kept in the app's code (src/data/flaClubs.json): ask for an update when a club changes." />
      );
    }

    if (page.id === "timetable") {
      return (
        <EditorSection title="Timetable" description="Built from the timetable of the current edition settings.">
          <div>
            <a href="/app/website/edition" className="btn btn--secondary" style={{ fontSize: "0.85rem" }}>Edit the timetable</a>
          </div>
        </EditorSection>
      );
    }

    if (page.id === "sponsors") {
      return (
        <EditorSection
          title="Sponsor overview"
          description="By default, the logo grid of the partners database. A4 pages designed by the graphic designer replace it as soon as one is added."
          actions={<EmptyButton onClick={appendSponsorPage}>+ Add sponsor page</EmptyButton>}
        >
          <div>
            <a href="/app/website/sponsors" className="btn btn--secondary" style={{ fontSize: "0.85rem" }}>Edit the partners</a>
          </div>
          {draft.sponsorPages.map((sponsorPage) => (
            <div key={sponsorPage.id} style={{ display: "grid", gap: 10, padding: 14, border: "1px solid #dbe4ee", borderRadius: 12, background: "#fff" }}>
              <div style={{ display: "flex", gap: 10, alignItems: "end" }}>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>Label (internal)</label>
                  <input style={inputStyle} value={sponsorPage.title} onChange={(event) => updateSponsorPage(sponsorPage.id, "title", event.target.value)} placeholder="Gold partners" />
                </div>
                <EmptyButton onClick={() => removeSponsorPage(sponsorPage.id)} style={{ color: "#c62828" }}>Remove</EmptyButton>
              </div>
              <FileUpload
                value={sponsorPage.imageUrl}
                onChange={(url) => updateSponsorPage(sponsorPage.id, "imageUrl", url)}
                accept="image/*"
                storagePath="emagazine-imported-pages"
                label="Page image (A4)"
              />
              <A4FormatHint imageUrl={sponsorPage.imageUrl} />
            </div>
          ))}
        </EditorSection>
      );
    }

    if (page.kind === "special") {
      const raceKey = page.id.replace("special:", "");
      return (
        <SpecialRaceEditor
          title={page.title}
          race={draft.specialRaces[raceKey]}
          onChange={(race) => setDraft((current) => ({ ...current, specialRaces: { ...current.specialRaces, [raceKey]: race } }))}
        />
      );
    }

    if (page.kind === "athlete") {
      const athlete = draft.athletePages.find((entry) => entry.id === page.sourceId);
      return athlete ? (
        <AthletePageEditor
          key={athlete.id}
          page={athlete}
          athleteCards={athleteCards}
          onChange={(nextPage) => setDraft((current) => ({
            ...current,
            athletePages: current.athletePages.map((entry) => (entry.id === nextPage.id ? nextPage : entry)),
          }))}
        />
      ) : null;
    }

    if (page.kind === "highlight") {
      const highlight = draft.highlightPages.find((entry) => entry.id === page.sourceId);
      return highlight ? (
        <HighlightEditor
          key={highlight.id}
          page={highlight}
          athleteCards={athleteCards}
          onChange={(nextPage) => setDraft((current) => ({
            ...current,
            highlightPages: current.highlightPages.map((entry) => (entry.id === nextPage.id ? nextPage : entry)),
          }))}
        />
      ) : null;
    }

    if (page.kind === "partner") {
      const partner = draft.partnerPages.find((entry) => entry.id === page.sourceId);
      return partner ? (
        <PartnerPageEditor
          page={partner}
          sponsors={activeSponsors}
          onChange={(nextPage) => setDraft((current) => ({
            ...current,
            partnerPages: current.partnerPages.map((entry) => (entry.id === nextPage.id ? nextPage : entry)),
          }))}
        />
      ) : null;
    }

    if (page.kind === "auto") {
      const groupId = page.id.replace("official-startlist:", "");
      const group = startlistById.get(groupId);
      const entries = group?.entries || [];
      const heats = new Set(entries.map((entry) => String(entry.heat || "").trim()).filter(Boolean)).size;
      return (
        <EditorSection
          title={page.title}
          description={entries.length
            ? `${entries.length} athletes${heats > 1 ? ` · ${heats} heats` : ""}, from the start list imported in Athlete Portal. Records, flags and SB are added automatically.`
            : "No athlete imported for this event yet: the page fills itself once the start list Excel is imported in Athlete Portal."}
          actions={<a href="/app/athlete-portal/athletes" className="btn btn--secondary" style={{ fontSize: "0.8rem" }}>Athlete Portal</a>}
        >
          <FileUpload
            value={draft.startlistPhotos[groupId] || ""}
            onChange={(url) => setDraft((current) => ({
              ...current,
              startlistPhotos: { ...current.startlistPhotos, [groupId]: url },
            }))}
            accept="image/*"
            storagePath="emagazine-startlist-photos"
            label="Event photo (landscape, shown as a banner behind the title)"
          />
        </EditorSection>
      );
    }

    return null;
  }

  const selectedIndex = selectedPage ? visiblePages.findIndex((page) => page.id === selectedPage.id) : -1;
  const selectedReadiness = selectedPage ? readinessById.get(selectedPage.id) : null;

  return (
    <Panel title="E-magazine" subtitle="Pick a page on the left, fill it in the middle, check it on the right">
      <div className="emag-ed">
        <div className="emag-ed__bar">
          <select
            aria-label="Edition"
            style={{ ...inputStyle, width: 110 }}
            value={effectiveYear ?? ""}
            onChange={(event) => handleEditionChange(Number(event.target.value))}
          >
            {editions.filter((edition) => !edition.cancelled).map((edition) => (
              <option key={edition.year} value={edition.year}>{edition.year}</option>
            ))}
          </select>

          <div className="emag-ed__segmented" role="group" aria-label="Publication status">
            {["offline", "published"].map((value) => (
              <button
                key={value}
                type="button"
                disabled={statusSaving || publicationStatus === value}
                onClick={() => handlePublicationStatusChange(value)}
                className={publicationStatus === value ? `is-active is-${value}` : ""}
              >
                {value === "published" ? "Published" : "Offline"}
              </button>
            ))}
          </div>

          <span className={`emag-ed__pill${readyCount === countedPages.length ? " is-done" : ""}`}>
            {readyCount}/{countedPages.length} pages ready
          </span>

          <span style={{ flex: 1 }} />

          {status ? <span style={{ color: "#546770", fontSize: "0.82rem" }}>{status}</span> : null}
          {isDirty ? <span className="emag-ed__dirty">Unsaved changes</span> : null}
          <EmptyButton onClick={() => setShowAudience((current) => !current)} aria-expanded={showAudience}>
            Audience {showAudience ? "▴" : "▾"}
          </EmptyButton>
          <a href="/e-magazine?preview=1" target="_blank" rel="noopener noreferrer" className="btn btn--secondary" style={{ fontSize: "0.8rem" }}>
            Open preview
          </a>
          <button className="btn btn--primary" type="button" onClick={handleSave} disabled={saving || !isDirty}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>

        {publicationStatus !== "published" ? (
          <p className="emag-ed__notice">
            Offline: the e-magazine isn't in the public navigation and no audience is counted. The preview link still works.
          </p>
        ) : null}

        {showAudience ? <EmagazineStatsPanel year={effectiveYear} pageOrder={statsPageOrder} /> : null}

        <div className="emag-ed__layout">
          <nav className="emag-ed__pages" aria-label="Magazine pages">
            {visiblePages.map((page, index) => {
              const readiness = readinessById.get(page.id);
              const showSection = index === 0 || visiblePages[index - 1].kind !== page.kind;
              return (
                <div key={page.id}>
                  {showSection ? <p className="emag-ed__section">{PAGE_SECTIONS[page.kind] || page.kind}</p> : null}
                  <button
                    type="button"
                    className={`emag-ed__page${selectedPage?.id === page.id ? " is-selected" : ""}`}
                    onClick={() => setSelectedPageId(page.id)}
                    title={readiness?.missing.length ? `Missing: ${readiness.missing.join(", ")}` : undefined}
                  >
                    <span className="emag-ed__page-number">{index + 1}</span>
                    <StatusDot state={readiness?.state || "ready"} />
                    <span className="emag-ed__page-title">{page.title}</span>
                  </button>
                </div>
              );
            })}

            {hiddenPages.length > 0 ? (
              <>
                <p className="emag-ed__section">Hidden</p>
                {hiddenPages.map((page) => (
                  <button
                    key={page.id}
                    type="button"
                    className="emag-ed__page is-hidden"
                    onClick={() => {
                      updatePageOrder((currentOrder) => [...currentOrder, page.id]);
                      setSelectedPageId(page.id);
                    }}
                  >
                    <span className="emag-ed__page-number">+</span>
                    <span className="emag-ed__page-title">{page.title}</span>
                  </button>
                ))}
              </>
            ) : null}

            <div style={{ display: "grid", gap: 6, marginTop: 12 }}>
              <EmptyButton onClick={appendAthletePage}>+ Add Luxembourg athlete</EmptyButton>
              <EmptyButton onClick={appendHighlightPage}>+ Add highlight page</EmptyButton>
              <EmptyButton onClick={appendPartnerPage}>+ Add partner page</EmptyButton>
            </div>
          </nav>

          <section className="emag-ed__editor">
            {selectedPage ? (
              <>
                {selectedReadiness?.state === "missing" ? (
                  <p className="emag-ed__missing">Still missing: {selectedReadiness.missing.join(", ")}.</p>
                ) : null}
                {renderPageEditor(selectedPage)}
                <div className="emag-ed__footer">
                  {selectedIndex >= 0 ? (
                    <>
                      <span style={{ color: "#6b7280", fontSize: "0.82rem" }}>Page {selectedIndex + 1} of {visiblePages.length}</span>
                      <EmptyButton
                        onClick={() => updatePageOrder((currentOrder) => moveItem(currentOrder, currentOrder.indexOf(selectedPage.id), -1))}
                        disabled={selectedIndex === 0}
                      >
                        ↑ Move up
                      </EmptyButton>
                      <EmptyButton
                        onClick={() => updatePageOrder((currentOrder) => moveItem(currentOrder, currentOrder.indexOf(selectedPage.id), 1))}
                        disabled={selectedIndex === visiblePages.length - 1}
                      >
                        ↓ Move down
                      </EmptyButton>
                      <span style={{ flex: 1 }} />
                      <EmptyButton onClick={() => hideOrDeletePage(selectedPage)} style={{ color: "#c62828" }}>
                        {["highlight", "partner", "athlete"].includes(selectedPage.kind) ? "Delete page" : "Hide page"}
                      </EmptyButton>
                    </>
                  ) : (
                    <span style={{ color: "#6b7280", fontSize: "0.82rem" }}>This page is hidden from the magazine.</span>
                  )}
                </div>
              </>
            ) : (
              <p className="panel-note">No page in the magazine yet.</p>
            )}
          </section>

          <aside className="emag-ed__preview" aria-label="A4 preview">
            <p className="emag-ed__section" style={{ marginTop: 0 }}>A4 preview · unsaved changes included</p>
            <iframe
              ref={setPreviewFrame}
              title="A4 preview of the selected page"
              src="/e-magazine/frame"
              className="emag-ed__frame"
            />
          </aside>
        </div>
      </div>
    </Panel>
  );
}
