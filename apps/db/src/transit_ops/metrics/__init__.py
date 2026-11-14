from .model import AbsenceKey as AbsenceKey
from .model import Arithmetic as Arithmetic
from .model import Bilingual as Bilingual
from .model import Floor as Floor
from .model import Metric as Metric
from .model import Series as Series
from .model import Source as Source
from .registry import Registry as Registry

REGISTRY = Registry()
metric = REGISTRY.metric
series = REGISTRY.series
arithmetic = REGISTRY.arithmetic
sources_for = REGISTRY.sources_for
describe = REGISTRY.describe
measure_spec = REGISTRY.measure_spec
metric_pin = REGISTRY.metric_pin
series_pin = REGISTRY.series_pin
validate_pins = REGISTRY.validate_pins
wording_sha256 = REGISTRY.wording_sha256
export_registry = REGISTRY.export_registry
