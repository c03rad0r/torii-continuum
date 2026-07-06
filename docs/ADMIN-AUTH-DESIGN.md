# Continuum — Admin Access Design

## Problem

Public-facing Continuum instances are vulnerable to admin takeover. The
"first person to login becomes admin" model (used by WordPress for over a
decade) is safe when instances are not globally reachable (e.g. routers on
LAN). But Continuum instances are public web services — automated scanners
(Shodan, Censys) fingerprint new services within hours, and bots can
create free Nostr identities instantly.

A bot that reaches a fresh Continuum instance before the legitimate owner
logs in would claim admin and gain full control: project import, wallet
administration, marketplace configuration.

## Solution: Install-Time npub Locking

The operator's Nostr npub is declared **before** the agent service starts.
It is written into the agent's `config.yaml` at deploy time. The auth
middleware checks every login against this npub from first boot — there is
no unclaimed window, no race condition, no token to manage.

### Design Properties

| Property | How |
|----------|-----|
| Zero race condition | npub is in config before agent starts |
| No secret on VPS | Agent stores only the public npub, never the nsec |
| No token to lose | npub is derived from the user's nsec (which they already have in Plebeian Signer) |
| Low friction | Paste npub once during install, done |
| Survives restarts | npub is in `config.yaml`, not ephemeral state |

## Roles

### Admin (matched by `admin_npub`)

Full control over the instance:

- Import projects from GitHub or ngit URLs
- Configure marketplace settings
- Administer the Cashu wallet (top up, set budgets)
- Manage agent configuration
- View all system stats

### Authenticated User (any valid Nostr login)

Standard user access — can use the instance but cannot admin it:

- View public projects and milestones
- Claim marketplace bounties
- Use personal wallet features (Routstr chat)
- Participate in the Torii ecosystem

### Anonymous (no login)

Read-only access to public content:

- Browse the marketplace
- View public project boards
- Cannot claim bounties, chat, or interact

## Implementation

### Agent Config (`config.yaml`)

```yaml
admin_npub: "npub1vasdjx8jt53dwjat9klrunnk5wfcst4gye229pghqntplf7tn6rseyz3nh"
```

This is rendered by the Ansible `identity` role from the
`CONTINUUM_ADMIN_NPUB` environment variable at deploy time.

### Auth Middleware (Agent — `agent/src/auth/`)

The NIP-07 challenge/verify flow:

```
1. Browser requests login
2. Agent generates random challenge string
3. Browser signs challenge with Plebeian Signer (NIP-07 window.nostr)
4. Agent verifies signature → extracts pubkey → converts to npub
5. Agent checks: npub === config.admin_npub?
   YES → session with admin role
   NO  → session with user role
6. Agent issues session cookie (HMAC-signed with session_secret)
```

### Frontend (Vite SPA)

The frontend receives the session role from the agent API and
conditionally renders admin controls (project import, config, wallet
management) only for admin sessions.

## Deploy-Time Flow

```
┌─────────────────────────────────────────────────────┐
│ install.sh (or ansible-playbook)                    │
│                                                     │
│  1. Prompt: "Enter your Nostr npub"                 │
│     └── User pastes npub from Plebeian Signer       │
│                                                     │
│  2. Validate: starts with npub1, 60-65 chars        │
│                                                     │
│  3. Ansible identity role:                          │
│     └── Write npub to config.yaml (admin_npub)      │
│     └── Write npub to identity/admin.npub (0644)    │
│     └── Generate session_secret (0600, internal)    │
│                                                     │
│  4. Agent starts with admin_npub already set        │
│     └── No unclaimed window — locked from boot      │
│                                                     │
│  5. User visits frontend, logs in with Signer       │
│     └── Agent recognizes npub → admin session       │
└─────────────────────────────────────────────────────┘
```

## Changing Admin

To change the admin npub after deployment:

1. SSH to the VPS
2. Edit `config.yaml` — replace `admin_npub` value
3. Restart the agent: `sudo systemctl restart continuum-agent`

No reinstall needed. The change takes effect on next login.

## Why Not Other Approaches?

### First-Login-Wins

Unsafe for public instances. Automated scanners find new services within
hours. Nostr identities are free and instant to create. A bot would claim
admin before the legitimate owner even loads the page.

### Install-Time Claim Token

Works, but adds friction (token to copy, store, potentially lose). The
npub IS the identity in Nostr — there's no need for a separate token when
the user already has a cryptographic identity.

### WordPress-Style Setup Wizard

Unnecessary for Nostr. WordPress needs it because users don't have a
pre-existing identity. With Nostr, the npub from Plebeian Signer IS the
identity — just paste it during install.

### Hardcoded nsec on Server

Rejected. The agent only needs the public npub to verify signatures. The
nsec should never touch the server — it stays in Plebeian Signer in the
browser. This follows the principle of least privilege.

## Future Enhancements

- **Multiple admins:** `admin_npubs` list instead of single `admin_npub`
- **Role-based access control:** Configurable roles beyond admin/user
- **NIP-26 delegation:** Allow admin to delegate limited powers
- **Admin transfer:** On-chain (Nostr event) transfer of admin npub
