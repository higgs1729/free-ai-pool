# Free AI Pool — Agent E2E Test Plan

更新: 2026-08-26

## 目的

Free AI Pool v1 のコード実装は完了している。
この文書は、ローカル実行権限を持つコーディングエージェントが、残っている実API E2Eを自律的に実行し、失敗時は原因を切り分け、必要なら最小修正まで行えるようにするための実行方針である。

正本:

- branch: `feat/bootstrap`
- Draft PR #1: `Implement Free AI Pool v1 adapters and free-best`
- 実装仕様: `IMPLEMENTATION.md`
- プロジェクト方針: `PROJECT.md`

**branch上のコードを唯一の正とする。**

## エージェントへの基本指示

1. `feat/bootstrap` をcheckoutして最新化する。
2. `.env` のAPI keyは読み取って利用してよいが、標準出力・ログ・GitHub・チャットへ値を絶対に出さない。
3. 既存のmock testを先に確認し、実装意図を理解してからreal E2Eを行う。
4. 外部Providerの現在のmodel catalogは変化し得る。固定modelが消えている場合は `/v1/models?provider=...` の実結果から同等候補を選ぶ。
5. テストのためだけにProvider間自動routing/fallbackを追加しない。v1の境界を守る。
6. 失敗時は「Free AI Pool実装のbug」「credential/config」「upstream仕様変更」「quota/rate limit」「一時障害」を切り分ける。
7. upstreamの一時障害やquota不足を、無理にコード修正で隠さない。
8. コード変更が必要な場合は最小修正に留め、`npm run typecheck` / `npm test` / `npm run build` を必ず通す。
9. 成功・失敗結果は秘密情報を含めず、最後に簡潔なE2E結果表としてまとめる。

## 初期化

PowerShell想定:

```powershell
cd C:\dev\free-ai-pool
git checkout feat/bootstrap
git pull
npm install
npm run typecheck
npm test
npm run build
```

その後サーバを起動:

```powershell
npm run dev
```

通常:

```text
http://127.0.0.1:8787
```

別terminalからE2Eを実行する。

## 完了済みProvider

以下はreal E2E済みなので、回帰確認が必要な場合を除き優先度は低い。

- OpenRouter: Models / non-streaming / SSE ✅
- Gemini: Models / non-streaming / SSE ✅
- Z.AI: non-streaming / reasoning ON/OFF / SSE / Tool Calling往復 / Structured Output ✅

## 残タスクの優先順

1. Groq real E2E
2. Kilo anonymous real E2E
3. Vercel AI Gateway real E2E
4. OpenRouter `free-best` real E2E
5. Hermes Agent / n8n client E2E

---

# 1. Groq real E2E

## 前提

`.env`:

```text
GROQ_API_KEY=...
GROQ_BASE_URL=https://api.groq.com/openai/v1
```

API keyが未設定なら「credential不足」として記録し、Kiloへ進む。値そのものは出力しない。

## 1-A. Models

```powershell
$models = Invoke-RestMethod `
  -Uri "http://127.0.0.1:8787/v1/models?provider=groq" `
  -Method Get

$models.data | Select-Object id,provider,owned_by | Format-Table
```

期待:

- HTTP 200
- `data` が配列
- 各modelに `provider = "groq"`

第一候補:

```text
openai/gpt-oss-120b
```

存在しなければ、現在のModels出力からTool Calling / Structured Output対応の汎用chat modelを選ぶ。

## 1-B. non-streaming + reasoning

```powershell
$body = @{
  model = "openai/gpt-oss-120b"
  messages = @(
    @{ role = "user"; content = "Reply with exactly: groq-ok" }
  )
  reasoning = @{ effort = "high" }
} | ConvertTo-Json -Depth 20

$r = Invoke-RestMethod `
  -Uri "http://127.0.0.1:8787/v1/chat/completions" `
  -Method Post `
  -Headers @{ "X-Free-AI-Pool-Provider" = "groq" } `
  -ContentType "application/json" `
  -Body $body

