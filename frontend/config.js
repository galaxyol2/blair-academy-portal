// Runtime config for the static frontend (used on Vercel).
// Set this to your deployed backend base URL, e.g. "https://your-api.up.railway.app"
// You can also override it per-browser via:
// localStorage.setItem("blair.portal.apiBaseUrl", "https://your-api.up.railway.app")
window.__BLAIR_CONFIG__ = window.__BLAIR_CONFIG__ || {
  apiBaseUrl: "https://blair-academy-portal-production.up.railway.app",
  publicBaseUrl: "https://www.blair-academy.org",
};
