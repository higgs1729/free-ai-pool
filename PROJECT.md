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

Free AI PoolのHTTP APIではupstream選択を原則headerで明示する。

```http
X-Free-AI-Pool-Provider: openrouter
```

OpenRouter自身がbodyの `provider: {...}` をnative routing設定に利用するため、Free AI Pool側は同名fieldを恒久的に占有しない。

後方互換として文字列body `provider: "openrouter"` も当面受理する。

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

- Freeモデルを複数利用可能
- `openrouter/free` で利用可能な無料モデルへOpenRouter内部routing
- v1の基準実装
- OpenRouter Models APIをmodel metadataの基準にする

2026-08-26にFree AI Pool経由の実API非streaming E2Eまで成功。確認時は `openrouter/free` が `minimax/minimax-m2.7:free` へ解決され、usageの `cost=0` も確認した。

### 2. Gemini API

Antigravity専用ではなく、通常のGemini Developer APIとして利用する。

- API keyで直接利用可能
- 公式OpenAI compatibility APIあり
- Tool Calling対応
- Structured Output対応
- Streaming対応
- Models API対応
- Flash系にFree Tierあり

2026-08-26時点でGemini Adapterを実装済み。公式OpenAI compatibility endpointを利用し、OpenRouter baseline shapeとの差分だけAdapterで吸収する。mock tests / typecheck / buildは通過済み。実API E2Eは次に確認する。

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

Vercelは「無料モデル」ではなく、

> 毎月補充される少額の商用モデル用計算資源

として扱う。

## 設計原則

### Provider固有処理を上位へ漏らさない

```text
Agent
  ↓
Common LLM Client
  ↓
Free AI Pool
  ↓
Provider Adapter
  ├─ OpenRouter
  ├─ Gemini
  ├─ Groq
  ├─ Z.AI
  ├─ Kilo
  └─ Vercel
```

Provider差分は可能な限りAdapterへ閉じ込める。

共通chat request / responseの基準shapeはOpenRouter `/api/v1/chat/completions` とし、OpenRouter互換field名はsnake_caseのまま維持する。

推奨例:

```http
X-Free-AI-Pool-Provider: openrouter
Content-Type: application/json
```

```json
{
  "model": "openrouter/free",
  "messages": [
    { "role": "user", "content": "hello" }
  ],
  "max_tokens": 1024,
  "tool_choice": "auto"
}
```

OpenRouterへ送る場合、bodyのnative `provider: {...}` routing objectも保持できる。

他Provider側の差異はAdapterでOpenRouter基準shapeとの間を変換する。

### OpenAI互換を積極利用する

Gemini、Groq、Z.AI、Kilo、Vercelなど、OpenAI互換APIが利用できるProviderではその互換endpointを優先する。

ただしProvider固有機能を共通型へ無理に押し込まない。

### モデル名はupstream native IDを使う

例:

```text
openrouter/free
gemini-3.7-flash
<groq-native-model-id>
```

無料モデルが終了・変更されてもProvider Adapter本体を大きく修正しない設計を優先する。

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

## 現在の実装進捗

1. ✅ プロジェクトの最小構成
2. ✅ 共通LLM interface / OpenRouter baseline型
3. ✅ Provider registry / config
4. ✅ OpenRouter Adapter
5. ✅ `/v1/chat/completions`
6. ✅ SSE streaming
7. ✅ `/v1/models`
8. ✅ OpenRouter実API非streaming E2E
9. ✅ OpenRouter native `provider` fieldとのrouting衝突解消
10. ✅ Gemini Adapter（mock/CI）
11. ⏳ OpenRouter実API SSE / Models確認
12. ⏳ Gemini実API E2E
13. Groq Adapter
14. Z.AI Adapter
15. Kilo Adapter
16. Vercel Adapter

重要なのは、6 Providerを一気に高度に統合しないこと。

まず各Providerで一本通し、

```text
upstream指定 + model IDを変更するだけで別APIも動く
```

状態を作る。

## 今後確認する項目

- 各ProviderでTool Callingの形式差がどこまで存在するか
- Structured Outputの互換性
- Streaming差異
- Reasoning設定差異
- 各無料枠の実効rate limit
- Vercel $5 Free creditsの実利用範囲
- 各ProviderでAgent workloadをどれだけ処理できるか
- 無料モデルの品質比較

## 判断基準

このプロジェクトは「無料資源を隅から隅まで回収する」ことが目的ではない。

追加Providerの判断基準は、

> 得られるAI計算資源の価値 > 統合・保守コスト

とする。

面倒な認証、特殊な専用環境、小さすぎる無料枠などは、無料でも積極的に採用しない。

新しいProviderは簡単に追加・削除できる構造を優先する。

## Layer 1 定義

OpenRouterに近い共通AIリクエスト形式を受け取り、リクエストで明示された6つのupstreamのいずれかへ、Provider Adapterを介して透過的に転送し、応答を共通形式へ正規化する。Providerの自動選択は行わない。
