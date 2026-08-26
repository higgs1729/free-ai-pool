# Free AI Pool — Implementation Handoff

更新: 2026-08-26

## 目的

複数の無料・低コストLLM APIを、OpenAI互換クライアントから共通形式で利用できる軽量Gatewayにする。

最初の利用先は Hermes Agent / n8n LLM Agent。将来は VS Code / Orca 等からも利用する。

## v1の境界

対象upstreamは6つ。

- OpenRouter
- Gemini
- Groq
- Z.AI
- Kilo Gateway
- Vercel AI Gateway

Free AI Pool自身は **Provider間の自動選択・自動fallbackをしない**。upstreamはリクエストごとに明示する。

推奨transport:

```http
X-Free-AI-Pool-Provider: openrouter
```

後方互換として文字列body `provider: "openrouter"` も受理する。

OpenRouter自身がトップレベル `provider: {...}` をnative routing設定として使うため、headerでpool upstreamを指定した場合のobject型 `provider` はOpenRouterへそのままforwardする。他Providerへはforwardしない。

## 共通API

```text
GET  /v1/models
POST /v1/chat/completions
```

共通chat shapeはOpenRouter `/api/v1/chat/completions` を基準とし、snake_caseを維持する。

主な対応field:

- `model`
- `messages`
- `stream`
- `temperature`, `top_p`, `max_tokens`, `stop`, `seed`
- `frequency_penalty`, `presence_penalty`
- `tools`, `tool_choice`, `parallel_tool_calls`
- `response_format` / `json_schema`
- `reasoning`, `reasoning_details`, `include_reasoning`
- vision `image_url`
- `finish_reason`, `usage`

Provider固有機能は無理に共通型へ押し込まず、OpenRouter baselineとの差分だけ各Adapterで吸収する。

## 実装済み共通基盤

- Node.js 24 / TypeScript / Fastify / Zod / Vitest
- strict TypeScript
- Provider Adapter interface / registry
- Provider request abortのupstream伝播
- upstream error normalization
- SSE pass-through + `data: [DONE]`
- `/v1/models?provider=...`
- `.env` のNode標準読み込み
- GitHub Actions: install / typecheck / test / build

## Provider status

### OpenRouter

Base URL:

```text
https://openrouter.ai/api/v1
```

実装:

- chat completion
- SSE
- Models API query/metadata pass-through
- Tool Calling / Structured Output / Reasoning / vision
- native `provider: {...}` routing保持
- optional `HTTP-Referer`, `X-Title`
- `openrouter/free`
- Free AI Pool仮想モデル `free-best`

実API E2E済み:

- non-streaming ✅
- SSE ✅
- `/v1/models` ✅

実測では `openrouter/free` が無料モデルへ解決され、`cost=0`、reasoning/content/usage/[DONE] まで確認済み。

### `free-best`

`free-best` は **OpenRouter Adapter内部だけの仮想model ID**。Provider間の自動routingではない。

```json
{
  "model": "free-best",
  "messages": [{"role":"user","content":"..."}]
}
```

選択手順:

1. OpenRouter Models APIを `sort=intelligence-high-to-low` で取得
2. requestから必要capabilityを抽出
3. 実model IDが `:free`
4. prompt/completion価格が0
5. expiration済みでない
6. context長が不足しない
7. tools / structured output / reasoning / vision等の必要capabilityを満たす
8. intelligence順で最初のeligible modelを採用
9. capability条件ごとに5分cache

eligible modelが0件なら暗黙fallbackせず503を返す。

### Gemini

Base URL:

```text
https://generativelanguage.googleapis.com/v1beta/openai
```

実装:

- chat / SSE / Models
- Tool Calling / Structured Output / vision
- Bearer API key
- `reasoning.effort` 差分吸収
- Gemini固有response fieldを保持

実API E2E済み:

- Models ✅
- non-streaming ✅
- SSE ✅

`gemini-3.6-flash` で成功。Models APIには載るが新規ユーザーでは使えない旧modelの404もupstream details付きで正規化できた。

### Z.AI

General Base URL:

