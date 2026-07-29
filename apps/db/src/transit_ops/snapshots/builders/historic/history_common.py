"""Shared identity, coverage, and serialization helpers for retained history."""

from __future__ import annotations

import hashlib
import json
import re
from collections import defaultdict
from collections.abc import Callable, Iterable, Iterator, Mapping, Sequence
from contextlib import AbstractContextManager, nullcontext
from dataclasses import dataclass, field, replace
from datetime import UTC, date, datetime, time, timedelta
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel
from sqlalchemy.sql.elements import TextClause

from transit_ops.snapshots.contract import (
    HistoricCollectionIndex,
    HistoricCoverageGap,
    HistoricEntityDirectoryIndex,
    HistoricHotspotsDay,
    HistoricMetricCoverage,
    HistoricPartitionRef,
    HistoricRepeatOffendersDay,
    HistoryMetricAggregation,
    HistoryMetricName,
)
from transit_ops.snapshots.serialization import snapshot_json_bytes, snapshot_sha256
from transit_ops.sql_registry import named_query, query_name

_CANONICAL_ENTITY_ID = re.compile(r"(?:[0-9a-f]{2})+")
_SQL_IDENTIFIER = re.compile(r"^[a-z_][a-z0-9_]*$")
_SHA256 = re.compile(r"^[0-9a-f]{64}$")
_DIGEST_SIDECAR_FIELDS = (
    "__f7_digest_entity_key",
    "__f7_digest_month",
    "__f7_digest_row_count",
    "__f7_digest_min_date",
    "__f7_digest_max_date",
    "__f7_digest_sha256",
)
_INVENTORY_SIDECAR_FIELDS = (
    "__f7_inventory_row_count",
    "__f7_inventory_sha256",
    "__f7_inventory_sentinel",
)

HistoryRow = Mapping[str, Any]
HistoryMetricRows = tuple[list[HistoryRow], ...]
HistoryBatchLoader = Callable[[list[str]], HistoryMetricRows]
HistoryPhaseContext = Callable[[str], AbstractContextManager[None]]
HistoricScopeClass = str


@dataclass(frozen=True)
class HistoryDigestColumn:
    """One projected builder field and its canonical digest-frame type."""

    name: str
    semantic_type: str

    def __post_init__(self) -> None:
        if not _SQL_IDENTIFIER.fullmatch(self.name):
            raise ValueError(f"invalid history digest column: {self.name!r}")
        if self.semantic_type not in {
            "date",
            "float8",
            "integer",
            "numeric",
            "text",
            "timestamptz",
        }:
            raise ValueError(
                f"unsupported history digest semantic type: {self.semantic_type!r}"
            )


@dataclass(frozen=True)
class HistorySourceDigest:
    source_name: str
    entity_key: str
    month: str
    row_count: int
    min_date: str | None
    max_date: str | None
    sha256: str
    empty: bool
    source_timestamps: tuple[str, ...] = ()

    def as_dict(self) -> dict[str, Any]:
        return {
            "source_name": self.source_name,
            "entity_key": self.entity_key,
            "month": self.month,
            "row_count": self.row_count,
            "min_date": self.min_date,
            "max_date": self.max_date,
            "sha256": self.sha256,
            "empty": self.empty,
            "source_timestamps": list(self.source_timestamps),
        }


@dataclass(frozen=True)
class HistoryInventoryDigest:
    row_count: int
    sha256: str

    def as_dict(self) -> dict[str, Any]:
        return {"row_count": self.row_count, "sha256": self.sha256}


@dataclass(frozen=True)
class HistoryScopeSourceEvidence:
    provider_id: str
    family: str
    entity_key: str
    month: str
    scope_start: str
    scope_end: str
    sources: tuple[HistorySourceDigest, ...]
    combined_source_sha256: str
    inventory_sha256: str | None
    complete: bool

    @property
    def source_timestamps(self) -> tuple[str, ...]:
        return tuple(
            sorted(
                {
                    timestamp
                    for source in self.sources
                    for timestamp in source.source_timestamps
                }
            )
        )

    def as_dict(self) -> dict[str, Any]:
        return {
            "provider_id": self.provider_id,
            "family": self.family,
            "entity_key": self.entity_key,
            "month": self.month,
            "scope_start": self.scope_start,
            "scope_end": self.scope_end,
            "sources": [source.as_dict() for source in self.sources],
            "combined_source_sha256": self.combined_source_sha256,
            "inventory_sha256": self.inventory_sha256,
            "source_timestamps": list(self.source_timestamps),
            "complete": self.complete,
        }


@dataclass(frozen=True)
class HistoryScopeCardinality:
    entity_count: int
    month_count: int
    dense_scope_count: int
    observed_scope_count: int

    def as_dict(self) -> dict[str, int]:
        return {
            "entity_count": self.entity_count,
            "month_count": self.month_count,
            "dense_scope_count": self.dense_scope_count,
            "observed_scope_count": self.observed_scope_count,
        }


def _canonical_json_bytes(value: object) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")


def _sql_literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def _frame_header(name: str, semantic_type: str) -> str:
    name_bytes = name.encode("utf-8")
    type_bytes = semantic_type.encode("utf-8")
    return f"{len(name_bytes)}#{name}{len(type_bytes)}#{semantic_type}"


def _sql_canonical_value(column: HistoryDigestColumn, *, table_alias: str = "b") -> str:
    value = f"{table_alias}.{column.name}"
    if column.semantic_type == "date":
        return f"to_char(CAST({value} AS date), 'YYYY-MM-DD')"
    if column.semantic_type == "timestamptz":
        return (
            f"to_char(CAST({value} AS timestamptz) AT TIME ZONE 'UTC', "
            """'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')"""
        )
    if column.semantic_type == "float8":
        return f"encode(float8send(CAST({value} AS double precision)), 'hex')"
    return f"CAST({value} AS text)"


def _sql_typed_frame(column: HistoryDigestColumn, *, table_alias: str = "b") -> str:
    value = f"{table_alias}.{column.name}"
    canonical = _sql_canonical_value(column, table_alias=table_alias)
    header = _sql_literal(_frame_header(column.name, column.semantic_type))
    return (
        f"{header} || CASE WHEN {value} IS NULL THEN 'N' "
        f"ELSE 'V' || CAST(octet_length(convert_to({canonical}, 'UTF8')) AS text) "
        f"|| '#' || {canonical} END"
    )


