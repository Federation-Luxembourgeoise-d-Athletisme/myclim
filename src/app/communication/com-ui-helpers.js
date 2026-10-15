// Module Communication : hooks et constantes partagés par les composants (com-ui.jsx).
import { useEffect, useRef, useState } from "react";

export const COM_SECTIONS = [
  { to: "/app/communication", label: "Calendrier éditorial", end: true },
  { to: "/app/communication/taches", label: "Tâches" },
  { to: "/app/communication/evenements", label: "Événements" },
  { to: "/app/communication/rubriques", label: "Rubriques récurrentes" },
  { to: "/app/communication/galerie", label: "Galerie photos" },
  { to: "/app/communication/partenaires", label: "Partenaires" },
];

// Variable CSS --tc portée par un élément coloré selon son type de publication.
export const typeColor = (type) => ({ "--tc": `var(--com-t-${type})` });

// Fenêtres superposées : Échap ne ferme que la dernière ouverte.
const escapeStack = [];
export function useEscape(onEscape) {
  const handler = useRef(onEscape);
  useEffect(() => {
    handler.current = onEscape;
  }, [onEscape]);
  useEffect(() => {
    const id = Symbol("escape");
    escapeStack.push(id);
    const onKey = (event) => {
      if (event.key !== "Escape" || escapeStack[escapeStack.length - 1] !== id) return;
      event.stopPropagation();
      handler.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      escapeStack.splice(escapeStack.indexOf(id), 1);
    };
  }, []);
}

// Message éphémère (2,5 s).
export function useToast() {
  const [toast, setToast] = useState(null);
  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(null), 2500);
    return () => window.clearTimeout(timer);
  }, [toast, setToast]);
  return [toast, setToast];
}

