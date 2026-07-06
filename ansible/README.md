# Continuum — Ansible Deployment

One-click installer for the [Continuum](https://github.com/ChiefmonkeyArt/torii-continuum)
project engine on a VPS. Installs the agent daemon, builds the frontend, and
sets up Caddy reverse proxy with automatic TLS.

## Requirements

- A VPS running **Ubuntu 22.04+** or **Debian 12+**
- A domain/subdomain pointed at the VPS (for TLS)
- SSH access to the VPS as root or a sudo-enabled user
- **Optional:** Cloudflare API token for automated DNS (omit for manual DNS)

## Quick Start

```bash
# 1. Set your VPS IP and domain
export CONTINUUM_VPS_IP="1.2.3.4"
export BASE_DOMAIN="orangesync.tech"
export CONTINUUM_DOMAIN="continuum.orangesync.tech"
export CONTINUUM_AGENT_DOMAIN="agent.orangesync.tech"
export ACME_EMAIL="admin@example.com"

# 2. Run the deploy playbook
ansible-playbook ansible/playbooks/deploy.yml
```

## Identity Management

The ansible playbook **automatically generates** a Nostr keypair (npub/nsec)
and a session secret on first deploy. These are saved to
`/home/continuum/agent/identity/` on the VPS:

| File | Contents | Mode |
|------|----------|------|
| `secret.key` | Operator nsec (import into Plebeian Signer) | 0600 |
| `public.key` | Operator npub (safe to share) | 0644 |
| `session_secret` | Agent session HMAC key (64 hex chars) | 0600 |

The first run prints the generated identity — **save the nsec immediately**.
If you lose it, you can recover from the VPS filesystem (ssh in and read it).

## Playbooks

| # | Playbook | What it does |
|---|----------|-------------|
| 01 | `01-system.yml` | Create `continuum` user, install Node.js 20, create directories |
| 02 | `02-identity.yml` | Generate or restore Nostr keypair + session secret |
| 03 | `03-continuum-agent.yml` | Clone repo, render config.yaml, deploy systemd unit, start agent |
| 04 | `04-frontend.yml` | Install deps, build Vite SPA with VITE_AGENT_URL, deploy static files |
| 05 | `05-caddy.yml` | Install Caddy, deploy reverse proxy config, start with TLS |
| - | `deploy.yml` | **Full stack** — runs 01-05 in order |

## Configuration

All variables are in `ansible/inventory/group_vars/all.yml`. Override via
environment variables (prefixed with `CONTINUUM_`) before running ansible:

| Env var | Default | Description |
|---------|---------|-------------|
| `CONTINUUM_VPS_IP` | (required) | VPS IP address |
| `CONTINUUM_VPS_USER` | `root` | SSH user |
| `BASE_DOMAIN` | `example.com` | Root domain |
| `CONTINUUM_DOMAIN` | `continuum.<base>` | Frontend URL |
| `CONTINUUM_AGENT_DOMAIN` | `agent.<base>` | Agent API URL |
| `CONTINUUM_ADMIN_NPUB` | auto-generated | Skip key generation, use this npub |
| `CONTINUUM_ADMIN_NSEC` | auto-generated | Skip key generation, use this nsec |
| `CONTINUUM_SESSION_SECRET` | auto-generated | Skip session secret generation |
| `CLOUDFLARE_API_TOKEN` | (optional) | Auto-configure DNS |
| `ACME_EMAIL` | `admin@<domain>` | Let's Encrypt notification email |

## Architecture

```
Browser (Plebeian Signer)
    ↓ HTTPS
Caddy (TLS termination, subdomain routing)
    ├── agent.continuum.<domain> → reverse proxy → agent daemon (127.0.0.1:8787)
    └── continuum.<domain>       → file_server     → static Vite SPA

Agent daemon (Node 20 + Fastify, listens 127.0.0.1:8787)
    ├── NIP-07 auth (kind 22242 challenge/verify via Plebeian Signer)
    ├── Cashu wallet (on-VPS float, memory/wallet/)
    └── Routstr client (api.routstr.com, Cashu-paid LLM)
```

## Dual-Publish

Every push to this repo goes to both **GitHub** and **ngit**:

```
git push origin <branch>
git push --no-verify ngit <branch>
```

ngit mirror: [gitworkshop.dev](https://gitworkshop.dev/npub12m5exm2uk3xa674cc5r0hlyvccs5xxn7qv83ezuteefv5972nquq4j4szl/relay.ngit.dev/torii-continuum)