def _sql_dynamic_frame(name: str, semantic_type: str, expression: str) -> str:
    header = _sql_literal(_frame_header(name, semantic_type))
    return (
        f"{header} || CASE WHEN {expression} IS NULL THEN 'N' "
        f"ELSE 'V' || CAST(octet_length(convert_to(CAST({expression} AS text), 'UTF8')) "
        f"AS text) || '#' || CAST({expression} AS text) END"
    )


def _require_query_name(statement: object) -> str:
    name = query_name(statement)
    if name is None:
        raise ValueError("history digest wrappers require a registered named query")
    return name


def build_history_digest_query(
    base_query: TextClause,
    *,
    wrapper_name: str,
    source_name: str,
    columns: Sequence[HistoryDigestColumn],
    entity_field: str | None,
    order_by: Sequence[str],
) -> TextClause:
    """Register a same-statement rows-plus-scope-digest wrapper around an unchanged query."""

    _require_query_name(base_query)
    if not columns:
        raise ValueError("history digest wrapper requires projected columns")
    column_names = tuple(column.name for column in columns)
    if len(set(column_names)) != len(column_names):
        raise ValueError("history digest projected columns must be unique")
    if "local_date" not in column_names:
        raise ValueError("history digest wrapper requires local_date")
    if entity_field is not None and entity_field not in column_names:
        raise ValueError("history digest entity field must be projected")
    if not order_by or any(value not in column_names for value in order_by):
        raise ValueError("history digest ordering must use projected columns")
    entity_expression = "''::text" if entity_field is None else f"CAST(b.{entity_field} AS text)"
    framed_columns = ",\n               ".join(f"b.{name}" for name in column_names)
    emitted_columns = ",\n               ".join(f"f.{name}" for name in column_names)
    outer_columns = ",\n       ".join(f"e.{name}" for name in column_names)
    row_frame = "\n               || ".join(_sql_typed_frame(column) for column in columns)
    source_frame = "\n                       || ".join(
        (
            _sql_dynamic_frame("provider_id", "text", "CAST(:provider_id AS text)"),
            _sql_dynamic_frame("source_name", "text", _sql_literal(source_name)),
            _sql_dynamic_frame("entity_key", "text", "__f7_entity_key"),
            _sql_dynamic_frame(
                "month",
                "date",
                "to_char(__f7_month, 'YYYY-MM-DD')",
            ),
            _sql_dynamic_frame("row_count", "integer", "count(*)"),
        )
    )
    ordering = ", ".join(f"e.{value}" for value in order_by)
    sql = f"""
    WITH builder_rows AS MATERIALIZED (
{str(base_query)}
    ),
    framed AS MATERIALIZED (
        SELECT {framed_columns},
               {entity_expression} AS __f7_entity_key,
               date_trunc('month', b.local_date)::date AS __f7_month,
               {row_frame} AS __f7_row_frame
        FROM builder_rows AS b
    ),
    scope_digest AS (
        SELECT __f7_entity_key,
               __f7_month,
               count(*)::bigint AS __f7_row_count,
               min(local_date)::date AS __f7_min_date,
               max(local_date)::date AS __f7_max_date,
               encode(
                   sha256(
                       convert_to(
                           {source_frame}
                           || string_agg(
                               __f7_row_frame,
                               ''
                               ORDER BY local_date, __f7_row_frame COLLATE "C"
                           ),
                           'UTF8'
                       )
                   ),
                   'hex'
               ) AS __f7_source_sha256
        FROM framed
        GROUP BY __f7_entity_key, __f7_month
    ),
    emitted AS (
        SELECT {emitted_columns},
               f.__f7_entity_key,
               f.__f7_month,
               f.__f7_row_frame,
               d.__f7_row_count,
               d.__f7_min_date,
               d.__f7_max_date,
               d.__f7_source_sha256,
               row_number() OVER (
                   PARTITION BY f.__f7_entity_key, f.__f7_month
                   ORDER BY f.local_date, f.__f7_row_frame COLLATE "C"
               ) AS __f7_ordinal
        FROM framed AS f
        JOIN scope_digest AS d
          ON d.__f7_entity_key = f.__f7_entity_key
         AND d.__f7_month = f.__f7_month
    )
    SELECT {outer_columns},
       CASE WHEN e.__f7_ordinal = 1 THEN e.__f7_entity_key END
           AS __f7_digest_entity_key,
       CASE WHEN e.__f7_ordinal = 1 THEN e.__f7_month END
           AS __f7_digest_month,
       CASE WHEN e.__f7_ordinal = 1 THEN e.__f7_row_count END
           AS __f7_digest_row_count,
       CASE WHEN e.__f7_ordinal = 1 THEN e.__f7_min_date END
           AS __f7_digest_min_date,
       CASE WHEN e.__f7_ordinal = 1 THEN e.__f7_max_date END
           AS __f7_digest_max_date,
       CASE WHEN e.__f7_ordinal = 1 THEN e.__f7_source_sha256 END
           AS __f7_digest_sha256
    FROM emitted AS e
    ORDER BY {ordering}
    """
    return named_query(wrapper_name, sql)


