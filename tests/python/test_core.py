import contextlib
import copy
import io
import json
import os
import tempfile
import unittest
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

from flare_guard.cli import main
from flare_guard.policy import evaluate
from flare_guard.receipt import evaluate_receipt
from flare_guard.validation import (
    amount_to_units,
    canonical_digest,
    canonical_json,
    find_secret_material,
    is_evm_address,
    parse_decimal,
    parse_int,
)


ROOT = Path(__file__).resolve().parents[2]
LIVE_PATH = ROOT / "evidence/live/runs/preflight-live-2.json"
INTENT_PATH = ROOT / "examples/intents/direct-mint-10-xrp.json"
AM = "0xc1Ca88b937d0b528842F95d5731ffB586f4fbDFA"
ASSET = "0x0b6A3645c240605887a5532109323A3E12273dc7"
ALICE = "0x0000000000000000000000000000000000000001"
BOB = "0x0000000000000000000000000000000000000002"
def intent():
    return json.loads(INTENT_PATH.read_text(encoding="utf-8"))


def legacy_evidence():
    return json.loads(LIVE_PATH.read_text(encoding="utf-8"))


def evidence():
    value = legacy_evidence()
    now = datetime.now(timezone.utc)
    now_seconds = str(int(now.timestamp()))
    now_iso = now.isoformat(timespec="milliseconds").replace("+00:00", "Z")
    value["provenance"].update(
        {
            "dependency_files": {
                "package_json_sha256": "961a602212d1af019e8df24d7c911a8d2ed25400db3077f124ad0f6144d88a29",
                "package_lock_sha256": "3e9aabb3336f123d871d5a1f59c1eeaa84392cc191770ef23488f2b1ce38fd24",
            },
            "lockfile_dependencies": {
                "@flarenetwork/flare-wagmi-periphery-package": {
                    "version": "3.1.0",
                    "integrity": "sha512-+7v2m3iXPdWVSntHd4ZA0H/u/A+7gb4n5lHzaB4j2nlXjTsm6ZPxrkA0cFQtcZLiKuIrX+EsS6gtFHy6oY2D5w==",
                },
                "viem": {
                    "version": "2.48.4",
                    "integrity": "sha512-mReP/rgY2P+WeeRSG4sUvccCLKfyAW1C73Y3KkobAqgzYmVna9qyUMNE44xIUkDtfvRuC33r24UhF4baBYovsg==",
                },
            },
            "runtime_dependencies": {
                "@flarenetwork/flare-wagmi-periphery-package": {"version": "3.1.0"},
                "viem": {"version": "2.48.4"},
            },
        }
    )
    value["captured_at_utc"] = now_iso
    value["observed_at_utc"] = now_iso
    value["anchor"]["block_timestamp"] = now_seconds
    value["adapter_state"]["anchor"]["blockTimestamp"] = now_seconds
    value["fassets"]["direct_mint"]["execution_allowed_at"] = now_seconds
    value["adapter_state"]["directMinting"]["preflight"]["executionAllowedAt"] = now_seconds
    return seal(value)


def stale_evidence(age_seconds=3600):
    value = evidence()
    stale_seconds = str(int(datetime.now(timezone.utc).timestamp()) - age_seconds)
    value["anchor"]["block_timestamp"] = stale_seconds
    value["adapter_state"]["anchor"]["blockTimestamp"] = stale_seconds
    value["fassets"]["direct_mint"]["execution_allowed_at"] = stale_seconds
    value["adapter_state"]["directMinting"]["preflight"]["executionAllowedAt"] = stale_seconds
    return seal(value)


def seal(value):
    payload = {key: child for key, child in value.items() if key != "integrity"}
    value["integrity"] = {
        "algorithm": "sha256",
        "canonicalization": "sorted-keys-bigint-decimal-v1",
        "payload_scope": "artifact excluding integrity",
        "canonical_payload_sha256": canonical_digest(payload, exclude_dynamic=False),
    }
    return value


def policy(i=None, e=None, **kwargs):
    return evaluate(intent() if i is None else i, evidence() if e is None else e, **kwargs)


def codes(result):
    return {item["code"] for item in result["reasons"]}


