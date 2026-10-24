from __future__ import annotations

from pathlib import Path

INGESTION = Path("src/transit_ops/silver/i3.py")


def _read_ingestion() -> str:
    return INGESTION.read_text(encoding="utf-8")


def test_ingestion_code_computes_content_hash_and_uses_on_conflict() -> None:
    text = _read_ingestion()

    assert "def compute_alert_content_hash(" in text
    for kw in (
        "alert_id",
        "alert_header_text",
        "description_text",
        "severity",
        "cause",
        "effect",
        "active_period_start_utc",
        "active_period_end_utc",
        "published_at_utc",
        "updated_at_utc",
    ):
        assert kw in text, f"compute_alert_content_hash signature missing {kw}"

    from transit_ops.silver.i3 import _HASH_FIELD_SEP

    assert _HASH_FIELD_SEP == chr(31)
    assert 'hashlib.md5(canonical.encode("utf-8")).hexdigest()' in text

    assert (
        "ON CONFLICT (provider_id, content_hash) "
        "WHERE content_hash IS NOT NULL AND valid_to IS NULL"
    ) in text
    assert "DO UPDATE SET last_seen_at = excluded.last_seen_at" in text

    assert '"content_hash": content_hash,' in text