def build_history_inventory_digest_query(
    base_query: TextClause,
    *,
    wrapper_name: str,
    source_name: str,
    entity_field: str,
) -> TextClause:
    """Register an ordered-inventory digest wrapper with an empty-result sentinel."""

    _require_query_name(base_query)
    if not _SQL_IDENTIFIER.fullmatch(entity_field):
        raise ValueError(f"invalid history inventory entity field: {entity_field!r}")
    entity_frame = _sql_typed_frame(HistoryDigestColumn(entity_field, "text"))
    inventory_frame = "\n                       || ".join(
        (
            _sql_dynamic_frame("provider_id", "text", "CAST(:provider_id AS text)"),
            _sql_dynamic_frame("source_name", "text", _sql_literal(source_name)),
            _sql_dynamic_frame("row_count", "integer", "count(*)"),
        )
    )
    sql = f"""
    WITH builder_rows AS MATERIALIZED (
{str(base_query)}
    ),
    framed AS MATERIALIZED (
        SELECT b.{entity_field},
               {entity_frame} AS __f7_row_frame
        FROM builder_rows AS b
    ),
    inventory_digest AS (
        SELECT count(*)::bigint AS __f7_row_count,
               encode(
                   sha256(
                       convert_to(
                           {inventory_frame}
                           || COALESCE(
                               string_agg(
                                   __f7_row_frame,
                                   ''
                                   ORDER BY __f7_row_frame COLLATE "C"
                               ),
                               ''
                           ),
                           'UTF8'
                       )
                   ),
                   'hex'
               ) AS __f7_inventory_sha256
        FROM framed
    ),
    emitted AS (
        SELECT f.{entity_field},
               d.__f7_row_count,
               d.__f7_inventory_sha256,
               row_number() OVER (
                   ORDER BY f.__f7_row_frame COLLATE "C"
               ) AS __f7_ordinal
        FROM framed AS f
        CROSS JOIN inventory_digest AS d
    )
    SELECT e.{entity_field},
           CASE WHEN e.__f7_ordinal = 1 THEN e.__f7_row_count END
               AS __f7_inventory_row_count,
           CASE WHEN e.__f7_ordinal = 1 THEN e.__f7_inventory_sha256 END
               AS __f7_inventory_sha256,
           false AS __f7_inventory_sentinel
    FROM emitted AS e
    UNION ALL
    SELECT NULL::text AS {entity_field},
           d.__f7_row_count AS __f7_inventory_row_count,
           d.__f7_inventory_sha256,
           true AS __f7_inventory_sentinel
    FROM inventory_digest AS d
    WHERE d.__f7_row_count = 0
    ORDER BY {entity_field} NULLS FIRST
    """
    return named_query(wrapper_name, sql)


def history_named_query_sha256(statements: Iterable[object]) -> dict[str, str]:
    result: dict[str, str] = {}
    for statement in statements:
        name = _require_query_name(statement)
        digest = hashlib.sha256(str(statement).encode("utf-8")).hexdigest()
        existing = result.get(name)
        if existing is not None and existing != digest:
            raise ValueError(f"conflicting history named query digest: {name}")
        result[name] = digest
    return dict(sorted(result.items()))


def _iso_date(value: object, *, field_name: str) -> str:
    return history_date(value, field=field_name)


