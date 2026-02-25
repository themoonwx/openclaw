// src/multi-agent/gateway-integration.ts

// Multi-Agent Gateway Integration
// This file provides standalone integration without importing from index.ts

import { EventBus } from "./event-bus.js";
import { SingleSlotScheduler } from "./scheduler.js";
import type { ClaudeCodeRunner } from "./scheduler.js";
import { PermissionManager } from "./permission.js";
import { MemoryGuard } from "./memory-guard.js";
import { MessageRouter } from "./router.js";
import { Orchestrator } from "./orchestrator.js";
import type { MultiAgentConfig } from "./orchestrator.js";
import type { AgentPersona } from "./agents/base-agent.js";
import type { LLMClient } from "./agents/lightweight.js";
import { OpenClawClaudeCodeRunner } from "./adapters/claude-code.js";
import { OpenClawLLMClient } from "./adapters/llm-client.js";
import { SingleAgentHandler } from "./single-agent-handler.js";
import { routeMessage, getAgentDisplayName, type RouteResult } from "./trigger.js";
import { HealthMonitor } from "./health-monitor.js";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import yaml from "yaml";

// Default configuration
const DEFAULT_CONFIG: MultiAgentConfig = {
  enabled: true,
  scheduler: {
    max_concurrent_claude_code: 1,
    task_timeout_seconds: 300,
    max_retry: 2,
    poll_interval_seconds: 1,
  },
  memory_guard: {
    critical_mb: 200,
    warning_mb: 500,
    check_interval_seconds: 3,
  },
  human_checkpoints: {
    after_requirement: true,
    after_architecture: true,
    after_coding: false,
    after_review: false,
    before_deploy: true,
  },
  triggers: {
    keywords: [
      "开发一个",
      "帮我写一个项目",
      "创建一个应用",
      "搭建一个系统",
      "build a",
      "create a",
      "develop a",
    ],
    intent_detection: true,
  },
};

class MultiAgentSystem {
  private eventBus: EventBus;
  private scheduler: SingleSlotScheduler;
  private permission: PermissionManager;
  private memoryGuard: MemoryGuard;
  private router: MessageRouter;
  private orchestrator: Orchestrator | null = null;
  private config: MultiAgentConfig;

  constructor(
    private workspaceDir: string,
    private dbPath: string,
    private claudeRunner: ClaudeCodeRunner,
    private llmClient: LLMClient,
    configPath?: string,
  ) {
    this.config = this.loadConfig(configPath);
    this.eventBus = new EventBus(this.dbPath);
    this.permission = new PermissionManager(this.workspaceDir);
    this.router = new MessageRouter(this.eventBus);
    this.scheduler = new SingleSlotScheduler(
      this.eventBus,
      this.claudeRunner,
      this.config.scheduler,
    );
    this.memoryGuard = new MemoryGuard(
      this.scheduler,
      this.eventBus,
      this.config.memory_guard,
    );
  }

  private loadConfig(configPath?: string): MultiAgentConfig {
    if (!configPath) {
      return DEFAULT_CONFIG;
    }
    try {
      const content = fs.readFileSync(configPath, "utf-8");
      const loaded = yaml.parse(content);
      return { ...DEFAULT_CONFIG, ...loaded };
    } catch (e) {
      console.warn(`Failed to load config from ${configPath}, using defaults`);
      return DEFAULT_CONFIG;
    }
  }

  async initialize(personasDir?: string) {
    try {
      if (!this.config.enabled) {
        console.log("[MultiAgent] Disabled in config");
        return;
      }

      console.log("[MultiAgent] Loading personas...");
      const personas = await this.loadPersonas(personasDir);
      console.log(`[MultiAgent] Loaded ${personas.size} personas`);

      console.log("[MultiAgent] Creating orchestrator...");
      this.orchestrator = new Orchestrator(
        this.eventBus,
        this.router,
        this.permission,
        this.scheduler,
        this.llmClient,
        this.config,
        personas,
      );
      console.log("[MultiAgent] Orchestrator created");

      console.log("[MultiAgent] Starting scheduler...");
      // Start scheduler in background (it's an infinite loop)
      this.scheduler.start().catch((e) => console.error("[MultiAgent] Scheduler error:", e));
      console.log("[MultiAgent] Scheduler started (background)");

      console.log("[MultiAgent] Starting memory guard...");
      this.memoryGuard.start().catch((e) => console.error("[MultiAgent] Memory guard error:", e));
      console.log("[MultiAgent] Initialized successfully");
    } catch (err) {
      console.error("[MultiAgent] Initialization error:", err);
    }
  }

