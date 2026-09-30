"""Every valid and invalid transition of the Step 5 state machine."""

import itertools

import pytest

from app.schemas.agreement import Status as S
from app.services.state_machine import EDGES, AgreementStateMachine, InvalidTransition

VALID = {
    (S.DRAFT, S.SENT),
    (S.SENT, S.CONFIRMED_BY_ONE), (S.SENT, S.DRAFT),
    (S.CONFIRMED_BY_ONE, S.CONFIRMED_BY_BOTH), (S.CONFIRMED_BY_ONE, S.DRAFT),
    (S.CONFIRMED_BY_BOTH, S.ADVANCE_PAID), (S.CONFIRMED_BY_BOTH, S.IN_PROGRESS),
    (S.ADVANCE_PAID, S.IN_PROGRESS), (S.ADVANCE_PAID, S.DISPUTED),
    (S.IN_PROGRESS, S.COMPLETED), (S.IN_PROGRESS, S.DISPUTED),
    (S.COMPLETED, S.DISPUTED),
    (S.DISPUTED, S.RESOLVED), (S.DISPUTED, S.ESCALATED),
}


@pytest.mark.parametrize("src, dst", list(itertools.product(S, S)))
def test_edge_table(src, dst):
    assert (dst in EDGES[src]) == ((src, dst) in VALID)


@pytest.mark.parametrize("src, dst", sorted(VALID))
def test_valid_transitions_allowed(src, dst):
    # CONFIRMED_BY_BOTH -> IN_PROGRESS is only for agreements without an advance
    has_advance = not (src == S.CONFIRMED_BY_BOTH and dst == S.IN_PROGRESS)
    assert AgreementStateMachine(status=src, has_advance=has_advance).can(dst)


@pytest.mark.parametrize("src, dst", [p for p in itertools.product(S, S) if p not in VALID])
def test_invalid_transitions_rejected(src, dst):
    m = AgreementStateMachine(status=src)
    assert not m.can(dst)
    with pytest.raises(InvalidTransition):
        m._go(dst)


def test_happy_path_with_advance():
    m = AgreementStateMachine()
    assert m.send() == (S.DRAFT, S.SENT)
    assert m.confirm("worker") == (S.SENT, S.CONFIRMED_BY_ONE)
    assert m.confirm("client") == (S.CONFIRMED_BY_ONE, S.CONFIRMED_BY_BOTH)
    assert m.pay_advance() == (S.CONFIRMED_BY_BOTH, S.ADVANCE_PAID)
    assert m.start() == (S.ADVANCE_PAID, S.IN_PROGRESS)
    assert m.mark_done("worker") == (S.IN_PROGRESS, S.IN_PROGRESS)
    assert m.mark_done("client") == (S.IN_PROGRESS, S.COMPLETED)


def test_no_advance_skips_straight_to_work():
    m = AgreementStateMachine(status=S.CONFIRMED_BY_BOTH, has_advance=False)
    with pytest.raises(InvalidTransition):
        m.pay_advance()
    assert m.start() == (S.CONFIRMED_BY_BOTH, S.IN_PROGRESS)


def test_with_advance_cannot_skip_payment():
    with pytest.raises(InvalidTransition):
        AgreementStateMachine(status=S.CONFIRMED_BY_BOTH, has_advance=True).start()


def test_double_confirm_rejected():
    m = AgreementStateMachine(status=S.SENT)
    m.confirm("client")
    with pytest.raises(InvalidTransition):
        m.confirm("client")


def test_confirm_only_after_send():
    for status in (S.DRAFT, S.CONFIRMED_BY_BOTH, S.COMPLETED):
        with pytest.raises(InvalidTransition):
            AgreementStateMachine(status=status).confirm("client")


def test_edit_resets_confirmations():
    m = AgreementStateMachine(status=S.CONFIRMED_BY_ONE, confirmed={"client"})
    assert m.edit() == (S.CONFIRMED_BY_ONE, S.DRAFT)
    assert m.confirmed == set()
    assert AgreementStateMachine().edit() == (S.DRAFT, S.DRAFT)


@pytest.mark.parametrize("status", [S.CONFIRMED_BY_BOTH, S.ADVANCE_PAID, S.IN_PROGRESS, S.COMPLETED,
                                    S.DISPUTED, S.RESOLVED, S.ESCALATED])
def test_frozen_after_both_confirm(status):
    with pytest.raises(InvalidTransition):
        AgreementStateMachine(status=status).edit()


def test_completed_needs_both_parties():
    m = AgreementStateMachine(status=S.IN_PROGRESS)
    m.mark_done("client")
    assert m.status == S.IN_PROGRESS
    with pytest.raises(InvalidTransition):
        m.mark_done("client")


@pytest.mark.parametrize("status", [S.DRAFT, S.SENT, S.CONFIRMED_BY_ONE, S.CONFIRMED_BY_BOTH])
def test_dispute_only_from_advance_paid_onward(status):
    with pytest.raises(InvalidTransition):
        AgreementStateMachine(status=status).dispute()


def test_unknown_party():
    with pytest.raises(InvalidTransition):
        AgreementStateMachine(status=S.SENT).confirm("stranger")
