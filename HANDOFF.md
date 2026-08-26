# Free AI Pool — Session Handoff

更新: 2026-08-26

## 最初に読むもの

次チャットでは、まずこの順で確認する。

1. `HANDOFF.md`（このファイル）
2. `IMPLEMENTATION.md`（実装仕様・Providerごとの詳細）
3. `PROJECT.md`（プロジェクト方針）
4. Draft PR #1: `Implement Free AI Pool v1 adapters and free-best`

作業branchは `feat/bootstrap`。PR #1 は `main` 向けDraft。

**branch上のコードを唯一の正とする。** 前チャット末尾ではGitHub blob作成など途中操作もあったが、未参照blob/treeはbranchの実装状態ではないので無視すること。

## 現在地

コード実装としての Free AI Pool v1 MVP はほぼ完成している。

対象Provider:

- OpenRouter
- Gemini
- Groq
- Z.AI
- Kilo Gateway
- Vercel AI Gateway

公開API:

```text
GET  /v1/models
POST /v1/chat/completions
```

Provider選択は原則header:

```http
X-Free-AI-Pool-Provider: openrouter
```

後方互換として文字列body `provider: "openrouter"` も受ける。

OpenRouter自身のnative `provider: {...}` objectと衝突させないことが重要。headerでOpenRouterを選び、bodyのobject型 `provider` はOpenRouterへそのままforwardする。他Providerにはforwardしない。

## 設計境界

v1では以下をしない。

- Provider間の自動routing
- Provider間の自動fallback
- 高度なquota scheduler
- embeddings
- image generation
- audio/TTS/transcription
- files/batch API

共通chat shapeはOpenRouter `/api/v1/chat/completions` 基準。snake_caseを維持する。

## 実装済み共通機能

- Node.js 24 / TypeScript / Fastify / Zod / Vitest
- strict typecheck
- Provider Adapter interface / registry
- chat completion
- SSE streaming + `data: [DONE]`
- Tool Calling
- Structured Output / `json_schema`
- Reasoning系field
- vision `image_url` request shape
- usage / finish_reason
- upstream error normalization
- request abort伝播
- `/v1/models?provider=...`
- `.env` のNode標準読み込み
- GitHub Actions: install / typecheck / test / build

最新functional implementationはCI成功済み。

## Provider status

### OpenRouter — 実装 + 実API E2E済み

Base URL:

```text
https://openrouter.ai/api/v1
```

確認済み:

- non-streaming ✅
- SSE ✅
- Models API ✅
- `openrouter/free` ✅
- usage `cost=0` ✅
- reasoning/content/usage/[DONE] ✅

実測例では `openrouter/free` が `minimax/minimax-m2.7:free` や `cohere/north-mini-code:free` に解決された。

### `free-best` — 実装済み

Free AI PoolのOpenRouter Adapter内部だけの仮想model ID。

Provider間routingではない。

選択ロジック:

1. OpenRouter Models APIを `sort=intelligence-high-to-low` で取得
2. requestから必要capabilityを抽出
3. `:free` modelのみ
4. prompt/completion価格0のみ
5. expiration済み除外
6. context不足除外
7. tools / structured output / reasoning / vision等の必要capabilityでfilter
8. intelligence順の最上位を選択
9. capability条件ごとに5分cache

eligible 0件なら暗黙fallbackせず503。

mock/CIは通過済み。必要なら実API E2Eを追加で確認する。

### Gemini — 実装 + 実API E2E済み

Base URL:

```text
https://generativelanguage.googleapis.com/v1beta/openai
```

確認済み:

- Models ✅
- non-streaming ✅
- SSE ✅
- Gemini固有 `extra_content.google.thought_signature` 保持 ✅

実APIでは `gemini-3.6-flash` で成功。

### Z.AI — 実装 + 実API E2E済み

General:

```text
https://api.z.ai/api/paas/v4
```

Coding Plan / trial:

```text
https://api.z.ai/api/coding/paas/v4
```

確認済み:

- non-streaming ✅
- reasoning ON/OFF ✅
- SSE ✅
- Tool Calling完全往復 ✅
- Structured Output縮退経路 ✅
- overload 429 normalization ✅

重要な運用方針:

`glm-4.5-flash` は **reasoning ONを通常運用** とする。

reasoning OFFは、非常に単純で決定的な処理の速度/token最適化用にだけ明示的に使う。

実測:

- reasoning ON: 単純な `zai-ok` でも completion 283 tokens / 約27秒
- reasoning OFF: completion 4 tokensまで低下し大幅高速化

Tool Calling実測では `add_numbers(17,25)` → tool result `42` → 最終assistant回答まで完走。

Z.AIは公式Models list endpointを確認できていないため、手書きmodel catalogは持たず `listModels` 未実装。

### Groq — 実装済み / mock+CI済み / 実API未確認

Base URL:

```text
https://api.groq.com/openai/v1
```

実装済み:

