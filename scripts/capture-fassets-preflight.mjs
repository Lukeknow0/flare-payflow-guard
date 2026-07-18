#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { canonicalize, sha256Canonical } from "../src/flare-adapter/canonical.mjs";
import {
  createCoston2PublicClient,
  readFAssetsState,
} from "../src/flare-adapter/fassets.mjs";

export const EXIT_SOFTWARE = 70;
export const PINNED_DEPENDENCIES = Object.freeze({
  "@flarenetwork/flare-wagmi-periphery-package": "3.1.0",
  viem: "2.48.4",
});
export const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const USAGE =
  "Usage: node scripts/capture-fassets-preflight.mjs --amount-uba <non-negative integer> [--block <positive integer>] [--out <new-file>]";

function parseInteger(raw, name, { positive = false } = {}) {
  if (typeof raw !== "string" || !/^[0-9]+$/.test(raw)) {
    throw new TypeError(`${name} must be a ${positive ? "positive" : "non-negative"} integer`);
  }
  const value = BigInt(raw);
  if (positive && value === 0n) {
    throw new RangeError(`${name} must be a positive integer`);
  }
  return value;
}

/** Strictly parse the evidence CLI. Unknown, duplicate and positional arguments fail closed. */
export function parseCaptureArgs(argv) {
  if (!Array.isArray(argv)) throw new TypeError("argv must be an array");

  const values = new Map();
  const supported = new Set(["--amount-uba", "--block", "--out"]);
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!supported.has(flag)) throw new TypeError(`unknown argument: ${flag}`);
    if (values.has(flag)) throw new TypeError(`duplicate argument: ${flag}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new TypeError(`${flag} requires a value`);
    }
    values.set(flag, value);
    index += 1;
  }

  if (!values.has("--amount-uba")) {
    throw new TypeError("--amount-uba is required");
  }
  const outputPath = values.get("--out");
  if (outputPath !== undefined && outputPath.length === 0) {
    throw new TypeError("--out requires a non-empty path");
  }

  return {
    amountUBA: parseInteger(values.get("--amount-uba"), "--amount-uba"),
    blockNumber:
      values.get("--block") === undefined
        ? undefined
        : parseInteger(values.get("--block"), "--block", { positive: true }),
    outputPath,
  };
}

function git(args) {
  return execFileSync("git", ["-C", PROJECT_ROOT, ...args], {
    encoding: "utf8",
  }).trim();
}

export function readGitProvenance() {
  const status = git(["status", "--porcelain=v1", "--untracked-files=normal"]);
  return {
    commit: git(["rev-parse", "HEAD"]),
    tree: git(["rev-parse", "HEAD^{tree}"]),
    dirty: status.length !== 0,
  };
}

function sha256Bytes(value) {
  return createHash("sha256").update(value).digest("hex");
}

function parseJsonFile(path, label) {
  const bytes = readFileSync(path);
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new Error(`${label} is not valid JSON`, { cause: error });
  }
  return { bytes, value };
}

/**
 * Validate the complete local dependency chain used by the live adapter.
 * This deliberately checks the manifest, lock root, locked package/SRI and
 * installed package metadata. It never consults npm or any other network.
 */
export function requirePinnedDependencyProvenance(provenance) {
  if (!provenance || typeof provenance !== "object") {
    throw new TypeError("Dependency provenance is required");
  }
  for (const field of ["packageJsonSha256", "packageLockSha256"]) {
    if (!/^[0-9a-f]{64}$/i.test(provenance[field] ?? "")) {
      throw new TypeError(`Dependency provenance ${field} is invalid`);
    }
  }

  for (const [name, expectedVersion] of Object.entries(PINNED_DEPENDENCIES)) {
    const manifestVersion = provenance.manifestDependencies?.[name];
    const lockRootVersion = provenance.lockfileRootDependencies?.[name];
    const locked = provenance.lockfileDependencies?.[name];
    const runtime = provenance.runtimeDependencies?.[name];
    if (manifestVersion !== expectedVersion) {
      throw new Error(
        `${name} package.json version must be exactly ${expectedVersion}`,
      );
    }
    if (lockRootVersion !== expectedVersion) {
      throw new Error(
        `${name} package-lock.json root version must be exactly ${expectedVersion}`,
      );
    }
    if (locked?.version !== expectedVersion) {
      throw new Error(
        `${name} package-lock.json version must be exactly ${expectedVersion}`,
      );
    }
    if (
      typeof locked.integrity !== "string" ||
      !/^sha(?:256|384|512)-[A-Za-z0-9+/]+={0,2}$/.test(locked.integrity)
    ) {
      throw new Error(`${name} package-lock.json integrity/SRI is invalid`);
    }
    if (runtime?.version !== expectedVersion) {
      throw new Error(
        `${name} installed runtime version must be exactly ${expectedVersion}`,
      );
    }
  }
  return provenance;
}

/** Read and validate dependency provenance from this script's repository. */
export function readDependencyProvenance({ projectRoot = PROJECT_ROOT } = {}) {
  const packageJsonPath = join(projectRoot, "package.json");
  const packageLockPath = join(projectRoot, "package-lock.json");
  const packageJson = parseJsonFile(packageJsonPath, "package.json");
  const packageLock = parseJsonFile(packageLockPath, "package-lock.json");

  const lockfileDependencies = {};
  const runtimeDependencies = {};
  for (const name of Object.keys(PINNED_DEPENDENCIES)) {
    const locked = packageLock.value.packages?.[`node_modules/${name}`];
    lockfileDependencies[name] = {
      version: locked?.version,
      integrity: locked?.integrity,
    };
    const runtimePackage = parseJsonFile(
      join(projectRoot, "node_modules", name, "package.json"),
      `${name} installed package.json`,
    );
    runtimeDependencies[name] = { version: runtimePackage.value.version };
  }

  return requirePinnedDependencyProvenance({
    packageJsonSha256: sha256Bytes(packageJson.bytes),
    packageLockSha256: sha256Bytes(packageLock.bytes),
    manifestDependencies: packageJson.value.dependencies,
    lockfileRootDependencies: packageLock.value.packages?.[""]?.dependencies,
    lockfileDependencies,
    runtimeDependencies,
  });
}

export function requireCleanProvenance(provenance) {
  if (!provenance || typeof provenance !== "object") {
    throw new TypeError("Git provenance is required");
  }
  if (provenance.dirty !== false) {
    throw new Error("live evidence requires a clean Git worktree");
  }
  for (const field of ["commit", "tree"]) {
    if (typeof provenance[field] !== "string" || !/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/i.test(provenance[field])) {
      throw new TypeError(`Git provenance ${field} is invalid`);
    }
  }
  return provenance;
}

/** Build a self-digesting, JSON-safe evidence envelope around adapter state. */
export function buildEvidenceArtifact({
  adapterState,
  amountUBA,
  blockSelection,
  provenance,
  dependencyProvenance = readDependencyProvenance(),
  capturedAt = new Date(),
}) {
  if (!(capturedAt instanceof Date) || Number.isNaN(capturedAt.getTime())) {
    throw new TypeError("capturedAt must be a valid Date");
  }
  if (typeof amountUBA !== "bigint" || amountUBA < 0n) {
    throw new TypeError("amountUBA must be a non-negative bigint");
  }
  requireCleanProvenance(provenance);
  requirePinnedDependencyProvenance(dependencyProvenance);
  if (adapterState?.mode !== "live" || adapterState?.readOnly !== true) {
    throw new Error("adapter did not return read-only live state");
  }
  if (adapterState?.anchor?.blockNumber !== blockSelection.blockNumber) {
    throw new Error("adapter state is not anchored to the selected block");
  }

  const delaySeconds =
    adapterState.directMinting.preflight.executionAllowedAt >
    adapterState.anchor.blockTimestamp
      ? adapterState.directMinting.preflight.executionAllowedAt -
        adapterState.anchor.blockTimestamp
      : 0n;
  const normalizedFlareEvidence = {
    network: {
      expected_chain_id: adapterState.network.expectedChainId,
      observed_chain_id: adapterState.network.observedChainId,
    },
    anchor: {
      block_number: adapterState.anchor.blockNumber,
      block_hash: adapterState.anchor.blockHash,
      block_timestamp: adapterState.anchor.blockTimestamp,
      hash_rechecked: adapterState.anchor.hashRechecked,
    },
    registry: {
      address: adapterState.registry.address,
      lookup_name: adapterState.registry.lookupName,
      resolved_address: adapterState.assetManager.address,
      code_bytes: adapterState.registry.codeBytes,
      code_sha256: adapterState.registry.codeSha256,
    },
    asset_manager: {
      address: adapterState.assetManager.address,
      code_bytes: adapterState.assetManager.codeBytes,
      code_sha256: adapterState.assetManager.codeSha256,
    },
    asset: {
      address: adapterState.fAsset.address,
      name: adapterState.fAsset.name,
      symbol: adapterState.fAsset.symbol,
      decimals: adapterState.fAsset.decimals,
      code_bytes: adapterState.fAsset.codeBytes,
      code_sha256: adapterState.fAsset.codeSha256,
    },
    fassets: {
      settings: adapterState.assetManager.settings,
      settings_sha256: adapterState.assetManager.settingsSha256,
      direct_mint: {
        payment_address: adapterState.directMinting.paymentAddress,
        proposed_amount_uba: adapterState.directMinting.proposedAmountUBA,
        minimum_fee_uba: adapterState.directMinting.minimumFeeUBA,
        executor_fee_uba: adapterState.directMinting.executorFeeUBA,
        fee_bips: adapterState.directMinting.feeBIPS,
        hourly_limit_uba: adapterState.directMinting.hourly.limitUBA,
        hourly_remaining_uba: adapterState.directMinting.hourly.remainingUBA,
        daily_limit_uba: adapterState.directMinting.daily.limitUBA,
        daily_remaining_uba: adapterState.directMinting.daily.remainingUBA,
        large_threshold_uba: adapterState.directMinting.largeThresholdUBA,
        large_delay_seconds: adapterState.directMinting.largeDelaySeconds,
        limiter_disabled: adapterState.directMinting.limiterDisabled,
        execution_allowed_at: adapterState.directMinting.preflight.executionAllowedAt,
        delay_seconds: delaySeconds,
        delayed: adapterState.directMinting.preflight.delayed,
        delay_reasons: adapterState.directMinting.preflight.delayReasons,
      },
    },
  };

  const payload = canonicalize({
    schema_version: "1.0.0",
    artifact_type: "flare_fassets_evidence",
    mode: "live",
    captured_at_utc: capturedAt.toISOString(),
    observed_at_utc: capturedAt.toISOString(),
    request: {
      proposed_amount_uba: amountUBA,
      block_selection: blockSelection.strategy,
      requested_block_number: blockSelection.requestedBlockNumber,
      selected_block_number: blockSelection.blockNumber,
    },
    provenance: {
      commit: provenance.commit,
      tree: provenance.tree,
      dirty: false,
      node: process.version,
      dependencies: PINNED_DEPENDENCIES,
      dependency_files: {
        package_json_sha256: dependencyProvenance.packageJsonSha256,
        package_lock_sha256: dependencyProvenance.packageLockSha256,
      },
      lockfile_dependencies: dependencyProvenance.lockfileDependencies,
      runtime_dependencies: dependencyProvenance.runtimeDependencies,
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
    ...normalizedFlareEvidence,
    adapter_state: adapterState,
  });

  return canonicalize({
    ...payload,
    integrity: {
      algorithm: "sha256",
      canonicalization: "sorted-keys-bigint-decimal-v1",
      payload_scope: "artifact excluding integrity",
      canonical_payload_sha256: sha256Canonical(payload),
    },
  });
}

/**
 * Capture one live snapshot. The clean-tree check deliberately precedes client
 * construction and every RPC call. Failures propagate; there is no fallback.
 */
export async function captureFAssetsPreflight({
  parsedArgs,
  provenanceReader = readGitProvenance,
  dependencyProvenanceReader = readDependencyProvenance,
  clientFactory = createCoston2PublicClient,
  stateReader = readFAssetsState,
  clock = () => new Date(),
} = {}) {
  if (!parsedArgs || typeof parsedArgs !== "object") {
    throw new TypeError("parsedArgs are required");
  }

  const provenance = requireCleanProvenance(provenanceReader());
  const dependencyProvenance = requirePinnedDependencyProvenance(
    dependencyProvenanceReader(),
  );
  const client = clientFactory();
  let blockNumber = parsedArgs.blockNumber;
  let strategy = "explicit";
  if (blockNumber === undefined) {
    const latestBlockNumber = await client.getBlockNumber();
    if (typeof latestBlockNumber !== "bigint" || latestBlockNumber <= 2n) {
      throw new Error("Coston2 latest block is too low to select latest-2");
    }
    blockNumber = latestBlockNumber - 2n;
    strategy = "official-coston2-latest-minus-2";
  }

  const adapterState = await stateReader({
    client,
    blockNumber,
    proposedAmountUBA: parsedArgs.amountUBA,
  });
  return buildEvidenceArtifact({
    adapterState,
    amountUBA: parsedArgs.amountUBA,
    blockSelection: {
      strategy,
      requestedBlockNumber: parsedArgs.blockNumber,
      blockNumber,
    },
    provenance,
    dependencyProvenance,
    capturedAt: clock(),
  });
}

/** Write evidence once. `wx` makes accidental evidence replacement impossible. */
export async function writeEvidenceArtifact(outputPath, artifact) {
  const body = `${JSON.stringify(canonicalize(artifact), null, 2)}\n`;
  if (outputPath === undefined) {
    process.stdout.write(body);
    return;
  }
  await writeFile(outputPath, body, { encoding: "utf8", flag: "wx" });
}

export async function main(argv = process.argv.slice(2)) {
  const parsedArgs = parseCaptureArgs(argv);
  const artifact = await captureFAssetsPreflight({ parsedArgs });
  await writeEvidenceArtifact(parsedArgs.outputPath, artifact);
}

const isMain =
  process.argv[1] !== undefined &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`capture-fassets-preflight: ${message}\n${USAGE}\n`);
    process.exitCode = EXIT_SOFTWARE;
  });
}
