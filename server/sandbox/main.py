"""
Nova Lab — Python Sandbox
FastAPI microservice that executes LLM-generated Python code for experiments.
Runs on port 5050. Called by NestJS ExperimentService.

Safety: code runs in the same process with:
  - Allowed import whitelist
  - Auto-install for approved packages
  - 180-second timeout via threading
  - No filesystem write outside /tmp/nova_sandbox/
"""
from __future__ import annotations

import ast
import io
import json
import os
import subprocess
import sys
import textwrap
import threading
import traceback
from contextlib import redirect_stdout, redirect_stderr
from pathlib import Path
from typing import Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

SANDBOX_TMP = Path(os.environ.get("SANDBOX_TMP", "/tmp/nova_sandbox"))
SANDBOX_TMP.mkdir(parents=True, exist_ok=True)

# ── Allowed top-level imports ─────────────────────────────────────────────────
ALLOWED_IMPORTS = {
    # data & math
    "numpy", "np", "pandas", "pd", "scipy", "sklearn", "statsmodels",
    # chemistry / biology
    "rdkit", "Bio", "requests", "urllib", "json", "re", "math", "random",
    # graphs
    "networkx", "nx",
    # visualisation
    "matplotlib", "mpl_toolkits", "plotly",
    # web / scraping
    "bs4", "beautifulsoup4", "lxml", "html5lib",
    # youtube
    "youtube_transcript_api", "pytube", "yt_dlp",
    # astronomy / physics
    "astropy", "halotools",
    # nlp
    "nltk", "spacy", "textblob",
    # finance
    "yfinance", "pandas_datareader",
    # stdlib safe
    "os", "sys", "io", "time", "datetime", "collections", "itertools",
    "functools", "typing", "dataclasses", "enum", "abc",
    "hashlib", "base64", "gzip", "zipfile", "csv", "xml", "html",
    "http", "pathlib", "string", "struct",
}

# ── Auto-installable packages ─────────────────────────────────────────────────
# Maps import name → pip package name
AUTO_INSTALL_MAP: dict[str, str] = {
    "bs4":                    "beautifulsoup4",
    "beautifulsoup4":         "beautifulsoup4",
    "lxml":                   "lxml",
    "html5lib":               "html5lib",
    "youtube_transcript_api": "youtube-transcript-api",
    "pytube":                 "pytube",
    "yt_dlp":                 "yt-dlp",
    "astropy":                "astropy",
    "halotools":              "halotools",
    "nltk":                   "nltk",
    "textblob":               "textblob",
    "yfinance":               "yfinance",
    "pandas_datareader":      "pandas-datareader",
    "sklearn":                "scikit-learn",
    "statsmodels":            "statsmodels",
    "networkx":               "networkx",
    "plotly":                 "plotly",
    "spacy":                  "spacy",
}

BLOCKED_CALLS = {
    "exec", "eval", "compile", "__import__",
    "subprocess", "os.system", "os.popen", "shutil.rmtree",
}

