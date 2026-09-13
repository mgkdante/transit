"""Package materialized test bundles without restamping or copying their children."""

from transit_ops.snapshots import builders, gate
from transit_ops.snapshots.builders.historic.history_common import history_pointer_path
from transit_ops.snapshots.builders.historic.line_history import LineHistoryBundle
from transit_ops.snapshots.builders.historic.stop_history import StopHistoryBundle
from transit_ops.snapshots.contract import AlertArchiveIndex, HistoricCollectionIndex, ReceiptsIndex
from transit_ops.snapshots.historic_graph import HistoricGraph, LineHistoryFamily, StopHistoryFamily
from transit_ops.snapshots.historic_streams import LineParentIndexes


def graph_from_bundles(
    *,
    alerts: AlertArchiveIndex,
    receipts: ReceiptsIndex,
    network: HistoricCollectionIndex,
    lines: LineHistoryBundle,
    stops: StopHistoryBundle,
    hotspots: HistoricCollectionIndex,
    repeat_offenders: HistoricCollectionIndex,
) -> HistoricGraph:
    line_paths = {entity.entity_id: entity.index_path for entity in lines.directory.entities}
    stop_paths = {entity.entity_id: entity.index_path for entity in stops.directory.entities}
    pointers = builders.StopHistoryPointerSummary()
    summary = gate.StopHistoryDirectorySummary()
    for index in stops.indexes:
        path = stop_paths[index.entity_id]
        pointers.observe(index, index_path=path)
        summary.observe(index, index_path=path)
    return HistoricGraph(
        alerts=("historic/alerts/index.json", alerts),
        receipts=("historic/receipts/index.json", receipts),
        network=("historic/history/network/index.json", network),
        lines=LineHistoryFamily(
            index=("historic/history/lines/index.json", lines.directory),
            children=LineParentIndexes(
                lines.indexes,
                line_paths,
                [(line_paths[index.entity_id], index) for index in lines.indexes],
            ),
        ),
        stops=StopHistoryFamily(
            index=("historic/history/stops/index.json", stops.directory),
            pointers=pointers,
            summary=summary,
        ),
        hotspots=(history_pointer_path("historic/history/hotspots", hotspots), hotspots),
        repeat_offenders=(
            history_pointer_path("historic/history/repeat_offenders", repeat_offenders),
            repeat_offenders,
        ),
    )
