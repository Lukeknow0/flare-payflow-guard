import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { sha256Canonical } from "../../src/flare-adapter/canonical.mjs";
import {
  CONTRACT_REGISTRY,
  LIVE_AMOUNT_UBA,
  parseVerifyArgs,
  runLiveVerification,
  validateDecision,
  validateEvidenceArtifact,
  validateEvidencePair,
} from "../../scripts/verify-live.mjs";

const MANAGER = "0xc1Ca88b937d0b528842F95d5731ffB586f4fbDFA";
const FASSET = "0x0b6A3645c240605887a5532109323A3E12273dc7";
const COMMIT = "a".repeat(40);
const TREE = "b".repeat(40);
const TEST_SRI = `sha512-${Buffer.alloc(64, 7).toString("base64")}`;

test("verify CLI only retains evidence under evidence/live", () => {
  assert.deepEqual(parseVerifyArgs([]), {});
  assert.match(parseVerifyArgs(["--retain-dir", "evidence/live/final-test"]).retainDirectory, /evidence\/live\/final-test$/);
  assert.throws(() => parseVerifyArgs(["--retain-dir", "/tmp/out"]), /under evidence\/live/);
  assert.throws(() => parseVerifyArgs(["--unknown", "x"]), /Usage/);
});

function syntheticEvidence({ blockNumber = "123456", blockByte = "11" } = {}) {
  const settings = {
    fAsset: FASSET,
    assetDecimals: 6,
    assetMintingGranularityUBA: "10",
  };
  const direct = {
    payment_address: "rSyntheticCoreVaultAddress",
    proposed_amount_uba: LIVE_AMOUNT_UBA,
    minimum_fee_uba: "100000",
    executor_fee_uba: "100000",
    fee_bips: "25",
    hourly_limit_uba: "100000000000",
    hourly_remaining_uba: "100000000000",
    daily_limit_uba: "500000000000",
    daily_remaining_uba: "500000000000",
    large_threshold_uba: "100000000000",
    large_delay_seconds: "3600",
    execution_allowed_at: "1800000000",
    delay_seconds: "0",
    delayed: false,
    delay_reasons: [],
    limiter_disabled: false,
  };
  const payload = {
    schema_version: "1.0.0",
    artifact_type: "flare_fassets_evidence",
    mode: "live",
    captured_at_utc: "2027-01-15T08:00:00.000Z",
    observed_at_utc: "2027-01-15T08:00:00.000Z",
    request: {
      proposed_amount_uba: LIVE_AMOUNT_UBA,
      block_selection: "official-coston2-latest-minus-2",
      selected_block_number: blockNumber,
    },
    provenance: {
      commit: COMMIT,
      tree: TREE,
      dirty: false,
      node: "v22.0.0",
      dependencies: {
        "@flarenetwork/flare-wagmi-periphery-package": "3.1.0",
        viem: "2.48.4",
      },
      dependency_files: {
        package_json_sha256: "d".repeat(64),
        package_lock_sha256: "e".repeat(64),
      },
      lockfile_dependencies: {
        "@flarenetwork/flare-wagmi-periphery-package": { version: "3.1.0", integrity: TEST_SRI },
        viem: { version: "2.48.4", integrity: TEST_SRI },
      },
      runtime_dependencies: {
        "@flarenetwork/flare-wagmi-periphery-package": { version: "3.1.0" },
        viem: { version: "2.48.4" },
      },
    },
    safety: {
      read_only: true,
      wallet_used: false,
      private_key_required: false,
      signing_performed: false,
      chain_write_performed: false,
      transaction_broadcast: false,
      fixture_fallback: false,
      mock_fallback: false,
    },
    network: { expected_chain_id: 114, observed_chain_id: 114 },
    anchor: {
      block_number: blockNumber,
      block_hash: `0x${blockByte.repeat(32)}`,
      block_timestamp: "1800000000",
      hash_rechecked: true,
    },
    registry: {
      address: CONTRACT_REGISTRY,
      lookup_name: "AssetManagerFXRP",
      resolved_address: MANAGER,
      code_bytes: 3197,
      code_sha256: "1".repeat(64),
    },
    asset_manager: {
      address: MANAGER,
      code_bytes: 217,
      code_sha256: "2".repeat(64),
    },
    asset: {
      address: FASSET,
      name: "FXRP",
      symbol: "FTestXRP",
      decimals: 6,
      code_bytes: 177,
      code_sha256: "3".repeat(64),
    },
    fassets: {
      settings,
      settings_sha256: sha256Canonical(settings),
      direct_mint: direct,
    },
    adapter_state: {
      mode: "live",
      readOnly: true,
      network: { expectedChainId: 114, observedChainId: 114 },
      registry: { address: CONTRACT_REGISTRY },
      assetManager: { address: MANAGER },
      fAsset: { address: FASSET },
      directMinting: { proposedAmountUBA: LIVE_AMOUNT_UBA },
    },
  };
  return {
    ...payload,
    integrity: {
      algorithm: "sha256",
      canonicalization: "sorted-keys-bigint-decimal-v1",
      payload_scope: "artifact excluding integrity",
      canonical_payload_sha256: sha256Canonical(payload),
    },
  };
}

function refreshIntegrity(artifact) {
  const { integrity, ...payload } = artifact;
  return {
    ...payload,
    integrity: { ...integrity, canonical_payload_sha256: sha256Canonical(payload) },
  };
}

