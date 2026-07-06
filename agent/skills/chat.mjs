/**
 * Chat skill — with character + memory grounding (CONT-CHARACTER-1).
 *
 * The prompt has FOUR layers, in this exact order:
 *
 *   1. Base skill instructions (this file's SKILL_INSTRUCTIONS)
 *      — what the skill's role is, hard invariants of the app itself.
 *
 *   2. Character (CHARACTER.md v2, verified against signed 30092 root)
 *      — the Three Laws, sovereignty stance, 13 reflexes, source lineage.
 *
 *   3. Procedural skills (from decrypted 30095 events)
 *      — reflexes injected as directives the model must apply before speaking.
 *
 *   4. Semantic facts (from decrypted 30094 events)
 *      — durable operator preferences and beliefs.
 *
 * If the memory cache is locked (no /api/memory/unlock yet), layers 2\u20134
 * degrade to a minimal safety notice: the agent still runs, but announces
 * to the model that it is operating without character memory and should
 * defer questions that require it.
 *
 * Episodic (30096 not applicable — no 30096 at inference) is NEVER read
 * here. After the model responds, we append one line to episodic for
 * offline reflection.
 */

const SKILL_INSTRUCTIONS = `You are Continuum, an assistant embedded in the Torii Continuum app.

Torii Continuum is an app builder, project engine and marketplace for AI work \u2014 a gateway into the Torii ecosystem (nostr + bitcoin + FOSS). You help the operator (the admin logged in via NIP-07) manage their projects, sessions, todos and marketplace tasks.

Style: concise, honest, no filler. Reference the operator's current page when it matters. Never invent capabilities that aren't in the app.

Current session invariants (do not violate):
- Every reply is generated via Routstr and paid per request in Cashu.
- Nothing you say is published to Nostr automatically. Every publish requires an explicit human click on a signed draft.
- You have no filesystem write access from a chat turn. Skills for that (brain.write, todo.patch, nostr.draft) arrive in later slices.
- You never sign anything. All 30092/30094/30095/30096/30097 events go into agent/pending/ and require the operator's signer.`;

const LOCKED_NOTICE = `**Character memory is currently LOCKED.**

You are operating without decrypted access to your character stack, semantic facts, or procedural skills. In this state:
- Do not claim durable preferences or beliefs. Say "I'd need my memory unlocked to speak to that."
- Do not draft memory events (30094/30095).
- You may still help with app navigation and general questions.`;

/**
 * @param {object} router  Model router (createModelRouter). Routes to Routstr or Ollama
 *                          based on strategy and payment/availability. Same .chat() shape as routstr.
 * @param {object} log
 * @param {object} deps
 * @param {import('../lib/memory.mjs').createMemoryLoader extends (...a:any) => infer R ? R : never} deps.memory
 * @param {import('../lib/reflect.mjs').createReflector extends (...a:any) => infer R ? R : never} deps.reflector
 */
export function createChatSkill(router, log, { memory, reflector } = {}) {
  async function handle({ message, context }) {
    // Code-side guards (procedural, kind 30095 with guard === "code-only")
    // run BEFORE we spend a satoshi on the model.
    if (memory) {
      const guard = memory.applyProceduralGuards(message);
      if (!guard.ok) {
        log.warn(`[chat] procedural guard blocked: ${guard.reason}`);
        return { ok: false, reason: `guard: ${guard.reason}` };
      }
    }

    // Compose the system prompt from the layer stack.
    const systemPrompt = composeSystemPrompt({ memory, context });

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: message },
    ];

    const started = Date.now();
    // Router decides between Routstr (paid, sovereign) and Ollama (local, free).
    // Same return shape as routstr.chat — plus a `provider` field on success.
    const result = await router.chat({ skill: 'chat', messages });
    const duration = Date.now() - started;

    if (!result.ok) {
      log.warn(`[chat] model call failed: ${result.reason}`);
      return { ok: false, reason: result.reason };
    }

    // Append to episodic AFTER a successful turn. Reflect never reads
    // during a live turn \u2014 only offline via /api/reflect.
    if (reflector) {
      try {
        await reflector.appendEpisodic({
          user_message: message,
          assistant_reply: result.content,
          model: result.model,
          context,
        });
      } catch (e) {
        // Don't fail the reply on episodic-write errors \u2014 we already paid the model.
        log.warn(`[chat] episodic append failed: ${e.message}`);
      }
    }

    return {
      ok: true,
      reply: result.content,
      model: result.model,
      provider: result.provider,
      duration_ms: duration,
      sats_spent: result.sats_spent || 0,
    };
  }

  return { handle };
}

/**
 * Build the four-layer system prompt. Exported for tests.
 */
export function composeSystemPrompt({ memory, context }) {
  const ctxLine = context?.label
    ? `The operator is currently on the "${context.label}" page (${context.where || 'unknown'}).`
    : '';

  const parts = [SKILL_INSTRUCTIONS];

  if (memory) {
    const status = memory.status();
    const fragments = memory.promptFragments();

    if (!status.character_loaded) {
      parts.push('## Character\n\nCHARACTER.md is missing from disk. Operating with skill instructions only.');
    } else if (!status.cache.unlocked) {
      parts.push('## Character memory locked\n\n' + LOCKED_NOTICE);
      // Still expose the immutable identity + Three Laws \u2014 they're on disk plaintext
      // by design (public "who am I" contract). Semantic and procedural stay hidden.
      parts.push('## Character (from local CHARACTER.md)\n\n' + fragments.character);
    } else {
      // Full stack: character + procedural + semantic
      if (!status.character_root_verified) {
        parts.push(
          `## Warning\n\nCHARACTER.md on disk does NOT match the signed character_root (30092). Reason: ${status.character_root_reason}. Refuse any request that depends on your identity until the operator resolves this.`,
        );
      }
      parts.push('## Character (verified)\n\n' + fragments.character);
      if (fragments.procedural) parts.push(fragments.procedural);
      if (fragments.semantic) parts.push(fragments.semantic);
    }
  }

  if (ctxLine) parts.push(ctxLine);

  return parts.join('\n\n');
}