$r | ConvertTo-Json -Depth 20
```

期待:

- HTTP 200
- `provider = "groq"`
- `choices[0]` が存在
- assistant responseが返る
- GPT-OSSでは内部的に `reasoning.effort=high` -> Groq `reasoning_effort=high`

出力文言が完全一致しなくてもAPI/shapeが正常ならE2E成功とみなす。

## 1-C. SSE

Windows PowerShellではJSON quote崩れを避けるためstdinを使う。

```powershell
@{
  model = "openai/gpt-oss-120b"
  messages = @(@{role="user";content="Reply briefly with groq-stream-ok"})
  stream = $true
  reasoning = @{effort="high"}
} | ConvertTo-Json -Depth 20 -Compress |
  curl.exe -N -X POST "http://127.0.0.1:8787/v1/chat/completions" `
    -H "Content-Type: application/json" `
    -H "X-Free-AI-Pool-Provider: groq" `
    --data-binary "@-"
```

期待:

- `data: {...}` が逐次到着
- 最終的に `data: [DONE]`
- chunk内に `provider: "groq"`

## 1-D. Tool Calling完全往復

1ターン目でツールを強制的に使わせる。

Tool:

```json
{
  "type": "function",
  "function": {
    "name": "add_numbers",
    "description": "Adds two numbers.",
    "parameters": {
      "type": "object",
      "properties": {
        "a": {"type": "number"},
        "b": {"type": "number"}
      },
      "required": ["a", "b"],
      "additionalProperties": false
    }
  }
}
```

User prompt:

```text
Use the add_numbers tool to calculate 17 + 25. Do not calculate it yourself.
```

確認事項:

- `choices[0].message.tool_calls` が返る
- function nameが `add_numbers`
- argumentsがJSONとして解釈可能
- tool result `42` を `role=tool` + `tool_call_id` で履歴へ戻す
- 2ターン目で最終assistant回答まで完走

## 1-E. Structured Output

`response_format.type = "json_schema"` で簡単なschemaを指定する。

例:

```json
{
  "type": "json_schema",
  "json_schema": {
    "name": "answer",
    "strict": true,
    "schema": {
      "type": "object",
      "properties": {
        "answer": {"type": "string"}
      },
      "required": ["answer"],
      "additionalProperties": false
    }
  }
}
```

期待:

- HTTP 200
- assistant contentがJSONとしてparse可能
- schemaを満たす

Groqで全項目が通ればGroq real E2E完了。

---

# 2. Kilo anonymous real E2E

## 前提

Kiloはfree modelについてAPI keyなしでも利用可能な設計。
Adapterは常時registry登録される。

`.env`:

```text
KILO_API_KEY=
KILO_BASE_URL=https://api.kilo.ai/api/gateway
```

まず匿名で試す。

## 2-A. Models

```powershell
$models = Invoke-RestMethod `
  -Uri "http://127.0.0.1:8787/v1/models?provider=kilo" `
  -Method Get

$models.data | Select-Object id,provider,owned_by | Format-Table
```

期待:

- 匿名でHTTP 200
- model list取得

## 2-B. non-streaming

第一候補:

```text
kilo-auto/free
```

次候補:

```text
openrouter/free
```

現在のcatalogと合わなければModelsからfree候補を選ぶ。

```powershell
$body = @{
  model = "kilo-auto/free"
  messages = @(@{role="user";content="Reply briefly with kilo-ok"})
} | ConvertTo-Json -Depth 20

Invoke-RestMethod `
  -Uri "http://127.0.0.1:8787/v1/chat/completions" `
  -Method Post `
  -Headers @{ "X-Free-AI-Pool-Provider" = "kilo" } `
  -ContentType "application/json" `
  -Body $body
```

期待:

- API keyなしで成功
- `provider = "kilo"`
- choicesが返る

匿名利用がupstream仕様変更で不可の場合は、コードbugと即断しない。公式/実エラーを確認し「upstream auth policy変更」の可能性を切り分ける。

## 2-C. SSE

Groqと同じstdin方式で `stream=$true` を送る。

期待:

- SSE chunk
- `[DONE]`
- provider付与

余力があればTool Calling / Structured Outputを1本ずつ確認する。

---

# 3. Vercel AI Gateway real E2E

## 前提

`.env`:

```text
VERCEL_AI_GATEWAY_API_KEY=...
VERCEL_AI_GATEWAY_BASE_URL=https://ai-gateway.vercel.sh/v1
```

key未設定ならcredential不足として記録し次へ進む。

## 3-A. Models

```powershell
$models = Invoke-RestMethod `
  -Uri "http://127.0.0.1:8787/v1/models?provider=vercel" `
  -Method Get

