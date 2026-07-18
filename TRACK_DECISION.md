# Flare Summer Signal 赛道决策

- 决策状态：**已锁定主赛道；条款门禁由用户解除，T1 技术门禁执行中**
- 唯一主赛道：**Bounty 1 — Interoperable Asset Products**
- 主项目方向：**Cross-chain Asset Preflight & Receipt Guard**
- 备注：不同时制作 Confidential Compute 半成品；只有当主赛道最小官方 live spike 失败时，才重新做赛道决策。

## 一页比较

评分采用 1–5 分，5 分最有利。权重按用户指定的排序目标：现有代码复用度 35%、Flare 是否处于产品核心 25%、机器证据质量 25%、预计有效竞争 15%。“竞争”越高分表示预计有效对手越少，但当前没有官方赛道拆分数据，因此该列置信度低。

| 排名 | 赛道 | 代码复用 35% | Flare 核心性 25% | 机器证据 25% | 预计有效竞争 15% | 加权分 |
|---:|---|---:|---:|---:|---:|---:|
| 1 | Interoperable Asset Products | 5 | 5 | 5 | 2 | **4.55 / 5** |
| 2 | Confidential Compute Apps | 3 | 5 | 3 | 3 | **3.50 / 5** |

### 1. 现有代码复用度

**Interoperable Asset Products: 5/5**

Pharos PayFlow Guard 的主干已经是“支付意图 → 确定性 PASS/REVIEW/BLOCK → 实时 RPC preflight → 人工确认门 → 交易回执审计”。Flare 官方赛道明确把 cross-chain asset dashboards、wallet experiences、payment or merchant flows、asset movement UX 与 portfolio tools 列为合格方向。产品模型可复用，但链数据、资产语义、风险规则和回执必须为 Flare 重做。

**Confidential Compute Apps: 3/5**

可复用意图、风险分类与回执包装，但核心执行模型会变成 TEE extension + proxy + onchain instruction/result。这不是简单移植，需要新的信任边界、远程证明、密钥/敏感输入模型和部署运维。

### 2. Flare 集成是否位于核心路径

**两赛道都可做到 5/5，但资产赛道的核心性更容易独立复验。**

主方向不会只把网络名称换成 Flare。候选核心输入均来自 Flare 官方系统：

- 通过 Flare Contract Registry 动态解析 `AssetManagerFXRP` 和 FXRP，不把可变合约地址当成静态配置。
- 从 FAssets AssetManager 读取设置、可用 agent、抵押率/费率/状态以及 direct-mint 时/日限额和大额延迟。
- 用 FDC `AddressValidity` 校验 XRP/BTC/DOGE 地址，用 FDC `Payment` / `IXRPPayment` 对 XRP 支付生成可上链验证的付款证据。
- 在必要时读 FTSO 价格以生成带时间戳的金额上下文。

移除 Flare 后，资产系统状态、FDC 外链验证、FXRP 可用性与可审计回执都消失，产品不再能给出同等级判定，因此不是装饰性集成。

### 3. 机器证据质量

**Interoperable Asset Products: 5/5**

Flare 官方文档公开了 Coston2 的 RPC、chain ID `114`、explorer、faucet（C2FLR / FXRP / USDT0）、FDC verifier/DA 端点、合约接口和参考应用。证据可以固定为：

- chain ID、block number/hash 和查询时间。
- registry 解析结果、合约 code hash 和具体 block tag。
- FAssets 设置、agent 结果、限额原始数值与确定性风险规则。
- FDC request/proof、验证合约结果、交易哈希与回执摘要。
- 固定输入的失败路径：错 chain ID、无效地址、错 asset/contract、无 code、限额延迟、过期证据和交易失败。

**Confidential Compute Apps: 3/5**

Flare 已有官方 FCC 文档与 extension scaffold，也能在 Coston2 产生合约地址与交易。但当前官方开发指南的快速路径是“真 Coston2 + 本地模拟 TEE”，生产路径还涉及 GCP Confidential Space。指南同时要求 Docker、Foundry、Go、ngrok、有资金的 Coston2 钱包和需向 Flare 支持申请的 indexer 只读凭证。如果只交“真链 + 模拟 TEE”，容易与“不把 mock 说成 live”的高证据标准冲突。

### 4. 预计有效竞争

官方页面目前只有全赛事口径：168 Hacker、0 公开 BUIDL、4 奖位；没有每条赛道的注册数、有效提交数或历史转化率。因此：

- **Interoperable Asset Products: 2/5（低置信度）**：官方合格方向广，支付、dashboard、wallet、DeFi 和 portfolio 都可参赛，预计有效作品数更多。
- **Confidential Compute Apps: 3/5（低置信度）**：官方工具链门槛较高，可能减少数量，但留下的参赛者更可能是高质量工程团队。

这里不把 0 个公开 BUIDL 解读为“零竞争”，也不把 `4/168 = 2.38%` 解读为中奖率。

## 锁定的产品切口

**Cross-chain Asset Preflight & Receipt Guard**

锁定的核心路径：

```text
cross-chain asset/payment intent
  -> deterministic input + chain/address/asset validation
  -> live Flare registry/FAssets/FDC/FTSO evidence
  -> PASS / REVIEW / BLOCK + reason codes
  -> explicit human-controlled execution boundary
  -> post-execution FDC/onchain receipt verification
  -> auditable receipt digest + evidence bundle
```

首个用例应聚焦 FXRP/XRPL 而非同时横扫多链，因为 Flare 官方文档已提供：

- [FXRP 与 Coston2 测试获取路径](https://dev.flare.network/fxrp/overview)
- [FAssets 开发指南](https://dev.flare.network/fassets/developer-guides)
- [FAssets direct-mint 限额 preflight](https://dev.flare.network/fassets/developer-guides/fassets-direct-minting-limits)
- [FAssets direct-mint 失败/延迟路径](https://dev.flare.network/fassets/troubleshooting/direct-minting-troubleshooting)
- [FDC Payment](https://dev.flare.network/fdc/guides/hardhat/payment)
- [FDC AddressValidity](https://dev.flare.network/fdc/attestation-types/address-validity)
- [Coston2 RPC、chain ID、explorer 与 faucet](https://dev.flare.network/network/overview)

## 开发前的最小 spike（现已执行解锁）

用户于 2026-07-17 解除条款暂停后立即执行：

1. 对官方 Coston2 RPC 读 `eth_chainId`、最新 block number/hash，证明 chain ID 是 `114`。
2. 通过官方 Contract Registry 解析 `AssetManagerFXRP`，不硬编码候选地址。
3. 在同一 block tag 下读至少一组真实 FAssets 设置、direct-mint 限额状态或可用 agent 数据。
4. 将命令、原始 JSON-RPC 输出、UTC 时间、block hash、合约地址和可重跑校验写入证据文件。
5. 任何需要钱包、测试币、部署或写交易的下一步，先请用户确认。

最小 spike 若不能从官方测试环境读出一条真实 Flare/FAssets 数据，立即触发停止条件，不用 mock 继续包装项目。
