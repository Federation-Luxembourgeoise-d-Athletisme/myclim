const DEFAULT_PUBLIC_APP_BASE_URL = "https://cmcm-luxembourg-indoor-meeting.lu";

function normalizeBaseUrl(value) {
  return String(value || "").trim().replace(/\/$/, "");
}

function isLocalHostname(hostname) {
  const normalizedHostname = String(hostname || "").trim().toLowerCase();
  return (
    normalizedHostname === "localhost"
    || normalizedHostname === "127.0.0.1"
    || normalizedHostname === "0.0.0.0"
  );
}

function getAppBaseUrl() {
  const env = typeof import.meta !== "undefined" && import.meta.env ? import.meta.env : {};
  const configuredUrl = normalizeBaseUrl(env.VITE_APP_BASE_URL);

  if (typeof window !== "undefined" && window.location?.origin) {
    const browserOrigin = normalizeBaseUrl(window.location.origin);

    if (!isLocalHostname(window.location.hostname)) {
      return browserOrigin;
    }

    if (configuredUrl) {
      return configuredUrl;
    }

    return browserOrigin;
  }

  if (configuredUrl) {
    return configuredUrl;
  }

  return DEFAULT_PUBLIC_APP_BASE_URL;
}

function buildAppUrl(pathname = "") {
  const baseUrl = getAppBaseUrl();
  const normalizedPath = String(pathname || "").trim();

  if (!normalizedPath) return baseUrl;
  return `${baseUrl}${normalizedPath.startsWith("/") ? normalizedPath : `/${normalizedPath}`}`;
}

export { buildAppUrl, getAppBaseUrl };
