# Continuum — Ansible Deployment

One-click installer for the [Continuum](https://github.com/ChiefmonkeyArt/torii-continuum)
project engine on a VPS. Installs the agent daemon, builds the frontend, and
sets up Caddy reverse proxy with automatic TLS.

Tested on Ubuntu 22.04 and Debian 13.

## Requirements

- A VPS with a **public IP** (needed for TLS + NIP-07 cross-origin)
- SSH access as root or a sudo-enabled user
- **Ansible 2.x** on your local machine
- **Plebeian Signer** (or any NIP-07 browser extension) — get your npub from it
- Two DNS A records pointing at the VPS (or Cloudflare API token for automation)

## Quick Start

```bash
git clone https://github.com/ChiefmonkeyArt/torii-continuum.git
cd torii-continuum

# Set required variables
export CONTINUUM_ADMIN_NPUB="npub1..."          # YOUR npub from Plebeian Signer
export CONTINUUM_DOMAIN="continuum.example.com"  # frontend subdomain
export CONTINUUM_AGENT_DOMAIN="agent.example.com" # API subdomain
export CONTINUUM_VPS_IP="1.2.3.4"
export CONTINUUM_VPS_USER="root"
export ACME_EMAIL="admin@example.com"

# Deploy
ansible-playbook ansible/playbooks/deploy.yml -i ansible/inventory/hosts.yml
```

## Identity Model

The instance is locked to the npub you provide at install time via
`CONTINUUM_ADMIN_NPUB`. Ansible validates the npub1... format and writes it
to `config.yaml`. **No nsec (private key) ever touches the VPS** — signing
happens entirely in your browser via Plebeian Signer.

| What | Where |
|------|-------|
| npub (public key) | `config.yaml` on VPS, mode 0644 |
| nsec (private key) | **Browser only** — Plebeian Signer, never on server |
| session_secret | `config.yaml` on VPS, auto-generated 64 hex chars |

To change the admin npub after install:
```bash
ssh user@your-vps
sudo -u continuum vi /home/continuum/agent/repo/agent/config.yaml
sudo systemctl restart continuum-agent
```

## Roles

| Role | What it does |
|------|-------------|
| `system` | Creates `continuum` user, installs Node.js 20 LTS |
| `identity` | Validates npub, generates session secret |
| `continuum_agent` | Clones repo, installs deps, renders config.yaml, builds frontend, starts systemd service |
| `caddy` | Detects existing Caddy or installs fresh, injects reverse proxy routes, provisions TLS |

## Architecture

```
Browser (Plebeian Signer)
    ↓ HTTPS
Caddy (TLS termination, subdomain routing)
    ├── agent.example.com → reverse_proxy → 127.0.0.1:8787
    └── continuum.example.com → file_server → static Vite SPA

Agent daemon (Node 20 + Fastify, 127.0.0.1:8787)
    ├── NIP-07 auth (kind 22242 challenge/verify)
    ├── Cashu wallet (on-VPS float, memory/wallet/)
    └── Routstr client (LLM via Cashu)
```

## Configuration

All defaults live in `ansible/roles/*/defaults/main.yml` and
`ansible/inventory/group_vars/all.yml`. Override via environment variables:

| Env var | Required | Description |
|---------|----------|-------------|
| `CONTINUUM_ADMIN_NPUB` | **Yes** | Your npub from Plebeian Signer |
| `CONTINUUM_DOMAIN` | **Yes** | Frontend subdomain |
| `CONTINUUM_AGENT_DOMAIN` | **Yes** | Agent API subdomain |
| `CONTINUUM_VPS_IP` | **Yes** | VPS IP address |
| `CONTINUUM_VPS_USER` | No | SSH user (default: `root`) |
| `ACME_EMAIL` | No | Let's Encrypt email |
| `CLOUDFLARE_API_TOKEN` | No | Auto-create DNS records |
| `CLOUDFLARE_ZONE_ID` | No | Required if using Cloudflare DNS |

## Caddy Detection

The Caddy role handles three scenarios:

1. **systemd Caddy** — injects routes into `/etc/caddy/Caddyfile`, reloads
2. **Docker Caddy** — exports Caddyfile, injects routes, imports back, reloads
3. **No Caddy** — downloads binary, creates systemd unit, starts fresh

## Verification

After deploy:
```bash
# Agent health
curl https://agent.example.com/api/health
# Expected: {"ok":true,"service":"torii-continuum-agent","version":"..."}

# Frontend
curl -I https://continuum.example.com
# Expected: HTTP/2 200
```
