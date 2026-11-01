/**
 * AgentRunner — owns one AgentEngine per chat, wires approvals/persistence/events,
 * and broadcasts renderer events over a callback supplied by main.
 */
import os from "node:os";
import path from "node:path";
import fsp from "node:fs/promises";
import type { Storage, Settings } from "./storage";
import { Store, ChatRecord, commandApprovalDecision, pathInWriteScopes } from "./store";
import {
  runAgentTurn,
} from "./agent/loop";
import { defaultTools } from "./agent/tools";
import { McpManager } from "./agent/mcp";
import type { ToolDefinition } from "./agent/types";
import { systemPrompt } from "./agent/prompt";
import { createOllamaProvider } from "./agent/providers/ollama";
import { createLlamaCppProvider } from "./agent/providers/llamacpp";
import { createOpenAICompatibleProvider } from "./agent/providers/openaiCompatible";
import type { Provider, ApprovalRequest, AgentEvent } from "./agent/types";
import { applyEventToTimeline, timelineToMarkdown, type SharedAgentEvent } from "../shared/timelineModel";
import { SkillStore, SKILLS_LIMITS } from "./skills";
import { PluginStore } from "./plugins";

export interface RendererEvent {
  type: "agent-event";
  chatId: string;
  ev: SharedAgentEvent;
}

export interface ApprovalUi {
  /** Ask the renderer; resolves when the user answers or the timeout hits. */
  request(request: ApprovalRequest & { chatId: string }): Promise<boolean>;
}

export class AgentRunner {
  private aborts = new Map<string, AbortController>();
  /** Per-chat queue of prompts waiting for the current turn to finish (N6). */
  private queues = new Map<string, { text: string; images?: string[] }[]>();

  constructor(
    private storage: Storage,
    private store: Store,
    private approvalUi: ApprovalUi,
    private broadcast: (chatId: string, ev: SharedAgentEvent) => void,
    private onIdle?: (chatId: string) => void,
  ) {}

  /**
   * Wrap the base approval callback with per-project allowlist rules:
   * allowlisted commands and in-scope writes never reach the user.
   */
  private approvalGate(chat: ChatRecord): ((req: ApprovalRequest) => Promise<boolean>) | undefined {
    const base = chat.approvalMode === "auto" ? undefined : (req: ApprovalRequest) => this.approvalUi.request({ ...req, chatId: chat.id });
    if (!base) return undefined;
    const rules = this.store.listProjects().find((p) => p.id === chat.projectId)?.rules;
    return async (req: ApprovalRequest) => {
      if (rules) {
        if (req.toolName === "run_command" && typeof req.args.command === "string") {
          // R8: compound/substituting commands never inherit a glob approval.
          if (commandApprovalDecision(rules.commands, req.args.command as string) === "allow") return true;
        }
        if ((req.toolName === "write_file" || req.toolName === "edit_file") && typeof req.args.path === "string") {
          const abs = path.resolve(chat.cwd, req.args.path);
          if (pathInWriteScopes(chat.cwd, rules.writeScopes, abs)) return true;
        }
      }
      return base(req);
    };
  }

  /**
   * P5: fire the context-pressure warning once per chat when the last turn's input tokens
   * reach 90% of the context window (numCtx when known, else the char-budget estimate).
   * Public so the E2E can drive it deterministically.
   */
  maybePressureNotice(chat: ChatRecord, numCtx?: number): void {
    if (chat.pressureNoticed) return;
    const denom =
      typeof numCtx === "number" && numCtx > 0
        ? numCtx
        : Math.max(1, Math.round((this.storage.settings.historyCharBudget || 80_000) / 4));
    const pct = Math.round(((chat.stats.lastInputTokens ?? 0) / denom) * 100);
    if (pct >= 90) {
      chat.pressureNoticed = true;
      this.notice(chat, `Context is at ${pct}% — run /compact or start a new chat.`);
    }
  }

  isRunning(chatId: string): boolean {
    return this.aborts.has(chatId);
  }

  /** Emit an informational system notice into the chat (timeline + broadcast, persisted by caller). */
  notice(chat: ChatRecord, text: string): void {
    applyEventToTimeline(chat.timeline, { type: "notice", chatId: chat.id, text });
    this.broadcast(chat.id, { type: "notice", chatId: chat.id, text });
  }

  /**
   * /compact — summarize the conversation with the current model and replace the
   * LLM-visible history with a single summary message. The rendered transcript is kept.
   */
  async compactChat(chat: ChatRecord): Promise<void> {
    return this.storage.restoreBarrier.run("chat compaction", () => this.compactChatNow(chat));
  }

