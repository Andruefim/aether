const { spawn } = require('child_process');
const path = require('path');

const root = path.resolve(__dirname, '..');
const cwd = path.join(root, 'voice-service');
const isWin = process.platform === 'win32';
const venvDir = path.join(cwd, '.venv');
const uvicorn = path.join(venvDir, isWin ? 'Scripts' : 'bin', isWin ? 'uvicorn.exe' : 'uvicorn');

const child = spawn(uvicorn, ['main:app', '--host', '0.0.0.0', '--port', '8001', '--reload'], {
  cwd,
  stdio: 'inherit',
  shell: false,
});

child.on('error', (err) => {
  console.error('Failed to start voice service:', err.message);
  if (err.code === 'ENOENT') {
    console.error('Ensure voice-service has a .venv with uvicorn (e.g. python -m venv .venv && .venv/Scripts/pip install -r requirements.txt)');
  }
  process.exit(1);
});
child.on('exit', (code) => process.exit(code ?? 0));