def receipt_intent():
    return {
        **intent(),
        "amount_uba": "10000000",
        "expected_minting_fee_uba": "100000",
        "expected_executor_fee_uba": "100000",
        "expected_asset_manager": AM,
        "transaction_hash": "0x" + "1" * 64,
        "underlying_transaction_id": "0x" + "2" * 64,
    }


def receipt():
    return {
        "status": "SUCCESS",
        "chain_id": 114,
        "transaction_hash": "0x" + "1" * 64,
        "block_number": 123456,
        "block_hash": "0x" + "4" * 64,
        "asset_address": ASSET,
        "verification_mode": "live",
        "trusted_event_verified": True,
        "fdc_verified": True,
        "event": {
            "name": "DirectMintingExecuted",
            "emitter": AM,
            "transaction_id": "0x" + "2" * 64,
            "recipient": BOB,
            "source_address": "rSenderTestAddress",
            "minted_amount_uba": "10000000",
            "minting_fee_uba": "100000",
            "executor_fee_uba": "100000",
        },
    }


class ValidationTests(unittest.TestCase):
    def test_decimal_exact(self):
        self.assertEqual(parse_decimal("9007199254740993.000001"), Decimal("9007199254740993.000001"))

    def test_float_rejected(self):
        self.assertIsNone(parse_decimal(0.1))

    def test_nan_rejected(self):
        self.assertIsNone(parse_decimal("NaN"))

    def test_huge_exponent_rejected(self):
        self.assertIsNone(parse_decimal("1e100000"))

    def test_big_int(self):
        self.assertEqual(parse_int("900719925474099300000"), 900719925474099300000)

    def test_hex_int(self):
        self.assertEqual(parse_int("0x72"), 114)

    def test_bool_int_rejected(self):
        self.assertIsNone(parse_int(True))

    def test_amount_units(self):
        self.assertEqual(amount_to_units(Decimal("1.000001"), 6), 1000001)

    def test_precision_rejected(self):
        self.assertIsNone(amount_to_units(Decimal("1.0000001"), 6))

    def test_secret_key(self):
        self.assertEqual(find_secret_material({"private_key": "x"}), ["intent.private_key"])

    def test_secret_phrase(self):
        self.assertTrue(find_secret_material({"note": "mnemonic: words"}))

    def test_bearer_secret(self):
        self.assertTrue(find_secret_material({"bearer_token": "x"}))

    def test_keystore_secret(self):
        self.assertTrue(find_secret_material({"keystore": {"crypto": {}}}))

    def test_address(self):
        self.assertTrue(is_evm_address(ALICE))

    def test_zero_address(self):
        self.assertFalse(is_evm_address("0x" + "0" * 40))

    def test_canonical(self):
        self.assertEqual(canonical_json({"b": 1, "a": Decimal("1.20")}), '{"a":"1.20","b":1}')

    def test_semantic_digest_can_exclude_observation(self):
        self.assertEqual(canonical_digest({"observed_at_utc": "a", "x": 1}), canonical_digest({"observed_at_utc": "b", "x": 1}))

    def test_evidence_digest_includes_observation_when_requested(self):
        self.assertNotEqual(
            canonical_digest({"observed_at_utc": "a", "x": 1}, exclude_dynamic=False),
            canonical_digest({"observed_at_utc": "b", "x": 1}, exclude_dynamic=False),
        )


