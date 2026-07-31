"""Offline proof for the pre-coalescing alert-language observation seam."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from sqlalchemy import create_engine

from transit_ops.silver.i3 import (
    RawI3AlertSnapshot,
    build_alert_language_observations,
    record_alert_language_observations,
)

pytestmark = [
    pytest.mark.filterwarnings(
        "ignore:The default date adapter is deprecated:DeprecationWarning"
    ),
    pytest.mark.filterwarnings(
        "ignore:The default datetime adapter is deprecated:DeprecationWarning"
    ),
]


def _snapshot(
    payload: object,
    *,
    captured_at_utc: datetime = datetime(2026, 7, 2, 12, tzinfo=UTC),
) -> RawI3AlertSnapshot:
    return RawI3AlertSnapshot(
        i3_alert_snapshot_id=804,
        provider_id="stm",
        provider_timezone="America/Toronto",
        captured_at_utc=captured_at_utc,
        raw_payload_json=payload,
    )


@pytest.mark.parametrize(
    ("alert", "expected"),
    [
        (
            {
                "id": "bilingual",
                "header": [
                    {"language": "fr-CA", "text": "Interruption"},
                    {"language": "en-CA", "text": "Disruption"},
                ],
            },
            (True, True, False),
        ),
        (
            {
                "id": "fr-description",
                "header": "Avis",
                "description": [{"language": "fra", "text": "Service interrompu"}],
            },
            (True, False, False),
        ),
        (
            {
                "id": "en-description",
                "description": {"en": "No service"},
            },
            (False, True, False),
        ),
        (
            {
                "id": "untagged",
                "header": {"text": "Avis"},
                "description": "Service interrompu",
            },
            (False, False, True),
        ),
        (
            {"id": "missing-text"},
            (False, False, True),
        ),
        (
            {
                "id": "empty-tags",
                "header": [{"language": "fr", "text": "   "}],
                "description": [{"language": "en", "text": None}],
            },
            (False, False, True),
        ),
    ],
)
def test_observation_buckets_require_nonempty_explicit_tags(
    alert: dict[str, object],
    expected: tuple[bool, bool, bool],
) -> None:
    """Break caught: untagged, missing, or empty text being claimed as FR/EN."""

    observations = build_alert_language_observations(
        _snapshot({"alerts": [alert]})
    )

    assert len(observations) == 1
    observation = observations[0]
    assert (
        observation.has_explicit_fr,
        observation.has_explicit_en,
        observation.undetermined,
    ) == expected


def test_observation_date_uses_the_exact_provider_local_midnight() -> None:
    """Break caught: UTC date bucketing moving Toronto observations a day early."""

    before_midnight = build_alert_language_observations(
        _snapshot(
            {"alerts": [{"id": "boundary", "header": "Avis"}]},
            captured_at_utc=datetime(2026, 7, 2, 3, 59, tzinfo=UTC),
        )
    )
    after_midnight = build_alert_language_observations(
        _snapshot(
            {"alerts": [{"id": "boundary", "header": "Avis"}]},
            captured_at_utc=datetime(2026, 7, 2, 4, 1, tzinfo=UTC),
        )
    )

    assert before_midnight[0].observation_date.isoformat() == "2026-07-01"
    assert after_midnight[0].observation_date.isoformat() == "2026-07-02"


def test_observation_date_survives_the_fall_back_dst_boundary() -> None:
    """S5-378 NB5: on 2026-11-01 Toronto falls back (EDT→EST, midnight moves
    05:00Z→05:30Z is wrong — the offset flips 04:00→05:00 mid-day); a UTC
    instant late that local day must still bucket to 2026-11-01."""

    late_fall_back_day = build_alert_language_observations(
        _snapshot(
            {"alerts": [{"id": "dst", "header": "Avis"}]},
            captured_at_utc=datetime(2026, 11, 2, 4, 59, tzinfo=UTC),
        )
    )
    next_local_day = build_alert_language_observations(
        _snapshot(
            {"alerts": [{"id": "dst", "header": "Avis"}]},
            captured_at_utc=datetime(2026, 11, 2, 5, 1, tzinfo=UTC),
        )
    )

    assert late_fall_back_day[0].observation_date.isoformat() == "2026-11-01"
    assert next_local_day[0].observation_date.isoformat() == "2026-11-02"


def test_scd_enrichment_fields_cannot_leak_into_an_observation() -> None:
    """Falsification: a naive SCD reader reports EN; the raw seam must not."""

    enriched_style_alert = {
        "id": "scd-leak",
        "header": "Avis non étiqueté",
        "description": {"text": "Service interrompu"},
        "alert_header_text_en": "English retained from an older observation",
        "description_text_en": "Still present only because Silver coalesced it",
    }
    naive_scd_reader_claims_en = bool(
        enriched_style_alert["alert_header_text_en"]
        or enriched_style_alert["description_text_en"]
    )

    (observation,) = build_alert_language_observations(
        _snapshot({"alerts": [enriched_style_alert]})
    )

    assert naive_scd_reader_claims_en is True
    assert observation.has_explicit_en is False
    assert observation.has_explicit_fr is False
    assert observation.undetermined is True


def test_same_snapshot_duplicate_logical_id_uses_the_last_source_observation() -> None:
    """Break caught: one INSERT batch carrying duplicate conflict keys."""

    observations = build_alert_language_observations(
        _snapshot(
            {
                "alerts": [
                    {
                        "id": "same-alert",
                        "header": [{"language": "fr", "text": "Avis"}],
                    },
                    {
                        "id": "same-alert",
                        "header": [{"language": "en", "text": "Notice"}],
                    },
                ]
            }
        )
    )

    assert len(observations) == 1
    assert observations[0].alert_logical_id == "id:same-alert"
    assert observations[0].has_explicit_en is True
    assert observations[0].has_explicit_fr is False


def test_no_provider_id_falls_back_to_enrichment_neutral_content_identity() -> None:
    """Break caught: adding EN alone minting a second logical observation."""

    base = {
        "header": [{"language": "fr", "text": "Interruption"}],
        "description": [{"language": "fr", "text": "Service interrompu"}],
    }
    enriched = {
        "header": [
            {"language": "fr", "text": "Interruption"},
            {"language": "en", "text": "Disruption"},
        ],
        "description": [
            {"language": "fr", "text": "Service interrompu"},
            {"language": "en", "text": "No service"},
        ],
    }

    (without_en,) = build_alert_language_observations(
        _snapshot({"alerts": [base]})
    )
    (with_en,) = build_alert_language_observations(
        _snapshot({"alerts": [enriched]})
    )

    assert without_en.alert_logical_id.startswith("content:")
    assert without_en.alert_logical_id == with_en.alert_logical_id


def test_no_provider_id_identity_survives_english_arriving_as_a_new_key() -> None:
    """Break caught (S5-378 B2 shape B): an EN-only field left behind as
    present-and-empty minting a second logical id — the day would then carry
    two rows for one real alert and halve the EN percentage."""

    base = {"header": [{"language": "fr", "text": "Interruption"}]}
    enriched = {
        "header": [{"language": "fr", "text": "Interruption"}],
        "description": [{"language": "en", "text": "No service"}],
    }

    (without_en,) = build_alert_language_observations(_snapshot({"alerts": [base]}))
    (with_en,) = build_alert_language_observations(
        _snapshot({"alerts": [enriched]})
    )

    assert without_en.alert_logical_id == with_en.alert_logical_id
    assert with_en.has_explicit_en


def test_no_provider_id_identity_survives_single_object_english_translation() -> None:
    """Break caught (S5-378 B2 shape F): the single-object translation form
    ({"language": "en", "text": ...}) — accepted by _has_explicit_language —
    never being stripped from the identity."""

    base = {"header": [{"language": "fr", "text": "Interruption"}]}
    enriched = {
        "header": [{"language": "fr", "text": "Interruption"}],
        "description": {"language": "en", "text": "No service"},
    }

    (without_en,) = build_alert_language_observations(_snapshot({"alerts": [base]}))
    (with_en,) = build_alert_language_observations(
        _snapshot({"alerts": [enriched]})
    )

    assert without_en.alert_logical_id == with_en.alert_logical_id
    assert with_en.has_explicit_en


def test_no_provider_id_keeps_distinct_english_only_alerts_separate() -> None:
    """Break caught: stripping the only identity text collapsing two alerts."""

    observations = build_alert_language_observations(
        _snapshot(
            {
                "alerts": [
                    {
                        "header": [
                            {"language": "en", "text": "Route 1 is closed"}
                        ]
                    },
                    {
                        "header": [
                            {"language": "en", "text": "Route 2 is delayed"}
                        ]
                    },
                ]
            }
        )
    )

    assert len(observations) == 2
    assert len({item.alert_logical_id for item in observations}) == 2
    assert all(item.has_explicit_en for item in observations)


def _sqlite_raw_tables(connection) -> None:  # noqa: ANN001
    connection.exec_driver_sql("ATTACH DATABASE ':memory:' AS raw")
    connection.exec_driver_sql(
        """
        CREATE TABLE raw.alert_language_observations (
            provider_id TEXT NOT NULL,
            alert_logical_id TEXT NOT NULL,
            observation_date DATE NOT NULL,
            has_explicit_fr BOOLEAN NOT NULL,
            has_explicit_en BOOLEAN NOT NULL,
            undetermined BOOLEAN NOT NULL,
            observed_at_utc TIMESTAMP NOT NULL,
            PRIMARY KEY (provider_id, alert_logical_id, observation_date)
        )
        """
    )
    connection.exec_driver_sql(
        """
        CREATE TABLE raw.alert_feed_observations (
            provider_id TEXT NOT NULL,
            observation_date DATE NOT NULL,
            alert_count INTEGER NOT NULL,
            observed_at_utc TIMESTAMP NOT NULL,
            PRIMARY KEY (provider_id, observation_date)
        )
        """
    )


def test_upsert_is_latest_wins_for_alert_and_empty_feed_observations() -> None:
    """Break caught: a delayed Bronze replay overwriting newer daily evidence."""

    engine = create_engine("sqlite+pysqlite:///:memory:")
    older = _snapshot(
        {
            "alerts": [
                {
                    "id": "latest",
                    "header": [{"language": "fr", "text": "Avis"}],
                }
            ]
        },
        captured_at_utc=datetime(2026, 7, 2, 12, tzinfo=UTC),
    )
    newest_empty = _snapshot(
        {"alerts": []},
        captured_at_utc=datetime(2026, 7, 2, 14, tzinfo=UTC),
    )
    newer_alert = _snapshot(
        {
            "alerts": [
                {
                    "id": "latest",
                    "header": [{"language": "en", "text": "Notice"}],
                }
            ]
        },
        captured_at_utc=datetime(2026, 7, 2, 13, tzinfo=UTC),
    )

    with engine.begin() as connection:
        _sqlite_raw_tables(connection)
        record_alert_language_observations(connection, snapshot=older)
        record_alert_language_observations(connection, snapshot=newer_alert)
        record_alert_language_observations(connection, snapshot=newest_empty)
        record_alert_language_observations(connection, snapshot=older)

        alert_row = connection.exec_driver_sql(
            """
            SELECT has_explicit_fr, has_explicit_en, undetermined, observed_at_utc
            FROM raw.alert_language_observations
            """
        ).one()
        feed_row = connection.exec_driver_sql(
            """
            SELECT alert_count, observed_at_utc
            FROM raw.alert_feed_observations
            """
        ).one()

    assert tuple(alert_row[:3]) == (0, 1, 0)
    assert str(alert_row.observed_at_utc).startswith("2026-07-02 13:00:00")
    assert feed_row.alert_count == 0
    assert str(feed_row.observed_at_utc).startswith("2026-07-02 14:00:00")


def test_latest_upsert_clears_english_when_the_new_raw_observation_has_none() -> None:
    """Falsification: latest raw evidence must not retain earlier English."""

    engine = create_engine("sqlite+pysqlite:///:memory:")
    with_english = _snapshot(
        {
            "alerts": [
                {
                    "id": "clears-en",
                    "header": [{"language": "en", "text": "No service"}],
                }
            ]
        },
        captured_at_utc=datetime(2026, 7, 2, 12, tzinfo=UTC),
    )
    later_untagged = _snapshot(
        {
            "alerts": [
                {
                    "id": "clears-en",
                    "header": {"text": "Service interrompu"},
                }
            ]
        },
        captured_at_utc=datetime(2026, 7, 2, 13, tzinfo=UTC),
    )

    with engine.begin() as connection:
        _sqlite_raw_tables(connection)
        record_alert_language_observations(connection, snapshot=with_english)
        record_alert_language_observations(connection, snapshot=later_untagged)
        row = connection.exec_driver_sql(
            """
            SELECT has_explicit_fr, has_explicit_en, undetermined, observed_at_utc
            FROM raw.alert_language_observations
            """
        ).one()

    assert tuple(row[:3]) == (0, 0, 1)
    assert str(row.observed_at_utc).startswith("2026-07-02 13:00:00")
