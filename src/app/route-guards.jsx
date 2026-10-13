import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../context/auth-context";
import { getCashPostIdFromUid, isTechnicalSessionUid } from "../context/technical-sessions";
import { useLanguage } from "./language-context";
import { getActiveRoles, getDefaultRouteByRoles } from "./navigation";

function RequireAuth() {
  const { currentUser, loading } = useAuth();
  const { t } = useLanguage();
  const location = useLocation();
  if (loading) {
    return (
      <div className="page">
        <section className="page-header">
          <div>
            <p className="eyebrow">{t("authLoadingEyebrow")}</p>
            <h1>{t("authLoadingTitle")}</h1>
            <p>{t("authLoadingBody")}</p>
          </div>
        </section>
      </div>
    );
  }
  if (!currentUser) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  // Ordinateur de caisse ou portail VIP : session technique sans accès à /app.
  if (isTechnicalSessionUid(currentUser.uid)) {
    return <Navigate to={getCashPostIdFromUid(currentUser.uid) ? "/caisse" : "/"} replace />;
  }
  return <Outlet />;
}

function RequireRouteAccess({ allowedRoles }) {
  const { userProfile } = useAuth();
  const { t } = useLanguage();
  const roles = getActiveRoles(userProfile);

  if (!allowedRoles?.length || allowedRoles.some((role) => roles.includes(role))) {
    return <Outlet />;
  }

  return (
    <Navigate
      replace
      to={getDefaultRouteByRoles(roles)}
      state={{
        accessDeniedMessage: t("accessDeniedMessage"),
      }}
    />
  );
}

export { RequireAuth, RequireRouteAccess };
