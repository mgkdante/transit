def test_retention_bumped_to_14():
    from transit_ops.settings import Settings

    s = Settings(_env_file=None, DATABASE_URL="postgresql://u:p@example.com/transit")
    assert s.GOLD_FACT_RETENTION_DAYS == 14
