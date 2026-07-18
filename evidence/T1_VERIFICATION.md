# T1 live Coston2 verification

- Result: **PASS**
- Verified: `2026-07-17 11:00 CST (UTC+8)`
- Pre-public capture code commit: `86dda437889856900a9aa6dda46bc2795b395ff4`
- Capture code tree: `a3c1294cfcbf7f63d069d14e642fb6e305cd61b4`
- Runtime: Node `v22.22.3`
- Official ABI package: `@flarenetwork/flare-wagmi-periphery-package@3.1.0`
- RPC library: `viem@2.48.4`

## Machine result

```bash
npm run spike:verify -- \
  evidence/live/runs/t1-run-1.json \
  evidence/live/runs/t1-run-2.json
```

The verifier returned `T1_PASS`. Both bundles were captured by separate clean processes with `mode=live`, `expected_chain_id=observed_chain_id=114`, `read_only=true`, `wallet_used=false`, `transaction_signed=false`, `transaction_submitted=false`, and `fixture_fallback=false`.

| Field | Run 1 | Run 2 |
|---|---|---|
| Run ID | `coston2-20260717T025958501Z-7b4c52ed` | `coston2-20260717T030035302Z-85424ffe` |
| Block | `32942996` | `32943001` |
| Block hash | `0x84b8d3be327919c69d172e3f4f2312c6c523ab09ed3f7f39d5ed83de9aea3558` | `0x42c7e37547799ea482b897fb2a2a932a786574d85e2037df3997c83b09390e1a` |
| Bundle SHA-256 | `eb0b8e2049b58276a05bbd3b5ce8dc29ce86aca300a1860cde86581853990a07` | `518f84b81f3c72b710c0aae0b8b0de69d43a058a925a528b0ece5faa497dfdc3` |
| Canonical payload digest | `892dcf5447c3091cf0969b1f7c00ffa14b938d9b8eef0b229863b01f8792d687` | `5231543b09d71fdc0f7461eb18b31f0b0b13a4ccb40026aab4c720034d556c71` |

Both runs independently proved the same core path:

```text
Coston2 chain 114
  -> Flare Contract Registry 0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019
  -> getContractAddressByName("AssetManagerFXRP")
  -> AssetManager 0xc1Ca88b937d0b528842F95d5731ffB586f4fbDFA (217 code bytes)
  -> getSettings() (60 named fields)
  -> fAsset() 0x0b6A3645c240605887a5532109323A3E12273dc7
  -> token symbol FTestXRP, decimals 6 (177 code bytes)
```

The complete settings digest was identical in both runs: `217250ae5ee1ed0883f2612415ec632acbe6d3f7e91ab4bf32db61d0304f5579`. Selected decoded values were `assetDecimals=6`, `assetMintingGranularityUBA=1`, `lotSizeAMG=10000000`, `collateralReservationFeeBIPS=10`, and `redemptionFeeBIPS=50`.

## Official sources

- [Coston2 network configuration](https://dev.flare.network/network/overview)
- [Read FAssets Settings with Node/Viem](https://dev.flare.network/fassets/developer-guides/fassets-settings-node)
- [Get AssetManagerFXRP through Contract Registry](https://dev.flare.network/fassets/developer-guides/fassets-asset-manager-address-contracts-registry)
- [Official FAssets reference](https://dev.flare.network/fassets/reference)
- [Pinned official demo commit](https://github.com/flare-foundation/fassets-demo-dapp/commit/16927d9594844350ae4e264464cc8662d48ffcaa)

This proof is read-only. It is real testnet evidence, but it is not a deployment or transaction receipt.
