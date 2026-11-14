from importlib import import_module
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from transit_ops.providers.declaration import (
        SITE_LOCALES,
        DeclarationError,
        Feed,
        Provider,
        Providers,
        load_providers,
    )
    from transit_ops.providers.normalize import (
        Fill,
        NormalizedCapture,
        RawCapture,
        RuleOutcome,
        ScheduleIdentity,
        normalize_capture,
    )
    from transit_ops.providers.registry import ProviderRegistry, load_provider_manifest

__all__ = [
    "ProviderRegistry",
    "load_provider_manifest",
    "load_providers",
    "Providers",
    "Provider",
    "Feed",
    "DeclarationError",
    "SITE_LOCALES",
    "normalize_capture",
    "RawCapture",
    "NormalizedCapture",
    "Fill",
    "RuleOutcome",
    "ScheduleIdentity",
]


def __getattr__(name: str) -> object:
    for owner, names in (
        ("registry", "ProviderRegistry load_provider_manifest"),
        ("declaration", "SITE_LOCALES DeclarationError Feed Provider Providers load_providers"),
        (
            "normalize",
            "Fill NormalizedCapture RawCapture RuleOutcome ScheduleIdentity normalize_capture",
        ),
    ):
        if name in names.split():
            value: object = getattr(import_module(f"{__name__}.{owner}"), name)
            return value
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
