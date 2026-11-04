"""Wiki content — agent core (electron/agent/*) and shared timeline model."""

ARTICLES = [
    dict(slug="agent-loop", title="electron/agent/loop.ts", category="agent",
         path="electron/agent/loop.ts", lines=263, lang="TypeScript", status="CORE",
         pkg="agent", phase="v1", spec_refs=["§4.1 Agent loop"], related=["agent-types", "agent-tools", "agent-prompt", "runner"],
         lead=[
             "The agent turn engine. runAgentTurn() is the heart of XtracsysCode: it takes a conversation history plus a system prompt, streams a model completion, executes any tool calls the model requests, feeds results back, and repeats — up to maxSteps or until the model produces a final answer with no tool calls.",
             "It is deliberately Electron-free: the loop only knows about the Provider, ToolDefinition, and emit-callback interfaces declared in agent/types.ts. That is why npm run smoke can exercise the full loop in plain Node against a live Ollama server.",
         ],
         sections=[
             ("The step loop", [
                 "Each step streams one provider call. Text deltas and thought deltas are forwarded to the caller through emit() as they arrive; tool calls are collected until the stream finishes. If the model requested tools, each executes in order and every result is appended as a tool-role message, then the loop continues.",
                 "Context is bounded twice: trimHistory() drops whole turns (never splitting an assistant-toolCalls/tool-result pair) to stay under maxHistoryChars, and every tool output is truncated to maxToolOutputChars before it enters history. The final step's input token count is surfaced as lastInputTokens so the UI context meter reflects the true window pressure.",
             ]),
             ("Aborting and limits", [
                 "The caller supplies an AbortSignal; abort checks happen before each step and between tool executions. maxSteps (default 24) caps tool iterations and is clamped to 1–200 inside the loop, so a corrupt settings.json cannot produce an unbounded autonomous run; a 'length' finish reason is surfaced as an error so the UI can prompt for /compact instead of silently truncating.",
             ]),
             ("v4 hardening", [
                 "Tool-call retries in the E2E exposed a 3B-model failure mode: emitting the tool call as plain-text JSON instead of using the tools API. The loop itself is agnostic — the E2E simply re-prompts — but this is why askChat assertions in runE2E count tool messages, not assistant claims.",
             ]),
         ],
         key_items=[
             ("runAgentTurn(opts: AgentRunOptions): Promise<AgentRunResult>",
              "Runs one full agent turn; returns messages, stopReason (end_turn|aborted|max_steps|error), token usage, lastInputTokens, and step count."),
             ("trimHistory(history, budget): ChatMessage[]",
              "Turn-granular context trimming — keeps the first user turn and as many recent whole turns as fit the char budget; never orphans a tool result."),
             ("emit callback", "Forwards text-delta, thought-delta, tool-start, tool-output, tool-end, plan, and turn events to the runner, which both broadcasts to renderer windows and applies them to the persisted timeline."),
         ]),

    dict(slug="agent-tools", title="electron/agent/tools.ts", category="agent",
         path="electron/agent/tools.ts", lines=530, lang="TypeScript", status="CORE",
         pkg="agent", phase="v1 (edit_file/live v2-v4)", spec_refs=["§4 Tools"], related=["agent-types", "agent-loop", "store"],
         lead=[
             "The agent's hands. Seven tools are registered by defaultTools(): list_dir, read_file, write_file, edit_file, run_command, grep, and set_plan. Built-in file tools resolve paths through resolveWithin(root, target), rejecting lexical traversal and detected symlink escapes. This is not an operating-system sandbox: approved shell commands and local MCP/plugin processes retain the user's filesystem and network access, and path checks retain a TOCTOU race.",
         ],
         sections=[
             ("File tools", [
                 "write_file creates parent directories and returns a before/after diff for the UI (old content is read first when the file exists). edit_file demands that oldText occur exactly once — zero matches returns 'not found, read the file again', multiple matches reports the count and asks for more context — then replaces once. Both cap diffs at 20 KB per side so transcripts stay small.",
                 "read_file refuses anything over 4 MB or containing NUL bytes (binary sniff on the first 8 KB); list_dir caps at 500 entries and skips .DS_Store.",
             ]),
             ("run_command with live output", [
                 "Uses platform.shellInvocation(): zsh on macOS, bash on Linux, cmd on Windows. Output accumulation is capped at 256 KiB and live streaming at 64 KiB, throttled at 150 ms; tool-result text is further truncated. Timeouts (1–120 s) call killTree and report exit code 124. Commands are capped at 32 000 chars (long input belongs in a file) and inherit the minimal platform.childEnv() allowlist (PATH/HOME/SHELL/locale/tmp — no inherited cloud or CI tokens) (2026-10 hardening). Cancellation behavior requires separate verification; cwd is not confinement.",
             ]),
             ("grep and set_plan", [
                 "grep is a recursive walker skipping node_modules/.git/dist/build/hidden dirs, case-insensitive fixed-string by default (regex:true opts in), 80-hit cap, 1 MB per-file size cap. Model-supplied patterns get three ReDoS bounds (2026-10): the filename glob is matched with a hand-rolled LINEAR wildcard matcher (regex conversion with unbounded stars froze the main process — 90 s per entry, proven), regex:true line tests run in a worker thread with a 250 ms per-line timeout plus a 5 s whole-walk budget (length caps alone cannot bound backtracking: `(a+)+b` vs a 4 KB line ran > 20 s), and fixed-string mode stays in-process on its literal-only pattern. set_plan validates up to 50 entries, normalizes statuses to pending|in_progress|done, and pushes the whole plan through ctx.updatePlan — which the runner wires to chat.plan plus a broadcast.",
             ]),
             ("Approvals", [
                 "Each tool carries readOnly: the three read tools run free; write_file/edit_file/run_command/mcp tools consult the caller's approval callback. The runner layers per-project allowlists (command globs like 'git *', write scopes like 'src/**') in front of that callback, and 'Always allow' in the UI writes those rules.",
             ]),
         ],
         key_items=[
             ("defaultTools(): ToolDefinition[]", "The registry — one ToolDefinition per tool with spec (name/description/JSON-schema parameters), readOnly flag, and execute(args, ctx)."),
             ("resolveWithin(root, target)", "Rejects outside targets rather than redirecting them; realpath checks include the nearest existing parent for new files. Residual symlink-swap race is documented in source."),
             ("makeDiff(file, oldText, newText)", "Builds the ToolDiff for the timeline unless either side exceeds 20 KB."),
             ("commandMatchesPattern(pattern, command)", "Glob-ish matcher shared with approval rules: 'git *' matches any git invocation, '* *' matches everything."),
         ]),

    dict(slug="agent-providers", title="electron/agent/providers/*", category="agent",
         path="electron/agent/providers/", lines=375, lang="TypeScript", status="CORE",
         pkg="agent", phase="v1", related=["agent-types", "agent-loop"],
         lead=[
             "The app's Ollama provider uses native /api/chat (NDJSON); its dedicated llama.cpp provider uses OpenAI-compatible /v1/chat/completions (SSE). openaiCompatible.ts adds a generic Chat Completions/SSE adapter wired to the GMLX and MLX LM server settings; its LM Studio protocol preset is not exposed in the current UI. Live GMLX/MLX LM engines were not tested here.",
         ],
         sections=[
             ("Ollama specifics", [
                 "Streaming lines are NDJSON: {message:{content, thinking, tool_calls}, done, prompt_eval_count, eval_count}. Tool arguments arrive pre-parsed as objects. Options pass through when set: options.num_ctx (P5's context meter denominator) and options.temperature. Vision (P11/N11) rides as message.images: [base64]. The stream is bounded like the OpenAI-compatible adapter — 16 MB total, 256 KB per line, 128 tool calls, 10-minute deadline (2026-10 hardening).",
             ]),
             ("llama.cpp specifics", [
                 "SSE data: lines with delta.content / delta.reasoning_content; streamed tool_call argument fragments are accumulated by index and flushed once at finish, under the same stream/line/tool-byte/tool-call-count/timeout bounds as the shared adapter (2026-10 hardening). temperature passes at request level; context size is fixed by llama-server's --ctx-size, which the Backends UI states explicitly. Images convert to OpenAI image_url content parts with data: URLs.",
             ]),
             ("Generic OpenAI-compatible server", [
                 "GMLX and MLX LM server use the shared SSE adapter with loopback-only destination URLs and optional /v1/models discovery. The transport was tested with local API fixtures, not live engines. The app cannot verify which interfaces the backend server listens on; operators must keep it bound to localhost. Upstream warns that MLX LM server is not recommended for production because it implements only basic security checks. Tool calls/images vary by server/model, and usage is omitted when unreported.",
             ]),
             ("Shared contract", [
                 "Both normalize to the same callbacks — onText/onThought/onToolCall/onUsage — and return a finishReason of stop|tool_calls|length|error, so the loop and context meter never care which backend is selected.",
             ]),
         ],
         key_items=[
             ("createOllamaProvider(baseUrl): Provider", "Native chat streaming, tools in Ollama function format, NDJSON parse loop."),
             ("createLlamaCppProvider(baseUrl): Provider", "OpenAI-compatible SSE, tool_choice auto, usage via stream_options.include_usage."),
             ("createOpenAICompatibleProvider(baseUrl, preset): Provider", "Shared Chat Completions/SSE transport for GMLX and MLX LM; local fixture tests only."),
             ("listModels()", "GET /api/tags or /v1/models — powers the Backends dropdown, model auto-pick, and Test-connection latency."),
         ]),

    dict(slug="agent-mcp", title="electron/agent/mcp.ts", category="agent",
         path="electron/agent/mcp.ts", lines=211, lang="TypeScript", status="CORE",
         pkg="agent", phase="v2 N12", related=["runner", "agent-tools"],
         lead=[
             "A minimal Model Context Protocol client for local stdio servers. It spawns each configured server, speaks newline-delimited JSON-RPC 2.0 (initialize → notifications/initialized → tools/list → tools/call), and exposes discovered tools to the agent loop namespaced as mcp__<server>__<tool>.",
         ],
         sections=[
             ("Lifecycle and safety", [
                 "Servers are spawned per agent turn from the project's config (Settings → Project → MCP servers) with the project folder as cwd, and killed in the run's finally block. Requests carry a 30 s timeout; initialize gets 15 s; a crashed server rejects all pending calls so the model sees a clean failure instead of a hang.",
                 "The client is deliberately tiny: no network, no capabilities beyond tools, no resources/prompts. Anything the server writes to stderr is discarded rather than logged, keeping transcripts clean. Servers spawn with the minimal platform.childEnv() allowlist — no inherited cloud/CI tokens (2026-10 hardening).",
             ]),
             ("Integration", [
                 "The runner converts each McpTool into a ToolDefinition whose execute() calls McpManager.callTool and joins text content parts. MCP tools are readOnly:false, so they ride the approval allowlist like run_command — a per-project rule of 'mcp__echo__*' style globs (first-token derivation) covers them.",
             ]),
         ],
         key_items=[
             ("McpManager.start(configs, cwd): Promise<string[]>", "Spawn+initialize all servers; returns per-server error strings instead of throwing."),
             ("McpManager.listTools(): McpTool[]", "Flattened tool inventory across servers."),
             ("McpManager.callTool(server, tool, args)", "tools/call with text-content joining and isError propagation."),
         ]),

    dict(slug="agent-types", title="electron/agent/types.ts", category="agent",
         path="electron/agent/types.ts", lines=182, lang="TypeScript", status="CORE",
         pkg="agent", phase="v1–v2", related=["agent-loop", "agent-tools", "timeline-model"],
         lead=[
             "The agent's contract surface: ChatMessage (role/content/toolCalls/images), ToolCall, ToolSpec, ToolContext (cwd, resolvePath, scratchDir, updatePlan, onOutput), PlanEntry, ApprovalRequest, and the AgentEvent union the loop emits. The Provider interface defines the streamChat contract both backends implement, including the v2 params ({numCtx, temperature}) pass-through.",
         ],
         sections=[
             ("Event union", [
                 "AgentEvent covers the whole turn lifecycle: turn-start (with imageCount), text-delta, thought-delta, tool-start, tool-output (live command streaming), tool-end (with optional diff), plan, turn-end, turn-error, notice (via the shared mirror), and step-start. Every renderer and the persistence layer consume these shapes — shared/timelineModel.ts mirrors this union structurally to stay import-clean on both sides.",
             ]),
         ],
         key_items=[
             ("interface Provider", "listModels() + streamChat(opts, callbacks) — the seam that makes smoke tests backend-agnostic."),
             ("interface ToolContext", "Carries cwd, resolvePath (sandbox), scratchDir, updatePlan, onOutput into every tool execution."),
             ("interface AgentRunResult", "messages, stopReason, usage, lastInputTokens (final step's prompt size — the context meter's numerator), steps."),
         ]),

    dict(slug="agent-prompt", title="electron/agent/prompt.ts", category="agent",
         path="electron/agent/prompt.ts", lines=42, lang="TypeScript", status="CORE",
         pkg="agent", phase="v2–v3", related=["agent-loop", "runner"],
         lead=[
             "Builds the system prompt: identity, environment (project root, OS), the tool inventory, eight behavioral rules, optional project instructions from .xtracsys.md/AGENTS.md (v3, §Project instructions), and optional global extras from Settings. Rules mandate set_plan for 3+ step tasks, edit_file over write_file for surgical changes, and project-root containment.",
         ],
         key_items=[
             ("systemPrompt({cwd, platform, tools, projectInstructions, extra})", "Assembles the final prompt; project instructions sit after the built-in rules so they win on conflicts."),
         ]),

    dict(slug="agent-smoke", title="electron/agent/smoke.ts", category="agent",
         path="electron/agent/smoke.ts", lines=118, lang="TypeScript", status="TEST",
         pkg="agent", phase="v1", tested_by="npm run smoke", related=["agent-loop", "agent-tools"],
         lead=[
             "The plain-Node verification harness: picks the first reachable backend (preferring coder/qwen/llama/granite models), plants a scratch project with notes.txt containing 'The secret word is: ANVIL-7', and asks the agent to find it and write answer.txt. Pass requires the file to contain ANVIL-7 with stopReason end_turn. It exercises discovery, tool use, file write, and the multi-step loop with zero Electron involvement.",
         ],
         sections=[
             ("Known flakiness", [
                 "The 3B test model occasionally ignores instructions on a given seed. The in-app E2E wraps turns with retry nudges; smoke deliberately stays retry-free so it remains a raw model-quality signal — one failed smoke against a passing E2E is a model roll, not a regression.",
             ]),
         ],
         key_items=[
             ("main()", "Backend auto-pick → scratch project → runAgentTurn → file assertion → PASS/FAIL exit code."),
         ]),

    dict(slug="timeline-model", title="shared/timelineModel.ts", category="agent",
         path="shared/timelineModel.ts", lines=234, lang="TypeScript", status="CORE",
         pkg="shared", phase="v1–v4", related=["runner", "useXtrac", "agent-loop"],
         lead=[
             "The single source of truth for what a chat transcript looks like. TimelineItem is the union the UI renders and main persists; SharedAgentEvent mirrors the agent's event union; applyEventToTimeline() folds an event into a timeline in place. Because both the Electron host (persistence) and the React renderer (live streaming) call the same function, a chat looks identical after a restart and mid-stream — the v1 design bet that eliminated an entire class of resume bugs. The .md transcript generator HTML-escapes text and tool output and prevents fence breakout, so model content stays inert when the file is opened in external markdown viewers (2026-10).",
         ],
         sections=[
             ("Item kinds", [
                 "user (with imageCount for attachments), assistant (streaming flag), thought (open/collapsed), tool (status running|ok|fail, argsSummary, output live-tail, optional diff for write/edit), error, and system (notices from slash commands, pressure warnings, task summaries).",
             ]),
             ("Event folding rules", [
                 "text-delta appends to the trailing streaming assistant item or creates one; thought-delta does the same for thoughts; tool-end pairs by toolCallId and attaches the write/edit diff; tool-output appends a 24 KB-capped live tail while running; notice appends a system item; plan events are ignored here because the plan lives on chat.plan, not the timeline.",
             ]),
             ("Markdown mirror", [
                 "timelineToMarkdown() renders the persisted .md transcript: headers for user/assistant turns, collapsible thinking blocks, diff-styled tool sections, and blockquote notices — the human-readable half of the JSON+MD data model.",
             ]),
         ],
         key_items=[
             ("applyEventToTimeline(items, ev)", "The fold function — same input, same timeline, whether the caller is main or the renderer."),
             ("timelineToMarkdown(title, items)", "The .md transcript renderer written beside every chats/<id>.json."),
             ("TimelineItem union", "user | assistant | thought | tool | error | system."),
         ]),

    dict(slug="local-url", title="electron/agent/providers/localUrl.ts", category="agent",
         path="electron/agent/providers/localUrl.ts", lines=47, lang="TypeScript", status="CORE",
         pkg="agent", phase="v5", spec_refs=["v5 Phase E (R9)"], related=["agent-providers", "host-main"],
         lead=[
             "The single validation point for every built-in backend URL. Provider constructors and settings:set IPC enforce http/https only, no URL credentials, and loopback hosts only — localhost, 127.0.0.0/8, and ::1. IPv6 unspecified ::, 0.0.0.0, and lookalike DNS names are rejected; redirects are refused, so built-in model requests cannot be redirected off loopback.",
         ],
         key_items=[
             ("loopbackBase(raw, label)", "Validates + normalizes a backend base URL, throwing actionable errors."),
             ("NO_REDIRECT", "fetch option (redirect: \"error\") both providers pass so a redirect can never bounce model traffic off the loopback."),
         ]),

    dict(slug="agent-tests", title="tests/*", category="agent",
         path="tests/", lines=2636, lang="TypeScript/JS", status="TEST",
         pkg="agent", phase="v5", spec_refs=["v5 Phase E/F"], related=["skills", "plugins", "local-url"],
         lead=[
             "Deterministic plain-Node suites use disposable test roots. Coverage includes skills, plugins, security policy, generated documents, provider/MCP behavior, restore safety (including CRLF tar listings from Windows), ZIP packaging, and platform-specific afterPack executable paths. The skills import test compares the recorded source with the same async realpath API used by the importer, keeping Windows path behavior consistent. MCP shutdown assertions distinguish POSIX process-group failures from Windows taskkill behavior and its explicit unconfirmed-descendant warning after natural child exit. These checks do not replace native Windows/Linux acceptance. generate-doc-samples.mjs writes sample documents.",
         ],
         key_items=[
             ("npm test", "Builds the main process, then runs all deterministic suites, including the afterPack platform-path regression check; any failure exits non-zero."),
             ("Path handling", "Path-containment regressions cover symlinked project roots (for example /var and /private/var) while refusing paths outside the selected project."),
         ]),
]
