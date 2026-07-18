import {
  createPublicClient,
  erc20Abi,
  getAddress,
  http,
  isAddress,
  zeroAddress,
} from "viem";
import { flareTestnet } from "viem/chains";
import { coston2 } from "@flarenetwork/flare-wagmi-periphery-package";

import { sha256Canonical, sha256Text } from "./canonical.mjs";

export const COSTON2_CHAIN_ID = 114;
export const COSTON2_RPC_URL = "https://coston2-api.flare.network/ext/C/rpc";
export const FLARE_CONTRACT_REGISTRY_ADDRESS =
  "0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019";
export const FXRP_ASSET_MANAGER_REGISTRY_NAME = "AssetManagerFXRP";
export const HOURLY_WINDOW_SECONDS = 3_600n;
export const DAILY_WINDOW_SECONDS = 86_400n;

export class FlareAdapterError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "FlareAdapterError";
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

function requireBigInt(name, value, { positive = false } = {}) {
  if (typeof value !== "bigint") {
    throw new TypeError(`${name} must be a bigint`);
  }
  if (value < 0n || (positive && value === 0n)) {
    throw new RangeError(`${name} must be ${positive ? "positive" : "non-negative"}`);
  }
  return value;
}

function normalizedAddress(value, label) {
  if (typeof value !== "string" || !isAddress(value, { strict: false })) {
    throw new FlareAdapterError("INVALID_ADDRESS", `${label} returned an invalid address`, {
      value,
    });
  }
  const address = getAddress(value);
  if (address.toLowerCase() === zeroAddress) {
    throw new FlareAdapterError("ZERO_ADDRESS", `${label} returned the zero address`);
  }
  return address;
}

function requireCode(code, label, address) {
  if (typeof code !== "string" || !/^0x(?:[0-9a-fA-F]{2})+$/.test(code)) {
    throw new FlareAdapterError("NO_CONTRACT_CODE", `${label} has no valid bytecode`, {
      address,
    });
  }
  const normalized = code.toLowerCase();
  return {
    codeBytes: (normalized.length - 2) / 2,
    codeSha256: sha256Text(normalized),
  };
}

function requireNonEmptyString(name, value) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new FlareAdapterError(
      "MALFORMED_CONTRACT_RESULT",
      `${name} returned an empty or non-string value`,
    );
  }
  return value;
}

function requireBlock(block, blockNumber) {
  if (!block || block.number !== blockNumber) {
    throw new FlareAdapterError("INVALID_ANCHOR", "RPC returned the wrong anchored block", {
      requestedBlockNumber: blockNumber,
      observedBlockNumber: block?.number,
    });
  }
  if (typeof block.timestamp !== "bigint") {
    throw new FlareAdapterError("INVALID_ANCHOR", "anchored block has no timestamp");
  }
  if (typeof block.hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(block.hash)) {
    throw new FlareAdapterError("INVALID_ANCHOR", "anchored block has no valid hash");
  }
  return block;
}