- chat / SSE / Models
- Bearer auth
- Tool Calling / Structured Output
- OpenRouter native `provider` 除去
- Groq非対応 `messages[].name` 除去
- GPT-OSS reasoning `low/medium/high`
- Qwen reasoning `none/default`
- OpenRouter側の `max/xhigh/minimal` をGroqの安全な値へ丸める

次の実API確認候補:

```text
openai/gpt-oss-120b
```

`.env`:

```text
GROQ_API_KEY=...
GROQ_BASE_URL=https://api.groq.com/openai/v1
```

### Kilo Gateway — 実装済み / mock+CI済み / 実API未確認

Base URL:

```text
https://api.kilo.ai/api/gateway
```

実装済み:

- chat / SSE / Models
- free modelはAPI keyなしでも利用できるためAdapter常時registry登録
- keyがある場合はBearer auth
- Tool Calling / `response_format` 等を透過
- OpenRouter native `provider`, `reasoning`, `include_reasoning` はKiloへ送らない
- message内reasoning traceも送らない
- `developer` role -> `system`

候補:

```text
kilo-auto/free
openrouter/free
```

`.env`:

```text
KILO_API_KEY=
KILO_BASE_URL=https://api.kilo.ai/api/gateway
```

匿名free E2Eを最初に試す。API keyは必須ではない。

### Vercel AI Gateway — 実装済み / mock+CI済み / 実API未確認

Base URL:

```text
https://ai-gateway.vercel.sh/v1
```

実装済み:

- chat / SSE / Models
- Bearer auth
- Tool Calling / Structured Output
- baseline `reasoning` を透過
- `providerOptions` 等のVercel固有extension passthrough
- OpenRouter native `provider` objectだけ除去

`.env`:

```text
VERCEL_AI_GATEWAY_API_KEY=...
VERCEL_AI_GATEWAY_BASE_URL=https://ai-gateway.vercel.sh/v1
```

## 次チャットの作業順

### 1. ローカルを同期

PowerShell:

```powershell
git checkout feat/bootstrap
git pull
npm install
npm run dev
```

サーバは通常:

```text
http://127.0.0.1:8787
```

### 2. Groq real E2E

まずmodels:

```powershell
$models=Invoke-RestMethod -Uri "http://127.0.0.1:8787/v1/models?provider=groq" -Method Get
$models.data | Select-Object id,provider,owned_by | Format-Table
```

その後 `openai/gpt-oss-120b` でnon-streaming → SSE → Tool Calling → Structured Outputの順に確認する。

reasoningはまず `high` を使う。

### 3. Kilo anonymous real E2E

API keyなしでmodels/chatを確認する。

候補modelは `kilo-auto/free`。

成功したらSSEも確認する。

### 4. Vercel real E2E

API key設定後、models → non-streaming → SSEを確認。

必要ならTool Calling / Structured Outputも1本ずつ実確認する。

### 5. `free-best` real E2E

OpenRouterで `model="free-best"` を送り、実modelへの置換・capability filter・responseが正常か確認する。

Tool付きrequestでも1本確認するとよい。

### 6. Hermes Agent / n8n最終E2E

ここまで通ったら、OpenAI-compatible clientとして以下を設定してAgentから実利用する。

```text
Base URL: http://127.0.0.1:8787/v1
```

Provider選択header `X-Free-AI-Pool-Provider` をクライアント側で付与できるか確認する。

付与できないクライアントではlegacy body providerの利用可否も検討する。

## PowerShellでの注意

Windows PowerShellでnative `curl.exe` にJSON文字列を直接 `--data-raw` するとquote崩れを起こした実績がある。

SSEはこの形式を使うと安定する。

```powershell
@{model="...";messages=@(@{role="user";content="..."});stream=$true} | ConvertTo-Json -Depth 20 -Compress | curl.exe -N -X POST "http://127.0.0.1:8787/v1/chat/completions" -H "Content-Type: application/json" -H "X-Free-AI-Pool-Provider: groq" --data-binary "@-"
```

通常completionは `Invoke-RestMethod` でよい。

API keyはチャットへ貼らない。`.env` から読む。

## 直近で確認したZ.AI Tool Calling

1ターン目:

- model: `glm-4.5-flash`
- reasoning ON
- `add_numbers(17,25)`
- `tool_calls[].function.arguments` がJSON stringで返却

2ターン目:

- assistant tool_callを履歴へ戻す
- `role=tool`, `tool_call_id`, `content="42"`
- 最終回答 `The result of 17 + 25 is 42.`

Structured Outputも `json_schema` -> Z.AI `json_object + schema instruction` の縮退経路で期待schemaどおり成功済み。

## 完了判定

コード実装はMVP完成扱い。

残りは主に外部検証:

- Groq real E2E
- Kilo real E2E
- Vercel real E2E
- `free-best` real E2E（推奨）
- Hermes Agent / n8n client E2E

これらが通ったらPR #1をDraft解除・最終review・merge候補にする。
