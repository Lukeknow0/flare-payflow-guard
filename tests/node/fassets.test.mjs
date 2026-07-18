import assert from "node:assert/strict";
import test from "node:test";

import {
  DAILY_WINDOW_SECONDS,
  FLARE_CONTRACT_REGISTRY_ADDRESS,
  HOURLY_WINDOW_SECONDS,
  computeDirectMintingExecutionAllowedAt,
  computeLargeMintExecutionAllowedAt,
  computeWindowExecutionAllowedAt,
  readFAssetsState,
  replayTumblingWindow,
} from "../../src/flare-adapter/fassets.mjs";

const BLOCK_NUMBER = 123_456n;
const BLOCK_HASH = `0x${"ab".repeat(32)}`;
const MANAGER = "0x1111111111111111111111111111111111111111";
const FASSET = "0x2222222222222222222222222222222222222222";

function fakeClient(overrides = {}) {
  const calls = [];
  const values = {
    getContractAddressByName: MANAGER,
    getSettings: { assetMintingGranularityUBA: 10n, assetDecimals: 6 },
    fAsset: FASSET,
    getDirectMintingHourlyLimitUBA: 1_000n,
    getDirectMintingDailyLimitUBA: 5_000n,
    getDirectMintingHourlyLimiterState: [7_200n, 50n],
    getDirectMintingDailyLimiterState: [0n, 20n],
    getDirectMintingsUnblockUntilTimestamp: 0n,
    getDirectMintingLargeMintingThresholdUBA: 500n,
    getDirectMintingLargeMintingDelaySeconds: 7_200n,
    directMintingPaymentAddress: "rCoreVaultTestAddress",
    getDirectMintingMinimumFeeUBA: 100n,
    getDirectMintingExecutorFeeUBA: 10n,
    getDirectMintingFeeBIPS: 25n,
    name: "FXRP",
    symbol: "FTestXRP",
    decimals: 6,
    ...overrides.values,
  };

  const client = {
    calls,
    async getChainId() {
      calls.push({ method: "getChainId" });
      return overrides.chainId ?? 114;
    },
    async getBlockNumber() {
      calls.push({ method: "getBlockNumber" });
      return overrides.latestBlockNumber ?? BLOCK_NUMBER;
    },
    async getBlock(args) {
      calls.push({ method: "getBlock", ...args });
      return {
        number: args.blockNumber,
        hash: overrides.blockHash ?? BLOCK_HASH,
        timestamp: overrides.blockTimestamp ?? 10_000n,
      };
    },
    async getCode(args) {
      calls.push({ method: "getCode", ...args });
      const address = args.address.toLowerCase();
      const code = overrides.codeByAddress?.[address];
      return code ?? "0x6001600055";
    },
    async readContract(args) {
      calls.push({ method: "readContract", ...args });
      if (overrides.throwOn === args.functionName) throw new Error("rpc read failed");
      if (!(args.functionName in values)) throw new Error(`unexpected ${args.functionName}`);
      return values[args.functionName];
    },
  };
  return client;
}

test("tumbling-window replay preserves state before a boundary", () => {
  assert.deepEqual(
    replayTumblingWindow({
      now: 10_799n,
      windowStartTimestamp: 7_200n,
      mintedInCurrentWindowUBA: 750n,
      limitUBA: 1_000n,
      windowSizeSeconds: HOURLY_WINDOW_SECONDS,
    }),
    {
      effectiveStart: 7_200n,
      usedUBA: 750n,
      remainingUBA: 250n,
      nextResetAt: 10_800n,
      windowsElapsed: 0n,
    },
  );
});

test("tumbling-window replay advances on the exact boundary and drains backlog", () => {
  const oneWindow = replayTumblingWindow({
    now: 10_800n,
    windowStartTimestamp: 7_200n,
    mintedInCurrentWindowUBA: 2_500n,
    limitUBA: 1_000n,
    windowSizeSeconds: HOURLY_WINDOW_SECONDS,
  });
  assert.deepEqual(oneWindow, {
    effectiveStart: 10_800n,
    usedUBA: 1_500n,
    remainingUBA: 0n,
    nextResetAt: 14_400n,
    windowsElapsed: 1n,
  });

  const threeWindows = replayTumblingWindow({
    now: 18_000n,
    windowStartTimestamp: 7_200n,
    mintedInCurrentWindowUBA: 2_500n,
    limitUBA: 1_000n,
    windowSizeSeconds: HOURLY_WINDOW_SECONDS,
  });
  assert.equal(threeWindows.effectiveStart, 18_000n);
  assert.equal(threeWindows.usedUBA, 0n);
  assert.equal(threeWindows.remainingUBA, 1_000n);
});

test("window execution is immediate at cap and proportional one unit over cap", () => {
  const base = {
    now: 10_000n,
    effectiveStart: 7_200n,
    usedUBA: 400n,
    limitUBA: 1_000n,
    windowSizeSeconds: HOURLY_WINDOW_SECONDS,
    limiterDisabled: false,
  };
  assert.equal(
    computeWindowExecutionAllowedAt({ ...base, proposedAmountUBA: 600n }),
    10_000n,
  );
  assert.equal(
    computeWindowExecutionAllowedAt({ ...base, proposedAmountUBA: 601n }),
    10_803n,
  );
  assert.equal(
    computeWindowExecutionAllowedAt({ ...base, proposedAmountUBA: 10_000n, limiterDisabled: true }),
    10_000n,
  );
});

