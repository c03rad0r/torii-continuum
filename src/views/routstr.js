/** Routstr page — connect, Cashu pay, model picker, usage stats.
 *  All UI-only for MVP; wire real endpoint later.
 */
import { h, clear, formatSats } from './util.js';
import { getRoutstr, updateRoutstr } from '../data/store.js';
import { setChatContext } from '../chat.js';

export function renderRoutstr(mount) {
  setChatContext({ label: 'Routstr', where: 'routstr' });
  clear(mount);

  const r = getRoutstr();
  const c = r.content;

  const header = h('div', { class: 'page-header' }, [
    h('div', {}, [
      h('h1', { class: 'page-title', text: 'Routstr' }),
      h('div', { class: 'page-sub', text: 'Pay-per-request AI over Cashu. Pick your model, load a mint, route requests through nostr-native infra.' }),
    ]),
    h('div', { class: 'page-actions' }, [
      c.connected
        ? h('button', { onClick: disconnect }, ['Disconnect'])
        : h('button', { class: 'primary', onClick: connect }, ['Connect Cashu wallet']),
    ]),
  ]);
  mount.appendChild(header);

  // Hero: connection + balance
  const hero = h('div', { class: 'card hot' }, [
    h('div', { class: 'routstr-hero' }, [
      h('div', { class: 'routstr-avatar', text: '⚡' }),
      h('div', { style: 'flex: 1;' }, [
        h('div', {}, [
          h('span', { class: c.connected ? 'pill ok' : 'pill', text: c.connected ? 'connected' : 'not connected' }),
          ' ',
          h('span', { class: 'mono muted', text: c.endpoint }),
        ]),
        h('div', { style: 'margin-top: 8px;', class: 'muted', text: c.connected
          ? 'Cashu tokens are loaded locally and burned per request. No account, no key custody.'
          : 'Connect a Cashu wallet (mock) to enable pay-per-request. Nothing is sent to the network yet.' }),
      ]),
      h('div', { class: 'stat' }, [
        h('span', { class: 'label', text: 'Cashu balance' }),
        h('span', { class: 'value' }, [
          formatSats(c.cashuBalanceSats),
          h('span', { class: 'unit', text: 'sats' }),
        ]),
      ]),
    ]),
  ]);
  mount.appendChild(hero);

  mount.appendChild(h('div', { style: 'height: 16px' }));

  // Grid: model list + usage
  const grid = h('div', { class: 'grid-2' }, [
    renderModelPicker(c),
    renderUsage(c),
  ]);
  mount.appendChild(grid);

  mount.appendChild(h('div', { style: 'height: 16px' }));

  // Endpoint + advanced
  const settings = h('div', { class: 'card' }, [
    h('h3', { text: 'Endpoint' }),
    h('p', { class: 'muted', text: 'Point Continuum at any Routstr-compatible endpoint. Default is api.routstr.com.' }),
    h('div', { class: 'form-row' }, [
      h('label', { text: 'Routstr URL' }),
      (() => {
        const inp = h('input', { type: 'text', value: c.endpoint });
        inp.addEventListener('change', () => updateRoutstr({ endpoint: inp.value.trim() || 'https://api.routstr.com' }));
        return inp;
      })(),
    ]),
    h('div', { class: 'form-row' }, [
      h('label', { text: 'Monthly Cashu budget (sats)' }),
      (() => {
        const inp = h('input', { type: 'number', value: c.usage.monthlyBudget, min: 0, step: 1000 });
        inp.addEventListener('change', () => updateRoutstr({ usage: { ...c.usage, monthlyBudget: Math.max(0, parseInt(inp.value || '0', 10)) } }));
        return inp;
      })(),
    ]),
  ]);
  mount.appendChild(settings);
}

function renderModelPicker(c) {
  const list = h('div', { class: 'model-list' });
  for (const m of c.models) {
    const row = h('div', { class: 'model ' + (m.id === c.selectedModel ? 'selected' : '') }, [
      h('div', { style: 'flex: 1; min-width: 0;' }, [
        h('div', { class: 'name', text: m.name }),
        h('div', { class: 'mono muted', style: 'font-size: 11.5px;', text: m.id }),
      ]),
      m.badge ? h('span', { class: 'badge', text: m.badge }) : null,
      h('span', { class: 'price', text: `${m.pricePer1kSats} sats/1k tok` }),
    ]);
    row.addEventListener('click', () => {
      updateRoutstr({ selectedModel: m.id });
      renderRoutstr(document.getElementById('main-content'));
    });
    list.appendChild(row);
  }
  return h('div', { class: 'card' }, [
    h('h3', { text: 'AI model' }),
    h('p', { class: 'muted', text: 'Default is DeepSeek Chat — cheap and capable. Switch anytime; the chat dock uses whichever is selected.' }),
    list,
  ]);
}

function renderUsage(c) {
  const u = c.usage;
  const pct = u.monthlyBudget > 0 ? Math.min(100, Math.round((u.satsSpent / u.monthlyBudget) * 100)) : 0;
  return h('div', { class: 'card' }, [
    h('h3', { text: 'Usage stats' }),
    h('p', { class: 'muted', text: 'Last 24 hours. Live counters light up once you connect and start sending requests.' }),
    h('div', { class: 'grid-2', style: 'gap: 12px; margin-top: 8px;' }, [
      renderStat('Requests · 24h', String(u.requests24h)),
      renderStat('Sats spent · 24h', formatSats(u.satsSpent) + ' sats'),
      renderStat('Tokens in',  formatSats(u.tokensIn)),
      renderStat('Tokens out', formatSats(u.tokensOut)),
    ]),
    h('div', { style: 'margin-top: 14px;' }, [
      h('div', { class: 'muted', style: 'font-size: 12px; display: flex; justify-content: space-between;' }, [
        h('span', { text: 'Monthly budget' }),
        h('span', { text: `${formatSats(u.satsSpent)} / ${formatSats(u.monthlyBudget)} sats` }),
      ]),
      h('div', { class: 'usage-bar', style: 'margin-top: 6px;' }, [
        h('i', { style: `width: ${pct}%` }),
      ]),
    ]),
  ]);
}

function renderStat(label, value) {
  return h('div', {}, [
    h('div', { class: 'label muted', style: 'font-size: 10.5px; letter-spacing: 0.14em; text-transform: uppercase;', text: label }),
    h('div', { class: 'mono', style: 'font-size: 18px; color: var(--text-hi); margin-top: 2px;', text: value }),
  ]);
}

function connect() {
  // Mock: bump balance and mark connected.
  const bal = 12000 + Math.floor(Math.random() * 8000);
  updateRoutstr({ connected: true, cashuBalanceSats: bal });
  renderRoutstr(document.getElementById('main-content'));
}
function disconnect() {
  updateRoutstr({ connected: false, cashuBalanceSats: 0 });
  renderRoutstr(document.getElementById('main-content'));
}
