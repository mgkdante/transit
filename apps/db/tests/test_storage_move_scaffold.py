import hashlib
import importlib
import json
import os
import subprocess
import sys

import pytest
from pydantic import ValidationError
from typer.main import get_command
from typer.testing import CliRunner

from transit_ops.cli import app
from transit_ops.settings import Settings

LANES = "lake batch batch-families live-engine lake-control lake-static lake-ops".split()
KEYS = "copy_out batch families live control static operations".split()
# Recorded through Typer's public command API on origin/main before implementation.
BASELINE = """backup-database build-gold-marts build-warm-rollups capture-realtime daily-run
db-storage-report db-test download-latest-backup gc-historic-snapshots history-close-runs
history-probe-pack history-seal history-verify init-db list-backups list-pipeline-switches
list-providers load-realtime-silver measure-alert-language-coverage prune-bronze-storage
prune-gold-storage prune-i3-storage prune-silver-storage prune-storage prune-warm-rollup-storage
publish-all publish-providers publish-snapshot rebuild-warm-rollups recover recover-delay-sums
refresh-gold-realtime repair-delay-periods replay-realtime-silver retention-proof-report
run-pruner-loop run-realtime-cycle run-realtime-worker run-static-pipeline seed-core
set-pipeline-switch show-config show-pipeline-switch show-provider sync-alert-archive
vacuum-storage validate-snapshots validate-static-feeds verify-backup-freshness
verify-historic-publish""".split()
FAMILIES = """route_spine_hours stop_spine_hours percentiles_histograms
cancellations_service_states headways span_skipped_stops occupancy_crowding repeat_offenders
receipts hotspots trend_history_partitions alerts_provenance""".split()
NAMES = [
    "Route spine and hours",
    "Stop spine and hours",
    "Percentiles and histograms",
    "Cancellations and service states",
    "Headways",
    "Span and skipped stops",
    "Occupancy and crowding",
    "Repeat offenders",
    "Receipts",
    "Hotspots",
    "Trend and history partitions",
    "Alerts and provenance",
]
runner = CliRunner()
HELP = dict(
    zip(
        [
            "history-probe-pack",
            "history-seal",
            "list-pipeline-switches",
            "show-pipeline-switch",
            "set-pipeline-switch",
        ],
        [
            "906d488f6140df6855d4d9945c0efff0b134ebe0a30de89b20c6ba364e58c1f9",
            "c67bc3162de1fc73739115a524704e980532a395ae04c87aed2814a7bb49d291",
            "8c788e87e2c541d0553a5d2e82d39f85693e8314f6aca8291154d9bbdee5d34e",
            "8bf6714ee3551773f456edc066e1e0e2fbee05c5f6e392849a2a9f32323e0f89",
            "b7316b3a0885c233a4b3e2ce657c8326a10afbe5ceaefc07ed5b62d511646f68",
        ],
        strict=True,
    )
)


def registry():
    return importlib.import_module("transit_ops.batch.families.registry")


@pytest.mark.parametrize("lane", LANES)
def test_root_cli_registers_all_seven_storage_move_lanes(lane):
    assert lane in get_command(app).commands
    result = runner.invoke(app, [lane, "--help"])
    assert result.exit_code == 0, result.output
    assert "Usage:" in result.output


@pytest.mark.parametrize("lane", LANES)
def test_empty_lane_invocation_performs_no_work(lane, monkeypatch):
    import boto3
    import psycopg
    import sqlalchemy.engine

    def refuse(*args, **kwargs):
        pytest.fail("dormant lane attempted I/O")

    monkeypatch.setattr(boto3.session.Session, "client", refuse)
    monkeypatch.setattr(psycopg, "connect", refuse)
    monkeypatch.setattr(sqlalchemy.engine.Engine, "connect", refuse)
    result = runner.invoke(app, [lane])
    assert result.exit_code == 0, result.exception
    assert "Usage:" in result.output


def test_existing_cli_commands_keep_their_registration_and_help():
    assert set(get_command(app).commands) - set(LANES) == set(BASELINE)
    for name, digest in HELP.items():
        result = runner.invoke(app, [name, "--help"])
        assert result.exit_code == 0
        assert hashlib.sha256(result.output.encode()).hexdigest() == digest


