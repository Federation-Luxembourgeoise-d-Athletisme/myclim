import { NavLink, Outlet, useOutletContext } from "react-router-dom";
import { useAuth } from "../context/auth-context";
import { useLanguage } from "./language-context";
import { getActiveRoles } from "./navigation";

/**
 * Page du back-office qui en regroupe plusieurs sous forme d'onglets
 * (Presse, Partenaires, Résultats & records...). Chaque onglet a sa propre
 * adresse ; l'onglet affiche une page existante dans <Outlet />.
 *
 * tabs : [{ to, labelKey?, label, end?, allowedRoles? }]
 * Un onglet avec allowedRoles n'apparaît que pour ces rôles (le contrôle
 * d'accès reste celui de la route).
 *
 * Le titre et l'eyebrow des pages affichées dans un onglet sont masqués
 * (voir .tabbed-page__body dans App.css) : le titre est celui de la page
 * regroupée, comme dans le menu.
 */
function TabbedPage({ eyebrowKey, eyebrow, titleKey, title, intro, tabs, titleValues = {} }) {
  const { t } = useLanguage();
  const { userProfile } = useAuth();
  const roles = getActiveRoles(userProfile);
  // Le shell passe le rôle « Voir comme » aux pages : on le transmet.
  const outletContext = useOutletContext();
  const visibleTabs = tabs.filter((tab) => !tab.allowedRoles || tab.allowedRoles.some((role) => roles.includes(role)));
  const translate = (key, fallback) => {
    const value = key ? t(key) : fallback;
    return Object.entries(titleValues).reduce(
      (text, [name, replacement]) => text.replace(`{${name}}`, replacement),
      value && value !== key ? value : fallback || "",
    );
  };

  return (
    <div className="page tabbed-page">
      <section className="page-header tabbed-page__header">
        <div>
          {eyebrowKey || eyebrow ? <p className="eyebrow">{translate(eyebrowKey, eyebrow)}</p> : null}
          <h1>{translate(titleKey, title)}</h1>
          {intro ? <p>{intro}</p> : null}
        </div>
      </section>
      {visibleTabs.length > 1 ? (
        <nav className="page-tabs" aria-label={translate(titleKey, title)}>
          {visibleTabs.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.end}
              className={({ isActive }) => `page-tabs__tab${isActive ? " page-tabs__tab--active" : ""}`}
            >
              {translate(tab.labelKey, tab.label)}
            </NavLink>
          ))}
        </nav>
      ) : null}
      <div className="tabbed-page__body">
        <Outlet context={outletContext} />
      </div>
    </div>
  );
}

export { TabbedPage };