  private async compactChatNow(chat: ChatRecord): Promise<void> {
    if (this.isRunning(chat.id)) {
      this.notice(chat, "Busy — wait for the current turn to finish, then /compact again.");
      return;
    }
    if (chat.messages.length < 3) {
      this.notice(chat, "Nothing to compact yet (need at least 3 messages).");
      return;
    }
    const settings = this.storage.settings;
    const provider = this.makeProvider(settings);
    const controller = new AbortController();
    this.aborts.set(chat.id, controller);
    chat.status = "running";
    try {
      const sys =
        "You summarize coding-agent conversations. Produce a terse brief (short bullet list) covering: the task, key decisions, files touched (with paths), important results, and next steps. Maximum 300 words. No preamble.";
      const convo = chat.messages
        .map((m) => `${m.role}${m.toolCalls?.length ? ` (called ${m.toolCalls.map((t) => t.name).join(", ")})` : ""}: ${m.content}`)
        .join("\n\n")
        .slice(-60_000);
      const summary = { value: "" };
      const res = await provider.streamChat(
        {
          model: chat.model || settings.model,
          messages: [
            { role: "system", content: sys },
            { role: "user", content: convo },
          ],
          tools: [],
          signal: controller.signal,
        },
        {
          onText: (d) => {
            summary.value += d;
          },
          onThought: () => {},
          onToolCall: () => {},
        },
      );
      if (res.finishReason === "error" || !summary.value.trim()) {
        this.notice(chat, `Compact failed: ${res.error ?? "empty summary"}`);
        return;
      }
      const before = chat.messages.length;
      chat.messages = [
        {
          role: "user",
          content: `[Conversation summary — earlier messages were compacted away. The full transcript is preserved in the UI.]\n\n${summary.value.trim()}`,
        },
      ];
      chat.stats.lastInputTokens = 0; // compaction resets the context
      chat.pressureNoticed = false;
      this.notice(chat, `Compacted ${before} messages into a summary. Context is now small; the transcript above is untouched.`);
    } finally {
      chat.status = "idle";
      this.aborts.delete(chat.id);
      await this.store.persistChat(chat);
    }
  }

  cancel(chatId: string): void {
    this.aborts.get(chatId)?.abort();
  }

  /**
   * Send a prompt: starts a turn immediately, or queues it behind the running one (N6).
   * Returns what happened so the UI can reflect it.
   */
  sendOrQueue(chat: ChatRecord, text: string, images?: string[]): "started" | "queued" | "full" {
    this.storage.restoreBarrier.assertOpen();
    if (this.isRunning(chat.id)) {
      const q = this.queues.get(chat.id) ?? [];
      if (q.length >= 5) return "full";
      q.push({ text, images: images?.slice(0, 4) });
      this.queues.set(chat.id, q);
      this.notice(chat, q.length === 1 ? "Queued — will send when the current turn finishes." : `Queued (position ${q.length}) — sends after the current turn.`);
      return "queued";
    }
    void this.runTurn(chat, text, images).catch((error) => this.storage.log(`detached turn failed: ${(error as Error).message}`));
    return "started";
  }

  /**
   * Retry the last user prompt: rolls the chat back to just before that message
   * (messages AND timeline — no duplicate appears) and re-runs the turn.
   */
  async retryLast(chat: ChatRecord): Promise<"started" | "nothing" | "busy"> {
    return this.storage.restoreBarrier.run("chat retry", () => this.retryLastNow(chat));
  }

  private async retryLastNow(chat: ChatRecord): Promise<"started" | "nothing" | "busy"> {
    if (this.isRunning(chat.id)) return "busy";
    let idx = -1;
    for (let i = chat.messages.length - 1; i >= 0; i--) {
      if (chat.messages[i].role === "user") {
        idx = i;
        break;
      }
    }
    if (idx < 0) return "nothing";
    const text = chat.messages[idx].content;
    const retryImages = chat.messages[idx].images;
    chat.messages = chat.messages.slice(0, idx);
    let tIdx = -1;
    for (let i = chat.timeline.length - 1; i >= 0; i--) {
      if (chat.timeline[i].kind === "user") {
        tIdx = i;
        break;
      }
    }
    if (tIdx >= 0) chat.timeline = chat.timeline.slice(0, tIdx);
    await this.store.persistChat(chat);
    this.broadcast(chat.id, { type: "chat-rewound", chatId: chat.id, timeline: chat.timeline });
    void this.runTurn(chat, text, retryImages).catch((error) => this.storage.log(`retry turn failed: ${(error as Error).message}`));
    return "started";
  }

