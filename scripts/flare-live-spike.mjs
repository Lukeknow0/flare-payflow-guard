#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import process from "node:process";

import { createPublicClient, encodeFunctionData, erc20Abi, http } from "viem";
import { flareTestnet } from "viem/chains";
import { coston2 } from "@flarenetwork/flare-wagmi-periphery-package";

const EXPECTED_CHAIN_ID = 114;
const DEFAULT_RPC_URL = "https://coston2-api.flare.network/ext/C/rpc";
const CONTRACT_REGISTRY = "0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019";
const REGISTRY_LOOKUP_NAME = "AssetManagerFXRP";
const OFFICIAL_REFERENCE_COMMIT = "16927d9594844350ae4e264464cc8662d48ffcaa";
const PINNED_DEPENDENCIES = {
  "@flarenetwork/flare-wagmi-periphery-package": "3.1.0",
  viem: "2.48.4",
};

function fail(message) {
  throw new Error(message);
}

function getArgument(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) fail(`${name} requires a value`);
  return value;
}

function canonicalize(value) {
  if (typeof value === "bigint") return value.toString(10);
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .filter((key) => value[key] !== undefined)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function sha256(value) {
  const body = typeof value === "string" ? value : canonicalJson(value);
  return createHash("sha256").update(body).digest("hex");
}

function bytecodeFacts(code, label) {
  if (!code || code === "0x") fail(`${label} has no bytecode at the anchored block`);
  if (!/^0x[0-9a-fA-F]+$/.test(code) || code.length % 2 !== 0) {
    fail(`${label} returned malformed bytecode`);
  }
  return {
    code_bytes: (code.length - 2) / 2,
    code_sha256: sha256(code.toLowerCase()),
  };
}

function selector(abi, functionName, args = []) {
  return encodeFunctionData({ abi, functionName, args }).slice(0, 10);
}

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function gitProvenance() {
  const status = git(["status", "--porcelain", "--untracked-files=normal"]);
  return {
    commit: git(["rev-parse", "HEAD"]),
    tree: git(["rev-parse", "HEAD^{tree}"]),
    dirty: status.length !== 0,
    status_sha256: sha256(status),
  };
}

function sanitizedRpcUrl(rawUrl) {
  const parsed = new URL(rawUrl);
  parsed.username = "";
  parsed.password = "";
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

function pickedSettings(settings) {
  const keys = [
    "assetDecimals",
    "assetMintingGranularityUBA",
    "lotSizeAMG",
    "mintingCapAMG",
    "minUnderlyingBackingBIPS",
    "collateralReservationFeeBIPS",
    "redemptionFeeBIPS",
    "directMintingHourlyLimitUBA",
    "directMintingDailyLimitUBA",
    "directMintingLargeMintingThresholdUBA",
    "directMintingLargeMintingDelaySeconds",
  ];
  return Object.fromEntries(keys.filter((key) => settings?.[key] !== undefined).map((key) => [key, settings[key]]));
}

async function main() {
  const rpcUrl = process.env.FLARE_RPC_URL || DEFAULT_RPC_URL;
  const outputPath = getArgument("--out");
  const requestedBlock = getArgument("--block") || process.env.FLARE_BLOCK_NUMBER;
  const expectedBlockHash = (getArgument("--block-hash") || process.env.FLARE_BLOCK_HASH)?.toLowerCase();
  const startedAt = new Date();
  const provenance = gitProvenance();
  if (provenance.dirty) {
    fail("live evidence requires a clean Git worktree; commit code before running the spike");
  }

  const client = createPublicClient({
    chain: flareTestnet,
    transport: http(rpcUrl, { retryCount: 0, timeout: 20_000 }),
  });

  const observedChainId = await client.getChainId();
  if (observedChainId !== EXPECTED_CHAIN_ID) {
    fail(`wrong chain: expected ${EXPECTED_CHAIN_ID}, observed ${observedChainId}`);
  }

  const latestBlockNumber = await client.getBlockNumber();
  const blockNumber = requestedBlock ? BigInt(requestedBlock) : latestBlockNumber - 2n;
  if (blockNumber <= 0n || blockNumber > latestBlockNumber) fail("invalid anchored block number");

  const blockBefore = await client.getBlock({ blockNumber, includeTransactions: false });
  if (!blockBefore.hash) fail("anchored block has no hash");
  const anchorHash = blockBefore.hash.toLowerCase();
  if (expectedBlockHash && expectedBlockHash !== anchorHash) {
    fail(`anchored block hash mismatch: expected ${expectedBlockHash}, observed ${anchorHash}`);
  }

  const registryCode = await client.getCode({ address: CONTRACT_REGISTRY, blockNumber });
  const registryCodeFacts = bytecodeFacts(registryCode, "Flare Contract Registry");

  const assetManagerAddress = await client.readContract({
    address: CONTRACT_REGISTRY,
    abi: coston2.iFlareContractRegistryAbi,
    functionName: "getContractAddressByName",
    args: [REGISTRY_LOOKUP_NAME],
    blockNumber,
  });
  if (!/^0x[0-9a-fA-F]{40}$/.test(assetManagerAddress) || /^0x0{40}$/i.test(assetManagerAddress)) {
    fail(`registry returned invalid ${REGISTRY_LOOKUP_NAME} address: ${assetManagerAddress}`);
  }

  const assetManagerCode = await client.getCode({ address: assetManagerAddress, blockNumber });
  const assetManagerCodeFacts = bytecodeFacts(assetManagerCode, REGISTRY_LOOKUP_NAME);

  const [settings, fAssetAddress] = await Promise.all([
    client.readContract({
      address: assetManagerAddress,
      abi: coston2.iAssetManagerAbi,
      functionName: "getSettings",
      blockNumber,
    }),
    client.readContract({
      address: assetManagerAddress,
      abi: coston2.iAssetManagerAbi,
      functionName: "fAsset",
      blockNumber,
    }),
  ]);

  if (!/^0x[0-9a-fA-F]{40}$/.test(fAssetAddress) || /^0x0{40}$/i.test(fAssetAddress)) {
    fail(`AssetManager returned invalid FAsset address: ${fAssetAddress}`);
  }
  const fAssetCode = await client.getCode({ address: fAssetAddress, blockNumber });
  const fAssetCodeFacts = bytecodeFacts(fAssetCode, "FXRP token");

  const [tokenName, tokenSymbol, tokenDecimals] = await Promise.all([
    client.readContract({ address: fAssetAddress, abi: erc20Abi, functionName: "name", blockNumber }),
    client.readContract({ address: fAssetAddress, abi: erc20Abi, functionName: "symbol", blockNumber }),
    client.readContract({ address: fAssetAddress, abi: erc20Abi, functionName: "decimals", blockNumber }),
  ]);

  const blockAfter = await client.getBlock({ blockNumber, includeTransactions: false });
  if (!blockAfter.hash || blockAfter.hash.toLowerCase() !== anchorHash) {
    fail("anchored block hash changed during the spike");
  }

  const normalizedSettings = canonicalize(settings);
  const settingsKeys = settings && typeof settings === "object" && !Array.isArray(settings) ? Object.keys(settings).sort() : [];
  const calls = [
    { id: "chain-id", method: "eth_chainId", block_tag: null, result_sha256: sha256(observedChainId.toString()) },
    { id: "anchor", method: "eth_getBlockByNumber", block_tag: `0x${blockNumber.toString(16)}`, result_sha256: sha256(anchorHash) },
    { id: "registry-code", method: "eth_getCode", to: CONTRACT_REGISTRY, block_tag: `0x${blockNumber.toString(16)}`, result_sha256: registryCodeFacts.code_sha256 },
    {
      id: "registry-asset-manager-fxrp",
      method: "eth_call",
      to: CONTRACT_REGISTRY,
      selector: selector(coston2.iFlareContractRegistryAbi, "getContractAddressByName", [REGISTRY_LOOKUP_NAME]),
      block_tag: `0x${blockNumber.toString(16)}`,
      result_sha256: sha256(assetManagerAddress.toLowerCase()),
    },
    { id: "asset-manager-code", method: "eth_getCode", to: assetManagerAddress, block_tag: `0x${blockNumber.toString(16)}`, result_sha256: assetManagerCodeFacts.code_sha256 },
    {
      id: "asset-manager-settings",
      method: "eth_call",
      to: assetManagerAddress,
      selector: selector(coston2.iAssetManagerAbi, "getSettings"),
      block_tag: `0x${blockNumber.toString(16)}`,
      result_sha256: sha256(normalizedSettings),
    },
    {
      id: "asset-manager-fasset",
      method: "eth_call",
      to: assetManagerAddress,
      selector: selector(coston2.iAssetManagerAbi, "fAsset"),
      block_tag: `0x${blockNumber.toString(16)}`,
      result_sha256: sha256(fAssetAddress.toLowerCase()),
    },
    { id: "fasset-code", method: "eth_getCode", to: fAssetAddress, block_tag: `0x${blockNumber.toString(16)}`, result_sha256: fAssetCodeFacts.code_sha256 },
  ];

  const evidenceWithoutIntegrity = {
    schema_version: "1.0.0",
    artifact_type: "flare_live_contract_spike",
    mode: "live",
    run_id: `coston2-${startedAt.toISOString().replace(/[-:.]/g, "")}-${randomUUID().slice(0, 8)}`,
    observed_at_utc: startedAt.toISOString(),
    completed_at_utc: new Date().toISOString(),
    provenance: {
      ...provenance,
      command: "npm run spike:live -- --out <path>",
      node: process.version,
      dependencies: PINNED_DEPENDENCIES,
      abi_source: {
        package: "@flarenetwork/flare-wagmi-periphery-package",
        official_reference_repository: "https://github.com/flare-foundation/fassets-demo-dapp",
        official_reference_commit: OFFICIAL_REFERENCE_COMMIT,
      },
    },
    network: {
      name: "Flare Testnet Coston2",
      expected_chain_id: EXPECTED_CHAIN_ID,
      observed_chain_id: observedChainId,
      rpc_url: sanitizedRpcUrl(rpcUrl),
      explorer: "https://coston2-explorer.flare.network",
      latest_block_number_at_start: latestBlockNumber,
    },
    anchor: {
      block_number: blockNumber,
      block_tag: `0x${blockNumber.toString(16)}`,
      block_hash: anchorHash,
      block_timestamp: blockBefore.timestamp,
      block_timestamp_utc: new Date(Number(blockBefore.timestamp) * 1000).toISOString(),
      hash_rechecked: true,
    },
    registry: {
      address: CONTRACT_REGISTRY,
      lookup_name: REGISTRY_LOOKUP_NAME,
      resolved_address: assetManagerAddress,
      ...registryCodeFacts,
    },
    asset_manager: {
      address: assetManagerAddress,
      ...assetManagerCodeFacts,
    },
    asset: {
      address: fAssetAddress,
      name: tokenName,
      symbol: tokenSymbol,
      decimals: tokenDecimals,
      ...fAssetCodeFacts,
    },
    fassets: {
      method: "getSettings",
      settings_field_count: settingsKeys.length,
      settings_keys: settingsKeys,
      settings_selected: pickedSettings(settings),
      settings: normalizedSettings,
      settings_sha256: sha256(normalizedSettings),
    },
    calls,
    safety: {
      read_only: true,
      wallet_used: false,
      transaction_signed: false,
      transaction_submitted: false,
      fixture_fallback: false,
    },
  };

  const evidence = canonicalize({
    ...evidenceWithoutIntegrity,
    integrity: { canonical_payload_sha256: sha256(evidenceWithoutIntegrity) },
  });
  const pretty = `${JSON.stringify(evidence, null, 2)}\n`;

  if (outputPath) {
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, pretty, { encoding: "utf8", flag: "wx" });
  } else {
    process.stdout.write(pretty);
  }
}

main().catch((error) => {
  process.stderr.write(`LIVE_SPIKE_FAILED: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 70;
});

