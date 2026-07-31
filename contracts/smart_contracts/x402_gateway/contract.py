"""
x402 Gateway — on-chain receipts for pay-per-use API access.

The x402 protocol settles payment as an ordinary ASA transfer. This contract
sits alongside that transfer inside the same atomic group and does two jobs the
transfer alone cannot:

  1. Emits a durable, queryable receipt so a resource server can prove *what*
     was bought, not merely that money moved.
  2. Splits the revenue, routing the SHG's share to the group treasury. That
     split is enforced by the chain rather than by our backend's good manners.

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
    gtxn,
    itxn,
)


class PaymentReceipt(arc4.Struct):
    """A single settled x402 payment."""

    payer: arc4.Address
    resource_id: arc4.String
    amount: arc4.UInt64
    treasury_share: arc4.UInt64
    timestamp: arc4.UInt64
    round_settled: arc4.UInt64


class X402Gateway(ARC4Contract):
    """Records and splits x402 pay-per-use settlements."""

    def __init__(self) -> None:
        self.admin = Global.creator_address
        self.treasury = Global.creator_address

        # Settlement asset (USDC on the active network).
        self.asset_id = UInt64(0)

        # Share of each payment routed to the SHG treasury, in basis points.
        self.treasury_share_bps = UInt64(8000)  # 80%

        self.total_calls = UInt64(0)
        self.total_revenue = UInt64(0)
        self.total_to_treasury = UInt64(0)

        # receipt_id -> PaymentReceipt
        self.receipts = BoxMap(UInt64, PaymentReceipt, key_prefix=b"rcpt")

    @arc4.abimethod
    def configure(self, treasury: Account, asset_id: UInt64, share_bps: UInt64) -> None:
        assert Txn.sender == self.admin, "only admin"
        assert share_bps <= UInt64(10_000), "share cannot exceed 100%"

        self.treasury = treasury
        self.asset_id = asset_id
        self.treasury_share_bps = share_bps

    @arc4.abimethod
    def settle(
        self,
        payment: gtxn.AssetTransferTransaction,
        resource_id: arc4.String,
    ) -> UInt64:
        """
        Verifies the x402 payment transfer sitting in this atomic group, writes
        a receipt, and forwards the treasury's share.

        Returns the receipt id.
        """
        assert payment.xfer_asset.id == self.asset_id, "wrong settlement asset"
        assert payment.asset_receiver == Global.current_application_address, "wrong receiver"
        assert payment.asset_amount > UInt64(0), "amount must be positive"
        assert payment.asset_close_to == Global.zero_address, "must not close asset holding"
        assert payment.rekey_to == Global.zero_address, "must not rekey"

        amount = payment.asset_amount
        treasury_cut = (amount * self.treasury_share_bps) // UInt64(10_000)

        receipt_id = self.total_calls + UInt64(1)
        self.receipts[receipt_id] = PaymentReceipt(
            payer=arc4.Address(payment.sender),
            resource_id=resource_id,
            amount=arc4.UInt64(amount),
            treasury_share=arc4.UInt64(treasury_cut),
            timestamp=arc4.UInt64(Global.latest_timestamp),
            round_settled=arc4.UInt64(Global.round),
        )

        self.total_calls = receipt_id
        self.total_revenue += amount
        self.total_to_treasury += treasury_cut

        # The SHG's cut leaves in the same transaction that recorded it.
        if treasury_cut > UInt64(0):
            itxn.AssetTransfer(
                xfer_asset=self.asset_id,
                asset_receiver=self.treasury,
                asset_amount=treasury_cut,
                fee=0,
            ).submit()

        return receipt_id

    @arc4.abimethod(readonly=True)
    def get_receipt(self, receipt_id: UInt64) -> PaymentReceipt:
        assert receipt_id in self.receipts, "unknown receipt"
        return self.receipts[receipt_id]

    @arc4.abimethod(readonly=True)
    def revenue_summary(self) -> arc4.Tuple[arc4.UInt64, arc4.UInt64, arc4.UInt64]:
        """Returns (total calls, gross revenue, amount routed to treasury)."""
        return arc4.Tuple(
            (
                arc4.UInt64(self.total_calls),
                arc4.UInt64(self.total_revenue),
                arc4.UInt64(self.total_to_treasury),
            )
        )

    @arc4.abimethod
    def opt_in_to_asset(self, asset_id: UInt64) -> None:
        """Opts the application account into the settlement asset."""
        assert Txn.sender == self.admin, "only admin"

        itxn.AssetTransfer(
            xfer_asset=asset_id,
            asset_receiver=Global.current_application_address,
            asset_amount=0,
            fee=0,
        ).submit()
