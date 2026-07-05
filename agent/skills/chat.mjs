/**
 * Chat skill — the first real skill.
 *
 * Purpose: prove login → wallet → Routstr → reply loop end-to-end.
 *
 * Grounding: v1 uses only the current message + a tiny system prompt that
 * tells the model it is Continuum's assistant. No Brain retrieval yet
 * (that arrives with brain.read in CONT-AGENT-1b).
 *
 * Context comes from the frontend chat dock:
 *   { label: 'Routstr' | 'Marketplace' | ..., where: 'routstr' | ... }
 * We surface that in the system prompt so the model can reference where
 * the user is in the app.
 */

const SYSTEM_PROMPT = `You are Continuum, an assistant embedded in the Torii Continuum app.

Torii Continuum is an app builder, project engine and marketplace for AI work — a gateway into the Torii ecosystem (nostr + bitcoin + FOSS). You help the operator (the admin logged in via NIP-07) manage their projects, sessions, todos and marketplace tasks.

Style: concise, honest, no filler. Reference the operator's current page when it matters. Never invent capabilities that aren't in the app.

Current session invariants (do not violate):
- Every reply is generated via Routstr and paid per request in Cashu.
- Nothing you say is published to Nostr automatically. Every publish requires an explicit human click on a signed draft.
- You have no filesystem write access in v1. Skills for that (brain.write, todo.patch, nostr.draft) arrive in later slices.`;

export function createChatSkill(routstr, log) {
  async function handle({ message, context }) {
    const ctxLine = context?.label
      ? `The operator is currently on the "${context.label}" page (${context.where || 'unknown'}).`
      : '';

    const messages = [
      { role: 'system', content: SYSTEM_PROMPT + (ctxLine ? '\n\n' + ctxLine : '') },
      { role: 'user', content: message },
    ];

    const started = Date.now();
    const result = await routstr.chat({ skill: 'chat', messages });
    const duration = Date.now() - started;

    if (!result.ok) {
      log.warn(`[chat] routstr failed: ${result.reason}`);
      return { ok: false, reason: result.reason };
    }

    return {
      ok: true,
      reply: result.content,
      model: result.model,
      duration_ms: duration,
      sats_spent: result.sats_spent,
    };
  }

  return { handle };
}