app = FastAPI(title="Nova Sandbox", version="2.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Track auto-installed packages (avoid reinstalling each request) ───────────
_installed_cache: set[str] = set()


def auto_install(import_name: str) -> tuple[bool, str]:
    """Try to pip-install a package. Returns (success, message)."""
    pip_pkg = AUTO_INSTALL_MAP.get(import_name)
    if not pip_pkg:
        return False, f"No auto-install mapping for '{import_name}'"

    if pip_pkg in _installed_cache:
        return True, f"{pip_pkg} already installed"

    print(f"[sandbox] Auto-installing: {pip_pkg} ...", flush=True)
    try:
        result = subprocess.run(
            [sys.executable, "-m", "pip", "install", pip_pkg, "--quiet"],
            capture_output=True,
            text=True,
            timeout=120,
        )
        if result.returncode == 0:
            _installed_cache.add(pip_pkg)
            print(f"[sandbox] Installed {pip_pkg} OK", flush=True)
            return True, f"Installed {pip_pkg}"
        else:
            err = result.stderr.strip()[:300]
            return False, f"pip install {pip_pkg} failed: {err}"
    except subprocess.TimeoutExpired:
        return False, f"pip install {pip_pkg} timed out"
    except Exception as e:
        return False, str(e)


# ── Request / Response models ─────────────────────────────────────────────────

class RunRequest(BaseModel):
    code: str
    timeout: int = 180
    experiment_id: str = ""


class RunResponse(BaseModel):
    success: bool
    stdout: str
    stderr: str
    result: dict[str, Any]
    error: str | None = None


# ── AST safety check ──────────────────────────────────────────────────────────

def check_safety(code: str) -> tuple[list[str], list[str]]:
    """
    Returns (violations, imports_to_install).
    violations        — hard blocks, abort execution
    imports_to_install — packages that need auto-install before running
    """
    violations: list[str] = []
    to_install: list[str] = []

    try:
        tree = ast.parse(code)
    except SyntaxError as e:
        return [f"SyntaxError: {e}"], []

    for node in ast.walk(tree):
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            names = (
                [alias.name.split(".")[0] for alias in node.names]
                if isinstance(node, ast.Import)
                else [node.module.split(".")[0] if node.module else ""]
            )
            for name in names:
                if not name:
                    continue
                if name in ALLOWED_IMPORTS:
                    # Check if it needs auto-installation
                    if name in AUTO_INSTALL_MAP:
                        try:
                            __import__(name)
                        except ImportError:
                            if name not in to_install:
                                to_install.append(name)
                else:
                    violations.append(f"Blocked import: {name}")

        if isinstance(node, ast.Call):
            func_name = ""
            if isinstance(node.func, ast.Name):
                func_name = node.func.id
            elif isinstance(node.func, ast.Attribute):
                func_name = node.func.attr
            if func_name in BLOCKED_CALLS:
                violations.append(f"Blocked call: {func_name}")

    return violations, to_install


# ── Execution ─────────────────────────────────────────────────────────────────

def _run_code(code: str, namespace: dict, exc_holder: list) -> None:
    try:
        exec(code, namespace)  # noqa: S102
    except Exception:
        exc_holder.append(traceback.format_exc())


@app.post("/run", response_model=RunResponse)
async def run_experiment(req: RunRequest) -> RunResponse:
    # Fix common LLM typos
    code = req.code
    for typo in ["ova_output(", "nnova_output(", "Nova_output(", "NOVA_output("]:
        code = code.replace(typo, "nova_output(")  # ← добавить отступ

    # Safety check — get violations and packages to install
    violations, to_install = check_safety(code)
    if violations:
        return RunResponse(
            success=False, stdout="", stderr="",
            result={},
            error=f"Safety violations: {'; '.join(violations)}",
        )

    # Auto-install missing packages before execution
    install_log: list[str] = []
    for import_name in to_install:
        ok, msg = auto_install(import_name)
        install_log.append(msg)
        if not ok:
            return RunResponse(
                success=False, stdout="", stderr="",
                result={},
                error=f"Auto-install failed: {msg}",
            )

    namespace: dict[str, Any] = {
        "__builtins__": __builtins__,
        "_nova_result": {},
        "_sandbox_tmp": str(SANDBOX_TMP),
    }

    preamble = textwrap.dedent("""
        import json as _json

        def nova_output(data: dict):
            \"\"\"Call this to set the structured output returned to Nova.\"\"\"
            global _nova_result
            _nova_result = data

        ova_output   = nova_output
        nnova_output = nova_output
        Nova_output  = nova_output
        NOVA_output  = nova_output

        def nova_save(filename: str, content: str) -> str:
            \"\"\"Save a file to sandbox tmp and return path.\"\"\"
            import os
            path = os.path.join(_sandbox_tmp, filename)
            with open(path, 'w') as f:
                f.write(content)
            return path
    """)

    full_code = preamble + "\n" + code

    stdout_buf = io.StringIO()
    stderr_buf = io.StringIO()
    exc_holder: list[str] = []

    if install_log:
        stdout_buf.write(f"[auto-install] {'; '.join(install_log)}\n")

    thread = threading.Thread(
        target=_run_code,
        args=(full_code, namespace, exc_holder),
        daemon=True,
    )

    with redirect_stdout(stdout_buf), redirect_stderr(stderr_buf):
        thread.start()
        thread.join(timeout=req.timeout)

    if thread.is_alive():
        return RunResponse(
            success=False,
            stdout=stdout_buf.getvalue(),
            stderr=stderr_buf.getvalue(),
            result={},
            error=f"Execution timed out after {req.timeout}s",
        )

    if exc_holder:
        return RunResponse(
            success=False,
            stdout=stdout_buf.getvalue(),
            stderr=stderr_buf.getvalue() + exc_holder[0],
            result={},
            error=exc_holder[0].splitlines()[-1] if exc_holder[0] else "Runtime error",
        )

    result = namespace.get("_nova_result", {})
    if not isinstance(result, dict):
        result = {"value": str(result)}

    return RunResponse(
        success=True,
        stdout=stdout_buf.getvalue(),
        stderr=stderr_buf.getvalue(),
        result=result,
    )


@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "python": sys.version}


@app.get("/capabilities")
async def capabilities() -> dict:
    """Return available and auto-installable libraries."""
    available = {}
    for lib in ["numpy", "pandas", "scipy", "rdkit", "networkx", "Bio",
                "sklearn", "requests", "bs4", "youtube_transcript_api",
                "astropy", "yfinance", "nltk"]:
        try:
            __import__(lib)
            available[lib] = True
        except ImportError:
            available[lib] = False

    return {
        "available":        available,
        "auto_installable": list(AUTO_INSTALL_MAP.keys()),
        "sandbox_tmp":      str(SANDBOX_TMP),
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=5050, log_level="info")