class PolicyTests(unittest.TestCase):
    def test_live_pass_is_human_only(self):
        result = policy()
        self.assertEqual(result["decision"], "PASS")
        self.assertFalse(result["execution_eligible"])

    def test_policy_version(self):
        self.assertEqual(policy()["policy_version"], "2.0.0")

    def test_secret_blocks(self):
        i = intent()
        i["mnemonic"] = "x"
        self.assertIn("SECRET_MATERIAL", codes(policy(i=i)))

    def test_unknown_field_blocks(self):
        i = intent()
        i["evaluation_time"] = "2026-07-17T03:28:05Z"
        self.assertIn("UNSUPPORTED_INTENT_FIELDS", codes(policy(i=i)))

    def test_missing_fields_block(self):
        self.assertIn("MISSING_REQUIRED_FIELDS", codes(policy(i={})))

    def test_only_direct_mint_supported(self):
        i = intent()
        i["operation"] = "redeem"
        self.assertIn("INVALID_OPERATION", codes(policy(i=i)))

    def test_missing_recipient_blocks(self):
        i = intent()
        del i["recipient"]
        self.assertIn("INVALID_RECIPIENT", codes(policy(i=i)))

    def test_invalid_recipient_blocks(self):
        i = intent()
        i["recipient"] = "0x1234"
        self.assertIn("INVALID_RECIPIENT", codes(policy(i=i)))

    def test_precision_blocks(self):
        i = intent()
        i["amount"] = "1.0000001"
        self.assertIn("AMOUNT_PRECISION_EXCEEDED", codes(policy(i=i)))

    def test_chain_blocks(self):
        i = intent()
        i["expected_chain_id"] = 1
        self.assertIn("CHAIN_MISMATCH", codes(policy(i=i)))

    def test_missing_integrity_blocks(self):
        e = evidence()
        del e["integrity"]
        self.assertIn("EVIDENCE_INTEGRITY_MISSING", codes(policy(e=e)))

    def test_tampered_integrity_blocks(self):
        e = evidence()
        e["asset"]["symbol"] = "FAKE"
        self.assertIn("EVIDENCE_INTEGRITY_MISMATCH", codes(policy(e=e)))

    def test_schema_blocks(self):
        e = evidence()
        e["artifact_type"] = "other"
        seal(e)
        self.assertIn("EVIDENCE_SCHEMA_INVALID", codes(policy(e=e)))

    def test_dirty_provenance_blocks(self):
        e = evidence()
        e["provenance"]["dirty"] = True
        seal(e)
        self.assertIn("PROVENANCE_INVALID", codes(policy(e=e)))

    def test_dependency_provenance_blocks(self):
        e = evidence()
        e["provenance"]["dependencies"]["viem"] = "0.0.0"
        seal(e)
        self.assertIn("PROVENANCE_INVALID", codes(policy(e=e)))

    def test_dependency_file_digest_blocks(self):
        e = evidence()
        e["provenance"]["dependency_files"]["package_lock_sha256"] = "0" * 64
        seal(e)
        self.assertIn("PROVENANCE_INVALID", codes(policy(e=e)))

    def test_lockfile_version_blocks(self):
        e = evidence()
        e["provenance"]["lockfile_dependencies"]["viem"]["version"] = "0.0.0"
        seal(e)
        self.assertIn("PROVENANCE_INVALID", codes(policy(e=e)))

    def test_lockfile_integrity_blocks(self):
        e = evidence()
        e["provenance"]["lockfile_dependencies"]["viem"]["integrity"] = "sha512-invalid"
        seal(e)
        self.assertIn("PROVENANCE_INVALID", codes(policy(e=e)))

    def test_runtime_dependency_blocks(self):
        e = evidence()
        e["provenance"]["runtime_dependencies"]["viem"]["version"] = "0.0.0"
        seal(e)
        self.assertIn("PROVENANCE_INVALID", codes(policy(e=e)))

    def test_legacy_provenance_cannot_execute_as_current_live(self):
        result = evaluate(intent(), legacy_evidence())
        self.assertEqual(result["decision"], "BLOCK")
        self.assertFalse(result["execution_eligible"])
        self.assertIn("PROVENANCE_INVALID", codes(result))

    def test_evaluator_clock_is_not_caller_controllable(self):
        with self.assertRaises(TypeError):
            evaluate(intent(), evidence(), evaluated_at="2026-07-17T03:29:00Z")

    def test_unsafe_evidence_blocks(self):
        e = evidence()
        e["safety"]["wallet_used"] = True
        seal(e)
        self.assertIn("UNSAFE_EVIDENCE", codes(policy(e=e)))

    def test_fallback_blocks(self):
        e = evidence()
        e["safety"]["fixture_fallback"] = True
        seal(e)
        self.assertIn("FIXTURE_FALLBACK_DETECTED", codes(policy(e=e)))

    def test_invalid_anchor_blocks(self):
        e = evidence()
        e["anchor"]["block_hash"] = "0x1234"
        seal(e)
        self.assertIn("ANCHOR_INVALID", codes(policy(e=e)))

    def test_anchor_recheck_blocks_live(self):
        e = evidence()
        e["anchor"]["hash_rechecked"] = False
        e["adapter_state"]["anchor"]["hashRechecked"] = False
        seal(e)
        self.assertIn("ANCHOR_NOT_RECHECKED", codes(policy(e=e)))

    def test_registry_identity_blocks(self):
        e = evidence()
        e["registry"]["address"] = ALICE
        seal(e)
        self.assertIn("REGISTRY_IDENTITY_MISMATCH", codes(policy(e=e)))

    def test_registry_resolution_blocks(self):
        e = evidence()
        e["registry"]["resolved_address"] = "0x" + "0" * 40
        seal(e)
        self.assertIn("REGISTRY_RESOLUTION_FAILED", codes(policy(e=e)))

    def test_registry_code_blocks(self):
        e = evidence()
        e["registry"]["code_bytes"] = 0
        seal(e)
        self.assertIn("REGISTRY_CODE_MISSING", codes(policy(e=e)))

    def test_manager_mismatch_blocks(self):
        e = evidence()
        e["asset_manager"]["address"] = ALICE
        seal(e)
        self.assertIn("ASSET_MANAGER_MISMATCH", codes(policy(e=e)))

    def test_asset_identity_blocks(self):
        e = evidence()
        e["asset"]["decimals"] = 18
        seal(e)
        self.assertIn("ASSET_IDENTITY_MISMATCH", codes(policy(e=e)))

    def test_settings_digest_blocks(self):
        e = evidence()
        e["fassets"]["settings"]["assetDecimals"] = 18
        seal(e)
        self.assertIn("FASSETS_SETTINGS_DIGEST_MISMATCH", codes(policy(e=e)))

    def test_missing_adapter_state_blocks(self):
        e = evidence()
        del e["adapter_state"]
        seal(e)
        self.assertIn("ADAPTER_STATE_MISMATCH", codes(policy(e=e)))

    def test_array_sections_block_without_crash(self):
        e = evidence()
        for field in ("anchor", "registry", "asset_manager", "asset"):
            e[field] = []
        seal(e)
        self.assertEqual(policy(e=e)["decision"], "BLOCK")

    def test_missing_direct_fee_blocks(self):
        e = evidence()
        del e["fassets"]["direct_mint"]["fee_bips"]
        del e["adapter_state"]["directMinting"]["feeBIPS"]
        seal(e)
        self.assertIn("DIRECT_MINT_FEE_EVIDENCE_MISSING", codes(policy(e=e)))

    def test_missing_direct_limit_blocks(self):
        e = evidence()
        del e["fassets"]["direct_mint"]["hourly_remaining_uba"]
        seal(e)
        self.assertIn("DIRECT_MINT_LIMIT_EVIDENCE_MISSING", codes(policy(e=e)))

    def test_evidence_amount_mismatch_blocks(self):
        e = evidence()
        e["fassets"]["direct_mint"]["proposed_amount_uba"] = "9999999"
        e["adapter_state"]["directMinting"]["proposedAmountUBA"] = "9999999"
        e["request"]["proposed_amount_uba"] = "9999999"
        seal(e)
        self.assertIn("DIRECT_MINT_AMOUNT_MISMATCH", codes(policy(e=e)))

    def test_core_vault_required(self):
        e = evidence()
        e["fassets"]["direct_mint"]["payment_address"] = ""
        seal(e)
        self.assertIn("DIRECT_MINT_CORE_VAULT_MISSING", codes(policy(e=e)))

    def test_core_vault_cannot_diverge_from_raw_adapter(self):
        e = evidence()
        e["fassets"]["direct_mint"]["payment_address"] = "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh"
        seal(e)
        result = policy(e=e)
        self.assertEqual(result["decision"], "BLOCK")
        self.assertIn("ADAPTER_STATE_MISMATCH", codes(result))

    def test_gross_quote_is_10_2_xrp(self):
        plan = policy()["payment_plan"]
        self.assertEqual(plan["net_mint_uba"], "10000000")
        self.assertEqual(plan["gross_payment_uba"], "10200000")

    def test_gross_spend_overflow_blocks(self):
        i = intent()
        i["spend_limit"] = "10.000000"
        self.assertIn("GROSS_SPEND_LIMIT_EXCEEDED", codes(policy(i=i)))

    def test_official_32_byte_memo(self):
        plan = policy()["payment_plan"]
        self.assertEqual(plan["memo_bytes"], 32)
        self.assertEqual(plan["memo_data_hex"], "464250526641001800000000" + BOB[2:])

    def test_hourly_headroom_reviews(self):
        e = evidence()
        e["fassets"]["direct_mint"]["hourly_remaining_uba"] = "1"
        seal(e)
        self.assertIn("DIRECT_MINT_HOURLY_LIMIT", codes(policy(e=e)))

    def test_limiter_headroom_cannot_diverge_from_raw_adapter(self):
        e = evidence()
        e["fassets"]["direct_mint"]["hourly_remaining_uba"] = "200000000000"
        e["fassets"]["direct_mint"]["hourly_limit_uba"] = "200000000000"
        seal(e)
        self.assertIn("ADAPTER_STATE_MISMATCH", codes(policy(e=e)))

    def test_large_threshold_requires_matching_delay(self):
        e = evidence()
        direct = e["fassets"]["direct_mint"]
        direct["large_threshold_uba"] = "1"
        e["adapter_state"]["directMinting"]["largeThresholdUBA"] = "1"
        seal(e)
        self.assertIn("DIRECT_MINT_LIMIT_EVIDENCE_INVALID", codes(policy(e=e)))

    def test_delay_reviews(self):
        e = evidence()
        anchor = parse_int(e["anchor"]["block_timestamp"])
        direct = e["fassets"]["direct_mint"]
        direct["execution_allowed_at"] = str(anchor + 3600)
        direct["delay_seconds"] = "3600"
        direct["delayed"] = True
        direct["delay_reasons"] = ["hourly_window"]
        seal(e)
        self.assertIn("DIRECT_MINT_DELAY", codes(policy(e=e)))

    def test_stale_live_reviews(self):
        result = evaluate(intent(), stale_evidence())
        self.assertIn("EVIDENCE_STALE", codes(result))
        self.assertFalse(result["execution_eligible"])

    def test_intent_cannot_forge_freshness(self):
        i = intent()
        i["evaluation_time"] = "2026-07-17T03:28:05Z"
        result = evaluate(i, stale_evidence())
        self.assertIn("EVIDENCE_STALE", codes(result))
        self.assertIn("UNSUPPORTED_INTENT_FIELDS", codes(result))

    def test_fixture_is_review(self):
        e = evidence()
        e["mode"] = "fixture"
        result = policy(e=e)
        self.assertEqual(result["decision"], "REVIEW")
        self.assertFalse(result["execution_eligible"])

    def test_historical_replay_not_execution_eligible(self):
        result = evaluate(intent(), legacy_evidence(), historical_replay=True)
        self.assertEqual(result["decision"], "PASS")
        self.assertFalse(result["execution_eligible"])
        self.assertEqual(result["audit_id"], "FLARE-DEB2AA04A4EBB912")

    def test_decision_digest_binds_anchor(self):
        first = policy()["canonical_digest"]
        e = evidence()
        e["anchor"]["block_hash"] = "0x" + "9" * 64
        e["adapter_state"]["anchor"]["blockHash"] = "0x" + "9" * 64
        seal(e)
        second = policy(e=e)["canonical_digest"]
        self.assertNotEqual(first, second)

    def test_decision_exposes_evidence_digest(self):
        e = evidence()
        result = policy(e=e)
        self.assertEqual(result["flare_evidence_sha256"], e["integrity"]["canonical_payload_sha256"])

    def test_review_human_gate(self):
        e = evidence()
        e["mode"] = "fixture"
        gate = policy(e=e)["human_gate"]
        self.assertEqual(gate["status"], "REVIEW_REQUIRED")
        self.assertEqual(gate["allowed_next_action"], "resolve_reasons_and_recheck")

    def test_pass_human_gate_has_no_signing(self):
        gate = policy()["human_gate"]
        self.assertFalse(gate["automatic_signing"])
        self.assertFalse(gate["transaction_submission"])

    def test_full_receipt_can_preserve_pass(self):
        i = intent()
        i["transaction_hash"] = "0x" + "1" * 64
        i["underlying_transaction_id"] = "0x" + "2" * 64
        result = policy(i=i, receipt=receipt(), require_receipt=True)
        self.assertEqual(result["decision"], "PASS")
        self.assertEqual(result["receipt"]["settlement_status"], "EXECUTED")

    def test_empty_success_receipt_reviews(self):
        result = policy(receipt={"status": 1}, require_receipt=True)
        self.assertEqual(result["decision"], "REVIEW")
        self.assertIn("RECEIPT_EFFECT_UNVERIFIED", codes(result))


