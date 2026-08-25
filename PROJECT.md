# Free AI Pool — Project Context

更新: 2026-08-26

## 目的

複数の無料・低コストLLM APIを、利用側が各Provider固有仕様を意識せず切り替えて使える軽量な統合システムを作る。

将来的には学校のチーム開発でも利用できるようにし、ChatGPTへコードを貼り付けるだけの使い方ではなく、Agentから直接利用できる共通AI基盤にする。

ただしv1では作り込みすぎない。

## 基本方針

利用側からはProviderを「モデル選択」のように切り替える。

```text
Backend
├─ OpenRouter Free
├─ Gemini
├─ Groq
├─ Z.AI
├─ Kilo
└─ Vercel
```

Agent側は可能な限り、

```ts
provider = "openrouter"
provider = "gemini"
provider = "groq"
```

程度の変更だけで動作するようにする。

### v1ではやらないこと

- 自動モデルルーティング
- Provider間の自動fallback
- 高度なquota最適化
- タスク分類によるモデル自動選択
- 全Provider差異の完全な抽象化
- 大規模なGateway実装

必要になった時点で追加する。

## 初期採用Provider

以下の6系統で開始する。

### 1. OpenRouter Free

既に利用中。

- 累計$10以上credits購入済み
- Freeモデル: 最大1,000 requests/day
- 複数の無料モデルを利用可能
- 現在OxAlpha等の比較的高性能な無料モデルが存在
- v1の基準となる使用感

OpenRouterへ$100以上入れても、Freeモデルの日次枠が1,000 requests/dayからさらに増える制度は現時点では確認されていない。

### 2. Gemini API

Antigravity専用ではなく、通常のGemini Developer APIとして利用可能。

- API keyで直接利用可能
- OpenAI互換APIあり
- Tool Calling対応
- Structured Output対応
- Streaming対応
- Gemini Flash系にFree Tierあり

OpenRouterとは独立した無料資源として重要。

### 3. Groq Free

独立した無料API枠。

候補モデル例:

- GPT-OSS-120B
- Qwen系

特徴:

- OpenAI互換
- 非常に高速
- Tool Calling対応
- Request/dayだけでなくtoken/day制限にも注意

軽量Agent/Subagent用途にも適する。

### 4. Z.AI Free

GLM系の独立した無料API。

候補:

- GLM-4.7-Flash

特徴:

- 無料
- OpenAI SDK互換
- Tool Calling対応
- Structured Output対応
- Agentic Coding用途を想定

### 5. Kilo Gateway

OpenRouterとは別の無料Gatewayとして採用。

無料モデル例:

- StepFun Step 3.7 Flash
- Poolside Laguna S 2.1
- Poolside Laguna XS 2.1
- NVIDIA Nemotron 3 Ultra 550B
- Tencent HY3
- `kilo-auto/free`
- `openrouter/free`

OpenRouterと無料モデル集合は同一ではない。

無料枠は現時点で概ね:

```text
200 requests/hour/IP
```

理論上は最大4,800 requests/day相当だが、上流Provider側の制限もあるため保証値としては扱わない。

OpenRouterのように「一定額課金するとFree枠増加」という制度は現時点では確認されていない。

役割:

> OpenRouterとは別の大きな無料推論プール。

### 6. Vercel AI Gateway

Free Tierで毎月AI Gateway creditsが付与される。

現時点:

```text
$5 / 30 days
```

特徴:

- Gateway形式
- 多数の商用モデルを利用可能
- OpenAI系APIとの互換性が高い
- GPT-5.6 Lunaもモデルカタログに存在

Lunaは非常に低価格なので、$5でもAgent用途ではかなりの量を処理できる可能性がある。

ただし、

> Free Tierの$5 creditsでLunaを常時利用可能か

については実APIで最終確認する価値がある。

Vercelは「無料モデル」ではなく、

> 毎月補充される少額の商用モデル用計算資源

として扱う。

## 設計原則

### Provider固有処理を上位へ漏らさない

理想:

```text
Agent
  ↓
Common LLM Client
  ↓
Provider Config
  ├─ OpenRouter
  ├─ Gemini
  ├─ Groq
  ├─ Z.AI
  ├─ Kilo
  └─ Vercel
```

Provider差分は可能な限り、

```ts
{
  baseURL,
  apiKey,
  model
}
```

程度に閉じ込める。

### OpenAI互換を積極利用する

Gemini、Groq、Z.AI、Kilo、Vercelなど、OpenAI互換APIが利用できるProviderでは共通clientを再利用する。

ただし内部設計そのものをOpenAI仕様へ完全依存させる必要はない。

### モデル名は設定側へ置く

例:

```ts
providers = {
  openrouter: {
    model: "...:free"
  },
  gemini: {
    model: "gemini-..."
  },
  groq: {
    model: "..."
  }
}
```

無料モデルが終了・変更されてもAgent本体を修正しない。

## 将来的なチーム利用

学校の5人程度のチーム開発で利用する可能性がある。

最初は所有者のAPI資源だけでも十分な可能性があるため、メンバー全員へ複雑なAPIキー管理を要求しない。

将来的には各メンバー自身のOpenRouter等のキーを追加することも可能。

さらにDockerで環境をまとめ、

```text
git clone
↓
.env にAPI key
↓
docker compose up
```

程度でAgent環境を利用できる形を目指せる。

ただしDocker対応はv1の最優先事項ではない。

## 次に行うこと

### v1

1. プロジェクトの最小構成を決める
2. 共通LLM clientのinterfaceを決める
3. Provider設定形式を決める
4. OpenRouter Freeを最初に実装
5. Geminiを追加
6. Groqを追加
7. Z.AIを追加
8. Kiloを追加
9. Vercelを追加

重要なのは、6 Providerを一気に高度に統合しないこと。

まずOpenRouterで一本通し、

```text
provider設定を変更するだけで別APIも動く
```

状態を作る。

## 今後確認する項目

- 各ProviderでTool Callingの形式差がどこまで存在するか
- Structured Outputの互換性
- Streaming差異
- Reasoning設定差異
- 各無料枠の実効rate limit
- Vercel $5 Free creditsでLunaが実際に利用可能か
- 各ProviderでAgent workloadをどれだけ処理できるか
- 無料モデルの品質比較

## 判断基準

このプロジェクトは「無料資源を隅から隅まで回収する」ことが目的ではない。

追加Providerの判断基準は、

> 得られるAI計算資源の価値 > 統合・保守コスト

とする。

面倒な認証、特殊な専用環境、小さすぎる無料枠などは、無料でも積極的に採用しない。

新しいProviderは簡単に追加・削除できる構造を優先する。
