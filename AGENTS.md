# AGENTS.md

## Cursor Cloud specific instructions

### Overview

Aether OS is a desktop-style web UI where widgets (HTML panels) are generated from natural-language prompts using a local LLM (Ollama). It is an npm workspaces monorepo with two packages:

- **`client/`** — Vite + React (TypeScript) SPA on port 5173
- **`server/`** — NestJS (TypeScript) REST API on port 3001

### External services

| Service | Purpose | How to start |
|---------|---------|-------------|
| MySQL | Widget persistence (TypeORM, auto-synced schema) | `sudo docker start mysql` or `sudo docker run -d --name mysql -p 3306:3306 -e MYSQL_ALLOW_EMPTY_PASSWORD=yes -e MYSQL_DATABASE=aether mysql:8` then set root password to match `MYSQL_PASSWORD` env var |
| Ollama | LLM inference for widget HTML generation | `ollama serve &>/tmp/ollama.log &` (model must be pulled: `ollama pull qwen3:0.6b`) |

### Gotchas

- **Injected secrets override `.env`**: The Cloud Agent VM injects `MYSQL_PASSWORD`, `OLLAMA_MODEL`, and `OLLAMA_BASE_URL` as environment variables. NestJS ConfigService reads env vars with higher priority than the `.env` file. If `OLLAMA_MODEL` points to a model not pulled locally, generation will silently fail. Override by passing `OLLAMA_MODEL=qwen3:0.6b` when starting the dev server.
- **MySQL Docker root password**: After starting MySQL with `MYSQL_ALLOW_EMPTY_PASSWORD=yes`, you must set the root password to match the injected `MYSQL_PASSWORD` env var: `sudo docker exec mysql mysql -uroot -e "ALTER USER 'root'@'%' IDENTIFIED WITH caching_sha2_password BY '<password>'; FLUSH PRIVILEGES;"`
- **Docker in nested container**: Requires `fuse-overlayfs` storage driver and `iptables-legacy`. See daemon.json configuration in `/etc/docker/daemon.json`.
- **Pre-existing lint errors**: `npm run lint` (which runs `tsc --noEmit` in client) has two TS2322 errors in `client/src/features/desktop/components/WebGLBackground.tsx`. These are pre-existing and not caused by setup.

### Standard commands

See `package.json` scripts for all commands:
- `npm run dev` — starts both client and server concurrently
- `npm run dev:client` / `npm run dev:server` — start individually
- `npm run build` — builds both client and server
- `npm run lint` — runs TypeScript type-checking on client
