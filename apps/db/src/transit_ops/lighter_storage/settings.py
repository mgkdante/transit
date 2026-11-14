from pydantic import BaseModel, ConfigDict, Field

from transit_ops.batch.families.settings import LaneSettings as FamiliesSettings
from transit_ops.batch.settings import LaneSettings as BatchSettings
from transit_ops.control.settings import LaneSettings as ControlSettings
from transit_ops.lake.settings import LaneSettings as CopyOutSettings
from transit_ops.live.settings import LaneSettings as LiveSettings
from transit_ops.operations.settings import LaneSettings as OperationsSettings
from transit_ops.static.settings import LaneSettings as StaticSettings


class LighterStorageSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")

    copy_out: CopyOutSettings = Field(default_factory=CopyOutSettings)
    batch: BatchSettings = Field(default_factory=BatchSettings)
    families: FamiliesSettings = Field(default_factory=FamiliesSettings)
    live: LiveSettings = Field(default_factory=LiveSettings)
    control: ControlSettings = Field(default_factory=ControlSettings)
    static: StaticSettings = Field(default_factory=StaticSettings)
    operations: OperationsSettings = Field(default_factory=OperationsSettings)
