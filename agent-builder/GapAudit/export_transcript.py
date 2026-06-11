"""
Export the recorded `adk web` session (.adk/session.db) into a demo transcript
artifact (markdown + JSON) under transcripts/. Captures the exact recorded run.

Usage:  python export_transcript.py
"""
import json
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
DB = HERE / ".adk" / "session.db"


def _parts(event_data: dict):
    content = event_data.get("content") or {}
    return content.get("parts") or [], event_data.get("author", "?")


def main() -> None:
    if not DB.exists():
        print(f"no session db at {DB}", file=sys.stderr)
        sys.exit(1)
    con = sqlite3.connect(str(DB))
    rows = con.execute(
        "select event_data, timestamp from events order by timestamp asc"
    ).fetchall()
    con.close()

    records = []
    for raw, ts in rows:
        data = json.loads(raw)
        parts, author = _parts(data)
        for part in parts:
            if part.get("function_call"):
                fc = part["function_call"]
                records.append({"kind": "tool_call", "author": author, "tool": fc.get("name"), "args": fc.get("args", {})})
            elif part.get("function_response"):
                fr = part["function_response"]
                records.append({"kind": "tool_response", "author": author, "tool": fr.get("name"), "response": fr.get("response")})
            elif part.get("text", "").strip():
                records.append({"kind": "message", "author": author, "text": part["text"].strip()})

    out_dir = HERE / "transcripts"
    out_dir.mkdir(exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    (out_dir / f"audit-{stamp}.json").write_text(json.dumps(records, indent=2, ensure_ascii=False))

    lines = [
        f"# GapAudit — recorded ADK web audit run ({stamp})",
        "",
        "Single Google ADK (Agent Builder) agent · Gemini · Arize Phoenix MCP + MongoDB MCP.",
        "Pulls traces from Phoenix, judges the SilentOps lenses, writes findings to MongoDB.",
        "",
        "| # | step | detail |",
        "|---|------|--------|",
    ]
    for i, r in enumerate(records, 1):
        if r["kind"] == "tool_call":
            keys = ", ".join((r.get("args") or {}).keys()) if isinstance(r.get("args"), dict) else ""
            detail = f"call `{r['tool']}`({keys})"
        elif r["kind"] == "tool_response":
            resp = str(r.get("response")).replace("\n", " ")
            detail = f"↩ `{r['tool']}` → {resp[:220]}"
        else:
            detail = "💬 " + r["text"].replace("\n", " ")[:300]
        lines.append(f"| {i} | {r['kind']} | {detail} |")
    md = out_dir / f"audit-{stamp}.md"
    md.write_text("\n".join(lines) + "\n")
    print(f"wrote {md}")
    print(f"wrote {out_dir / f'audit-{stamp}.json'}")
    print(f"\n{len(records)} transcript records from {len(rows)} events")


if __name__ == "__main__":
    main()
