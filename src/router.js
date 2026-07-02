/**
 * Tiny hash-based router. Keeps routes portable across
 * static hosts (no SPA fallback needed).
 *
 * Route grammar:
 *   #/projects
 *   #/projects/:slug
 *   #/marketplace
 *   #/routstr
 *   #/dashboard
 */

const routes = [];
let currentHandler = null;

export function route(pattern, handler) {
  routes.push({ pattern, keys: keysOf(pattern), handler });
}

function keysOf(pattern) {
  return (pattern.match(/:[a-zA-Z]+/g) || []).map((s) => s.slice(1));
}

function toRegex(pattern) {
  const p = pattern.replace(/:[a-zA-Z]+/g, '([^/]+)').replace(/\//g, '\\/');
  return new RegExp('^' + p + '$');
}

function resolve() {
  const hash = window.location.hash || '#/projects';
  const path = hash.slice(1);
  for (const r of routes) {
    const m = path.match(toRegex(r.pattern));
    if (m) {
      const params = {};
      r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      currentHandler = { pattern: r.pattern, params };
      r.handler(params);
      return;
    }
  }
  // Fallback
  window.location.hash = '#/projects';
}

export function currentRoute() { return currentHandler; }

export function navigate(path) {
  if (window.location.hash === '#' + path) {
    resolve();
  } else {
    window.location.hash = path;
  }
}

export function startRouter() {
  window.addEventListener('hashchange', resolve);
  resolve();
}
