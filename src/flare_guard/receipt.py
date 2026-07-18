"""Deterministic direct-mint receipt checks (no RPC, signing, or submission).

A successful EVM transaction is not, by itself, proof that FXRP was minted.
The verifier therefore requires decoded AssetManager direct-mint event facts and
an explicit live-verification marker before calling settlement executed.
"""

from __future__ import annotations

from typing import Any, Mapping

from .models import Reason
from .validation import canonical_digest, is_evm_address, is_tx_hash, parse_int, same_address


MESSAGES = {
    "RECEIPT_FAILED": "The transaction receipt reports failed execution.",
    "RECEIPT_PENDING": "The transaction is pending or has no final receipt.",
    "RECEIPT_STATUS_UNKNOWN": "The receipt execution status is unknown.",
    "RECEIPT_CHAIN_MISMATCH": "Receipt chain ID does not match Coston2 chain 114.",
    "RECEIPT_TX_HASH_MISMATCH": "Receipt transaction hash does not match the declared intent.",
    "RECEIPT_UNDERLYING_TX_MISMATCH": "Decoded direct-mint transaction ID does not match the declared XRPL transaction.",
    "RECEIPT_ASSET_MISMATCH": "Decoded receipt asset identity does not match the declared intent.",
    "RECEIPT_EMITTER_MISMATCH": "Decoded event was not emitted by the anchored AssetManagerFXRP contract.",
    "RECEIPT_AMOUNT_MISMATCH": "Decoded minted amount does not match the requested net mint amount.",
    "RECEIPT_FEE_MISMATCH": "Decoded direct-mint fees do not match the preflight quote.",
    "RECEIPT_RECIPIENT_MISMATCH": "Decoded direct-mint recipient does not match the declared intent.",
    "RECEIPT_SENDER_MISMATCH": "Decoded XRPL sender does not match the declared intent.",
    "RECEIPT_PREFLIGHT_BINDING_MISSING": "Receipt execution cannot be claimed without complete preflight expectations.",
    "RECEIPT_EFFECT_UNVERIFIED": "Successful execution lacks complete decoded direct-mint effect facts.",
    "RECEIPT_SETTLEMENT_UNVERIFIED": "Receipt was not verified live against a trusted AssetManager direct-mint event.",
    "RECEIPT_DIRECT_MINT_DELAYED": "The execution transaction only delayed direct minting; FXRP is not minted yet.",
}

EXECUTED_EVENT = "DirectMintingExecuted"
DELAYED_EVENTS = {"DirectMintingDelayed", "LargeDirectMintingDelayed"}


def _reason(level: str, code: str, **details: Any) -> Reason:
    return Reason(level, code, MESSAGES[code], details)


def _status(receipt: Mapping[str, Any]) -> str:
    raw = receipt.get("status")
    if raw in (1, "0x1", "SUCCESS", "success", "SUCCEEDED", "succeeded"):
        return "SUCCESS"
    if raw in (0, "0x0", "FAILED", "failed", "REVERTED", "reverted"):
        return "FAILED"
    if raw in (None, "PENDING", "pending", "PENDING_OR_UNKNOWN", "NOT_FOUND"):
        return "PENDING"
    return "UNKNOWN"


def _field(value: Mapping[str, Any], snake: str, camel: str | None = None) -> Any:
    result = value.get(snake)
    return result if result is not None or camel is None else value.get(camel)


