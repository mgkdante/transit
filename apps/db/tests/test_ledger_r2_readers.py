import json
from dataclasses import replace
from datetime import timedelta

import pytest
from ledger_r2_fixtures import DOC, ID, NOW, RECORD, remote, seed
from ledger_r2_fixtures import pair as pair

from transit_ops.control.objects import ObjectConflict
from transit_ops.history import ledger_r2_documents as m
from transit_ops.history import ledger_r2_readers as r


@pytest.mark.parametrize("reader", [r.events, r.current_window, r.rebuild_window])
def test_audit_reader_repairs_pending_state_without_new_records(pair, reader):
    client, obj, _ = pair
    seed(obj, DOC, 1)
    before = list(obj.list_keys("transitions/"))
    fresh = remote(client)
    assert fresh.read(m.window_key(ID)) is None
    result = reader(fresh, ID)
    if isinstance(result, list):
        assert [record.kind for record in result] == ["changed"]
    else:
        assert result == DOC
    assert m.decode_window(json.loads(fresh.read(m.window_key(ID)).body)) == DOC
    assert list(obj.list_keys("transitions/")) == before


def test_exact_times_and_event_only_history(pair):
    _, obj, _ = pair
    seed(obj, None, 1, records=(replace(RECORD, kind="close_runs"),))
    assert r.current_window(obj, ID) is None
    assert r.rebuild_window(obj, ID) is None
    later = NOW + timedelta(minutes=1)
    state = replace(DOC, seq=2)
    seed(obj, state, 2, at=later)
    assert [(record.at_utc, record.sequence) for record in r.events(obj, ID)] == [
        (NOW, 1),
        (later, 2),
    ]
    assert [record.sequence for record in r.events(obj, ID, kinds={"close_runs"})] == [1]
    assert r.current_window(obj, ID) == state


def test_repair_replays_deleted_projection_and_confirms_following_chain(pair):
    _, obj, _ = pair
    second, third = replace(DOC, seq=2), replace(DOC, seq=3)
    seed(obj, DOC, 1)
    seed(obj, second, 2, previous=DOC)
    seed(obj, third, 3, previous=second)
    assert r.current_window(obj, ID) == third
    assert r.confirm_committed(obj, ID, DOC, third) == DOC
    assert r.rebuild_window(obj, ID) == third


@pytest.mark.parametrize("reader", [r.events, r.current_window, r.rebuild_window])
def test_wrong_chain_cannot_change_window(pair, reader):
    _, obj, _ = pair
    seed(obj, DOC, 1)
    r.current_window(obj, ID)
    before = obj.read(m.window_key(ID))
    _, envelope = m.prepare_transition(
        replace(DOC, seq=2),
        (RECORD,),
        ID,
        2,
        before.body,
        NOW,
        operation_id="bad-chain",
        first_record=2,
    )
    obj.create(m.transition_key(ID, 2), {**envelope, "before_sha256": "f" * 64})
    with pytest.raises(m.LedgerDocumentInvalid):
        reader(obj, ID)
    assert obj.read(m.window_key(ID)) == before


def test_rebuild_refuses_a_gap(pair):
    _, obj, _ = pair
    obj.create(m.transition_key(ID, 2), {})
    with pytest.raises(m.LedgerDocumentInvalid):
        r.rebuild_window(obj, ID)


def test_recovery_read_races_are_bounded(pair, monkeypatch):
    _, obj, _ = pair
    seed(obj, DOC, 1)
    read, calls = obj.read, []

    def raced(key):
        calls.append(key)
        raise ObjectConflict("read race")

    monkeypatch.setattr(obj, "read", raced)
    with pytest.raises(r.LedgerContention):
        r.current_window(obj, ID, max_attempts=2)
    assert calls == [m.window_key(ID), m.window_key(ID)]
    monkeypatch.setattr(obj, "read", read)
    assert r.current_window(obj, ID) == DOC


@pytest.mark.parametrize("reader", [r.events, r.current_window, r.rebuild_window])
def test_corrupt_window_body_has_a_document_error(pair, reader):
    client, obj, _ = pair
    client.put_object(Key="x/" + m.window_key(ID), Body=b"not json")
    with pytest.raises(m.LedgerDocumentInvalid):
        reader(obj, ID)