test("large-mint threshold is strict", () => {
  const base = { now: 1_000n, largeThresholdUBA: 500n, largeDelaySeconds: 7_200n };
  assert.equal(
    computeLargeMintExecutionAllowedAt({ ...base, proposedAmountUBA: 500n }),
    1_000n,
  );
  assert.equal(
    computeLargeMintExecutionAllowedAt({ ...base, proposedAmountUBA: 501n }),
    8_200n,
  );
});

test("combined preflight selects the latest binding delay and keeps large delay during unblock", () => {
  const result = computeDirectMintingExecutionAllowedAt({
    now: 10_000n,
    proposedAmountUBA: 600n,
    hourly: {
      effectiveStart: 7_200n,
      usedUBA: 500n,
      limitUBA: 1_000n,
      windowSizeSeconds: HOURLY_WINDOW_SECONDS,
    },
    daily: {
      effectiveStart: 0n,
      usedUBA: 200n,
      limitUBA: 5_000n,
      windowSizeSeconds: DAILY_WINDOW_SECONDS,
    },
    largeThresholdUBA: 500n,
    largeDelaySeconds: 7_200n,
    limiterDisabled: true,
  });
  assert.equal(result.executionAllowedAt, 17_200n);
  assert.equal(result.delayed, true);
  assert.deepEqual(result.delayReasons, ["large_mint_threshold"]);
  assert.equal(result.hourlyAt, 10_000n);
  assert.equal(result.dailyAt, 10_000n);
});

test("adapter resolves AssetManagerFXRP and anchors every live read to one block", async () => {
  const client = fakeClient();
  const snapshot = await readFAssetsState({
    client,
    blockNumber: BLOCK_NUMBER,
    proposedAmountUBA: 600n,
  });

  assert.equal(snapshot.mode, "live");
  assert.equal(snapshot.readOnly, true);
  assert.equal(snapshot.registry.address, FLARE_CONTRACT_REGISTRY_ADDRESS);
  assert.equal(snapshot.registry.lookupName, "AssetManagerFXRP");
  assert.equal(snapshot.assetManager.address.toLowerCase(), MANAGER);
  assert.equal(snapshot.fAsset.address.toLowerCase(), FASSET);
  assert.equal(snapshot.fAsset.name, "FXRP");
  assert.equal(snapshot.fAsset.symbol, "FTestXRP");
  assert.equal(snapshot.fAsset.decimals, 6);
  assert.equal(snapshot.anchor.hashRechecked, true);
  assert.ok(snapshot.registry.codeBytes > 0);
  assert.match(snapshot.assetManager.codeSha256, /^[0-9a-f]{64}$/);
  assert.match(snapshot.fAsset.codeSha256, /^[0-9a-f]{64}$/);
  assert.equal(snapshot.directMinting.hourly.raw.mintedInCurrentWindowAMG, 50n);
  assert.equal(snapshot.directMinting.hourly.usedUBA, 500n);
  assert.equal(snapshot.directMinting.paymentAddress, "rCoreVaultTestAddress");
  assert.equal(snapshot.directMinting.minimumFeeUBA, 100n);
  assert.equal(snapshot.directMinting.executorFeeUBA, 10n);
  assert.equal(snapshot.directMinting.feeBIPS, 25n);
  assert.equal(snapshot.directMinting.preflight.executionAllowedAt, 17_200n);
  assert.deepEqual(snapshot.directMinting.preflight.delayReasons, ["large_mint_threshold"]);

  const anchoredCalls = client.calls.filter((call) =>
    ["getBlock", "getCode", "readContract"].includes(call.method),
  );
  assert.ok(anchoredCalls.length > 0);
  for (const call of anchoredCalls) assert.equal(call.blockNumber, BLOCK_NUMBER);
  assert.equal(
    client.calls.filter(
      (call) => call.method === "readContract" && call.functionName === "getContractAddressByName",
    ).length,
    1,
  );
});

test("adapter fails closed on wrong chain, zero registry result, and missing code", async (t) => {
  await t.test("wrong chain", async () => {
    await assert.rejects(
      readFAssetsState({ client: fakeClient({ chainId: 14 }), blockNumber: BLOCK_NUMBER }),
      (error) => error.code === "WRONG_CHAIN",
    );
  });

  await t.test("zero AssetManager", async () => {
    await assert.rejects(
      readFAssetsState({
        client: fakeClient({
          values: { getContractAddressByName: "0x0000000000000000000000000000000000000000" },
        }),
        blockNumber: BLOCK_NUMBER,
      }),
      (error) => error.code === "ZERO_ADDRESS",
    );
  });

  await t.test("AssetManager without code", async () => {
    await assert.rejects(
      readFAssetsState({
        client: fakeClient({ codeByAddress: { [MANAGER]: "0x" } }),
        blockNumber: BLOCK_NUMBER,
      }),
      (error) => error.code === "NO_CONTRACT_CODE",
    );
  });
});

test("adapter propagates live contract failures without fixture fallback", async () => {
  await assert.rejects(
    readFAssetsState({
      client: fakeClient({ throwOn: "getDirectMintingDailyLimiterState" }),
      blockNumber: BLOCK_NUMBER,
    }),
    /rpc read failed/,
  );
});
