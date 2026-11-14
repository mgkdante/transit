"""Resolve declared windows without scanning for additional inputs."""

from collections.abc import Sequence
from pathlib import Path

from transit_ops.batch.build import InputNeed
from transit_ops.batch.engine import BatchInput, InputRefused


def resolve_inputs(needs: Sequence[InputNeed], inputs_root: Path) -> tuple[BatchInput, ...]:
    grouped: dict[str, list[Path]] = {}
    for need in needs:
        path = inputs_root / need.relation / (need.window.replace(":", "=", 1) + ".parquet")
        if any(char in str(path) + str(path.resolve()) for char in "*?[]{}"):
            raise InputRefused(f"glob path refused: {path}")
        path = path.resolve()
        if not path.is_file():
            raise InputRefused(f"missing input: {need.relation} window {need.window}: {path}")
        files = grouped.setdefault(need.relation, [])
        if path in files:
            raise InputRefused(f"duplicate input: {need.relation} window {need.window}: {path}")
        files.append(path)
    return tuple(
        BatchInput(relation, tuple(sorted(files))) for relation, files in sorted(grouped.items())
    )
