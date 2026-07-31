"""
d-SBT Registry — dynamic Soulbound Tokens as financial health passports.

A member's creditworthiness is stored on chain as a token that:

  * cannot be transferred — there is no transfer method, and the underlying ASA
    is issued frozen with clawback retained by this application, so reputation
    can never be bought, sold, or lent;
  * changes over time — every repayment, streak or default rewrites the score
    and tier, and each rewrite is a separate on-chain event, so a bank can audit
    the whole trajectory instead of a single self-reported number.

Written in Algorand Python (algopy) and compiled with AlgoKit.
"""

from algopy import (
    ARC4Contract,
    Account,
    BoxMap,
    Global,
    Txn,
    UInt64,
    arc4,
    itxn,
    subroutine,
)

# Score movement per event type.
POINTS_ON_TIME_REPAYMENT = 12
POINTS_LATE_REPAYMENT = 18
POINTS_DEFAULT = 85
POINTS_DEPOSIT_STREAK = 6
POINTS_LOAN_CLEARED = 25

TIER_BRONZE = 0
TIER_SILVER = 1
TIER_GOLD = 2
TIER_PLATINUM = 3


class Passport(arc4.Struct):
    """A member's living credit record."""

    owner: arc4.Address
    score: arc4.UInt64
    tier: arc4.UInt64
    on_time_repayments: arc4.UInt64
    late_repayments: arc4.UInt64
    defaults: arc4.UInt64
    deposit_streak: arc4.UInt64
    asset_id: arc4.UInt64
    updated_round: arc4.UInt64


