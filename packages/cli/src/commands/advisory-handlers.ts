import { join } from "node:path";
import type { AdvisoryHandler, AdvisoryHandlerInput, LedgerEntry } from "@grimoirelabs/core";
import { SqliteStateStore } from "@grimoirelabs/core";
import type { AgentSessionEvent, ResourceDiagnostic, Skill } from "@mariozechner/pi-coding-agent";
import {
  AuthStorage,
  createAgentSession,
  createCodingTools,
  createReadOnlyTools,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
  SettingsManager,
} from "@mariozechner/pi-coding-agent";
import {
  createVerboseSessionTracer,
  emitToolTrace,
  summarizeContextSnapshot,
  tracePrefix,
} from "./advisory-verbose-trace.js";

type PiToolsMode = "none" | "read" | "coding";

export interface PiAdvisoryConfig {
  cwd?: string;
  agentDir?: string;
  advisorSkillsDirs: string[];
  tools: PiToolsMode;
  provider?: string;
  modelId?: string;
  thinkingLevel?: "off" | "low" | "medium" | "high";
  mode?: "auto" | "force";
  traceVerbose?: boolean;
  traceLogger?: (message: string) => void;
}

export interface AdvisoryRuntimeOptions {
  advisoryPi?: boolean;
  advisoryReplay?: string;
  advisoryProvider?: string;
  advisoryModel?: string;
  advisoryThinking?: "off" | "low" | "medium" | "high";
  advisoryTools?: PiToolsMode;
  advisorSkillsDirs: string[];
  stateDir?: string;
  noState?: boolean;
  agentDir?: string;
  cwd?: string;
  advisoryTraceVerbose?: boolean;
  advisoryTraceLogger?: (message: string) => void;
}

export async function resolveAdvisoryHandler(
  spellId: string,
  options: AdvisoryRuntimeOptions
): Promise<AdvisoryHandler | undefined> {
  let handler: AdvisoryHandler | undefined;

  if (options.advisoryReplay) {
    if (options.noState) {
      throw new Error("--advisory-replay requires state persistence (omit --no-state)");
    }
    const ledgerEvents = await loadLedger(spellId, options.advisoryReplay, options.stateDir);
    handler = createReplayAdvisoryHandler(ledgerEvents);
  }

  if (!handler) {
    handler = createPiAdvisoryHandler({
      cwd: options.cwd,
      agentDir: options.agentDir,
      advisorSkillsDirs: options.advisorSkillsDirs,
      tools: options.advisoryTools ?? "read",
      provider: options.advisoryProvider,
      modelId: options.advisoryModel,
      thinkingLevel: options.advisoryThinking,
      mode: options.advisoryPi ? "force" : "auto",
      traceVerbose: options.advisoryTraceVerbose,
      traceLogger: options.advisoryTraceLogger,
    });
  }

  return handler;
}

