# Flare PayFlow Guard Architecture

Status: **locked and locally verified read-only MVP; DoraHacks submission pending**

Locked: `2026-07-17`
Policy: `2.0.0`
Decision schema: `flare_guard_decision@1.1.0`
Evidence schema: `flare_fassets_evidence@1.0.0`
Public pre-Flare boundary: branch/ref `pre-flare-import`

## 1. Product invariant

Flare PayFlow Guard accepts one narrowly defined FXRP direct-mint intent, reads block-anchored Flare state, and returns deterministic `PASS`, `REVIEW`, or `BLOCK` output. It never signs or submits a transaction.

The fail-closed invariant is:

> No complete, fresh, live Flare evidence from the verified capture path means no `VERIFY_LIVE_PASS`; no JSON decision ever authorizes execution.

The decision depends on Coston2 chain identity, Contract Registry resolution, AssetManager/FAsset bytecode, FAssets settings, Core Vault fees, limiter state, a rechecked block anchor, clean capture provenance, pinned dependency state, safety flags, and equality between normalized evidence and the raw adapter state. Removing Flare or relabelling an arbitrary EVM result therefore breaks the critical path.

## 2. Component flow

```text
untrusted direct-mint intent
        |
        v
Node/viem live adapter
  Coston2 chain 114
  one selected block + hash recheck
  Contract Registry -> AssetManagerFXRP -> FTestXRP
  settings + Core Vault fees + direct-mint limiter state
        |
        v
evidence envelope
  normalized sections + raw adapter_state
  provenance/dependency lock + safety + integrity digest
        |
        v
Python policy 2.0.0
  exact amount/gross quote + official 32-byte memo
  fixed 900-second freshness + fail-closed bindings
        |
        v
PASS / REVIEW / BLOCK + evidence-bound digest
        |
        v
human wallet review only (external; never automated here)
        |
        v
optional caller-supplied receipt facts
  DirectMintingExecuted / delayed-event semantics
  no receipt RPC or FDC retrieval in this module
```

Node/viem is used for Flare's published ABIs and Solidity structs. Python holds the small deterministic rule engine. Their boundary is versioned JSON; neither side receives a wallet or credential.

## 3. Implemented components

| Component | State | Review location |
|---|---|---|
| Coston2 Registry/FAssets adapter | Implemented, read-only | `src/flare-adapter/fassets.mjs` |
| One-block capture and provenance envelope | Implemented, write-once | `scripts/capture-fassets-preflight.mjs` |
| Two-run T1 verifier | Implemented and historically passed | `scripts/verify-t1-spikes.mjs`, `evidence/T1_VERIFICATION.md` |
| Policy `2.0.0` | Implemented; direct mint only | `src/flare_guard/policy.py` |
| Official gross quote and 32-byte memo | Implemented | `payment_plan` in decision output |
| Receipt-fact verifier | Implemented, caller-supplied facts only | `src/flare_guard/receipt.py` |
| One-command offline/live harness | Implemented | `Makefile`, `scripts/verify-live.mjs` |
| FDC and independent receipt retrieval | Not implemented | explicit non-claim |

## 4. Versioned data contracts

Canonical digests use UTF-8 JSON with recursively sorted object keys and base-10 strings for large integers. A digest detects mutation of the represented payload. It does not authenticate who created a JSON file or prove that its values came from Flare.

### 4.1 Intent

The only supported MVP operation is `direct_mint`:

```json
{
  "schema_version": "1.0.0",
  "operation": "direct_mint",
  "amount": "10.000000",
  "spend_limit": "10.200000",
  "expected_chain_id": 114,
  "asset": {
    "symbol": "FTestXRP",
    "address": "0x0b6A3645c240605887a5532109323A3E12273dc7",
    "decimals": 6
  },
  "recipient": "0x0000000000000000000000000000000000000002"
}
```

