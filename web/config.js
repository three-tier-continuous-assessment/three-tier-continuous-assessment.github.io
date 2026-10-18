// Deployment configuration for the static site.
//   mode 'live': api is the Worker's URL and googleClientId the OAuth client's ID (both public).
//   mode 'demo': any address with ?demo. The server runs inside this browser (sql.js, fake Google,
//                Paystack and model); nothing reaches the Worker.
// The development server replaces this file with mode 'dev' or 'demo'.
window.TTCA_CONFIG = new URLSearchParams(location.search).has('demo')
  ? { mode: 'demo', api: null, googleClientId: null }
  : {
      mode: 'live',
      api: 'https://three-tier-ca.three-tier-ca.workers.dev',
      googleClientId: '845950129825-9nmr7otvmm2uta704vq35t9kmv6vesgn.apps.googleusercontent.com',
    };
