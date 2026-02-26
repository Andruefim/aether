/**
 * Model names for Aether mode.
 * Override via env vars if needed.
 */
export const ORCHESTRATOR_MODEL = process.env.AETHER_ORCHESTRATOR_MODEL ?? 'openbmb/minicpm-o4.5:8b';
export const CODER_MODEL = process.env.AETHER_CODER_MODEL ?? 'qwen3-coder:30b';

/**
 * Voice service base URL (Python FastAPI).
 */
export const VOICE_SERVICE_URL = process.env.VOICE_SERVICE_URL ?? 'http://localhost:8001';

/**
 * System prompt for MiniCPM-o4.5 orchestrator.
 * It receives a screenshot of the current UI + user text + conversation history.
 * Returns JSON with routing decision.
 */
export const ORCHESTRATOR_SYSTEM_PROMPT = `You are an interface orchestrator for an AI-powered OS called Aether.

You receive:
1. A screenshot of the current user interface
2. The user's request
3. Recent conversation history

Your job is to classify the request and decide what action to take.

Respond ONLY with a valid JSON object (no markdown, no explanation):
{
  "action": "generate_ui" | "dialogue" | "tool",
  "instruction": "<specific instruction>",
  "response": "<optional direct answer if action=dialogue>"
}

Action rules:
- "generate_ui": user wants to CREATE, MODIFY, ADD, REMOVE, CHANGE anything visual in the interface
  Examples: "make the button red", "add a timer", "create a weather widget", "remove the sidebar"
- "dialogue": user ASKS A QUESTION about the interface, wants INFORMATION, or requests EXPLANATION
  Examples: "what does this button do?", "how many items are in the list?", "explain this chart"
- "tool": user needs CURRENT EXTERNAL DATA (news, weather, prices, search)
  Examples: "show me today's weather", "search for latest AI news", "get Bitcoin price"

For instruction:
- generate_ui: write a precise technical instruction for the HTML coder
- dialogue: write the user's question clearly
- tool: specify the tool call needed

Respond in the same language as the user.
Keep instruction concise and specific.`;

/**
 * System prompt for qwen3-coder HTML generator.
 * Receives current HTML + instruction from orchestrator.
 */
export const CODER_SYSTEM_PROMPT = `You are an HTML interface generator for a futuristic AI-powered OS.

You receive:
1. The current full HTML of the interface (between <CURRENT_HTML> tags)
2. A specific instruction for what to change

STRICT RULES:
- Return ONLY the complete updated HTML document. Nothing else. No markdown. No explanation.
- Change ONLY what is specified in the instruction. Preserve everything else exactly.
- Preserve all id attributes, data-* attributes, and event handlers.
- Inline all styles and scripts. No external CSS or JS dependencies (except CDNs if absolutely needed).
- The interface must be FULL SCREEN: body { width: 100vw; height: 100vh; overflow: hidden; }

DESIGN SYSTEM (mandatory):
- Background: transparent (the OS handles background)
- Glass panels: background rgba(255,255,255,0.08); backdrop-filter blur(20px); border 1px solid rgba(255,255,255,0.15); border-radius 16px
- Text: rgba(255,255,255,0.9) primary, rgba(255,255,255,0.5) secondary
- Accent color: #ede6da (warm beige) for highlights
- Buttons: background rgba(255,255,255,0.12); hover rgba(255,255,255,0.2); border rgba(255,255,255,0.2)
- Font: system-ui, -apple-system, sans-serif
- Inputs: background rgba(255,255,255,0.08); border rgba(255,255,255,0.2); color white
- Scrollbars: thin, rgba(255,255,255,0.2)
- Never use dark backgrounds for elements (no #000, no rgba with low alpha on dark)
- Animations: subtle, 200-400ms, ease transitions

BOTTOM SAFE ZONE: Always leave 80px at the bottom for the Aether input bar.
Never place content below calc(100vh - 80px).`;

/**
 * Default initial Aether interface shown when mode is first opened.
 */
export const INITIAL_AETHER_HTML = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  width: 100vw; height: 100vh;
  overflow: hidden;
  background: transparent;
  display: flex; align-items: center; justify-content: center;
  font-family: system-ui, -apple-system, sans-serif;
  color: rgba(255,255,255,0.9);
}
.container {
  text-align: center;
  display: flex; flex-direction: column; gap: 20px; align-items: center;
}
.title {
  font-size: 52px;
  font-weight: 100;
  letter-spacing: 0.25em;
  color: rgba(237,230,218,0.7);
  text-transform: uppercase;
}
.subtitle {
  font-size: 15px;
  color: rgba(255,255,255,0.3);
  font-weight: 300;
  letter-spacing: 0.1em;
}
.hint {
  margin-top: 8px;
  font-size: 12px;
  color: rgba(255,255,255,0.18);
  letter-spacing: 0.05em;
}
.orb {
  width: 80px; height: 80px;
  border-radius: 50%;
  background: radial-gradient(circle at 35% 35%, rgba(237,230,218,0.25), rgba(180,160,200,0.08));
  border: 1px solid rgba(237,230,218,0.15);
  animation: pulse 4s ease-in-out infinite;
  backdrop-filter: blur(8px);
}
@keyframes pulse {
  0%, 100% { transform: scale(1); opacity: 0.6; }
  50% { transform: scale(1.06); opacity: 1; }
}
</style>
</head>
<body>
<div class="container">
  <div class="orb"></div>
  <div class="title">Aether</div>
  <div class="subtitle">AI Interface</div>
  <div class="hint">Type or speak to build your interface</div>
</div>
</body>
</html>`;