`amount` means net FXRP to mint. `spend_limit` means maximum gross XRPL payment. Both use exact decimal conversion; floating-point arithmetic is not used. Unknown fields, secret material, a nonpositive/pathological number, excessive precision, a wrong chain, an invalid recipient, or any operation other than `direct_mint` blocks.

The intent cannot set freshness, evaluation time, Registry identity, protocol fee/limiter state, provenance, or safety policy. Its `spend_limit` is only the user's maximum permitted gross payment.

### 4.2 Live evidence

A policy-ready live artifact must include all of the following:

- `schema_version=1.0.0`, `artifact_type=flare_fassets_evidence`, and `mode=live`;
- capture request amount and selected block;
- expected/observed chain `114`;
- positive block number/timestamp, 32-byte block hash, and `hash_rechecked=true`;
- official Coston2 Registry address and lookup name `AssetManagerFXRP`;
- Registry, AssetManager, and FAsset addresses, positive bytecode lengths, and bytecode SHA-256 values;
- full decoded settings plus a matching settings digest;
- Core Vault payment address, captured amount, fee inputs, hourly/daily limits and remaining values, large-mint threshold/delay, computed delay, and reason list;
- raw `adapter_state` whose anchor, network, code identities, settings, fees, limits, and delay fields equal the normalized sections;
- clean Git commit/tree, exact declared/lockfile/runtime dependency versions, and dependency-file hashes;
- read-only/no-wallet/no-key/no-sign/no-write/no-broadcast/no-fallback safety assertions;
- a canonical SHA-256 over the artifact excluding its `integrity` object.

Every block-dependent RPC call uses the same block tag, and the block hash is re-read after the contract calls. Required bytecode must be non-empty. A configured address can be an additional assertion but cannot replace the on-chain Registry lookup.

### 4.3 Freshness and replay

Policy `2.0.0` fixes the maximum evidence age at **900 seconds**. Normal evaluation uses the policy process's current UTC clock; neither user intent nor the public API can supply another evaluation time. Clock skew or stale evidence produces `REVIEW`, so it cannot contribute to `VERIFY_LIVE_PASS`.

`--historical-replay` evaluates the saved artifact at its captured observation time. It is useful for deterministic audit and demo, but it always sets `execution_eligible=false`, even when the rule result is `PASS`. The block `32943632` legacy artifact predates manifest/lock/runtime provenance fields; that omission is accepted only in this explicit replay mode. A normal live evaluation requires the current pinned file hashes, lock versions/SRI, and runtime versions or blocks with `PROVENANCE_INVALID`.

Pure policy output is always human-only because an unkeyed JSON self-digest cannot authenticate its own RPC origin. Therefore `execution_eligible=false` for every decision. The same-process live harness separately emits `VERIFY_LIVE_PASS` after it creates and validates two fresh captures and their two `PASS` decisions; that status still leads only to human wallet review.

### 4.4 Payment plan

For the committed example:

```text
net mint       10,000,000 UBA = 10.0 XRP
minting fee       100,000 UBA =  0.1 XRP
executor fee      100,000 UBA =  0.1 XRP
gross payment  10,200,000 UBA = 10.2 XRP
```

The minting fee is `max(net * feeBIPS / 10000, minimumFee)` using integer base units; the executor fee is then added. The example's 25 BIPS proportional fee is below the observed 100,000 UBA minimum.

The generated official 32-byte direct-mint memo is:

```text
4642505266410018000000000000000000000000000000000000000000000002
```

This binds the direct-mint prefix and example EVM recipient. The result is a quote for human review, not a payment instruction executed by this repository.

### 4.5 Decision

The output schema is `1.1.0` and includes:

