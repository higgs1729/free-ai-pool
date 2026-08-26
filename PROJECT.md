# Free AI Pool — Project Context

更新: 2026-08-26

## 目的

複数の無料・低コストLLM APIを、利用側がProvider固有仕様を意識せず切り替えて使える軽量な統合Gatewayにする。

主な利用先:

- Hermes Agent
- n8n LLM Agent
- 将来のVS Code / Orca等
- 将来的な学校チーム開発

## v1の基本方針

利用側からupstreamを明示して切り替える。

```text
Free AI Pool
├─ OpenRouter
├─ Gemini
├─ Groq
├─ Z.AI
├─ Kilo
└─ Vercel AI Gateway
```

推奨:

```http
X-Free-AI-Pool-Provider: openrouter
```

共通request / responseはOpenRouter `/api/v1/chat/completions` をbaselineとし、snake_caseを維持する。

### v1でやらないこと

- Provider間の自動モデルrouting
- Provider間の自動fallback
- quotaを跨いだ高度scheduler
- Provider差異の完全抽象化
- Embeddings / image generation / audio / files / batch

Provider内部のroutingは各upstreamへ任せる。

## 初期6 Provider

### OpenRouter

v1の基準実装。

- `openrouter/free`
- Models API
- Tool Calling
- Structured Output
- Reasoning
- Streaming
- vision
- native `provider: {...}` routing

実API chat / SSE / Models E2E済み。

#### `free-best`

Free AI Pool独自のOpenRouter内仮想model。

`model: "free-best"` を指定すると、OpenRouter Models APIをintelligence降順で取得し、実際に無料・期限内・必要capability対応の最上位候補を選ぶ。

これは **OpenRouter内のmodel選択だけ**であり、6 Provider間の自動routingではない。

### Gemini

公式OpenAI compatibility endpointを使用。

- Free Tier Flash
- Tool Calling
- Structured Output
- Streaming
- Models API
- vision

実API Models / chat / SSE E2E済み。現在のローカル実確認では `gemini-3.6-flash` が利用可能。

### Groq

独立Free API枠。

- 非常に高速
- GPT-OSS / Qwen等
- Tool Calling
- Structured Output
- Streaming
- Models API

Adapter / mock tests / CI実装済み。実API E2Eのみ未確認。

### Z.AI

無料Flashを **単純・大量タスク実行役**として採用。

候補:

- `glm-4.5-flash`
- `glm-4.7-flash`

`glm-4.5-flash` は通常reasoning ONで使い、非常に単純な処理だけ明示的にOFFにできる。

実APIでchat / reasoning control / SSE / Tool Calling完全往復 / Structured Outputまで確認済み。

### Kilo Gateway

OpenRouterとは別の無料Gateway。

- `kilo-auto/free`
- `openrouter/free`
- Kilo catalogの各 `:free` model
- anonymous free request対応
- OpenAI-compatible chat / tools / response_format / streaming / Models

Adapter / mock tests / CI実装済み。API keyなしでもFree Adapterを利用可能。匿名実API E2Eのみ未確認。

### Vercel AI Gateway

毎月補充される少額creditsを商用モデル用計算資源として扱う。

- OpenAI-compatible API
- Tool Calling
- Structured Output
- Streaming
- Models API
- reasoning / providerOptions pass-through

Adapter / mock tests / CI実装済み。実API E2Eのみ未確認。

## 設計原則

### Provider固有処理を上位へ漏らさない

```text
Agent
  ↓
OpenAI-compatible Free AI Pool API
  ↓
Provider Adapter
  ├─ OpenRouter
  ├─ Gemini
  ├─ Groq
  ├─ Z.AI
  ├─ Kilo
  └─ Vercel
```

Provider差分はAdapterへ閉じ込める。

### OpenRouter baselineを維持

例:

```json
{
  "model": "openrouter/free",
  "messages": [{"role":"user","content":"hello"}],
  "max_tokens": 1024,
  "tool_choice": "auto"
}
```

OpenRouter以外で解釈できないfieldはAdapterが除去・変換する。

### model IDはupstream nativeを優先

```text
openrouter/free
free-best
gemini-3.6-flash
openai/gpt-oss-120b
glm-4.5-flash
kilo-auto/free
<vercel-native-model-id>
```

無料modelの入れ替わりでAdapter本体を頻繁に修正しない設計を優先する。

## 現在の実装進捗

1. ✅ TypeScript / Fastify基盤
2. ✅ Common LLM contract
3. ✅ Provider registry / config
4. ✅ OpenRouter Adapter
5. ✅ Gemini Adapter
6. ✅ Groq Adapter
7. ✅ Z.AI Adapter
8. ✅ Kilo Adapter
9. ✅ Vercel Adapter
10. ✅ `/v1/chat/completions`
11. ✅ SSE
12. ✅ `/v1/models`
13. ✅ Tool Calling baseline
14. ✅ Structured Output baseline
15. ✅ Reasoning baseline
16. ✅ error normalization / abort propagation
17. ✅ `free-best`
18. ✅ CI: typecheck / tests / build
19. ✅ OpenRouter / Gemini / Z.AI real API E2E
20. ⏳ Groq / Kilo / Vercel real API E2E
21. ⏳ Hermes / n8n final E2E

**コード実装としてのv1 MVPは完成。**

残りは実credentialsと実clientを使う接続確認。

## 将来のチーム利用

5人程度のチームでも利用できるよう、最終的には以下程度を目指す。

```text
git clone
↓
.env に必要なAPI key
↓
npm run dev  または将来 docker compose up
↓
Agentから http://host:8787/v1 を利用
```

Docker化はv1の完成条件には含めない。

## 追加機能の判断基準

> 得られるAI計算資源の価値 > 統合・保守コスト

無料であっても、認証が過度に複雑、小さすぎるquota、特殊環境が必須などの場合は無理に採用しない。
