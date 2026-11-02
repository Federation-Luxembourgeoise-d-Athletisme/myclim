// Cloche (en haut de l'app) et page /app/notifications : historique, push sur
// cet appareil, préférences par type et, pour les admins, message à l'équipe.
import { useEffect, useMemo, useRef, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { collection, doc, limit, onSnapshot, orderBy, query, serverTimestamp, setDoc, updateDoc, writeBatch } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { useAuth } from "../../context/auth-context";
import { db, functions } from "../../services/firebase";
import { useComLang, pick } from "../communication/com-i18n";
import { getActiveRoles } from "../navigation";
import { ANNOUNCEMENT_GROUPS, NOTIFICATION_CHANNELS, channelsFor, visibleNotificationTypes } from "./notification-types";
import { disablePush, enablePush, getPushStatus, setAppBadge, storedPushToken } from "./push";
import "./notifications.css";

function useNotifications(uid, max) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!uid) return undefined;
    const ref = query(collection(db, "users", uid, "notifications"), orderBy("createdAt", "desc"), limit(max));
    return onSnapshot(
      ref,
      (snapshot) => {
        setItems(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() })));
        setLoading(false);
      },
      (error) => {
        console.error("Notifications listener failed", error);
        setLoading(false);
      },
    );
  }, [uid, max]);

  return { items, loading };
}

function markRead(uid, items) {
  const unread = items.filter((item) => !item.read);
  if (!unread.length) return Promise.resolve();
  const batch = writeBatch(db);
  unread.forEach((item) => batch.update(doc(db, "users", uid, "notifications", item.id), { read: true, readAt: serverTimestamp() }));
  return batch.commit();
}

function formatWhen(timestamp, lang) {
  const date = timestamp?.toDate?.();
  if (!date) return "";
  const minutes = Math.round((date.getTime() - Date.now()) / 60000);
  const format = new Intl.RelativeTimeFormat(lang, { numeric: "auto" });
  if (Math.abs(minutes) < 60) return format.format(minutes, "minute");
  if (Math.abs(minutes) < 60 * 24) return format.format(Math.round(minutes / 60), "hour");
  if (Math.abs(minutes) < 60 * 24 * 7) return format.format(Math.round(minutes / 1440), "day");
  return date.toLocaleDateString(lang === "fr" ? "fr-LU" : "en-GB", { day: "numeric", month: "short" });
}

function BellIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 16.5V11a6 6 0 1 1 12 0v5.5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0" />
    </svg>
  );
}