export function createPiAdvisoryHandler(config: PiAdvisoryConfig): AdvisoryHandler {
  const cwd = config.cwd ?? process.cwd();
  const agentDir = config.agentDir ?? process.env.PI_AGENT_DIR;
  const authPath = agentDir ? join(agentDir, "auth.json") : undefined;
  const modelsPath = agentDir ? join(agentDir, "models.json") : undefined;

  const authStorage = AuthStorage.create(authPath);
  const modelRegistry = new ModelRegistry(authStorage, modelsPath);
  const settingsManager = SettingsManager.create(cwd, agentDir);
  const mode = config.mode ?? "force";
  const traceVerbose = config.traceVerbose === true;
  const traceLogger = config.traceLogger;
  const verboseEnabled = traceVerbose && typeof traceLogger === "function";

  return async (input: AdvisoryHandlerInput): Promise<unknown> => {
    if (verboseEnabled) {
      const contextSummary = summarizeContextSnapshot(input.context);
      traceLogger(`${tracePrefix(input.stepId)} context=${contextSummary}`);
    }

    const tools = resolveTools(config.tools, cwd, input.allowedTools);
    const resourceLoader = new DefaultResourceLoader({
      cwd,
      agentDir,
      settingsManager,
      additionalSkillPaths: config.advisorSkillsDirs,
      skillsOverride: (current: { skills: Skill[]; diagnostics: ResourceDiagnostic[] }) => {
        if (!input.skills || input.skills.length === 0) {
          return current;
        }
        const filtered = current.skills.filter((skill) => input.skills?.includes(skill.name));
        return { skills: filtered, diagnostics: current.diagnostics };
      },
      agentsFilesOverride: () => ({ agentsFiles: [] }),
      appendSystemPromptOverride: (base: string[]) => [
        ...base,
        "## Advisory Output Contract",
        "- Return ONLY valid JSON.",
        "- Do not include Markdown, code fences, or prose.",
        "- Use the provided output schema exactly.",
        "- Do not perform side effects.",
      ],
    });

    await resourceLoader.reload();

    if (mode === "auto" && !hasConfiguredModel(config, input, settingsManager)) {
      throw new Error("No advisory model configured");
    }

    const model = await resolveModel(modelRegistry, settingsManager, config, input, {
      allowFallbackToFirstAvailable: mode === "force",
    });
    if (!model) {
      throw new Error("No available Pi model found for advisory");
    }

    input.emit?.({
      type: "advisory_model_used",
      stepId: input.stepId,
      provider: model.provider,
      modelId: model.id,
      thinkingLevel: config.thinkingLevel,
    });

    const { session } = await createAgentSession({
      model,
      thinkingLevel: config.thinkingLevel,
      tools,
      authStorage,
      modelRegistry,
      resourceLoader,
      sessionManager: SessionManager.inMemory(),
      settingsManager,
    });

    const verboseTrace = verboseEnabled
      ? createVerboseSessionTracer(input.stepId, traceLogger)
      : undefined;

    let activeTextBuffer = "";
    const completedTextBuffers: string[] = [];

    const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
      emitToolTrace(event, input);
      verboseTrace?.handle(event);
      if (event.type !== "message_update") return;
      const detail = event.assistantMessageEvent as { type?: unknown; delta?: unknown };
      if (detail.type === "text_start") {
        activeTextBuffer = "";
        return;
      }
      if (detail.type === "text_delta" && typeof detail.delta === "string") {
        activeTextBuffer += detail.delta;
        return;
      }
      if (detail.type === "text_end") {
        const trimmed = activeTextBuffer.trim();
        if (trimmed.length > 0) {
          completedTextBuffers.push(activeTextBuffer);
        }
        activeTextBuffer = "";
      }
    });

    try {
      const prompt = buildAdvisoryPrompt(input);
      await session.prompt(prompt);
      const responseText = extractAssistantText(session.messages);
      return parseJsonResponse(responseText);
    } catch (error) {
      const fallbackText = extractTextFromEventBuffers(completedTextBuffers, activeTextBuffer);
      if (!fallbackText) throw error;
      return parseJsonResponse(fallbackText);
    } finally {
      unsubscribe();
      verboseTrace?.flushAll();
      session.dispose();
    }
  };
}

export function createReplayAdvisoryHandler(ledgerEvents: LedgerEntry[]): AdvisoryHandler {
  const advisoryStepIds = new Set<string>();
  for (const entry of ledgerEvents) {
    if (entry.event.type === "step_started" && entry.event.kind === "advisory") {
      advisoryStepIds.add(entry.event.stepId);
    }
  }
  const outputs = new Map<string, unknown>();
  for (const entry of ledgerEvents) {
    if (entry.event.type === "step_completed" && advisoryStepIds.has(entry.event.stepId)) {
      outputs.set(entry.event.stepId, entry.event.result);
    }
  }

  return async (input: AdvisoryHandlerInput): Promise<unknown> => {
    if (outputs.has(input.stepId)) {
      return outputs.get(input.stepId);
    }
    throw new Error(`No advisory output found for step ${input.stepId} in replay data`);
  };
}

async function loadLedger(
  spellId: string,
  runId: string,
  stateDir?: string
): Promise<LedgerEntry[]> {
  const dbPath = stateDir ? join(stateDir, "grimoire.db") : undefined;
  const store = new SqliteStateStore({ dbPath });
  try {
    const ledger = await store.loadLedger(spellId, runId);
    if (!ledger) {
      throw new Error(`No ledger found for run ${runId}`);
    }
    return ledger;
  } finally {
    store.close();
  }
}

