# Historical live FXRP direct-mint capture

- Capture status: **genuine read-only Coston2 state; retained as a milestone**
- Current policy 2.0.0 replay: **historical PASS, `execution_eligible=false`**
- Captured: `2026-07-17T03:28:16.041Z`
- Clean pre-public code commit: `642623c27c89ee15a6fa2c678bd02d95965afaa9`
- Evidence file: `evidence/live/runs/preflight-live-2.json`
- Superseded decision file: `evidence/live/runs/preflight-decision-2.json`
- Network: Flare Testnet Coston2, chain ID `114`
- Block: `32943632`
- Block hash: `0xfbc34cc81e7bc92d28db7ccba4e754addb4ea1c598bba787ee26f4dcb687f384`
- Evidence canonical payload digest: `12258b73dce67daf013a90903ccf862c690fd9dd32663e255f3b613ad3e9192a`
- Evidence whole-file SHA-256: `60e9b02bc0d5771c86c0d7b8d862a7dba8833462a8b377ea36260ad10b90c800`
- Superseded policy digest: `e566a204fd542ae6ef0f70abc76f8304d6e3c7190fade4ba6c0d311847af4313`
- Superseded decision whole-file SHA-256: `ea9a4256a37bdf92ca545dc77a2f1b08e0909dd54b61401aa08779023b647b39`

The captured contract facts remain genuine. The old decision is retained for
development history only: red-team review found that it treated `amount` as a
gross payment even though the official direct-mint flow defines the requested
amount as net FXRP and adds minting and executor fees. Policy 2.0.0 fixes that
model, binds the decision to the evidence anchor, and makes historical replays
non-executable.

## Intent

The capture queried limiter state for a proposed net `10 XRP` mint
(`10,000,000 UBA`) into Coston2 FTestXRP. The superseded intent declared only a
10 XRP gross spend limit. The corrected intent declares `10.2 XRP`: 10 XRP net,
plus a 0.1 XRP minimum minting fee and a 0.1 XRP executor fee.

## Live Flare facts at the anchored block

| Fact | Observed value |
|---|---|
| Contract Registry | `0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019` |
| Registry lookup | `AssetManagerFXRP` |
| AssetManager | `0xc1Ca88b937d0b528842F95d5731ffB586f4fbDFA` |
| FAsset | `0x0b6A3645c240605887a5532109323A3E12273dc7` (`FTestXRP`, 6 decimals) |
| XRPL Core Vault payment address | `rDhpmiPq4BVBDWMVdSrmkgt8thKyRzGV1p` |
| Minimum direct-mint fee | `100,000 UBA` (`0.1 TestXRP`) |
| Executor fee | `100,000 UBA` (`0.1 TestXRP`) |
| Mint fee rate | `25 BIPS` (`0.25%`) |
| Hourly limit / remaining | `100,000,000,000 / 100,000,000,000 UBA` |
| Daily limit / remaining | `500,000,000,000 / 499,867,400,000 UBA` |
| Large-mint threshold / delay | `100,000,000,000 UBA / 3,600 seconds` |
| Computed execution delay | `0 seconds` |

All contract calls and code reads used the same block number. The adapter then re-read the block hash. The evidence explicitly states no wallet, private key, signing, transaction broadcast, chain write, fixture fallback, or mock fallback.

## Current deterministic historical replay

Policy 2.0.0 returns this result for the saved artifact and corrected intent:

```json
{
  "decision": "PASS",
  "execution_eligible": false,
  "audit_id": "FLARE-DEB2AA04A4EBB912",
  "reasons": [],
  "payment_plan": {
    "net_mint_uba": "10000000",
    "minting_fee_uba": "100000",
    "executor_fee_uba": "100000",
    "gross_payment_uba": "10200000",
    "memo_data_hex": "4642505266410018000000000000000000000000000000000000000000000002"
  },
  "human_gate": {
    "status": "HUMAN_CONFIRMATION_REQUIRED",
    "automatic_signing": false,
    "transaction_submission": false,
    "private_key_custody": false
  }
}
```

This is a historical verdict about state at block `32943632`; it is never safe
to treat as current. Pure decisions are always human-only. Fresh source
authenticity requires the same-process `make verify` path to emit
`VERIFY_LIVE_PASS`. A canonical digest proves file consistency, not independent
source authenticity or permission to execute.

## Replay

Offline replay of the committed live evidence:

```bash
PYTHONPATH=src python3 -m flare_guard.cli \
  --intent examples/intents/direct-mint-10-xrp.json \
  --evidence evidence/live/runs/preflight-live-2.json \
  --historical-replay
```

Fresh network capture (read-only; network access required):

```bash
make verify-live

# Optional: retain both validated captures, both bound decisions, and summary.
node scripts/verify-live.mjs \
  --retain-dir evidence/live/<new-unique-directory>
```
