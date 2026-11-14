"""Catalog value types shared by the reader and pure inventory comparison."""

from dataclasses import dataclass
from typing import Literal


@dataclass(frozen=True)
class Column:
    name: str
    pg_type: str


@dataclass(frozen=True)
class CatalogTable:
    name: str
    kind: Literal["table", "partitioned", "view", "materialized_view", "foreign", "other"]
    columns: tuple[Column, ...]
    primary_key: tuple[str, ...]
