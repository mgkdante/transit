"""
Claude Code session logger — called by UserPromptSubmit and Stop hooks.

Usage (configured in .claude/settings.local.json):
    python tools/claude_log_hook.py prompt   # called on UserPromptSubmit
    python tools/claude_log_hook.py stop     # called on Stop

Hook stdin: JSON object from Claude Code.
Environment variables:
    CLAUDE_SESSION_LABEL  — human-readable session name (set by start-claude.ps1)
    CLAUDE_LOG_ROOT       — override log root dir (default: C:\\Users\\otalo\\Freelance\\project-logs)
"""

from __future__ import annotations

import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

DEFAULT_LOG_ROOT = r"C:\Users\otalo\Freelance\project-logs"
META_FILENAME = ".session_meta.json"
RESPONSE_SENTINEL = "## Response"


# ---------------------------------------------------------------------------
# Pure helpers (importable by tests)
# ---------------------------------------------------------------------------


def sanitize_label(raw: str) -> str:
    """Return a filesystem-safe folder name derived from *raw*.

    Rules:
    - Spaces become hyphens.
    - Only alphanumerics, hyphens, and underscores are kept.
    - Consecutive hyphens/underscores are collapsed to one hyphen.
    - Leading/trailing hyphens and underscores are stripped.
    - Result is truncated to 80 characters.
    - If the result is empty, returns "session".
    """
    label = raw.strip()
    # Convert common word-separators to hyphens before stripping everything else.
    label = re.sub(r"[ /\\:.|]", "-", label)
    label = re.sub(r"[^A-Za-z0-9_-]", "", label)
    label = re.sub(r"[-_]{2,}", "-", label)
    label = label.strip("-_")
    label = label[:80]
    return label if label else "session"


def next_slice_number(meta_path: Path) -> tuple[int, dict]:
    """Load .session_meta.json and return (next_slice_n, updated_meta_dict).

    The meta file is NOT written here — caller is responsible for saving it
    after the slice file is created successfully.
    """
    meta: dict = {}
    if meta_path.exists():
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
        except Exception:
            meta = {}
    n = int(meta.get("slice", 0)) + 1
    meta["slice"] = n
    return n, meta


def extract_latest_assistant_text(transcript_path: str) -> str | None:
    """Parse a Claude Code JSONL transcript and return the last assistant message text.

    Each line of the transcript is a JSON object. Handles two known content formats:
      - content: "plain string"
      - content: [{"type": "text", "text": "..."}]

    Malformed lines are silently skipped.
    Returns None if no assistant message is found.
    """
    path = Path(transcript_path)
    if not path.exists():
        return None

    last_text: str | None = None

    try:
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    except Exception:
        return None

    for line in lines:
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue

        # The transcript may wrap messages inside a {"message": {...}} envelope.
        msg = obj.get("message", obj)
        role = msg.get("role", "")
        if role != "assistant":
            continue

        content = msg.get("content", "")
        if isinstance(content, str):
            last_text = content
        elif isinstance(content, list):
            parts: list[str] = []
            for block in content:
                if isinstance(block, dict) and block.get("type") == "text":
                    text = block.get("text", "")
                    if text:
                        parts.append(text)
            if parts:
                last_text = "\n".join(parts)

    return last_text


def response_already_written(slice_path: Path) -> bool:
    """Return True if *slice_path* already contains the response sentinel.

    Prevents duplicate appends when Stop fires more than once for the same turn.
    """
    if not slice_path.exists():
        return False
    try:
        return RESPONSE_SENTINEL in slice_path.read_text(encoding="utf-8")
    except Exception:
        return False


# ---------------------------------------------------------------------------
# Session resolution
# ---------------------------------------------------------------------------


def _log_root() -> Path:
    return Path(os.environ.get("CLAUDE_LOG_ROOT", DEFAULT_LOG_ROOT))


def _session_label(session_id: str, cwd: str) -> str:
    raw = os.environ.get("CLAUDE_SESSION_LABEL", "").strip()
    if raw:
        return sanitize_label(raw)
    project_name = Path(cwd).name if cwd else "project"
    short_id = session_id[:8] if session_id else "unknown"
    return sanitize_label(f"{project_name}-{short_id}")


def _session_dir(session_id: str, cwd: str) -> Path:
    return _log_root() / _session_label(session_id, cwd)


def _slice_path(session_dir: Path, n: int) -> Path:
    return session_dir / f"slice{n:02d}.md"


# ---------------------------------------------------------------------------
# Handlers
# ---------------------------------------------------------------------------


def handle_prompt(payload: dict) -> None:
    session_id: str = payload.get("session_id", "")
    cwd: str = payload.get("cwd", "")
    prompt_text: str = payload.get("prompt", "")

    session_dir = _session_dir(session_id, cwd)
    session_dir.mkdir(parents=True, exist_ok=True)

    meta_path = session_dir / META_FILENAME
    n, meta = next_slice_number(meta_path)
    slice_path = _slice_path(session_dir, n)

    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    label = _session_label(session_id, cwd)

    content = f"""\
# Slice {n:02d}

**Session:** {label}
**Session ID:** {session_id}
**Timestamp:** {timestamp}
**CWD:** {cwd}

## Prompt

```text
{prompt_text}
```
"""

    slice_path.write_text(content, encoding="utf-8")
    meta_path.write_text(json.dumps(meta, indent=2), encoding="utf-8")


def handle_stop(payload: dict) -> None:
    session_id: str = payload.get("session_id", "")
    cwd: str = payload.get("cwd", "")
    transcript_path: str = payload.get("transcript_path", "")

    session_dir = _session_dir(session_id, cwd)
    meta_path = session_dir / META_FILENAME

    if not meta_path.exists():
        # No prompt was logged for this session yet; nothing to append to.
        return

    try:
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
    except Exception:
        return

    n = int(meta.get("slice", 0))
    if n == 0:
        return

    slice_path = _slice_path(session_dir, n)

    if response_already_written(slice_path):
        return

    text = extract_latest_assistant_text(transcript_path)
    if text is None:
        return

    addition = f"\n{RESPONSE_SENTINEL}\n\n{text}\n"
    with slice_path.open("a", encoding="utf-8") as fh:
        fh.write(addition)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def main() -> None:
    if len(sys.argv) < 2 or sys.argv[1] not in ("prompt", "stop"):
        sys.exit(0)

    mode = sys.argv[1]

    try:
        raw = sys.stdin.read()
        payload = json.loads(raw) if raw.strip() else {}
    except Exception:
        payload = {}

    try:
        if mode == "prompt":
            handle_prompt(payload)
        else:
            handle_stop(payload)
    except Exception:
        # Fail soft — never crash Claude Code.
        pass


if __name__ == "__main__":
    main()
