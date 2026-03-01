// src/multi-agent/index.ts

import fs from "node:fs";
import path from "node:path";
import yaml from "yaml";
import type { AgentPersona } from "./agents/base-agent.js";
import type { LLMClient } from "./agents/lightweight.js";
import { EventBus } from "./event-bus.js";
import { MemoryGuard } from "./memory-guard.js";
import { Orchestrator, type MultiAgentConfig } from "./orchestrator.js";
import { PermissionManager } from "./permission.js";
import { MessageRouter } from "./router.js";
import { SingleSlotScheduler, type ClaudeCodeRunner } from "./scheduler.js";

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
    this.memoryGuard = new MemoryGuard(this.scheduler, this.eventBus, this.config.memoryGuard);
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
    const personas = this.loadPersonas(personasDir);

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

  private loadPersonas(dir?: string): Map<string, AgentPersona> {
    const personas = new Map<string, AgentPersona>();

    if (!dir) {
      return personas;
    }

    const files = fs.readdirSync(dir);
    for (const file of files) {
      if (!file.endsWith(".yaml") && !file.endsWith(".yml")) {
        continue;
      }

      try {
        const content = fs.readFileSync(path.join(dir, file), "utf-8");
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
