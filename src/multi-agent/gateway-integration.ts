// src/multi-agent/gateway-integration.ts

// Multi-Agent Gateway Integration
// This file provides standalone integration without importing from index.ts

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import yaml from "yaml";
import { OpenClawClaudeCodeRunner } from "./adapters/claude-code.js";
import { DirectLLMClient } from "./adapters/llm-client.js";
import type { AgentPersona } from "./agents/base-agent.js";
import type { LLMClient } from "./agents/lightweight.js";
import { EventBus } from "./event-bus.js";
import { HealthMonitor } from "./health-monitor.js";
import { MemoryGuard } from "./memory-guard.js";
import { Orchestrator } from "./orchestrator.js";
import type { MultiAgentConfig } from "./orchestrator.js";
import { PermissionManager } from "./permission.js";
import { MessageRouter } from "./router.js";
import { SingleSlotScheduler } from "./scheduler.js";
import type { ClaudeCodeRunner } from "./scheduler.js";
import { SingleAgentHandler } from "./single-agent-handler.js";
import {
  routeMessage,
  getAgentDisplayName,
  getAgentDisplayTag,
  needsContext,
  type RouteResult,
} from "./trigger.js";

// Default configuration
const DEFAULT_CONFIG: MultiAgentConfig = {
  enabled: true,
  defaultProvider: "minimax",
  scheduler: {
    maxRetry: 2,
    taskTimeoutSeconds: 300,
    pollIntervalSeconds: 1,
  },
  memoryGuard: {
    criticalMb: 200,
    warningMb: 500,
    checkIntervalSeconds: 3,
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
    this.scheduler = new SingleSlotScheduler(this.eventBus, this.claudeRunner, {
      maxRetry: this.config.scheduler.maxRetry,
      taskTimeoutSeconds: this.config.scheduler.taskTimeoutSeconds,
      pollIntervalSeconds: this.config.scheduler.pollIntervalSeconds,
    });
    this.memoryGuard = new MemoryGuard(this.scheduler, this.eventBus, {
      criticalMb: this.config.memoryGuard.criticalMb,
      warningMb: this.config.memoryGuard.warningMb,
      checkIntervalSeconds: this.config.memoryGuard.checkIntervalSeconds,
    });
  }

  private loadConfig(configPath?: string): MultiAgentConfig {
    if (!configPath) {
      return DEFAULT_CONFIG;
    }
    try {
      const content = fs.readFileSync(configPath, "utf-8");
      const loaded = yaml.parse(content);
      return { ...DEFAULT_CONFIG, ...loaded };
    } catch {
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
    if (!dir) {
      return personas;
    }

    const files = await fs.promises.readdir(dir);
    for (const file of files) {
      if (!file.endsWith(".yaml") && !file.endsWith(".yml")) {
        continue;
      }
      try {
        const content = await fs.promises.readFile(path.join(dir, file), "utf-8");
        const persona = yaml.parse(content) as AgentPersona;
        if (persona.role) {
          personas.set(persona.role, persona);
        }
      } catch (err) {
        console.warn(`Failed to load persona ${file}:`, err);
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
    config?.dbPath ??
    path.join(process.env.HOME ?? "", ".openclaw", "data", "multi-agent-events.db");

  const dbDir = path.dirname(dbPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  const claudeRunner = new OpenClawClaudeCodeRunner();

  // Use OpenClaw config (passed from boot hook) or load from multi-agent.yaml
  let openclawConfig: any = config?.openclawConfig ?? {};
  const configPath = config?.configPath;
  if (!openclawConfig && configPath) {
    try {
      const yaml = await import("yaml");
      const fs = await import("node:fs/promises");
      const content = await fs.readFile(configPath, "utf-8");
      openclawConfig = yaml.parse(content) || {};
    } catch (e) {
      console.warn("Failed to load config for LLM client:", e);
    }
  }

  const llmClient = new DirectLLMClient({
    defaultProvider: config?.defaultProvider || "minimax",
    defaultModel: config?.defaultModel,
    config: openclawConfig,
    agentDir: path.join(process.env.HOME ?? "", ".openclaw", "agents", "main", "agent"),
  });

  multiAgentSystem = new MultiAgentSystem(
    workspaceDir,
    dbPath,
    claudeRunner,
    llmClient,
    config?.configPath,
  );

  // Load personas directory - default to ~/.openclaw/agents/personas
  const possiblePaths = [
    path.join(process.env.HOME ?? "", ".openclaw", "agents", "personas"),
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
  console.log(
    `[MultiAgent] Looking for personas in: ${JSON.stringify(possiblePaths)}, found: ${personasDir}`,
  );
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
  if (!multiAgentSystem) {
    return false;
  }
  const orchestrator = multiAgentSystem.getOrchestrator();
  if (!orchestrator) {
    return false;
  }
  return orchestrator.isProjectRequest(message);
}

export async function runMultiAgentProject(
  message: string,
  options?: { projectId?: string },
): Promise<string> {
  if (!multiAgentSystem) {
    throw new Error("Multi-agent system not initialized");
  }
  const orchestrator = multiAgentSystem.getOrchestrator();
  if (!orchestrator) {
    throw new Error("Orchestrator not initialized");
  }
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

    const proc = spawn("claude", ["--dangerously-skip-permissions", "-p", CC_REPAIR_PROMPT], {
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
// Claude Code Task Queue
// ========================================

interface CCTask {
  id: number;
  content: string;
  status: "pending" | "running" | "completed" | "failed";
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  result?: string;
  error?: string;
}

const ccTaskQueue: CCTask[] = [];
let taskIdCounter = 0;
let isProcessingQueue = false;
let notifyUserFn: ((text: string) => void) | null = null;
let currentTaskOutput = ""; // Store current task output for progress查询
let currentTaskId: number | null = null;

// Set notification function (called from dispatch)
export function setNotifyUserFunction(fn: (text: string) => void): void {
  notifyUserFn = fn;
}

// Add task to CC queue
async function addToCCTaskQueue(
  content: string,
  _replyFn?: (text: string) => void,
): Promise<number> {
  const taskId = ++taskIdCounter;
  const task: CCTask = {
    id: taskId,
    content,
    status: "pending",
    createdAt: new Date(),
  };
  ccTaskQueue.push(task);

  console.log(`[CCTask] Task #${taskId} added to queue: ${content.substring(0, 50)}`);

  // Notify user: task added
  const notifyMsg = `📋 **任务 #${taskId} 已加入 CC 队列**\n\n需求: ${content.substring(0, 100)}${content.length > 100 ? "..." : ""}\n\n当前队列: ${ccTaskQueue.filter((t) => t.status === "pending").length} 个待处理`;
  if (notifyUserFn) {
    notifyUserFn(notifyMsg);
  }

  // Start processing queue if not already running
  if (!isProcessingQueue) {
    void processCCTaskQueue();
  }

  return taskId;
}

// Process CC task queue (FIFO)
async function processCCTaskQueue(): Promise<void> {
  if (isProcessingQueue) {
    return;
  }
  isProcessingQueue = true;

  while (ccTaskQueue.length > 0) {
    const task = ccTaskQueue.find((t) => t.status === "pending");
    if (!task) {
      break;
    }

    // Notify user: task started
    const startMsg = `▶️ **任务 #${task.id} 开始执行**\n\n需求: ${task.content.substring(0, 100)}${task.content.length > 100 ? "..." : ""}`;
    if (notifyUserFn) {
      notifyUserFn(startMsg);
    }

    task.status = "running";
    task.startedAt = new Date();
    currentTaskId = task.id; // Track current task
    currentTaskOutput = ""; // Reset output

    console.log(`[CCTask] Starting task #${task.id}`);

    try {
      // Build detailed prompt for Claude Code
      const prompt = buildCCPrompt(task.content);

      // Execute Claude Code
      const result = await executeClaudeCodeTask(prompt);

      task.status = "completed";
      task.completedAt = new Date();
      task.result = result;
      currentTaskId = null; // Clear current task

      console.log(`[CCTask] Task #${task.id} completed`);

      // Notify user: task completed
      const completeMsg = `✅ **任务 #${task.id} 已完成**\n\n${result.substring(0, 500)}${result.length > 500 ? "..." : ""}\n\n---\n完整日志已保存`;
      if (notifyUserFn) {
        notifyUserFn(completeMsg);
      }
    } catch (err) {
      task.status = "failed";
      task.completedAt = new Date();
      task.error = err instanceof Error ? err.message : String(err);
      currentTaskId = null; // Clear current task

      console.error(`[CCTask] Task #${task.id} failed:`, task.error);

      // Notify user: task failed
      const failMsg = `❌ **任务 #${task.id} 执行失败**\n\n错误: ${task.error}`;
      if (notifyUserFn) {
        notifyUserFn(failMsg);
      }
    }
  }

  isProcessingQueue = false;
}

// Build detailed prompt for Claude Code
function buildCCPrompt(userRequest: string): string {
  return `你需要完成以下开发任务。请仔细分析需求，然后逐步实现。

## 用户需求
${userRequest}

## 执行要求
1. 首先理解需求，制定实现计划
2. 按照计划逐步实现代码
3. 每完成一个步骤，简要说明做了什么
4. 如果遇到问题，说明原因和尝试的解决方案
5. 完成后总结完成的工作

## 工作目录
/home/ubuntu/workspace

## GitHub 仓库管理
你可以自主管理 GitHub 仓库：
- 判断是否需要新建仓库（根据项目类型、功能、内容）
- 如果需要新建：使用 \`gh repo create 仓库名 --public\` 创建
- 如果已有相关仓库：可以直接推送
- 推送命令：\`git add . && git commit -m "描述" && git push\`

## GitHub 信息
- 用户名：themoonwx
- 已存在的仓库可在 https://github.com/themoonwx 查看
- 创建新仓库后，GitHub 会提供远程地址，使用 \`git remote add origin <url>\` 添加

请开始执行任务。`;
}

// Build comprehensive prompt with conversation context
async function buildContextPrompt(userRequest: string): Promise<string> {
  // Try to get conversation history from session
  let conversationHistory = "";
  try {
    const sessionFile = path.join(
      process.env.OPENCLAW_STATE_DIR || "/home/ubuntu/.openclaw",
      "sessions",
      "current",
      "history.json",
    );
    if (fs.existsSync(sessionFile)) {
      const history = JSON.parse(fs.readFileSync(sessionFile, "utf-8"));
      if (history.messages && history.messages.length > 0) {
        // Get last 20 messages
        const recentMessages = history.messages.slice(-20);
        conversationHistory = recentMessages
          .map(
            (m: { role: string; content: string }) =>
              `${m.role === "user" ? "用户" : "助手"}: ${m.content.substring(0, 500)}`,
          )
          .join("\n");
      }
    }
  } catch (err) {
    console.log("[CCTask] Could not load conversation history:", err);
  }

  // Build comprehensive prompt
  return `你需要完成以下开发任务。以下是对话上下文和需求分析，请仔细理解后执行。

## 用户最终指令
${userRequest}

## 对话上下文（近期讨论）
${conversationHistory || "（无历史记录）"}

## OP 对需求的理解和拆解
（这是 OP 在与用户讨论过程中形成的需求分析）

## 执行要求
1. 首先理解上面的对话上下文和需求
2. 结合用户最终指令制定实现计划
3. 按照计划逐步实现代码
4. 每完成一个步骤，简要说明
5. 完成后总结完成的工作

## 工作目录
/home/ubuntu/workspace

## GitHub 仓库管理
你可以自主管理 GitHub 仓库：
- 判断是否需要新建仓库（根据项目类型、功能、内容）
- 如果需要新建：使用 \`gh repo create 仓库名 --public\` 创建
- 如果已有相关仓库：可以直接推送
- 推送命令：\`git add . && git commit -m "描述" && git push\`

## GitHub 信息
- 用户名：themoonwx
- 已存在的仓库可在 https://github.com/themoonwx 查看
- 创建新仓库后，GitHub 会提供远程地址，使用 \`git remote add origin <url>\` 添加

请开始执行任务。`;
}

// Execute Claude Code task with interaction support
async function executeClaudeCodeTask(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    console.log("[CCTask] Starting Claude Code in interactive mode...");

    // Use non-interactive mode -p for reliable execution
    // This prevents CC from asking questions and just does the task
    const proc = spawn("claude", ["--dangerously-skip-permissions", "-p", prompt], {
      cwd: "/home/ubuntu/workspace",
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
      currentTaskOutput += text; // Store for progress查询
      console.log("[CCTask]", text.substring(0, 300));
    });

    proc.stderr.on("data", (data) => {
      errorOutput += data.toString();
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve(output);
      } else if (code === null) {
        // Killed by timeout
        reject(new Error("Task timeout after 10 minutes"));
      } else {
        reject(new Error(`Claude Code exited with code ${code}: ${errorOutput}`));
      }
    });

    proc.on("error", (err) => {
      reject(err);
    });

    // No interactive Q&A - CC runs in non-interactive mode
    // Progress can be monitored by checking the process output
    // Use -p mode for simpler execution without stdin
    // This is simpler and more reliable

    // Timeout after 10 minutes
    setTimeout(() => {
      console.log("[CCTask] Task timeout, killing process...");
      proc.kill("SIGTERM");
      reject(new Error("Task timeout after 10 minutes"));
    }, 600000);
  });
}

// Get queue status
export function getCCTaskQueueStatus(): {
  pending: number;
  running: number;
  completed: number;
  failed: number;
} {
  return {
    pending: ccTaskQueue.filter((t) => t.status === "pending").length,
    running: ccTaskQueue.filter((t) => t.status === "running").length,
    completed: ccTaskQueue.filter((t) => t.status === "completed").length,
    failed: ccTaskQueue.filter((t) => t.status === "failed").length,
  };
}

// Get current task progress
export function getCurrentTaskProgress(): {
  taskId: number | null;
  output: string;
  status: string;
} | null {
  if (currentTaskId === null) {
    return null;
  }

  const task = ccTaskQueue.find((t) => t.id === currentTaskId);
  return {
    taskId: currentTaskId,
    output: currentTaskOutput.slice(-3000), // Last 3000 chars
    status: task?.status || "unknown",
  };
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
        response: `【项目】\n\n${result}`,
      };
    }

    case "single_agent": {
      // Single role call
      console.log("[DEBUG] Entering single_agent case, route:", JSON.stringify(route).substring(0, 100));
      const displayName = getAgentDisplayName(route.targetAgent!);
      const displayTag = getAgentDisplayTag(route.targetAgent!);

      // Check if this request needs context from main agent
      const needsMainContext = needsContext(route.content);

      // Get session directory - find the most recent main session
      let contextInfo = "";
      if (needsMainContext) {
        console.log(`[Trigger] ${route.targetAgent} request needs context from main agent`);

        // Try to get main session history
        try {
          const mainSessionPath = path.join(
            process.env.OPENCLAW_AGENTS_DIR || "/home/ubuntu/.openclaw/agents/main/sessions",
          );

          // Find the most recent session file
          const files = fs.readdirSync(mainSessionPath)
            .filter(f => f.endsWith('.jsonl'))
            .filter(f => !f.includes('.deleted.'))
            .sort((a, b) => {
              const statA = fs.statSync(path.join(mainSessionPath, a));
              const statB = fs.statSync(path.join(mainSessionPath, b));
              return statB.mtime.getTime() - statA.mtime.getTime();
            });

          if (files.length > 0) {
            const latestSession = path.join(mainSessionPath, files[0]);
            const lines = fs.readFileSync(latestSession, 'utf-8').split('\n').filter(Boolean);

            // Get last 10 lines that contain user messages
            const recentMessages: string[] = [];
            for (let i = lines.length - 1; i >= 0 && recentMessages.length < 5; i--) {
              try {
                const entry = JSON.parse(lines[i]);
                if (entry.type === 'message' && entry.message?.role === 'user') {
                  const text = entry.message?.content?.[0]?.text || '';
                  // Extract just the user's message content
                  const userMsg = text.replace(/System:.*?DM from.*?: /, '').substring(0, 500);
                  recentMessages.unshift(userMsg);
                }
              } catch {}
            }

            if (recentMessages.length > 0) {
              contextInfo = `\n\n【主对话上下文】\n${recentMessages.join('\n')}\n\n【以上是主对话历史，请基于此继续任务】\n\n`;
              console.log(`[Trigger] Got ${recentMessages.length} context messages from main session`);
            }
          }
        } catch (err) {
          console.error("[Trigger] Failed to get main session context:", err);
        }
      }

      console.log("[DEBUG] About to get handler for:", route.targetAgent);
      const handler = getSingleAgentHandler();
      console.log("[DEBUG] Handler instance:", !!handler, "targetAgent:", route.targetAgent);
      if (!handler) {
        console.log("[DEBUG] No handler found, checking multiAgentSystem");
        console.log("[DEBUG] multiAgentSystem exists:", !!multiAgentSystem);
        if (multiAgentSystem) {
          const orch = multiAgentSystem.getOrchestrator();
          console.log("[DEBUG] orchestrator exists:", !!orch);
        }
        console.log("[Trigger] WARNING: No handler found for single_agent");
        return {
          shouldHandle: true,
          result: route,
          response: undefined,
        };
      }

      console.log("[DEBUG] About to call handler.handle, content length:", (contextInfo + route.content).length);
      try {
        const response = await handler.handle(route.targetAgent!, contextInfo + route.content);
        console.log("[DEBUG] handler.handle returned, response length:", response?.length);
        console.log("[Trigger] Handler response received, length:", response?.length);
        return {
          shouldHandle: false,
          result: route,
          response: `${displayTag}\n\n${response}`,
        };
      } catch (err) {
        console.error("[Trigger] Handler error:", err);
        console.error("[Trigger] Error stack:", err instanceof Error ? err.stack : "");
        return {
          shouldHandle: true,
          result: route,
          response: undefined,
        };
      }
    }

    case "cc_task": {
      // Claude Code task - add to queue and notify
      if (replyFn) {
        replyFn("📋 任务已加入 CC 队列，正在准备需求文档...");
      }

      // Add to CC task queue
      const taskId = await addToCCTaskQueue(route.content, replyFn);
      return {
        shouldHandle: false,
        result: route,
        response: `【CC】\n\n任务 #${taskId} 已加入队列`,
      };
    }

    case "cc_task_with_context": {
      // Claude Code task with conversation context - get history and OP analysis
      if (replyFn) {
        replyFn("📋 正在整理对话上下文和需求分析，然后加入 CC 队列...");
      }

      // Get context and build comprehensive prompt
      const contextPrompt = await buildContextPrompt(route.content);

      // Add to CC task queue with full context
      const taskId = await addToCCTaskQueue(contextPrompt, replyFn);
      return {
        shouldHandle: false,
        result: route,
        response: `【CC】\n\n任务 #${taskId} 已加入队列（含对话上下文）`,
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
  if (!multiAgentSystem) {
    console.log("[SingleAgent] No multi-agent system");
    return null;
  }

  const orchestrator = multiAgentSystem.getOrchestrator();
  if (!orchestrator) {
    console.log("[SingleAgent] No orchestrator");
    return null;
  }

  // Get agents from orchestrator
  const agents = new Map<string, unknown>();
  const roles = ["product_manager", "architect", "tester", "frontend", "backend", "devops"];
  for (const role of roles) {
    const agent = (orchestrator as unknown as { getAgent: (r: string) => unknown }).getAgent(role);
    if (agent) {
      agents.set(role, agent);
    }
  }
  console.log("[SingleAgent] Agents loaded:", [...agents.keys()]);

  // Get event bus and scheduler from multi-agent system
  const eventBus = (multiAgentSystem as unknown as { eventBus: EventBus }).eventBus;
  const scheduler = (multiAgentSystem as unknown as { scheduler: SingleSlotScheduler }).scheduler;

  if (!eventBus || !scheduler) {
    console.log("[SingleAgent] Missing eventBus or scheduler:", {
      eventBus: !!eventBus,
      scheduler: !!scheduler,
    });
    return null;
  }

  singleAgentHandler = new SingleAgentHandler(
    eventBus,
    scheduler,
    agents as Map<string, import("./agents/base-agent.js").BaseAgent>,
  );
  return singleAgentHandler;
}
