"""Resolve declared windows without scanning for additional inputs."""

from collections.abc import Sequence
from pathlib import Path

from transit_ops.batch.build import InputNeed
from transit_ops.batch.engine import BatchInput, InputRefused


def resolve_inputs(needs: Sequence[InputNeed], inputs_root: Path) -> tuple[BatchInput, ...]:
    root = inputs_root.resolve()
    grouped: dict[str, dict[str, Path]] = {}
    kinds: dict[str, str] = {}
    for need in needs:
        path = root / need.relation / (need.window.replace(":", "=", 1) + ".parquet")
        label = f"{need.relation} window {need.window}: {path}"
        if any(char in str(inputs_root) + str(path) for char in "*?[]{}"):
            raise InputRefused(f"glob path refused: {path}")
        if any(p.is_symlink() or p.is_junction() for p in (path.parent, path)):
            raise InputRefused(f"redirected input: {label}")
        canonical = path.resolve()
        if not canonical.is_relative_to(root) or canonical != path:
            raise InputRefused(f"input outside declared layout: {label}")
        if not path.is_file():
            raise InputRefused(f"missing input: {label}")
        if path.stat().st_nlink > 1:
            raise InputRefused(f"multiply-linked input: {label}")
        files = grouped.setdefault(need.relation, {})
        kind = (
            need.window.split(":")[0]
            if ":" in need.window
            else ("all" if need.window == "all" else "utc")
        )
        if need.relation in kinds and kinds[need.relation] != kind:
            raise InputRefused(f"mixed windows {tuple(files)} and {need.window}: {need.relation}")
        if need.window in files:
            raise InputRefused(f"duplicate input: {label}")
        kinds[need.relation] = kind
        files[need.window] = path
    return tuple(
        BatchInput(relation, tuple(files[w] for w in sorted(files)))
        for relation, files in sorted(grouped.items())
    )
