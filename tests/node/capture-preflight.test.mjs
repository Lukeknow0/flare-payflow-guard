import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { sha256Canonical } from "../../src/flare-adapter/canonical.mjs";
import {
  PINNED_DEPENDENCIES,
  PROJECT_ROOT,
  buildEvidenceArtifact,
  captureFAssetsPreflight,
  parseCaptureArgs,
  readDependencyProvenance,
  readGitProvenance,
  writeEvidenceArtifact,
} from "../../scripts/capture-fassets-preflight.mjs";

const BLOCK_NUMBER = 765_432n;
const BLOCK_HASH = `0x${"cd".repeat(32)}`;
const TEST_PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const CLEAN_PROVENANCE = {
  commit: "a".repeat(40),
  tree: "b".repeat(40),
  dirty: false,
};
const TEST_SRI = `sha512-${Buffer.alloc(64, 7).toString("base64")}`;
const DEPENDENCY_PROVENANCE = {
  packageJsonSha256: "c".repeat(64),
  packageLockSha256: "d".repeat(64),
  manifestDependencies: { ...PINNED_DEPENDENCIES },
  lockfileRootDependencies: { ...PINNED_DEPENDENCIES },
  lockfileDependencies: {
    "@flarenetwork/flare-wagmi-periphery-package": {
      version: "3.1.0",
      integrity: TEST_SRI,
    },
    viem: { version: "2.48.4", integrity: TEST_SRI },
  },
  runtimeDependencies: {
    "@flarenetwork/flare-wagmi-periphery-package": { version: "3.1.0" },
    viem: { version: "2.48.4" },
  },
};

async function writeDependencyFixture(
  directory,
  {
    manifestViem = "2.48.4",
    lockRootViem = "2.48.4",
    lockedViem = "2.48.4",
    viemIntegrity = TEST_SRI,
    runtimeViem = "2.48.4",
  } = {},
) {
  const flareName = "@flarenetwork/flare-wagmi-periphery-package";
  const dependencies = { [flareName]: "3.1.0", viem: manifestViem };
  const rootDependencies = { [flareName]: "3.1.0", viem: lockRootViem };
  const lock = {
    name: "dependency-fixture",
    version: "1.0.0",
    lockfileVersion: 3,
    packages: {
      "": { dependencies: rootDependencies },
      [`node_modules/${flareName}`]: { version: "3.1.0", integrity: TEST_SRI },
      "node_modules/viem": { version: lockedViem, integrity: viemIntegrity },
    },
  };
  await mkdir(join(directory, "node_modules", flareName), { recursive: true });
  await mkdir(join(directory, "node_modules", "viem"), { recursive: true });
  await writeFile(
    join(directory, "package.json"),
    `${JSON.stringify({ dependencies }, null, 2)}\n`,
  );
  await writeFile(
    join(directory, "package-lock.json"),
    `${JSON.stringify(lock, null, 2)}\n`,
  );
  await writeFile(
    join(directory, "node_modules", flareName, "package.json"),
    `${JSON.stringify({ name: flareName, version: "3.1.0" })}\n`,
  );
  await writeFile(
    join(directory, "node_modules", "viem", "package.json"),
    `${JSON.stringify({ name: "viem", version: runtimeViem })}\n`,
  );
}

function fakeAdapterState({ blockNumber = BLOCK_NUMBER, amountUBA = 25n } = {}) {
  return {
    mode: "live",
    readOnly: true,
    network: { expectedChainId: 114, observedChainId: 114 },
    anchor: {
      blockNumber,
      blockHash: BLOCK_HASH,
      blockTimestamp: 1_750_000_000n,
      hashRechecked: true,
    },
    registry: {
      address: "0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019",
      lookupName: "AssetManagerFXRP",
      codeBytes: 10,
      codeSha256: "1".repeat(64),
    },
    assetManager: {
      address: "0x1111111111111111111111111111111111111111",
      settings: {
        assetMintingGranularityUBA: 10n,
        assetDecimals: 6,
        fAsset: "0x2222222222222222222222222222222222222222",
      },
      settingsSha256: "4".repeat(64),
      codeBytes: 20,
      codeSha256: "2".repeat(64),
    },
    fAsset: {
      address: "0x2222222222222222222222222222222222222222",
      name: "FXRP",
      symbol: "FTestXRP",
      decimals: 6,
      codeBytes: 30,
      codeSha256: "3".repeat(64),
    },
    directMinting: {
      proposedAmountUBA: amountUBA,
      immediateHeadroomUBA: 1_000n,
      paymentAddress: "rCoreVaultTestAddress",
      minimumFeeUBA: 5n,
      executorFeeUBA: 1n,
      feeBIPS: 10n,
      limiterDisabled: false,
      largeThresholdUBA: 500n,
      largeDelaySeconds: 7_200n,
      hourly: { limitUBA: 1_000n, remainingUBA: 900n },
      daily: { limitUBA: 5_000n, remainingUBA: 4_900n },
      preflight: { delayed: false, executionAllowedAt: 1_750_000_000n },
    },
  };
}

