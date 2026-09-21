import { useEffect, useMemo, useState } from "react";
import { useSiteEditionYear } from "./edition";
import { useMeetingEditions, updateEdition } from "./meeting-history-hooks";
import { useAthleteRegistry, useAthletes } from "./athlete-portal-hooks";
import { useSponsors } from "../site/site-hooks";
import { FileUpload } from "./file-upload";
import {
  buildAthleteOptions,
  buildEmagazinePageRegistry,
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

function jumpToAnchor(anchor) {
  if (!anchor) return;
  const element = document.getElementById(anchor);
  if (!element) return;
  element.scrollIntoView({ behavior: "smooth", block: "start" });
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

function HighlightEditor({ page, athleteOptions, onChange, onRemove }) {
  const labelStyle = fieldLabelStyle();
  const inputStyle = fieldInputStyle();
  const athleteSlotCount = page.type === "quatuor" ? 4 : page.type === "trio" ? 3 : page.type === "duel" ? 2 : 1;

  function set(field, value) {
    onChange({ ...page, [field]: value });
  }

  function setAthleteAt(index, value) {
    const next = [...page.athleteIds];
    next[index] = value;
    onChange({ ...page, athleteIds: next.filter(Boolean) });
  }

  function setAthletePhoto(athleteId, url) {
    if (!athleteId) return;
    onChange({ ...page, athletePhotos: { ...(page.athletePhotos || {}), [athleteId]: url } });
  }

  return (
    <div style={{ display: "grid", gap: 14, padding: 18, border: "1px solid #dbe4ee", borderRadius: 14, background: "#fff" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <div>
          <h4 style={{ margin: 0, fontSize: "1rem", color: "#10253d" }}>{page.title || "Highlight page"}</h4>
          <p style={{ margin: "4px 0 0", color: "#6b7280", fontSize: "0.82rem" }}>
            Auto-filled from the athlete database.
          </p>
        </div>
        <EmptyButton onClick={onRemove} style={{ color: "#c62828" }}>Remove</EmptyButton>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "180px 1fr 1fr", gap: 12 }}>
        <div>
          <label style={labelStyle}>Template</label>
          <select style={inputStyle} value={page.type} onChange={(event) => set("type", event.target.value)}>
            <option value="duel">Vs 2</option>
            <option value="trio">Vs 3</option>
            <option value="quatuor">Vs 4</option>
            <option value="luxembourg">Luxembourg spotlight</option>
            <option value="international">International spotlight</option>
          </select>
        </div>
        <div>
          <label style={labelStyle}>Title</label>
          <input style={inputStyle} value={page.title} onChange={(event) => set("title", event.target.value)} placeholder="Page title" />
        </div>
        <div>
          <label style={labelStyle}>Image URL</label>
          <input style={inputStyle} value={page.imageUrl} onChange={(event) => set("imageUrl", event.target.value)} placeholder="https://…" />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div>
          <label style={labelStyle}>Subtitle</label>
          <input style={inputStyle} value={page.subtitle} onChange={(event) => set("subtitle", event.target.value)} placeholder="Optional subtitle" />
        </div>
        <div>
          <label style={labelStyle}>Manual intro</label>
          <input style={inputStyle} value={page.body} onChange={(event) => set("body", event.target.value)} placeholder="Optional intro text" />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: `repeat(${athleteSlotCount}, minmax(0, 1fr))`, gap: 12 }}>
        {Array.from({ length: athleteSlotCount }).map((_, index) => {
          const athleteId = page.athleteIds[index] || "";
          return (
            <div key={`${page.id}-athlete-${index}`} style={{ display: "grid", gap: 8 }}>
              <label style={labelStyle}>Athlete {index + 1}</label>
              <select
                style={inputStyle}
                value={athleteId}
                onChange={(event) => setAthleteAt(index, event.target.value)}
              >
                <option value="">Select athlete</option>
                {athleteOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              {athleteId ? (
                <FileUpload
                  value={page.athletePhotos?.[athleteId] || ""}
                  onChange={(url) => setAthletePhoto(athleteId, url)}
                  accept="image/*"
                  storagePath="emagazine-athlete-photos"
                  label="Photo de cet athlète"
                />
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PartnerPageEditor({ page, sponsors, onChange, onRemove }) {
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
        <EmptyButton onClick={onRemove} style={{ color: "#c62828" }}>Remove</EmptyButton>
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

export function WebsiteEmagazinePage({ Panel }) {
  const { editions, loading: editionsLoading } = useMeetingEditions();
  const { siteEditionYear } = useSiteEditionYear();
  const { registry } = useAthleteRegistry(true);
  const { athletes } = useAthletes(true);
  const { sponsors } = useSponsors(false);

  const defaultYear = siteEditionYear ?? editions.find((edition) => !edition.isClosed)?.year ?? editions[0]?.year ?? null;
  const [selectedYear, setSelectedYear] = useState(null);
  const effectiveYear = selectedYear ?? defaultYear;
  const selectedEdition = editions.find((edition) => edition.year === effectiveYear) ?? null;
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [statusSaving, setStatusSaving] = useState(false);
  const [status, setStatus] = useState("");

  useEffect(() => {
    if (!selectedEdition) return;
    setDraft(deepClone(normalizeEmagazineConfig(selectedEdition.emagazine, selectedEdition)));
  }, [selectedEdition]);

  const athleteOptions = useMemo(
    () => buildAthleteOptions(registry, athletes),
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

  const hiddenPages = useMemo(
    () => pageRegistry.filter((page) => !(draft?.pageOrder || []).includes(page.id)),
    [pageRegistry, draft?.pageOrder],
  );

  if (editionsLoading || !selectedEdition || !draft) {
    return (
      <Panel title="E-magazine" subtitle="Loading the editorial configuration">
        <p className="panel-note">Preparing the current edition…</p>
      </Panel>
    );
  }

  const labelStyle = fieldLabelStyle();
  const inputStyle = fieldInputStyle();

  async function handleSave() {
    setSaving(true);
    setStatus("");
    try {
      await updateEdition(effectiveYear, { emagazine: draft });
      setStatus("E-magazine settings saved.");
    } catch (error) {
      setStatus(error.message || "Unable to save the e-magazine settings.");
    } finally {
      setSaving(false);
    }
  }

  async function handlePublicationStatusChange(nextStatus) {
    if (!selectedEdition) return;
    setStatusSaving(true);
    setStatus("");
    try {
      await updateEdition(effectiveYear, { emagazineStatus: nextStatus });
      setStatus(nextStatus === "published" ? "E-magazine published on the public site." : "E-magazine set offline.");
    } catch (error) {
      setStatus(error.message || "Unable to update the e-magazine publication status.");
    } finally {
      setStatusSaving(false);
    }
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
        { id, type: "duel", title: "", subtitle: "", body: "", imageUrl: "", athleteIds: [] },
      ],
      pageOrder: [...current.pageOrder, `highlight:${id}`],
    }));
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
  }

  function hideOrDeletePage(page) {
    if (page.kind === "highlight") {
      setDraft((current) => ({
        ...current,
        highlightPages: current.highlightPages.filter((entry) => entry.id !== page.sourceId),
        pageOrder: current.pageOrder.filter((entry) => entry !== page.id),
      }));
      return;
    }
    if (page.kind === "partner") {
      setDraft((current) => ({
        ...current,
        partnerPages: current.partnerPages.filter((entry) => entry.id !== page.sourceId),
        pageOrder: current.pageOrder.filter((entry) => entry !== page.id),
      }));
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

  function showHiddenPage(pageId) {
    updatePageOrder((currentOrder) => [...currentOrder, pageId]);
  }

  return (
    <Panel title="E-magazine" subtitle="Build the magazine pages automatically from the edition, athlete and sponsor databases">
      <div style={{ display: "grid", gap: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <label style={{ ...labelStyle, marginBottom: 0 }}>Edition</label>
            <select style={{ ...inputStyle, width: 160 }} value={effectiveYear ?? ""} onChange={(event) => setSelectedYear(Number(event.target.value))}>
              {editions.filter((edition) => !edition.cancelled).map((edition) => (
                <option key={edition.year} value={edition.year}>{edition.year}</option>
              ))}
            </select>
            <a href="/e-magazine?preview=1" target="_blank" rel="noopener noreferrer" className="btn btn--secondary" style={{ fontSize: "0.8rem" }}>
              Open public preview
            </a>
          </div>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            {status ? <span style={{ color: "#546770", fontSize: "0.82rem" }}>{status}</span> : null}
            <button className="btn btn--primary" type="button" onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : "Save e-magazine"}
            </button>
          </div>
        </div>

        <div style={{ padding: 18, borderRadius: 16, background: "#f8fbff", border: "1px solid #dbe4ee", display: "grid", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div>
              <h3 style={{ margin: 0, color: "#10253d" }}>Publication status</h3>
              <p style={{ margin: "6px 0 0", color: "#6b7280", fontSize: "0.84rem" }}>
                Decide whether the e-magazine is visible in the public navigation.
              </p>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: "0.75rem", color: "#6b7280", fontWeight: 600 }}>Status:</span>
              <button
                type="button"
                onClick={() => handlePublicationStatusChange("offline")}
                disabled={statusSaving}
                style={{
                  padding: "4px 10px",
                  borderRadius: 6,
                  fontSize: "0.75rem",
                  fontWeight: 600,
                  cursor: "pointer",
                  border: "1px solid #d1d5db",
                  background: (selectedEdition.emagazineStatus || "published") === "offline" ? "#374151" : "#f3f4f6",
                  color: (selectedEdition.emagazineStatus || "published") === "offline" ? "#fff" : "#6b7280",
                }}
              >
                Offline
              </button>
              <button
                type="button"
                onClick={() => handlePublicationStatusChange("published")}
                disabled={statusSaving}
                style={{
                  padding: "4px 10px",
                  borderRadius: 6,
                  fontSize: "0.75rem",
                  fontWeight: 600,
                  cursor: "pointer",
                  border: "1px solid #d1d5db",
                  background: (selectedEdition.emagazineStatus || "published") === "published" ? "#16a34a" : "#f3f4f6",
                  color: (selectedEdition.emagazineStatus || "published") === "published" ? "#fff" : "#6b7280",
                }}
              >
                Published
              </button>
            </div>
          </div>

          {(selectedEdition.emagazineStatus || "published") !== "published" ? (
            <div style={{ padding: "6px 10px", background: "#fef3c7", borderRadius: 6, border: "1px solid #fcd34d", fontSize: "0.75rem", color: "#92400e" }}>
              ⚠️ Offline — le e-magazine n'apparaît pas dans la navigation publique. Le lien de preview admin reste disponible.
            </div>
          ) : (
            <div style={{ padding: "6px 10px", background: "#dcfce7", borderRadius: 6, border: "1px solid #86efac", fontSize: "0.75rem", color: "#166534" }}>
              ✅ Published — le e-magazine est visible dans la navigation publique.
            </div>
          )}
        </div>

        <div style={{ display: "grid", gap: 18, padding: 20, borderRadius: 16, background: "#f8fbff", border: "1px solid #dbe4ee" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "start", flexWrap: "wrap" }}>
            <div>
              <h3 style={{ margin: 0, color: "#10253d" }}>Magazine summary</h3>
              <p style={{ margin: "6px 0 0", color: "#6b7280", fontSize: "0.84rem", maxWidth: 760 }}>
                Reorder the pages, jump directly to the editor section you need, hide pages you do not want, and add new highlight or partner pages.
              </p>
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <EmptyButton onClick={appendHighlightPage}>+ Add highlight page</EmptyButton>
              <EmptyButton onClick={appendPartnerPage}>+ Add partner page</EmptyButton>
            </div>
          </div>

          <div style={{ display: "grid", gap: 10 }}>
            {visiblePages.map((page, index) => (
              <div
                key={page.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "64px minmax(0, 1fr) auto",
                  gap: 14,
                  alignItems: "center",
                  padding: "14px 16px",
                  borderRadius: 14,
                  border: "1px solid #dbe4ee",
                  background: "#fff",
                }}
              >
                <div style={{ color: "#607086", fontWeight: 800, fontSize: "0.82rem" }}>
                  #{index + 1}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <strong style={{ color: "#10253d" }}>{page.title}</strong>
                    <span style={{ fontSize: "0.72rem", color: "#607086", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                      {page.kind}
                    </span>
                    {page.enabled === false ? (
                      <span style={{ fontSize: "0.72rem", color: "#c62828", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                        disabled
                      </span>
                    ) : null}
                  </div>
                  <div style={{ marginTop: 4, color: "#6b7280", fontSize: "0.8rem" }}>
                    {page.sourcePath === "/app/website/emagazine"
                      ? "Editable in this configurator"
                      : page.sourcePath === "/app/website/edition"
                        ? "Configured from the current edition settings"
                        : page.sourcePath === "/app/website/sponsors"
                          ? "Driven by the sponsors database"
                          : page.sourcePath === "/app/athlete-portal/athletes"
                            ? "Generated from Athlete Portal imports"
                            : "Displayed in the public magazine"}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                  <EmptyButton onClick={() => updatePageOrder((currentOrder) => moveItem(currentOrder, index, -1))} disabled={index === 0}>↑</EmptyButton>
                  <EmptyButton onClick={() => updatePageOrder((currentOrder) => moveItem(currentOrder, index, 1))} disabled={index === visiblePages.length - 1}>↓</EmptyButton>
                  {page.editorAnchor ? (
                    <EmptyButton onClick={() => jumpToAnchor(page.editorAnchor)}>Edit</EmptyButton>
                  ) : page.sourcePath && page.sourcePath !== "/e-magazine" ? (
                    <a href={page.sourcePath} className="btn btn--secondary" style={{ fontSize: "0.8rem" }}>Source</a>
                  ) : (
                    <a href="/e-magazine?preview=1" target="_blank" rel="noopener noreferrer" className="btn btn--secondary" style={{ fontSize: "0.8rem" }}>Preview</a>
                  )}
                  <EmptyButton onClick={() => hideOrDeletePage(page)} style={{ color: "#c62828" }}>
                    {page.kind === "highlight" || page.kind === "partner" ? "Delete" : "Hide"}
                  </EmptyButton>
                </div>
              </div>
            ))}
          </div>

          {hiddenPages.length > 0 ? (
            <div style={{ display: "grid", gap: 10 }}>
              <strong style={{ color: "#10253d" }}>Hidden / available pages</strong>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                {hiddenPages.map((page) => (
                  <button
                    key={page.id}
                    type="button"
                    onClick={() => showHiddenPage(page.id)}
                    className="btn btn--secondary"
                    style={{ fontSize: "0.8rem" }}
                  >
                    + {page.title}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        <div id="emag-cover" style={{ padding: 20, borderRadius: 16, background: "#f8fbff", border: "1px solid #dbe4ee", display: "grid", gap: 16 }}>
          <div>
            <h3 style={{ margin: 0, color: "#10253d" }}>Cover</h3>
            <p style={{ margin: "6px 0 0", color: "#6b7280", fontSize: "0.84rem" }}>
              A4 page designed by the graphic designer, exported as an image. Leave empty to keep the built-in cover.
            </p>
          </div>
          <FileUpload
            value={draft.cover.imageUrl}
            onChange={(url) => setDraft((current) => ({ ...current, cover: { ...current.cover, imageUrl: url } }))}
            accept="image/*"
            storagePath="emagazine-imported-pages"
            label="Cover page (A4 image)"
          />
        </div>

        <div id="emag-sponsor-pages" style={{ padding: 20, borderRadius: 16, background: "#f8fbff", border: "1px solid #dbe4ee", display: "grid", gap: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "start", flexWrap: "wrap" }}>
            <div>
              <h3 style={{ margin: 0, color: "#10253d" }}>Sponsor pages</h3>
              <p style={{ margin: "6px 0 0", color: "#6b7280", fontSize: "0.84rem", maxWidth: 640 }}>
                A4 pages designed by the graphic designer. When at least one is added, they replace the auto-generated sponsor overview page.
              </p>
            </div>
            <EmptyButton onClick={appendSponsorPage}>+ Add sponsor page</EmptyButton>
          </div>
          {draft.sponsorPages.length === 0 ? (
            <p style={{ margin: 0, color: "#6b7280", fontSize: "0.82rem" }}>No imported sponsor page yet — the live sponsor logo grid is shown instead.</p>
          ) : (
            <div style={{ display: "grid", gap: 14 }}>
              {draft.sponsorPages.map((page) => (
                <div key={page.id} style={{ display: "grid", gridTemplateColumns: "1fr 2fr auto", gap: 12, alignItems: "end", padding: 14, border: "1px solid #dbe4ee", borderRadius: 12, background: "#fff" }}>
                  <div>
                    <label style={labelStyle}>Label (internal)</label>
                    <input style={inputStyle} value={page.title} onChange={(event) => updateSponsorPage(page.id, "title", event.target.value)} placeholder="e.g. Gold partners" />
                  </div>
                  <FileUpload
                    value={page.imageUrl}
                    onChange={(url) => updateSponsorPage(page.id, "imageUrl", url)}
                    accept="image/*"
                    storagePath="emagazine-imported-pages"
                    label="Page image (A4)"
                  />
                  <EmptyButton onClick={() => removeSponsorPage(page.id)} style={{ color: "#c62828" }}>Remove</EmptyButton>
                </div>
              ))}
            </div>
          )}
        </div>

        <div id="emag-welcome" style={{ padding: 20, borderRadius: 16, background: "#f8fbff", border: "1px solid #dbe4ee", display: "grid", gap: 16 }}>
          <div>
            <h3 style={{ margin: 0, color: "#10253d" }}>Welcome page</h3>
            <p style={{ margin: "6px 0 0", color: "#6b7280", fontSize: "0.84rem" }}>
              Editable English welcome text, portrait, name and title.
            </p>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label style={labelStyle}>Title</label>
              <input style={inputStyle} value={draft.welcome.title} onChange={(event) => setDraft((current) => ({ ...current, welcome: { ...current.welcome, title: event.target.value } }))} />
            </div>
            <div>
              <label style={labelStyle}>Intro line</label>
              <input style={inputStyle} value={draft.welcome.intro} onChange={(event) => setDraft((current) => ({ ...current, welcome: { ...current.welcome, intro: event.target.value } }))} placeholder="Short subtitle" />
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            <input style={inputStyle} value={draft.welcome.photoUrl} onChange={(event) => setDraft((current) => ({ ...current, welcome: { ...current.welcome, photoUrl: event.target.value } }))} placeholder="Portrait image URL" />
            <input style={inputStyle} value={draft.welcome.personName} onChange={(event) => setDraft((current) => ({ ...current, welcome: { ...current.welcome, personName: event.target.value } }))} placeholder="Name" />
            <input style={inputStyle} value={draft.welcome.personTitle} onChange={(event) => setDraft((current) => ({ ...current, welcome: { ...current.welcome, personTitle: event.target.value } }))} placeholder="Title" />
          </div>
          <textarea
            style={{ ...inputStyle, minHeight: 180, resize: "vertical" }}
            value={draft.welcome.body}
            onChange={(event) => setDraft((current) => ({ ...current, welcome: { ...current.welcome, body: event.target.value } }))}
            placeholder="Main English welcome message"
          />
        </div>

        <div id="emag-races" style={{ display: "grid", gap: 18 }}>
          <div>
            <h3 style={{ margin: 0, color: "#10253d" }}>Special race settings</h3>
            <p style={{ margin: "6px 0 0", color: "#6b7280", fontSize: "0.84rem" }}>
              Enter participants here and their dedicated start list pages will be generated automatically.
            </p>
          </div>
          <SpecialRaceEditor
            title="Influencer Race"
            race={draft.specialRaces.influencerRace}
            onChange={(race) => setDraft((current) => ({ ...current, specialRaces: { ...current.specialRaces, influencerRace: race } }))}
          />
          <SpecialRaceEditor
            title="Business Race"
            race={draft.specialRaces.businessRace}
            onChange={(race) => setDraft((current) => ({ ...current, specialRaces: { ...current.specialRaces, businessRace: race } }))}
          />
        </div>

        <div style={{ display: "grid", gap: 18 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
            <div>
              <h3 style={{ margin: 0, color: "#10253d" }}>Highlight templates</h3>
              <p style={{ margin: "6px 0 0", color: "#6b7280", fontSize: "0.84rem" }}>
                Duel, trio, Luxembourg spotlight or international spotlight.
              </p>
            </div>
            <EmptyButton onClick={appendHighlightPage}>
              + Add highlight page
            </EmptyButton>
          </div>
          {draft.highlightPages.length === 0 ? (
            <p className="panel-note">No highlight pages configured yet.</p>
          ) : draft.highlightPages.map((page) => (
            <div key={page.id} id={`emag-highlight-${page.id}`}>
              <HighlightEditor
              page={page}
              athleteOptions={athleteOptions}
              onChange={(nextPage) => setDraft((current) => ({
                ...current,
                highlightPages: current.highlightPages.map((entry) => entry.id === nextPage.id ? nextPage : entry),
              }))}
              onRemove={() => setDraft((current) => ({
                ...current,
                highlightPages: current.highlightPages.filter((entry) => entry.id !== page.id),
                pageOrder: current.pageOrder.filter((entry) => entry !== `highlight:${page.id}`),
              }))}
            />
            </div>
          ))}
        </div>

        <div style={{ display: "grid", gap: 18 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
            <div>
              <h3 style={{ margin: 0, color: "#10253d" }}>Partner ad pages</h3>
              <p style={{ margin: "6px 0 0", color: "#6b7280", fontSize: "0.84rem" }}>
                Add dedicated partner pages on top of the automatic sponsor overview page.
              </p>
            </div>
            <EmptyButton onClick={appendPartnerPage}>
              + Add partner page
            </EmptyButton>
          </div>
          {draft.partnerPages.length === 0 ? (
            <p className="panel-note">No partner feature pages configured yet.</p>
          ) : draft.partnerPages.map((page) => (
            <div key={page.id} id={`emag-partner-${page.id}`}>
              <PartnerPageEditor
              page={page}
              sponsors={activeSponsors}
              onChange={(nextPage) => setDraft((current) => ({
                ...current,
                partnerPages: current.partnerPages.map((entry) => entry.id === nextPage.id ? nextPage : entry),
              }))}
              onRemove={() => setDraft((current) => ({
                ...current,
                partnerPages: current.partnerPages.filter((entry) => entry.id !== page.id),
                pageOrder: current.pageOrder.filter((entry) => entry !== `partner:${page.id}`),
              }))}
            />
            </div>
          ))}
        </div>
      </div>
    </Panel>
  );
}