  private async loadPersonas(dir?: string): Promise<Map<string, AgentPersona>> {
    const personas = new Map<string, AgentPersona>();
    if (!dir) return personas;

    const files = await fs.promises.readdir(dir);
    for (const file of files) {
      if (!file.endsWith(".yaml") && !file.endsWith(".yml")) continue;
      try {
        const content = await fs.promises.readFile(path.join(dir, file), "utf-8");
        const persona = yaml.parse(content) as AgentPersona;
        if (persona.role) personas.set(persona.role, persona);
      } catch (e) {
        console.warn(`Failed to load persona ${file}:`, e);
      }
    }
    return personas;
  }

  async shutdown() {
    await this.scheduler.stop();
    this.eventBus.close();
  }

  getOrchestrator(): Orchestrator | null {
    return this.orchestrator;
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }
}

let multiAgentSystem: MultiAgentSystem | null = null;
let healthMonitor: HealthMonitor | null = null;

export async function initializeMultiAgentGateway(config?: {
  workspaceDir?: string;
  configPath?: string;
  dbPath?: string;
  defaultProvider?: string;
  defaultModel?: string;
  openclawConfig?: unknown;
}): Promise<MultiAgentSystem | null> {
  const workspaceDir =
    config?.workspaceDir ?? path.join(process.env.HOME ?? "", ".openclaw", "workspace");
  const dbPath =
    config?.dbPath ?? path.join(process.env.HOME ?? "", ".openclaw", "data", "multi-agent-events.db");

  const dbDir = path.dirname(dbPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  const claudeRunner = new OpenClawClaudeCodeRunner();
  const llmClient = new OpenClawLLMClient({
    defaultProvider: config?.defaultProvider,
    defaultModel: config?.defaultModel,
  });

  multiAgentSystem = new MultiAgentSystem(
    workspaceDir,
    dbPath,
    claudeRunner,
    llmClient,
    config?.configPath,
  );

  // Try multiple possible paths for personas
  const possiblePaths = [
    path.join(process.cwd(), "config", "personas"),
    path.join(process.cwd(), "..", "config", "personas"),
    "/home/ubuntu/openclaw/config/personas",
  ];
  let personasDir: string | undefined;
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      personasDir = p;
      break;
    }
  }
  console.log(`[MultiAgent] Looking for personas in: ${JSON.stringify(possiblePaths)}, found: ${personasDir}`);
  console.log(`[MultiAgent] About to initialize with personasDir: ${personasDir}`);
  await multiAgentSystem.initialize(personasDir);
  console.log(`[MultiAgent] Initialization complete`);

  // Run health check after multi-agent initialization
  healthMonitor = new HealthMonitor(true);
  console.log(`[HealthMonitor] Starting health check...`);
  const healthResult = await healthMonitor.checkAndFix();

  if (healthResult.action === "auto_fix") {
    console.log(`[HealthMonitor] ${healthResult.message}`);
  } else if (healthResult.action === "trigger_cc") {
    console.error(`[HealthMonitor] ${healthResult.message}`);
    // Trigger Claude Code auto-repair
    await runAutoRepair();
  } else {
    console.log(`[HealthMonitor] ${healthResult.message}`);
  }

  return multiAgentSystem;
}

export function getMultiAgentSystem(): MultiAgentSystem | null {
  return multiAgentSystem;
}

export function isMultiAgentRequest(message: string): boolean {
  if (!multiAgentSystem) return false;
  const orchestrator = multiAgentSystem.getOrchestrator();
  if (!orchestrator) return false;
  return orchestrator.isProjectRequest(message);
}

export async function runMultiAgentProject(
  message: string,
  options?: { projectId?: string },
): Promise<string> {
  if (!multiAgentSystem) throw new Error("Multi-agent system not initialized");
  const orchestrator = multiAgentSystem.getOrchestrator();
  if (!orchestrator) throw new Error("Orchestrator not initialized");
  const projectId = options?.projectId ?? `proj_${Date.now()}`;
  return await orchestrator.runProject(message, projectId);
}

export async function shutdownMultiAgentGateway(): Promise<void> {
  if (multiAgentSystem) {
    await multiAgentSystem.shutdown();
    multiAgentSystem = null;
  }
}

// ========================================
// Auto-repair with Claude Code
// ========================================

const CC_REPAIR_PROMPT = `OpenClaw 健康检查连续 3 次失败，需要你分析和修复问题。

请执行以下步骤：
1. 检查最近的服务日志：sudo journalctl -u openclaw --no-pager -n 50
2. 检查健康检查脚本的输出：bash /home/ubuntu/openclaw/scripts/health-check.sh
3. 分析失败原因并尝试修复
4. 如果需要重启服务，执行：sudo systemctl restart openclaw

请只修复问题，不要做额外的改动。`;

