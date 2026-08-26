# Free AI Pool — Implementation Handoff

更新: 2026-08-26

## 目的

複数の無料・低コストLLM APIを、OpenAI互換クライアントから共通形式で利用できるようにする。

最初の利用先は Hermes Agent / n8n LLM Agent。将来は VS Code / Orca などからも利用する。

## Layer 1

> OpenRouterに近い共通AIリクエスト形式を受け取り、リクエストで明示された6つのupstreamのいずれかへ、Provider Adapterを介して透過的に転送し、応答を共通形式へ正規化する。Providerの自動選択は行わない。

対象upstream:

- OpenRouter
- Gemini
- Groq
- Z.AI
- Kilo Gateway
- Vercel AI Gateway

### 重要な設計判断

- 6 Providerは統合せず、それぞれ独立upstreamとして扱う。
- Gemini / Groq等をOpenRouter BYOKへまとめない。
- Free AI Pool側はProviderを自動選択しない。
- Provider間の自動fallbackもv1では行わない。
- upstream内部のroutingはそのupstreamへ任せる。
- OpenRouterを基準実装とし、他ProviderはOpenRouterとの差分をAdapterで吸収する。
- model IDは可能な限りupstream native IDをそのまま使う。
- 共通chat型のfield名・shapeはOpenRouter `/api/v1/chat/completions` を基準にする。
- `tool_calls`, `tool_call_id`, `response_format`, `json_schema`, `reasoning_details`, `max_tokens`, `prompt_tokens` 等はOpenRouter nativeのsnake_caseを維持する。
- `GET /v1/models` は引数なしではOpenRouter Models APIを基準とし、他Providerを明示する場合のみ `?provider=...` をFree AI Pool拡張として使う。

### Provider選択のtransport

OpenRouter自身がchat requestのトップレベル `provider: {...}` を内部routing設定として利用するため、Free AI Poolのupstream選択で同名fieldを占有しない。

推奨:

```http
X-Free-AI-Pool-Provider: openrouter
```

bodyはOpenRouter-native shapeを維持する。

```json
{
  "model": "openrouter/free",
  "messages": [
    { "role": "user", "content": "hello" }
  ]
}
```

後方互換のため、従来の文字列body routingも当面受理する。

```json
{
  "provider": "openrouter",
  "model": "openrouter/free",
  "messages": [
    { "role": "user", "content": "hello" }
  ]
}
```

この場合の文字列 `provider` はAdapterへ渡す前に除去する。

一方、headerでpool upstreamを選択してbodyにOpenRouter-native `provider: {...}` を渡した場合、そのobjectはそのままOpenRouterへforwardする。

## OpenRouter Free

`openrouter/free` はOpenRouter自身が現在利用可能な無料モデルへroutingするため、その内部選択はOpenRouterへ任せる。

Free AI Pool側のProvider自動選択とは別物なので、Layer 1の原則には反しない。

### 現在の実装状況

`feat/bootstrap` / PR #1 で以下まで実装済み。

- TypeScript / Fastifyの最小サービス
- OpenRouter基準の共通chat request / response型
- Provider Adapter interface / registry
- OpenRouter Adapter
- `POST /v1/chat/completions`
- `openrouter/free` の非streaming pass-through
- SSE streaming pass-through
- Tool Calling request shape
- Structured Output (`response_format.json_schema`) request shape
- Reasoning (`reasoning`, `reasoning_details`) request / response shape
- visionの `image_url` input shape
- `GET /v1/models`
- OpenRouter Models API metadata / query parameter pass-through
- upstream error normalization
- request abortのupstream伝播
- `X-Free-AI-Pool-Provider` routing
- OpenRouter-native `provider: {...}` routing objectのpass-through
- CI: typecheck / tests / build

`/v1/models` ではOpenRouterのmodel metadataを維持し、各modelへFree AI Poolの `provider` fieldのみ追加する。`supported_parameters`, `output_modalities`, `sort` 等のOpenRouter query parameterはupstreamへ透過する。