class ReceiptTests(unittest.TestCase):
    def reason_codes(self, value):
        return {item.code for item in evaluate_receipt(receipt_intent(), value)[1]}

    def test_success(self):
        summary, reasons = evaluate_receipt(receipt_intent(), receipt())
        self.assertFalse(reasons)
        self.assertEqual(summary["settlement_status"], "EXECUTED")

    def test_failed(self):
        value = receipt()
        value["status"] = "FAILED"
        self.assertIn("RECEIPT_FAILED", self.reason_codes(value))

    def test_pending(self):
        value = receipt()
        value["status"] = "PENDING"
        self.assertIn("RECEIPT_PENDING", self.reason_codes(value))

    def test_unknown(self):
        value = receipt()
        value["status"] = "mystery"
        self.assertIn("RECEIPT_STATUS_UNKNOWN", self.reason_codes(value))

    def test_chain_mismatch(self):
        value = receipt()
        value["chain_id"] = 1
        self.assertIn("RECEIPT_CHAIN_MISMATCH", self.reason_codes(value))

    def test_tx_hash_mismatch(self):
        i = receipt_intent()
        i["transaction_hash"] = "0x" + "3" * 64
        self.assertIn("RECEIPT_TX_HASH_MISMATCH", {x.code for x in evaluate_receipt(i, receipt())[1]})

    def test_underlying_tx_mismatch(self):
        i = receipt_intent()
        i["underlying_transaction_id"] = "0x" + "3" * 64
        self.assertIn("RECEIPT_UNDERLYING_TX_MISMATCH", {x.code for x in evaluate_receipt(i, receipt())[1]})

    def test_asset_mismatch(self):
        value = receipt()
        value["asset_address"] = ALICE
        self.assertIn("RECEIPT_ASSET_MISMATCH", self.reason_codes(value))

    def test_amount_mismatch(self):
        value = receipt()
        value["event"]["minted_amount_uba"] = "1"
        self.assertIn("RECEIPT_AMOUNT_MISMATCH", self.reason_codes(value))

    def test_emitter_mismatch(self):
        value = receipt()
        value["event"]["emitter"] = ALICE
        self.assertIn("RECEIPT_EMITTER_MISMATCH", self.reason_codes(value))

    def test_fee_mismatch(self):
        value = receipt()
        value["event"]["executor_fee_uba"] = "1"
        self.assertIn("RECEIPT_FEE_MISMATCH", self.reason_codes(value))

    def test_recipient_mismatch(self):
        value = receipt()
        value["event"]["recipient"] = ALICE
        self.assertIn("RECEIPT_RECIPIENT_MISMATCH", self.reason_codes(value))

    def test_sender_mismatch(self):
        i = receipt_intent()
        i["underlying_sender_address"] = "rExpected"
        self.assertIn("RECEIPT_SENDER_MISMATCH", {x.code for x in evaluate_receipt(i, receipt())[1]})

    def test_complete_mismatched_receipts_never_execute(self):
        cases = []

        value = receipt()
        value["chain_id"] = 1
        cases.append(("chain", receipt_intent(), value, "RECEIPT_CHAIN_MISMATCH"))

        i = receipt_intent()
        i["transaction_hash"] = "0x" + "3" * 64
        cases.append(("transaction_hash", i, receipt(), "RECEIPT_TX_HASH_MISMATCH"))

        i = receipt_intent()
        i["underlying_transaction_id"] = "0x" + "3" * 64
        cases.append(("underlying_transaction", i, receipt(), "RECEIPT_UNDERLYING_TX_MISMATCH"))

        for name, field, replacement, reason_code in (
            ("asset", "asset_address", ALICE, "RECEIPT_ASSET_MISMATCH"),
            ("amount", "minted_amount_uba", "1", "RECEIPT_AMOUNT_MISMATCH"),
            ("emitter", "emitter", ALICE, "RECEIPT_EMITTER_MISMATCH"),
            ("fee", "executor_fee_uba", "1", "RECEIPT_FEE_MISMATCH"),
            ("recipient", "recipient", ALICE, "RECEIPT_RECIPIENT_MISMATCH"),
        ):
            value = receipt()
            if field == "asset_address":
                value[field] = replacement
            else:
                value["event"][field] = replacement
            cases.append((name, receipt_intent(), value, reason_code))

        i = receipt_intent()
        i["underlying_sender_address"] = "rExpected"
        cases.append(("sender", i, receipt(), "RECEIPT_SENDER_MISMATCH"))

        for name, i, value, reason_code in cases:
            with self.subTest(name=name):
                summary, reasons = evaluate_receipt(i, value)
                self.assertIn(reason_code, {item.code for item in reasons})
                self.assertNotEqual(summary["settlement_status"], "EXECUTED")

    def test_complete_observation_without_preflight_bindings_never_executes(self):
        summary, reasons = evaluate_receipt({}, receipt())
        self.assertEqual(summary["settlement_status"], "UNVERIFIED")
        self.assertIn("RECEIPT_PREFLIGHT_BINDING_MISSING", {item.code for item in reasons})

    def test_expected_sender_missing_reviews(self):
        i = receipt_intent()
        i["underlying_sender_address"] = "rExpected"
        value = receipt()
        del value["event"]["source_address"]
        self.assertIn("RECEIPT_EFFECT_UNVERIFIED", {x.code for x in evaluate_receipt(i, value)[1]})

    def test_native_target_address_alias(self):
        value = receipt()
        del value["event"]["recipient"]
        value["event"]["targetAddress"] = BOB
        self.assertFalse(evaluate_receipt(receipt_intent(), value)[1])

    def test_delayed_event_reviews(self):
        value = receipt()
        value["event"]["name"] = "DirectMintingDelayed"
        summary, reasons = evaluate_receipt(receipt_intent(), value)
        self.assertEqual(summary["settlement_status"], "DELAYED")
        self.assertIn("RECEIPT_DIRECT_MINT_DELAYED", {item.code for item in reasons})

    def test_missing_event_reviews(self):
        value = receipt()
        del value["event"]
        self.assertIn("RECEIPT_EFFECT_UNVERIFIED", self.reason_codes(value))

    def test_untrusted_event_reviews(self):
        value = receipt()
        value["trusted_event_verified"] = False
        self.assertIn("RECEIPT_SETTLEMENT_UNVERIFIED", self.reason_codes(value))

    def test_nonlive_event_reviews(self):
        value = receipt()
        value["verification_mode"] = "fixture"
        self.assertIn("RECEIPT_SETTLEMENT_UNVERIFIED", self.reason_codes(value))

    def test_receipt_digest_ignores_unmodeled_observation(self):
        left = receipt()
        left["observed_at"] = "a"
        right = receipt()
        right["observed_at"] = "b"
        self.assertEqual(evaluate_receipt(receipt_intent(), left)[0]["receipt_digest"], evaluate_receipt(receipt_intent(), right)[0]["receipt_digest"])


