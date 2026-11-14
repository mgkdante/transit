from collections.abc import Mapping
from types import MappingProxyType
from typing import Literal

RuleMode = Literal["count", "apply"]
NORMALIZER_VERSION = 1
# Execution order is separate from fingerprint serialization order. No rules run yet.
RULE_ORDER = ("N7", "N6", "N8", "N1", "N9", "N5", "N2", "N3")
WORKER_MODES: Mapping[str, RuleMode] = MappingProxyType(dict.fromkeys(RULE_ORDER, "count"))
PASS_MODES: Mapping[str, RuleMode] = MappingProxyType(dict.fromkeys(RULE_ORDER, "apply"))


def serialize_modes(modes: Mapping[str, RuleMode]) -> str:
    if set(modes) - set(RULE_ORDER) or any(v not in ("count", "apply") for v in modes.values()):
        raise ValueError("Unknown normalizer rule or mode")
    for rule, dependencies in (("N2", ("N5",)), ("N3", ("N2", "N5"))):
        if modes.get(rule) == "apply" and any(modes.get(d) != "apply" for d in dependencies):
            raise ValueError(f"{rule} requires apply dependencies")
    return ";".join(f"{rule}={modes[rule]}" for rule in sorted(modes))


def normalizer_fingerprint(modes: Mapping[str, RuleMode]) -> str:
    return f"{NORMALIZER_VERSION}:{serialize_modes(modes)}"
