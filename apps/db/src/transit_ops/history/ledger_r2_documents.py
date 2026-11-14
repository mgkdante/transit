"""Write-ahead window documents; immutable events arbitrate competing writers."""

import json
import re
from dataclasses import asdict, dataclass
from datetime import UTC, date, datetime
from typing import Any

from pydantic import TypeAdapter

from transit_ops.control.objects import key_part
from transit_ops.history import datasets, ledger

type Identity = tuple[str, str, int, str]


class LedgerDocumentInvalid(ValueError):
    """A stored document cannot be trusted."""


@dataclass(frozen=True)
class WindowDocument(ledger.WindowState):
    seq: int
    copies: tuple[ledger.ArchiveCopy, ...]


@dataclass(frozen=True)
class EventRecord:
    kind: ledger.EventKind
    content_version: int | None
    actor: str
    reason: str | None
    details: dict[str, object]


def _identity(doc: ledger.WindowState | ledger.ArchiveCopy) -> Identity:
    return doc.dataset_id, doc.provider_id, doc.revision, doc.window_key


def _path(identity: Identity) -> str:
    dataset, provider, revision, window = map(lambda v: key_part(str(v)), identity)
    return f"{dataset}/{provider}/r{revision}/{window}"


def window_key(identity: Identity) -> str:
    return f"windows/{_path(identity)}.json"


def transition_key(identity: Identity, seq: int) -> str:
    return f"transitions/{_path(identity)}/{seq:010d}.json"


def _json(value: Any) -> Any:
    if isinstance(value, datetime):
        if value.utcoffset() is None:
            raise LedgerDocumentInvalid("naive time")
        return value.astimezone(UTC).isoformat(timespec="microseconds").replace("+00:00", "Z")
    if isinstance(value, date):
        return value.isoformat()
    raise TypeError("not JSON native")


def encode_window(doc: WindowDocument) -> dict[str, Any]:
    values = asdict(doc)
    if doc.hold_until_utc == ledger.HOLD_NO_END:
        values["hold_until_utc"] = "infinity"
    return {"format": 1, **json.loads(json.dumps(values, default=_json, allow_nan=False))}


def encode_event(record: EventRecord) -> dict[str, Any]:
    return {"format": 1, **asdict(record)}


def _require(valid: bool) -> None:
    if not valid:
        raise LedgerDocumentInvalid("invalid ledger document")


def _decode[T: WindowDocument | EventRecord](cls: type[T], raw: dict[str, Any]) -> T:
    values = dict(raw)
    _require(type(values.pop("format")) is int and raw["format"] == 1)
    if values.get("hold_until_utc") == "infinity":
        values["hold_until_utc"] = ledger.HOLD_NO_END
    result = TypeAdapter(cls).validate_python(values)
    canonical = json.dumps(asdict(result), default=_json, allow_nan=False, sort_keys=True)
    _require(canonical == json.dumps(values, default=_json, allow_nan=False, sort_keys=True))
    return result


def decode_event(raw: dict[str, Any]) -> EventRecord:
    try:
        record = _decode(EventRecord, raw)
        _require(bool(record.actor))
        _require(record.content_version is None or record.content_version >= 1)
        return record
    except (KeyError, TypeError, ValueError, AttributeError) as exc:
        raise LedgerDocumentInvalid("invalid event record") from exc


def decode_window(raw: dict[str, Any]) -> WindowDocument:
    try:
        doc = _decode(WindowDocument, raw)
        dataset = datasets.get_dataset(doc.dataset_id)
        ledger._check_revision(dataset, doc.revision)
        _require(doc.window_start == datasets.window_start(dataset, doc.window_key))
        _require(doc.seq >= 1)
        versions = [copy.content_version for copy in doc.copies]
        _require(versions == sorted(set(versions)))
        _require(doc.current_version is None or doc.current_version in versions)
        for copy in doc.copies:
            _require(_identity(copy) == _identity(doc) and copy.content_version >= 1)
            _require(copy.content_version < doc.next_version)
            _require(copy.window_start == doc.window_start)
            _require(copy.is_current == (copy.content_version == doc.current_version))
            _require(copy.storage_backend in {"local", "s3"})
            for name in ("sha256", "manifest_sha256", "content_sha256", "poll_record_sha256"):
                digest = getattr(copy, name)
                _require(digest is None or re.fullmatch(r"[0-9a-f]{64}", digest) is not None)
            allocated = copy.allocated_at_utc
            sealed, verified = copy.sealed_at_utc, copy.verified_at_utc
            _require(sealed is None or sealed >= allocated)
            _require(verified is None or (sealed is not None and verified >= sealed))
            _require((copy.rejected_at_utc is None) == (copy.reject_reason is None))
            _require(
                copy.rejected_at_utc is None
                or copy.rejected_at_utc
                >= max(t for t in (allocated, sealed, verified) if t is not None)
            )
        return doc
    except (KeyError, TypeError, ValueError, AttributeError, datasets.UndeclaredDataset) as exc:
        raise LedgerDocumentInvalid("invalid window document") from exc
