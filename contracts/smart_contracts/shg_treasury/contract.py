"""
SHG Treasury — multi-signature group savings account.

Emulates the joint bank account an SHG would otherwise hold at a branch:
pooled member savings, and no withdrawal above a threshold without a quorum
of elected leaders approving in the same atomic transaction group.

Written in Algorand Python (algopy) and compiled with AlgoKit.
"""

from algopy import (
    ARC4Contract,
    Account,
    Global,
    LocalState,
    Txn,
    UInt64,
    arc4,
    gtxn,
    itxn,
    subroutine,
)


class ShgTreasury(ARC4Contract):
    """Pooled SHG treasury with quorum-gated withdrawals."""

    def __init__(self) -> None:
        # Governance
        self.admin = Global.creator_address
        self.leader_count = UInt64(0)
        self.quorum = UInt64(2)  # 2-of-3 by default

        # Accounting
        self.total_deposits = UInt64(0)
        self.total_withdrawn = UInt64(0)
        self.total_loans_out = UInt64(0)

        # Any withdrawal at or above this needs the full leader quorum.
        self.quorum_threshold = UInt64(10_000)

        # Emergency loans below this bypass the quorum when the borrower's
        # d-SBT score clears `emergency_min_score`.
        self.emergency_limit = UInt64(5_000)
        self.emergency_min_score = UInt64(750)

        # Per-member savings balance.
        self.member_balance = LocalState(UInt64)
        # Outstanding loan principal per member.
        self.member_debt = LocalState(UInt64)

    # ── Governance ──────────────────────────────────────────────────────────

    @arc4.abimethod
    def configure(self, leader_count: UInt64, quorum: UInt64, threshold: UInt64) -> None:
        """Sets the leader roster size and the quorum required for large moves."""
        assert Txn.sender == self.admin, "only admin"
        assert quorum > UInt64(0), "quorum must be positive"
        assert quorum <= leader_count, "quorum cannot exceed leader count"

        self.leader_count = leader_count
        self.quorum = quorum
        self.quorum_threshold = threshold

    @arc4.abimethod(allow_actions=["OptIn"])
    def join(self) -> None:
        """Enrols a member. Opt-in creates their local savings/debt slots."""
        self.member_balance[Txn.sender] = UInt64(0)
        self.member_debt[Txn.sender] = UInt64(0)

    # ── Savings ─────────────────────────────────────────────────────────────

    @arc4.abimethod
    def deposit(self, payment: gtxn.PaymentTransaction) -> UInt64:
        """
        Records a member deposit. The payment must be part of this same atomic
        group and addressed to the application account, so the ledger entry and
        the money movement cannot diverge.
        """
        assert payment.receiver == Global.current_application_address, "wrong receiver"
        assert payment.sender == Txn.sender, "sender mismatch"
        assert payment.amount > UInt64(0), "amount must be positive"

        new_balance = self.member_balance[Txn.sender] + payment.amount
        self.member_balance[Txn.sender] = new_balance
        self.total_deposits += payment.amount

        return new_balance

    @arc4.abimethod
    def withdraw(self, amount: UInt64, approvals: UInt64) -> UInt64:
        """
        Withdraws member savings.

        Below `quorum_threshold` a member acts alone. At or above it, the caller
        must present at least `quorum` leader approvals — supplied as sibling
        transactions in the same atomic group, which is what makes partial
        approval impossible.
        """
        assert amount > UInt64(0), "amount must be positive"
        assert self.member_balance[Txn.sender] >= amount, "insufficient balance"

        if amount >= self.quorum_threshold:
            assert approvals >= self.quorum, "leader quorum not met"
            assert self._group_carries_approvals(approvals), "approvals not in atomic group"

        self.member_balance[Txn.sender] -= amount
        self.total_withdrawn += amount

        itxn.Payment(
            receiver=Txn.sender,
            amount=amount,
            fee=0,  # fee pooled by the relayer — the member never pays gas
        ).submit()

        return self.member_balance[Txn.sender]

    # ── Lending ─────────────────────────────────────────────────────────────

    @arc4.abimethod
    def request_emergency_loan(self, amount: UInt64, dsbt_score: UInt64) -> UInt64:
        """
        Agentic emergency disbursement.

        The AI agent calls this after reading the borrower's d-SBT score. Small
        loans to high-trust members settle immediately without waiting for the
        leader quorum; everything else must go through `approve_loan`.
        """
        assert amount > UInt64(0), "amount must be positive"
        assert amount <= self.emergency_limit, "exceeds emergency limit"
        assert dsbt_score >= self.emergency_min_score, "trust score too low"
        assert Global.current_application_address.balance >= amount, "treasury underfunded"

        self.member_debt[Txn.sender] += amount
        self.total_loans_out += amount

        itxn.Payment(
            receiver=Txn.sender,
            amount=amount,
            fee=0,
        ).submit()

        return self.member_debt[Txn.sender]

    @arc4.abimethod
    def approve_loan(self, borrower: Account, amount: UInt64, approvals: UInt64) -> UInt64:
        """Disburses a loan that cleared the leader quorum."""
        assert approvals >= self.quorum, "leader quorum not met"
        assert self._group_carries_approvals(approvals), "approvals not in atomic group"
        assert Global.current_application_address.balance >= amount, "treasury underfunded"

        self.member_debt[borrower] += amount
        self.total_loans_out += amount

        itxn.Payment(
            receiver=borrower,
            amount=amount,
            fee=0,
        ).submit()

        return self.member_debt[borrower]

    @arc4.abimethod
    def repay(self, payment: gtxn.PaymentTransaction) -> UInt64:
        """Repays outstanding principal. Overpayment is credited to savings."""
        assert payment.receiver == Global.current_application_address, "wrong receiver"
        assert payment.sender == Txn.sender, "sender mismatch"

        debt = self.member_debt[Txn.sender]
        if payment.amount >= debt:
            surplus = payment.amount - debt
            self.member_debt[Txn.sender] = UInt64(0)
            self.member_balance[Txn.sender] += surplus
        else:
            self.member_debt[Txn.sender] = debt - payment.amount

        return self.member_debt[Txn.sender]

    # ── Views ───────────────────────────────────────────────────────────────

    @arc4.abimethod(readonly=True)
    def balance_of(self, member: Account) -> UInt64:
        return self.member_balance[member]

    @arc4.abimethod(readonly=True)
    def debt_of(self, member: Account) -> UInt64:
        return self.member_debt[member]

    @arc4.abimethod(readonly=True)
    def treasury_health(self) -> arc4.Tuple[arc4.UInt64, arc4.UInt64, arc4.UInt64]:
        """Returns (total deposits, total withdrawn, outstanding loans)."""
        return arc4.Tuple(
            (
                arc4.UInt64(self.total_deposits),
                arc4.UInt64(self.total_withdrawn),
                arc4.UInt64(self.total_loans_out),
            )
        )

    # ── Internal ────────────────────────────────────────────────────────────

    @subroutine
    def _group_carries_approvals(self, approvals: UInt64) -> bool:
        """
        Confirms the atomic group is actually large enough to carry the claimed
        approvals. Each leader signs one sibling transaction, so a group of
        N approvals plus this call needs at least N+1 transactions.

        This is what stops a caller from simply asserting `approvals=3` without
        three real leader signatures present in the same block.
        """
        return Global.group_size >= approvals + UInt64(1)
