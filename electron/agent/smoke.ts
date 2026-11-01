/**
 * Smoke test: runs one real agent turn against a local backend, no Electron needed.
 *   node dist-electron/agent/smoke.js [ollama|llamacpp] [model]
 * Requires Ollama on 127.0.0.1:11434 (or llama.cpp server on :8080).
 * The agent is asked to inspect a scratch project dir and write a file — proving
 * tool listing, file writing, and the multi-step loop work end to end.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createOllamaProvider } from "./providers/ollama";
import { createLlamaCppProvider } from "./providers/llamacpp";
import { defaultTools, resolveWithin } from "./tools";
import { systemPrompt } from "./prompt";
import { runAgentTurn } from "./loop";

async function pickBackend(backendArg: string | undefined, modelArg: string | undefined) {
  const backends: { name: string; make: () => { provider: ReturnType<typeof createOllamaProvider>; url: string } }[] = [
    { name: "ollama", make: () => ({ provider: createOllamaProvider("http://127.0.0.1:11434"), url: "http://127.0.0.1:11434" }) },
    { name: "llamacpp", make: () => ({ provider: createLlamaCppProvider("http://127.0.0.1:8080"), url: "http://127.0.0.1:8080" }) },
  ];
  const order = backendArg ? backends.filter((b) => b.name === backendArg) : backends;
  for (const b of order) {
    const { provider, url } = b.make();
    try {
      const models = await provider.listModels();
      console.log(`[smoke] ${b.name} reachable at ${url}: ${models.length} models`);
      let model = modelArg;
      if (!model) {
        // Prefer a coding-capable model if present, else the first.
        const preferred = models.find((m) => /coder|qwen|llama|granite|gpt-oss/i.test(m));
        model = preferred ?? models[0];
      }
      console.log(`[smoke] using model: ${model}`);
      return { provider, model: model! };
    } catch (e) {
      console.log(`[smoke] ${b.name} unreachable: ${(e as Error).message}`);
    }
  }
  throw new Error("No local backend reachable. Start Ollama (ollama serve) or llama-server.");
}

async function main() {
  const backendArg = process.argv[2] === "llamacpp" ? "llamacpp" : process.argv[2] === "ollama" ? "ollama" : undefined;
  const modelArg = process.argv[3];
  const { provider, model } = await pickBackend(backendArg, modelArg);

  // Scratch project dir with something to discover.
  const scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xtrac-smoke-"));
  const projectDir = path.join(scratchRoot, "project");
  fs.mkdirSync(projectDir);
  fs.writeFileSync(
    path.join(projectDir, "notes.txt"),
    "The secret word is: ANVIL-7\nThis file was planted by the smoke test.\n",
  );

  const tools = defaultTools();
  const sys = systemPrompt({
    cwd: projectDir,
    platform: `${os.platform()} ${os.arch()}`,
    tools: tools.map((t) => ({ name: t.spec.name, description: t.spec.description })),
  });

  const start = Date.now();
  const result = await runAgentTurn({
    chatId: "smoke",
    cwd: projectDir,
    scratchDir: scratchRoot,
    model,
    provider,
    history: [
      {
        role: "user",
        content:
          "Find the secret word inside this project and write it to a new file called answer.txt at the project root (content = just the secret word). Then reply DONE and nothing else.",
        ts: Date.now(),
      },
    ],
    systemPrompt: sys,
    tools,
    maxSteps: 8,
    signal: new AbortController().signal,
    requestApproval: async () => true,
    emit: (ev) => {
      switch (ev.type) {
        case "text-delta":
          process.stdout.write(ev.delta);
          break;
        case "thought-delta":
          break;
        case "tool-start":
          console.log(`\n[tool] ${ev.name} ${JSON.stringify(ev.args).slice(0, 200)}`);
          break;
        case "tool-end":
          console.log(`[tool:${ev.ok ? "ok" : "fail"}] ${ev.output.slice(0, 300)}`);
          break;
        default:
          break;
      }
    },
  });

  console.log(`\n[smoke] stopReason=${result.stopReason} steps=${result.steps} in=${result.usage.inputTokens} out=${result.usage.outputTokens} elapsed=${((Date.now() - start) / 1000).toFixed(1)}s`);
  if (result.error) console.log(`[smoke] error: ${result.error}`);

  const answerPath = resolveWithin(projectDir, "answer.txt");
  const answer = fs.existsSync(answerPath) ? fs.readFileSync(answerPath, "utf8").trim() : "(missing)";
  console.log(`[smoke] answer.txt: ${answer}`);
  const pass = answer === "ANVIL-7" && result.stopReason !== "error";
  console.log(`[smoke] ${pass ? "PASS" : "FAIL"}`);
  fs.rmSync(scratchRoot, { recursive: true, force: true });
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error("[smoke] fatal:", e);
  process.exit(1);
});
