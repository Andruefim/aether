/** Default HTML shown when Aether mode is first opened (welcome screen; not sent to API) */
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
  height: 100vh;
  justify-content: center;
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

/** Minimal HTML sent to API and shown after first request (no welcome content) */
export const MINIMAL_AETHER_HTML = `<!DOCTYPE html>
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
  height: 100vh;
  justify-content: center;
}
</style>
</head>
<body>
<div class="container"></div>
</body>
</html>`;