test("CLI requires a non-negative UBA amount and strictly validates options", () => {
  assert.deepEqual(parseCaptureArgs(["--amount-uba", "0"]), {
    amountUBA: 0n,
    blockNumber: undefined,
    outputPath: undefined,
  });
  assert.deepEqual(
    parseCaptureArgs([
      "--out",
      "evidence.json",
      "--block",
      "123",
      "--amount-uba",
      "9000000",
    ]),
    { amountUBA: 9_000_000n, blockNumber: 123n, outputPath: "evidence.json" },
  );

  for (const argv of [
    [],
    ["--amount-uba", "-1"],
    ["--amount-uba", "1.5"],
    ["--amount-uba", "1", "--block", "0"],
    ["--amount-uba", "1", "--amount-uba", "2"],
    ["--amount-uba", "1", "--unknown", "x"],
  ]) {
    assert.throws(() => parseCaptureArgs(argv));
  }
});

test("capture uses a fake client, selects latest-2 and forwards one anchored block", async () => {
  const calls = [];
  const fakeClient = {
    async getBlockNumber() {
      calls.push({ method: "getBlockNumber" });
      return BLOCK_NUMBER + 2n;
    },
  };
  const parsedArgs = parseCaptureArgs(["--amount-uba", "25"]);
  const artifact = await captureFAssetsPreflight({
    parsedArgs,
    provenanceReader: () => CLEAN_PROVENANCE,
    dependencyProvenanceReader: () => DEPENDENCY_PROVENANCE,
    clientFactory: () => fakeClient,
    stateReader: async (options) => {
      calls.push({ method: "readFAssetsState", ...options });
      return fakeAdapterState({
        blockNumber: options.blockNumber,
        amountUBA: options.proposedAmountUBA,
      });
    },
    clock: () => new Date("2026-07-17T12:00:00.000Z"),
  });

  assert.equal(calls[0].method, "getBlockNumber");
  assert.equal(calls[1].method, "readFAssetsState");
  assert.equal(calls[1].client, fakeClient);
  assert.equal(calls[1].blockNumber, BLOCK_NUMBER);
  assert.equal(calls[1].proposedAmountUBA, 25n);
  assert.equal(artifact.request.block_selection, "official-coston2-latest-minus-2");
  assert.equal(artifact.request.selected_block_number, BLOCK_NUMBER.toString());
  assert.equal(artifact.adapter_state.anchor.blockNumber, BLOCK_NUMBER.toString());
});

test("evidence schema is live, read-only, canonical and self-verifying", () => {
  const artifact = buildEvidenceArtifact({
    adapterState: fakeAdapterState(),
    amountUBA: 25n,
    blockSelection: {
      strategy: "explicit",
      requestedBlockNumber: BLOCK_NUMBER,
      blockNumber: BLOCK_NUMBER,
    },
    provenance: CLEAN_PROVENANCE,
    dependencyProvenance: DEPENDENCY_PROVENANCE,
    capturedAt: new Date("2026-07-17T12:00:00.000Z"),
  });

  assert.equal(artifact.artifact_type, "flare_fassets_evidence");
  assert.equal(artifact.mode, "live");
  assert.equal(artifact.provenance.commit, CLEAN_PROVENANCE.commit);
  assert.equal(artifact.provenance.tree, CLEAN_PROVENANCE.tree);
  assert.equal(artifact.provenance.dirty, false);
  assert.deepEqual(artifact.provenance.dependencies, {
    "@flarenetwork/flare-wagmi-periphery-package": "3.1.0",
    viem: "2.48.4",
  });
  assert.deepEqual(artifact.provenance.dependency_files, {
    package_json_sha256: "c".repeat(64),
    package_lock_sha256: "d".repeat(64),
  });
  assert.equal(artifact.provenance.lockfile_dependencies.viem.version, "2.48.4");
  assert.equal(artifact.provenance.lockfile_dependencies.viem.integrity, TEST_SRI);
  assert.equal(artifact.provenance.runtime_dependencies.viem.version, "2.48.4");
  assert.deepEqual(artifact.safety, {
    chain_write_performed: false,
    fixture_fallback: false,
    mock_fallback: false,
    private_key_required: false,
    read_only: true,
    signing_performed: false,
    transaction_broadcast: false,
    wallet_used: false,
  });
  assert.equal(artifact.adapter_state.directMinting.proposedAmountUBA, "25");
  assert.equal(artifact.network.observed_chain_id, 114);
  assert.equal(artifact.anchor.hash_rechecked, true);
  assert.equal(artifact.registry.lookup_name, "AssetManagerFXRP");
  assert.equal(artifact.asset.symbol, "FTestXRP");
  assert.equal(artifact.fassets.direct_mint.payment_address, "rCoreVaultTestAddress");
  assert.equal(artifact.fassets.direct_mint.hourly_remaining_uba, "900");
  assert.equal(artifact.fassets.direct_mint.delay_seconds, "0");
  assert.equal(artifact.integrity.algorithm, "sha256");
  assert.match(artifact.integrity.canonical_payload_sha256, /^[0-9a-f]{64}$/);

  const { integrity, ...payload } = artifact;
  assert.equal(integrity.canonical_payload_sha256, sha256Canonical(payload));
});