class HistoryDigestCollector:
    """Compact mutable collector for sidecars emitted by historic builder statements."""

    def __init__(
        self,
        *,
        provider_id: str,
        family: str,
        source_names: Sequence[str],
        named_query_sha256: Mapping[str, str],
        inventory_required: bool = False,
    ) -> None:
        if not provider_id:
            raise ValueError("history digest provider_id must be nonempty")
        if family not in {"network", "lines", "stops"}:
            raise ValueError(f"unsupported history digest family: {family!r}")
        if not source_names or len(set(source_names)) != len(source_names):
            raise ValueError("history digest source names must be nonempty and unique")
        for name, digest in named_query_sha256.items():
            if not name or not _SHA256.fullmatch(digest):
                raise ValueError("history named-query digests must be named SHA-256 values")
        self.provider_id = provider_id
        self.family = family
        self.source_names = tuple(source_names)
        self.named_query_sha256 = dict(sorted(named_query_sha256.items()))
        self.inventory_required = inventory_required
        self.inventory: HistoryInventoryDigest | None = None
        self._digests: dict[tuple[str, str, str], HistorySourceDigest] = {}
        self._source_calls: dict[str, int] = defaultdict(int)
        self._missing_sidecars: set[str] = set()
        self._inventory_missing_sidecar = False

    def consume_source_rows(
        self,
        source_name: str,
        rows: Iterable[Mapping[str, Any]],
        *,
        entity_field: str | None,
    ) -> list[HistoryRow]:
        if source_name not in self.source_names:
            raise ValueError(f"unknown history digest source: {source_name!r}")
        self._source_calls[source_name] += 1
        plain_rows: list[HistoryRow] = []
        actual_counts: dict[tuple[str, str], int] = defaultdict(int)
        actual_timestamps: dict[tuple[str, str], set[str]] = defaultdict(set)
        sidecars: list[HistorySourceDigest] = []
        saw_nonempty = False
        saw_sidecar_columns = False
        for raw_row in rows:
            row = dict(raw_row)
            unknown = sorted(
                key
                for key in row
                if key.startswith("__f7_") and key not in _DIGEST_SIDECAR_FIELDS
            )
            if unknown:
                raise ValueError(f"unknown history digest sidecar fields: {unknown}")
            present = {key for key in _DIGEST_SIDECAR_FIELDS if key in row}
            if present and present != set(_DIGEST_SIDECAR_FIELDS):
                raise ValueError("partial digest sidecar")
            saw_sidecar_columns = saw_sidecar_columns or bool(present)
            values = {key: row.pop(key) for key in _DIGEST_SIDECAR_FIELDS if key in row}
            if values:
                nonnull = [value is not None for value in values.values()]
                if any(nonnull) and not all(nonnull):
                    raise ValueError("partial digest sidecar")
                if all(nonnull):
                    entity_key = values["__f7_digest_entity_key"]
                    if not isinstance(entity_key, str):
                        raise ValueError("history digest entity key must be text")
                    month_date = _iso_date(
                        values["__f7_digest_month"],
                        field_name="__f7_digest_month",
                    )
                    month = month_date[:7]
                    row_count = values["__f7_digest_row_count"]
                    if (
                        not isinstance(row_count, int)
                        or isinstance(row_count, bool)
                        or row_count <= 0
                    ):
                        raise ValueError("history digest row count must be positive")
                    minimum = _iso_date(
                        values["__f7_digest_min_date"],
                        field_name="__f7_digest_min_date",
                    )
                    maximum = _iso_date(
                        values["__f7_digest_max_date"],
                        field_name="__f7_digest_max_date",
                    )
                    digest = values["__f7_digest_sha256"]
                    if (
                        not isinstance(digest, str)
                        or not _SHA256.fullmatch(digest)
                        or minimum > maximum
                        or minimum[:7] != month
                        or maximum[:7] != month
                    ):
                        raise ValueError("invalid history digest sidecar")
                    sidecars.append(
                        HistorySourceDigest(
                            source_name=source_name,
                            entity_key=entity_key,
                            month=month,
                            row_count=row_count,
                            min_date=minimum,
                            max_date=maximum,
                            sha256=digest,
                            empty=False,
                        )
                    )
            if row:
                saw_nonempty = True
                local_date = _iso_date(row.get("local_date"), field_name="local_date")
                entity_key_value = "" if entity_field is None else row.get(entity_field)
                if not isinstance(entity_key_value, str):
                    raise ValueError("history digest row entity key must be text")
                scope_key = (entity_key_value, local_date[:7])
                actual_counts[scope_key] += 1
                source_timestamp = row.get("source_generated_utc")
                if source_timestamp is not None:
                    actual_timestamps[scope_key].add(
                        history_utc_timestamp(
                            source_timestamp,
                            field="source_generated_utc",
                        )
                    )
                plain_rows.append(row)
        if saw_nonempty and not saw_sidecar_columns:
            self._missing_sidecars.add(source_name)
        for sidecar in sidecars:
            actual = actual_counts[(sidecar.entity_key, sidecar.month)]
            if actual != sidecar.row_count:
                raise ValueError(
                    f"history digest row count mismatch for {source_name}/"
                    f"{sidecar.entity_key}/{sidecar.month}: {actual} != {sidecar.row_count}"
                )
            sidecar = replace(
                sidecar,
                source_timestamps=tuple(
                    sorted(actual_timestamps[(sidecar.entity_key, sidecar.month)])
                ),
            )
            key = (source_name, sidecar.entity_key, sidecar.month)
            existing = self._digests.get(key)
            if existing is not None and existing != sidecar:
                raise ValueError(
                    f"conflicting history digest sidecar for "
                    f"{source_name}/{sidecar.entity_key}/{sidecar.month}"
                )
            if existing is not None:
                raise ValueError(
                    f"duplicate history digest sidecar for "
                    f"{source_name}/{sidecar.entity_key}/{sidecar.month}"
                )
            self._digests[key] = sidecar
        if saw_sidecar_columns:
            covered = {(value.entity_key, value.month) for value in sidecars}
            if covered != set(actual_counts):
                raise ValueError(f"missing digest sidecar for {source_name} scope")
        return plain_rows

    def consume_inventory_rows(
        self,
        rows: Iterable[Mapping[str, Any]],
        *,
        entity_field: str,
    ) -> tuple[str, ...]:
        values: list[str] = []
        metadata: HistoryInventoryDigest | None = None
        saw_sidecar_columns = False
        for raw_row in rows:
            row = dict(raw_row)
            unknown = sorted(
                key
                for key in row
                if key.startswith("__f7_") and key not in _INVENTORY_SIDECAR_FIELDS
            )
            if unknown:
                raise ValueError(f"unknown history inventory sidecar fields: {unknown}")
            present = {key for key in _INVENTORY_SIDECAR_FIELDS if key in row}
            if present and present != set(_INVENTORY_SIDECAR_FIELDS):
                raise ValueError("partial inventory digest sidecar")
            saw_sidecar_columns = saw_sidecar_columns or bool(present)
            row_count = row.pop("__f7_inventory_row_count", None)
            digest = row.pop("__f7_inventory_sha256", None)
            sentinel = row.pop("__f7_inventory_sentinel", None)
            if row_count is not None or digest is not None:
                if (
                    not isinstance(row_count, int)
                    or isinstance(row_count, bool)
                    or row_count < 0
                    or not isinstance(digest, str)
                    or not _SHA256.fullmatch(digest)
                ):
                    raise ValueError("invalid inventory digest sidecar")
                candidate = HistoryInventoryDigest(row_count=row_count, sha256=digest)
                if metadata is not None:
                    raise ValueError("duplicate inventory digest sidecar")
                metadata = candidate
            entity_id = row.get(entity_field)
            if sentinel is True:
                if entity_id is not None or metadata is None or metadata.row_count != 0:
                    raise ValueError("invalid empty inventory sentinel")
                continue
            if entity_id is not None:
                if not isinstance(entity_id, str) or not entity_id:
                    raise ValueError("history inventory entity id must be nonempty text")
                values.append(entity_id)
        if len(set(values)) != len(values):
            raise ValueError("history inventory contains duplicate entity ids")
        if metadata is not None and metadata.row_count != len(values):
            raise ValueError("history inventory row count mismatch")
        if not saw_sidecar_columns:
            self._inventory_missing_sidecar = True
        self.inventory = metadata
        return tuple(sorted(values))

    @property
    def complete(self) -> bool:
        source_complete = all(self._source_calls[name] > 0 for name in self.source_names)
        if self.inventory is not None and self.inventory.row_count == 0:
            source_complete = True
        return (
            source_complete
            and not self._missing_sidecars
            and (
                not self.inventory_required
                or (self.inventory is not None and not self._inventory_missing_sidecar)
            )
        )

    def _empty_source_digest(
        self,
        *,
        source_name: str,
        entity_key: str,
        month: str,
    ) -> HistorySourceDigest:
        payload = {
            "protocol": "f7-zero-source-v1",
            "provider_id": self.provider_id,
            "family": self.family,
            "source_name": source_name,
            "entity_key": entity_key,
            "month": month,
            "row_count": 0,
            "empty": True,
        }
        return HistorySourceDigest(
            source_name=source_name,
            entity_key=entity_key,
            month=month,
            row_count=0,
            min_date=None,
            max_date=None,
            sha256=hashlib.sha256(_canonical_json_bytes(payload)).hexdigest(),
            empty=True,
        )

    def iter_scope_evidence(self) -> Iterator[HistoryScopeSourceEvidence]:
        scopes = sorted({(entity_key, month) for _source, entity_key, month in self._digests})
        for entity_key, month in scopes:
            sources = tuple(
                self._digests.get((source_name, entity_key, month))
                or self._empty_source_digest(
                    source_name=source_name,
                    entity_key=entity_key,
                    month=month,
                )
                for source_name in self.source_names
            )
            dates = [
                value
                for source in sources
                for value in (source.min_date, source.max_date)
                if value is not None
            ]
            if not dates:
                continue
            combined_payload = {
                "protocol": "f7-combined-source-v1",
                "provider_id": self.provider_id,
                "family": self.family,
                "entity_key": entity_key,
                "month": month,
                "inventory_sha256": None if self.inventory is None else self.inventory.sha256,
                "sources": [source.as_dict() for source in sources],
            }
            yield HistoryScopeSourceEvidence(
                provider_id=self.provider_id,
                family=self.family,
                entity_key=entity_key,
                month=month,
                scope_start=min(dates),
                scope_end=max(dates),
                sources=sources,
                combined_source_sha256=hashlib.sha256(
                    _canonical_json_bytes(combined_payload)
                ).hexdigest(),
                inventory_sha256=None if self.inventory is None else self.inventory.sha256,
                complete=self.complete,
            )

    def scope_cardinality(self) -> HistoryScopeCardinality:
        scopes = {(entity_key, month) for _source, entity_key, month in self._digests}
        months = {month for _entity_key, month in scopes}
        if self.inventory is not None:
            entity_count = self.inventory.row_count
        elif self.family == "network":
            entity_count = 1
        else:
            entity_count = len({entity_key for entity_key, _month in scopes})
        return HistoryScopeCardinality(
            entity_count=entity_count,
            month_count=len(months),
            dense_scope_count=entity_count * len(months),
            observed_scope_count=len(scopes),
        )


