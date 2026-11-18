import { useCallback, useState } from "react";

// Cases repliables (« accordéon ») : { clé: true } = repliée. Mémorisé dans ce
// navigateur sous storageKey ; sans stockage (navigation privée), le repli
// vaut pour la visite.
function readCollapsed(storageKey) {
  try {
    const value = JSON.parse(window.localStorage.getItem(storageKey) || "{}");
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

function useCollapsedState(storageKey) {
  const [collapsed, setCollapsed] = useState(() => readCollapsed(storageKey));
  const toggle = useCallback(
    (key, value) => {
      setCollapsed((current) => {
        const next = { ...current, [key]: value ?? !current[key] };
        try {
          window.localStorage.setItem(storageKey, JSON.stringify(next));
        } catch {
          // Stockage indisponible : on garde l'état pour la visite.
        }
        return next;
      });
    },
    [storageKey],
  );
  return [collapsed, toggle];
}

export { useCollapsedState };
