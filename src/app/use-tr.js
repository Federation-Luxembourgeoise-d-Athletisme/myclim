import { useLanguage } from "./language-context";

/**
 * Inline bilingual text for back-office pages: tr("Texte français", "English text").
 * French when the app is in French, English otherwise (German readers, such as
 * the meeting director, get English).
 */
function useTr() {
  const { language } = useLanguage();
  return (fr, en) => (language === "fr" ? fr : en);
}

export { useTr };