def history_phase(
    phase_context: HistoryPhaseContext | None,
    phase_name: str,
) -> AbstractContextManager[None]:
    return nullcontext() if phase_context is None else phase_context(phase_name)


def classify_historic_scope(
    *,
    family: str,
    scope_start: date,
    scope_end: date,
    today_local: date,
    open_window_days: int,
    fact_retention_days: int,
    retention_days: int,
) -> HistoricScopeClass:
    if family not in {"network", "lines", "stops"}:
        raise ValueError(f"unsupported historic family: {family!r}")
    if scope_start > scope_end:
        raise ValueError("historic scope start must not exceed scope end")
    month_start = scope_start.replace(day=1)
    if scope_end.replace(day=1) != month_start:
        raise ValueError("historic scope classification requires one calendar month")
    next_month = (month_start.replace(day=28) + timedelta(days=4)).replace(day=1)
    month_end = next_month - timedelta(days=1)
    if min(open_window_days, fact_retention_days, retention_days) <= 0:
        raise ValueError("historic scope classification windows must be positive")
    retention_floor = today_local - timedelta(days=retention_days)
    mutable_days = (
        max(open_window_days, fact_retention_days)
        if family == "network"
        else open_window_days
    )
    mutable_floor = today_local - timedelta(days=mutable_days)
    if month_start <= retention_floor:
        return "retention_edge"
    if month_end >= mutable_floor:
        return "mutable_edge"
    return "settled_candidate"


def history_collection_generation_id(canonical: dict) -> str:  # type: ignore[type-arg]
    """Digest canonical collection identity through the shared byte authority."""

    return snapshot_sha256(canonical)


def history_collection_generation_basis(index: BaseModel | Mapping[str, Any]) -> dict[str, Any]:
    """Return the stable semantic fields that identify one collection index."""

    if isinstance(index, BaseModel):
        payload = index.model_dump(mode="json")
    else:
        payload = dict(index)
    fields = (
        "family",
        "selection_mode",
        "entity_id",
        "first_available_date",
        "last_available_date",
        "available_dates",
        "gaps",
        "partitions",
        "metrics",
    )
    return {field: payload.get(field) for field in fields}


def history_index_generation_id(index: BaseModel | Mapping[str, Any]) -> str:
    """Digest an index without volatile envelope or publication timestamps."""

    return history_collection_generation_id(history_collection_generation_basis(index))


def history_entity_directory_generation_id(
    directory: BaseModel | Mapping[str, Any],
) -> str:
    """Digest one entity directory including every exact child-generation edge."""

    if isinstance(directory, BaseModel):
        payload = directory.model_dump(mode="json")
    else:
        payload = dict(directory)
    return history_collection_generation_id(
        {
            "family": payload.get("family"),
            "selection_mode": payload.get("selection_mode"),
            "first_available_date": payload.get("first_available_date"),
            "last_available_date": payload.get("last_available_date"),
            "entities": payload.get("entities"),
        }
    )


def history_pointer_path(prefix: str, payload: BaseModel | Mapping[str, Any]) -> str:
    """Return the immutable exact-byte index path for one retained-history pointer."""

    return f"{prefix.rstrip('/')}/generations/{snapshot_sha256(payload)}/index.json"


def readdress_history_directory(
    directory: HistoricEntityDirectoryIndex,
    index_paths: Mapping[str, str],
) -> HistoricEntityDirectoryIndex:
    """Copy a directory onto exact child paths and recompute its semantic generation."""

    result = directory.model_copy(deep=True)
    for entity in result.entities:
        entity.index_path = index_paths[entity.entity_id]
    result.collection_generation_id = history_entity_directory_generation_id(result)
    return result


def history_date(value: object, *, field: str = "local_date") -> str:
    """Normalize a database local-date value to canonical ``YYYY-MM-DD``."""

    if isinstance(value, datetime):
        value = value.date()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, str):
        try:
            parsed = date.fromisoformat(value)
        except ValueError as exc:
            raise ValueError(f"{field} must be a valid local calendar date") from exc
        if parsed.isoformat() == value:
            return value
    raise ValueError(f"{field} must be a valid local calendar date")


def iter_history_date_groups(
    rows: Iterable[Mapping[str, Any]],
    *,
    field: str = "local_date",
):  # type: ignore[no-untyped-def]
    """Yield ordered date groups with at most one row of source lookahead.

    Retained-history SQL owns the sort. Failing closed here prevents a later
    append or query-plan change from silently corrupting bounded rolling state.
    """

    current: str | None = None
    grouped: list[Mapping[str, Any]] = []
    for row in rows:
        local_date = history_date(row.get(field), field=field)
        if current is not None and local_date < current:
            raise ValueError(f"history rows must be ordered by {field}")
        if current is not None and local_date != current:
            yield current, grouped
            grouped = []
        current = local_date
        grouped.append(row)
    if current is not None:
        yield current, grouped


@dataclass(frozen=True)
class _HistoryNameInterval:
    name: str | None
    valid_from_utc: datetime
    valid_to_utc: datetime | None


