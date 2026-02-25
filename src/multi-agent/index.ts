// src/multi-agent/index.ts

import fs from "node:fs/promises";
import path from "node:path";
import yaml from "yaml";
import { EventBus } from "./event-bus.js";
import { SingleSlotScheduler, type ClaudeCodeRunner } from "./scheduler.js";
import { PermissionManager } from "./permission.js";
import { MemoryGuard } from "./memory-guard.js";
import { MessageRouter } from "./router.js";
import {
  Orchestrator,
  type MultiAgentConfig,
} from "./orchestrator.js";
import type { AgentPersona } from "./agents/base-agent.js";
import type { LLMClient } from "./agents/lightweight.js";

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

export class MultiAgentSystem {
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
    // Load config
    this.config = this.loadConfig(configPath);

    // Initialize core components
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
    if (!this.config.enabled) {
      console.log("[MultiAgent] Disabled in config");
      return;
    }

    // Load personas
    const personas = await this.loadPersonas(personasDir);

    // Create orchestrator
    this.orchestrator = new Orchestrator(
      this.eventBus,
      this.router,
      this.permission,
      this.scheduler,
      this.llmClient,
      this.config,
      personas,
    );

    // Start scheduler
    await this.scheduler.start();

    // Start memory guard (in background)
    this.memoryGuard.start().catch(console.error);

    console.log("[MultiAgent] Initialized successfully");
  }

  private async loadPersonas(dir?: string): Promise<Map<string, AgentPersona>> {
    const personas = new Map<string, AgentPersona>();

    if (!dir) {
      return personas;
    }

    const files = await fs.readdir(dir);
    for (const file of files) {
      if (!file.endsWith(".yaml") && !file.endsWith(".yml")) {
        continue;
      }

      try {
        const content = await fs.readFile(path.join(dir, file), "utf-8");
        const persona = yaml.parse(content) as AgentPersona;
        if (persona.role) {
          personas.set(persona.role, persona);
        }
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

export type { MultiAgentConfig } from "./orchestrator.js";
