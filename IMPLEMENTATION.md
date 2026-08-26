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

2026-08-26にローカル環境から実OpenRouter APIで主要3経路を確認済み。

- 非streaming chat completion ✅
- SSE streaming ✅
- `GET /v1/models?provider=openrouter` ✅

非streaming確認時は `openrouter/free` が `minimax/minimax-m2.7:free` へ解決され、usageの `cost=0` まで正常に返った。

SSE確認時は `openrouter/free` が `cohere/north-mini-code:free` へ解決され、reasoning / content / usage / `data: [DONE]` まで正常にstreamされた。

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

### 実API E2E

2026-08-26にGoogle AI Studioで発行したFree Tier API keyを用いて主要3経路を確認済み。

- `GET /v1/models?provider=gemini` ✅
- 非streaming chat completion ✅
- SSE streaming ✅

`gemini-2.5-flash` はModels APIには列挙されたが、新規ユーザー向けchat completionではupstream 404となり、Gemini側が `gemini-3.6-flash` への移行を案内した。Free AI Poolはこのupstream status / detailsを正規化して返却できた。

`gemini-3.6-flash` では正常に `chat.completion` が返り、usageも取得できた。

SSEではcontentが複数chunkに分割され、Gemini固有の `extra_content.google.thought_signature` を保持したまま `finish_reason: stop` と `data: [DONE]` まで正常にstreamされた。

## Z.AI

Z.AIの無料Flashは最上位モデルの代替としてではなく、**無料で長時間回しやすい単純・大量タスク実行役**として使う。OpenRouter Free / Geminiが通常以上のタスクを担当し、Z.AI Flashには分類、変換、短い抽出、定型応答など、推論をほぼ必要としない処理を寄せる。

一般API Base URL:

```text
https://api.z.ai/api/paas/v4
```

Coding Plan / trial API Base URL:

```text
https://api.z.ai/api/coding/paas/v4
```

`ZAI_BASE_URL` で切り替える。一般APIとCoding APIを同じAdapterで扱い、quota種別をFree AI Pool内部の別Providerには分割しない。

現在実装済み:

- Z.AI Adapter
- `POST /v1/chat/completions`
- SSE streaming
- Bearer API key認証
- OpenRouter-native `provider: {...}` はZ.AIへforwardしない
- OpenRouter `reasoning.effort` をZ.AI `reasoning_effort` へそのまま変換
- `reasoning.enabled` をZ.AI `thinking.type` へ変換
- Z.AI `reasoning_content` をOpenRouter基準の `reasoning` へ正規化
- tool callのobject型argumentsをOpenAI/OpenRouter互換のJSON stringへ正規化
- Z.AIがnative `json_schema` を持たないため、`response_format.json_schema` は `json_object` + schema system instructionへ縮退
- request abortのupstream伝播
- mock tests追加

Z.AIの公式OpenAPIには現時点でModels list endpointが記載されていないため、`GET /v1/models?provider=zai` は実API仕様を確認してから追加する。手書きmodel catalogは持たない。

### 実API E2E

2026-08-26に一般API + 無料Flashで実確認した。

- `glm-4.7-flash` は最初のFree AI Pool経由リクエストで upstream `HTTP 429 / code 1305`（temporarily overloaded）を返した。Free AI Pool側のerror normalizationは正常に動作した。
- `glm-4.5-flash` をZ.AIへ直接、thinkingデフォルトで送ると成功したが、接続 `0.086s` に対して最初の応答まで `27.353s`。`zai-ok` を返すだけで `completion_tokens=283` の大半を `reasoning_content` に消費した。
- Free AI Pool経由で `reasoning.enabled=false` を指定すると、同じ定型応答が `completion_tokens=4` で高速に成功した ✅
- `glm-4.5-flash` + `reasoning.enabled=false` のSSE streamingも成功。`1`〜`5` が逐次chunkで返り、最終chunkにusage、最後に `data: [DONE]` まで到達した ✅

この実測から、**単純タスクではZ.AI Flashのthinking OFFを基本運用とする**。thinking ONは簡単な命令でも推論tokenと待ち時間が大きくなるため、明示的に必要な場合だけ使う。

恒常無料モデルとして `GLM-4.7-Flash` / `GLM-4.5-Flash` を候補とするが、混雑や一時的なoverloadは起こり得るため、無制限相当の無料枠と瞬間的な可用性は別問題として扱う。

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
3. ✅ `openrouter/free` で一本通す（実API非streaming / SSE / models確認済み）
4. ✅ `/v1/chat/completions` の最小版を公開
5. ✅ streaming / tool calling / structured outputのOpenRouter基準shapeを追加
6. ✅ `/v1/models` を追加
7. ✅ Gemini Adapter（実API models / 非streaming / SSE確認済み）
8. ✅ Z.AI Adapter（実API non-streaming / thinking OFF / SSE確認済み）
9. Groq Adapter
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
