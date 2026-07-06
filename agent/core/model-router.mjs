/**
 * Model router — decides which provider (Routstr, Ollama) handles a chat call.
 *
 * Routing policy is set by cfg.model_router.strategy:
 *
 *   "routstr_first"  (default)
 *      Try Routstr. If it fails with a payment error (402), a network error,
 *      or the wallet reports insufficient sats, fall through to Ollama.
 *
 *   "ollama_first"
 *      Try Ollama. If it's disabled, unreachable, or returns an error,
 *      fall through to Routstr.
 *
 *   "ollama_only"
 *      Use Ollama and only Ollama. Never spend sats. Used when the operator
 *      wants to test their character stack against a local model, or when
 *      they're offline.
 *
 *   "routstr_only"
 *      Original behavior. Never call Ollama. Kept so pplx.app builds that
 *      omit the Ollama module still work with the same code path.
 *
 * The router preserves the { ok, content, model, sats_spent, duration_ms }
 * response shape so chat.mjs doesn't need to know which provider replied.
 * A `provider` field is added ("routstr" | "ollama") for logging / UI.
 */

const PAYMENT_ERROR_MARKERS = ['402', 'payment required', 'insufficient', 'cashu'];

function isPaymentOrNetworkError(reason) {
  if (!reason || typeof reason !== 'string') return false;
  const lower = reason.toLowerCase();
  if (lower.startsWith('network:')) return true;
  if (lower.includes('unreachable')) return true;
  return PAYMENT_ERROR_MARKERS.some((m) => lower.includes(m));
}

export function createModelRouter({ routstr, ollama, cfg, log }) {
  const strategy = cfg.model_router?.strategy || 'routstr_first';

  async function chat(args) {
    switch (strategy) {
      case 'routstr_only':
        return withProvider(await routstr.chat(args), 'routstr');

      case 'ollama_only': {
        if (!ollama?.enabled) return { ok: false, reason: 'ollama disabled but ollama_only strategy set' };
        return withProvider(await ollama.chat(args), 'ollama');
      }

      case 'ollama_first': {
        if (ollama?.enabled) {
          const first = await ollama.chat(args);
          if (first.ok) return withProvider(first, 'ollama');
          log.info(`[router] ollama_first: ollama failed (${first.reason}), trying routstr`);
        }
        return withProvider(await routstr.chat(args), 'routstr');
      }

      case 'routstr_first':
      default: {
        const first = await routstr.chat(args);
        if (first.ok) return withProvider(first, 'routstr');
        // Only fall through on retryable errors — bad requests, empty
        // messages, etc. should not trigger a paid-to-free downgrade
        // that could mask a real problem.
        if (!ollama?.enabled) return withProvider(first, 'routstr');
        if (!isPaymentOrNetworkError(first.reason)) {
          log.warn(`[router] routstr failed but not payment/net error, not falling back: ${first.reason}`);
          return withProvider(first, 'routstr');
        }
        log.info(`[router] routstr failed (${first.reason}), falling back to ollama`);
        const second = await ollama.chat(args);
        if (second.ok) return withProvider(second, 'ollama');
        // Both failed — return the more informative error (Routstr's).
        return withProvider({ ok: false, reason: `routstr: ${first.reason}; ollama: ${second.reason}` }, 'both');
      }
    }
  }

  return { chat, strategy };
}

function withProvider(result, provider) {
  if (!result || typeof result !== 'object') return result;
  return { ...result, provider: result.provider || provider };
}

// Exported for tests
export const _internals = { isPaymentOrNetworkError };