  listBackendModels(settings: Settings): Promise<{ ollama: string[]; llamacpp: string[]; openAICompatible: string[]; errors: Record<string, string> }> {
    const errors: Record<string, string> = {};
    const ollama = createOllamaProvider(settings.ollamaUrl);
    const llama = createLlamaCppProvider(settings.llamaCppUrl);
    const compatiblePreset = settings.provider === "mlxLmServer" ? "mlxLmServer" : "gmlx";
    const compatible = createOpenAICompatibleProvider(settings.openAICompatibleUrl, compatiblePreset);
    return Promise.all([
      ollama.listModels().catch((e) => {
        errors.ollama = (e as Error).message;
        return [] as string[];
      }),
      llama.listModels().catch((e) => {
        errors.llamacpp = (e as Error).message;
        return [] as string[];
      }),
      compatible.listModels().catch((e) => {
        errors.openAICompatible = (e as Error).message;
        return [] as string[];
      }),
    ]).then(([ollamaModels, llamaModels, compatibleModels]) => ({
      ollama: ollamaModels,
      llamacpp: llamaModels,
      openAICompatible: compatibleModels,
      errors,
    }));
  }

  makeProvider(settings: Settings): Provider {
    switch (settings.provider) {
      case "ollama":
        return createOllamaProvider(settings.ollamaUrl);
      case "llamacpp":
        return createLlamaCppProvider(settings.llamaCppUrl);
      case "gmlx":
        return createOpenAICompatibleProvider(settings.openAICompatibleUrl, "gmlx");
      case "mlxLmServer":
        return createOpenAICompatibleProvider(settings.openAICompatibleUrl, "mlxLmServer");
    }
  }

  async runTurn(chat: ChatRecord, text: string, images?: string[]): Promise<"done" | "busy" | "error"> {
    return this.storage.restoreBarrier.run("agent turn including queue/shutdown", () => this.runTurnNow(chat, text, images));
  }

