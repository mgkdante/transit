from pydantic import BaseModel, ConfigDict


class LaneSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")