class DsbtRegistry(ARC4Contract):
    """Issues and maintains non-transferable member credit passports."""

    def __init__(self) -> None:
        self.admin = Global.creator_address
        # The agent backend authorised to report repayment events.
        self.oracle = Global.creator_address
        self.total_passports = UInt64(0)

        self.passports = BoxMap(Account, Passport, key_prefix=b"sbt")

    @arc4.abimethod
    def set_oracle(self, oracle: Account) -> None:
        assert Txn.sender == self.admin, "only admin"
        self.oracle = oracle

    # ── Minting ─────────────────────────────────────────────────────────────

    @arc4.abimethod
    def mint(self, member: Account, initial_score: UInt64) -> UInt64:
        """
        Issues a member's passport.

        The ASA is created with total supply 1, frozen by default, and with
        clawback/freeze retained by this application. That combination is what
        makes it soulbound: the holder can hold it but never move it.
        """
        assert Txn.sender == self.admin or Txn.sender == self.oracle, "not authorised"
        assert member not in self.passports, "passport already exists"
        assert initial_score <= UInt64(1000), "score out of range"

        asset = (
            itxn.AssetConfig(
                total=1,
                decimals=0,
                unit_name=b"SAHELI",
                asset_name=b"Saheli Financial Health Passport",
                url=b"https://saheli.chain/dsbt",
                manager=Global.current_application_address,
                # Retained deliberately — these are the soulbound enforcement.
                freeze=Global.current_application_address,
                clawback=Global.current_application_address,
                reserve=Global.current_application_address,
                default_frozen=True,
                fee=0,
            )
            .submit()
            .created_asset
        )

        self.passports[member] = Passport(
            owner=arc4.Address(member),
            score=arc4.UInt64(initial_score),
            tier=arc4.UInt64(self._tier_for(initial_score)),
            on_time_repayments=arc4.UInt64(0),
            late_repayments=arc4.UInt64(0),
            defaults=arc4.UInt64(0),
            deposit_streak=arc4.UInt64(0),
            asset_id=arc4.UInt64(asset.id),
            updated_round=arc4.UInt64(Global.round),
        )

        self.total_passports += UInt64(1)
        return asset.id

    # ── Dynamic updates ─────────────────────────────────────────────────────

    @arc4.abimethod
    def record_on_time_repayment(self, member: Account) -> UInt64:
        return self._apply(member, UInt64(POINTS_ON_TIME_REPAYMENT), True, UInt64(1), UInt64(0), UInt64(0))

    @arc4.abimethod
    def record_late_repayment(self, member: Account) -> UInt64:
        return self._apply(member, UInt64(POINTS_LATE_REPAYMENT), False, UInt64(0), UInt64(1), UInt64(0))

    @arc4.abimethod
    def record_default(self, member: Account) -> UInt64:
        return self._apply(member, UInt64(POINTS_DEFAULT), False, UInt64(0), UInt64(0), UInt64(1))

    @arc4.abimethod
    def record_deposit_streak(self, member: Account) -> UInt64:
        assert Txn.sender == self.admin or Txn.sender == self.oracle, "not authorised"
        assert member in self.passports, "no passport"

        passport = self.passports[member].copy()
        passport.deposit_streak = arc4.UInt64(passport.deposit_streak.native + UInt64(1))
        self.passports[member] = passport.copy()

        return self._apply(member, UInt64(POINTS_DEPOSIT_STREAK), True, UInt64(0), UInt64(0), UInt64(0))

    @arc4.abimethod
    def record_loan_cleared(self, member: Account) -> UInt64:
        return self._apply(member, UInt64(POINTS_LOAN_CLEARED), True, UInt64(0), UInt64(0), UInt64(0))

    # ── Views ───────────────────────────────────────────────────────────────

    @arc4.abimethod(readonly=True)
    def get_passport(self, member: Account) -> Passport:
        assert member in self.passports, "no passport"
        return self.passports[member]

    @arc4.abimethod(readonly=True)
    def score_of(self, member: Account) -> UInt64:
        assert member in self.passports, "no passport"
        score: UInt64 = self.passports[member].score.native
        return score

    @arc4.abimethod(readonly=True)
    def credit_multiplier(self, member: Account) -> UInt64:
        """How many times their savings a member may responsibly borrow."""
        assert member in self.passports, "no passport"
        tier = self.passports[member].tier.native

        if tier == UInt64(TIER_PLATINUM):
            return UInt64(5)
        if tier == UInt64(TIER_GOLD):
            return UInt64(3)
        if tier == UInt64(TIER_SILVER):
            return UInt64(2)
        return UInt64(1)

    # ── Internal ────────────────────────────────────────────────────────────

    @subroutine
    def _apply(
        self,
        member: Account,
        points: UInt64,
        positive: bool,
        on_time: UInt64,
        late: UInt64,
        defaulted: UInt64,
    ) -> UInt64:
        """Moves the score, recomputes the tier, and stamps the round."""
        assert Txn.sender == self.admin or Txn.sender == self.oracle, "not authorised"
        assert member in self.passports, "no passport"

        passport = self.passports[member].copy()
        current: UInt64 = passport.score.native
        updated: UInt64 = current

        if positive:
            updated = current + points
            if updated > UInt64(1000):
                updated = UInt64(1000)
        else:
            updated = current - points if current > points else UInt64(0)

        passport.score = arc4.UInt64(updated)
        passport.tier = arc4.UInt64(self._tier_for(updated))
        passport.on_time_repayments = arc4.UInt64(passport.on_time_repayments.native + on_time)
        passport.late_repayments = arc4.UInt64(passport.late_repayments.native + late)
        passport.defaults = arc4.UInt64(passport.defaults.native + defaulted)
        passport.updated_round = arc4.UInt64(Global.round)

        # A default breaks the deposit streak.
        if defaulted > UInt64(0):
            passport.deposit_streak = arc4.UInt64(0)

        self.passports[member] = passport.copy()
        return updated

    @subroutine
    def _tier_for(self, score: UInt64) -> UInt64:
        if score >= UInt64(900):
            return UInt64(TIER_PLATINUM)
        if score >= UInt64(800):
            return UInt64(TIER_GOLD)
        if score >= UInt64(650):
            return UInt64(TIER_SILVER)
        return UInt64(TIER_BRONZE)