### 実API E2E

2026-08-26にローカル環境から実OpenRouter APIで非streaming E2E成功。

経路:

```text
PowerShell
  -> Free AI Pool localhost
  -> OpenRouter Adapter
  -> OpenRouter
  -> openrouter/free
  -> resolved free model
```

確認時は `openrouter/free` が `minimax/minimax-m2.7:free` へ解決され、usageの `cost=0` まで正常に返った。

実OpenRouterでのSSEとModels endpoint確認は継続する。

### 将来候補: `free-best`

OpenRouter公式Models APIから無料モデル一覧を機械取得できる。

将来的に仮想モデル `free-best` を追加し、以下のような条件で現在の有力無料モデルを自動導出する案を残す。

- `:free` variant
- input/output pricingが0
- 必要capabilityを満たす
- expirationしていない
- intelligence順等で選択

手書きの無料モデル台帳は持たない。

`free-best` はOpenRouter Adapter内の補助機能として扱い、6 Provider間の自動routingにはしない。

## Gemini

Gemini Developer APIの公式OpenAI compatibility endpointを利用する。

Base URL:

```text
https://generativelanguage.googleapis.com/v1beta/openai
```

現在実装済み:

- Gemini Adapter
- `POST /v1/chat/completions`
- SSE streaming
- Tool Calling / Structured OutputのOpenAI-compatible shape pass-through
- vision `image_url` shape
- `GET /v1/models`
- Bearer API key認証
- OpenRouter baseline `reasoning.effort` -> Gemini `reasoning_effort` 変換
  - `minimal/low/medium/high/none` は同値
  - OpenRouter側の `max/xhigh` はGemini側では `high` へ丸める
- OpenRouter固有のnative `provider: {...}` routing objectはGeminiへはforwardしない
- mock tests / typecheck / build成功

Gemini固有の `extra_body.google.*` 等は、必要になった時点でprovider-specific pass-throughとして扱う。Provider固有機能を共通型へ無理に押し込まない。

実Gemini API keyでのE2Eは未確認。

## Layer 2 — OpenAI-compatible API

Layer 1の上にOpenAI互換endpointを公開する。

MVP:

```text
GET  /v1/models
POST /v1/chat/completions
```

最低限対応するもの:

- model
- messages
- streaming / SSE
- tool calling
- tool_choice
- structured output
- reasoning系パラメータは共通化可能な範囲で対応
- temperature
- max_tokens系
- finish_reason
- usage
- error normalization
- vision入力は対応可能なら含める

Provider固有機能は無理に完全抽象化しない。

## 実装順

1. ✅ 共通request / response型を定義
2. ✅ OpenRouter Adapterを実装
3. ✅ `openrouter/free` で一本通す（実API非streaming E2Eまで確認済み）
4. ✅ `/v1/chat/completions` の最小版を公開
5. ✅ streaming / tool calling / structured outputのOpenRouter基準shapeを追加
6. ✅ `/v1/models` を追加
7. ✅ Gemini Adapter（mock/CI。実API E2E待ち）
8. Groq Adapter
9. Z.AI Adapter
10. Kilo Adapter
11. Vercel Adapter
12. `free-best` を実装
13. Hermes / n8nからE2E確認

ここまでを **「LLM Agent用途のOpenAI互換API MVP完成」** とする。

## v1完成条件に含めないもの

以下はOpenRouter側に存在する機能もあるが、Agent Codingの最初の価値には不要なので後回しにする。

- Embeddings
- Image generation
- Audio / TTS / transcription
- Files API
- Batch API

必要になった時点でLayer 2へ追加する。

## 非目標

v1では以下を実装しない。

- 6 Provider間の自動モデル選択
- Provider間の自動fallback
- quota最適化Router
- タスク分類Router
- 全Provider機能の完全な共通化

必要なら将来、Layer 1の上に別のAuto Selectorを追加する。
