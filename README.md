# Aether OS

Experimental desktop-style UI where widgets are generated from natural language (Ollama). React + Vite frontend, NestJS backend, MySQL.

## Prerequisites

- Node.js 18+
- [Ollama](https://ollama.com) with a chat model (e.g. `ollama pull qwen3-coder:30b`)
- MySQL (create a database, e.g. `aether`)

## Setup

1. **Clone and install**

   ```bash
   npm install
   ```

2. **Environment**

   Copy `.env.example` to `.env` and set at least:

   - `MYSQL_*` — MySQL connection (default: `localhost`, user `root`, empty password, database `aether`)
   - `OLLAMA_BASE_URL` / `OLLAMA_MODEL` if not using defaults

3. **Create MySQL database**

   ```sql
   CREATE DATABASE aether;
   ```

## Run

- **Both client and server (recommended)**

  ```bash
  npm run dev
  ```

  - API: http://localhost:3001  
  - Client (Vite): http://localhost:5173 (proxies `/api` to the server)

- **Only server:** `npm run dev:server`  
- **Only client:** `npm run dev:client` (requires server on port 3001 for API)

## Structure

- `client/` — Vite + React app (Three.js/WebGL background, widgets, input bar)
- `server/` — NestJS API (widgets CRUD, widget_data, SSE generate via Ollama)
