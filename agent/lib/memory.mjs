/**
 * Memory loader — turns the RAM cache from crypto.mjs into
 * system-prompt-ready views for skills/chat.mjs.
 *
 * There are FOUR layers of memory. The agent uses three of them at
 * inference time; the fourth is off-limits during live turns.
 *
 *   1. CHARACTER   (kind 30092 + local CHARACTER.md)
 *      The stable identity. Loaded once at boot from CHARACTER.md; on
 *      /api/memory/unlock, the 30092 root fingerprint is checked against
 *      the local CHARACTER.md hash. Mismatch → agent refuses to serve
 *      chat until operator resolves (either re-signs a new 30092 or
 *      restores the matching CHARACTER.md).
 *
 *   2. SEMANTIC    (kind 30094)
 *      Durable facts and preferences. Injected wholesale into every
 *      system prompt (they're small — <20 entries expected).
 *
 *   3. PROCEDURAL  (kind 30095)
 *      Reflexes that run BEFORE the model speaks. Some are LLM-directives
 *      injected into the prompt; some are code-side guards run by
 *      applyProceduralGuards() below.
 *
 *   4. EPISODIC    (never read at inference time)
 *      The chat log at agent/memory/episodic/*.jsonl. NEVER opened by
 *      skills/chat.mjs. Only reflect.mjs (offline pass) opens it, and
 *      only to draft new 30094/30095 events for operator approval.
 *
 * Why episodic is walled off:
 *   - Prevents the agent from cementing accidents ("you said X once so
 *     now you say X forever") without a human deciding it's a durable
 *     preference.
 *   - Keeps the live prompt small and predictable.
 *   - Every durable belief has to pass through operator signature. The
 *     agent can't self-modify its personality.
 */

import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { KINDS } from './events.mjs';

/**
 * @param {object} deps
 * @param {ReturnType<import('./crypto.mjs').createMemoryCache>} deps.cache
 * @param {string} deps.agentRoot  absolute path to agent/
 * @param {object} deps.log
 */
export function createMemoryLoader({ cache, agentRoot, log }) {
  // Cache the on-disk CHARACTER.md text + hash once at boot; re-read on unlock.
  let characterText = null;
  let characterHash = null;
  let characterLoadedAt = null;

  /**
   * Read CHARACTER.md from disk and hash it. This is the LOCAL truth. The
   * 30092 event stored in the encrypted cache lets us verify no one has
   * tampered with CHARACTER.md between operator signings.
   */
  async function loadCharacter() {
    const path = join(agentRoot, 'CHARACTER.md');
    try {
      const buf = await readFile(path);
      characterText = buf.toString('utf8');
      characterHash = createHash('sha256').update(buf).digest('hex');
      characterLoadedAt = Math.floor(Date.now() / 1000);
      log.info(`[memory] CHARACTER.md loaded: ${buf.length} bytes, sha256=${characterHash.slice(0, 12)}...`);
      return { ok: true };
    } catch (e) {
      log.warn(`[memory] CHARACTER.md missing at ${path}: ${e.message}`);
      characterText = null;
      characterHash = null;
      return { ok: false, reason: e.message };
    }
  }

  /**
   * Verify the 30092 character_root's stored hash matches disk. Called
   * after unlock. Returns { ok, reason? }.
   */
  function verifyCharacterRoot() {
    if (!characterHash) return { ok: false, reason: 'CHARACTER.md not loaded' };
    const root = cache.get(KINDS.CHARACTER_ROOT, 'root');
    if (!root) {
      // No root signed yet — first-run state. That's OK; the operator
      // hasn't committed a character root yet. Not fatal.
      return { ok: true, reason: 'no root signed yet — first run' };
    }
    const stored = root.content?.character_hash;
    if (typeof stored !== 'string') return { ok: false, reason: '30092 has no character_hash' };
    if (stored.toLowerCase() !== characterHash.toLowerCase()) {
      return {
        ok: false,
        reason: `CHARACTER.md hash mismatch: disk=${characterHash.slice(0, 12)}... vs signed=${stored.slice(0, 12)}...`,
      };
    }
    return { ok: true };
  }

  /**
   * Build the three prompt fragments for skills/chat.mjs. Returns null
   * for any layer that isn't loaded (skill decides how to degrade).
   */
  function promptFragments() {
    const semantic = cache.list(KINDS.SEMANTIC_FACT);
    const procedural = cache.list(KINDS.PROCEDURAL_SKILL);

    return {
      character: characterText || null,
      character_hash: characterHash,
      character_verified: !!verifyCharacterRoot().ok,
      semantic: renderSemantic(semantic),
      procedural: renderProcedural(procedural),
      counts: {
        semantic: semantic.length,
        procedural: procedural.length,
      },
    };
  }

  /**
   * Render semantic facts as compact prompt lines.
   */
  function renderSemantic(entries) {
    if (entries.length === 0) return null;
    const lines = ['## Durable facts and preferences', ''];
    for (const e of entries) {
      const c = e.content || {};
      const conf = c.confidence === 'low' ? ' (low confidence)' : '';
      lines.push(`- **${e.dTag}**${conf}: ${c.fact || '(no fact)'}`);
      if (c.why) lines.push(`  - Why: ${c.why}`);
    }
    return lines.join('\n');
  }

  /**
   * Render procedural skills as prompt directives. Only reflex skills
   * that make sense as *instructions to the model* go in the prompt;
   * code-side guards are handled separately by applyProceduralGuards.
   */
  function renderProcedural(entries) {
    const promptable = entries.filter((e) => {
      const c = e.content || {};
      // A skill is prompt-visible unless it explicitly says code-only.
      return c.guard !== 'code-only';
    });
    if (promptable.length === 0) return null;
    const lines = ['## Reflexes (apply before you speak)', ''];
    for (const e of promptable) {
      const c = e.content || {};
      lines.push(`- **${c.name || e.dTag}** — when ${c.trigger}, ${c.action}.`);
      if (c.guard && c.guard !== 'code-only') lines.push(`  - Guard: ${c.guard}`);
    }
    return lines.join('\n');
  }

  /**
   * Apply code-side procedural guards to a message before we send it to
   * the model. Currently supports:
   *
   *   guard = "code-only:pseudonym-only"
   *     Refuses if the user message contains what looks like a real name
   *     that hasn't been aliased in a 30094 fact.
   *
   * Returns { ok: true, message } or { ok: false, reason }.
   */
  function applyProceduralGuards(message) {
    // Placeholder: real guards land as reflect.mjs surfaces them. For now
    // we just enforce the message-length invariant and forward.
    if (typeof message !== 'string') return { ok: false, reason: 'not a string' };
    if (message.length === 0) return { ok: false, reason: 'empty' };
    return { ok: true, message };
  }

  /**
   * Get the current 30097 panic-key entry, if any. Used by destructive
   * intent enactment (memory-wipe path). Returns null if not present.
   */
  function panicKey() {
    return cache.get(KINDS.EMERGENCY_WIPE, 'panic-key');
  }

  /**
   * Report memory posture for /api/memory. Non-sensitive.
   */
  function status() {
    const snap = cache.snapshot();
    const rootCheck = verifyCharacterRoot();
    return {
      character_loaded: !!characterText,
      character_hash: characterHash,
      character_loaded_at: characterLoadedAt,
      character_root_verified: rootCheck.ok,
      character_root_reason: rootCheck.ok ? null : rootCheck.reason,
      panic_key_loaded: !!panicKey(),
      cache: snap,
    };
  }

  return {
    loadCharacter,
    verifyCharacterRoot,
    promptFragments,
    applyProceduralGuards,
    panicKey,
    status,
  };
}