def evaluate_receipt(intent: Mapping[str, Any], receipt: Mapping[str, Any]) -> tuple[dict[str, Any], list[Reason]]:
    """Return a stable direct-mint summary plus fail-closed mismatch reasons."""

    status = _status(receipt)
    event = receipt.get("event") if isinstance(receipt.get("event"), Mapping) else {}
    reasons: list[Reason] = []
    if status == "FAILED":
        reasons.append(_reason("BLOCK", "RECEIPT_FAILED"))
    elif status == "PENDING":
        reasons.append(_reason("REVIEW", "RECEIPT_PENDING"))
    elif status == "UNKNOWN":
        reasons.append(_reason("REVIEW", "RECEIPT_STATUS_UNKNOWN"))

    chain_id = parse_int(receipt.get("chain_id"))
    observed_hash = receipt.get("transaction_hash") or receipt.get("transactionHash")
    block_number = parse_int(receipt.get("block_number") or receipt.get("blockNumber"))
    block_hash = receipt.get("block_hash") or receipt.get("blockHash")
    event_name = event.get("name") or event.get("event_name")
    event_emitter = event.get("emitter") or event.get("address")
    underlying_tx = _field(event, "transaction_id", "transactionId")
    observed_asset = receipt.get("asset_address") or receipt.get("token_address")
    minted_units = _field(event, "minted_amount_uba", "mintedAmountUBA")
    minting_fee = _field(event, "minting_fee_uba", "mintingFeeUBA")
    executor_fee = _field(event, "executor_fee_uba", "executorFeeUBA")
    recipient = event.get("recipient") or _field(event, "target_address", "targetAddress")
    sender = _field(event, "source_address", "sourceAddress")
    verification_mode = receipt.get("verification_mode")
    trusted_event_verified = receipt.get("trusted_event_verified") is True
    fdc_verified = receipt.get("fdc_verified") is True

    if chain_id is not None and chain_id != 114:
        reasons.append(_reason("BLOCK", "RECEIPT_CHAIN_MISMATCH", observed=chain_id, expected=114))

    expected_hash = intent.get("transaction_hash") or intent.get("tx_hash")
    if expected_hash and (not is_tx_hash(observed_hash) or str(expected_hash).lower() != str(observed_hash).lower()):
        reasons.append(_reason("BLOCK", "RECEIPT_TX_HASH_MISMATCH"))

    expected_underlying_tx = intent.get("underlying_transaction_id")
    if expected_underlying_tx and (
        not is_tx_hash(underlying_tx)
        or str(expected_underlying_tx).lower() != str(underlying_tx).lower()
    ):
        reasons.append(_reason("BLOCK", "RECEIPT_UNDERLYING_TX_MISMATCH"))

    expected_asset = intent.get("asset", {}).get("address") if isinstance(intent.get("asset"), Mapping) else None
    if expected_asset and observed_asset and not same_address(expected_asset, observed_asset):
        reasons.append(_reason("BLOCK", "RECEIPT_ASSET_MISMATCH"))

    expected_manager = intent.get("expected_asset_manager")
    if expected_manager and event_emitter and not same_address(expected_manager, event_emitter):
        reasons.append(_reason("BLOCK", "RECEIPT_EMITTER_MISMATCH"))

    expected_units = parse_int(intent.get("amount_uba"))
    if expected_units is not None and minted_units is not None and parse_int(minted_units) != expected_units:
        reasons.append(_reason("BLOCK", "RECEIPT_AMOUNT_MISMATCH"))

    if is_evm_address(intent.get("recipient")) and recipient and not same_address(intent.get("recipient"), recipient):
        reasons.append(_reason("BLOCK", "RECEIPT_RECIPIENT_MISMATCH"))

    expected_sender = intent.get("underlying_sender_address")
    if expected_sender and sender and str(expected_sender) != str(sender):
        reasons.append(_reason("BLOCK", "RECEIPT_SENDER_MISMATCH"))

    expected_minting_fee = parse_int(intent.get("expected_minting_fee_uba"))
    expected_executor_fee = parse_int(intent.get("expected_executor_fee_uba"))
    if (
        expected_minting_fee is not None
        and minting_fee is not None
        and parse_int(minting_fee) != expected_minting_fee
    ) or (
        expected_executor_fee is not None
        and executor_fee is not None
        and parse_int(executor_fee) != expected_executor_fee
    ):
        reasons.append(_reason("BLOCK", "RECEIPT_FEE_MISMATCH"))

    settlement_status = "UNVERIFIED"
    if status == "FAILED":
        settlement_status = "FAILED"
    elif status == "PENDING":
        settlement_status = "PENDING"
    elif status == "SUCCESS" and event_name in DELAYED_EVENTS:
        settlement_status = "DELAYED"
        reasons.append(_reason("REVIEW", "RECEIPT_DIRECT_MINT_DELAYED", event=event_name))
    elif status == "SUCCESS":
        expected_chain = parse_int(intent.get("chain_id") or intent.get("expected_chain_id"))
        binding_missing: list[str] = []
        if expected_chain != 114:
            binding_missing.append("preflight.chain_id=114")
        if not is_tx_hash(expected_hash):
            binding_missing.append("preflight.transaction_hash")
        if not is_tx_hash(expected_underlying_tx):
            binding_missing.append("preflight.underlying_transaction_id")
        if not is_evm_address(expected_manager):
            binding_missing.append("preflight.expected_asset_manager")
        if not is_evm_address(expected_asset):
            binding_missing.append("preflight.asset.address")
        if expected_units is None or expected_units <= 0:
            binding_missing.append("preflight.amount_uba")
        if not is_evm_address(intent.get("recipient")):
            binding_missing.append("preflight.recipient")
        if expected_minting_fee is None or expected_minting_fee < 0:
            binding_missing.append("preflight.expected_minting_fee_uba")
        if expected_executor_fee is None or expected_executor_fee < 0:
            binding_missing.append("preflight.expected_executor_fee_uba")
        if binding_missing:
            reasons.append(
                _reason(
                    "REVIEW",
                    "RECEIPT_PREFLIGHT_BINDING_MISSING",
                    missing=binding_missing,
                )
            )

        missing: list[str] = []
        if chain_id is None:
            missing.append("chain_id")
        if not is_tx_hash(observed_hash):
            missing.append("transaction_hash")
        if block_number is None or block_number <= 0:
            missing.append("block_number")
        if not is_tx_hash(block_hash):
            missing.append("block_hash")
        if event_name != EXECUTED_EVENT:
            missing.append("event.name=DirectMintingExecuted")
        if not is_evm_address(event_emitter):
            missing.append("event.emitter")
        if not is_tx_hash(underlying_tx):
            missing.append("event.transaction_id")
        if not is_evm_address(observed_asset):
            missing.append("asset_address")
        if parse_int(minted_units) is None:
            missing.append("event.minted_amount_uba")
        if parse_int(minting_fee) is None:
            missing.append("event.minting_fee_uba")
        if parse_int(executor_fee) is None:
            missing.append("event.executor_fee_uba")
        if not is_evm_address(recipient):
            missing.append("event.recipient")
        if expected_sender and not isinstance(sender, str):
            missing.append("event.source_address")
        if missing:
            reasons.append(_reason("REVIEW", "RECEIPT_EFFECT_UNVERIFIED", missing=missing))
        if verification_mode != "live" or not trusted_event_verified:
            reasons.append(
                _reason(
                    "REVIEW",
                    "RECEIPT_SETTLEMENT_UNVERIFIED",
                    verification_mode=verification_mode,
                    trusted_event_verified=trusted_event_verified,
                )
            )
        has_blocking_mismatch = any(reason.level == "BLOCK" for reason in reasons)
        if (
            not missing
            and not binding_missing
            and not has_blocking_mismatch
            and verification_mode == "live"
            and trusted_event_verified
        ):
            settlement_status = "EXECUTED"

    stable = {
        "status": status,
        "settlement_status": settlement_status,
        "chain_id": chain_id,
        "transaction_hash": observed_hash,
        "block_number": block_number,
        "block_hash": block_hash,
        "event_name": event_name,
        "event_emitter": event_emitter,
        "underlying_transaction_id": underlying_tx,
        "asset_address": observed_asset,
        "minted_amount_uba": minted_units,
        "minting_fee_uba": minting_fee,
        "executor_fee_uba": executor_fee,
        "recipient": recipient,
        "source_address": sender,
        "verification_mode": verification_mode,
        "trusted_event_verified": trusted_event_verified,
        "fdc_verified": fdc_verified,
    }
    return {
        **stable,
        "receipt_digest": canonical_digest(stable, exclude_dynamic=False),
        "claim_boundary": (
            "EXECUTED requires a live-verified AssetManager DirectMintingExecuted event. "
            "EVM status=1, DirectMintingDelayed, or unverified caller-supplied facts do not prove FXRP settlement."
        ),
    }, reasons
