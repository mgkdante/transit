"""Offline SQL boundary: downloads do not certify the data being served."""
from sqlalchemy import create_engine, text

from transit_ops.snapshots.builders.live import _feed_captured_utc


def test_successful_download_cannot_renew_unloaded_or_retained_serving_data():
    engine = create_engine('sqlite://')
    with engine.begin() as conn:
        for schema in ('raw', 'core', 'gold'):
            conn.exec_driver_sql(f"ATTACH DATABASE ':memory:' AS {schema}")
        for sql in (
            'CREATE TABLE core.feed_endpoints (feed_endpoint_id int, endpoint_key text)',
            'CREATE TABLE raw.ingestion_runs (ingestion_run_id int, provider_id text, '
            'feed_endpoint_id int, status text, run_kind text, started_at_utc text, '
            'completed_at_utc text)',
            'CREATE TABLE gold.realtime_serving_state (provider_id text, endpoint_key text, '
            'captured_at_utc text)',
            'CREATE TABLE raw.alert_feed_observations (provider_id text, observation_date text, '
            'observed_at_utc text, alert_count int)',
        ):
            conn.exec_driver_sql(sql)
        old, fresh = '2026-11-04T12:00:00Z', '2026-11-04T12:20:00Z'
        for endpoint_id, endpoint in enumerate(('trip_updates', 'i3_alerts'), 1):
            conn.execute(text('INSERT INTO core.feed_endpoints VALUES (:id, :key)'),
                         {'id': endpoint_id, 'key': endpoint})
            conn.execute(text('INSERT INTO raw.ingestion_runs VALUES '
                              '(:id, :p, :id, :status, :kind, :at, :at)'),
                         {'id': endpoint_id, 'p': 'stm', 'status': 'succeeded',
                          'kind': endpoint, 'at': fresh})
            assert _feed_captured_utc(conn, 'stm', endpoint) is None
        conn.execute(text('INSERT INTO gold.realtime_serving_state VALUES (:p, :key, :at)'),
                     {'p': 'stm', 'key': 'trip_updates', 'at': old})
        # A successful empty alert load has a receipt even though it has no alert rows.
        conn.execute(text('INSERT INTO raw.alert_feed_observations VALUES '
                          '(:p, :day, :at, 0)'),
                     {'p': 'stm', 'day': '2026-11-04', 'at': old})
        assert _feed_captured_utc(conn, 'stm', 'trip_updates') == old
        assert _feed_captured_utc(conn, 'stm', 'i3_alerts') == old
        conn.execute(text('UPDATE gold.realtime_serving_state SET captured_at_utc=:at'),
                     {'at': fresh})
        assert _feed_captured_utc(conn, 'stm', 'trip_updates') == fresh
        assert _feed_captured_utc(conn, 'stm', 'i3_alerts') == old
    engine.dispose()
