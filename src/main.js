/**
 * Continuum — app entry.
 * Boots store → mounts shell → registers routes → starts router → mounts chat.
 */
import { initStore } from './data/store.js';
import { mountShell, mainContent, renderSidebar } from './shell.js';
import { route, startRouter } from './router.js';
import { mountChat } from './chat.js';

import { renderProjects } from './views/projects.js';
import { renderProjectHome } from './views/projectHome.js';
import { renderMarketplace } from './views/marketplace.js';
import { renderRoutstr } from './views/routstr.js';
import { renderDashboard } from './views/dashboard.js';

function boot() {
  const root = document.getElementById('app');
  if (!root) return;

  initStore();
  mountShell(root);

  // Routes
  route('/projects', () => { renderProjects(mainContent()); renderSidebar(); });
  route('/projects/:slug', ({ slug }) => { renderProjectHome(mainContent(), slug); renderSidebar(); });
  route('/marketplace', () => { renderMarketplace(mainContent()); renderSidebar(); });
  route('/routstr', () => { renderRoutstr(mainContent()); renderSidebar(); });
  route('/dashboard', () => { renderDashboard(mainContent()); renderSidebar(); });

  startRouter();
  mountChat(root);

  // Prevent double-tap zoom on the chat button on iOS
  document.addEventListener('gesturestart', (e) => e.preventDefault(), { passive: false });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
