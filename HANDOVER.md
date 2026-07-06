# Continuum VPS Deployment — Handover

## What This Is

A complete Ansible-based one-click installer for Continuum. Clone, set 5 environment variables, run one command, get a live Continuum instance with TLS.

## PR

**https://github.com/ChiefmonkeyArt/torii-continuum/pull/1**

Branch: `feat/ansible-deploy` (5 commits)

## What's Delivered

| Component | Location | Description |
|-----------|----------|-------------|
| Ansible roles | `ansible/roles/` | system, identity, continuum_agent, caddy |
| Deploy playbook | `ansible/playbooks/deploy.yml` | Runs all 4 roles in sequence |
| Individual playbooks | `ansible/playbooks/01-05*.yml` | Run individual phases |
| Config template | `ansible/roles/continuum_agent/templates/config.yaml.j2` | Full agent config |
| Caddyfile template | `ansible/roles/caddy/templates/Caddyfile.j2` | Reverse proxy + TLS |
| Environment vars | `ansible/.env.example` | All variables documented |
| Install guide | `INSTALL.md` | Operator quickstart |
| Architecture ref | `ansible/README.md` | Full technical reference |
| Playwright tests | `tests/playwright/` | 21 tests (6 API + 15 SPA) |

## Identity Model

The operator provides their npub at install time. No nsec on the server.

```
Browser (Plebeian Signer holds nsec)
    ↓ signs NIP-07 challenge
Agent validates against admin_npub in config.yaml
    ↓ grants session cookie (HMAC with session_secret)
```

To change admin: edit `admin_npub` in `config.yaml`, restart agent.

## Verified Working On

- Ubuntu 22.04 (VPS1, Caddy in Docker)
- Debian 13 (VPS2, Caddy as systemd)

Both deployed via the same playbook with zero code changes between them.

## Quick Test

```bash
# Deploy
export CONTINUUM_ADMIN_NPUB="npub1..."
export CONTINUUM_DOMAIN="continuum.yourdomain.com"
export CONTINUUM_AGENT_DOMAIN="agent.yourdomain.com"
export CONTINUUM_VPS_IP="1.2.3.4"
export CONTINUUM_VPS_USER="root"
export ACME_EMAIL="admin@yourdomain.com"
ansible-playbook ansible/playbooks/deploy.yml -i ansible/inventory/hosts.yml

# Verify
curl https://agent.yourdomain.com/api/health
```

## Caddy Modes

The Caddy role auto-detects which mode the target VPS is in:

1. **systemd** — injects routes into `/etc/caddy/Caddyfile`, reloads via systemctl
2. **Docker** — exports Caddyfile from container, injects routes, imports back, reloads
3. **None** — downloads Caddy binary, creates systemd unit, starts fresh

No manual Caddy config needed.

## Decisions Made

1. **npub, not keypair generation** — More secure, no race condition on public instances
2. **Standalone ansible/ in repo** — Not a separate infra-kit dependency
3. **Caddy, not nginx** — Automatic TLS, simpler config
4. **systemd, not PM2** — Native process management, no extra deps
5. **Cloudflare DNS optional** — Non-fatal if no API token; records can be manual

## Files Changed vs upstream/main

```
 ansible/.env.example                              |  35 ++
 ansible/README.md                                 | 140 +++++
 ansible/ansible.cfg                               |   5 +
 ansible/inventory/group_vars/all.yml              |  53 +++
 ansible/inventory/hosts.yml                       |   8 +
 ansible/playbooks/01-system.yml                   |   8 +
 ansible/playbooks/02-identity.yml                 |   8 +
 ansible/playbooks/03-continuum-agent.yml          |   9 +
 ansible/playbooks/05-caddy.yml                    |   8 +
 ansible/playbooks/deploy.yml                      |  11 +
 ansible/roles/caddy/defaults/main.yml             |   8 +
 ansible/roles/caddy/handlers/main.yml             |  14 +
 ansible/roles/caddy/tasks/main.yml                | 161 +++++++
 ansible/roles/caddy/templates/Caddyfile.j2        |  19 +
 ansible/roles/caddy/templates/caddy.service.j2    |  20 +
 ansible/roles/continuum_agent/defaults/main.yml   |   5 +
 ansible/roles/continuum_agent/handlers/main.yml   |  10 +
 ansible/roles/continuum_agent/tasks/main.yml      |  91 +++++
 ansible/roles/continuum_agent/templates/config.yaml.j2 | 63 ++++
 ansible/roles/continuum_agent/templates/continuum-agent.service.j2 | 16 ++
 ansible/roles/identity/tasks/main.yml             |  76 +++++
 ansible/roles/system/tasks/main.yml               |  46 +++
 INSTALL.md                                        |  83 ++++
 tests/playwright/.gitignore                       |   3 +
 tests/playwright/agent-api.spec.ts                |  99 +++++
 tests/playwright/happy-path.spec.ts               | 168 +++++++++
 tests/playwright/package.json                     |  20 +
 tests/playwright/playwright.config.ts             |  18 +
 HANDOVER.md                                       | (this file)
```
