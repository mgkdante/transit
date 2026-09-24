"""Live publication preserves raw quantiles and rounded-minute bin semantics."""

import pytest
from _sqlfakes import NamedQueryConn

from transit_ops.snapshots.builders import build_network


@pytest.mark.parametrize(
    ("seconds", "median", "p90", "counts"),
    [
        ([30], 1, 1, [0, 0, 0, 1, 0, 0, 0, 0]),
        ([-30], -1, -1, [0, 0, 1, 0, 0, 0, 0, 0]),
        ([150], 3, 3, [0, 0, 0, 0, 1, 0, 0, 0]),
        ([-150], -3, -3, [0, 1, 0, 0, 0, 0, 0, 0]),
        # Quantiles use raw .4/1.6 min; quantizing observations first gives p90=2.
        ([24, 96], 1, 1, [0, 0, 0, 1, 1, 0, 0, 0]),
        (
            [269.4, 270, 270.6, 869.4, 870, 870.6],
            10,
            15,
            [0, 0, 0, 0, 1, 2, 1, 2],
        ),
    ],
)
def test_live_delay_rounding_quantiles_and_bin_boundaries(seconds, median, p90, counts):
    result = build_network(
        NamedQueryConn(
            {"network.live.delays": [{"avg_delay_seconds": value} for value in seconds]}
        ),
        generated_utc="2026-09-12T12:00:00Z",
    )

    assert result.delay_p50_min == median
    assert result.delay_p90_min == p90
    assert [bucket.count for bucket in result.delay_histogram] == counts
    assert sum(counts) == len(seconds)
    assert [(bucket.lo_min, bucket.hi_min) for bucket in result.delay_histogram] == [
        (None, -5), (-5, -2), (-2, 0), (0, 2), (2, 5), (5, 10), (10, 15), (15, None)
    ]