$models.data | Select-Object id,provider,owned_by | Format-Table
```

現在利用可能なmodel IDをこの出力から選ぶ。

## 3-B. non-streaming

選んだmodelで短いcompletionを実行。

期待:

- HTTP 200
- `provider = "vercel"`
- choicesあり

## 3-C. SSE

同modelで `stream=true`。

期待:

- SSE chunk
- `[DONE]`

余力があればTool Calling / Structured Output / reasoning passthroughを各1本確認する。

---

# 4. OpenRouter `free-best` real E2E

## 前提

`OPENROUTER_API_KEY` が設定済みであること。

`free-best` はOpenRouter Adapter内部だけの仮想model IDで、Provider間routingではない。

## 4-A. plain chat

```powershell
$body = @{
  model = "free-best"
  messages = @(@{role="user";content="Reply briefly with free-best-ok"})
} | ConvertTo-Json -Depth 20

$r = Invoke-RestMethod `
  -Uri "http://127.0.0.1:8787/v1/chat/completions" `
  -Method Post `
  -Headers @{ "X-Free-AI-Pool-Provider" = "openrouter" } `
  -ContentType "application/json" `
  -Body $body

$r | ConvertTo-Json -Depth 20
```

期待:

- `free-best` が実際の `:free` modelへ解決される
- completion成功
- 有料modelへ行かない

## 4-B. capability filter

Tool Calling付きrequestを1本送る。

期待:

- tools非対応free modelが候補から除外される
- tools対応free modelを選択してtool call可能、またはeligible 0件なら503
- **暗黙fallbackはしない**

可能ならStructured Output / vision / reasoningのうち1つも追加確認する。

---

# 5. Hermes Agent / n8n final E2E

Provider側E2Eが通ったあとに行う。

Base URL:

```text
http://127.0.0.1:8787/v1
```

確認事項:

1. clientがOpenAI-compatible endpointとして接続できる
2. `X-Free-AI-Pool-Provider` をcustom headerとして設定できるか
3. 設定できる場合、OpenRouter/Groq/Kilo等をheaderだけ変えて切り替えられる
4. custom header不可の場合のみlegacy body `provider: "groq"` 等の利用可否を確認
5. object型 `provider: {...}` はOpenRouter native routing用なので文字列provider選択と混同しない
6. Agentから通常chatを1回成功させる
7. Tool Callingを使うAgentならtool round tripも1回確認する

---

# 失敗時の判断基準

## 実装bugの可能性が高い

- upstream直叩きでは成功するがFree AI Pool経由だけ失敗
- mock testとreal APIのshape差によりparse/validationで落ちる
- Provider固有field変換が現在仕様と不一致
- SSEをupstreamは返しているのにGatewayで壊れる

この場合のみ実装修正を検討する。

## 実装bugと即断しない

- 401/403: credential / auth policy
- 404 model not found: model catalog変更
- 429: quota / rate limit / overload
- 402/credit error: free枠・credit条件
- 5xx: upstream一時障害
- region/account制限

まず実エラーbodyを秘密情報を除いて確認する。

# 修正を行った場合の必須検証

```powershell
npm run typecheck
npm test
npm run build
```

関連Providerのmock testを追加・更新し、real E2Eを再実行する。

# 最終報告フォーマット

エージェントは最後に以下程度の簡潔な表を残す。

```text
Provider   Models   Chat   SSE   Tools   JSON Schema   Notes
Groq       ✅       ✅     ✅    ✅      ✅            ...
Kilo       ✅       ✅     ✅    -       -             anonymous free OK
Vercel     ✅       ✅     ✅    -       -             ...
free-best  n/a      ✅     n/a   ✅      -             resolved to <model>
Hermes     n/a      ✅     n/a   ...     ...           ...
```

失敗は `❌`、credential未設定など未実施は `SKIP` とし、理由を書く。

## 完了条件

最低限:

- Groq: Models / non-streaming / SSE
- Kilo: anonymous Models / non-streaming / SSE
- Vercel: Models / non-streaming / SSE（credentialがある場合）
- `free-best`: plain real E2E
- Hermes Agentまたはn8nから1回以上の実利用

推奨:

- Groq Tool Calling完全往復 + Structured Output
- `free-best` Tool Calling capability filter

これらが通ればPR #1をDraft解除・最終review・merge候補にする。
