// Posts Facebook / Instagram reliés à une publication et leurs statistiques
// (porté de myFLA : social-panel.tsx et PostStats de publication-drawer.tsx).
import { useState } from "react";
import { facebookStats, formatCount, instagramStats, socialPostDay } from "./com-social.js";

const fmtDateTime = (iso) => new Date(iso).toLocaleString("fr-LU", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

const excerpt = (post, max = 70) => {
  const text = post.message.replace(/\s+/g, " ").trim() || "Publication sans texte";
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

function CopyLinkButton({ url }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="com-btn-ghost"
      style={{ padding: "2px 6px", fontSize: "0.75rem" }}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(url);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 2000);
        } catch {
          // Presse-papiers refusé : le lien reste accessible via « Ouvrir le post ».
        }
      }}
    >
      {copied ? "Lien copié ✓" : "Copier le lien"}
    </button>
  );
}

// Bloc « Facebook » ou « Instagram » : choisir le post publié et voir ses statistiques.
export function SocialPanel({ label, account, state, date, postId, stats, extra, onLink }) {
  const post = postId ? state.posts.find((p) => p.id === postId) : undefined;
  // Les posts publiés le jour prévu sont proposés en premier.
  const sameDay = state.posts.filter((p) => socialPostDay(p) === date);
  const others = state.posts.filter((p) => socialPostDay(p) !== date);
  const option = (p) => (
    <option key={p.id} value={p.id}>
      {new Date(p.createdTime).toLocaleDateString("fr-LU")} · {excerpt(p)}
    </option>
  );
  const note = post && extra ? extra(post) : null;

  return (
    <div className="com-stack" style={{ gap: 8 }}>
      <p className="com-section-title" style={{ margin: 0 }}>
        {label}
      </p>
      {state.status === "loading" ? <p className="com-muted">Chargement des publications…</p> : null}
      {state.status === "not-configured" || state.status === "error" ? <p className="com-empty com-warn-box">{state.message}</p> : null}

      {state.status === "ready" ? (
        <>
          <select aria-label={`Post ${label}`} className="com-input" value={postId || ""} onChange={(e) => onLink(e.target.value || null)}>
            <option value="">Aucun post lié</option>
            {postId && !post ? <option value={postId}>Post lié (plus dans les 40 derniers)</option> : null}
            {sameDay.length ? <optgroup label="Publiés le jour prévu">{sameDay.map(option)}</optgroup> : null}
            <optgroup label="Publications récentes">{others.map(option)}</optgroup>
          </select>

          {post ? (
            <div className="com-stack com-social-post">
              <div className="com-row" style={{ flexWrap: "nowrap", alignItems: "flex-start" }}>
                {post.pictureUrl ? <img src={post.pictureUrl} alt="" /> : null}
                <div className="com-stack" style={{ gap: 4 }}>
                  <span className="com-excerpt" style={{ WebkitLineClamp: 3 }}>
                    {post.message || "Publication sans texte"}
                  </span>
                  <span className="com-muted" style={{ fontSize: "0.75rem" }}>
                    Publié le {fmtDateTime(post.createdTime)}
                  </span>
                </div>
              </div>
              <StatGrid stats={stats(post)} />
              {note ? <span className="com-muted" style={{ fontSize: "0.75rem" }}>{note}</span> : null}
              {post.permalinkUrl ? (
                <span className="com-row" style={{ gap: 8 }}>
                  <a href={post.permalinkUrl} target="_blank" rel="noreferrer" className="com-link" style={{ fontSize: "0.8rem" }}>
                    Ouvrir le post ↗
                  </a>
                  <CopyLinkButton url={post.permalinkUrl} />
                </span>
              ) : null}
            </div>
          ) : (
            <p className="com-muted" style={{ fontSize: "0.75rem" }}>
              Une fois le post publié sur {account}, relie-le ici : la publication passe en « Publié ».
            </p>
          )}
        </>
      ) : null}
    </div>
  );
}

function StatGrid({ stats }) {
  return (
    <div className="com-stat-grid">
      {stats.map(([name, value]) => (
        <span key={name}>
          <b>{formatCount(value)}</b>
          <small>{name}</small>
        </span>
      ))}
    </div>
  );
}

// Statistiques des posts reliés, dans l'aperçu rapide du calendrier.
export function PostStats({ item, facebook, instagram }) {
  if (!item.facebookPostId && !item.instagramMediaId) return null;
  const published = (iso) =>
    iso ? `Publié le ${new Date(iso).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : null;
  const cards = [];
  const pending = [];

  const fb = item.facebookPostId ? facebook.posts.find((p) => p.id === item.facebookPostId) : undefined;
  if (fb) cards.push({ name: "Facebook", url: fb.permalinkUrl, stats: facebookStats(fb), meta: published(fb.createdTime) });
  else if (item.facebookPostId) pending.push(facebook.status === "loading" || facebook.status === "idle" ? "Facebook : chargement…" : "Facebook : statistiques indisponibles pour le moment.");

  const ig = item.instagramMediaId ? instagram.posts.find((p) => p.id === item.instagramMediaId) : undefined;
  if (ig) cards.push({ name: "Instagram", url: ig.permalinkUrl, stats: instagramStats(ig), meta: published(ig.createdTime) });
  else if (item.instagramMediaId) pending.push(instagram.status === "loading" || instagram.status === "idle" ? "Instagram : chargement…" : "Instagram : statistiques indisponibles pour le moment.");

  return (
    <section className="com-stack" style={{ gap: 10 }}>
      <p className="com-section-title" style={{ margin: 0 }}>
        Statistiques
      </p>
      {cards.map((card) => (
        <div key={card.name} className="com-stack com-social-post">
          <div className="com-row" style={{ justifyContent: "space-between" }}>
            <strong>{card.name}</strong>
            {card.url ? (
              <a href={card.url} target="_blank" rel="noreferrer" className="com-link" style={{ fontSize: "0.75rem" }}>
                Voir le post ↗
              </a>
            ) : null}
          </div>
          <StatGrid stats={card.stats} />
          {card.meta ? <small className="com-muted">{card.meta}</small> : null}
        </div>
      ))}
      {pending.map((text) => (
        <p key={text} className="com-muted" style={{ fontSize: "0.75rem", margin: 0 }}>
          {text}
        </p>
      ))}
    </section>
  );
}