function resolveTools(mode: PiToolsMode, cwd: string, allowedTools?: string[]) {
  if (mode === "none") return [];
  const baseTools = mode === "coding" ? createCodingTools(cwd) : createReadOnlyTools(cwd);
  if (!allowedTools || allowedTools.length === 0) return baseTools;
  const filtered = baseTools.filter((tool) => allowedTools.includes(tool.name));
  const missing = allowedTools.filter((name) => !filtered.some((tool) => tool.name === name));
  if (missing.length > 0) {
    throw new Error(`Advisor tools not available: ${missing.join(", ")}`);
  }
  return filtered;
}

async function resolveModel(
  modelRegistry: ModelRegistry,
  settingsManager: SettingsManager,
  config: PiAdvisoryConfig,
  input: AdvisoryHandlerInput,
  options: { allowFallbackToFirstAvailable: boolean }
) {
  if (config.provider && config.modelId) {
    return modelRegistry.find(config.provider, config.modelId);
  }

  const parsed = parseAdvisorModel(input.model);
  if (parsed?.provider && parsed.modelId) {
    const found = modelRegistry.find(parsed.provider, parsed.modelId);
    if (found) return found;
  }

  if (parsed?.modelId && !parsed.provider) {
    const available = await modelRegistry.getAvailable();
    const match = available.find((model) => model.id === parsed.modelId);
    if (match) return match;
  }

  const defaultProvider = settingsManager.getDefaultProvider();
  const defaultModel = settingsManager.getDefaultModel();
  if (defaultProvider && defaultModel) {
    const found = modelRegistry.find(defaultProvider, defaultModel);
    if (found) return found;
  }

  if (!options.allowFallbackToFirstAvailable) {
    return undefined;
  }

  const available = await modelRegistry.getAvailable();
  return available[0];
}

function hasConfiguredModel(
  config: PiAdvisoryConfig,
  input: AdvisoryHandlerInput,
  settingsManager: SettingsManager
): boolean {
  if (typeof config.modelId === "string" && config.modelId.trim().length > 0) return true;
  if (typeof input.model === "string" && input.model.trim().length > 0) return true;
  const defaultProvider = settingsManager.getDefaultProvider();
  const defaultModel = settingsManager.getDefaultModel();
  return Boolean(defaultProvider && defaultModel);
}

function parseAdvisorModel(model?: string): { provider?: string; modelId?: string } | null {
  if (!model) return null;
  if (model.includes("/")) {
    const [provider, ...rest] = model.split("/");
    if (provider && rest.length > 0) {
      return { provider, modelId: rest.join("/") };
    }
  }
  if (model.includes(":")) {
    const [provider, ...rest] = model.split(":");
    if (provider && rest.length > 0) {
      return { provider, modelId: rest.join(":") };
    }
  }
  return { modelId: model };
}

function buildAdvisoryPrompt(input: AdvisoryHandlerInput): string {
  const schema = JSON.stringify(input.outputSchema, null, 2);
  const context = JSON.stringify(input.context, null, 2);
  const tooling = JSON.stringify(
    {
      skills: input.skills ?? [],
      allowedTools: input.allowedTools ?? [],
      mcp: input.mcp ?? [],
    },
    null,
    2
  );
  const outputGuide = describeOutputShape(input.outputSchema);
  const outputExample = JSON.stringify(buildOutputExample(input.outputSchema), null, 2);
  return [
    "You are executing an advisory decision for Grimoire.",
    "Return ONLY valid JSON that matches the output schema.",
    "Return the final JSON value itself, not a schema object or wrapper.",
    `Output shape: ${outputGuide}`,
    `Valid example output:\n${outputExample}`,
    "",
    "Advisory prompt:",
    input.prompt,
    "",
    "Output schema (JSON):",
    schema,
    "",
    "Context snapshot:",
    context,
    "",
    "Advisor tooling metadata:",
    tooling,
  ].join("\n");
}

function describeOutputShape(schema: AdvisoryHandlerInput["outputSchema"]): string {
  switch (schema.type) {
    case "boolean":
      return 'JSON boolean literal (`true` or `false`). Do not return an object like {"type": false}.';
    case "number":
      return "JSON number literal (for example `42`), not a string.";
    case "string":
      return 'JSON string literal (for example "hold").';
    case "enum": {
      const values = schema.values?.map((v) => JSON.stringify(v)).join(", ") ?? "";
      return `One of the allowed enum string values: ${values}.`;
    }
    case "array":
      return "JSON array.";
    case "object":
      return "JSON object matching the declared fields.";
    default:
      return "Valid JSON.";
  }
}