class HistoryNameIndex:
    """Provider-local closing-instant lookup over append-only name intervals."""

    def __init__(
        self,
        rows: Iterable[Mapping[str, Any]],
        *,
        provider_timezone: str,
    ) -> None:
        try:
            self._timezone = ZoneInfo(provider_timezone)
        except ZoneInfoNotFoundError as exc:
            raise ValueError(f"unknown provider timezone {provider_timezone!r}") from exc
        intervals: dict[tuple[str, str], list[_HistoryNameInterval]] = defaultdict(list)
        for row in rows:
            kind = row.get("entity_kind")
            entity_id = row.get("entity_id")
            if kind not in {"route", "stop"}:
                raise ValueError("history name entity_kind must be route or stop")
            if not isinstance(entity_id, str) or not entity_id:
                raise ValueError("history name entity_id must be nonempty")
            name = row.get("name")
            if name is not None and not isinstance(name, str):
                raise ValueError("history name must be a string or null")
            valid_from = _history_datetime(row.get("valid_from_utc"), field="valid_from_utc")
            valid_to_value = row.get("valid_to_utc")
            valid_to = (
                None
                if valid_to_value is None
                else _history_datetime(valid_to_value, field="valid_to_utc")
            )
            intervals[(kind, entity_id)].append(_HistoryNameInterval(name, valid_from, valid_to))
        self._intervals = {
            key: tuple(sorted(values, key=lambda value: value.valid_from_utc))
            for key, values in intervals.items()
        }

    def name_at(self, kind: str, entity_id: str, local_date: str) -> str | None:
        """Resolve the interval in force immediately before next local midnight."""

        parsed = date.fromisoformat(history_date(local_date, field="date"))
        closing_utc = datetime.combine(
            parsed + timedelta(days=1),
            time.min,
            tzinfo=self._timezone,
        ).astimezone(UTC)
        candidates = [
            interval
            for interval in self._intervals.get((kind, entity_id), ())
            if interval.valid_from_utc < closing_utc
            and (interval.valid_to_utc is None or interval.valid_to_utc >= closing_utc)
        ]
        if not candidates:
            return None
        return max(candidates, key=lambda value: value.valid_from_utc).name

    def names_at(
        self,
        kind: str,
        entity_ids: Iterable[str],
        local_date: str,
    ) -> dict[str, str | None]:
        """Resolve a deterministic map for one artifact date."""

        return {
            entity_id: self.name_at(kind, entity_id, local_date)
            for entity_id in sorted(set(entity_ids))
        }


@dataclass
class HistoryDateMask:
    """Compact relative-date set for bounded retained-history summaries."""

    _first_ordinal: int | None = None
    _bits: int = 0

    def add(self, value: object) -> None:
        ordinal = date.fromisoformat(history_date(value, field="date")).toordinal()
        if self._first_ordinal is None:
            self._first_ordinal = ordinal
            self._bits = 1
            return
        if ordinal < self._first_ordinal:
            self._bits <<= self._first_ordinal - ordinal
            self._first_ordinal = ordinal
        self._bits |= 1 << (ordinal - self._first_ordinal)

    def update(self, values: Iterable[object]) -> None:
        for value in values:
            self.add(value)

    def merge(self, other: HistoryDateMask) -> None:
        if other._first_ordinal is None:
            return
        if self._first_ordinal is None:
            self._first_ordinal = other._first_ordinal
            self._bits = other._bits
            return
        first = min(self._first_ordinal, other._first_ordinal)
        self._bits = (self._bits << (self._first_ordinal - first)) | (
            other._bits << (other._first_ordinal - first)
        )
        self._first_ordinal = first

    def copy(self) -> HistoryDateMask:
        return HistoryDateMask(self._first_ordinal, self._bits)

    def __bool__(self) -> bool:
        return self._first_ordinal is not None

    def __len__(self) -> int:
        return self._bits.bit_count()

    def __iter__(self):  # type: ignore[no-untyped-def]
        if self._first_ordinal is None:
            return
        remaining = self._bits
        while remaining:
            lowest = remaining & -remaining
            offset = lowest.bit_length() - 1
            yield date.fromordinal(self._first_ordinal + offset).isoformat()
            remaining ^= lowest


def history_month(local_date: str) -> str:
    """Return the calendar-month key for a canonical provider-local date."""

    return history_date(local_date)[:7]


def _history_datetime(value: object, *, field: str) -> datetime:
    if isinstance(value, datetime):
        parsed = value
    elif isinstance(value, str):
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError as exc:
            raise ValueError(f"{field} must be an ISO timestamp with timezone") from exc
    else:
        raise ValueError(f"{field} must be an ISO timestamp with timezone")
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ValueError(f"{field} must include a timezone")
    return parsed.astimezone(UTC)


def history_utc_timestamp(value: object, *, field: str = "source_generated_utc") -> str:
    """Normalize an aware datetime/ISO timestamp to an exact UTC ``Z`` string."""

    parsed = _history_datetime(value, field=field)
    rendered = parsed.isoformat(timespec="microseconds" if parsed.microsecond else "seconds")
    return rendered.replace("+00:00", "Z")


def latest_history_timestamp(
    values: Iterable[object],
    *,
    fallback: object | None = None,
) -> str:
    """Return the chronologically latest source timestamp, never lexical max."""

    parsed = [_history_datetime(value, field="source_generated_utc") for value in values]
    if not parsed:
        if fallback is None:
            raise ValueError("history timestamp set cannot be empty without a fallback")
        parsed.append(_history_datetime(fallback, field="generated_utc"))
    return history_utc_timestamp(max(parsed), field="source_generated_utc")


def history_row_int(
    row: Mapping[str, Any],
    field: str,
    *,
    optional: bool = False,
    minimum: int | None = 0,
) -> int | None:
    """Read an exact integer SQL aggregate and fail closed on malformed values."""

    value = row.get(field)
    if value is None:
        if optional:
            return None
        raise ValueError(f"history row {field} cannot be null")
    if isinstance(value, bool):
        raise ValueError(f"history row {field} must be an integer")
    try:
        result = int(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"history row {field} must be an integer") from exc
    if result != value:
        raise ValueError(f"history row {field} must be an exact integer")
    if minimum is not None and result < minimum:
        raise ValueError(f"history row {field} must be >= {minimum}")
    return result