NO_IO_SCRIPT = """
import builtins, io, os, socket, sys
import boto3, psycopg, sqlalchemy.engine
from typer.testing import CliRunner
def refuse(*a, **k):
    raise AssertionError('external I/O attempted')
def guarded(original):
    def opened(path, mode='r', *a, **k):
        if any(flag in mode for flag in 'wax+'):
            refuse()
        return original(path, mode, *a, **k)
    return opened
builtins.open = guarded(builtins.open)
io.open = guarded(io.open)
original_open = os.open
def os_open(path, flags, *a, **k):
    if flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC | os.O_APPEND):
        refuse()
    return original_open(path, flags, *a, **k)
os.open = os_open
os.mkdir = os.unlink = os.rename = os.replace = refuse
socket.socket.connect = socket.create_connection = refuse
boto3.session.Session.client = boto3.session.Session.resource = refuse
psycopg.connect = sqlalchemy.engine.Engine.connect = refuse
sys.modules['duckdb'] = None
from transit_ops.cli import app
from transit_ops.settings import Settings
Settings(_env_file=None)
assert not any('transit_ops.batch.families.' + n in sys.modules for n in FAMILIES)
assert 'transit_ops.batch.families.registry' not in sys.modules
runner = CliRunner()
for lane in LANES:
    for args in ([lane], [lane, '--help']):
        result = runner.invoke(app, args)
        assert result.exit_code == 0, (args, result.exception)
        assert 'Usage:' in result.output
"""


def test_lane_imports_work_without_duckdb_or_external_io():
    env = {k: v for k, v in os.environ.items() if k not in Settings.model_fields}
    result = subprocess.run(
        [
            sys.executable,
            "-B",
            "-c",
            "LANES = " + repr(LANES) + "\nFAMILIES = " + repr(FAMILIES) + "\n" + NO_IO_SCRIPT,
        ],
        env=env,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr


def test_lighter_storage_settings_are_empty_by_default(monkeypatch):
    for key in Settings.model_fields:
        monkeypatch.delenv(key, raising=False)
    settings = Settings(_env_file=None)
    assert settings.LIGHTER_STORAGE.model_dump() == dict.fromkeys(KEYS, {})
    digest = "bcc76314f94600369bb408c954ba1c00a216fc0666a4a452dce429b133f7353c"
    for values in (settings.model_dump(exclude={"LIGHTER_STORAGE"}), settings.display_dict()):
        assert hashlib.sha256(json.dumps(values, sort_keys=True).encode()).hexdigest() == digest


@pytest.mark.parametrize("lane", [None, *KEYS])
def test_lighter_storage_settings_reject_unknown_nested_keys(lane, monkeypatch):
    monkeypatch.setenv(
        "LIGHTER_STORAGE", json.dumps({"unknown": 1} if lane is None else {lane: {"unknown": 1}})
    )
    with pytest.raises(ValidationError, match="extra_forbidden"):
        Settings(_env_file=None)
    monkeypatch.setenv("LIGHTER_STORAGE", json.dumps(dict.fromkeys(KEYS, {})))
    assert Settings(_env_file=None).LIGHTER_STORAGE.model_dump() == dict.fromkeys(KEYS, {})


def test_family_registry_names_the_twelve_planned_packets():
    assert {
        key: (slot.packet_id, slot.display_name, slot.module_path)
        for key, slot in registry().FAMILIES.items()
    } == {
        key: (f"LS2.{i}", name, f"transit_ops.batch.families.{key}")
        for i, (key, name) in enumerate(zip(FAMILIES, NAMES, strict=True), 5)
    }
    assert len({s.module_path for s in registry().FAMILIES.values()}) == len(FAMILIES)


def test_family_registry_is_immutable_and_unknown_id_fails():
    with pytest.raises(TypeError):
        registry().FAMILIES["unknown"] = object()
    with pytest.raises(AttributeError):
        registry().FAMILIES["headways"].packet_id = "other"
    with pytest.raises(registry().UnknownFamilyError, match="unknown"):
        registry().resolve_builder("unknown")


def test_all_family_slots_are_explicitly_unimplemented():
    for family in FAMILIES:
        assert registry().resolve_builder(family) is None


def test_replacing_one_family_builder_needs_no_registry_edit(monkeypatch):
    slot = importlib.import_module("transit_ops.batch.families.headways")
    builder = object()
    monkeypatch.setattr(slot, "builder", builder)
    assert registry().resolve_builder("headways") is builder
    assert all(registry().resolve_builder(f) is None for f in FAMILIES if f != "headways")
