from __future__ import annotations

import pytest

from transit_ops.db.target_safety import assert_disposable_test_url


@pytest.mark.parametrize(
    "base,role",
    [("transit_ci", "transit_ci"), ("transit_test", "postgres"), ("transit_repro", "repro")],
)
def test_worker_database_retains_disposable_guard(base: str, role: str) -> None:
    environment = {"TRANSIT_TEST_DATABASE_DISPOSABLE": "I_UNDERSTAND_THIS_DATABASE_IS_DISPOSABLE"}
    url = f"postgresql+psycopg://{role}@127.0.0.1/{base}_xdist_0123456789abcdef_gw0"
    assert_disposable_test_url(url, environment)
    with pytest.raises(RuntimeError):
        assert_disposable_test_url(url, {})
    with pytest.raises(RuntimeError):
        assert_disposable_test_url(url.replace("127.0.0.1", "remote.invalid"), environment)


@pytest.mark.parametrize(
    "name",
    [
        "transit_ci_xdist_bad_gw0",
        "production_xdist_0123456789abcdef_gw0",
        "transit_ci_xdist_0123456789abcdef_gw0_extra",
    ],
)
def test_arbitrary_worker_names_are_not_disposable(name: str) -> None:
    with pytest.raises(RuntimeError):
        assert_disposable_test_url(
            f"postgresql://transit_ci@localhost/{name}",
            {
                "TRANSIT_TEST_DATABASE_DISPOSABLE": "I_UNDERSTAND_THIS_DATABASE_IS_DISPOSABLE",
            },
        )