function buildOutputExample(schema: AdvisoryHandlerInput["outputSchema"]): unknown {
  switch (schema.type) {
    case "boolean":
      return false;
    case "number":
      return typeof schema.min === "number" ? schema.min : 0;
    case "string":
      return "example";
    case "enum":
      return schema.values?.[0] ?? "";
    case "array":
      if (!schema.items) return [];
      return [buildOutputExample(schema.items)];
    case "object": {
      const fields = schema.fields ?? {};
      const example: Record<string, unknown> = {};
      for (const [key, fieldSchema] of Object.entries(fields)) {
        example[key] = buildOutputExample(fieldSchema);
      }
      return example;
    }
    default:
      return null;
  }
}

function extractAssistantText(
  messages: Array<{ role?: string; content?: unknown; text?: unknown }>
): string {
  let lastAssistantError: string | undefined;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message?.role !== "assistant") continue;
    const messageRecord = message as Record<string, unknown>;
    const assistantError =
      readStringCandidate(messageRecord.errorMessage) ?? readStringCandidate(messageRecord.error);
    if (assistantError) {
      lastAssistantError = assistantError;
    }
    const content = message.content ?? message.text;
    if (typeof content === "string") return content;
    if (typeof content === "object" && content !== null) {
      const obj = content as {
        text?: unknown;
        output_text?: unknown;
        content?: unknown;
        value?: unknown;
      };
      const scalarCandidate =
        readStringCandidate(obj.text) ??
        readStringCandidate(obj.output_text) ??
        readStringCandidate(obj.content) ??
        readStringCandidate(obj.value);
      if (scalarCandidate) return scalarCandidate;
    }
    if (Array.isArray(content)) {
      const textBlocks = content
        .map((block) => {
          if (typeof block !== "object" || block === null) {
            return undefined;
          }
          const typedBlock = block as {
            type?: string;
            text?: unknown;
            output_text?: unknown;
            content?: unknown;
            value?: unknown;
          };
          if (typedBlock.type !== "text" && typedBlock.type !== "output_text") {
            return undefined;
          }
          return (
            readStringCandidate(typedBlock.text) ??
            readStringCandidate(typedBlock.output_text) ??
            readStringCandidate(typedBlock.content) ??
            readStringCandidate(typedBlock.value)
          );
        })
        .filter((text): text is string => typeof text === "string");
      if (textBlocks.length > 0) return textBlocks.join("");
    }
  }
  if (lastAssistantError) {
    throw new Error(`Advisory model returned no text response: ${lastAssistantError}`);
  }
  throw new Error("No assistant response found for advisory");
}

function readStringCandidate(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? value : undefined;
}

function extractTextFromEventBuffers(completed: string[], active: string): string | undefined {
  if (active.trim().length > 0) {
    completed.push(active);
  }
  for (let i = completed.length - 1; i >= 0; i -= 1) {
    const candidate = completed[i];
    if (typeof candidate !== "string") continue;
    const trimmed = candidate.trim();
    if (trimmed.length > 0) return candidate;
  }
  return undefined;
}

function parseJsonResponse(text: string): unknown {
  const cleaned = stripCodeFences(text.trim());
  const jsonText = extractJsonSnippet(cleaned);
  return JSON.parse(jsonText);
}

function stripCodeFences(text: string): string {
  if (!text.startsWith("```")) return text;
  const lines = text.split("\n");
  const firstFence = lines[0] ?? "";
  const lastFenceIndex = lines.lastIndexOf("```");
  if (lastFenceIndex <= 0) return text;
  const contentLines = lines.slice(1, lastFenceIndex);
  if (firstFence.startsWith("```json")) {
    return contentLines.join("\n");
  }
  return contentLines.join("\n");
}

function extractJsonSnippet(text: string): string {
  const objectMatch = text.match(/\{[\s\S]*\}/);
  if (objectMatch) return objectMatch[0];
  const arrayMatch = text.match(/\[[\s\S]*\]/);
  if (arrayMatch) return arrayMatch[0];
  return text;
}
