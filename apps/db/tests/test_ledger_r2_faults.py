import json
from dataclasses import replace

import pytest
from ledger_r2_fixtures import ID, RECORD
from ledger_r2_fixtures import pair as pair
from test_ledger_r2_transitions import advance

from transit_ops.history import ledger_r2_transitions as t


def change(event_only, decisions):
    def decide(doc, now):
        decisions.append(doc.next_version if doc else None)
        return (
            t.Transition(None, (RECORD,))
            if event_only
            else t.Transition(replace(doc, seq=doc.seq + 1, next_version=doc.next_version + 1), ())
        )

    return decide


@pytest.mark.parametrize("event_only", [False, True])
def test_lost_create_ack_is_resolved_without_repeating_change(pair, event_only):
    client, obj, _ = pair
    if not event_only:
        advance(obj)
    client.failure, decisions = "timeout", []
    result = advance(obj, change(event_only, decisions))
    assert decisions == ([None] if event_only else [1])
    if event_only:
        assert result is None and len(t.events(obj, ID)) == 1
    else:
        assert result.next_version == 2 == t.rebuild_window(obj, ID).next_version


@pytest.mark.parametrize("event_only", [False, True])
def test_identical_two_adapter_writers_both_take_effect(pair, event_only, monkeypatch):
    _, obj, other = pair
    if not event_only:
        advance(obj)
    fired, ids = [], []
    create, attempts = obj.create, []

    def attempt(key, payload):
        attempts.append(payload["operation_id"])
        return create(key, payload)

    monkeypatch.setattr(obj, "create", attempt)

    def competing(doc, now):
        if not fired:
            fired.append(True)
            advance(other, change(event_only, []))
        return change(event_only, [])(doc, now)

    result = advance(obj, competing)
    assert len(t.events(obj, ID)) == (2 if event_only else 1)
    if not event_only:
        assert result.next_version == 3
    for key in obj.list_keys("transitions/"):
        ids.append(json.loads(obj.read(key).body)["operation_id"])
    assert len(ids) == len(set(ids))
    assert attempts == [attempts[0], attempts[0]]


@pytest.mark.parametrize("event_only", [False, True])
def test_unreadable_create_outcome_is_indeterminate(pair, event_only):
    client, obj, _ = pair
    if not event_only:
        advance(obj)
    client.failure, decisions = "unreadable", []
    with pytest.raises(t.LedgerTransitionIndeterminate) as caught:
        advance(obj, change(event_only, decisions))
    assert len(decisions) == 1
    client.unreadable = False
    stored = json.loads(obj.read(caught.value.key).body)
    assert stored["operation_id"] == caught.value.operation_id
    assert (caught.value.after is None) == event_only
