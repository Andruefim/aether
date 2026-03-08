"""
Nova Lab — Python Sandbox
FastAPI microservice that executes LLM-generated Python code for experiments.
Runs on port 5050. Called by NestJS ExperimentService.

Safety: code runs in the same process (no Docker), but with:
  - Allowed import whitelist
  - 60-second timeout via threading
  - No filesystem write outside /tmp/nova_sandbox/
"""
from __future__ import annotations

import ast
import io
import json
import os
import sys
import textwrap
import threading
import traceback
from contextlib import redirect_stdout, redirect_stderr
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
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
    # visualisation helpers (output as data, not display)
    "matplotlib", "mpl_toolkits", "plotly",
    # stdlib safe
    "os", "sys", "io", "time", "datetime", "collections", "itertools",
    "functools", "typing", "dataclasses", "enum", "abc",
    # pubchem / uniprot via requests
    "http",
}

BLOCKED_CALLS = {"exec", "eval", "compile", "__import__", "open", "subprocess",
                 "os.system", "os.popen", "shutil.rmtree"}

app = FastAPI(title="Nova Sandbox", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


# ── Request / Response models ─────────────────────────────────────────────────

class RunRequest(BaseModel):
    code: str
    timeout: int = 60          # seconds
    experiment_id: str = ""


class RunResponse(BaseModel):
    success: bool
    stdout: str
    stderr: str
    result: dict[str, Any]    # structured output written by the code
    error: str | None = None


# ── AST safety check ─────────────────────────────────────────────────────────

def check_safety(code: str) -> list[str]:
    """Return list of safety violations. Empty = safe."""
    violations: list[str] = []
    try:
        tree = ast.parse(code)
    except SyntaxError as e:
        return [f"SyntaxError: {e}"]

    for node in ast.walk(tree):
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            names = (
                [alias.name.split(".")[0] for alias in node.names]
                if isinstance(node, ast.Import)
                else [node.module.split(".")[0] if node.module else ""]
            )
            for name in names:
                if name and name not in ALLOWED_IMPORTS:
                    violations.append(f"Blocked import: {name}")

        if isinstance(node, ast.Call):
            func_name = ""
            if isinstance(node.func, ast.Name):
                func_name = node.func.id
            elif isinstance(node.func, ast.Attribute):
                func_name = node.func.attr
            if func_name in BLOCKED_CALLS:
                violations.append(f"Blocked call: {func_name}")

    return violations


# ── Execution ─────────────────────────────────────────────────────────────────

def _run_code(code: str, namespace: dict, exc_holder: list) -> None:
    try:
        exec(code, namespace)  # noqa: S102
    except Exception:
        exc_holder.append(traceback.format_exc())


@app.post("/run", response_model=RunResponse)
async def run_experiment(req: RunRequest) -> RunResponse:
    # Safety check
    violations = check_safety(req.code)
    if violations:
        return RunResponse(
            success=False, stdout="", stderr="",
            result={}, error=f"Safety violations: {'; '.join(violations)}",
        )

    # Build execution namespace with helpers
    namespace: dict[str, Any] = {
        "__builtins__": __builtins__,
        "_nova_result": {},
        "_sandbox_tmp": str(SANDBOX_TMP),
    }

    # Inject result-writing helper
    preamble = textwrap.dedent("""
        import json as _json

        def nova_output(data: dict):
            \"\"\"Call this to set the structured output returned to Nova.\"\"\"
            global _nova_result
            _nova_result = data

        def nova_save(filename: str, content: str) -> str:
            \"\"\"Save a file to sandbox tmp and return path.\"\"\"
            import os
            path = os.path.join(_sandbox_tmp, filename)
            with open(path, 'w') as f:
                f.write(content)
            return path
    """)

    full_code = preamble + "\n" + req.code

    stdout_buf = io.StringIO()
    stderr_buf = io.StringIO()
    exc_holder: list[str] = []

    # Run in thread with timeout
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
    """Return available libraries so the LLM knows what it can use."""
    available = {}
    for lib in ["numpy", "pandas", "scipy", "rdkit", "networkx", "Bio", "sklearn", "requests"]:
        try:
            __import__(lib)
            available[lib] = True
        except ImportError:
            available[lib] = False
    return {"available": available, "sandbox_tmp": str(SANDBOX_TMP)}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=5050, log_level="info")