async function triggerClaudeCodeRepair(): Promise<{ success: boolean; output: string }> {
  return new Promise((resolve) => {
    console.log("[CCRepair] Starting Claude Code repair...");

    const proc = spawn("claude", [
      "--dangerously-skip-permissions",
      "-p",
      CC_REPAIR_PROMPT,
    ], {
      cwd: "/home/ubuntu/openclaw",
      env: {
        ...process.env,
        ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL,
        ANTHROPIC_AUTH_TOKEN: process.env.ANTHROPIC_AUTH_TOKEN,
      },
    });

    let output = "";
    let errorOutput = "";

    proc.stdout.on("data", (data) => {
      const text = data.toString();
      output += text;
      console.log("[CCRepair]", text);
    });

    proc.stderr.on("data", (data) => {
      errorOutput += data.toString();
    });

    proc.on("close", (code) => {
      const success = code === 0;
      console.log(`[CCRepair] Claude Code repair finished with code ${code}`);
      resolve({
        success,
        output: output + "\n" + errorOutput,
      });
    });

    proc.on("error", (err) => {
      console.error("[CCRepair] Error:", err.message);
      resolve({
        success: false,
        output: err.message,
      });
    });

    // Timeout after 5 minutes
    setTimeout(() => {
      proc.kill("SIGTERM");
      resolve({
        success: false,
        output: "Repair timeout after 5 minutes",
      });
    }, 300000);
  });
}

export async function runAutoRepair(): Promise<void> {
  console.log("[CCRepair] Running auto-repair with Claude Code...");

  const result = await triggerClaudeCodeRepair();

  if (result.success) {
    console.log("[CCRepair] Repair completed successfully");

    // Reset failure count after successful repair
    if (healthMonitor) {
      healthMonitor.resetFailCount();
      console.log("[CCRepair] Failure count reset");
    }

    // Restart service if needed
    console.log("[CCRepair] Restarting OpenClaw service...");
    const restartProc = spawn("sudo", ["systemctl", "restart", "openclaw"]);
    restartProc.on("close", (code) => {
      console.log(`[CCRepair] Service restart finished with code ${code}`);
    });
  } else {
    console.error("[CCRepair] Repair failed:", result.output.substring(0, 200));
  }
}

// ========================================
// Three-layer trigger exports
// ========================================

export { routeMessage, getAgentDisplayName };
export type { RouteResult } from "./trigger.js";
export { SingleAgentHandler };
export { HealthMonitor };

// Process message with three-layer trigger
export async function processMessageWithTrigger(
  message: string,
  replyFn?: (text: string) => void,
): Promise<{
  shouldHandle: boolean;
  result?: RouteResult;
  response?: string;
}> {
  const route = routeMessage(message);

  switch (route.mode) {
    case "multi_agent": {
      // Full multi-agent project flow
      if (replyFn) {
        replyFn("🚀 已启动多 Agent 协作模式，正在分析需求...");
      }
      const projectId = `proj_${Date.now()}`;
      const result = await runMultiAgentProject(route.content, { projectId });
      return {
        shouldHandle: false,
        result: route,
        response: result,
      };
    }

    case "single_agent": {
      // Single role call
      if (replyFn) {
        const displayName = getAgentDisplayName(route.targetAgent!);
        replyFn(`🤖 正在召唤 ${displayName}...`);
      }

      const handler = getSingleAgentHandler();
      if (!handler) {
        return {
          shouldHandle: true,
          result: route,
          response: undefined,
        };
      }

      const response = await handler.handle(route.targetAgent!, route.content);
      return {
        shouldHandle: false,
        result: route,
        response,
      };
    }

    case "suggest_project": {
      // Normal reply + suggestion
      return {
        shouldHandle: true,
        result: route,
        response: route.suggestion,
      };
    }

    case "single_llm":
    default:
      // Single LLM flow
      return {
        shouldHandle: true,
        result: route,
        response: undefined,
      };
  }
}

let singleAgentHandler: SingleAgentHandler | null = null;

function getSingleAgentHandler(): SingleAgentHandler | null {
  if (!multiAgentSystem) return null;

  const orchestrator = multiAgentSystem.getOrchestrator();
  if (!orchestrator) return null;

  // Get agents from orchestrator
  const agents = new Map<string, unknown>();
  const roles = ["product_manager", "architect", "tester", "frontend", "backend", "devops"];
  for (const role of roles) {
    const agent = (orchestrator as unknown as { getAgent: (r: string) => unknown }).getAgent(role);
    if (agent) agents.set(role, agent);
  }

  // Get event bus and scheduler from multi-agent system
  const eventBus = (multiAgentSystem as unknown as { eventBus: EventBus }).eventBus;
  const scheduler = (multiAgentSystem as unknown as { scheduler: SingleSlotScheduler }).scheduler;

  if (!eventBus || !scheduler) return null;

  singleAgentHandler = new SingleAgentHandler(eventBus, scheduler, agents as Map<string, import("./agents/base-agent.js").BaseAgent>);
  return singleAgentHandler;
}
