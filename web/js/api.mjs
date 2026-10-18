// The API client. In 'demo' mode the server runs in this page (demo.mjs registers it);
// otherwise requests go to cfg.api ('' = same origin in development).

export const cfg = window.TTCA_CONFIG ?? { mode: 'dev', api: '', googleClientId: null };

// On Pages the demo lives at ?demo beside the live site; links made in the demo keep it.
export const demoQuery = cfg.mode === 'demo' && new URLSearchParams(location.search).has('demo') ? '?demo' : '';
/** An absolute link to this site, e.g. siteUrl('#/q/7K3QX2'). */
export const siteUrl = (hash = '') => `${location.origin}${location.pathname}${demoQuery}${hash}`;

let local = null;
export function useLocalServer(handler) {
  local = handler;
}

export async function api(method, path, body, token) {
  const init = { method, headers: {} };
  if (body !== undefined) {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  if (token) init.headers.authorization = `Bearer ${token}`;
  let res;
  try {
    res = local ? await local(new Request(new URL(path, location.origin), init)) : await fetch(`${cfg.api ?? ''}${path}`, init);
  } catch {
    return { status: 0, offline: true, data: { error: 'No connection. Check your data or Wi-Fi.' } };
  }
  let data = {};
  try { data = await res.json(); } catch { /* empty */ }
  return { status: res.status, data };
}

// The demo shares the live site's origin, so it keeps its own keys: resetting the demo never signs
// anyone out of the live site or drops a live attempt.
export const KEY = cfg.mode === 'demo' ? 'ttca.demo.' : 'ttca.';
export const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(KEY + k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(KEY + k, JSON.stringify(v)); } catch { /* private mode */ } },
  del(k) { try { localStorage.removeItem(KEY + k); } catch { /* private mode */ } },
};

export const lecturer = {
  get token() { return store.get('lecturer')?.token ?? null; },
  get me() { return store.get('lecturer')?.me ?? null; },
  save(token, me) { store.set('lecturer', { token, me }); },
  clear() { store.del('lecturer'); },
};

export const attempt = {
  get(code) { return store.get(`attempt.${code}`); },
  save(code, v) { store.set(`attempt.${code}`, v); },
  clear(code) { store.del(`attempt.${code}`); },
};
