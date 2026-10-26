// Posts Facebook / Instagram reliés à une publication et leurs statistiques
// (porté de myFLA : social-panel.tsx et PostStats de publication-drawer.tsx).
import { useState } from "react";
import { useComLang } from "./com-i18n.js";
import { facebookStats, formatCount, instagramStats, socialPostDay } from "./com-social.js";

const fmtDateTime = (iso, locale) => new Date(iso).toLocaleString(locale, { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

const excerpt = (post, emptyText, max = 70) => {
  const text = post.message.replace(/\s+/g, " ").trim() || emptyText;
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

function CopyLinkButton({ url }) {
  const { tr } = useComLang();
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
      {copied ? tr("Lien copié ✓", "Link copied ✓") : tr("Copier le lien", "Copy link")}
    </button>
  );
}

// Bloc « Facebook » ou « Instagram » : choisir le post publié et voir ses statistiques.
export function SocialPanel({ label, account, state, date, postId, stats, extra, onLink }) {
  const { tr, locale } = useComLang();
  const noText = tr("Publication sans texte", "Post without text");
  const post = postId ? state.posts.find((p) => p.id === postId) : undefined;
  // Les posts publiés le jour prévu sont proposés en premier.
  const sameDay = state.posts.filter((p) => socialPostDay(p) === date);
  const others = state.posts.filter((p) => socialPostDay(p) !== date);
  const option = (p) => (
    <option key={p.id} value={p.id}>
      {new Date(p.createdTime).toLocaleDateString(locale)} · {excerpt(p, noText)}
    </option>
  );
  const note = post && extra ? extra(post) : null;

  return (
    <div className="com-stack" style={{ gap: 8 }}>
      <p className="com-section-title" style={{ margin: 0 }}>
        {label}
      </p>
      {state.status === "loading" ? <p className="com-muted">{tr("Chargement des publications…", "Loading posts…")}</p> : null}
      {state.status === "not-configured" || state.status === "error" ? <p className="com-empty com-warn-box">{state.message}</p> : null}

      {state.status === "ready" ? (
        <>
          <select aria-label={`Post ${label}`} className="com-input" value={postId || ""} onChange={(e) => onLink(e.target.value || null)}>
            <option value="">{tr("Aucun post lié", "No linked post")}</option>
            {postId && !post ? <option value={postId}>{tr("Post lié (introuvable sur le réseau)", "Linked post (not found on the network)")}</option> : null}
            {sameDay.length ? <optgroup label={tr("Publiés le jour prévu", "Published on the planned day")}>{sameDay.map(option)}</optgroup> : null}
            <optgroup label={tr("Publications récentes", "Recent posts")}>{others.map(option)}</optgroup>
          </select>

          {post ? (
            <div className="com-stack com-social-post">
              <div className="com-row" style={{ flexWrap: "nowrap", alignItems: "flex-start" }}>
                {post.pictureUrl ? <img src={post.pictureUrl} alt="" /> : null}
                <div className="com-stack" style={{ gap: 4 }}>
                  <span className="com-excerpt" style={{ WebkitLineClamp: 3 }}>
                    {post.message || noText}
                  </span>
                  <span className="com-muted" style={{ fontSize: "0.75rem" }}>
                    {tr("Publié le", "Published on")} {fmtDateTime(post.createdTime, locale)}
                  </span>
                </div>
              </div>
              <StatGrid stats={stats(post)} />
              {note ? <span className="com-muted" style={{ fontSize: "0.75rem" }}>{note}</span> : null}
              {post.permalinkUrl ? (
                <span className="com-row" style={{ gap: 8 }}>
                  <a href={post.permalinkUrl} target="_blank" rel="noreferrer" className="com-link" style={{ fontSize: "0.8rem" }}>
                    {tr("Ouvrir le post ↗", "Open post ↗")}
                  </a>
                  <CopyLinkButton url={post.permalinkUrl} />
                </span>
              ) : null}
            </div>
          ) : (
            <p className="com-muted" style={{ fontSize: "0.75rem" }}>
              {tr(
                `Une fois le post publié sur ${account}, relie-le ici : la publication passe en « Publié ».`,
                `Once the post is live on ${account}, link it here: the publication switches to "Published".`,
              )}
            </p>
          )}
        </>
      ) : null}
    </div>
  );
}

function StatGrid({ stats }) {
  const { locale } = useComLang();
  return (
    <div className="com-stat-grid">
      {stats.map(([name, value]) => (
        <span key={name}>
          <b>{formatCount(value, locale)}</b>
          <small>{name}</small>
        </span>
      ))}
    </div>
  );
}

// Statistiques des posts reliés, dans l'aperçu rapide du calendrier.
export function PostStats({ item, facebook, instagram }) {
  const { lang, tr, locale } = useComLang();
  if (!item.facebookPostId && !item.instagramMediaId) return null;
  const published = (iso) =>
    iso ? `${tr("Publié le", "Published on")} ${new Date(iso).toLocaleString(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : null;
  const cards = [];
  const pending = [];

  const fb = item.facebookPostId ? facebook.posts.find((p) => p.id === item.facebookPostId) : undefined;
  if (fb) cards.push({ name: "Facebook", url: fb.permalinkUrl, stats: facebookStats(fb, lang), meta: published(fb.createdTime) });
  else if (item.facebookPostId) pending.push(facebook.status === "loading" || facebook.status === "idle" ? tr("Facebook : chargement…", "Facebook: loading…") : tr("Facebook : statistiques indisponibles pour le moment.", "Facebook: stats unavailable for now."));

  const ig = item.instagramMediaId ? instagram.posts.find((p) => p.id === item.instagramMediaId) : undefined;
  if (ig) cards.push({ name: "Instagram", url: ig.permalinkUrl, stats: instagramStats(ig, lang), meta: published(ig.createdTime) });
  else if (item.instagramMediaId) pending.push(instagram.status === "loading" || instagram.status === "idle" ? tr("Instagram : chargement…", "Instagram: loading…") : tr("Instagram : statistiques indisponibles pour le moment.", "Instagram: stats unavailable for now."));

  return (
    <section className="com-stack" style={{ gap: 10 }}>
      <p className="com-section-title" style={{ margin: 0 }}>
        {tr("Statistiques", "Stats")}
      </p>
      {cards.map((card) => (
        <div key={card.name} className="com-stack com-social-post">
          <div className="com-row" style={{ justifyContent: "space-between" }}>
            <strong>{card.name}</strong>
            {card.url ? (
              <a href={card.url} target="_blank" rel="noreferrer" className="com-link" style={{ fontSize: "0.75rem" }}>
                {tr("Voir le post ↗", "View post ↗")}
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
