// Deployment configuration for the static site.
//   mode 'demo': the server runs inside this browser (sql.js, fake Google, Paystack and model);
//                used on GitHub Pages until the Cloudflare Worker exists.
//   mode 'live': api is the Worker's URL and googleClientId the OAuth client's ID.
// The development server replaces this file with mode 'dev'.
window.TTCA_CONFIG = { mode: 'demo', api: null, googleClientId: null };
