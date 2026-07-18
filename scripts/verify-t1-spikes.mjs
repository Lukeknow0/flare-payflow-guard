#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import process from "node:process";

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function sha256(value) {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function verifyBundle(bundle, path) {
  assert(bundle.schema_version === "1.0.0", `${path}: unsupported schema`);
  assert(bundle.artifact_type === "flare_live_contract_spike", `${path}: wrong artifact type`);
  assert(bundle.mode === "live", `${path}: mode is not live`);
  assert(bundle.network?.expected_chain_id === 114 && bundle.network?.observed_chain_id === 114, `${path}: wrong chain`);
  assert(bundle.provenance?.dirty === false, `${path}: evidence was captured from a dirty tree`);
  assert(bundle.safety?.read_only === true, `${path}: read_only is not true`);
  assert(bundle.safety?.wallet_used === false, `${path}: wallet use detected`);
  assert(bundle.safety?.transaction_signed === false && bundle.safety?.transaction_submitted === false, `${path}: write action detected`);
  assert(bundle.safety?.fixture_fallback === false, `${path}: fixture fallback detected`);
  assert(/^0x[0-9a-f]{64}$/.test(bundle.anchor?.block_hash), `${path}: invalid block hash`);
  assert(bundle.anchor?.hash_rechecked === true, `${path}: block hash was not rechecked`);
  assert(bundle.registry?.lookup_name === "AssetManagerFXRP", `${path}: wrong registry lookup`);
  assert(/^0x[0-9a-fA-F]{40}$/.test(bundle.registry?.resolved_address), `${path}: invalid AssetManager address`);
  assert(Number(bundle.asset_manager?.code_bytes) > 0, `${path}: AssetManager has no code`);
  assert(/^0x[0-9a-fA-F]{40}$/.test(bundle.asset?.address), `${path}: invalid FAsset address`);
  assert(Number(bundle.asset?.code_bytes) > 0, `${path}: FAsset has no code`);
  assert(bundle.asset?.symbol === "FTestXRP" || bundle.asset?.symbol === "FXRP", `${path}: unexpected asset symbol`);
  assert(Number(bundle.fassets?.settings_field_count) > 0, `${path}: getSettings returned no named fields`);
  assert(bundle.fassets?.settings_selected?.assetDecimals !== undefined, `${path}: settings missing assetDecimals`);
  assert(bundle.fassets?.settings_selected?.lotSizeAMG !== undefined, `${path}: settings missing lotSizeAMG`);

  const requiredCalls = new Set([
    "chain-id",
    "anchor",
    "registry-code",
    "registry-asset-manager-fxrp",
    "asset-manager-code",
    "asset-manager-settings",
    "asset-manager-fasset",
    "fasset-code",
  ]);
  for (const call of bundle.calls || []) {
    requiredCalls.delete(call.id);
    if (call.block_tag !== null) assert(call.block_tag === bundle.anchor.block_tag, `${path}: mixed block tags`);
  }
  assert(requiredCalls.size === 0, `${path}: missing calls ${[...requiredCalls].join(", ")}`);

  const { integrity, ...payload } = bundle;
  assert(integrity?.canonical_payload_sha256 === sha256(payload), `${path}: canonical evidence digest mismatch`);
  return {
    path,
    run_id: bundle.run_id,
    commit: bundle.provenance.commit,
    block_number: bundle.anchor.block_number,
    block_hash: bundle.anchor.block_hash,
    asset_manager: bundle.registry.resolved_address,
    fasset: bundle.asset.address,
    symbol: bundle.asset.symbol,
    settings_sha256: bundle.fassets.settings_sha256,
    evidence_sha256: integrity.canonical_payload_sha256,
  };
}

async function main() {
  const paths = process.argv.slice(2);
  assert(paths.length === 2, "usage: npm run spike:verify -- <run-1.json> <run-2.json>");
  const summaries = [];
  for (const path of paths) {
    summaries.push(verifyBundle(JSON.parse(await readFile(path, "utf8")), path));
  }
  assert(summaries[0].run_id !== summaries[1].run_id, "the two bundles must come from separate runs");
  assert(summaries[0].commit === summaries[1].commit, "the two runs must use the same code commit");
  assert(summaries[0].asset_manager.toLowerCase() === summaries[1].asset_manager.toLowerCase(), "AssetManager changed between runs");
  assert(summaries[0].fasset.toLowerCase() === summaries[1].fasset.toLowerCase(), "FAsset changed between runs");
  process.stdout.write(`${JSON.stringify({ status: "T1_PASS", mode: "live", runs: summaries }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`T1_VERIFY_FAILED: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