```json
{
  "policy_version": "2.0.0",
  "decision": "PASS",
  "execution_eligible": false,
  "audit_id": "FLARE-DEB2AA04A4EBB912",
  "canonical_digest": "deb2aa04a4ebb912a312ab95574ee3e4681109a83bcd82eaeeff3935f3550792",
  "flare_evidence_sha256": "12258b73dce67daf013a90903ccf862c690fd9dd32663e255f3b613ad3e9192a",
  "evaluation": {
    "maximum_evidence_age_seconds": 900,
    "historical_replay": true
  },
  "human_gate": {
    "status": "HUMAN_CONFIRMATION_REQUIRED",
    "automatic_signing": false,
    "transaction_submission": false,
    "private_key_custody": false
  }
}
```

The shown values are the current-policy historical replay of block `32943632`, not a current execution approval. The canonical decision digest binds policy version/constants, normalized intent, evaluation context, payment plan, ordered reason codes, receipt summary, canonical evidence digest, block number/hash/timestamp, capture commit/tree, and settings digest. Changing the anchor or evidence therefore changes the decision digest.

CLI exits are `0=PASS`, `10=REVIEW`, `20=BLOCK`, `64=input`, and `70=evidence/evaluation`. `execution_eligible` is always false. Fresh source authenticity is represented only by the live harness's `VERIFY_LIVE_PASS`, and every result still requires human confirmation.

### 4.6 Receipt facts

The receipt verifier accepts caller-supplied normalized facts. A successful execution claim requires:

- complete receipt-verification expectations for chain `114`, EVM transaction hash, underlying transaction ID, anchored AssetManager, asset, net amount, recipient, minting fee, and executor fee;
- Coston2 chain `114`, a valid transaction hash, positive block number, and block hash;
- asset address and an event emitted by the anchored `AssetManagerFXRP`;
- event name exactly `DirectMintingExecuted`;
- decoded underlying transaction ID, minted amount, minting fee, executor fee, and recipient/`targetAddress` matching the preflight;
- sender equality when the intent declared an XRPL sender;
- `verification_mode=live` and `trusted_event_verified=true`.

Only then can the receipt summary say `settlement_status=EXECUTED`. Missing preflight expectations produce `REVIEW/RECEIPT_PREFLIGHT_BINDING_MISSING`. `status=1` by itself produces `REVIEW/RECEIPT_EFFECT_UNVERIFIED` and `REVIEW/RECEIPT_SETTLEMENT_UNVERIFIED`. Any mismatch prevents `EXECUTED`; delayed events produce `REVIEW/RECEIPT_DIRECT_MINT_DELAYED` because they did not mint FXRP.

The module does not fetch a receipt, decode logs from RPC, verify the truth of the caller's marker, or retrieve FDC proof. Its digest proves consistency of supplied facts, not their external origin. FDC Payment is not claimed.

## 5. Verdict semantics

- `BLOCK`: malformed/secret-bearing intent, unsupported operation, wrong chain/address/asset, missing or corrupt live envelope, bad provenance/safety/integrity/anchor, Registry/code/settings/raw-adapter mismatch, amount/fee/limit inconsistency, gross limit exceeded, or receipt mismatch/failure.
- `REVIEW`: fixture or historical/stale context, clock uncertainty, valid protocol delay/capacity condition, missing receipt when required, status-only/unverified receipt, pending/unknown receipt, or delayed direct-mint event.
- `PASS`: no `BLOCK` or `REVIEW` reason. It is a policy verdict for human review, never an execution authorization.

Reason codes have fixed priority and stable ordering. Given the same canonical intent, evidence, evaluation time/mode, and supplied receipt, output is deterministic.

## 6. Authenticity and control boundaries

| Boundary | What is checked | What is not inferred |
|---|---|---|
| Intent | schema, secrets, exact amount, spend limit, chain, asset, recipient | no user-supplied policy override |
| RPC capture | chain, one block, hash recheck, Registry path, code, state | one RPC response is not independently trusted by itself |
| Evidence | normalized/raw equality, provenance, lock/runtime versions, safety, self-digest | self-digest alone does not authenticate origin |
| Live harness | two child-process captures + two strict decisions in one process; emits `VERIFY_LIVE_PASS` | no fixture fallback and no wallet authorization |
| Execution | explicit human wallet review only | no custody, signing, submission, or test-fund action |
| Receipt | consistency of supplied decoded effect facts | no RPC/FDC retrieval and no truth guarantee for caller assertions |

