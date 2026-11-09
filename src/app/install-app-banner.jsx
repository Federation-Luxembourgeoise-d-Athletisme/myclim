import { useEffect, useState } from "react";
import { useLanguage } from "./language-context";
import { isIos, isStandalone } from "./notifications/push";

// Chrome/Android envoie `beforeinstallprompt` très tôt, souvent avant que
// l'accueil ne soit affiché : on le capture dès le chargement du module.
let deferredInstallPrompt = null;
const promptListeners = new Set();

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    promptListeners.forEach((listener) => listener());
  });
  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    promptListeners.forEach((listener) => listener());
  });
}

const DISMISS_KEY = "myclim-install-banner-dismissed";
const DISMISS_DAYS = 14;

function wasRecentlyDismissed() {
  try {
    const value = Number(window.localStorage.getItem(DISMISS_KEY) || 0);
    return value > 0 && Date.now() - value < DISMISS_DAYS * 24 * 60 * 60 * 1000;
  } catch {
    return false;
  }
}

function rememberDismiss() {
  try {
    window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
  } catch {
    // stockage indisponible : le bandeau reviendra, ce n'est pas grave
  }
}

function isPhoneLike() {
  return Boolean(window.matchMedia?.("(pointer: coarse)").matches) || isIos();
}

function PhoneIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="6.5" y="2.5" width="11" height="19" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 8v6m-2.6-2.6L12 14l2.6-2.6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10.5 18.5h3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 3v11M8.5 6.5 12 3l3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8 10H6.5A1.5 1.5 0 0 0 5 11.5v8A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5v-8a1.5 1.5 0 0 0-1.5-1.5H16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function AddSquareIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="4" y="4" width="16" height="16" rx="4" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 8.5v7M8.5 12h7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function MenuDotsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="5.5" r="1.8" fill="currentColor" />
      <circle cx="12" cy="12" r="1.8" fill="currentColor" />
      <circle cx="12" cy="18.5" r="1.8" fill="currentColor" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="m5.5 12.5 4 4 9-9" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="m7 7 10 10M17 7 7 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function InstallAppBanner() {
  const { t } = useLanguage();
  const [hidden, setHidden] = useState(() => isStandalone() || !isPhoneLike() || wasRecentlyDismissed());
  const [canPrompt, setCanPrompt] = useState(() => Boolean(deferredInstallPrompt));
  const [showSteps, setShowSteps] = useState(false);

  useEffect(() => {
    const listener = () => {
      setCanPrompt(Boolean(deferredInstallPrompt));
      if (isStandalone()) setHidden(true);
    };
    promptListeners.add(listener);
    return () => promptListeners.delete(listener);
  }, []);

  if (hidden) return null;

  const ios = isIos();
  const steps = ios
    ? [
        { icon: <ShareIcon />, text: t("installStepIosShare") },
        { icon: <AddSquareIcon />, text: t("installStepIosAdd") },
        { icon: <CheckIcon />, text: t("installStepIosConfirm") },
      ]
    : [
        { icon: <MenuDotsIcon />, text: t("installStepAndroidMenu") },
        { icon: <AddSquareIcon />, text: t("installStepAndroidAdd") },
        { icon: <CheckIcon />, text: t("installStepAndroidConfirm") },
      ];

  async function handleInstall() {
    if (deferredInstallPrompt) {
      const promptEvent = deferredInstallPrompt;
      deferredInstallPrompt = null;
      setCanPrompt(false);
      promptEvent.prompt();
      const choice = await promptEvent.userChoice.catch(() => null);
      if (choice?.outcome === "accepted") setHidden(true);
      return;
    }
    setShowSteps((value) => !value);
  }

  function handleDismiss() {
    rememberDismiss();
    setHidden(true);
  }

  return (
    <aside className={`install-banner${showSteps ? " install-banner--open" : ""}`} aria-label={t("installBannerTitle")}>
      <div className="install-banner__row">
        <span className="install-banner__icon">
          <PhoneIcon />
        </span>
        <div className="install-banner__text">
          <strong>{t("installBannerTitle")}</strong>
          <span>{t("installBannerText")}</span>
        </div>
        <button
          type="button"
          className="install-banner__action"
          onClick={handleInstall}
          aria-expanded={canPrompt ? undefined : showSteps}
        >
          {canPrompt || !showSteps ? t("installBannerAction") : t("installBannerHide")}
        </button>
        <button type="button" className="install-banner__close" onClick={handleDismiss} aria-label={t("installBannerLater")}>
          <CloseIcon />
        </button>
      </div>

      {showSteps ? (
        <ol className="install-banner__steps">
          {steps.map((step, index) => (
            <li key={index}>
              <span className="install-banner__step-num">{index + 1}</span>
              <span className="install-banner__step-icon">{step.icon}</span>
              <span className="install-banner__step-text">{step.text}</span>
            </li>
          ))}
        </ol>
      ) : null}
    </aside>
  );
}
