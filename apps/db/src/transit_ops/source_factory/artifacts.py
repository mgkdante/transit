from __future__ import annotations

import hashlib
import json
from pathlib import Path

from transit_ops.source_factory.models import ArtifactRef


def write_json_artifact(path: Path, payload: object) -> ArtifactRef:
    path.parent.mkdir(parents=True, exist_ok=True)

    body = json.dumps(payload, allow_nan=False, indent=2, sort_keys=True)
    content = f"{body}\n".encode()
    path.write_bytes(content)

    return ArtifactRef(
        path=path,
        byte_size=len(content),
        sha256=hashlib.sha256(content).hexdigest(),
    )