class CliTests(unittest.TestCase):
    def _run(self, i, e, *extra):
        with tempfile.TemporaryDirectory() as directory:
            ip = Path(directory) / "i.json"
            ep = Path(directory) / "e.json"
            ip.write_text(json.dumps(i), encoding="utf-8")
            ep.write_text(json.dumps(e), encoding="utf-8")
            args = ["--intent", str(ip), "--evidence", str(ep), "--compact", *extra]
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                return main(args)

    def test_historical_pass_exit(self):
        self.assertEqual(self._run(intent(), evidence(), "--historical-replay"), 0)

    def test_review_exit(self):
        e = evidence()
        e["mode"] = "fixture"
        self.assertEqual(self._run(intent(), e), 10)

    def test_block_exit(self):
        i = intent()
        i["expected_chain_id"] = 1
        self.assertEqual(self._run(i, evidence(), "--historical-replay"), 20)

    def test_required_receipt_exit(self):
        self.assertEqual(self._run(intent(), evidence(), "--historical-replay", "--require-receipt"), 10)

    def test_bad_intent_exit(self):
        with tempfile.NamedTemporaryFile("w", delete=False) as bad:
            bad.write("{")
            name = bad.name
        try:
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(main(["--intent", name, "--evidence", str(LIVE_PATH)]), 64)
        finally:
            os.unlink(name)

    def test_bad_evidence_exit(self):
        with tempfile.NamedTemporaryFile("w", delete=False) as bad:
            bad.write("{")
            name = bad.name
        try:
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(main(["--intent", str(INTENT_PATH), "--evidence", name]), 70)
        finally:
            os.unlink(name)


if __name__ == "__main__":
    unittest.main()
