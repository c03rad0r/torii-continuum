/** Small render helpers shared across views. */

export function h(tag, attrs = {}, children = []) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') {
      el.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (k === 'dataset' && v && typeof v === 'object') {
      Object.assign(el.dataset, v);
    } else {
      el.setAttribute(k, v);
    }
  }
  const kids = Array.isArray(children) ? children : [children];
  for (const c of kids) {
    if (c == null || c === false) continue;
    if (typeof c === 'string' || typeof c === 'number') {
      el.appendChild(document.createTextNode(String(c)));
    } else {
      el.appendChild(c);
    }
  }
  return el;
}

export function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

export function formatSats(n) {
  if (n == null || isNaN(n)) return '—';
  if (n >= 100_000) return (n / 1_000).toFixed(1) + 'k';
  return String(n);
}

export function formatBytes(n) {
  if (!n) return '—';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}

export function timeAgo(secTs) {
  const s = Math.max(1, Math.floor(Date.now() / 1000) - secTs);
  if (s < 60) return s + 's ago';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  if (s < 30 * 86400) return Math.floor(s / 86400) + 'd ago';
  const d = new Date(secTs * 1000);
  return d.toLocaleDateString();
}

export function openModal({ title, subtitle, body, onClose }) {
  const backdrop = h('div', { class: 'modal-backdrop' });
  const modal = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' });
  const head = h('h3', { text: title });
  const sub = subtitle ? h('p', { class: 'muted', text: subtitle }) : null;
  modal.appendChild(head);
  if (sub) modal.appendChild(sub);
  modal.appendChild(body);
  backdrop.appendChild(modal);
  const close = () => { backdrop.remove(); if (typeof onClose === 'function') onClose(); };
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  document.body.appendChild(backdrop);
  return { close, modal };
}