function tuplePair(value, firstName, secondName, label) {
  const first = Array.isArray(value) ? value[0] : value?.[firstName];
  const second = Array.isArray(value) ? value[1] : value?.[secondName];
  try {
    return [requireBigInt(`${label}.${firstName}`, first), requireBigInt(`${label}.${secondName}`, second)];
  } catch (error) {
    throw new FlareAdapterError("MALFORMED_CONTRACT_RESULT", `${label} returned malformed state`, {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}

function settingsComponent(settings, name) {
  if (settings && typeof settings === "object" && !Array.isArray(settings) && name in settings) {
    return settings[name];
  }
  if (Array.isArray(settings)) {
    const getSettings = coston2.iAssetManagerAbi.find(
      (item) => item.type === "function" && item.name === "getSettings",
    );
    const index = getSettings?.outputs?.[0]?.components?.findIndex(
      (component) => component.name === name,
    );
    if (index !== undefined && index >= 0) return settings[index];
  }
  throw new FlareAdapterError(
    "MALFORMED_CONTRACT_RESULT",
    `getSettings result is missing ${name}`,
  );
}

/** Replay MintingRateLimiter's clock-aligned tumbling-window state at `now`. */
export function replayTumblingWindow({
  now,
  windowStartTimestamp,
  mintedInCurrentWindowUBA,
  limitUBA,
  windowSizeSeconds,
}) {
  requireBigInt("now", now);
  requireBigInt("windowStartTimestamp", windowStartTimestamp);
  requireBigInt("mintedInCurrentWindowUBA", mintedInCurrentWindowUBA);
  requireBigInt("limitUBA", limitUBA);
  requireBigInt("windowSizeSeconds", windowSizeSeconds, { positive: true });
  if (windowStartTimestamp > now) {
    throw new RangeError("windowStartTimestamp cannot be later than now");
  }

  let effectiveStart = windowStartTimestamp;
  let usedUBA = mintedInCurrentWindowUBA;
  let windowsElapsed = 0n;
  if (windowStartTimestamp > 0n && now >= windowStartTimestamp + windowSizeSeconds) {
    windowsElapsed = (now - windowStartTimestamp) / windowSizeSeconds;
    effectiveStart = windowStartTimestamp + windowsElapsed * windowSizeSeconds;
    const drainedUBA = windowsElapsed * limitUBA;
    usedUBA = drainedUBA >= usedUBA ? 0n : usedUBA - drainedUBA;
  }

  const remainingUBA = limitUBA > usedUBA ? limitUBA - usedUBA : 0n;
  return {
    effectiveStart,
    usedUBA,
    remainingUBA,
    nextResetAt: effectiveStart + windowSizeSeconds,
    windowsElapsed,
  };
}

export function computeWindowExecutionAllowedAt({
  now,
  effectiveStart,
  usedUBA,
  proposedAmountUBA,
  limitUBA,
  windowSizeSeconds,
  limiterDisabled = false,
}) {
  requireBigInt("now", now);
  requireBigInt("effectiveStart", effectiveStart);
  requireBigInt("usedUBA", usedUBA);
  requireBigInt("proposedAmountUBA", proposedAmountUBA);
  requireBigInt("limitUBA", limitUBA);
  requireBigInt("windowSizeSeconds", windowSizeSeconds, { positive: true });
  if (typeof limiterDisabled !== "boolean") {
    throw new TypeError("limiterDisabled must be a boolean");
  }
  if (limiterDisabled || limitUBA === 0n || proposedAmountUBA === 0n) return now;

  const mintedAfterUBA = usedUBA + proposedAmountUBA;
  if (mintedAfterUBA <= limitUBA) return now;
  return effectiveStart + (windowSizeSeconds * mintedAfterUBA) / limitUBA;
}

export function computeLargeMintExecutionAllowedAt({
  now,
  proposedAmountUBA,
  largeThresholdUBA,
  largeDelaySeconds,
}) {
  requireBigInt("now", now);
  requireBigInt("proposedAmountUBA", proposedAmountUBA);
  requireBigInt("largeThresholdUBA", largeThresholdUBA);
  requireBigInt("largeDelaySeconds", largeDelaySeconds);
  return proposedAmountUBA > largeThresholdUBA ? now + largeDelaySeconds : now;
}

export function computeDirectMintingExecutionAllowedAt({
  now,
  proposedAmountUBA,
  hourly,
  daily,
  largeThresholdUBA,
  largeDelaySeconds,
  limiterDisabled = false,
}) {
  const hourlyAt = computeWindowExecutionAllowedAt({
    now,
    effectiveStart: hourly.effectiveStart,
    usedUBA: hourly.usedUBA,
    proposedAmountUBA,
    limitUBA: hourly.limitUBA,
    windowSizeSeconds: hourly.windowSizeSeconds,
    limiterDisabled,
  });
  const dailyAt = computeWindowExecutionAllowedAt({
    now,
    effectiveStart: daily.effectiveStart,
    usedUBA: daily.usedUBA,
    proposedAmountUBA,
    limitUBA: daily.limitUBA,
    windowSizeSeconds: daily.windowSizeSeconds,
    limiterDisabled,
  });
  const largeAt = computeLargeMintExecutionAllowedAt({
    now,
    proposedAmountUBA,
    largeThresholdUBA,
    largeDelaySeconds,
  });

  const executionAllowedAt = [hourlyAt, dailyAt, largeAt].reduce(
    (latest, value) => (value > latest ? value : latest),
    now,
  );
  const delayReasons = [];
  if (hourlyAt === executionAllowedAt && hourlyAt > now) delayReasons.push("hourly_window");
  if (dailyAt === executionAllowedAt && dailyAt > now) delayReasons.push("daily_window");
  if (largeAt === executionAllowedAt && largeAt > now) delayReasons.push("large_mint_threshold");

  return {
    executionAllowedAt,
    delayed: executionAllowedAt > now,
    delayReasons,
    hourlyAt,
    dailyAt,
    largeAt,
  };
}

export function createCoston2PublicClient({ rpcUrl = COSTON2_RPC_URL } = {}) {
  return createPublicClient({
    chain: flareTestnet,
    transport: http(rpcUrl, { retryCount: 0, timeout: 20_000 }),
  });
}

/**
 * Read the registry, AssetManagerFXRP, FAsset and direct-minting limiter state.
 * Every contract/code read is anchored to one block. Any RPC/ABI failure is
 * propagated; this live adapter has no fixture or mock fallback.
 */
export async function readFAssetsState({
  client,
  blockNumber: requestedBlockNumber,
  proposedAmountUBA = 0n,
  expectedChainId = COSTON2_CHAIN_ID,
  registryAddress = FLARE_CONTRACT_REGISTRY_ADDRESS,
  registryLookupName = FXRP_ASSET_MANAGER_REGISTRY_NAME,
} = {}) {
  if (!client) throw new TypeError("client is required");
  requireBigInt("proposedAmountUBA", proposedAmountUBA);

  const observedChainId = await client.getChainId();
  if (observedChainId !== expectedChainId) {
    throw new FlareAdapterError(
      "WRONG_CHAIN",
      `wrong chain: expected ${expectedChainId}, observed ${observedChainId}`,
      { expectedChainId, observedChainId },
    );
  }

  const blockNumber = requireBigInt(
    "blockNumber",
    requestedBlockNumber === undefined ? await client.getBlockNumber() : requestedBlockNumber,
    { positive: true },
  );
  const block = requireBlock(
    await client.getBlock({ blockNumber, includeTransactions: false }),
    blockNumber,
  );
  const now = block.timestamp;

  const registry = normalizedAddress(registryAddress, "Flare Contract Registry address");
  const registryCode = requireCode(
    await client.getCode({ address: registry, blockNumber }),
    "Flare Contract Registry",
    registry,
  );
  const manager = normalizedAddress(
    await client.readContract({
      address: registry,
      abi: coston2.iFlareContractRegistryAbi,
      functionName: "getContractAddressByName",
      args: [registryLookupName],
      blockNumber,
    }),
    registryLookupName,
  );
  const managerCode = requireCode(
    await client.getCode({ address: manager, blockNumber }),
    registryLookupName,
    manager,
  );

  const [
    settings,
    fAssetResult,
    hourlyLimitUBA,
    dailyLimitUBA,
    hourlyStateResult,
    dailyStateResult,
    unblockUntilTimestamp,
    largeThresholdUBA,
    largeDelaySeconds,
    directMintingPaymentAddress,
    directMintingMinimumFeeUBA,
    directMintingExecutorFeeUBA,
    directMintingFeeBIPS,
  ] = await Promise.all([
    client.readContract({
      address: manager,
      abi: coston2.iAssetManagerAbi,
      functionName: "getSettings",
      blockNumber,
    }),
    client.readContract({
      address: manager,
      abi: coston2.iAssetManagerAbi,
      functionName: "fAsset",
      blockNumber,
    }),
    client.readContract({
      address: manager,
      abi: coston2.iAssetManagerAbi,
      functionName: "getDirectMintingHourlyLimitUBA",
      blockNumber,
    }),
    client.readContract({
      address: manager,
      abi: coston2.iAssetManagerAbi,
      functionName: "getDirectMintingDailyLimitUBA",
      blockNumber,
    }),
    client.readContract({
      address: manager,
      abi: coston2.iAssetManagerAbi,
      functionName: "getDirectMintingHourlyLimiterState",
      blockNumber,
    }),
    client.readContract({
      address: manager,
      abi: coston2.iAssetManagerAbi,
      functionName: "getDirectMintingDailyLimiterState",
      blockNumber,
    }),
    client.readContract({
      address: manager,
      abi: coston2.iAssetManagerAbi,
      functionName: "getDirectMintingsUnblockUntilTimestamp",
      blockNumber,
    }),
    client.readContract({
      address: manager,
      abi: coston2.iAssetManagerAbi,
      functionName: "getDirectMintingLargeMintingThresholdUBA",
      blockNumber,
    }),
    client.readContract({
      address: manager,
      abi: coston2.iAssetManagerAbi,
      functionName: "getDirectMintingLargeMintingDelaySeconds",
      blockNumber,
    }),
    client.readContract({
      address: manager,
      abi: coston2.iAssetManagerAbi,
      functionName: "directMintingPaymentAddress",
      blockNumber,
    }),
    client.readContract({
      address: manager,
      abi: coston2.iAssetManagerAbi,
      functionName: "getDirectMintingMinimumFeeUBA",
      blockNumber,
    }),
    client.readContract({
      address: manager,
      abi: coston2.iAssetManagerAbi,
      functionName: "getDirectMintingExecutorFeeUBA",
      blockNumber,
    }),
    client.readContract({
      address: manager,
      abi: coston2.iAssetManagerAbi,
      functionName: "getDirectMintingFeeBIPS",
      blockNumber,
    }),
  ]);

  const fAsset = normalizedAddress(fAssetResult, "AssetManager.fAsset");
  const fAssetCode = requireCode(
    await client.getCode({ address: fAsset, blockNumber }),
    "FAsset",
    fAsset,
  );
  const [fAssetName, fAssetSymbol, fAssetDecimals] = await Promise.all([
    client.readContract({
      address: fAsset,
      abi: erc20Abi,
      functionName: "name",
      blockNumber,
    }),
    client.readContract({
      address: fAsset,
      abi: erc20Abi,
      functionName: "symbol",
      blockNumber,
    }),
    client.readContract({
      address: fAsset,
      abi: erc20Abi,
      functionName: "decimals",
      blockNumber,
    }),
  ]);

  const blockAfter = requireBlock(
    await client.getBlock({ blockNumber, includeTransactions: false }),
    blockNumber,
  );
  if (blockAfter.hash.toLowerCase() !== block.hash.toLowerCase()) {
    throw new FlareAdapterError("ANCHOR_REORG", "anchored block hash changed during read");
  }

  const granularityUBA = requireBigInt(
    "settings.assetMintingGranularityUBA",
    settingsComponent(settings, "assetMintingGranularityUBA"),
    { positive: true },
  );
  const normalizedHourlyLimitUBA = requireBigInt("hourlyLimitUBA", hourlyLimitUBA);
  const normalizedDailyLimitUBA = requireBigInt("dailyLimitUBA", dailyLimitUBA);
  const normalizedUnblockUntil = requireBigInt(
    "unblockUntilTimestamp",
    unblockUntilTimestamp,
  );
  const normalizedLargeThresholdUBA = requireBigInt("largeThresholdUBA", largeThresholdUBA);
  const normalizedLargeDelaySeconds = requireBigInt("largeDelaySeconds", largeDelaySeconds);
  const normalizedPaymentAddress = requireNonEmptyString(
    "directMintingPaymentAddress",
    directMintingPaymentAddress,
  );
  const normalizedMinimumFeeUBA = requireBigInt(
    "directMintingMinimumFeeUBA",
    directMintingMinimumFeeUBA,
  );
  const normalizedExecutorFeeUBA = requireBigInt(
    "directMintingExecutorFeeUBA",
    directMintingExecutorFeeUBA,
  );
  const normalizedFeeBIPS = requireBigInt("directMintingFeeBIPS", directMintingFeeBIPS);
  const [hourlyWindowStart, hourlyMintedAMG] = tuplePair(
    hourlyStateResult,
    "_windowStartTimestamp",
    "_mintedInCurrentWindow",
    "hourlyLimiterState",
  );
  const [dailyWindowStart, dailyMintedAMG] = tuplePair(
    dailyStateResult,
    "_windowStartTimestamp",
    "_mintedInCurrentWindow",
    "dailyLimiterState",
  );

  const hourly = {
    ...replayTumblingWindow({
      now,
      windowStartTimestamp: hourlyWindowStart,
      mintedInCurrentWindowUBA: hourlyMintedAMG * granularityUBA,
      limitUBA: normalizedHourlyLimitUBA,
      windowSizeSeconds: HOURLY_WINDOW_SECONDS,
    }),
    limitUBA: normalizedHourlyLimitUBA,
    windowSizeSeconds: HOURLY_WINDOW_SECONDS,
    raw: { windowStartTimestamp: hourlyWindowStart, mintedInCurrentWindowAMG: hourlyMintedAMG },
  };
  const daily = {
    ...replayTumblingWindow({
      now,
      windowStartTimestamp: dailyWindowStart,
      mintedInCurrentWindowUBA: dailyMintedAMG * granularityUBA,
      limitUBA: normalizedDailyLimitUBA,
      windowSizeSeconds: DAILY_WINDOW_SECONDS,
    }),
    limitUBA: normalizedDailyLimitUBA,
    windowSizeSeconds: DAILY_WINDOW_SECONDS,
    raw: { windowStartTimestamp: dailyWindowStart, mintedInCurrentWindowAMG: dailyMintedAMG },
  };
  const limiterDisabled = normalizedUnblockUntil > now;
  const preflight = computeDirectMintingExecutionAllowedAt({
    now,
    proposedAmountUBA,
    hourly,
    daily,
    largeThresholdUBA: normalizedLargeThresholdUBA,
    largeDelaySeconds: normalizedLargeDelaySeconds,
    limiterDisabled,
  });

  const immediateHeadroomUBA = limiterDisabled
    ? normalizedLargeThresholdUBA
    : [hourly.remainingUBA, daily.remainingUBA, normalizedLargeThresholdUBA].reduce(
        (minimum, value) => (value < minimum ? value : minimum),
      );

  return {
    mode: "live",
    readOnly: true,
    network: { expectedChainId, observedChainId },
    anchor: {
      blockNumber,
      blockHash: block.hash,
      blockTimestamp: now,
      hashRechecked: true,
    },
    registry: { address: registry, lookupName: registryLookupName, ...registryCode },
    assetManager: {
      address: manager,
      settings,
      settingsSha256: sha256Canonical(settings),
      ...managerCode,
    },
    fAsset: {
      address: fAsset,
      name: requireNonEmptyString("FAsset.name", fAssetName),
      symbol: requireNonEmptyString("FAsset.symbol", fAssetSymbol),
      decimals: Number(fAssetDecimals),
      ...fAssetCode,
    },
    directMinting: {
      assetMintingGranularityUBA: granularityUBA,
      hourly,
      daily,
      unblockUntilTimestamp: normalizedUnblockUntil,
      limiterDisabled,
      largeThresholdUBA: normalizedLargeThresholdUBA,
      largeDelaySeconds: normalizedLargeDelaySeconds,
      paymentAddress: normalizedPaymentAddress,
      minimumFeeUBA: normalizedMinimumFeeUBA,
      executorFeeUBA: normalizedExecutorFeeUBA,
      feeBIPS: normalizedFeeBIPS,
      immediateHeadroomUBA,
      proposedAmountUBA,
      preflight,
    },
  };
}

export async function readCoston2FAssetsState(options = {}) {
  const client = options.client ?? createCoston2PublicClient({ rpcUrl: options.rpcUrl });
  return readFAssetsState({ ...options, client });
}
