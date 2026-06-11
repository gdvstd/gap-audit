"""
Headless one-shot runner for local live verification of the SilentOps audit agent.

Loads ../../.env.local, then runs root_agent once with a directive to audit the
configured Phoenix project, streaming tool calls and the final summary to stdout.

Usage:
    cd agent-builder/adk && . .venv/bin/activate && python run_audit.py
"""
import asyncio
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path


def _load_env(path: Path) -> None:
    """Minimal .env loader (no external dep) — runs BEFORE importing agent.py so the
    MCP toolset args (PHOENIX_API_KEY, MONGODB_URI, ...) are populated at import time."""
    if not path.exists():
        print(f"[run_audit] WARNING: {path} not found", file=sys.stderr)
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        os.environ.setdefault(key.strip(), val.strip())


_load_env(Path(__file__).resolve().parents[2] / ".env.local")

# Import AFTER env load.
from google.adk.runners import InMemoryRunner  # noqa: E402
from google.genai import types  # noqa: E402
from agent import root_agent, PHOENIX_PROJECT, MONGODB_DATABASE  # noqa: E402

N_TRACES = int(os.environ.get("AUDIT_LIMIT", "5"))
PROMPT = (
    f"Audit the Phoenix project '{PHOENIX_PROJECT}' now. List its traces and audit AT MOST "
    f"{N_TRACES} of them — prioritise traces whose spans contain raw personal data (emails, "
    f"phone numbers, SSNs, card numbers, secrets) in memory writes, notes, or replies. For "
    f"each audited trace, get its spans and evaluate all five lenses. Prepare every finding "
    f"with the prepare_findings tool and insert the returned documents into MongoDB "
    f"(database='{MONGODB_DATABASE}', collection='findings') via insert-many. Finish with a "
    f"concise summary: traces audited, findings written, and the breakdown by lens and severity."
)


# Collected for the demo transcript artifact.
TRANSCRIPT: list = []


def _record(kind: str, author: str, **fields) -> None:
    TRANSCRIPT.append({"ts": datetime.now(timezone.utc).isoformat(), "kind": kind, "author": author, **fields})


def _print_event(event) -> None:
    author = getattr(event, "author", "?")
    content = getattr(event, "content", None)
    parts = getattr(content, "parts", None) or []
    for part in parts:
        fc = getattr(part, "function_call", None)
        fr = getattr(part, "function_response", None)
        text = getattr(part, "text", None)
        if fc is not None:
            args = getattr(fc, "args", {}) or {}
            keys = ", ".join(list(args.keys())) if isinstance(args, dict) else ""
            print(f"  🔧 [{author}] call {fc.name}({keys})")
            _record("tool_call", author, tool=fc.name, args=args if isinstance(args, dict) else str(args))
        elif fr is not None:
            resp = getattr(fr, "response", "")
            snippet = str(resp)
            if len(snippet) > 220:
                snippet = snippet[:217] + "..."
            print(f"  ↩️  [{author}] {fr.name} -> {snippet}")
            _record("tool_response", author, tool=fr.name, response=str(resp))
        elif text and text.strip():
            print(f"  💬 [{author}] {text.strip()}")
            _record("message", author, text=text.strip())


def _write_transcript() -> Path:
    out_dir = Path(__file__).resolve().parent / "transcripts"
    out_dir.mkdir(exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    (out_dir / f"audit-{stamp}.json").write_text(json.dumps(TRANSCRIPT, indent=2, ensure_ascii=False))

    lines = [
        f"# SilentOps audit run — {stamp}",
        "",
        f"Project: `{PHOENIX_PROJECT}` → MongoDB `{MONGODB_DATABASE}.findings`",
        f"Model: `{root_agent.model}`  ·  Partner MCP: Arize Phoenix + MongoDB",
        "",
        "| # | step | detail |",
        "|---|------|--------|",
    ]
    for i, r in enumerate(TRANSCRIPT, 1):
        if r["kind"] == "tool_call":
            keys = ", ".join((r.get("args") or {}).keys()) if isinstance(r.get("args"), dict) else ""
            detail = f"call `{r['tool']}`({keys})"
        elif r["kind"] == "tool_response":
            resp = r["response"].replace("\n", " ")
            detail = f"↩ `{r['tool']}` → {resp[:160]}"
        else:
            detail = "💬 " + r["text"].replace("\n", " ")[:200]
        lines.append(f"| {i} | {r['kind']} | {detail} |")
    md = out_dir / f"audit-{stamp}.md"
    md.write_text("\n".join(lines) + "\n")
    return md


async def main() -> None:
    print(f"[run_audit] auditing project '{PHOENIX_PROJECT}' -> MongoDB '{MONGODB_DATABASE}'.findings\n")
    runner = InMemoryRunner(agent=root_agent, app_name="silentops")
    user_id, session_id = "verify", "s1"
    await runner.session_service.create_session(
        app_name="silentops", user_id=user_id, session_id=session_id
    )
    message = types.Content(role="user", parts=[types.Part(text=PROMPT)])

    n = 0
    async for event in runner.run_async(
        user_id=user_id, session_id=session_id, new_message=message
    ):
        n += 1
        _print_event(event)
        if n > 400:
            print("\n[run_audit] event cap reached — stopping.")
            break

    path = _write_transcript()
    print(f"\n[run_audit] done. transcript -> {path}")


def _print_exc_tree(exc, depth=0):
    pad = "  " * depth
    print(f"{pad}{type(exc).__name__}: {exc}", file=sys.stderr)
    subs = getattr(exc, "exceptions", None)
    if subs:
        for s in subs:
            _print_exc_tree(s, depth + 1)
    cause = getattr(exc, "__cause__", None)
    if cause is not None and cause is not exc:
        print(f"{pad}caused by:", file=sys.stderr)
        _print_exc_tree(cause, depth + 1)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except BaseException as e:  # noqa: BLE001
        print("\n[run_audit] FAILED — exception tree:", file=sys.stderr)
        _print_exc_tree(e)
        sys.exit(1)
