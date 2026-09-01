# Provider Configs

This directory stores provider manifests for GTFS / GTFS-RT providers.

`octranspo.yaml` and `stm.yaml` are active V1 provider manifests. `sto.yaml` is
an inactive integration template pending its required bilingual source statement
and actual source-data update date. `list-providers` and scheduled publication
enumerate active manifests only; `seed-core` still records inactive manifests so
their database state remains explicit. Additional validated YAML files can be
added here.
