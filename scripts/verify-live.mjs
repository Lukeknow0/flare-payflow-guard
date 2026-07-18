#!/usr/bin/env node

import { execFile as execFileCallback } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, isAbsolute, join, relative, resolve } from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

import { sha256Canonical } from "../src/flare-adapter/canonical.mjs";

export const LIVE_AMOUNT_UBA = "10000000";
export const COSTON2_CHAIN_ID = 114;
export const CONTRACT_REGISTRY =
  "0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019";
export const ASSET_MANAGER_LOOKUP = "AssetManagerFXRP";

const execFile = promisify(execFileCallback);
const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(SCRIPT_DIRECTORY, "..");
const HASH_32 = /^[0-9a-f]{64}$/i;
const GIT_OBJECT_ID = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/i;
const EVM_ADDRESS = /^0x[0-9a-f]{40}$/i;
const BLOCK_HASH = /^0x[0-9a-f]{64}$/i;
const DECIMAL_INTEGER = /^[0-9]+$/;
const SRI = /^sha(?:256|384|512)-[A-Za-z0-9+/]+={0,2}$/;
const PINNED_DEPENDENCIES = Object.freeze({
  "@flarenetwork/flare-wagmi-periphery-package": "3.1.0",
  viem: "2.48.4",
});

export function parseVerifyArgs(argv) {
  if (!Array.isArray(argv)) throw new TypeError("argv must be an array");
  if (argv.length === 0) return {};
  if (argv.length !== 2 || argv[0] !== "--retain-dir" || !argv[1]) {
    throw new TypeError("Usage: node scripts/verify-live.mjs [--retain-dir evidence/live/<new-directory>]");
  }
  const evidenceRoot = resolve(PROJECT_ROOT, "evidence", "live");
  const retainDirectory = resolve(PROJECT_ROOT, argv[1]);
  const child = relative(evidenceRoot, retainDirectory);
  if (!child || child.startsWith("..") || isAbsolute(child)) {
    throw new Error("--retain-dir must be a new child directory under evidence/live");
  }
  return { retainDirectory };
}

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function object(value, label) {
  invariant(value !== null && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  return value;
}

function address(value, label) {
  invariant(typeof value === "string" && EVM_ADDRESS.test(value), `${label} must be an EVM address`);
  invariant(value.toLowerCase() !== `0x${"0".repeat(40)}`, `${label} must not be the zero address`);
  return value;
}

function sameAddress(left, right) {
  return typeof left === "string" && typeof right === "string" && left.toLowerCase() === right.toLowerCase();
}

function integerString(value, label) {
  invariant(typeof value === "string" && DECIMAL_INTEGER.test(value), `${label} must be a non-negative decimal integer string`);
  return value;
}

function codeIdentity(section, label) {
  const value = object(section, label);
  invariant(Number.isSafeInteger(value.code_bytes) && value.code_bytes > 0, `${label}.code_bytes must be positive`);
  invariant(typeof value.code_sha256 === "string" && HASH_32.test(value.code_sha256), `${label}.code_sha256 is invalid`);
}

/** Fail-closed validation for one capture-fassets-preflight artifact. */
export function validateEvidenceArtifact(artifact, label = "evidence") {
  const evidence = object(artifact, label);
  invariant(evidence.schema_version === "1.0.0", `${label}: unsupported schema version`);
  invariant(evidence.artifact_type === "flare_fassets_evidence", `${label}: wrong artifact type`);
  invariant(evidence.mode === "live", `${label}: mode is not live`);

  const integrity = object(evidence.integrity, `${label}.integrity`);
  invariant(integrity.algorithm === "sha256", `${label}: unsupported integrity algorithm`);
  invariant(integrity.canonicalization === "sorted-keys-bigint-decimal-v1", `${label}: wrong canonicalization`);
  invariant(integrity.payload_scope === "artifact excluding integrity", `${label}: wrong integrity scope`);
  invariant(typeof integrity.canonical_payload_sha256 === "string" && HASH_32.test(integrity.canonical_payload_sha256), `${label}: invalid canonical digest`);
  const { integrity: ignoredIntegrity, ...payload } = evidence;
  void ignoredIntegrity;
  invariant(sha256Canonical(payload) === integrity.canonical_payload_sha256, `${label}: canonical integrity mismatch`);

  const request = object(evidence.request, `${label}.request`);
  invariant(integerString(request.proposed_amount_uba, `${label}.request.proposed_amount_uba`) === LIVE_AMOUNT_UBA, `${label}: capture amount is not ${LIVE_AMOUNT_UBA} UBA`);
  integerString(request.selected_block_number, `${label}.request.selected_block_number`);

  const safety = object(evidence.safety, `${label}.safety`);
  invariant(safety.read_only === true, `${label}: read_only is not true`);
  for (const field of [
    "wallet_used",
    "private_key_required",
    "signing_performed",
    "chain_write_performed",
    "transaction_broadcast",
    "fixture_fallback",
    "mock_fallback",
  ]) {
    invariant(safety[field] === false, `${label}: safety.${field} must be false`);
  }

  const provenance = object(evidence.provenance, `${label}.provenance`);
  invariant(typeof provenance.commit === "string" && GIT_OBJECT_ID.test(provenance.commit), `${label}: invalid Git commit`);
  invariant(typeof provenance.tree === "string" && GIT_OBJECT_ID.test(provenance.tree), `${label}: invalid Git tree`);
  invariant(provenance.dirty === false, `${label}: capture came from a dirty worktree`);
  const dependencies = object(provenance.dependencies, `${label}.provenance.dependencies`);
  const dependencyFiles = object(provenance.dependency_files, `${label}.provenance.dependency_files`);
  invariant(HASH_32.test(dependencyFiles.package_json_sha256 ?? ""), `${label}: invalid package.json digest`);
  invariant(HASH_32.test(dependencyFiles.package_lock_sha256 ?? ""), `${label}: invalid package-lock.json digest`);
  const lockedDependencies = object(provenance.lockfile_dependencies, `${label}.provenance.lockfile_dependencies`);
  const runtimeDependencies = object(provenance.runtime_dependencies, `${label}.provenance.runtime_dependencies`);
  for (const [name, version] of Object.entries(PINNED_DEPENDENCIES)) {
    invariant(dependencies[name] === version, `${label}: ${name} declared version mismatch`);
    invariant(lockedDependencies[name]?.version === version, `${label}: ${name} lockfile version mismatch`);
    invariant(SRI.test(lockedDependencies[name]?.integrity ?? ""), `${label}: ${name} lockfile SRI is invalid`);
    invariant(runtimeDependencies[name]?.version === version, `${label}: ${name} runtime version mismatch`);
  }

  const network = object(evidence.network, `${label}.network`);
  invariant(network.expected_chain_id === COSTON2_CHAIN_ID, `${label}: wrong expected chain`);
  invariant(network.observed_chain_id === COSTON2_CHAIN_ID, `${label}: wrong observed chain`);

  const anchor = object(evidence.anchor, `${label}.anchor`);
  integerString(anchor.block_number, `${label}.anchor.block_number`);
  integerString(anchor.block_timestamp, `${label}.anchor.block_timestamp`);
  invariant(typeof anchor.block_hash === "string" && BLOCK_HASH.test(anchor.block_hash), `${label}: invalid anchor block hash`);
  invariant(anchor.hash_rechecked === true, `${label}: anchor hash was not rechecked`);
  invariant(anchor.block_number === request.selected_block_number, `${label}: request and anchor blocks differ`);

  const registry = object(evidence.registry, `${label}.registry`);
  invariant(sameAddress(registry.address, CONTRACT_REGISTRY), `${label}: wrong Contract Registry address`);
  invariant(registry.lookup_name === ASSET_MANAGER_LOOKUP, `${label}: wrong registry lookup name`);
  address(registry.resolved_address, `${label}.registry.resolved_address`);
  codeIdentity(registry, `${label}.registry`);

  const manager = object(evidence.asset_manager, `${label}.asset_manager`);
  address(manager.address, `${label}.asset_manager.address`);
  invariant(sameAddress(manager.address, registry.resolved_address), `${label}: AssetManager does not match Registry resolution`);
  codeIdentity(manager, `${label}.asset_manager`);

  const asset = object(evidence.asset, `${label}.asset`);
  address(asset.address, `${label}.asset.address`);
  invariant(typeof asset.symbol === "string" && asset.symbol.length > 0, `${label}: asset symbol is missing`);
  invariant(Number.isInteger(asset.decimals) && asset.decimals >= 0, `${label}: asset decimals are invalid`);
  codeIdentity(asset, `${label}.asset`);

  const fassets = object(evidence.fassets, `${label}.fassets`);
  const settings = object(fassets.settings, `${label}.fassets.settings`);
  invariant(typeof fassets.settings_sha256 === "string" && HASH_32.test(fassets.settings_sha256), `${label}: invalid settings digest`);
  invariant(sha256Canonical(settings) === fassets.settings_sha256, `${label}: settings digest mismatch`);
  invariant(sameAddress(settings.fAsset, asset.address), `${label}: settings.fAsset differs from observed asset`);
  invariant(Number(settings.assetDecimals) === asset.decimals, `${label}: settings assetDecimals differs from observed asset`);

  const direct = object(fassets.direct_mint, `${label}.fassets.direct_mint`);
  invariant(integerString(direct.proposed_amount_uba, `${label}.direct_mint.proposed_amount_uba`) === LIVE_AMOUNT_UBA, `${label}: direct-mint amount mismatch`);
  invariant(typeof direct.payment_address === "string" && direct.payment_address.trim().length > 0, `${label}: direct-mint payment address is missing`);
  for (const field of [
    "minimum_fee_uba",
    "executor_fee_uba",
    "fee_bips",
    "hourly_limit_uba",
    "hourly_remaining_uba",
    "daily_limit_uba",
    "daily_remaining_uba",
    "large_threshold_uba",
    "large_delay_seconds",
    "execution_allowed_at",
    "delay_seconds",
  ]) {
    integerString(direct[field], `${label}.direct_mint.${field}`);
  }
  invariant(typeof direct.limiter_disabled === "boolean", `${label}: direct-mint limiter state is missing`);
  invariant(typeof direct.delayed === "boolean", `${label}: direct-mint delayed state is missing`);
  invariant(Array.isArray(direct.delay_reasons) && direct.delay_reasons.every((item) => typeof item === "string"), `${label}: direct-mint delay reasons are invalid`);

  const adapter = object(evidence.adapter_state, `${label}.adapter_state`);
  invariant(adapter.mode === "live" && adapter.readOnly === true, `${label}: adapter did not report read-only live mode`);
  invariant(adapter.network?.expectedChainId === COSTON2_CHAIN_ID && adapter.network?.observedChainId === COSTON2_CHAIN_ID, `${label}: adapter chain identity mismatch`);
  invariant(sameAddress(adapter.registry?.address, registry.address), `${label}: adapter Registry mismatch`);
  invariant(sameAddress(adapter.assetManager?.address, manager.address), `${label}: adapter AssetManager mismatch`);
  invariant(sameAddress(adapter.fAsset?.address, asset.address), `${label}: adapter FAsset mismatch`);
  invariant(String(adapter.directMinting?.proposedAmountUBA) === LIVE_AMOUNT_UBA, `${label}: adapter direct-mint amount mismatch`);

  return {
    commit: provenance.commit,
    tree: provenance.tree,
    block_number: anchor.block_number,
    block_hash: anchor.block_hash,
    registry: registry.address,
    asset_manager: manager.address,
    fasset: asset.address,
    symbol: asset.symbol,
    direct_mint_delayed: direct.delayed,
    settings_sha256: fassets.settings_sha256,
    evidence_sha256: integrity.canonical_payload_sha256,
    package_lock_sha256: dependencyFiles.package_lock_sha256,
  };
}

export function validateEvidencePair(left, right) {
  invariant(left.commit === right.commit, "live captures do not share one Git commit");
  invariant(left.tree === right.tree, "live captures do not share one Git tree");
  invariant(sameAddress(left.registry, right.registry), "Contract Registry changed between live captures");
  invariant(sameAddress(left.asset_manager, right.asset_manager), "AssetManagerFXRP changed between live captures");
  invariant(sameAddress(left.fasset, right.fasset), "FAsset changed between live captures");
  invariant(left.symbol === right.symbol, "FAsset symbol changed between live captures");
  return true;
}

export function validateDecision(decision, label = "decision", evidence = undefined) {
  const result = object(decision, label);
  const anchoredEvidence = object(evidence, `${label}.validated_evidence`);
  invariant(result.schema_version === "1.1.0", `${label}: unsupported decision schema`);
  invariant(result.artifact_type === "flare_guard_decision", `${label}: wrong artifact type`);
  invariant(result.policy_version === "2.0.0", `${label}: wrong policy version`);
  invariant(result.decision === "PASS", `${label}: expected PASS, observed ${String(result.decision)}`);
  invariant(result.execution_eligible === false, `${label}: pure policy output must remain human-only`);
  invariant(/^FLARE-[0-9A-F]{16}$/.test(result.audit_id ?? ""), `${label}: audit ID is invalid`);
  invariant(HASH_32.test(result.canonical_digest ?? ""), `${label}: decision digest is invalid`);
  invariant(result.flare_evidence_sha256 === anchoredEvidence.evidence_sha256, `${label}: decision is not bound to evidence digest`);
  const anchor = object(result.evidence_anchor, `${label}.evidence_anchor`);
  invariant(String(anchor.block_number) === anchoredEvidence.block_number, `${label}: decision block number mismatch`);
  invariant(anchor.block_hash === anchoredEvidence.block_hash, `${label}: decision block hash mismatch`);
  invariant(anchor.capture_commit === anchoredEvidence.commit, `${label}: decision capture commit mismatch`);
  invariant(anchor.capture_tree === anchoredEvidence.tree, `${label}: decision capture tree mismatch`);
  invariant(anchor.settings_sha256 === anchoredEvidence.settings_sha256, `${label}: decision settings digest mismatch`);
  const evaluation = object(result.evaluation, `${label}.evaluation`);
  invariant(evaluation.historical_replay === false, `${label}: live decision is a historical replay`);
  invariant(evaluation.maximum_evidence_age_seconds === 900, `${label}: freshness policy mismatch`);
  invariant(typeof evaluation.evaluated_at_utc === "string", `${label}: evaluation time is missing`);
  const plan = object(result.payment_plan, `${label}.payment_plan`);
  invariant(plan.net_mint_uba === LIVE_AMOUNT_UBA, `${label}: net mint quote mismatch`);
  invariant(plan.gross_payment_uba === "10200000", `${label}: gross payment quote mismatch`);
  invariant(plan.memo_bytes === 32, `${label}: direct-mint memo is not 32 bytes`);
  invariant(/^[0-9a-f]{64}$/.test(plan.memo_data_hex ?? ""), `${label}: direct-mint memo is invalid`);
  invariant(plan.memo_data_hex.startsWith("464250526641001800000000"), `${label}: direct-mint memo prefix is invalid`);
  const gate = object(result.human_gate, `${label}.human_gate`);
  invariant(gate.status === "HUMAN_CONFIRMATION_REQUIRED", `${label}: human confirmation gate is not active`);
  invariant(gate.automatic_signing === false, `${label}: automatic signing must remain disabled`);
  invariant(gate.transaction_submission === false, `${label}: transaction submission must remain disabled`);
  invariant(gate.private_key_custody === false, `${label}: private-key custody must remain disabled`);
  invariant(gate.allowed_next_action === "human_wallet_review_only", `${label}: next action is not human wallet review`);
  return {
    decision: result.decision,
    verified_live_pass: true,
    audit_id: result.audit_id,
    decision_sha256: result.canonical_digest,
    human_gate: gate.status,
    execution_eligible: result.execution_eligible,
    gross_payment_uba: plan.gross_payment_uba,
    memo_data_hex: plan.memo_data_hex,
  };
}

async function defaultExecuteChild(specification) {
  const result = await execFile(specification.command, specification.args, {
    cwd: specification.cwd,
    env: specification.env,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  return { stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

async function readJson(path, label) {
  let value;
  try {
    value = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`${label}: cannot read JSON (${error instanceof Error ? error.message : String(error)})`);
  }
  return object(value, label);
}

/**
 * Execute two independent live capture child processes, then independently run
 * the Python guard over both artifacts. Dependencies are injectable so tests
 * can use synthetic artifacts without any network access.
 */
export async function runLiveVerification({
  executeChild = defaultExecuteChild,
  createTempDirectory = () => mkdtemp(join(tmpdir(), "flare-payflow-live-")),
  removeTempDirectory = (path) => rm(path, { recursive: true, force: true }),
  projectRoot = PROJECT_ROOT,
  pythonCommand = process.env.PYTHON || "python3",
  retainDirectory = undefined,
} = {}) {
  const temporaryDirectory = await createTempDirectory();
  const evidencePaths = [
    join(temporaryDirectory, "capture-1.json"),
    join(temporaryDirectory, "capture-2.json"),
  ];
  const captureScript = join(projectRoot, "scripts", "capture-fassets-preflight.mjs");
  const intentPath = join(projectRoot, "examples", "intents", "direct-mint-10-xrp.json");
  const pythonPath = [join(projectRoot, "src"), process.env.PYTHONPATH].filter(Boolean).join(delimiter);

  try {
    await Promise.all(
      evidencePaths.map((outputPath, index) =>
        executeChild({
          kind: "capture",
          run: index + 1,
          outputPath,
          command: process.execPath,
          args: [captureScript, "--amount-uba", LIVE_AMOUNT_UBA, "--out", outputPath],
          cwd: projectRoot,
          env: { ...process.env },
        }),
      ),
    );

    const artifacts = await Promise.all(
      evidencePaths.map((path, index) => readJson(path, `live capture ${index + 1}`)),
    );
    const evidenceSummaries = artifacts.map((artifact, index) =>
      validateEvidenceArtifact(artifact, `live capture ${index + 1}`),
    );
    validateEvidencePair(evidenceSummaries[0], evidenceSummaries[1]);

    const decisionOutputs = await Promise.all(
      evidencePaths.map((evidencePath, index) =>
        executeChild({
          kind: "decision",
          run: index + 1,
          evidencePath,
          command: pythonCommand,
          args: [
            "-m",
            "flare_guard.cli",
            "--intent",
            intentPath,
            "--evidence",
            evidencePath,
            "--compact",
          ],
          cwd: projectRoot,
          env: { ...process.env, PYTHONPATH: pythonPath },
        }),
      ),
    );

    const decisionSummaries = decisionOutputs.map((output, index) => {
      let decision;
      try {
        decision = JSON.parse(output.stdout);
      } catch (error) {
        throw new Error(`decision ${index + 1}: invalid JSON (${error instanceof Error ? error.message : String(error)})`);
      }
      return validateDecision(decision, `decision ${index + 1}`, evidenceSummaries[index]);
    });

    const result = {
      status: "VERIFY_LIVE_PASS",
      mode: "live",
      amount_uba: LIVE_AMOUNT_UBA,
      runs: evidenceSummaries.map((evidence, index) => ({
        ...evidence,
        ...decisionSummaries[index],
      })),
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
    };
    if (retainDirectory !== undefined) {
      await mkdir(retainDirectory, { recursive: false });
      await Promise.all(
        evidencePaths.map((source, index) =>
          copyFile(source, join(retainDirectory, `capture-${index + 1}.json`), fsConstants.COPYFILE_EXCL),
        ),
      );
      await Promise.all(
        decisionOutputs.map((output, index) =>
          writeFile(
            join(retainDirectory, `decision-${index + 1}.json`),
            `${JSON.stringify(JSON.parse(output.stdout), null, 2)}\n`,
            { encoding: "utf8", flag: "wx" },
          ),
        ),
      );
      await writeFile(
        join(retainDirectory, "verification-summary.json"),
        `${JSON.stringify(result, null, 2)}\n`,
        { encoding: "utf8", flag: "wx" },
      );
    }
    return result;
  } finally {
    await removeTempDirectory(temporaryDirectory);
  }
}

export async function main(argv = process.argv.slice(2)) {
  const result = await runLiveVerification(parseVerifyArgs(argv));
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

const isMain =
  process.argv[1] !== undefined &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  main().catch((error) => {
    process.stderr.write(`VERIFY_LIVE_FAILED: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