```text
https://api.z.ai/api/paas/v4
```

Coding Plan / trial:

```text
https://api.z.ai/api/coding/paas/v4
```

実装:

- chat / SSE
- Bearer API key
- `reasoning.effort` -> `reasoning_effort`
- `reasoning.enabled` -> `thinking.type`
- `reasoning_content` -> baseline `reasoning`
- tool argumentsをJSON stringへ正規化
- `json_schema` を `json_object + schema system instruction` へ縮退
- upstream error normalization

Models listは公式仕様を確認できていないため手書きcatalogを持たず、`listModels` は未実装。

実API E2E済み:

- non-streaming ✅
- reasoning ON/OFF ✅
- SSE ✅
- Tool Calling完全往復 ✅
- Structured Output縮退経路 ✅
- overload 429 normalization ✅

`glm-4.5-flash` は通常 **reasoning ON** を基本運用とする。OFFは非常に単純な処理の速度/token最適化用。

実測では単純応答が reasoning ON で completion 283 tokens / 約27秒、OFFで4 tokensまで低下した。

### Groq

Base URL:

```text
https://api.groq.com/openai/v1
```

実装:

- chat / SSE / Models
- Bearer API key
- Tool Calling / Structured Output
- OpenRouter native `provider` を除去
- Groq非対応 `messages[].name` を除去
- GPT-OSS reasoning: `low/medium/high`
- Qwen reasoning: `none/default`
- OpenRouterの `max/xhigh/minimal` を安全なGroq値へ丸める

mock tests / typecheck / build ✅

実API E2EはAPI keyを設定したローカル環境で未確認。

### Kilo Gateway

Base URL:

```text
https://api.kilo.ai/api/gateway
```

実装:

- chat / SSE / Models
- Free modelsはAPI keyなしでも利用できるため、Kilo Adapterは常時registryへ登録
- key設定時はBearer auth
- Tool Calling / `response_format` 等のOpenAI-compatible fieldを透過
- OpenRouter native `provider`, `reasoning`, `include_reasoning` はKiloへ送らない
- message内のreasoning traceも送らない
- `developer` roleは互換性のため `system` へ変換

候補model:

- `kilo-auto/free`
- `openrouter/free`
- Kilo catalog内の各 `:free` model

mock tests / typecheck / build ✅

匿名free実API E2Eはローカルから未確認。

### Vercel AI Gateway

Base URL:

```text
https://ai-gateway.vercel.sh/v1
```

実装:

- chat / SSE / Models
- Bearer API key
- Tool Calling / Structured Output
- baseline `reasoning` をそのまま透過
- `providerOptions` 等Vercel固有top-level extensionはpassthrough
- OpenRouter native `provider` objectだけ除去

mock tests / typecheck / build ✅

実API E2EはAPI keyを設定したローカル環境で未確認。

## CI状態

2026-08-26、6 Provider + `free-best` を含む最新functional commitで以下すべて成功。

```text
Install dependencies ✅
Typecheck            ✅
Test                 ✅
Build                ✅
```

## v1実装順

1. ✅ Common request / response type
2. ✅ OpenRouter Adapter
3. ✅ OpenRouter real E2E
4. ✅ `/v1/chat/completions`
5. ✅ SSE / tools / structured output / reasoning baseline
6. ✅ `/v1/models`
7. ✅ Gemini Adapter + real E2E
8. ✅ Z.AI Adapter + real E2E
9. ✅ Groq Adapter + mock/CI
10. ✅ Kilo Adapter + mock/CI
11. ✅ Vercel Adapter + mock/CI
12. ✅ `free-best`
13. ⏳ Groq / Kilo / Vercel real API E2E
14. ⏳ Hermes Agent / n8nからの最終E2E

コード実装としてのLayer 1 / Layer 2 MVPは完成。残りは外部credential/clientを使う実接続確認。

## v1完成条件に含めないもの

- Embeddings
- Image generation
- Audio / TTS / transcription
- Files API
- Batch API
- Provider間自動routing
- Provider間自動fallback
- 高度なquota scheduler

必要になった時点で追加する。