`make verify` is the trusted evidence-authenticity entry point: it obtains both captures itself and validates both decisions before success without retaining them. To preserve a verified five-artifact bundle, run `node scripts/verify-live.mjs --retain-dir evidence/live/<new-directory>`; it writes only after the complete pair passes, and the target must be new.

## 7. Flare-removal tests

Machine tests cover these failure classes:

1. Wrong observed chain -> `CHAIN_MISMATCH`.
2. Registry, resolved manager, FAsset, or code identity mutation -> `BLOCK`.
3. Missing/bad evidence digest, provenance, safety, block hash, or hash recheck -> `BLOCK`.
4. Normalized settings/direct-mint state diverges from raw `adapter_state` -> `ADAPTER_STATE_MISMATCH`.
5. Captured amount differs from intent or request -> `DIRECT_MINT_AMOUNT_MISMATCH`/`REQUEST_EVIDENCE_MISMATCH`.
6. Fee/limit evidence is incomplete or internally inconsistent -> `BLOCK`.
7. Every pure decision, including fresh, fixture, and historical input -> `execution_eligible=false`; only the same-process harness can attest `VERIFY_LIVE_PASS`.
8. RPC/capture/validation child fails -> live verifier exits non-zero and retains nothing.

An EVM-only guard that still passes these mutations is non-conforming.

## 8. Recorded anchors

T1 proved two separate live reads at blocks `32942996` and `32943001`. Both resolved:

```text
Contract Registry    0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019
AssetManagerFXRP     0xc1Ca88b937d0b528842F95d5731ffB586f4fbDFA
FAsset               0x0b6A3645c240605887a5532109323A3E12273dc7
symbol/decimals      FTestXRP / 6
settings SHA-256     217250ae5ee1ed0883f2612415ec632acbe6d3f7e91ab4bf32db61d0304f5579
```

The later genuine capture at block `32943632` recorded Core Vault `rDhpmiPq4BVBDWMVdSrmkgt8thKyRzGV1p`, 100,000 UBA minimum and executor fees, 25 BIPS, ample hourly/daily headroom, and zero delay. Its old policy-1 decision/audit is superseded. Under policy `2.0.0`, explicit historical replay yields `PASS`, `FLARE-DEB2AA04A4EBB912`, and `execution_eligible=false`.

Clean pre-public candidate `c665bab4c82d0d0595879b687d103adcc76a1a73`
passed full
`make verify`. The retained policy-2 bundle at
`evidence/live/final-policy2-c665bab-20260717/` contains two independent
captures at block `32945674`, hash
`0xfd1eae47e1452755a6df32a77ee133ce30d168e0a6429aab2f20b2b9be1145ab`.
Both decisions are `PASS`, verifier-owned `verified_live_pass=true`,
`execution_eligible=false`, and `HUMAN_CONFIRMATION_REQUIRED`.

## 9. Official references

- [Flare networks and Coston2](https://dev.flare.network/network/overview)
- [Resolve AssetManager through Contract Registry](https://dev.flare.network/fassets/developer-guides/fassets-asset-manager-address-contracts-registry)
- [Read FAssets settings with Node](https://dev.flare.network/fassets/developer-guides/fassets-settings-node)
- [FAssets direct minting guide](https://dev.flare.network/fassets/developer-guides/fassets-direct-minting)
- [Official direct-mint payment calculation helper](https://raw.githubusercontent.com/flare-foundation/flare-viem-starter/main/src/utils/fassets.ts)
- [Flare FAssets demo reference commit](https://github.com/flare-foundation/fassets-demo-dapp/tree/16927d9594844350ae4e264464cc8662d48ffcaa)
