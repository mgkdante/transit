"""Unit tests for tools/claude_log_hook.py pure helper functions."""

from __future__ import annotations

import json
import sys
from pathlib import Path

# tools/ is not an installed package, so add it to the path.
sys.path.insert(0, str(Path(__file__).parent.parent / "tools"))

from claude_log_hook import (  # noqa: E402
    extract_latest_assistant_text,
    next_slice_number,
    response_already_written,
    sanitize_label,
)


# ---------------------------------------------------------------------------
# sanitize_label
# ---------------------------------------------------------------------------


def test_sanitize_label_basic() -> None:
    assert sanitize_label("transit hot cold") == "transit-hot-cold"


def test_sanitize_label_special_chars() -> None:
    # Special chars stripped; spaces become hyphens.
    assert sanitize_label("my/session: 2024!") == "my-session-2024"


def test_sanitize_label_consecutive_separators() -> None:
    assert sanitize_label("foo--bar__baz") == "foo-bar-baz"


def test_sanitize_label_leading_trailing_stripped() -> None:
    assert sanitize_label("---my-label---") == "my-label"


def test_sanitize_label_truncation() -> None:
    long_raw = "a" * 100
    result = sanitize_label(long_raw)
    assert len(result) == 80


def test_sanitize_label_empty_returns_fallback() -> None:
    assert sanitize_label("") == "session"


def test_sanitize_label_only_special_chars_returns_fallback() -> None:
    assert sanitize_label("!!!###") == "session"


def test_sanitize_label_underscores_preserved() -> None:
    assert sanitize_label("my_session_label") == "my_session_label"


# ---------------------------------------------------------------------------
# next_slice_number
# ---------------------------------------------------------------------------


def test_next_slice_first_call(tmp_path: Path) -> None:
    meta_path = tmp_path / ".session_meta.json"
    n, meta = next_slice_number(meta_path)
    assert n == 1
    assert meta["slice"] == 1


def test_next_slice_increments(tmp_path: Path) -> None:
    meta_path = tmp_path / ".session_meta.json"
    meta_path.write_text(json.dumps({"slice": 3}), encoding="utf-8")
    n, meta = next_slice_number(meta_path)
    assert n == 4
    assert meta["slice"] == 4


def test_next_slice_corrupted_meta_resets(tmp_path: Path) -> None:
    meta_path = tmp_path / ".session_meta.json"
    meta_path.write_text("not valid json {{", encoding="utf-8")
    n, meta = next_slice_number(meta_path)
    assert n == 1


# ---------------------------------------------------------------------------
# extract_latest_assistant_text
# ---------------------------------------------------------------------------


def _write_jsonl(path: Path, lines: list[dict]) -> None:
    path.write_text("\n".join(json.dumps(line) for line in lines), encoding="utf-8")


def test_extract_latest_string_content(tmp_path: Path) -> None:
    transcript = tmp_path / "transcript.jsonl"
    _write_jsonl(transcript, [
        {"role": "user", "content": "hello"},
        {"role": "assistant", "content": "world"},
    ])
    result = extract_latest_assistant_text(str(transcript))
    assert result == "world"


def test_extract_latest_list_content(tmp_path: Path) -> None:
    transcript = tmp_path / "transcript.jsonl"
    _write_jsonl(transcript, [
        {"role": "user", "content": "hello"},
        {"role": "assistant", "content": [{"type": "text", "text": "from list"}]},
    ])
    result = extract_latest_assistant_text(str(transcript))
    assert result == "from list"


def test_extract_latest_returns_last_message(tmp_path: Path) -> None:
    transcript = tmp_path / "transcript.jsonl"
    _write_jsonl(transcript, [
        {"role": "assistant", "content": "first"},
        {"role": "user", "content": "ok"},
        {"role": "assistant", "content": "second"},
    ])
    result = extract_latest_assistant_text(str(transcript))
    assert result == "second"


def test_extract_latest_skips_malformed_lines(tmp_path: Path) -> None:
    transcript = tmp_path / "transcript.jsonl"
    transcript.write_text(
        'not json\n{"role": "assistant", "content": "good line"}\n{broken',
        encoding="utf-8",
    )
    result = extract_latest_assistant_text(str(transcript))
    assert result == "good line"


def test_extract_latest_message_envelope(tmp_path: Path) -> None:
    # Claude Code wraps messages in a {"message": {...}} envelope.
    transcript = tmp_path / "transcript.jsonl"
    _write_jsonl(transcript, [
        {"message": {"role": "user", "content": "hi"}},
        {"message": {"role": "assistant", "content": "enveloped"}},
    ])
    result = extract_latest_assistant_text(str(transcript))
    assert result == "enveloped"


def test_extract_latest_no_assistant_returns_none(tmp_path: Path) -> None:
    transcript = tmp_path / "transcript.jsonl"
    _write_jsonl(transcript, [
        {"role": "user", "content": "hello"},
    ])
    result = extract_latest_assistant_text(str(transcript))
    assert result is None


def test_extract_latest_missing_file_returns_none(tmp_path: Path) -> None:
    result = extract_latest_assistant_text(str(tmp_path / "nonexistent.jsonl"))
    assert result is None


# ---------------------------------------------------------------------------
# response_already_written
# ---------------------------------------------------------------------------


def test_response_already_written_true(tmp_path: Path) -> None:
    slice_path = tmp_path / "slice01.md"
    slice_path.write_text("# Slice 01\n\n## Response\n\nsome text\n", encoding="utf-8")
    assert response_already_written(slice_path) is True


def test_response_already_written_false(tmp_path: Path) -> None:
    slice_path = tmp_path / "slice01.md"
    slice_path.write_text("# Slice 01\n\n## Prompt\n\nsome prompt\n", encoding="utf-8")
    assert response_already_written(slice_path) is False


def test_response_already_written_missing_file(tmp_path: Path) -> None:
    slice_path = tmp_path / "nonexistent.md"
    assert response_already_written(slice_path) is False
