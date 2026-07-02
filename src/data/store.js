/**
 * Continuum local store. Persists Nostr-shaped events to localStorage.
 * Exposes a tiny subscribable state layer used by the views.
 *
 * The store's public surface is intentionally small so that when we
 * flip to relays we only rewrite `load` / `save` — the callers never
 * see localStorage keys.
 */

import { KIND, makeEvent, newId, nowSec } from './schema.js';
import { seedProjects, seedSessions, seedMilestones, seedTodos, seedFiles, seedMarketTasks, seedRoutstr } from './seed.js';

const STORAGE_KEY = 'continuum.v1';

const listeners = new Set();
let state = null;

function emptyState() {
  return {
    projects: [],   // events kind 30078
    sessions: [],   // events kind 30079
    milestones: [], // events kind 30080
    todos: [],      // events kind 30081
    files: [],      // events kind 30082
    marketTasks: [],// events kind 30090
    routstr: null,  // event kind 30091
  };
}

function loadRaw() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('[continuum] persist failed', e);
  }
}

export function initStore() {
  const loaded = loadRaw();
  if (loaded && Array.isArray(loaded.projects) && loaded.projects.length > 0) {
    state = { ...emptyState(), ...loaded };
    // Guarantee shape after schema evolution
    if (!Array.isArray(state.marketTasks) || state.marketTasks.length === 0) {
      state.marketTasks = seedMarketTasks();
    }
    if (!state.routstr) state.routstr = seedRoutstr();
  } else {
    state = seedInitialState();
    persist();
  }
  return state;
}

function seedInitialState() {
  const s = emptyState();
  s.projects = seedProjects();
  s.sessions = seedSessions();
  s.milestones = seedMilestones();
  s.todos = seedTodos();
  s.files = seedFiles();
  s.marketTasks = seedMarketTasks();
  s.routstr = seedRoutstr();
  return s;
}

export function getState() {
  return state;
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify() {
  for (const fn of listeners) {
    try { fn(state); } catch (e) { console.error(e); }
  }
}

// --- Projects ---

export function listProjects() {
  return state.projects.slice().sort((a, b) => b.created_at - a.created_at);
}

export function getProject(slug) {
  return state.projects.find((p) => p.content.slug === slug) || null;
}

export function createProject({ name, description, source, sourceUrl, tags = [] }) {
  const slug = slugify(name);
  if (state.projects.some((p) => p.content.slug === slug)) {
    throw new Error(`A project with slug "${slug}" already exists.`);
  }
  const ev = makeEvent({
    kind: KIND.PROJECT,
    d: slug,
    content: {
      slug,
      name,
      description: description || '',
      source: source || 'local',      // 'github' | 'ngit' | 'local'
      sourceUrl: sourceUrl || null,
      status: 'active',
      createdAt: nowSec(),
      tagList: tags,
    },
    tags: [['t', 'continuum-project'], ...tags.map((t) => ['t', t])],
  });
  state.projects.push(ev);
  persist();
  notify();
  return ev;
}

export function deleteProject(slug) {
  const p = getProject(slug);
  if (!p) return;
  state.projects = state.projects.filter((x) => x !== p);
  // Cascade
  state.sessions = state.sessions.filter((s) => s.content.projectSlug !== slug);
  state.milestones = state.milestones.filter((m) => m.content.projectSlug !== slug);
  state.todos = state.todos.filter((t) => t.content.projectSlug !== slug);
  state.files = state.files.filter((f) => f.content.projectSlug !== slug);
  persist();
  notify();
}

// --- Sessions ---
export function sessionsFor(slug) {
  return state.sessions
    .filter((s) => s.content.projectSlug === slug)
    .sort((a, b) => b.content.startedAt - a.content.startedAt);
}

// --- Milestones ---
export function milestonesFor(slug) {
  return state.milestones
    .filter((m) => m.content.projectSlug === slug)
    .sort((a, b) => a.content.index - b.content.index);
}

// --- Todos ---
export function todosFor(slug) {
  return state.todos
    .filter((t) => t.content.projectSlug === slug)
    .sort((a, b) => a.content.order - b.content.order);
}

export function addTodo(slug, text) {
  const existing = todosFor(slug);
  const ev = makeEvent({
    kind: KIND.TODO,
    d: `${slug}:${newId('todo')}`,
    content: {
      projectSlug: slug,
      text,
      done: false,
      order: existing.length,
      createdAt: nowSec(),
    },
    tags: [['a', `${30078}:${slug}`], ['t', 'todo']],
  });
  state.todos.push(ev);
  persist();
  notify();
  return ev;
}

export function toggleTodo(ev) {
  ev.content.done = !ev.content.done;
  ev.created_at = nowSec();
  persist();
  notify();
}

// --- Files ---
export function filesFor(slug) {
  return state.files
    .filter((f) => f.content.projectSlug === slug)
    .sort((a, b) => a.content.path.localeCompare(b.content.path));
}

// --- Marketplace ---
export function listMarketTasks() {
  return state.marketTasks.slice();
}

// --- Routstr ---
export function getRoutstr() { return state.routstr; }
export function updateRoutstr(patch) {
  state.routstr.content = { ...state.routstr.content, ...patch };
  state.routstr.created_at = nowSec();
  persist();
  notify();
}

// --- helpers ---
function slugify(s) {
  return String(s)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 48) || `project-${Date.now().toString(36)}`;
}
