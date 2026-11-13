from dataclasses import FrozenInstanceError, asdict, fields, replace
from datetime import UTC, date, datetime
from inspect import Parameter, signature

import pytest
from history_reader_fakes import fake_capture, fake_feed_day, fake_poll, fake_processing

from transit_ops.history.reader import Capture, FeedDay, Poll, ProcessingRecord, WindowNotAvailable


def test_fakes_have_the_fields_of_the_real_types():
    for factory, kind in (
        (fake_feed_day, FeedDay),
        (fake_poll, Poll),
        (fake_capture, Capture),
        (fake_processing, ProcessingRecord),
    ):
        value = factory()
        assert isinstance(value, kind)
        given_fields = asdict(value)
        given_fields.update(provider_id="another", endpoint_key="another")
        for field in fields(kind):
            current = given_fields[field.name]
            if isinstance(current, int) and not isinstance(current, bool):
                given_fields[field.name] = 7
            elif isinstance(current, datetime):
                given_fields[field.name] = datetime(2026, 2, 3, tzinfo=UTC)
        if kind is FeedDay:
            given_fields.update(
                utc_date=date(2026, 2, 3),
                form="archive_copy",
                content_version=7,
                pending_change=True,
                bytes_verified=True,
            )
        elif kind is Capture:
            given_fields.update(payload=b"different", checksum_sha256="a" * 64)
        assert list(signature(factory).parameters) == [f.name for f in fields(kind)]
        for field in fields(kind):
            parameter = signature(factory).parameters[field.name]
            assert parameter.kind == Parameter.KEYWORD_ONLY
            assert parameter.default is not Parameter.empty
            given = given_fields[field.name]
            assert getattr(factory(**given_fields), field.name) == given
        with pytest.raises(TypeError):
            factory(unknown=True)
        with pytest.raises(FrozenInstanceError):
            value.provider_id = "changed"


def test_feed_day_follows_the_rules_of_its_fields():
    absent = fake_feed_day(state="not_available")
    assert (absent.reason, absent.form, absent.poll_record_sha256) == ("no_polls", None, None)
    archived = fake_feed_day(form="archive_copy")
    assert (archived.content_version, archived.bytes_verified) == (1, True)
    for changes, field in (
        ({"reason": "no_polls"}, "reason"),
        ({"state": "not_available", "reason": None}, "reason"),
        ({"form": None}, "form"),
        ({"state": "not_available", "reason": "no_polls"}, "form"),
        ({"content_version": 1}, "content_version"),
        ({"form": "archive_copy"}, "content_version"),
        ({"bytes_verified": True}, "bytes_verified"),
        ({"pending_change": True}, "pending_change"),
    ):
        with pytest.raises(ValueError, match=field):
            replace(fake_feed_day(), **changes)
    assert fake_feed_day(form="archive_copy", bytes_verified=False).bytes_verified is False
    with pytest.raises(ValueError, match="reason"):
        fake_feed_day(state="not_available", reason=None)


def test_window_not_available_carries_its_days():
    days = tuple(
        fake_feed_day(state="not_available", reason=reason, endpoint_key=reason)
        for reason in ("no_polls", "still_open")
    )
    error = WindowNotAvailable(days)
    assert error.days is days
    for day in days:
        assert f"{day.endpoint_key} {day.utc_date} {day.reason}" in str(error)


def test_fake_window_has_the_members_of_the_real_window():
    from history_reader_fakes import FakeCaptureWindow

    from transit_ops.history.reader import CaptureWindow

    day, poll, capture, processing = fake_feed_day(), fake_poll(), fake_capture(), fake_processing()
    fake = FakeCaptureWindow([day], [poll], [capture], [processing], [poll])
    real = CaptureWindow(
        provider_id=day.provider_id,
        feeds=(day.endpoint_key,),
        start_utc=fake.start_utc,
        end_utc=fake.end_utc,
        days=(day,),
        connection=None,
        storage=None,
        records={},
    )
    for name in dir(real):
        if not name.startswith("_"):
            assert hasattr(fake, name)
            if callable(getattr(real, name)):
                assert (
                    signature(getattr(fake, name)).parameters
                    == signature(getattr(real, name)).parameters
                )
    assert fake.days == (day,) and fake.unreadable == [poll]
    assert (fake.provider_id, fake.feeds) == (day.provider_id, (day.endpoint_key,))
    assert fake.start_utc == datetime(2026, 1, 2, tzinfo=UTC)
    assert fake.end_utc == datetime(2026, 1, 3, tzinfo=UTC)
    assert list(fake.polls()) == [poll] and list(fake.processing()) == [processing]
    assert list(fake.captures()) == [capture]
    assert list(fake.captures(with_bytes=False)) == [replace(capture, payload=None)]
    assert fake.require_available() is None
    missing = fake_feed_day(state="not_available")
    with pytest.raises(WindowNotAvailable) as error:
        FakeCaptureWindow([missing], [], [], []).require_available()
    assert error.value.days == (missing,)


def test_fake_open_window_returns_its_windows_in_order():
    from history_reader_fakes import FakeCaptureWindow, fake_open_window

    from transit_ops.history.reader import open_window

    windows = [FakeCaptureWindow([], [], [], []) for _ in range(2)]
    opener = fake_open_window(iter(windows))
    assert signature(opener).parameters == signature(open_window).parameters
    for window in windows:
        assert (
            opener(
                "provider",
                iter(["feed"]),
                window.start_utc,
                window.end_utc,
                connection=None,
                storage=None,
            )
            is window
        )
    assert opener.calls == [("provider", ("feed",), w.start_utc, w.end_utc) for w in windows]
    with pytest.raises(AssertionError):
        opener(
            "provider",
            ["feed"],
            windows[0].start_utc,
            windows[0].end_utc,
            connection=None,
            storage=None,
        )


def test_fake_open_day_polls_has_the_signature_and_filters_by_feed_and_time():
    from history_reader_fakes import fake_open_day_polls

    from transit_ops.history.reader import open_day_polls

    since = datetime(2026, 1, 2, tzinfo=UTC)
    polls = [
        fake_poll(ingestion_run_id=3, time_utc=datetime(2026, 1, 3, tzinfo=UTC)),
        fake_poll(ingestion_run_id=2, endpoint_key="vehicle_positions", time_utc=since),
        fake_poll(ingestion_run_id=1, time_utc=since),
        fake_poll(ingestion_run_id=4, time_utc=datetime(2026, 1, 1, tzinfo=UTC)),
    ]
    opener = fake_open_day_polls(iter(polls))
    assert signature(opener).parameters == signature(open_day_polls).parameters
    result = opener("provider", ["trip_updates"], since, connection=None)
    assert opener.calls == [("provider", ("trip_updates",), since)]
    assert list(result) == [polls[0], polls[2]]
    assert list(opener("other", ["vehicle_positions"], since, connection=None)) == [polls[1]]
    assert opener.calls[-1] == ("other", ("vehicle_positions",), since)