function NotificationList({ items, lang, onOpen }) {
  return (
    <ul className="notif-list">
      {items.map((item) => (
        <li key={item.id}>
          <button className={`notif-item${item.read ? "" : " notif-item--unread"}`} type="button" onClick={() => onOpen(item)}>
            <span className="notif-item__title">{pick(item.title, lang)}</span>
            <span className="notif-item__body">{pick(item.body, lang)}</span>
            <span className="notif-item__when">{formatWhen(item.createdAt, lang)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function useOpenNotification(uid) {
  const navigate = useNavigate();
  return (item) => {
    if (!item.read) updateDoc(doc(db, "users", uid, "notifications", item.id), { read: true, readAt: serverTimestamp() }).catch(() => {});
    if (item.path) navigate(item.path);
  };
}

export function NotificationBell() {
  const { currentUser } = useAuth();
  const uid = currentUser?.uid;
  const { lang, tr } = useComLang();
  const { items } = useNotifications(uid, 20);
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef(null);
  const openNotification = useOpenNotification(uid);
  const unreadCount = items.filter((item) => !item.read).length;

  useEffect(() => setAppBadge(unreadCount), [unreadCount]);

  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (!wrapperRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  if (!uid) return null;

  return (
    <div className="notif-bell" ref={wrapperRef}>
      <button
        className="notif-bell__button"
        type="button"
        aria-expanded={open}
        aria-label={unreadCount ? tr(`Notifications (${unreadCount} non lues)`, `Notifications (${unreadCount} unread)`) : "Notifications"}
        onClick={() => setOpen((current) => !current)}
      >
        <BellIcon />
        {unreadCount ? <span className="notif-bell__count">{unreadCount > 9 ? "9+" : unreadCount}</span> : null}
      </button>
      {open ? (
        <div className="notif-popover" role="dialog" aria-label="Notifications">
          <div className="notif-popover__head">
            <strong>Notifications</strong>
            {unreadCount ? (
              <button className="notif-link" type="button" onClick={() => markRead(uid, items)}>
                {tr("Tout marquer comme lu", "Mark all as read")}
              </button>
            ) : null}
          </div>
          {items.length ? (
            <NotificationList
              items={items}
              lang={lang}
              onOpen={(item) => {
                setOpen(false);
                openNotification(item);
              }}
            />
          ) : (
            <p className="notif-empty">{tr("Aucune notification pour l'instant.", "No notifications yet.")}</p>
          )}
          <NavLink className="notif-popover__foot" to="/app/notifications" onClick={() => setOpen(false)}>
            {tr("Tout voir et régler mes notifications", "See all and notification settings")}
          </NavLink>
        </div>
      ) : null}
    </div>
  );
}

function PushDeviceCard({ uid, lang, tr }) {
  const [status, setStatus] = useState("loading");
  const [enabledHere, setEnabledHere] = useState(() => Boolean(storedPushToken()));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    getPushStatus().then(setStatus).catch(() => setStatus("unsupported"));
  }, []);

  const run = async (action) => {
    setBusy(true);
    setMessage("");
    try {
      await action();
    } catch (error) {
      console.error("Push action failed", error);
      setMessage(tr("Ça n'a pas marché. Réessaie dans un instant.", "That didn't work. Please try again in a moment."));
    } finally {
      setBusy(false);
    }
  };

  const turnOn = () =>
    run(async () => {
      const result = await enablePush(uid, lang);
      setStatus(result);
      setEnabledHere(result === "granted");
      if (result === "granted") await httpsCallable(functions, "sendTestNotification")({});
    });
  const turnOff = () =>
    run(async () => {
      await disablePush(uid);
      setEnabledHere(false);
    });
  const test = () =>
    run(async () => {
      await httpsCallable(functions, "sendTestNotification")({});
      setMessage(tr("Notification de test envoyée.", "Test notification sent."));
    });

  const explanations = {
    install: tr(
      "Sur iPhone, les notifications ne marchent que depuis l'app : dans Safari, touche Partager puis « Sur l'écran d'accueil », puis ouvre myCLIM depuis l'icône.",
      "On iPhone, notifications only work from the app: in Safari tap Share, then “Add to Home Screen”, then open myCLIM from its icon.",
    ),
    unsupported: tr("Ce navigateur ne permet pas les notifications push.", "This browser doesn't support push notifications."),
    unconfigured: tr("Les notifications push ne sont pas encore configurées sur le serveur.", "Push notifications aren't configured on the server yet."),
    denied: tr(
      "Les notifications sont bloquées pour myCLIM. Autorise-les dans les réglages du téléphone ou du navigateur, puis reviens ici.",
      "Notifications are blocked for myCLIM. Allow them in your phone or browser settings, then come back here.",
    ),
  };

  return (
    <section className="panel notif-device">
      <div className="panel-head">
        <div>
          <h3>{tr("Push sur cet appareil", "Push on this device")}</h3>
          <p>{tr("À activer sur chaque téléphone ou ordinateur où tu veux être prévenu(e).", "Turn it on on each phone or computer where you want to be notified.")}</p>
        </div>
      </div>
      {status === "loading" ? null : explanations[status] ? (
        <p className="notif-device__hint">{explanations[status]}</p>
      ) : enabledHere && status === "granted" ? (
        <div className="notif-device__actions">
          <span className="notif-device__on">{tr("Activé sur cet appareil", "On for this device")}</span>
          <button className="button button--secondary button--small" type="button" disabled={busy} onClick={test}>
            {tr("Envoyer un test", "Send a test")}
          </button>
          <button className="button button--secondary button--small" type="button" disabled={busy} onClick={turnOff}>
            {tr("Désactiver", "Turn off")}
          </button>
        </div>
      ) : (
        <div className="notif-device__actions">
          <button className="button button--primary" type="button" disabled={busy} onClick={turnOn}>
            {tr("Activer les notifications", "Turn on notifications")}
          </button>
        </div>
      )}
      {message ? <p className="notif-device__message">{message}</p> : null}
    </section>
  );
}

function PreferencesCard({ uid, prefs, roles, lang, tr }) {
  // Changements de cette page, posés sur les réglages enregistrés du profil.
  const [changes, setChanges] = useState({});
  const [error, setError] = useState("");
  const types = useMemo(() => visibleNotificationTypes(roles), [roles]);
  const draft = { ...(prefs || {}), ...changes };

  const toggle = async (type, channel) => {
    const current = channelsFor(draft, type);
    const nextType = { ...current, [channel]: !current[channel] };
    setChanges((previous) => ({ ...previous, [type.id]: nextType }));
    setError("");
    try {
      await setDoc(doc(db, "users", uid), { notificationPrefs: { [type.id]: nextType } }, { merge: true });
    } catch (saveError) {
      console.error("Notification preferences save failed", saveError);
      setChanges((previous) => ({ ...previous, [type.id]: current }));
      setError(tr("Réglage non enregistré, réessaie.", "Setting not saved, please try again."));
    }
  };

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h3>{tr("Ce que je reçois", "What I receive")}</h3>
          <p>{tr("Décoche ce qui ne t'intéresse pas. Le push s'applique à tous tes appareils activés.", "Untick what you don't need. Push applies to all your enabled devices.")}</p>
        </div>
      </div>
      <ul className="notif-prefs">
        {types.map((type) => {
          const channels = channelsFor(draft, type);
          return (
            <li key={type.id} className="notif-prefs__row">
              <div>
                <strong>{pick(type.label, lang)}</strong>
                {type.hint ? <span className="notif-prefs__hint">{pick(type.hint, lang)}</span> : null}
              </div>
              <div className="notif-prefs__channels">
                {NOTIFICATION_CHANNELS.map((channel) => (
                  <label key={channel.id} className="notif-chip">
                    <input type="checkbox" checked={Boolean(channels[channel.id])} onChange={() => toggle(type, channel.id)} />
                    {pick(channel.label, lang)}
                  </label>
                ))}
              </div>
            </li>
          );
        })}
      </ul>
      {error ? <p className="notif-device__message">{error}</p> : null}
    </section>
  );
}

function AnnouncementCard({ lang, tr }) {
  const [groups, setGroups] = useState(["team"]);
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");

  const toggleGroup = (id) => setGroups((current) => (current.includes(id) ? current.filter((group) => group !== id) : [...current, id]));

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setFeedback("");
    try {
      const { data } = await httpsCallable(functions, "sendTeamAnnouncement")({ groups, title, message, path: path.trim(), lang });
      setFeedback(tr(`Message envoyé à ${data.count} personne(s).`, `Message sent to ${data.count} people.`));
      setTitle("");
      setMessage("");
      setPath("");
    } catch (error) {
      setFeedback(error?.message || tr("Envoi impossible.", "Could not send."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h3>{tr("Envoyer un message à l'équipe", "Send a message to the team")}</h3>
          <p>{tr("Arrive dans la cloche, en push et par e-mail, selon les réglages de chacun.", "Shows in the bell, as a push and by email, depending on each person's settings.")}</p>
        </div>
      </div>
      <form className="notif-announce" onSubmit={submit}>
        <fieldset className="notif-announce__groups">
          <legend>{tr("Destinataires", "Recipients")}</legend>
          {ANNOUNCEMENT_GROUPS.map((group) => (
            <label key={group.id} className="notif-chip">
              <input type="checkbox" checked={groups.includes(group.id)} onChange={() => toggleGroup(group.id)} />
              {pick(group.label, lang)}
            </label>
          ))}
        </fieldset>
        <label className="notif-field">
          <span>{tr("Titre", "Title")}</span>
          <input value={title} maxLength={120} required onChange={(event) => setTitle(event.target.value)} />
        </label>
        <label className="notif-field">
          <span>{tr("Message", "Message")}</span>
          <textarea value={message} maxLength={1000} rows={4} required onChange={(event) => setMessage(event.target.value)} />
        </label>
        <label className="notif-field">
          <span>{tr("Page à ouvrir (facultatif)", "Page to open (optional)")}</span>
          <input value={path} placeholder="/app/mes-affectations" onChange={(event) => setPath(event.target.value)} />
        </label>
        <div>
          <button className="button button--primary" type="submit" disabled={busy || !groups.length}>
            {busy ? tr("Envoi…", "Sending…") : tr("Envoyer", "Send")}
          </button>
        </div>
        {feedback ? <p className="notif-device__message">{feedback}</p> : null}
      </form>
    </section>
  );
}

export function NotificationsPage() {
  const { currentUser, userProfile } = useAuth();
  const uid = currentUser?.uid;
  const roles = getActiveRoles(userProfile);
  const { lang, tr } = useComLang();
  const { items, loading } = useNotifications(uid, 100);
  const openNotification = useOpenNotification(uid);
  const unread = items.filter((item) => !item.read);

  return (
    <div className="notif-page">
      <PushDeviceCard uid={uid} lang={lang} tr={tr} />
      <PreferencesCard uid={uid} prefs={userProfile?.notificationPrefs} roles={roles} lang={lang} tr={tr} />
      {roles.includes("admin") ? <AnnouncementCard lang={lang} tr={tr} /> : null}
      <section className="panel">
        <div className="panel-head">
          <div>
            <h3>{tr("Historique", "History")}</h3>
          </div>
          {unread.length ? (
            <div className="panel-actions">
              <button className="button button--secondary button--small" type="button" onClick={() => markRead(uid, items)}>
                {tr("Tout marquer comme lu", "Mark all as read")}
              </button>
            </div>
          ) : null}
        </div>
        {loading ? null : items.length ? (
          <NotificationList items={items} lang={lang} onOpen={openNotification} />
        ) : (
          <p className="notif-empty">{tr("Aucune notification pour l'instant.", "No notifications yet.")}</p>
        )}
      </section>
    </div>
  );
}
