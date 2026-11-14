from pathlib import Path

from pydantic import BaseModel, ConfigDict, PositiveInt


class LaneSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")
    local_dir: Path | None = None
    duckdb_memory_limit_mb: PositiveInt | None = None
    duckdb_threads: PositiveInt | None = None
    temp_dir_max_mb: PositiveInt | None = None
