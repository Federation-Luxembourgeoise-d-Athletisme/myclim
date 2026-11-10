import { useEffect, useRef } from "react";

// Garde « modifications non enregistrées » partagée par toute l'app.
// Une page qui a un brouillon enregistre son message ici ; la navigation
// (liens du menu, changement de rôle, déconnexion, fermeture de l'onglet)
// demande alors confirmation avant de faire perdre la saisie.

const activeGuards = new Map();
let nextGuardId = 1;

function getActiveMessage() {
  const messages = [...activeGuards.values()].filter(Boolean);
  return messages[messages.length - 1] || "";
}

// À appeler avant toute navigation déclenchée par le code (navigate()).
// Renvoie true si on peut partir.
function confirmLeaveIfUnsaved() {
  const message = getActiveMessage();
  if (!message) return true;
  return window.confirm(message);
}

function isInternalNavigationLink(anchor, event) {
  if (!anchor || !anchor.href) return false;
  if (event.defaultPrevented || event.button !== 0) return false;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  if (anchor.target && anchor.target !== "_self") return false;
  if (anchor.hasAttribute("download")) return false;

  const url = new URL(anchor.href, window.location.href);
  if (url.origin !== window.location.origin) return false;
  // Un simple changement d'ancre ou de paramètres sur la même page ne fait rien perdre.
  return url.pathname !== window.location.pathname;
}

function useUnsavedChangesGuard(isDirty, message) {
  const guardIdRef = useRef(0);
  if (!guardIdRef.current) guardIdRef.current = nextGuardId++;

  useEffect(() => {
    const guardId = guardIdRef.current;
    if (!isDirty) {
      activeGuards.delete(guardId);
      return undefined;
    }

    activeGuards.set(guardId, message);

    function handleBeforeUnload(event) {
      event.preventDefault();
      // Requis par certains navigateurs ; le texte affiché reste celui du navigateur.
      event.returnValue = message;
      return message;
    }

    function handleLinkClick(event) {
      const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!isInternalNavigationLink(anchor, event)) return;
      if (window.confirm(message)) return;
      // Phase de capture sur document : on bloque avant que React Router ne navigue.
      event.preventDefault();
      event.stopPropagation();
    }

    window.addEventListener("beforeunload", handleBeforeUnload);
    document.addEventListener("click", handleLinkClick, true);

    return () => {
      activeGuards.delete(guardId);
      window.removeEventListener("beforeunload", handleBeforeUnload);
      document.removeEventListener("click", handleLinkClick, true);
    };
  }, [isDirty, message]);
}

export { confirmLeaveIfUnsaved, useUnsavedChangesGuard };