def history_row_timestamp(row: Mapping[str, Any]) -> str:
    """Read and normalize the mandatory timestamp carried by a source aggregate."""

    return history_utc_timestamp(row.get("source_generated_utc"))


def history_optional_sum(values: Iterable[int | None]) -> int | None:
    present = [value for value in values if value is not None]
    return sum(present) if present else None


def history_row_float(row: HistoryRow, field: str) -> float | None:
    value = row.get(field)
    if value is None:
        return None
    if isinstance(value, bool):
        raise ValueError(f"history row {field} must be numeric")
    try:
        return float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"history row {field} must be numeric") from exc


def group_history_entity_date_rows(
    rows: Iterable[HistoryRow], *, entity_id_of: Callable[[HistoryRow], str]
) -> dict[tuple[str, str], list[HistoryRow]]:
    grouped: dict[tuple[str, str], list[HistoryRow]] = defaultdict(list)
    for row in rows:
        grouped[(entity_id_of(row), history_date(row.get("local_date")))].append(row)
    return dict(grouped)


def put_history_entity_metric[Metric](
    target: dict[str, dict[str, Metric]],
    entity_id: str,
    local_date: str,
    value: Metric,
) -> None:
    target.setdefault(entity_id, {})[local_date] = value


def put_history_entity_timestamps(
    target: dict[str, dict[str, list[str]]],
    entity_id: str,
    local_date: str,
    rows: Iterable[HistoryRow],
) -> None:
    target.setdefault(entity_id, {})[local_date] = [history_row_timestamp(row) for row in rows]


def clean_history_entity_ids(
    values: Iterable[object], *, excluded: Iterable[str] = ()
) -> tuple[str, ...]:
    excluded_ids = set(excluded)
    valid_ids = {
        value for value in values if isinstance(value, str) and value and value not in excluded_ids
    }
    return tuple(sorted(valid_ids))


@dataclass(frozen=True)
class HistoryEntityMetricPlan:
    entity_id: str
    metrics: tuple[dict[str, Any], ...]
    timestamps: tuple[dict[str, list[str]], ...]
    available_dates: tuple[str, ...]

    def iter_partition_items[Day, Partition: BaseModel](
        self,
        *,
        family: str,
        metric_names: Sequence[str],
        day_model: Callable[..., Day],
        partition_model: Callable[..., Partition],
    ) -> Iterator[tuple[HistoricPartitionRef, Partition]]:
        if len(metric_names) != len(self.metrics):
            raise ValueError("history metric names and sources must have equal lengths")
        metric_sources = tuple(zip(metric_names, self.metrics, strict=True))
        path_prefix = f"historic/history/{family}/{encode_history_entity_id(self.entity_id)}"
        for month, dates in iter_history_month_groups(self.available_dates):
            yield history_month_partition_ref(
                lambda local_date: day_model(
                    date=local_date,
                    **{name: source.get(local_date) for name, source in metric_sources},
                ),
                lambda generated_utc, partition_month, days: partition_model(
                    generated_utc=generated_utc,
                    methodology_version="history-1",
                    entity_id=self.entity_id,
                    month=partition_month,
                    days=days,
                ),
                lambda digest, partition_month: (
                    f"{path_prefix}/generations/{digest}/{partition_month}.json"
                ),
                month=month,
                dates=dates,
                source_timestamps=self.timestamps,
            )


def build_history_entity_metric_plans(
    *,
    entity_ids: Iterable[str],
    metric_sources: Sequence[Mapping[str, dict[str, Any]]],
    timestamp_sources: Sequence[Mapping[str, dict[str, list[str]]]],
) -> list[HistoryEntityMetricPlan]:
    if len(metric_sources) != len(timestamp_sources):
        raise ValueError("history metric and timestamp sources must have equal lengths")
    plans: list[HistoryEntityMetricPlan] = []
    for entity_id in sorted(set(entity_ids)):
        metrics = tuple(source.get(entity_id, {}) for source in metric_sources)
        available_dates = tuple(sorted({value for source in metrics for value in source}))
        if not available_dates:
            continue
        timestamps = tuple(source.get(entity_id, {}) for source in timestamp_sources)
        plans.append(HistoryEntityMetricPlan(entity_id, metrics, timestamps, available_dates))
    return plans


def iter_history_month_groups(dates: Iterable[str]):  # type: ignore[no-untyped-def]
    ordered = tuple(sorted(history_date(value, field="date") for value in dates))
    for month in sorted({history_month(value) for value in ordered}):
        yield month, tuple(value for value in ordered if history_month(value) == month)


def history_month_partition_ref[Day, Partition: BaseModel](
    day_builder: Callable[[str], Day],
    partition_builder: Callable[[str, str, list[Day]], Partition],
    path_builder: Callable[[str, str], str],
    *,
    month: str,
    dates: Sequence[str],
    source_timestamps: Sequence[Mapping[str, list[str]]],
) -> tuple[HistoricPartitionRef, Partition]:
    partition = partition_builder(
        latest_history_timestamp(
            timestamp
            for local_date in dates
            for source in source_timestamps
            for timestamp in source.get(local_date, [])
        ),
        month,
        [day_builder(local_date) for local_date in dates],
    )
    digest = snapshot_sha256(partition)
    return history_partition_ref(path_builder(digest, month), partition), partition


def prepare_history_row_batch_loader(
    sources: Sequence[Sequence[HistoryRow]], *, entity_field: str
) -> HistoryBatchLoader:
    def load(batch: list[str]) -> HistoryMetricRows:
        allowed = set(batch)
        return tuple(
            [row for row in source if row.get(entity_field) in allowed] for source in sources
        )

    return load


def prepare_history_sql_batch_loader(
    conn: Any,
    queries: Sequence[Any],
    *,
    base_params: Mapping[str, Any],
    source_names: Sequence[str] | None = None,
    digest_collector: HistoryDigestCollector | None = None,
    entity_field: str | None = None,
    phase_context: HistoryPhaseContext | None = None,
) -> HistoryBatchLoader:
    if digest_collector is not None:
        if source_names is None or len(source_names) != len(queries):
            raise ValueError("history SQL digest loader requires one source name per query")
        if entity_field is None:
            raise ValueError("history SQL digest loader requires an entity field")

    def load(batch: list[str]) -> HistoryMetricRows:
        params = {**base_params, "entity_ids": batch}
        with history_phase(phase_context, "source_digest"):
            if digest_collector is None:
                return tuple(list(conn.execute(query, params).mappings()) for query in queries)
            assert source_names is not None
            assert entity_field is not None
            return tuple(
                digest_collector.consume_source_rows(
                    source_name,
                    conn.execute(query, params).mappings(),
                    entity_field=entity_field,
                )
                for source_name, query in zip(source_names, queries, strict=True)
            )

    return load


