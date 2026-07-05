/**
 * Torii Continuum Agent — main entry.
 *
 * Boots:
 *   1. Load + validate config.yaml (fail fast on invariant violation).
 *   2. Init Cashu wallet(s).
 *   3. Init Routstr client.
 *   4. Init the chat skill.
 *   5. Start Fastify HTTP server on 127.0.0.1:<port>.
 *
 * Run:
 *   node agent/index.mjs
 *
 * Prod: as a systemd unit under the `continuum` user. See agent/README.md.
 */

import Fastify from 'fastify';
import cors from '@fastify/cors';
import { loadConfig } from './core/config.mjs';
import { createAuth } from './core/auth.mjs';
import { createWallet } from './core/wallet.mjs';
import { createRoutstr } from './core/routstr.mjs';
import { createChatSkill } from './skills/chat.mjs';

const cfg = loadConfig();

const app = Fastify({
  logger: {
    level: cfg.logging?.level || 'info',
    transport:
      cfg.logging?.destination === 'stdout' || !cfg.logging?.destination
        ? undefined
        : { target: 'pino/file', options: { destination: cfg.logging.destination } },
  },
  bodyLimit: 512 * 1024, // 512 KB — enough for a Cashu token + a chat message, nothing more
  disableRequestLogging: false,
});

await app.register(cors, {
  origin: cfg.server.cors_origins,
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
});

const auth = createAuth(cfg);
const wallet = await createWallet(cfg, app.log);
const routstr = createRoutstr(cfg, wallet, app.log);
const chatSkill = createChatSkill(routstr, app.log);

// ─────────────────────────────────────────────────────────────
// Auth middleware — attach to routes that require it
// ─────────────────────────────────────────────────────────────
async function requireAdmin(req, reply) {
  const authHeader = req.headers.authorization || '';
  const m = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!m) return reply.code(401).send({ error: 'missing bearer token' });
  const check = auth.verifySessionToken(m[1]);
  if (!check.ok) return reply.code(401).send({ error: `session invalid: ${check.reason}` });
  req.session = { npub: check.npub, exp: check.exp };
}

// ─────────────────────────────────────────────────────────────
// Public routes
// ─────────────────────────────────────────────────────────────

app.get('/api/health', async () => ({
  ok: true,
  service: 'torii-continuum-agent',
  version: '0.2.0-alpha',
  time: new Date().toISOString(),
}));

app.post('/api/auth/challenge', async (req, reply) => {
  const clientIp = req.ip;
  const { challenge, expires_in } = auth.issueChallenge(clientIp);
  return { challenge, expires_in, kind: 22242 };
});

app.post('/api/auth/verify', async (req, reply) => {
  const event = req.body?.event;
  if (!event) return reply.code(400).send({ error: 'body.event required' });
  const result = auth.verifyChallenge(event, req.ip);
  if (!result.ok) {
    app.log.warn(`[auth] verify failed: ${result.reason}`);
    return reply.code(401).send({ error: result.reason });
  }
  app.log.info('[auth] admin logged in');
  return { token: result.token, expires_at: result.expires_at };
});

// ─────────────────────────────────────────────────────────────
// Admin routes
// ─────────────────────────────────────────────────────────────

app.get('/api/wallet/balance', { preHandler: requireAdmin }, async () => {
  const b = await wallet.balance();
  return {
    total_sats: b.total,
    per_mint: b.per_mint,
    warn_below: cfg.cashu?.low_balance_warn_sats || 500,
    floor: cfg.cashu?.hard_floor_sats || 100,
  };
});

app.post('/api/wallet/receive', { preHandler: requireAdmin }, async (req, reply) => {
  const token = req.body?.token;
  if (!token || typeof token !== 'string') {
    return reply.code(400).send({ error: 'body.token (cashuA...) required' });
  }
  const result = await wallet.receive(token);
  if (!result.ok) return reply.code(400).send({ error: result.reason });
  return { ok: true, added_sats: result.added_sats, mint: result.mint };
});

app.post('/api/chat', { preHandler: requireAdmin }, async (req, reply) => {
  const message = req.body?.message;
  const context = req.body?.context || null;
  if (!message || typeof message !== 'string') {
    return reply.code(400).send({ error: 'body.message required' });
  }
  const trimmed = message.trim();
  if (trimmed.length === 0) return reply.code(400).send({ error: 'empty message' });
  if (trimmed.length > 4000) return reply.code(400).send({ error: 'message too long (max 4000)' });

  const result = await chatSkill.handle({ message: trimmed, context });
  if (!result.ok) {
    // 502 = upstream failure (Routstr / wallet)
    return reply.code(502).send({ error: result.reason });
  }

  return {
    reply: result.reply,
    model: result.model,
    duration_ms: result.duration_ms,
    sats_spent: result.sats_spent,
  };
});

// ─────────────────────────────────────────────────────────────
// Startup
// ─────────────────────────────────────────────────────────────

const port = cfg.server.port;
const host = cfg.server.host;

try {
  await app.listen({ port, host });
  app.log.info(`torii-continuum-agent listening on http://${host}:${port}`);
  app.log.info(`admin npub: ${cfg.admin_npub.slice(0, 12)}...`);
  app.log.info(`cashu mints: ${wallet.mints.join(', ') || '(none)'}`);
  app.log.info(`routstr endpoint: ${cfg.routstr.endpoint}`);
} catch (err) {
  app.log.error({ err }, 'listen failed');
  process.exit(1);
}

// Graceful shutdown
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    app.log.info(`received ${signal}, shutting down`);
    await app.close();
    process.exit(0);
  });
}
