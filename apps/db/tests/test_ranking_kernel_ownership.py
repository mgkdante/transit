"""Architecture ownership for the shared current/history ranking doctrine."""

from __future__ import annotations

import ast
from pathlib import Path

_BUILDERS = Path(__file__).resolve().parents[1] / "src/transit_ops/snapshots/builders/historic"
_KERNEL = _BUILDERS / "ranking_kernel.py"


def _imports(path: Path, module: str) -> set[str]:
    tree = ast.parse(path.read_text())
    return {
        alias.name
        for node in ast.walk(tree)
        if isinstance(node, ast.ImportFrom) and node.module == module
        for alias in node.names
    }


def _defined_functions(path: Path) -> set[str]:
    tree = ast.parse(path.read_text())
    return {
        node.name for node in tree.body if isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef)
    }


def test_shared_ranking_doctrine_has_one_public_owner() -> None:
    assert _KERNEL.is_file(), "shared ranking doctrine needs a public kernel module"

    small_surfaces = _BUILDERS / "small_surfaces.py"
    hotspot_history = _BUILDERS / "hotspots_history.py"
    offender_history = _BUILDERS / "repeat_offenders_history.py"
    kernel_module = "transit_ops.snapshots.builders.historic.ranking_kernel"
    private_surface_module = "transit_ops.snapshots.builders.historic.small_surfaces"

    assert {
        "HOTSPOT_PEAK_SHIFTS",
        "SENTINEL_ENTITY_IDS",
        "build_hotspot_kind_ladder",
        "merge_hotspot_grain",
        "otp_delta_points",
    } <= _imports(hotspot_history, kernel_module)
    assert {
        "OFFENDER_SEVERITY_CRITICAL_AVG_SECONDS",
        "OFFENDER_SEVERITY_CRITICAL_RECURRENCE",
        "OFFENDER_SEVERITY_HIGH_RECURRENCE",
        "OFFENDERS_TRAY_CAP",
        "build_offender_kind_ladder",
    } <= _imports(offender_history, kernel_module)
    assert not _imports(hotspot_history, private_surface_module)
    assert not _imports(offender_history, private_surface_module)

    kernel_imports = _imports(small_surfaces, kernel_module)
    assert {
        "build_hotspot_kind_ladder",
        "build_offender_kind_ladder",
        "merge_hotspot_grain",
    } <= kernel_imports
    assert not any(name.startswith("_") for name in kernel_imports)
    assert {
        "_hotspot_kind_ladder",
        "_merge_grain",
        "_offender_kind_ladder",
    }.isdisjoint(_defined_functions(small_surfaces))


def test_offender_ladder_has_no_history_only_policy_flag() -> None:
    assert _KERNEL.is_file(), "shared ranking doctrine needs a public kernel module"
    tree = ast.parse(_KERNEL.read_text())
    function = next(
        node
        for node in tree.body
        if isinstance(node, ast.FunctionDef) and node.name == "build_offender_kind_ladder"
    )
    assert "history_route_tie" not in {
        argument.arg for argument in (*function.args.args, *function.args.kwonlyargs)
    }