def history_gaps(dates: Iterable[str]) -> list[HistoricCoverageGap]:
    """Return only internal missing calendar ranges, never inferred edge gaps."""

    ordered = sorted({history_date(value, field="date") for value in dates})
    gaps: list[HistoricCoverageGap] = []
    for previous, current in zip(ordered, ordered[1:], strict=False):
        start = date.fromisoformat(previous) + timedelta(days=1)
        end = date.fromisoformat(current) - timedelta(days=1)
        if start <= end:
            gaps.append(HistoricCoverageGap(start_date=start.isoformat(), end_date=end.isoformat()))
    return gaps


def history_coverage(
    dates: Iterable[str],
) -> tuple[str | None, str | None, list[HistoricCoverageGap]]:
    """Return independent first/last/internal-gap coverage for real emitted days."""

    ordered = sorted({history_date(value, field="date") for value in dates})
    if not ordered:
        return (None, None, [])
    return (ordered[0], ordered[-1], history_gaps(ordered))


def history_metric_coverage(
    metric: HistoryMetricName | str,
    aggregation: HistoryMetricAggregation | str,
    dates: Iterable[str],
) -> HistoricMetricCoverage:
    """Build one metric's coverage without borrowing another metric's dates."""

    first, last, gaps = history_coverage(dates)
    return HistoricMetricCoverage(
        metric=metric,
        aggregation=aggregation,
        first_available_date=first,
        last_available_date=last,
        gaps=gaps,
    )


def history_partition_ref(path: str, partition: BaseModel) -> HistoricPartitionRef:
    """Build a ref from the exact canonical bytes used by immutable storage."""

    days = getattr(partition, "days", None)
    if not isinstance(days, list) or not days:
        raise ValueError("history partition ref requires a nonempty days list")
    body = snapshot_json_bytes(partition)
    return HistoricPartitionRef(
        path=path,
        coverage_start=days[0].date,
        coverage_end=days[-1].date,
        count=len(days),
        sha256=hashlib.sha256(body).hexdigest(),
        byte_size=len(body),
    )


_POINT_HISTORY_MODELS = {
    "hotspots": HistoricHotspotsDay,
    "repeat_offenders": HistoricRepeatOffendersDay,
}


def history_point_ref(family: str, payload: BaseModel) -> HistoricPartitionRef:
    """Address one self-identifying point day from its exact final bytes."""

    model = _POINT_HISTORY_MODELS.get(family)
    if model is None:
        raise ValueError(f"unsupported point history family {family!r}")
    if not isinstance(payload, model):
        raise ValueError(f"point history payload does not match family {family!r}")
    local_date = history_date(getattr(payload, "date", None), field="date")
    if getattr(payload, "methodology_version", None) != "reliability-1":
        raise ValueError("point history payload methodology must be reliability-1")
    if getattr(payload, "publish_generation_id", None) is not None:
        raise ValueError("point history payloads cannot carry a publish generation")
    body = snapshot_json_bytes(payload)
    digest = hashlib.sha256(body).hexdigest()
    return HistoricPartitionRef(
        path=f"historic/history/{family}/generations/{digest}/{local_date}.json",
        coverage_start=local_date,
        coverage_end=local_date,
        count=1,
        sha256=digest,
        byte_size=len(body),
    )


@dataclass
class PointHistorySummary:
    """Compact exact-ref truth retained while point-day payloads stream away."""

    family: str
    refs: list[HistoricPartitionRef] = field(default_factory=list)
    generated_utc: str | None = None

    def __post_init__(self) -> None:
        if self.family not in _POINT_HISTORY_MODELS:
            raise ValueError(f"unsupported point history family {self.family!r}")

    def observe(self, payload: BaseModel) -> HistoricPartitionRef:
        ref = history_point_ref(self.family, payload)
        local_date = ref.coverage_start
        if self.refs and local_date <= self.refs[-1].coverage_start:
            problem = "duplicate" if local_date == self.refs[-1].coverage_start else "ordered"
            raise ValueError(f"point history dates must be unique and ordered ({problem})")
        self.refs.append(ref)
        self.generated_utc = latest_history_timestamp(
            candidate
            for candidate in (self.generated_utc, getattr(payload, "generated_utc", None))
            if candidate is not None
        )
        return ref

    @property
    def available_dates(self) -> list[str]:
        return [ref.coverage_start for ref in self.refs]

    def build_index(self, *, fallback_generated_utc: str) -> HistoricCollectionIndex:
        first, last, gaps = history_coverage(self.available_dates)
        index = HistoricCollectionIndex(
            generated_utc=latest_history_timestamp(
                (() if self.generated_utc is None else (self.generated_utc,)),
                fallback=fallback_generated_utc,
            ),
            methodology_version="history-1",
            publish_generation_id=None,
            family=self.family,
            selection_mode="date",
            first_available_date=first,
            last_available_date=last,
            available_dates=self.available_dates,
            gaps=gaps,
            partitions=[ref.model_copy(deep=True) for ref in self.refs],
            metrics=[],
        )
        index.collection_generation_id = history_index_generation_id(index)
        return index


def encode_history_entity_id(entity_id: str) -> str:
    """Encode an entity ID as its bijective, path-safe lowercase UTF-8 hex."""

    if not entity_id:
        raise ValueError("history entity ID cannot be empty")
    return entity_id.encode("utf-8").hex()


def decode_history_entity_id(encoded_id: str) -> str:
    """Decode one canonical retained-history entity path segment."""

    if _CANONICAL_ENTITY_ID.fullmatch(encoded_id) is None:
        raise ValueError("encoded history entity ID must be non-empty lowercase UTF-8 hex")
    try:
        return bytes.fromhex(encoded_id).decode("utf-8")
    except UnicodeDecodeError as exc:
        raise ValueError("encoded history entity ID is not valid UTF-8") from exc
