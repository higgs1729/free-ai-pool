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
- リクエスト側が `provider` と `model` を明示する。
- Free AI Pool側はProviderを自動選択しない。
- Provider間の自動fallbackもv1では行わない。
- upstream内部のroutingはそのupstreamへ任せる。
- OpenRouterを基準実装とし、他ProviderはOpenRouterとの差分をAdapterで吸収する。
- model IDは可能な限りupstream native IDをそのまま使う。

例:

```json
{
  "provider": "openrouter",
  "model": "openrouter/free"
}
```

```json
{
  "provider": "gemini",
  "model": "<gemini-model-id>"
}
```

## OpenRouter Free

最初に実装する。

`openrouter/free` はOpenRouter自身が現在利用可能な無料モデルへroutingするため、その内部選択はOpenRouterへ任せる。

Free AI Pool側のProvider自動選択とは別物なので、Layer 1の原則には反しない。

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

1. 共通request / response型を定義
2. OpenRouter Adapterを実装
3. `openrouter/free` で一本通す
4. `/v1/chat/completions` の最小版を公開
5. streaming / tool calling / structured outputを追加
6. `/v1/models` を追加
7. Gemini Adapter
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
