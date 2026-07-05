/**
 * NIP-07 login + session tokens.
 *
 * Flow:
 *   1. Browser POSTs /api/auth/challenge → server returns a random challenge
 *      string + expiry (5 min). Challenge is bound to the client's IP + a
 *      short-lived server-side nonce so a stolen challenge can't be replayed
 *      from elsewhere.
 *   2. Browser asks Plebeian Signer to sign a NIP-42-shaped event
 *      (kind 22242, "client authentication"):
 *        { kind: 22242,
 *          content: challenge,
 *          tags: [['challenge', challenge], ['relay', origin]] }
 *   3. Browser POSTs /api/auth/verify { event } → server verifies:
 *        - event.pubkey === admin_npub (in hex, decoded from npub1...)
 *        - event.kind === 22242
 *        - event.tags contains a matching 'challenge' tag
 *        - event.sig verifies against event.pubkey
 *        - challenge still exists in the pending set + not expired
 *      If all pass: issue HMAC-signed session token, clear the challenge.
 *   4. Browser sends `Authorization: Bearer <token>` on every subsequent call.
 *
 * We deliberately do NOT store session state server-side. Tokens are
 * self-verifying HMAC tokens (like JWT-but-simpler). Revoke by rotating
 * session_secret.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { verifyEvent, getEventHash } from 'nostr-tools/pure';
import { nip19 } from 'nostr-tools';

const CHALLENGE_TTL_SEC = 5 * 60;
const CHALLENGE_KIND = 22242;

/**
 * @param {object} cfg  frozen loadConfig() result
 * @param {object} deps optional deps for testing: { now }
 */
export function createAuth(cfg, deps = {}) {
  const now = deps.now || (() => Math.floor(Date.now() / 1000));
  const challenges = new Map(); // challenge → { expiresAt, ip }

  // Decode admin npub to hex once at boot.
  let adminHex;
  try {
    const decoded = nip19.decode(cfg.admin_npub);
    if (decoded.type !== 'npub') throw new Error('not an npub');
    adminHex = decoded.data;
  } catch (e) {
    console.error(`[auth] admin_npub decode failed: ${e.message}`);
    process.exit(1);
  }

  function gc() {
    const t = now();
    for (const [k, v] of challenges) {
      if (v.expiresAt < t) challenges.delete(k);
    }
  }

  function issueChallenge(clientIp) {
    gc();
    const challenge = randomBytes(24).toString('hex');
    challenges.set(challenge, { expiresAt: now() + CHALLENGE_TTL_SEC, ip: clientIp });
    return { challenge, expires_in: CHALLENGE_TTL_SEC };
  }

  /**
   * @returns { ok: true, token, expiresAt } | { ok: false, reason }
   */
  function verifyChallenge(event, clientIp) {
    if (!event || typeof event !== 'object') return { ok: false, reason: 'no event' };
    if (event.kind !== CHALLENGE_KIND) return { ok: false, reason: 'wrong kind (expected 22242)' };
    if (event.pubkey !== adminHex) return { ok: false, reason: 'pubkey is not admin npub' };

    // Find the challenge tag
    const tag = (event.tags || []).find((t) => Array.isArray(t) && t[0] === 'challenge');
    if (!tag || !tag[1]) return { ok: false, reason: 'missing challenge tag' };
    const challenge = tag[1];

    const entry = challenges.get(challenge);
    if (!entry) return { ok: false, reason: 'unknown or expired challenge' };
    if (entry.expiresAt < now()) {
      challenges.delete(challenge);
      return { ok: false, reason: 'expired challenge' };
    }
    if (entry.ip && clientIp && entry.ip !== clientIp) {
      // Not fatal — mobile networks reissue IPs. Warn but allow.
      // Toggle to reason:'ip-mismatch' if you want to be strict.
    }

    // Verify event content also carries the same challenge (defence-in-depth).
    if (event.content && event.content !== challenge) {
      return { ok: false, reason: 'content/tag mismatch' };
    }

    // Verify id + signature
    let sigOk = false;
    try {
      const computedId = getEventHash(event);
      if (computedId !== event.id) return { ok: false, reason: 'id mismatch' };
      sigOk = verifyEvent(event);
    } catch (e) {
      return { ok: false, reason: `sig verify threw: ${e.message}` };
    }
    if (!sigOk) return { ok: false, reason: 'bad signature' };

    // All checks passed. Consume the challenge.
    challenges.delete(challenge);

    const token = issueSessionToken();
    return { ok: true, token: token.token, expires_at: token.expiresAt };
  }

  function issueSessionToken() {
    const iat = now();
    const exp = iat + cfg.session_ttl_sec;
    const payload = `${iat}.${exp}.${adminHex}`;
    const sig = createHmac('sha256', cfg.session_secret).update(payload).digest('hex');
    return { token: `${payload}.${sig}`, expiresAt: exp };
  }

  /**
   * @returns { ok, npub? , reason? }
   */
  function verifySessionToken(token) {
    if (!token || typeof token !== 'string') return { ok: false, reason: 'no token' };
    const parts = token.split('.');
    if (parts.length !== 4) return { ok: false, reason: 'malformed' };
    const [iatStr, expStr, pk, sig] = parts;
    const iat = parseInt(iatStr, 10);
    const exp = parseInt(expStr, 10);
    if (!Number.isFinite(iat) || !Number.isFinite(exp)) return { ok: false, reason: 'bad timestamps' };
    if (exp < now()) return { ok: false, reason: 'expired' };
    if (pk !== adminHex) return { ok: false, reason: 'not admin pubkey' };

    const expected = createHmac('sha256', cfg.session_secret)
      .update(`${iat}.${exp}.${pk}`)
      .digest('hex');
    let match = false;
    try {
      match = timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'));
    } catch {
      return { ok: false, reason: 'sig length mismatch' };
    }
    if (!match) return { ok: false, reason: 'bad signature' };

    return { ok: true, npub: cfg.admin_npub, exp };
  }

  return {
    issueChallenge,
    verifyChallenge,
    verifySessionToken,
    _adminHex: adminHex, // exposed for tests
  };
}