  private async runTurnNow(chat: ChatRecord, text: string, images?: string[]): Promise<"done" | "busy" | "error"> {
    if (this.isRunning(chat.id)) return "busy";
    const settings = this.storage.settings;
    // M4: per-project overrides — chat → project → global.
    const project = this.store.listProjects().find((p) => p.id === chat.projectId);
    const pSet = project?.settings ?? {};
    const provider = this.makeProvider(settings);
    const model = chat.model || pSet.model || settings.model;
    const maxSteps = pSet.maxSteps ?? settings.maxSteps;
    const numCtx = pSet.numCtx ?? settings.numCtx;
    const temperature = pSet.temperature ?? settings.temperature;
    const tools = defaultTools();
    const scratchDir = this.storage.dir("tmp");
    const turnImages = images && images.length > 0 ? images.slice(0, 4) : undefined;

    // Register cancellation before MCP startup so an abort can stop servers during initialize.
    const controller = new AbortController();
    this.aborts.set(chat.id, controller);
    chat.status = "running";
    const mcps = new McpManager();
    try {
      // N12: start this project's local MCP servers and merge their tools (namespaced, approval-gated).
      // v5 R5: enabled local plugins join the same transport — same gating, same lifecycle.
      const mcpConfigs = [...(project?.mcps ?? [])];
    try {
      const pluginConfigs = new PluginStore(this.storage).mcpConfigsFor(chat.projectId);
      mcpConfigs.push(...pluginConfigs);
    } catch {
      /* plugin registry unreadable — skip */
    }
    if (mcpConfigs.length > 0) {
      const mcpErrors = await mcps.start(mcpConfigs, chat.cwd, controller.signal);
      for (const err of mcpErrors) this.storage.log(`mcp: ${err}`);
      for (const t of mcps.listTools()) {
        const fullName = `mcp__${t.server}__${t.name}`;
        tools.push({
          spec: {
            name: fullName,
            description: `${t.description} (MCP tool from server "${t.server}")`,
            parameters: t.inputSchema,
          },
          readOnly: false,
          execute: async (args) => mcps.callTool(t.server, t.name, args),
        });
      }
    }

    const commandCalls = new Set<string>();
    const emit = (ev: AgentEvent) => {
      if (ev.type === "tool-start" && ev.name === "run_command") commandCalls.add(ev.toolCallId);
      // The command tool's timeout requests killTree but does not await process
      // death. Its settled promise alone cannot prove the data root is quiescent.
      if (ev.type === "tool-end" && commandCalls.delete(ev.toolCallId) && ev.output.includes("[exit code: 124]")) {
        this.storage.restoreBarrier.preventRestore("command timeout termination unconfirmed; finish process cleanup and restart before restore");
      }
      applyEventToTimeline(chat.timeline, ev as SharedAgentEvent);
      this.broadcast(chat.id, ev as SharedAgentEvent);
    };

    // N7: load project instructions (.xtracsys.md, then AGENTS.md), capped 16 KB.
    let projectInstructions: string | undefined;
    for (const name of [".xtracsys.md", "AGENTS.md"]) {
      try {
        const p = path.join(chat.cwd, name);
        const stat = await fsp.stat(p);
        if (stat.isFile()) {
          projectInstructions = (await fsp.readFile(p, "utf8")).slice(0, 16_000);
          chat.instructionsChars = projectInstructions.length;
          break;
        }
      } catch {
        /* not present */
      }
    }
    if (!projectInstructions) chat.instructionsChars = 0;

    // v5 R2: skills — catalog metadata for enabled available skills; full instructions
    // only for the skills the user explicitly selected on this chat (bounded).
    let skillsCatalog: string | null = null;
    const skillBodies: string[] = [];
    try {
      const skills = new SkillStore(this.storage);
      const available = skills.availableFor(chat.projectId);
      skillsCatalog = skills.catalogBlock(available);
      const selected = (chat.selectedSkills ?? []).slice(0, SKILLS_LIMITS.maxSelectedPerChat);
      for (const id of selected) {
        if (!available.some((s) => s.id === id)) continue; // disabled/scoped-out skills never load
        const body = await skills.loadInstructions(id);
        if (body) skillBodies.push(`### skill: ${id}\n\n${body}`);
      }
    } catch {
      /* skill catalog unreadable — turn proceeds without skills */
    }

    const sys = systemPrompt({
      cwd: chat.cwd,
      platform: `${os.platform()} ${os.arch()} · Node ${process.version.split(".")[0]}`,
      tools: tools.map((t) => ({ name: t.spec.name, description: t.spec.description })),
      projectInstructions,
      extra: pSet.systemPromptExtra || settings.systemPromptExtra || undefined,
      skillsCatalog,
      skillInstructions: skillBodies,
    });

    // The user's message is appended to history before this call.
    emit({ type: "turn-start", chatId: chat.id, turnId: "t", text, imageCount: turnImages?.length });

      const result = await runAgentTurn({
        chatId: chat.id,
        cwd: chat.cwd,
        scratchDir,
        model,
        provider,
        history: [
          ...chat.messages,
          {
            role: "user",
            content: text,
            images: turnImages,
            ts: Date.now(),
          },
        ],
        systemPrompt: sys,
        tools,
        maxSteps,
        maxHistoryChars: settings.historyCharBudget,
        params: {
          numCtx: typeof numCtx === "number" && numCtx > 0 ? numCtx : undefined,
          temperature: typeof temperature === "number" ? temperature : undefined,
        },
        signal: controller.signal,
        requestApproval: this.approvalGate(chat),
        onPlanUpdate: (entries) => {
          chat.plan = entries;
          this.broadcast(chat.id, { type: "plan", chatId: chat.id, turnId: "t", entries });
          void this.store.persistChat(chat).catch((error) => this.storage.log(`plan persistence failed: ${(error as Error).message}`));
        },
        emit,
      });

      chat.messages = result.messages;
      chat.stats.turns += 1;
      chat.stats.inputTokens += result.usage.inputTokens;
      chat.stats.outputTokens += result.usage.outputTokens;
      chat.stats.lastInputTokens = result.lastInputTokens;
      this.maybePressureNotice(chat, numCtx);
      if (result.error) {
        this.storage.log(`turn error (${chat.id}): ${result.error}`);
        emit({ type: "turn-error", chatId: chat.id, turnId: "t", message: result.error });
      }
      await this.store.persistChat(chat);
      await this.store.writeTranscript(chat, timelineToMarkdown);
      return result.stopReason === "error" ? "error" : "done";
    } finally {
      chat.status = "idle";
      this.aborts.delete(chat.id);
      const shutdownIssues = await mcps.stopAll().catch((error) => [`MCP shutdown failed: ${(error as Error).message}`]);
      if (shutdownIssues.length) this.storage.restoreBarrier.preventRestore("MCP shutdown/termination unconfirmed; finish process cleanup and restart before restore");
      for (const issue of shutdownIssues) {
        this.storage.log(`MCP shutdown warning: ${issue}`);
        this.broadcast(chat.id, { type: "notice", chatId: chat.id, text: `MCP shutdown warning: ${issue}` });
      }
      await this.store.persistChat(chat);
      // N6: dequeue the next queued prompt, if any.
      const q = this.queues.get(chat.id);
      if (q && q.length > 0 && !controller.signal.aborted) {
        const next = q.shift()!;
        if (q.length === 0) this.queues.delete(chat.id);
        this.broadcast(chat.id, { type: "notice", chatId: chat.id, text: "Sending queued message…" });
        void this.runTurn(chat, next.text, next.images).catch((error) => this.storage.log(`queued turn failed: ${(error as Error).message}`));
      } else {
        this.queues.delete(chat.id);
        this.onIdle?.(chat.id);
      }
    }
  }
}

export function scratchPathHint(storage: Storage): string {
  return path.join(storage.dir("tmp"));
}
