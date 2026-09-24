"""Prepare compatibility surfaces and their pointer-last publication stages."""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass

from sqlalchemy import Connection

from transit_ops.settings import Settings
from transit_ops.snapshots import builders, envelope
from transit_ops.snapshots.contract import (
    PayloadEnvelope,
    ReceiptAvailability,
    ReceiptsIndex,
    RouteReliabilityIndex,
)
from transit_ops.snapshots.protocols import CollectedItem, PublishStage, PutItem
from transit_ops.snapshots.serialization import snapshot_sha256


@dataclass(frozen=True)
class Compatibility:
    items: list[PutItem]
    routes: list[PutItem]
    stages: list[PublishStage]
    alerts: builders.AlertArchiveBundle


def build(conn: Connection, *, provider_id: str, settings: Settings, stamp: str) -> Compatibility:
    items, routes, stages, alerts = _build_items(
        conn,
        provider_id=provider_id,
        settings=settings,
        stamp=stamp,
    )
    envelope.stamp_envelope(items, provider_id=provider_id, stamp=stamp)
    _finalize_receipts_collection_generation(items)
    return Compatibility(items, routes, stages, alerts)


def _receipts_collection_generation_id(receipts: Mapping[str, object]) -> str:
    """Hash exact Receipt semantics while excluding only run-volatile envelope fields."""

    canonical: list[dict[str, object]] = []
    for date_str, receipt in sorted(receipts.items()):
        if isinstance(receipt, PayloadEnvelope):
            payload = receipt.model_dump(mode="json")
        elif isinstance(receipt, Mapping):
            payload = dict(receipt)
        else:
            raise TypeError("Receipt collection values must be payload models or mappings")
        payload.pop("generated_utc", None)
        payload.pop("publish_generation_id", None)
        canonical.append({"date": date_str, "payload": payload})
    return snapshot_sha256({"receipts": canonical})


def _finalize_receipts_collection_generation(items: Sequence[PutItem]) -> None:
    """Pin the Receipts index after every Receipt carries its published semantics."""

    receipts = {
        payload.date: payload
        for rel_key, payload, *_rest in items
        if rel_key.startswith("historic/receipts/")
        and rel_key != "historic/receipts/index.json"
        and hasattr(payload, "date")
    }
    index = next(
        (
            payload
            for rel_key, payload, *_rest in items
            if rel_key == "historic/receipts/index.json" and isinstance(payload, ReceiptsIndex)
        ),
        None,
    )
    if index is not None:
        index.collection_generation_id = _receipts_collection_generation_id(receipts)


def _build_items(
    conn: Connection, *, provider_id: str, settings: Settings, stamp: str
) -> tuple[list[PutItem], list[PutItem], list[PublishStage], builders.AlertArchiveBundle]:
    """Build compatibility surfaces sequentially on the caller's connection.

    Each discovery stage follows its complete child stage. The returned objects
    are stamped and receipt generations finalized before any gate or upload.
    """

    items: list[PutItem] = []

    flat_items: list[PutItem] = [
        (
            "historic/network_trend.json",
            builders.build_network_trend(conn, provider_id=provider_id, generated_utc=stamp),
            "historic",
        ),
        (
            "historic/hotspots.json",
            builders.build_hotspots(conn, provider_id, generated_utc=stamp),
            "historic",
        ),
        (
            "historic/repeat_offenders.json",
            builders.build_repeat_offenders(conn, provider_id, generated_utc=stamp),
            "historic",
        ),
        (
            "historic/alert_history.json",
            builders.build_alert_history(conn, provider_id, generated_utc=stamp),
            "historic",
        ),
        (
            "provenance.json",
            builders.build_provenance(conn, provider_id, generated_utc=stamp),
            "historic",
        ),
    ]

    route_payloads = builders.build_all_route_reliability(
        conn,
        provider_id=provider_id,
        generated_utc=stamp,
    )
    route_ids = sorted(route_payloads)
    route_items: list[PutItem] = [
        (
            f"historic/route_reliability/{route_id}.json",
            route_payloads[route_id],
            "historic",
        )
        for route_id in route_ids
    ]

    # Upload discovery after its route files; this index controls reliability badges.
    route_index_item = (
        "historic/route_reliability/index.json",
        RouteReliabilityIndex(
            route_ids=sorted(route_ids),
            generated_utc=stamp,
        ),
        "historic",
    )

    all_stops_rel = builders.build_stop_reliability(
        conn, provider_id=provider_id, generated_utc=stamp
    )
    stop_items: list[PutItem] = [
        (f"historic/stop_reliability/{stop_id}.json", stop_rel, "historic")
        for stop_id, stop_rel in sorted(all_stops_rel.items())
    ]

    all_receipts = builders.build_receipts(conn, provider_id, generated_utc=stamp)
    receipt_items: list[PutItem] = [
        (f"historic/receipts/{date_str}.json", receipt, "historic")
        for date_str, receipt in sorted(all_receipts.items())
    ]

    # Publish receipt availability after its date files; preserve unknown data and schedule state.
    receipts_generation_id = envelope.publish_generation_id(provider_id, stamp)
    receipts_available = [
        ReceiptAvailability(
            date=date_str,
            has_data=bool(
                receipt.affected_routes or receipt.affected_stops or receipt.otp_pct is not None
            ),
            has_schedule=bool(
                receipt.service_states is not None
                and receipt.service_states.scheduled_trip_days is not None
            ),
            publish_generation_id=receipts_generation_id,
        )
        for date_str, receipt in sorted(all_receipts.items())
    ]
    receipts_index_item = (
        "historic/receipts/index.json",
        ReceiptsIndex(
            dates=sorted(all_receipts),
            generated_utc=stamp,
            available=receipts_available,
        ),
        "historic",
    )

    # Publish immutable alert pages before their stable index.
    alert_archive = builders.build_alert_archive(
        conn,
        provider_id,
        generated_utc=stamp,
    )
    alert_page_items: list[PutItem] = [
        (path, page, "historic_immutable") for path, page in alert_archive.page_items
    ]
    alert_index_item = (
        "historic/alerts/index.json",
        alert_archive.index,
        "historic",
    )

    stages: list[PublishStage] = [
        (flat_items, "normal"),
        (route_items, "normal"),
        ([route_index_item], "normal"),
        (stop_items, "normal"),
        (receipt_items, "normal"),
        ([receipts_index_item], "normal"),
        (alert_page_items, "immutable"),
        ([alert_index_item], "normal"),
    ]
    for stage, _write_mode in stages:
        items.extend(stage)

    return items, route_items, stages, alert_archive


def _find_network_trend(items: Sequence[PutItem]) -> CollectedItem | None:
    """Return the (rel_key, payload) of the historic network_trend file, or None."""
    for rel_key, payload, *_ in items:
        if rel_key == "historic/network_trend.json":
            return (rel_key, payload)
    return None
