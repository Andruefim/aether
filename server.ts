import express from "express";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";
import { v4 as uuidv4 } from "uuid";
import dotenv from "dotenv";

dotenv.config();

const OLLAMA_BASE = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "qwen3:latest";

const db = new Database("aether.db");

// Initialize DB
db.exec(`
  CREATE TABLE IF NOT EXISTS widgets (
    id TEXT PRIMARY KEY,
    user_prompt TEXT,
    html TEXT,
    position_x REAL,
    position_y REAL,
    width REAL,
    height REAL,
    created_at INTEGER,
    last_accessed INTEGER,
    opacity_decay REAL,
    minimized INTEGER DEFAULT 0
  );
  
  CREATE TABLE IF NOT EXISTS widget_data (
    widget_id TEXT,
    key TEXT,
    value TEXT,
    PRIMARY KEY (widget_id, key)
  );
`);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API Routes
  app.get("/api/widgets", (req, res) => {
    const widgets = db.prepare("SELECT * FROM widgets").all();
    res.json(widgets);
  });

  app.post("/api/widgets", (req, res) => {
    const { id, user_prompt, position_x, position_y } = req.body;
    const now = Date.now();
    db.prepare(`
      INSERT INTO widgets (id, user_prompt, html, position_x, position_y, width, height, created_at, last_accessed, opacity_decay, minimized)
      VALUES (?, ?, '', ?, ?, 400, 300, ?, ?, 1.0, 0)
    `).run(id, user_prompt, position_x, position_y, now, now);
    res.json({ success: true });
  });

  app.put("/api/widgets/:id", (req, res) => {
    const { id } = req.params;
    const { html, position_x, position_y, width, height, minimized, last_accessed } = req.body;
    
    const updates = [];
    const params = [];
    
    if (html !== undefined) { updates.push("html = ?"); params.push(html); }
    if (position_x !== undefined) { updates.push("position_x = ?"); params.push(position_x); }
    if (position_y !== undefined) { updates.push("position_y = ?"); params.push(position_y); }
    if (width !== undefined) { updates.push("width = ?"); params.push(width); }
    if (height !== undefined) { updates.push("height = ?"); params.push(height); }
    if (minimized !== undefined) { updates.push("minimized = ?"); params.push(minimized ? 1 : 0); }
    if (last_accessed !== undefined) { updates.push("last_accessed = ?"); params.push(last_accessed); }
    
    if (updates.length > 0) {
      params.push(id);
      db.prepare(`UPDATE widgets SET ${updates.join(", ")} WHERE id = ?`).run(...params);
    }
    
    res.json({ success: true });
  });

  app.delete("/api/widgets/:id", (req, res) => {
    const { id } = req.params;
    db.prepare("DELETE FROM widgets WHERE id = ?").run(id);
    db.prepare("DELETE FROM widget_data WHERE widget_id = ?").run(id);
    res.json({ success: true });
  });

  app.post("/api/widgets/:id/data", (req, res) => {
    const { id } = req.params;
    const data = req.body;
    
    const stmt = db.prepare("INSERT OR REPLACE INTO widget_data (widget_id, key, value) VALUES (?, ?, ?)");
    const transaction = db.transaction((entries) => {
      for (const [key, value] of entries) {
        stmt.run(id, key, JSON.stringify(value));
      }
    });
    
    transaction(Object.entries(data));
    res.json({ success: true });
  });

  app.get("/api/widgets/:id/data", (req, res) => {
    const { id } = req.params;
    const rows = db.prepare("SELECT key, value FROM widget_data WHERE widget_id = ?").all(id) as {key: string, value: string}[];
    const data: Record<string, any> = {};
    for (const row of rows) {
      try {
        data[row.key] = JSON.parse(row.value);
      } catch (e) {
        data[row.key] = row.value;
      }
    }
    res.json(data);
  });

  app.get("/api/generate", async (req, res) => {
    const prompt = req.query.prompt as string;
    
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    
    if (!prompt) {
      res.end();
      return;
    }

    const systemInstruction = `You are a UI generator for a futuristic OS.
Generate a single self-contained HTML widget.

RULES:
- Maximum 60 lines total
- Glass style (semi-transparent light, like the app): background rgba(255,255,255,0.12), text rgba(0,0,0,0.75) or #374151
- backdrop-filter: blur(16px), -webkit-backdrop-filter: blur(16px)
- border: 1px solid rgba(255,255,255,0.2), border-radius: 16px, padding: 20px
- Font: system-ui. No external resources.
- Buttons/inputs: bg rgba(255,255,255,0.15), border rgba(255,255,255,0.15), hover slightly brighter
- For saving data: window.parent.postMessage({type:'save', widgetId:window.__CURRENT_WIDGET_ID__, data:{...}}, '*')
- For closing: window.parent.postMessage({type:'close', widgetId:window.__CURRENT_WIDGET_ID__}, '*')
- For loading initial data: use window.__WIDGET_INIT__ (object, available as soon as script runs)
- Output raw HTML only. No markdown. No explanation.`;

    try {
      const ollamaRes = await fetch(`${OLLAMA_BASE}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: OLLAMA_MODEL,
          messages: [
            { role: "system", content: systemInstruction },
            { role: "user", content: prompt },
          ],
          stream: true,
          options: { temperature: 0.2 },
        }),
      });

      if (!ollamaRes.ok || !ollamaRes.body) {
        throw new Error(ollamaRes.statusText || "Ollama request failed");
      }

      const reader = ollamaRes.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const chunk = JSON.parse(trimmed) as { message?: { content?: string }; done?: boolean };
            if (chunk.message?.content) {
              res.write(`data: ${JSON.stringify({ text: chunk.message.content })}\n\n`);
            }
          } catch {
            // skip malformed lines
          }
        }
      }
      // flush any remaining buffer
      if (buffer.trim()) {
        try {
          const chunk = JSON.parse(buffer.trim()) as { message?: { content?: string } };
          if (chunk.message?.content) {
            res.write(`data: ${JSON.stringify({ text: chunk.message.content })}\n\n`);
          }
        } catch {
          // skip
        }
      }

      res.write("data: [DONE]\n\n");
      res.end();
    } catch (error) {
      console.error("Generation error:", error);
      res.write(`data: ${JSON.stringify({ error: "Generation failed" })}\n\n`);
      res.end();
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static("dist"));
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
