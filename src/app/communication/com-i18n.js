// Module Communication en français et en anglais : suit le bouton EN/FR de
// l'app (l'équipe LUNEX ne parle pas toujours français). Toute autre langue
// (allemand) retombe sur l'anglais.
import { useMemo } from "react";
import { useLanguage } from "../language-context";

export const comLang = (language) => (language === "fr" ? "fr" : "en");

// Libellé { fr, en } ou texte simple.
export const pick = (label, lang) => (label && typeof label === "object" ? (label[lang] ?? label.en ?? label.fr) : label);

// tr("français", "English") : le texte de la langue affichée.
// locale : pour toLocaleString / toLocaleDateString.
export function useComLang() {
  const { language } = useLanguage();
  const lang = comLang(language);
  return useMemo(
    () => ({
      lang,
      tr: (fr, en) => (lang === "fr" ? fr : en),
      locale: lang === "fr" ? "fr-LU" : "en-GB",
    }),
    [lang],
  );
}
