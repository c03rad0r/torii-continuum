/**
 * AI chat dock — UI shell with mock responses.
 * Context is set by each view via setChatContext() so the
 * bot's mock reply can reference the current project/page.
 *
 * When we wire real Routstr later, only sendToBackend() changes.
 */

let logEl, inputEl, sendBtn, contextEl, toggleEl, dockEl;
let messages = [];
let context = { label: 'Continuum', where: 'projects' };
let expanded = false;
let thinking = false;

export function mountChat(root) {
  dockEl = document.createElement('div');
  dockEl.className = 'chat-dock collapsed';
  dockEl.innerHTML = `
    <div class="chat-log" role="log" aria-live="polite"></div>
    <div class="chat-input-row">
      <span class="chat-context" title="Chat context"></span>
      <textarea class="chat-input" placeholder="Ask Continuum anything… (mock responses)" rows="1" aria-label="Chat input"></textarea>
      <button class="chat-send" type="button">Send</button>
      <button class="chat-toggle" type="button" aria-label="Toggle chat">▲</button>
    </div>
  `;
  root.appendChild(dockEl);

  logEl = dockEl.querySelector('.chat-log');
  inputEl = dockEl.querySelector('.chat-input');
  sendBtn = dockEl.querySelector('.chat-send');
  contextEl = dockEl.querySelector('.chat-context');
  toggleEl = dockEl.querySelector('.chat-toggle');

  sendBtn.addEventListener('click', send);
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });
  inputEl.addEventListener('input', autosize);
  toggleEl.addEventListener('click', () => setExpanded(!expanded));

  greet();
  renderContext();
}

function autosize() {
  inputEl.style.height = 'auto';
  inputEl.style.height = Math.min(140, inputEl.scrollHeight) + 'px';
}

function greet() {
  push('ai', 'Continuum online. Pick a project on the left, or ask me to spin up a new one. This chat is a mock shell for now — no live model calls.');
}

export function setChatContext(next) {
  context = { ...context, ...next };
  renderContext();
}

function renderContext() {
  if (!contextEl) return;
  contextEl.textContent = `context · ${context.label}`;
  contextEl.title = `Context: ${context.label} · ${context.where}`;
}

function push(who, text) {
  messages.push({ who, text, at: Date.now() });
  renderLog();
}

function renderLog() {
  logEl.innerHTML = '';
  for (const m of messages) {
    const el = document.createElement('div');
    el.className = 'chat-msg ' + m.who;
    el.innerHTML = `
      <div class="avatar">${m.who === 'user' ? 'you' : 'AI'}</div>
      <div class="bubble"></div>
    `;
    el.querySelector('.bubble').textContent = m.text;
    logEl.appendChild(el);
  }
  if (thinking) {
    const t = document.createElement('div');
    t.className = 'chat-thinking';
    t.textContent = 'thinking';
    logEl.appendChild(t);
  }
  logEl.scrollTop = logEl.scrollHeight;
}

function setExpanded(v) {
  expanded = v;
  dockEl.classList.toggle('expanded', expanded);
  dockEl.classList.toggle('collapsed', !expanded);
  toggleEl.textContent = expanded ? '▼' : '▲';
  if (expanded) setTimeout(() => { logEl.scrollTop = logEl.scrollHeight; }, 200);
}

async function send() {
  const text = (inputEl.value || '').trim();
  if (!text || thinking) return;
  push('user', text);
  inputEl.value = '';
  autosize();
  if (!expanded) setExpanded(true);

  thinking = true;
  renderLog();
  const reply = await mockReply(text, context);
  thinking = false;
  push('ai', reply);
}

/**
 * Mock reply — pretends to be a routed DeepSeek call.
 * Replace with sendToBackend() when Routstr wiring lands.
 */
function mockReply(text, ctx) {
  const q = text.toLowerCase();
  const canned = pickCanned(q, ctx);
  return new Promise((resolve) => {
    const delay = 500 + Math.floor(Math.random() * 600);
    setTimeout(() => resolve(canned), delay);
  });
}

function pickCanned(q, ctx) {
  if (q.includes('help') || q.includes('what can')) {
    return `I'm your project engine. I can help with:
• planning milestones and next actions on ${ctx.label}
• listing todos / adding new ones
• summarising sessions
• browsing marketplace tasks tagged for ${ctx.label}
• picking a model on Routstr (default: DeepSeek Chat)
This is a mock shell — real calls light up once Routstr is connected.`;
  }
  if (q.includes('milestone') || q.includes('roadmap')) {
    return `${ctx.label} has 5 milestones in the current plan. M1–M2 are done, M3 is active. Open the Project home page (left menu → Projects → click a card) to see the full ladder.`;
  }
  if (q.includes('todo') || q.includes('task')) {
    return `Open the project home to see the todo list — you can toggle items and add new ones. To publish an AI-work task, drop it on the Marketplace (left menu).`;
  }
  if (q.includes('routstr') || q.includes('model') || q.includes('deepseek')) {
    return `Routstr page is under the Routstr tab. Default model is DeepSeek Chat (6 sats / 1k tokens). Pay-per-request via Cashu — connect a wallet to enable.`;
  }
  if (q.includes('marketplace') || q.includes('bounty')) {
    return `Marketplace lists open AI-work tasks. Your Quest + Continuum tasks are highlighted in amber so you can see what belongs to your projects vs. the wider network.`;
  }
  if (q.includes('new project') || q.includes('add repo') || q.includes('github')) {
    return `Projects → “New Project” lets you paste a GitHub URL (github.com/user/repo) or an ngit remote (ngit://…). Names auto-slug to a project id.`;
  }
  return `(mock) noted for ${ctx.label}: “${q.slice(0, 120)}”. I'd normally route this to DeepSeek Chat via Routstr — wire a Cashu-loaded endpoint on the Routstr page to switch on live replies.`;
}

export function toggleChat() { setExpanded(!expanded); }