test("dirty provenance stops before client creation or state reads", async () => {
  let clientConstructed = false;
  let stateRead = false;
  await assert.rejects(
    captureFAssetsPreflight({
      parsedArgs: parseCaptureArgs(["--amount-uba", "1"]),
      provenanceReader: () => ({ ...CLEAN_PROVENANCE, dirty: true }),
      clientFactory: () => {
        clientConstructed = true;
        return {};
      },
      stateReader: async () => {
        stateRead = true;
        return fakeAdapterState();
      },
    }),
    /clean Git worktree/,
  );
  assert.equal(clientConstructed, false);
  assert.equal(stateRead, false);
});

test("git provenance remains bound to the script repository from another cwd", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "flare-other-cwd-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const originalCwd = process.cwd();
  const expected = readGitProvenance();
  assert.equal(PROJECT_ROOT, TEST_PROJECT_ROOT);
  try {
    process.chdir(directory);
    assert.deepEqual(readGitProvenance(), expected);
  } finally {
    process.chdir(originalCwd);
  }
});

test("dependency provenance records exact lock SRI, runtime versions and file hashes", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "flare-dependencies-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeDependencyFixture(directory);

  const provenance = readDependencyProvenance({ projectRoot: directory });
  const packageJsonBytes = await readFile(join(directory, "package.json"));
  const packageLockBytes = await readFile(join(directory, "package-lock.json"));
  assert.equal(
    provenance.packageJsonSha256,
    createHash("sha256").update(packageJsonBytes).digest("hex"),
  );
  assert.equal(
    provenance.packageLockSha256,
    createHash("sha256").update(packageLockBytes).digest("hex"),
  );
  assert.deepEqual(provenance.manifestDependencies, PINNED_DEPENDENCIES);
  assert.equal(provenance.lockfileDependencies.viem.integrity, TEST_SRI);
  assert.equal(provenance.runtimeDependencies.viem.version, "2.48.4");
});

test("dependency and lock anomalies fail closed before client construction", async (t) => {
  const cases = [
    { name: "non-exact manifest", options: { manifestViem: "^2.48.4" }, match: /package\.json version/ },
    { name: "non-exact lock root", options: { lockRootViem: "^2.48.4" }, match: /root version/ },
    { name: "wrong locked version", options: { lockedViem: "2.48.3" }, match: /package-lock\.json version/ },
    { name: "missing lock SRI", options: { viemIntegrity: null }, match: /integrity\/SRI/ },
    { name: "wrong installed runtime", options: { runtimeViem: "2.48.3" }, match: /installed runtime version/ },
  ];

  for (const entry of cases) {
    const directory = await mkdtemp(join(tmpdir(), "flare-bad-dependency-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    await writeDependencyFixture(directory, entry.options);
    assert.throws(
      () => readDependencyProvenance({ projectRoot: directory }),
      entry.match,
      entry.name,
    );
  }

  let clientConstructed = false;
  await assert.rejects(
    captureFAssetsPreflight({
      parsedArgs: parseCaptureArgs(["--amount-uba", "1"]),
      provenanceReader: () => CLEAN_PROVENANCE,
      dependencyProvenanceReader: () => ({
        ...DEPENDENCY_PROVENANCE,
        runtimeDependencies: {
          ...DEPENDENCY_PROVENANCE.runtimeDependencies,
          viem: { version: "2.48.3" },
        },
      }),
      clientFactory: () => {
        clientConstructed = true;
        return {};
      },
    }),
    /installed runtime version/,
  );
  assert.equal(clientConstructed, false);
});

test("output uses canonical JSON and wx refuses to replace evidence", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "flare-evidence-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const outputPath = join(directory, "capture.json");
  const artifact = buildEvidenceArtifact({
    adapterState: fakeAdapterState(),
    amountUBA: 25n,
    blockSelection: {
      strategy: "explicit",
      requestedBlockNumber: BLOCK_NUMBER,
      blockNumber: BLOCK_NUMBER,
    },
    provenance: CLEAN_PROVENANCE,
    dependencyProvenance: DEPENDENCY_PROVENANCE,
    capturedAt: new Date("2026-07-17T12:00:00.000Z"),
  });

  await writeEvidenceArtifact(outputPath, artifact);
  const decoded = JSON.parse(await readFile(outputPath, "utf8"));
  assert.deepEqual(decoded, artifact);
  await assert.rejects(writeEvidenceArtifact(outputPath, artifact), (error) => error.code === "EEXIST");
});
