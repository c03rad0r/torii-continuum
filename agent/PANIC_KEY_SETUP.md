# Panic Key Setup — `kind:30097` `emergency_wipe_authority`

**Optional but recommended.** The panic key is a single Nostr event whose
mere presence in the agent's decrypted memory cache **collapses the
destructive-intent double-signature cooldown to a single signature**. It
exists so the operator can wipe the character stack **under duress**
without needing a second device.

Wipes work without it. The normal 30096 `destructive_intent` flow (60s
cooldown + double signature from your primary signer) is the default and
covers every non-duress case. The panic key only matters when your
primary signer is unavailable, coerced, or compromised.

If you're not sure whether you need one: you probably don't yet. Get
comfortable with the normal flow first, then add a 30097 later if the
threat model warrants it. Enable it in `config.yaml` under `panic_key:`
once generated.

Storage options (least to most durable):

- **Password manager only** — fine for most threat models. Treat the key
  like a seed phrase, not a website password.
- **Password manager + paper/steel backup** — recommended if you value
  the emergency override at all.
- **Hardware signer (Coldcard-style / dedicated nostr device)** — for
  operators who genuinely expect duress scenarios.

---

## Threat model this covers

- Rubber-hose scenario where the operator has one device and needs to
  wipe memory NOW.
- Compromise of the VPS process without compromise of the operator's
  signing device — the operator can trigger a wipe from cold storage.
- Coercion by a party that has taken control of both the operator's
  primary signer AND the VPS — but not the panic key. The panic key is
  the operator's last-resort "collapse everything" authority.

## What this does NOT cover

- Compromise of the operator's identity npub itself. If the primary
  signing key is stolen, the panic key stops mattering — the attacker
  becomes the operator.
- Attackers who observe live RAM on the VPS. Anything unlocked in RAM
  can be read by a root-level compromise.

---

## Generation procedure

**Do this once, on a device that will never touch the VPS again.**

### Prereqs

- A cold machine (air-gapped preferable; a phone you'll never sync also works).
- A Nostr signer on that device (Nostur / Amethyst / nak / anything that
  can sign a raw event).
- Your operator npub in `npub1…` form.

### Steps

1. **On the cold device**, prepare the unsigned payload:

   ```json
   {
     "kind": 30097,
     "created_at": <UNIX_SECONDS_NOW>,
     "tags": [
       ["d", "panic-key"],
       ["encrypted"],
       ["t", "panic"],
       ["client", "torii-continuum-agent"],
       ["expiration", "<UNIX_SECONDS_NOW + 315360000>"]
     ],
     "content_plaintext": {
       "schema": "torii.continuum.emergency_wipe_authority/1",
       "operator_npub": "npub1…",
       "generated_at": <UNIX_SECONDS_NOW>
     }
   }
   ```

2. **NIP-44 v2 encrypt** `content_plaintext` to your OWN npub. Put the
   ciphertext in the event's `content` field. Delete `content_plaintext`.

3. **Sign** the event with the cold device's signer.

4. **Copy the ciphertext body** (just the `content` string) to the VPS
   via `/api/memory/store`:

   ```bash
   curl -sS -X POST https://<vps>/api/memory/store \
     -H "Authorization: Bearer <session-token>" \
     -H "Content-Type: application/json" \
     -d '{"ciphertext": "<the encrypted content>", "kind": 30097, "d_tag": "panic-key", "event_id": "<the 64-hex id from signing>"}'
   ```

5. **Verify** the agent sees it after unlock:

   ```bash
   curl -sS https://<vps>/api/memory | jq .panic_key_loaded
   # → true
   ```

6. **Print, engrave, or split-shard** the signed event JSON (with its
   ciphertext content + id + sig). Store it in a physical location the
   operator can reach under duress but an attacker cannot. This is the
   only copy that lets you re-populate the panic key if the VPS disk is
   nuked.

7. **Wipe the cold device's local copy** of the signed event, or destroy
   the device. The signed event now exists in two places: the paper
   backup and the encrypted-at-rest VPS file. That is enough.

---

## Using the panic key

Once loaded (visible via `GET /api/memory/panic_key_loaded === true`),
the operator can trigger a wipe with **one** signature instead of two:

```bash
# 1. Operator drafts a destructive_intent
curl -sS -X POST https://<vps>/api/reflect \
  -H "Authorization: Bearer <token>" \
  -d '{"limit": 0}'   # any endpoint that creates a 30096 draft — TBD in CONT-CHARACTER-2

# 2. Operator signs it via Plebeian Signer, POSTs the signed event

# 3. Agent checks: is a 30097 panic-key loaded?
#    YES → skip the 60s cooldown + skip the second-signature requirement.
#    NO  → enforce the full cooldown + double-sig.

# 4. On enact, agent unlinks every .enc file under memory/character/,
#    memory/semantic/, memory/intents/, skills/. Panic key file itself
#    is unlinked LAST so a partial failure still leaves the escape hatch
#    reachable.

# 5. memoryCache.clear("panic-wipe") drops all RAM plaintext.
```

The CONT-CHARACTER-2 slice will wire the actual `/api/memory/wipe`
endpoint. This runbook exists now so the panic key can be generated
BEFORE the wipe path is code-complete — the event just sits encrypted
at rest until it's needed.

---

## Why not just `rm -rf`?

Because `rm -rf` requires shell access to the VPS. In the scenarios this
runbook covers, the operator may not have shell access at the moment
they need to wipe (phone-only, hostile network, session-token-only
authentication over HTTPS). The panic key path works from any device
that can hit `/api/memory/*` with a bearer token.

The `rm -rf` path is still valid — do that first if you can. The panic
key is the fallback when you can't.

---

## Rotation

If the operator's primary signer changes (new device, new key), the
panic key must be re-issued to the new npub. Old panic keys stay on
paper backup but become inert — a 30097 whose `operator_npub` doesn't
match `admin_npub` in `config.yaml` is ignored.

To rotate:

1. Generate a new panic key via steps 1–6 above with the new npub.
2. Update `config.yaml` `admin_npub` to the new npub.
3. Restart the agent.
4. Verify `panic_key_loaded === true` after re-unlock.
5. Destroy the old paper backup.

---

## Reminder

You never sign anything on the VPS. Ever. That's the entire point. The
panic key exists precisely because we accept that constraint — and we
still want a fast wipe path when the operator asks for one.
