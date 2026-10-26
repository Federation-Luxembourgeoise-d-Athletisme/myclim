// Module Communication : hooks et constantes partagés par les composants (com-ui.jsx).
import { useEffect, useRef, useState } from "react";

// Libellés { fr, en } : voir pick() dans com-i18n.js.
export const COM_SECTIONS = [
  { to: "/app/communication", label: { fr: "Calendrier éditorial", en: "Editorial calendar" }, end: true },
  { to: "/app/communication/taches", label: { fr: "Tâches", en: "Tasks" } },
  { to: "/app/communication/evenements", label: { fr: "Événements", en: "Events" } },
  { to: "/app/communication/rubriques", label: { fr: "Rubriques récurrentes", en: "Recurring series" } },
  { to: "/app/communication/galerie", label: { fr: "Galerie photos", en: "Photo gallery" } },
  { to: "/app/communication/partenaires", label: { fr: "Partenaires", en: "Partners" } },
  { to: "/app/communication/import", label: { fr: "Importer (Excel)", en: "Import (Excel)" } },
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