function passDecision(run, capturedEvidence) {
  const digit = String(run % 10);
  return {
    schema_version: "1.1.0",
    artifact_type: "flare_guard_decision",
    policy_version: "2.0.0",
    decision: "PASS",
    execution_eligible: false,
    audit_id: `FLARE-${digit.repeat(16)}`,
    canonical_digest: digit.repeat(64),
    flare_evidence_sha256: capturedEvidence.evidence_sha256,
    evidence_anchor: {
      block_number: capturedEvidence.block_number,
      block_hash: capturedEvidence.block_hash,
      capture_commit: capturedEvidence.commit,
      capture_tree: capturedEvidence.tree,
      settings_sha256: capturedEvidence.settings_sha256,
    },
    evaluation: {
      evaluated_at_utc: "2027-01-15T08:00:01Z",
      historical_replay: false,
      maximum_evidence_age_seconds: 900,
    },
    payment_plan: {
      net_mint_uba: LIVE_AMOUNT_UBA,
      gross_payment_uba: "10200000",
      memo_bytes: 32,
      memo_data_hex: "4642505266410018000000000000000000000000000000000000000000000002",
    },
    human_gate: {
      status: "HUMAN_CONFIRMATION_REQUIRED",
      automatic_signing: false,
      transaction_submission: false,
      private_key_custody: false,
      allowed_next_action: "human_wallet_review_only",
    },
  };
}

test("live validator accepts canonical synthetic captures and one stable address pair", () => {
  const left = validateEvidenceArtifact(syntheticEvidence(), "left");
  const right = validateEvidenceArtifact(
    syntheticEvidence({ blockNumber: "123457", blockByte: "22" }),
    "right",
  );
  assert.equal(left.commit, COMMIT);
  assert.equal(left.asset_manager.toLowerCase(), MANAGER.toLowerCase());
  assert.equal(validateEvidencePair(left, right), true);
  assert.equal(validateDecision(passDecision(1, left), "decision", left).decision, "PASS");
});

test("live validator fails closed on tampering, wrong chain, fallback, and missing direct state", async (t) => {
  await t.test("canonical tampering", () => {
    const artifact = syntheticEvidence();
    artifact.asset.symbol = "TAMPERED";
    assert.throws(() => validateEvidenceArtifact(artifact), /canonical integrity mismatch/);
  });

  await t.test("wrong Coston2 chain", () => {
    const artifact = syntheticEvidence();
    artifact.network.observed_chain_id = 1;
    assert.throws(() => validateEvidenceArtifact(refreshIntegrity(artifact)), /wrong observed chain/);
  });

  await t.test("fixture fallback", () => {
    const artifact = syntheticEvidence();
    artifact.safety.fixture_fallback = true;
    assert.throws(() => validateEvidenceArtifact(refreshIntegrity(artifact)), /fixture_fallback must be false/);
  });

  await t.test("missing direct-mint state", () => {
    const artifact = syntheticEvidence();
    delete artifact.fassets.direct_mint;
    assert.throws(() => validateEvidenceArtifact(refreshIntegrity(artifact)), /direct_mint must be an object/);
  });
});

test("live orchestration uses two capture children, two decision children, and removes its OS temp directory", async () => {
  const directory = await mkdtemp(join(tmpdir(), "flare-live-test-"));
  const retainDirectory = `${directory}-retained`;
  const specifications = [];
  const captured = new Map();
  const result = await runLiveVerification({
    createTempDirectory: async () => directory,
    retainDirectory,
    executeChild: async (specification) => {
      specifications.push(specification);
      if (specification.kind === "capture") {
        const artifact = syntheticEvidence({
          blockNumber: String(123455 + specification.run),
          blockByte: specification.run === 1 ? "33" : "44",
        });
        captured.set(specification.run, validateEvidenceArtifact(artifact));
        await writeFile(specification.outputPath, `${JSON.stringify(artifact)}\n`, { flag: "wx" });
        return { stdout: "", stderr: "" };
      }
      return { stdout: `${JSON.stringify(passDecision(specification.run, captured.get(specification.run)))}\n`, stderr: "" };
    },
  });

  assert.equal(result.status, "VERIFY_LIVE_PASS");
  assert.equal(result.runs.length, 2);
  assert.equal(result.runs.every((run) => run.decision === "PASS"), true);
  assert.equal(result.runs.every((run) => run.verified_live_pass === true), true);
  assert.equal(result.runs.every((run) => run.execution_eligible === false), true);
  assert.equal(result.safety.private_key_required, false);
  assert.equal(result.safety.chain_write_performed, false);
  assert.equal(specifications.filter((item) => item.kind === "capture").length, 2);
  assert.equal(specifications.filter((item) => item.kind === "decision").length, 2);
  const outputPaths = specifications.filter((item) => item.kind === "capture").map((item) => item.outputPath);
  assert.notEqual(outputPaths[0], outputPaths[1]);
  await assert.rejects(access(directory));
  const retainedSummary = JSON.parse(await readFile(join(retainDirectory, "verification-summary.json"), "utf8"));
  assert.equal(retainedSummary.status, "VERIFY_LIVE_PASS");
  await access(join(retainDirectory, "capture-1.json"));
  await access(join(retainDirectory, "decision-2.json"));
  await rm(retainDirectory, { recursive: true, force: true });
});

test("live orchestration propagates child failure and still removes its OS temp directory", async () => {
  const directory = await mkdtemp(join(tmpdir(), "flare-live-failure-test-"));
  await assert.rejects(
    runLiveVerification({
      createTempDirectory: async () => directory,
      executeChild: async () => {
        throw new Error("synthetic child failure");
      },
    }),
    /synthetic child failure/,
  );
  await assert.rejects(access(directory));
});
