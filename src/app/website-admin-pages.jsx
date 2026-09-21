import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { FileUpload } from "./file-upload";
import { setSiteEditionYear, useSiteEditionYear } from "./edition";
import {
  deleteNewsArticle,
  deletePressRelease,
  deleteSponsor,
  generateSlug,
  renameSponsorCategoryKey,
  saveSponsorCategories,
  saveNewsArticle,
  savePressRelease,
  saveSponsor,
  useAllNews,
  useAllPressReleases,
  useSponsorCategories,
  useSponsors,
} from "../site/site-hooks";
import {
  DEFAULT_SPONSOR_MEDIA_SETTINGS,
  getSponsorMediaSettings,
  getSponsorMediaStyle,
} from "../site/sponsor-media-utils";
import {
  sponsorCategoryLabel,
  sponsorCategorySortIndex,
  toSponsorCategoryKey,
} from "../site/sponsor-utils";
import {
  createPrizeMoneySystemsDraft,
  formatPrizeMoneyAmount,
  getPrizeMoneySystemKeys,
  serializePrizeMoneySystems,
} from "./prize-money-utils";
import { updateEdition, useMeetingEditions } from "./meeting-history-hooks";

/* ── Shared helpers ──────────────────────────────────────── */
function getDisplayHostname(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function formatDate(ts) {
  if (!ts) return "—";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString("fr-BE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function formatDateInputValue(value) {
  if (!value) return "";
  const d = value.toDate ? value.toDate() : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function StatusBadge({ status }) {
  const map = {
    published: { label: "Published", cls: "badge-status badge-status--green" },
    draft: { label: "Draft", cls: "badge-status badge-status--gray" },
  };
  const { label, cls } = map[status] || map.draft;
  return <span className={cls}>{label}</span>;
}

/* ── News admin ──────────────────────────────────────────── */
const NEWS_CATEGORIES = ["news", "event", "athletes", "results", "press"];
const NEWS_LANGUAGES = ["en", "fr", "de", "lu"];

function NewsForm({ initial, onSave, onCancel }) {
  const [data, setData] = useState({
    title: "",
    slug: "",
    excerpt: "",
    content: "",
    coverImageUrl: "",
    category: "news",
    language: "en",
    status: "draft",
    featured: false,
    seoTitle: "",
    seoDescription: "",
    ...initial,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function set(field, value) {
    setData((prev) => {
      const next = { ...prev, [field]: value };
      if (field === "title" && !initial?.slug) {
        next.slug = generateSlug(value);
      }
      return next;
    });
  }

  async function handleSave(status) {
    if (!data.title.trim()) { setError("Title is required."); return; }
    if (!data.slug.trim()) { setError("Slug is required."); return; }
    setSaving(true);
    setError("");
    try {
      const payload = { ...data, status };
      if (status === "published" && !initial?.publishedAt) {
        payload.publishedAt = new Date();
      }
      await onSave(payload);
    } catch (e) {
      setError(e.message || "Failed to save.");
    } finally {
      setSaving(false);
    }
  }

  const labelStyle = { fontSize: "0.78rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#546770", display: "block", marginBottom: 6 };
  const inputStyle = { width: "100%", padding: "10px 14px", borderRadius: 8, border: "1px solid rgba(0,0,0,0.15)", fontSize: "0.9rem", fontFamily: "inherit", background: "#fff", color: "#0f2d37" };
  const textareaStyle = { ...inputStyle, minHeight: 100, resize: "vertical", lineHeight: 1.6 };

  return (
    <div style={{ background: "#fff", border: "1px solid rgba(0,0,0,0.1)", borderRadius: 16, padding: 32, maxWidth: 860 }}>
      <div style={{ display: "grid", gap: 20 }}>
        <div>
          <label style={labelStyle}>Title *</label>
          <input style={inputStyle} value={data.title} onChange={(e) => set("title", e.target.value)} placeholder="Article title" />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div>
            <label style={labelStyle}>Slug (URL)</label>
            <input style={inputStyle} value={data.slug} onChange={(e) => set("slug", e.target.value)} placeholder="auto-generated" />
          </div>
          <div>
            <label style={labelStyle}>Cover image URL</label>
            <input style={inputStyle} value={data.coverImageUrl} onChange={(e) => set("coverImageUrl", e.target.value)} placeholder="https://…" />
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
          <div>
            <label style={labelStyle}>Category</label>
            <select style={inputStyle} value={data.category} onChange={(e) => set("category", e.target.value)}>
              {NEWS_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Language</label>
            <select style={inputStyle} value={data.language} onChange={(e) => set("language", e.target.value)}>
              {NEWS_LANGUAGES.map((l) => <option key={l} value={l}>{l.toUpperCase()}</option>)}
            </select>
          </div>
          <div style={{ display: "flex", alignItems: "flex-end", paddingBottom: 2 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
              <input type="checkbox" checked={data.featured} onChange={(e) => set("featured", e.target.checked)} style={{ width: 18, height: 18 }} />
              <span style={{ fontSize: "0.875rem", fontWeight: 600, color: "#0f2d37" }}>Featured on homepage</span>
            </label>
          </div>
        </div>

        <div>
          <label style={labelStyle}>Excerpt / Summary</label>
          <textarea style={textareaStyle} value={data.excerpt} onChange={(e) => set("excerpt", e.target.value)} placeholder="Short description shown in news cards and lists…" rows={3} />
        </div>

        <div>
          <label style={labelStyle}>Content</label>
          <textarea
            style={{ ...textareaStyle, minHeight: 240 }}
            value={data.content}
            onChange={(e) => set("content", e.target.value)}
            placeholder="Full article content. Use double line breaks for paragraphs. ## for headings, ### for subheadings."
          />
          <p style={{ fontSize: "0.75rem", color: "#546770", marginTop: 6 }}>
            Use double line breaks (blank line) for new paragraphs. Start a line with ## for H2, ### for H3.
          </p>
        </div>

        <div style={{ borderTop: "1px solid rgba(0,0,0,0.08)", paddingTop: 20 }}>
          <p style={{ fontSize: "0.78rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#546770", marginBottom: 16 }}>SEO (optional)</p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div>
              <label style={labelStyle}>SEO Title</label>
              <input style={inputStyle} value={data.seoTitle} onChange={(e) => set("seoTitle", e.target.value)} placeholder="Defaults to article title" />
            </div>
            <div>
              <label style={labelStyle}>SEO Description</label>
              <input style={inputStyle} value={data.seoDescription} onChange={(e) => set("seoDescription", e.target.value)} placeholder="Meta description" />
            </div>
          </div>
        </div>

        {error && (
          <div style={{ background: "#fff0f0", border: "1px solid #f87171", borderRadius: 8, padding: "12px 16px", color: "#b91c1c", fontSize: "0.875rem" }}>
            {error}
          </div>
        )}

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button
            onClick={() => handleSave("published")}
            disabled={saving}
            className="btn btn-primary"
          >
            {saving ? "Saving…" : "Publish"}
          </button>
          <button
            onClick={() => handleSave("draft")}
            disabled={saving}
            className="btn btn-secondary"
          >
            Save as draft
          </button>
          <button onClick={onCancel} className="btn btn-ghost">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

export function WebsiteNewsPage({ Panel }) {
  const { news, loading } = useAllNews();
  const [editing, setEditing] = useState(null);
  const [creating, setCreating] = useState(false);

  async function handleSave(data) {
    await saveNewsArticle(editing?.id || null, data);
    setEditing(null);
    setCreating(false);
  }

  async function handleDelete(id, title) {
    if (!window.confirm(`Delete "${title}"? This cannot be undone.`)) return;
    await deleteNewsArticle(id);
  }

  if (creating || editing) {
    return (
      <Panel title={editing ? "Edit article" : "New article"}>
        <NewsForm
          initial={editing || {}}
          onSave={handleSave}
          onCancel={() => { setEditing(null); setCreating(false); }}
        />
      </Panel>
    );
  }

  return (
    <Panel
      title="Website News"
      subtitle="Manage news articles published on the public site"
      actions={
        <button className="btn btn-primary" onClick={() => setCreating(true)}>
          + New article
        </button>
      }
    >
      {loading ? (
        <p style={{ color: "#546770", fontSize: "0.875rem" }}>Loading…</p>
      ) : news.length === 0 ? (
        <div style={{ textAlign: "center", padding: "48px 0", color: "#546770" }}>
          <p>No articles yet. Create your first one!</p>
          <button className="btn btn-primary" onClick={() => setCreating(true)} style={{ marginTop: 16 }}>
            + New article
          </button>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Category</th>
                <th>Language</th>
                <th>Status</th>
                <th>Featured</th>
                <th>Published</th>
                <th>Created</th>
                <th style={{ width: 120 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {news.map((article) => (
                <tr key={article.id}>
                  <td style={{ fontWeight: 600 }}>
                    {article.title}
                    {article.slug && (
                      <div style={{ fontSize: "0.75rem", color: "#8da4b8", marginTop: 2 }}>
                        /news/{article.slug}
                      </div>
                    )}
                  </td>
                  <td>
                    <span className="badge-status badge-status--blue">{article.category || "—"}</span>
                  </td>
                  <td>{(article.language || "en").toUpperCase()}</td>
                  <td><StatusBadge status={article.status} /></td>
                  <td>{article.featured ? "⭐" : "—"}</td>
                  <td style={{ fontSize: "0.82rem" }}>{formatDate(article.publishedAt)}</td>
                  <td style={{ fontSize: "0.82rem" }}>{formatDate(article.createdAt)}</td>
                  <td>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        className="btn btn-sm btn-secondary"
                        onClick={() => setEditing(article)}
                      >
                        Edit
                      </button>
                      <button
                        className="btn btn-sm btn-danger"
                        onClick={() => handleDelete(article.id, article.title)}
                      >
                        Del
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

/* ── Sponsors admin ──────────────────────────────────────── */
function SponsorCategoryManager({ categories, sponsors }) {
  const [draftLabel, setDraftLabel] = useState("");
  const [savingKey, setSavingKey] = useState("");
  const [error, setError] = useState("");
  const [labelsByKey, setLabelsByKey] = useState({});
  const [keysByCategory, setKeysByCategory] = useState({});

  useEffect(() => {
    setLabelsByKey(Object.fromEntries(categories.map((category) => [category.key, category.label])));
    setKeysByCategory(Object.fromEntries(categories.map((category) => [category.key, category.key])));
  }, [categories]);

  const usageByCategory = sponsors.reduce((accumulator, sponsor) => {
    const key = sponsor.category || "";
    accumulator[key] = (accumulator[key] || 0) + 1;
    return accumulator;
  }, {});

  async function persistCategories(nextCategories, key = "") {
    setSavingKey(key);
    setError("");
    try {
      await saveSponsorCategories(nextCategories);
    } catch (saveError) {
      setError(saveError.message || "Failed to save categories.");
    } finally {
      setSavingKey("");
    }
  }

  async function handleAddCategory() {
    const trimmedLabel = draftLabel.trim();
    if (!trimmedLabel) {
      setError("Category label is required.");
      return;
    }

    const nextKey = toSponsorCategoryKey(trimmedLabel);
    if (categories.some((category) => category.key === nextKey)) {
      setError("A category with the same key already exists.");
      return;
    }

    const nextCategories = [...categories, { key: nextKey, label: trimmedLabel, order: categories.length }];
    await persistCategories(nextCategories, "new");
    setDraftLabel("");
  }

  async function handleSaveCategory(categoryKey) {
    const nextLabel = String(labelsByKey[categoryKey] || "").trim();
    const nextKey = toSponsorCategoryKey(keysByCategory[categoryKey] || categoryKey);
    if (!nextLabel) {
      setError("Category label cannot be empty.");
      return;
    }
    if (!nextKey) {
      setError("Category key cannot be empty.");
      return;
    }
    if (categories.some((category) => category.key !== categoryKey && category.key === nextKey)) {
      setError("Another category already uses this key.");
      return;
    }

    const nextCategories = categories.map((category) => {
      if (category.key !== categoryKey) return category;
      return { ...category, key: nextKey, label: nextLabel };
    });

    setSavingKey(categoryKey);
    setError("");
    try {
      if (nextKey !== categoryKey) {
        await renameSponsorCategoryKey(categoryKey, nextKey);
      }
      await saveSponsorCategories(nextCategories);
    } catch (saveError) {
      setError(saveError.message || "Failed to save categories.");
    } finally {
      setSavingKey("");
    }
  }

  async function handleMoveCategory(categoryKey, direction) {
    const currentIndex = categories.findIndex((category) => category.key === categoryKey);
    const targetIndex = currentIndex + direction;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= categories.length) return;

    const nextCategories = [...categories];
    [nextCategories[currentIndex], nextCategories[targetIndex]] = [nextCategories[targetIndex], nextCategories[currentIndex]];

    await persistCategories(
      nextCategories.map((category, index) => ({ ...category, order: index })),
      categoryKey,
    );
  }

  async function handleDeleteCategory(categoryKey) {
    if (usageByCategory[categoryKey]) {
      setError("This category is still used by one or more sponsors.");
      return;
    }

    const nextCategories = categories
      .filter((category) => category.key !== categoryKey)
      .map((category, index) => ({ ...category, order: index }));

    await persistCategories(nextCategories, categoryKey);
  }

  return (
    <div style={{ background: "#fff", border: "1px solid rgba(0,0,0,0.1)", borderRadius: 16, padding: 24, display: "grid", gap: 16 }}>
      <div>
        <h3 style={{ fontSize: "1rem", marginBottom: 6 }}>Sponsor categories</h3>
        <p style={{ fontSize: "0.84rem", color: "#546770" }}>
          Create the category list once here, then sponsors can only be assigned to these categories.
        </p>
      </div>

      <div style={{ display: "grid", gap: 12 }}>
        {categories.map((category, index) => (
          <div key={category.key} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 140px auto", gap: 12, alignItems: "center", padding: 14, borderRadius: 12, border: "1px solid rgba(15,23,42,0.08)", background: "#f8fafc" }}>
            <div style={{ display: "grid", gap: 8 }}>
              <input
                value={labelsByKey[category.key] ?? category.label}
                onChange={(e) => setLabelsByKey((current) => ({ ...current, [category.key]: e.target.value }))}
                style={{ width: "100%", padding: "10px 14px", borderRadius: 8, border: "1px solid rgba(0,0,0,0.15)", fontSize: "0.9rem", fontFamily: "inherit" }}
              />
              <input
                value={keysByCategory[category.key] ?? category.key}
                onChange={(e) => setKeysByCategory((current) => ({ ...current, [category.key]: e.target.value }))}
                style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid rgba(0,0,0,0.12)", fontSize: "0.82rem", fontFamily: "monospace" }}
                placeholder="category-key"
              />
            </div>
            <div style={{ fontSize: "0.82rem", color: "#546770", textAlign: "center" }}>
              {usageByCategory[category.key] || 0} sponsor(s)
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
              <button type="button" className="btn btn-secondary" disabled={savingKey === category.key} onClick={() => handleSaveCategory(category.key)}>
                Save
              </button>
              <button type="button" className="btn btn-ghost" disabled={index === 0 || savingKey === category.key} onClick={() => handleMoveCategory(category.key, -1)}>
                ↑
              </button>
              <button type="button" className="btn btn-ghost" disabled={index === categories.length - 1 || savingKey === category.key} onClick={() => handleMoveCategory(category.key, 1)}>
                ↓
              </button>
              <button type="button" className="btn btn-danger" disabled={Boolean(usageByCategory[category.key]) || savingKey === category.key} onClick={() => handleDeleteCategory(category.key)}>
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 12 }}>
        <input
          value={draftLabel}
          onChange={(e) => setDraftLabel(e.target.value)}
          placeholder="New category label"
          style={{ width: "100%", padding: "10px 14px", borderRadius: 8, border: "1px solid rgba(0,0,0,0.15)", fontSize: "0.9rem", fontFamily: "inherit" }}
        />
        <button type="button" className="btn btn-primary" disabled={savingKey === "new"} onClick={handleAddCategory}>
          {savingKey === "new" ? "Saving…" : "Add category"}
        </button>
      </div>

      {error && (
        <div style={{ background: "#fff0f0", border: "1px solid #f87171", borderRadius: 8, padding: "12px 16px", color: "#b91c1c", fontSize: "0.875rem" }}>
          {error}
        </div>
      )}
    </div>
  );
}

function SponsorForm({ initial, categories, onSave, onCancel }) {
  const [data, setData] = useState({
    name: "",
    logoUrl: "",
    website: "",
    category: categories[0]?.key || "title",
    order: 10,
    active: true,
    description: "",
    ...DEFAULT_SPONSOR_MEDIA_SETTINGS,
    ...initial,
    ...getSponsorMediaSettings(initial),
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const set = (field, value) => setData((p) => ({ ...p, [field]: value }));

  useEffect(() => {
    if (!categories.length) return;
    if (!categories.some((category) => category.key === data.category)) {
      set("category", categories[0].key);
    }
  }, [categories, data.category]);

  async function handleSave() {
    if (!data.name.trim()) { setError("Name is required."); return; }
    if (!categories.some((category) => category.key === data.category)) { setError("Please choose a valid category."); return; }
    setSaving(true);
    setError("");
    try {
      await onSave(data);
    } catch (e) {
      setError(e.message || "Failed to save.");
    } finally {
      setSaving(false);
    }
  }

  const labelStyle = { fontSize: "0.78rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#546770", display: "block", marginBottom: 6 };
  const inputStyle = { width: "100%", padding: "10px 14px", borderRadius: 8, border: "1px solid rgba(0,0,0,0.15)", fontSize: "0.9rem", fontFamily: "inherit" };
  const previewSponsor = { ...data, ...getSponsorMediaSettings(data) };

  return (
    <div style={{ background: "#fff", border: "1px solid rgba(0,0,0,0.1)", borderRadius: 16, padding: 32, maxWidth: 640 }}>
      <div style={{ display: "grid", gap: 16 }}>
        <div>
          <label style={labelStyle}>Name *</label>
          <input style={inputStyle} value={data.name} onChange={(e) => set("name", e.target.value)} placeholder="Partner name" />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div>
            <label style={labelStyle}>Category</label>
            <select
              style={inputStyle}
              value={data.category}
              onChange={(e) => set("category", e.target.value)}
            >
              {categories.map((category) => (
                <option key={category.key} value={category.key}>{category.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Display order</label>
            <input type="number" style={inputStyle} value={data.order} onChange={(e) => set("order", Number(e.target.value))} />
          </div>
        </div>
        <FileUpload
          label="Logo (PNG, SVG, WEBP)"
          value={data.logoUrl}
          onChange={(url) => set("logoUrl", url)}
          accept="image/png,image/svg+xml,image/webp,image/jpeg"
          storagePath="sponsors"
        />
        <div style={{ padding: 16, borderRadius: 12, border: "1px solid rgba(15,23,42,0.08)", background: "#f8fafc", display: "grid", gap: 14 }}>
          <div>
            <label style={labelStyle}>Logo framing inside cards</label>
            <p style={{ fontSize: "0.8rem", color: "#546770", lineHeight: 1.5 }}>
              Useful when a sponsor sends a very wide logo or a photo-like visual. You can fill the rectangle more, move it and zoom it.
            </p>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 160px", gap: 16, alignItems: "start" }}>
            <div style={{ display: "grid", gap: 12 }}>
              <div>
                <label style={labelStyle}>Fit mode</label>
                <select
                  style={inputStyle}
                  value={data.logoFit}
                  onChange={(e) => set("logoFit", e.target.value)}
                >
                  <option value="contain">Contain the full logo</option>
                  <option value="cover">Cover the full rectangle</option>
                </select>
              </div>
              <div>
                <label style={labelStyle}>Zoom: {previewSponsor.logoScale}%</label>
                <input
                  type="range"
                  min="60"
                  max="200"
                  step="5"
                  value={previewSponsor.logoScale}
                  onChange={(e) => set("logoScale", Number(e.target.value))}
                  style={{ width: "100%" }}
                />
              </div>
              <div>
                <label style={labelStyle}>Horizontal position: {previewSponsor.logoPositionX}%</label>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={previewSponsor.logoPositionX}
                  onChange={(e) => set("logoPositionX", Number(e.target.value))}
                  style={{ width: "100%" }}
                />
              </div>
              <div>
                <label style={labelStyle}>Vertical position: {previewSponsor.logoPositionY}%</label>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={previewSponsor.logoPositionY}
                  onChange={(e) => set("logoPositionY", Number(e.target.value))}
                  style={{ width: "100%" }}
                />
              </div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => {
                    set("logoFit", DEFAULT_SPONSOR_MEDIA_SETTINGS.logoFit);
                    set("logoScale", DEFAULT_SPONSOR_MEDIA_SETTINGS.logoScale);
                    set("logoPositionX", DEFAULT_SPONSOR_MEDIA_SETTINGS.logoPositionX);
                    set("logoPositionY", DEFAULT_SPONSOR_MEDIA_SETTINGS.logoPositionY);
                  }}
                >
                  Reset framing
                </button>
              </div>
            </div>
            <div>
              <div style={{ fontSize: "0.72rem", color: "#6b7280", marginBottom: 8, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                Preview
              </div>
              <div style={{ minWidth: 160, minHeight: 96, borderRadius: 12, border: "1px solid rgba(0,0,0,0.08)", background: "#fff", padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                {data.logoUrl ? (
                  <div style={{ width: 128, height: 60, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <img
                      src={data.logoUrl}
                      alt={data.name || "Sponsor logo preview"}
                      style={{
                        width: "100%",
                        height: "100%",
                        display: "block",
                        transition: "transform 0.2s ease",
                        ...getSponsorMediaStyle(previewSponsor),
                      }}
                    />
                  </div>
                ) : (
                  <span style={{ fontSize: "0.78rem", color: "#94a3b8", textAlign: "center" }}>Upload a logo to preview the framing</span>
                )}
              </div>
            </div>
          </div>
        </div>
        <div>
          <label style={labelStyle}>Website URL</label>
          <input style={inputStyle} value={data.website} onChange={(e) => set("website", e.target.value)} placeholder="https://…" />
        </div>
        <div>
          <label style={labelStyle}>Short description (optional)</label>
          <textarea
            style={{ ...inputStyle, minHeight: 80, resize: "vertical" }}
            value={data.description}
            onChange={(e) => set("description", e.target.value)}
            placeholder="Short text shown on the partners page"
          />
        </div>
        <div>
          <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
            <input type="checkbox" checked={data.active} onChange={(e) => set("active", e.target.checked)} style={{ width: 18, height: 18 }} />
            <span style={{ fontSize: "0.875rem", fontWeight: 600 }}>Active (visible on site)</span>
          </label>
        </div>
        {error && (
          <div style={{ background: "#fff0f0", border: "1px solid #f87171", borderRadius: 8, padding: "12px 16px", color: "#b91c1c", fontSize: "0.875rem" }}>
            {error}
          </div>
        )}
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={handleSave} disabled={saving} className="btn btn-primary">
            {saving ? "Saving…" : "Save partner"}
          </button>
          <button onClick={onCancel} className="btn btn-ghost">Cancel</button>
        </div>
      </div>
    </div>
  );
}

export function WebsiteSponsorsPage({ Panel }) {
  const { sponsors, loading } = useSponsors(false);
  const { categories, loading: categoriesLoading } = useSponsorCategories();
  const [editing, setEditing] = useState(null);
  const [creating, setCreating] = useState(false);

  async function handleSave(data) {
    await saveSponsor(editing?.id || null, data);
    setEditing(null);
    setCreating(false);
  }

  async function handleDelete(id, name) {
    if (!window.confirm(`Remove "${name}"?`)) return;
    await deleteSponsor(id);
  }

  if (creating || editing) {
    return (
      <Panel title={editing ? "Edit partner" : "Add partner"}>
        <SponsorForm
          initial={editing || {}}
          categories={categories}
          onSave={handleSave}
          onCancel={() => { setEditing(null); setCreating(false); }}
        />
      </Panel>
    );
  }

  return (
    <Panel
      title="Partners & Sponsors"
      subtitle="Manage sponsors displayed on the public site"
      actions={
        <button className="btn btn-primary" onClick={() => setCreating(true)}>
          + Add partner
        </button>
      }
    >
      <div style={{ marginBottom: 24 }}>
        {categoriesLoading ? (
          <p>Loading categories…</p>
        ) : (
          <SponsorCategoryManager categories={categories} sponsors={sponsors} />
        )}
      </div>

      {loading ? (
        <p>Loading…</p>
      ) : sponsors.length === 0 ? (
        <div style={{ textAlign: "center", padding: "48px 0", color: "#546770" }}>
          <p>No partners configured yet.</p>
          <button className="btn btn-primary" onClick={() => setCreating(true)} style={{ marginTop: 16 }}>
            + Add partner
          </button>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Category</th>
                <th>Order</th>
                <th>Active</th>
                <th>Logo</th>
                <th>Website</th>
                <th style={{ width: 120 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sponsors
                .sort((a, b) => {
                  const ai = sponsorCategorySortIndex(a.category, categories);
                  const bi = sponsorCategorySortIndex(b.category, categories);
                  if (ai !== bi) return ai - bi;
                  return (a.order ?? 99) - (b.order ?? 99);
                })
                .map((s) => (
                  <tr key={s.id}>
                    <td style={{ fontWeight: 600 }}>{s.name}</td>
                    <td>
                      <span className="badge-status badge-status--blue">{sponsorCategoryLabel(s.category, categories)}</span>
                    </td>
                    <td>{s.order ?? "—"}</td>
                    <td>{s.active ? "✅" : "❌"}</td>
                    <td>
                      {s.logoUrl
                        ? (
                          <div style={{ width: 80, height: 28, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" }}>
                            <img
                              src={s.logoUrl}
                              alt={s.name}
                              style={{
                                width: "100%",
                                height: "100%",
                                display: "block",
                                ...getSponsorMediaStyle(s),
                              }}
                            />
                          </div>
                        )
                        : <span style={{ color: "#ccc", fontSize: "0.8rem" }}>—</span>}
                    </td>
                    <td style={{ fontSize: "0.78rem" }}>
                      {s.website ? (
                        <a href={s.website} target="_blank" rel="noopener noreferrer" style={{ color: "#1066cc" }}>
                          {getDisplayHostname(s.website)}
                        </a>
                      ) : "—"}
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button className="btn btn-sm btn-secondary" onClick={() => setEditing(s)}>Edit</button>
                        <button className="btn btn-sm btn-danger" onClick={() => handleDelete(s.id, s.name)}>Del</button>
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

/* ── Press releases admin ─────────────────────────────────── */
const PRESS_CATEGORIES = ["Communiqué de presse", "Press release", "Déclaration", "Résultats"];
const PRESS_LANGUAGES = ["en", "fr", "de", "lu", "es", "pl"];

function PressReleaseForm({ initial, onSave, onCancel }) {
  const [data, setData] = useState({
    title: "",
    date: new Date().toISOString().slice(0, 10),
    language: "fr",
    category: "Press release",
    fileUrl: "",
    year: new Date().getFullYear(),
    published: false,
    ...initial,
    date: initial?.date
      ? (initial.date.toDate ? initial.date.toDate() : new Date(initial.date)).toISOString().slice(0, 10)
      : new Date().toISOString().slice(0, 10),
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const set = (field, value) => setData((p) => ({ ...p, [field]: value }));

  async function handleSave() {
    if (!data.title.trim()) { setError("Title is required."); return; }
    setSaving(true);
    setError("");
    try {
      await onSave({ ...data, date: new Date(data.date), year: Number(data.year) });
    } catch (e) {
      setError(e.message || "Failed.");
    } finally {
      setSaving(false);
    }
  }

  const labelStyle = { fontSize: "0.78rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#546770", display: "block", marginBottom: 6 };
  const inputStyle = { width: "100%", padding: "10px 14px", borderRadius: 8, border: "1px solid rgba(0,0,0,0.15)", fontSize: "0.9rem", fontFamily: "inherit" };

  return (
    <div style={{ background: "#fff", border: "1px solid rgba(0,0,0,0.1)", borderRadius: 16, padding: 32, maxWidth: 640 }}>
      <div style={{ display: "grid", gap: 16 }}>
        <div>
          <label style={labelStyle}>Title *</label>
          <input style={inputStyle} value={data.title} onChange={(e) => set("title", e.target.value)} placeholder="Press release title" />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
          <div>
            <label style={labelStyle}>Date</label>
            <input type="date" style={inputStyle} value={data.date} onChange={(e) => set("date", e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>Language</label>
            <input
              list="press-languages-list"
              style={inputStyle}
              value={data.language}
              onChange={(e) => set("language", e.target.value.toLowerCase())}
              placeholder="fr, en, de…"
              maxLength={10}
            />
            <datalist id="press-languages-list">
              {PRESS_LANGUAGES.map((l) => <option key={l} value={l}>{l.toUpperCase()}</option>)}
            </datalist>
          </div>
          <div>
            <label style={labelStyle}>Year</label>
            <input type="number" style={inputStyle} value={data.year} onChange={(e) => set("year", e.target.value)} />
          </div>
        </div>
        <FileUpload
          label="PDF File"
          value={data.fileUrl}
          onChange={(url) => set("fileUrl", url)}
          storagePath="press-releases"
        />
        <div>
          <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
            <input type="checkbox" checked={data.published} onChange={(e) => set("published", e.target.checked)} style={{ width: 18, height: 18 }} />
            <span style={{ fontSize: "0.875rem", fontWeight: 600 }}>Published (visible on site)</span>
          </label>
        </div>
        {error && (
          <div style={{ background: "#fff0f0", border: "1px solid #f87171", borderRadius: 8, padding: "12px 16px", color: "#b91c1c", fontSize: "0.875rem" }}>
            {error}
          </div>
        )}
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={handleSave} disabled={saving} className="btn btn-primary">
            {saving ? "Saving…" : "Save press release"}
          </button>
          <button onClick={onCancel} className="btn btn-ghost">Cancel</button>
        </div>
      </div>
    </div>
  );
}

export function WebsitePressPage({ Panel }) {
  const { releases, loading } = useAllPressReleases();
  const [editing, setEditing] = useState(null);
  const [creating, setCreating] = useState(false);

  async function handleSave(data) {
    await savePressRelease(editing?.id || null, data);
    setEditing(null);
    setCreating(false);
  }

  async function handleDelete(id, title) {
    if (!window.confirm(`Delete "${title}"?`)) return;
    await deletePressRelease(id);
  }

  if (creating || editing) {
    return (
      <Panel title={editing ? "Edit press release" : "New press release"}>
        <PressReleaseForm
          initial={editing || {}}
          onSave={handleSave}
          onCancel={() => { setEditing(null); setCreating(false); }}
        />
      </Panel>
    );
  }

  return (
    <Panel
      title="Press Releases"
      subtitle="Manage press releases displayed on the public press page"
      actions={
        <button className="btn btn-primary" onClick={() => setCreating(true)}>
          + New press release
        </button>
      }
    >
      {loading ? (
        <p>Loading…</p>
      ) : releases.length === 0 ? (
        <div style={{ textAlign: "center", padding: "48px 0", color: "#546770" }}>
          <p>No press releases yet.</p>
          <button className="btn btn-primary" onClick={() => setCreating(true)} style={{ marginTop: 16 }}>
            + New press release
          </button>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Date</th>
                <th>Language</th>
                <th>Category</th>
                <th>Published</th>
                <th>PDF</th>
                <th style={{ width: 120 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {releases.map((r) => (
                <tr key={r.id}>
                  <td style={{ fontWeight: 600 }}>{r.title}</td>
                  <td style={{ fontSize: "0.82rem" }}>{formatDate(r.date)}</td>
                  <td>{(r.language || "").toUpperCase()}</td>
                  <td style={{ fontSize: "0.82rem" }}>{r.category}</td>
                  <td>{r.published ? "✅" : "❌"}</td>
                  <td>
                    {r.fileUrl ? (
                      <a href={r.fileUrl} target="_blank" rel="noopener noreferrer" style={{ color: "#1066cc", fontSize: "0.82rem" }}>
                        View PDF
                      </a>
                    ) : "—"}
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button className="btn btn-sm btn-secondary" onClick={() => setEditing(r)}>Edit</button>
                      <button className="btn btn-sm btn-danger" onClick={() => handleDelete(r.id, r.title)}>Del</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

/* ── Website admin overview ──────────────────────────────── */
export function WebsiteDashboardPage({ Panel }) {
  const { news } = useAllNews();
  const { sponsors } = useSponsors(false);
  const { releases } = useAllPressReleases();

  const publishedNews = news.filter((n) => n.status === "published").length;
  const draftNews = news.filter((n) => n.status === "draft").length;
  const activeSponsors = sponsors.filter((s) => s.active).length;
  const publishedReleases = releases.filter((r) => r.published).length;

  const sections = [
    {
      to: "/app/website/edition",
      icon: "📅",
      title: "Édition courante",
      desc: "Date, lieu, liens live, disciplines, timetable",
      cta: "Configurer l'édition",
    },
    {
      to: "/app/website/emagazine",
      icon: "📖",
      title: "E-magazine",
      desc: "Welcome page, highlights, partner ads, startlists",
      cta: "Configure magazine",
    },
    {
      to: "/app/website/news",
      icon: "📰",
      title: "News",
      desc: `${publishedNews} published, ${draftNews} draft`,
      cta: "Manage news",
    },
    {
      to: "/app/website/sponsors",
      icon: "🤝",
      title: "Partners & Sponsors",
      desc: `${activeSponsors} active sponsor${activeSponsors !== 1 ? "s" : ""}`,
      cta: "Manage partners",
    },
    {
      to: "/app/website/press",
      icon: "📄",
      title: "Press Releases",
      desc: `${publishedReleases} published`,
      cta: "Manage press",
    },
    {
      to: "/",
      icon: "🌐",
      title: "View public site",
      desc: "Open the public-facing website",
      cta: "Open site →",
      external: true,
    },
  ];

  return (
    <Panel title="Website Management" subtitle="Manage content published on the public CMCM event website">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 20, marginTop: 8 }}>
        {sections.map((s) => (
          s.external ? (
            <a
              key={s.to}
              href={s.to}
              target="_blank"
              rel="noopener noreferrer"
              style={{ textDecoration: "none" }}
            >
              <div className="panel" style={{ cursor: "pointer", height: "100%", transition: "box-shadow 0.2s" }}>
                <div style={{ fontSize: "2rem", marginBottom: 12 }}>{s.icon}</div>
                <h3 style={{ fontSize: "1rem", marginBottom: 6 }}>{s.title}</h3>
                <p style={{ fontSize: "0.82rem", color: "#546770", marginBottom: 16 }}>{s.desc}</p>
                <span style={{ fontSize: "0.82rem", fontWeight: 700, color: "#1066cc" }}>{s.cta}</span>
              </div>
            </a>
          ) : (
            <NavLink key={s.to} to={s.to} style={{ textDecoration: "none" }}>
              <div className="panel" style={{ cursor: "pointer", height: "100%" }}>
                <div style={{ fontSize: "2rem", marginBottom: 12 }}>{s.icon}</div>
                <h3 style={{ fontSize: "1rem", marginBottom: 6 }}>{s.title}</h3>
                <p style={{ fontSize: "0.82rem", color: "#546770", marginBottom: 16 }}>{s.desc}</p>
                <span style={{ fontSize: "0.82rem", fontWeight: 700, color: "#1066cc" }}>{s.cta}</span>
              </div>
            </NavLink>
          )
        ))}
      </div>
    </Panel>
  );
}

/* ── Edition config page ─────────────────────────────────── */

const CANONICAL_DISCIPLINES = [
  "60m", "60m Hurdles", "200m", "400m", "800m", "1500m", "Mile",
  "3000m", "5000m", "High Jump", "Pole Vault", "Long Jump", "Triple Jump",
  "Shot Put", "Weight Throw",
];

const FIELD_EVENTS = new Set(["High Jump", "Pole Vault", "Long Jump", "Triple Jump", "Shot Put", "Weight Throw"]);

const ROUND_OPTIONS = ["Final", "Final A", "Final B", "Final 1", "Final 2", "Heats", "Heats combinées", "Semi-Final"];

export function WebsiteEditionPage({ Panel }) {
  const { editions, loading: editionsLoading } = useMeetingEditions();
  const { siteEditionYear } = useSiteEditionYear();

  // Default to the edition currently used on the public site
  const defaultYear = siteEditionYear ?? editions.find((e) => !e.isClosed)?.year ?? editions[0]?.year ?? null;
  const [selectedYear, setSelectedYear] = useState(null);
  const effectiveYear = selectedYear ?? defaultYear;
  const selectedEdition = editions.find((e) => e.year === effectiveYear) ?? null;

  // Infos de base
  const [dateInput, setDateInput] = useState("");
  const [venueInput, setVenueInput] = useState("");
  const [spectatorCountInput, setSpectatorCountInput] = useState("");
  const [worldLeadCountInput, setWorldLeadCountInput] = useState("");
  const [infoSaving, setInfoSaving] = useState(false);

  // Liens live
  const [streamingUrlInput, setStreamingUrlInput] = useState("");
  const [resultsUrlInput, setResultsUrlInput] = useState("");
  const [nationalRacesUrlInput, setNationalRacesUrlInput] = useState("");
  const [liveUrlsSaving, setLiveUrlsSaving] = useState(false);

  // Disciplines
  const [disciplinesSaving, setDisciplinesSaving] = useState(false);
  const [prizeMoneyDraft, setPrizeMoneyDraft] = useState(createPrizeMoneySystemsDraft());
  const [prizeMoneySaving, setPrizeMoneySaving] = useState(false);

  // Timetable
  const [ttForm, setTtForm] = useState({ type: "event", time: "", gender: "WOMEN", event: "", round: "Final", isField: false, label: "PRE-PROGRAM" });
  const [timetableSaving, setTimetableSaving] = useState(false);
  const [timetableStatusSaving, setTimetableStatusSaving] = useState(false);

  function getDisc(event) {
    return (selectedEdition?.disciplines || []).find((d) => d.event === event)
      || { event, womenPrize: null, menPrize: null };
  }

  async function handleDisciplineChange(event, gender, prize) {
    const current = (selectedEdition?.disciplines || []).filter((d) => d.event !== event);
    const existing = (selectedEdition?.disciplines || []).find((d) => d.event === event)
      || { event, womenPrize: null, menPrize: null };
    const updated = { ...existing, [gender === "W" ? "womenPrize" : "menPrize"]: prize || null };
    const next = [...current, updated].filter((d) => d.womenPrize || d.menPrize);
    setDisciplinesSaving(true);
    try { await updateEdition(effectiveYear, { disciplines: next }); }
    finally { setDisciplinesSaving(false); }
  }

  function newTtId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  async function handleAddTimetableEntry() {
    const current = selectedEdition?.timetable || [];
    const entry = ttForm.type === "header"
      ? { id: newTtId(), type: "header", label: ttForm.label }
      : { id: newTtId(), type: "event", time: ttForm.time.trim(), gender: ttForm.gender, event: ttForm.event.trim(), round: ttForm.round, isField: ttForm.isField };
    setTimetableSaving(true);
    try {
      await updateEdition(effectiveYear, { timetable: [...current, entry] });
      setTtForm((f) => ({ ...f, time: "" }));
    } finally { setTimetableSaving(false); }
  }

  async function handleTimetableStatusChange(value) {
    setTimetableStatusSaving(true);
    try { await updateEdition(effectiveYear, { timetableStatus: value }); }
    finally { setTimetableStatusSaving(false); }
  }

  async function handleRemoveTimetableEntry(id) {
    const next = (selectedEdition?.timetable || []).filter((e) => e.id !== id);
    setTimetableSaving(true);
    try { await updateEdition(effectiveYear, { timetable: next }); }
    finally { setTimetableSaving(false); }
  }

  async function handleMoveTimetableEntry(id, dir) {
    const arr = [...(selectedEdition?.timetable || [])];
    const idx = arr.findIndex((e) => e.id === id);
    if (idx < 0) return;
    const swap = idx + dir;
    if (swap < 0 || swap >= arr.length) return;
    [arr[idx], arr[swap]] = [arr[swap], arr[idx]];
    setTimetableSaving(true);
    try { await updateEdition(effectiveYear, { timetable: arr }); }
    finally { setTimetableSaving(false); }
  }

  const [creatingYear, setCreatingYear] = useState(false);
  const nextYear = editions.length > 0 ? Math.max(...editions.map((e) => e.year)) + 1 : new Date().getFullYear() + 1;
  const nextYearExists = editions.some((e) => e.year === nextYear);

  useEffect(() => {
    setDateInput(formatDateInputValue(selectedEdition?.date));
    setVenueInput(selectedEdition?.venue || "");
    setSpectatorCountInput(
      Number.isFinite(selectedEdition?.spectatorCount) ? String(selectedEdition.spectatorCount) : "",
    );
    setWorldLeadCountInput(
      Number.isFinite(selectedEdition?.worldLeadCount) ? String(selectedEdition.worldLeadCount) : "",
    );
  }, [selectedEdition?.date, selectedEdition?.venue, selectedEdition?.spectatorCount, selectedEdition?.worldLeadCount, effectiveYear]);

  useEffect(() => {
    setPrizeMoneyDraft(createPrizeMoneySystemsDraft(selectedEdition?.prizeMoneySystems));
  }, [selectedEdition?.prizeMoneySystems, effectiveYear]);

  useEffect(() => {
    if (!siteEditionYear && effectiveYear) {
      void setSiteEditionYear(effectiveYear);
    }
  }, [siteEditionYear, effectiveYear]);

  async function handleCreateEdition() {
    setCreatingYear(true);
    try {
      await updateEdition(nextYear, { year: nextYear });
      await setSiteEditionYear(nextYear);
      setSelectedYear(nextYear);
    } finally { setCreatingYear(false); }
  }

  const prizeMoneySystemKeys = getPrizeMoneySystemKeys(prizeMoneyDraft);

  function handlePrizeMoneyDraftChange(systemKey, rowIndex, field, value) {
    setPrizeMoneyDraft((current) => ({
      ...current,
      [systemKey]: (current[systemKey] || []).map((row, index) => (
        index === rowIndex ? { ...row, [field]: value } : row
      )),
    }));
  }

  function handlePrizeMoneyRowAdd(systemKey) {
    setPrizeMoneyDraft((current) => ({
      ...current,
      [systemKey]: [
        ...(current[systemKey] || []),
        { place: "", amount: "", currency: "EUR" },
      ],
    }));
  }

  function handlePrizeMoneyRowRemove(systemKey, rowIndex) {
    setPrizeMoneyDraft((current) => ({
      ...current,
      [systemKey]: (current[systemKey] || []).filter((_, index) => index !== rowIndex),
    }));
  }

  async function handlePrizeMoneySave() {
    setPrizeMoneySaving(true);
    try {
      await updateEdition(effectiveYear, {
        prizeMoneySystems: serializePrizeMoneySystems(prizeMoneyDraft),
      });
    } finally {
      setPrizeMoneySaving(false);
    }
  }

  const inp = { padding: "6px 10px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: "0.8rem", fontFamily: "inherit" };

  return (
    <Panel title="Édition courante — Configuration site" subtitle="Date, lieu, liens live, disciplines et timetable affichés sur le site public">
      {/* Edition selector */}
      <div style={{ marginBottom: 24 }}>
        <label style={{ fontSize: "0.78rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#546770", display: "block", marginBottom: 8 }}>
          Édition
        </label>
        {editionsLoading ? (
          <p style={{ color: "#546770", fontSize: "0.875rem" }}>Chargement…</p>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <select
              value={effectiveYear ?? ""}
              onChange={async (e) => {
                const nextYearValue = Number(e.target.value);
                setSelectedYear(nextYearValue);
                await setSiteEditionYear(nextYearValue);
              }}
              style={{ ...inp, minWidth: 140 }}
            >
              {editions.filter((e) => !e.cancelled).map((e) => (
                <option key={e.year} value={e.year}>
                  {e.year}{e.isClosed ? " ✓" : ""}
                </option>
              ))}
            </select>
            {!nextYearExists && (
              <button
                className="btn btn--secondary"
                onClick={handleCreateEdition}
                disabled={creatingYear}
                style={{ fontSize: "0.8rem", whiteSpace: "nowrap" }}
              >
                {creatingYear ? "Création…" : `+ Créer l'édition ${nextYear}`}
              </button>
            )}
          </div>
        )}
      </div>

      {selectedEdition && (
        <div style={{ display: "grid", gap: 24 }}>

          {/* ── Infos de base ── */}
          <div style={{ padding: "16px 20px", background: "#f8fafc", borderRadius: 10, border: "1px solid #e2e8f0" }}>
            <div style={{ fontWeight: 700, fontSize: "0.85rem", color: "#374151", marginBottom: 14 }}>Infos de base</div>
            <div style={{ fontSize: "0.78rem", color: "#6b7280", marginBottom: 12 }}>
              Cette édition est celle utilisée sur la home pour la date, le lieu et le numéro affichés sous le titre.
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: "0.72rem", color: "#6b7280", marginBottom: 4 }}>Date</div>
                <input
                  type="date"
                  value={dateInput}
                  onChange={(e) => setDateInput(e.target.value)}
                  style={{ ...inp, width: "100%", boxSizing: "border-box" }}
                />
              </div>
              <div>
                <div style={{ fontSize: "0.72rem", color: "#6b7280", marginBottom: 4 }}>Lieu</div>
                <input
                  type="text"
                  placeholder={selectedEdition.venue || "ex : Coque, Luxembourg"}
                  value={venueInput}
                  onChange={(e) => setVenueInput(e.target.value)}
                  style={{ ...inp, width: "100%", boxSizing: "border-box" }}
                />
              </div>
            </div>
            <div style={{ fontSize: "0.78rem", color: "#6b7280", marginBottom: 12 }}>
              Ces deux chiffres alimentent les compteurs "Spectators" et "World Leads" affichés sur la home publique.
              Athlètes et pays sont calculés automatiquement à partir des résultats de l'édition.
              <br />
              <strong>Important&nbsp;:</strong> la home affiche toujours les chiffres de la <strong>dernière édition clôturée</strong>
              (celle marquée « ✓ » dans le sélecteur ci-dessus), pas forcément l'édition sélectionnée ici. Renseigne
              donc ces champs sur l'édition clôturée, pas sur l'édition en préparation.
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: "0.72rem", color: "#6b7280", marginBottom: 4 }}>Spectateurs</div>
                <input
                  type="number"
                  min="0"
                  placeholder="ex : 2500"
                  value={spectatorCountInput}
                  onChange={(e) => setSpectatorCountInput(e.target.value)}
                  style={{ ...inp, width: "100%", boxSizing: "border-box" }}
                />
              </div>
              <div>
                <div style={{ fontSize: "0.72rem", color: "#6b7280", marginBottom: 4 }}>World Leads</div>
                <input
                  type="number"
                  min="0"
                  placeholder="ex : 3"
                  value={worldLeadCountInput}
                  onChange={(e) => setWorldLeadCountInput(e.target.value)}
                  style={{ ...inp, width: "100%", boxSizing: "border-box" }}
                />
              </div>
            </div>
            <button
              className="btn btn--secondary"
              disabled={infoSaving || (!dateInput && !venueInput.trim() && spectatorCountInput === "" && worldLeadCountInput === "")}
              onClick={async () => {
                setInfoSaving(true);
                const fields = {};
                if (dateInput) fields.date = new Date(`${dateInput}T12:00:00`);
                if (venueInput.trim()) fields.venue = venueInput.trim();
                if (spectatorCountInput !== "") fields.spectatorCount = Number(spectatorCountInput);
                if (worldLeadCountInput !== "") fields.worldLeadCount = Number(worldLeadCountInput);
                try {
                  await updateEdition(effectiveYear, fields);
                  await setSiteEditionYear(effectiveYear);
                  setDateInput("");
                  setVenueInput("");
                }
                finally { setInfoSaving(false); }
              }}
              style={{ fontSize: "0.8rem" }}
            >
              {infoSaving ? "…" : "Sauvegarder"}
            </button>
          </div>

          {/* ── Liens Live ── */}
          <div style={{ padding: "16px 20px", background: "#f8fafc", borderRadius: 10, border: "1px solid #e2e8f0", display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ fontWeight: 700, fontSize: "0.85rem", color: "#374151" }}>Liens Live — site public</div>

            {/* Streaming */}
            <div>
              <div style={{ fontWeight: 600, fontSize: "0.78rem", color: "#6b7280", marginBottom: 6 }}>
                Streaming (YouTube embed) — affiché uniquement si renseigné
              </div>
              {selectedEdition.streamingUrl && (
                <div style={{ fontSize: "0.72rem", color: "#6b7280", marginBottom: 6, wordBreak: "break-all" }}>
                  Actuel : <code style={{ background: "#f1f5f9", padding: "1px 4px", borderRadius: 4 }}>{selectedEdition.streamingUrl}</code>
                </div>
              )}
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  type="url"
                  placeholder="https://www.youtube.com/embed/…"
                  value={streamingUrlInput}
                  onChange={(e) => setStreamingUrlInput(e.target.value)}
                  onFocus={() => !streamingUrlInput && setStreamingUrlInput(selectedEdition.streamingUrl || "")}
                  style={{ ...inp, flex: 1 }}
                />
                <button
                  className="btn btn--secondary"
                  disabled={liveUrlsSaving || !streamingUrlInput.trim()}
                  onClick={async () => {
                    setLiveUrlsSaving(true);
                    try { await updateEdition(effectiveYear, { streamingUrl: streamingUrlInput.trim() }); setStreamingUrlInput(""); }
                    finally { setLiveUrlsSaving(false); }
                  }}
                  style={{ whiteSpace: "nowrap", fontSize: "0.8rem" }}
                >
                  {liveUrlsSaving ? "…" : "Sauvegarder"}
                </button>
                {selectedEdition.streamingUrl && (
                  <button
                    className="btn btn--secondary"
                    disabled={liveUrlsSaving}
                    onClick={async () => {
                      setLiveUrlsSaving(true);
                      try { await updateEdition(effectiveYear, { streamingUrl: null }); }
                      finally { setLiveUrlsSaving(false); }
                    }}
                    style={{ whiteSpace: "nowrap", fontSize: "0.8rem", color: "#dc2626", borderColor: "#fca5a5" }}
                  >
                    Supprimer
                  </button>
                )}
              </div>
            </div>

            {/* Résultats live */}
            <div>
              <div style={{ fontWeight: 600, fontSize: "0.78rem", color: "#6b7280", marginBottom: 6 }}>
                Résultats live (iframe) — fallback laportal si vide
              </div>
              {selectedEdition.resultsUrl && (
                <div style={{ fontSize: "0.72rem", color: "#6b7280", marginBottom: 6, wordBreak: "break-all" }}>
                  Actuel : <code style={{ background: "#f1f5f9", padding: "1px 4px", borderRadius: 4 }}>{selectedEdition.resultsUrl}</code>
                </div>
              )}
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  type="url"
                  placeholder="https://fla.laportal.net/Competitions/Details/…"
                  value={resultsUrlInput}
                  onChange={(e) => setResultsUrlInput(e.target.value)}
                  onFocus={() => !resultsUrlInput && setResultsUrlInput(selectedEdition.resultsUrl || "")}
                  style={{ ...inp, flex: 1 }}
                />
                <button
                  className="btn btn--secondary"
                  disabled={liveUrlsSaving || !resultsUrlInput.trim()}
                  onClick={async () => {
                    setLiveUrlsSaving(true);
                    try { await updateEdition(effectiveYear, { resultsUrl: resultsUrlInput.trim() }); setResultsUrlInput(""); }
                    finally { setLiveUrlsSaving(false); }
                  }}
                  style={{ whiteSpace: "nowrap", fontSize: "0.8rem" }}
                >
                  {liveUrlsSaving ? "…" : "Sauvegarder"}
                </button>
                {selectedEdition.resultsUrl && (
                  <button
                    className="btn btn--secondary"
                    disabled={liveUrlsSaving}
                    onClick={async () => {
                      setLiveUrlsSaving(true);
                      try { await updateEdition(effectiveYear, { resultsUrl: null }); }
                      finally { setLiveUrlsSaving(false); }
                    }}
                    style={{ whiteSpace: "nowrap", fontSize: "0.8rem", color: "#dc2626", borderColor: "#fca5a5" }}
                  >
                    Supprimer
                  </button>
                )}
              </div>
            </div>

            {/* Pré-programme national races */}
            <div>
              <div style={{ fontWeight: 600, fontSize: "0.78rem", color: "#6b7280", marginBottom: 6 }}>
                Pré-programme — lien SELTEC pour les courses nationales (60m M/W, 800m M/W)
              </div>
              {selectedEdition.preprogrammeNationalRacesUrl && (
                <div style={{ fontSize: "0.72rem", color: "#6b7280", marginBottom: 6, wordBreak: "break-all" }}>
                  Actuel : <code style={{ background: "#f1f5f9", padding: "1px 4px", borderRadius: 4 }}>{selectedEdition.preprogrammeNationalRacesUrl}</code>
                </div>
              )}
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  type="url"
                  placeholder="https://www.seltec-sports.net/…"
                  value={nationalRacesUrlInput}
                  onChange={(e) => setNationalRacesUrlInput(e.target.value)}
                  onFocus={() => !nationalRacesUrlInput && setNationalRacesUrlInput(selectedEdition.preprogrammeNationalRacesUrl || "")}
                  style={{ ...inp, flex: 1 }}
                />
                <button
                  className="btn btn--secondary"
                  disabled={liveUrlsSaving || !nationalRacesUrlInput.trim()}
                  onClick={async () => {
                    setLiveUrlsSaving(true);
                    try { await updateEdition(effectiveYear, { preprogrammeNationalRacesUrl: nationalRacesUrlInput.trim() }); setNationalRacesUrlInput(""); }
                    finally { setLiveUrlsSaving(false); }
                  }}
                  style={{ whiteSpace: "nowrap", fontSize: "0.8rem" }}
                >
                  {liveUrlsSaving ? "…" : "Sauvegarder"}
                </button>
                {selectedEdition.preprogrammeNationalRacesUrl && (
                  <button
                    className="btn btn--secondary"
                    disabled={liveUrlsSaving}
                    onClick={async () => {
                      setLiveUrlsSaving(true);
                      try { await updateEdition(effectiveYear, { preprogrammeNationalRacesUrl: null }); }
                      finally { setLiveUrlsSaving(false); }
                    }}
                    style={{ whiteSpace: "nowrap", fontSize: "0.8rem", color: "#dc2626", borderColor: "#fca5a5" }}
                  >
                    Supprimer
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* ── Disciplines ── */}
          <div style={{ padding: "16px 20px", background: "#f8fafc", borderRadius: 10, border: "1px solid #e2e8f0" }}>
            <div style={{ fontWeight: 700, fontSize: "0.85rem", color: "#374151", marginBottom: 4 }}>
              Prize money systems
              {prizeMoneySaving && <span style={{ marginLeft: 8, fontSize: "0.75rem", color: "#6b7280", fontWeight: 400 }}>Sauvegarde…</span>}
            </div>
            <p style={{ fontSize: "0.75rem", color: "#6b7280", marginBottom: 16 }}>
              Configure here the prize money grids used by the discipline programme. The discipline selectors below assign system A, B, or another configured system to women and men.
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16, marginBottom: 18 }}>
              {prizeMoneySystemKeys.map((systemKey) => (
                <div key={systemKey} style={{ background: "#fff", border: "1px solid #dbe4ee", borderRadius: 10, padding: 16 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: "0.82rem", color: "#111827" }}>System {systemKey}</div>
                      <div style={{ fontSize: "0.72rem", color: "#6b7280" }}>
                        {(prizeMoneyDraft[systemKey] || []).length} row(s)
                      </div>
                    </div>
                    <button
                      className="btn btn--secondary"
                      type="button"
                      onClick={() => handlePrizeMoneyRowAdd(systemKey)}
                      style={{ fontSize: "0.78rem", padding: "6px 10px" }}
                    >
                      + Add row
                    </button>
                  </div>

                  <div style={{ display: "grid", gap: 8 }}>
                    {(prizeMoneyDraft[systemKey] || []).map((row, rowIndex) => (
                      <div key={`${systemKey}-${rowIndex}`} style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr auto", gap: 8, alignItems: "center" }}>
                        <input
                          type="text"
                          value={row.place}
                          onChange={(e) => handlePrizeMoneyDraftChange(systemKey, rowIndex, "place", e.target.value)}
                          placeholder="Place label"
                          style={{ ...inp, width: "100%" }}
                        />
                        <input
                          type="number"
                          min="0"
                          step="50"
                          value={row.amount}
                          onChange={(e) => handlePrizeMoneyDraftChange(systemKey, rowIndex, "amount", e.target.value)}
                          placeholder="Amount"
                          style={{ ...inp, width: "100%" }}
                        />
                        <button
                          className="btn btn--secondary"
                          type="button"
                          onClick={() => handlePrizeMoneyRowRemove(systemKey, rowIndex)}
                          style={{ fontSize: "0.78rem", padding: "6px 10px" }}
                        >
                          Delete
                        </button>
                      </div>
                    ))}
                  </div>

                  {(prizeMoneyDraft[systemKey] || []).length > 0 && (
                    <div style={{ marginTop: 12, fontSize: "0.74rem", color: "#6b7280" }}>
                      Preview: {(prizeMoneyDraft[systemKey] || [])
                        .map((row) => `${row.place || "Place"} ${formatPrizeMoneyAmount(row.amount || 0) || "EUR 0"}`)
                        .join(" · ")}
                    </div>
                  )}
                </div>
              ))}
            </div>
            <button
              className="btn btn--secondary"
              type="button"
              onClick={handlePrizeMoneySave}
              disabled={prizeMoneySaving}
              style={{ fontSize: "0.8rem", marginBottom: 20 }}
            >
              {prizeMoneySaving ? "Saving…" : "Save prize money systems"}
            </button>

            <div style={{ fontWeight: 700, fontSize: "0.85rem", color: "#374151", marginBottom: 4 }}>
              Disciplines
              {disciplinesSaving && <span style={{ marginLeft: 8, fontSize: "0.75rem", color: "#6b7280", fontWeight: 400 }}>Sauvegarde…</span>}
            </div>
            <p style={{ fontSize: "0.75rem", color: "#6b7280", marginBottom: 12 }}>
              {(selectedEdition.disciplines || []).length} épreuve(s) configurée(s). Les changements sont sauvegardés automatiquement. Choisir "—" supprime l'épreuve.
            </p>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
                <thead>
                  <tr style={{ background: "#f0f4f8" }}>
                    <th style={{ padding: "8px 12px", textAlign: "center", width: 120, fontWeight: 600, color: "#6b7280", borderBottom: "1px solid #e2e8f0" }}>WOMEN</th>
                    <th style={{ padding: "8px 12px", textAlign: "center", fontWeight: 700, color: "#111827", borderBottom: "1px solid #e2e8f0" }}>Épreuve</th>
                    <th style={{ padding: "8px 12px", textAlign: "center", width: 120, fontWeight: 600, color: "#6b7280", borderBottom: "1px solid #e2e8f0" }}>MEN</th>
                  </tr>
                </thead>
                <tbody>
                  {CANONICAL_DISCIPLINES.map((disc) => {
                    const d = getDisc(disc);
                    return (
                      <tr key={disc} style={{ borderBottom: "1px solid #f1f5f9" }}>
                        <td style={{ padding: "6px 12px", textAlign: "center" }}>
                          <select
                            value={d.womenPrize || ""}
                            onChange={(e) => handleDisciplineChange(disc, "W", e.target.value)}
                            style={{ padding: "3px 6px", borderRadius: 4, border: "1px solid #d1d5db", fontSize: "0.78rem", background: d.womenPrize ? "#dcfce7" : "#fff" }}
                          >
                            <option value="">—</option>
                            {prizeMoneySystemKeys.map((systemKey) => (
                              <option key={systemKey} value={systemKey}>Prize {systemKey}</option>
                            ))}
                          </select>
                        </td>
                        <td style={{ padding: "6px 12px", textAlign: "center", fontWeight: 600, color: "#111827" }}>{disc}</td>
                        <td style={{ padding: "6px 12px", textAlign: "center" }}>
                          <select
                            value={d.menPrize || ""}
                            onChange={(e) => handleDisciplineChange(disc, "M", e.target.value)}
                            style={{ padding: "3px 6px", borderRadius: 4, border: "1px solid #d1d5db", fontSize: "0.78rem", background: d.menPrize ? "#dcfce7" : "#fff" }}
                          >
                            <option value="">—</option>
                            {prizeMoneySystemKeys.map((systemKey) => (
                              <option key={systemKey} value={systemKey}>Prize {systemKey}</option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── Timetable ── */}
          <div style={{ padding: "16px 20px", background: "#f8fafc", borderRadius: 10, border: "1px solid #e2e8f0" }}>
            {/* Header + status toggle */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: "0.85rem", color: "#374151" }}>
                  Timetable
                  {(timetableSaving || timetableStatusSaving) && <span style={{ marginLeft: 8, fontSize: "0.75rem", color: "#6b7280", fontWeight: 400 }}>Sauvegarde…</span>}
                </div>
                <p style={{ fontSize: "0.75rem", color: "#6b7280", margin: "2px 0 0" }}>
                  {(selectedEdition.timetable || []).length} entrée(s)
                </p>
              </div>
              {/* Draft / Visible toggle */}
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: "0.75rem", color: "#6b7280", fontWeight: 600 }}>Visibilité :</span>
                <button
                  onClick={() => handleTimetableStatusChange("draft")}
                  disabled={timetableStatusSaving}
                  style={{
                    padding: "4px 10px", borderRadius: 6, fontSize: "0.75rem", fontWeight: 600, cursor: "pointer",
                    border: "1px solid #d1d5db",
                    background: (selectedEdition.timetableStatus || "draft") === "draft" ? "#374151" : "#f3f4f6",
                    color: (selectedEdition.timetableStatus || "draft") === "draft" ? "#fff" : "#6b7280",
                  }}
                >Brouillon</button>
                <button
                  onClick={() => handleTimetableStatusChange("visible")}
                  disabled={timetableStatusSaving}
                  style={{
                    padding: "4px 10px", borderRadius: 6, fontSize: "0.75rem", fontWeight: 600, cursor: "pointer",
                    border: "1px solid #d1d5db",
                    background: selectedEdition.timetableStatus === "visible" ? "#16a34a" : "#f3f4f6",
                    color: selectedEdition.timetableStatus === "visible" ? "#fff" : "#6b7280",
                  }}
                >Visible sur le site</button>
              </div>
            </div>

            {selectedEdition.timetableStatus !== "visible" && (
              <div style={{ padding: "6px 10px", background: "#fef3c7", borderRadius: 6, border: "1px solid #fcd34d", fontSize: "0.75rem", color: "#92400e", marginBottom: 12 }}>
                ⚠️ Brouillon — la timetable n'est pas encore visible sur le site public.
              </div>
            )}

            {/* Existing entries */}
            {(selectedEdition.timetable || []).length > 0 && (
              <div style={{ marginBottom: 20, border: "1px solid #e2e8f0", borderRadius: 8, overflow: "hidden" }}>
                {/* Column headers */}
                <div style={{ display: "grid", gridTemplateColumns: "52px 72px 80px 1fr 90px auto", alignItems: "center", padding: "5px 10px", background: "#f1f5f9", borderBottom: "1px solid #e2e8f0" }}>
                  {["#", "Heure", "Genre", "Épreuve", "Round", ""].map((h) => (
                    <span key={h} style={{ fontSize: "0.68rem", fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.06em" }}>{h}</span>
                  ))}
                </div>
                {(selectedEdition.timetable || []).map((entry, idx) => {
                  const isHeader = entry.type === "header";
                  const isRedHeader = isHeader && entry.label === "PRE-PROGRAM";
                  const rowBg = isHeader
                    ? (isRedHeader ? "#b91c1c" : "#1e3a5f")
                    : (entry.isField ? "#1e3a8a" : "#fff");
                  const rowColor = isHeader || entry.isField ? "#fff" : "#111827";
                  return (
                    <div
                      key={entry.id}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "52px 72px 80px 1fr 90px auto",
                        alignItems: "center",
                        padding: "6px 10px",
                        borderBottom: "1px solid #f1f5f9",
                        background: rowBg,
                        color: rowColor,
                      }}
                    >
                      {isHeader ? (
                        <>
                          <span style={{ fontSize: "0.75rem", fontWeight: 700, gridColumn: "1 / 6" }}>▶ {entry.label}</span>
                        </>
                      ) : (
                        <>
                          <span style={{ fontSize: "0.72rem", color: entry.isField ? "rgba(255,255,255,0.5)" : "#9ca3af" }}>{idx + 1}</span>
                          <span style={{ fontSize: "0.82rem", fontWeight: 600 }}>{entry.time || "—"}</span>
                          <span style={{ fontSize: "0.75rem", opacity: 0.85 }}>{entry.gender || "—"}</span>
                          <span style={{ fontSize: "0.82rem" }}>{entry.event}</span>
                          <span style={{ fontSize: "0.72rem", opacity: 0.8 }}>{entry.round || ""}</span>
                        </>
                      )}
                      <div style={{ display: "flex", gap: 3, justifyContent: "flex-end" }}>
                        <button
                          onClick={() => handleMoveTimetableEntry(entry.id, -1)}
                          disabled={idx === 0 || timetableSaving}
                          style={{ padding: "2px 5px", borderRadius: 4, border: "1px solid rgba(0,0,0,0.15)", background: "rgba(255,255,255,0.15)", cursor: "pointer", fontSize: "0.72rem", color: "inherit" }}
                        >↑</button>
                        <button
                          onClick={() => handleMoveTimetableEntry(entry.id, 1)}
                          disabled={idx === (selectedEdition.timetable || []).length - 1 || timetableSaving}
                          style={{ padding: "2px 5px", borderRadius: 4, border: "1px solid rgba(0,0,0,0.15)", background: "rgba(255,255,255,0.15)", cursor: "pointer", fontSize: "0.72rem", color: "inherit" }}
                        >↓</button>
                        <button
                          onClick={() => handleRemoveTimetableEntry(entry.id)}
                          disabled={timetableSaving}
                          style={{ padding: "2px 5px", borderRadius: 4, border: "1px solid rgba(220,38,38,0.3)", background: "rgba(220,38,38,0.1)", cursor: "pointer", fontSize: "0.72rem", color: entry.isField || isHeader ? "#fca5a5" : "#dc2626" }}
                        >×</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Add form */}
            <div style={{ padding: "12px 16px", background: "#fff", borderRadius: 8, border: "1px solid #e2e8f0" }}>
              <div style={{ fontWeight: 600, fontSize: "0.78rem", color: "#374151", marginBottom: 10 }}>Ajouter une entrée</div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
                <label style={{ fontSize: "0.78rem", display: "flex", alignItems: "center", gap: 4 }}>
                  <input type="radio" name="ttType" value="header" checked={ttForm.type === "header"} onChange={() => setTtForm((f) => ({ ...f, type: "header" }))} />
                  En-tête de section
                </label>
                <label style={{ fontSize: "0.78rem", display: "flex", alignItems: "center", gap: 4 }}>
                  <input type="radio" name="ttType" value="event" checked={ttForm.type === "event"} onChange={() => setTtForm((f) => ({ ...f, type: "event" }))} />
                  Épreuve
                </label>
              </div>
              {ttForm.type === "header" ? (
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <select
                    value={ttForm.label}
                    onChange={(e) => setTtForm((f) => ({ ...f, label: e.target.value }))}
                    style={{ ...inp }}
                  >
                    <option value="PRE-PROGRAM">PRE-PROGRAM</option>
                    <option value="MAIN-PROGRAM">MAIN-PROGRAM</option>
                  </select>
                  <button
                    className="btn btn--secondary"
                    disabled={timetableSaving}
                    onClick={handleAddTimetableEntry}
                    style={{ fontSize: "0.8rem" }}
                  >Ajouter</button>
                </div>
              ) : (
                <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
                  {/* Time */}
                  <div>
                    <div style={{ fontSize: "0.7rem", color: "#6b7280", marginBottom: 3 }}>Heure</div>
                    <input
                      type="text"
                      placeholder="16:06"
                      value={ttForm.time}
                      onChange={(e) => setTtForm((f) => ({ ...f, time: e.target.value }))}
                      style={{ ...inp, width: 68 }}
                    />
                  </div>
                  {/* Gender */}
                  <div>
                    <div style={{ fontSize: "0.7rem", color: "#6b7280", marginBottom: 3 }}>Genre</div>
                    <select
                      value={ttForm.gender}
                      onChange={(e) => setTtForm((f) => ({ ...f, gender: e.target.value }))}
                      style={{ ...inp }}
                    >
                      <option value="WOMEN">WOMEN</option>
                      <option value="MEN">MEN</option>
                      <option value="">—</option>
                    </select>
                  </div>
                  {/* Discipline — dropdown from configured disciplines */}
                  <div style={{ flex: "1 1 140px" }}>
                    <div style={{ fontSize: "0.7rem", color: "#6b7280", marginBottom: 3 }}>Épreuve</div>
                    <select
                      value={ttForm.event}
                      onChange={(e) => {
                        const ev = e.target.value;
                        setTtForm((f) => ({ ...f, event: ev, isField: FIELD_EVENTS.has(ev) }));
                      }}
                      style={{ ...inp, width: "100%" }}
                    >
                      <option value="">— Choisir —</option>
                      {/* Configured disciplines first */}
                      {(selectedEdition?.disciplines || []).length > 0 && (
                        <optgroup label="Disciplines configurées">
                          {CANONICAL_DISCIPLINES
                            .filter((d) => (selectedEdition.disciplines || []).some((x) => x.event === d))
                            .map((d) => <option key={d} value={d}>{d}{FIELD_EVENTS.has(d) ? " 🏟" : ""}</option>)
                          }
                        </optgroup>
                      )}
                      <optgroup label="Toutes les disciplines">
                        {CANONICAL_DISCIPLINES.map((d) => <option key={d} value={d}>{d}{FIELD_EVENTS.has(d) ? " 🏟" : ""}</option>)}
                      </optgroup>
                    </select>
                  </div>
                  {/* Round */}
                  <div>
                    <div style={{ fontSize: "0.7rem", color: "#6b7280", marginBottom: 3 }}>Round</div>
                    <select
                      value={ttForm.round}
                      onChange={(e) => setTtForm((f) => ({ ...f, round: e.target.value }))}
                      style={{ ...inp }}
                    >
                      {ROUND_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>
                  <button
                    className="btn btn--secondary"
                    disabled={timetableSaving || !ttForm.time.trim() || !ttForm.event}
                    onClick={handleAddTimetableEntry}
                    style={{ fontSize: "0.8rem" }}
                  >Ajouter</button>
                </div>
              )}
            </div>
          </div>

        </div>
      )}
    </Panel>
  );
}
