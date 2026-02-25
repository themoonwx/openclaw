// src/multi-agent/orchestrator.ts

import type { EventBus, AgentEvent } from "./event-bus.js";
import type { MessageRouter } from "./router.js";
import type { PermissionManager } from "./permission.js";
import type { SingleSlotScheduler } from "./scheduler.js";
import type { BaseAgent, AgentPersona, AgentTask } from "./agents/base-agent.js";
import { ProductManagerAgent, ArchitectAgent, TesterAgent } from "./agents/lightweight.js";
import { FrontendAgent, BackendAgent, DevopsAgent } from "./agents/heavy.js";
import type { LLMClient } from "./agents/lightweight.js";

export interface MultiAgentConfig {
  enabled: boolean;
  scheduler: {
    max_concurrent_claude_code: number;
    task_timeout_seconds: number;
    max_retry: number;
    poll_interval_seconds: number;
  };
  memory_guard: {
    critical_mb: number;
    warning_mb: number;
    check_interval_seconds: number;
  };
  human_checkpoints: {
    after_requirement: boolean;
    after_architecture: boolean;
    after_coding: boolean;
    after_review: boolean;
    before_deploy: boolean;
  };
  triggers: {
    keywords: string[];
    intent_detection: boolean;
  };
}

export class Orchestrator {
  private agents: Map<string, BaseAgent>;
  private config: MultiAgentConfig;

  constructor(
    private eventBus: EventBus,
    private router: MessageRouter,
    private permission: PermissionManager,
    private scheduler: SingleSlotScheduler,
    private llmClient: LLMClient,
    config: MultiAgentConfig,
    personas: Map<string, AgentPersona>,
  ) {
    this.config = config;
    this.agents = new Map();

    // Initialize lightweight agents
    const pmPersona = personas.get("product_manager");
    if (pmPersona) {
      this.agents.set(
        "product_manager",
        new ProductManagerAgent(pmPersona, eventBus, router, permission, llmClient),
      );
    }

    const architectPersona = personas.get("architect");
    if (architectPersona) {
      this.agents.set(
        "architect",
        new ArchitectAgent(architectPersona, eventBus, router, permission, llmClient),
      );
    }

    const testerPersona = personas.get("tester");
    if (testerPersona) {
      this.agents.set(
        "tester",
        new TesterAgent(testerPersona, eventBus, router, permission, llmClient),
      );
    }

    // Initialize heavy agents
    const frontendPersona = personas.get("frontend");
    if (frontendPersona) {
      this.agents.set(
        "frontend",
        new FrontendAgent(
          frontendPersona,
          eventBus,
          router,
          permission,
          scheduler,
          llmClient,
        ),
      );
    }

    const backendPersona = personas.get("backend");
    if (backendPersona) {
      this.agents.set(
        "backend",
        new BackendAgent(
          backendPersona,
          eventBus,
          router,
          permission,
          scheduler,
          llmClient,
        ),
      );
    }

    const devopsPersona = personas.get("devops");
    if (devopsPersona) {
      this.agents.set(
        "devops",
        new DevopsAgent(
          devopsPersona,
          eventBus,
          router,
          permission,
          scheduler,
          llmClient,
        ),
      );
    }
  }

  isProjectRequest(message: string): boolean {
    if (!this.config.enabled) return false;

    // Keyword-based detection
    const lowerMessage = message.toLowerCase();
    for (const keyword of this.config.triggers.keywords) {
      if (lowerMessage.includes(keyword.toLowerCase())) {
        return true;
      }
    }

    // TODO: LLM intent detection if enabled
    return false;
  }

  async runProject(userRequest: string, projectId: string): Promise<string> {
    const taskId = `task_${Date.now()}`;

    // Phase 1: Requirement Analysis
    const prdTask: AgentTask = {
      name: "Requirement Analysis",
      prompt: `Analyze the following requirement and output a PRD:\n\n${userRequest}`,
      projectId,
      taskId,
    };

    const prdResult = await this.agents.get("product_manager")?.handleTask(prdTask);
    if (!prdResult) return "Error: Product Manager not initialized";

    if (this.config.human_checkpoints.after_requirement) {
      // Would wait for human approval via event bus
      // For now, continue
    }

    // Phase 2: Architecture Design
    const archTask: AgentTask = {
      name: "Architecture Design",
      prompt: `Design a technical architecture based on the following PRD:\n\n${prdResult.output}`,
      projectId,
      taskId,
    };

    const archResult = await this.agents.get("architect")?.handleTask(archTask);
    if (!archResult) return "Error: Architect not initialized";

    if (this.config.human_checkpoints.after_architecture) {
      // Would wait for human approval
    }

    // Phase 3: Coding Development
    // Backend and frontend both submit to scheduler, scheduler executes serially

    const backendTask: AgentTask = {
      name: "Backend Development",
      prompt: `Develop the backend based on the following architecture:\n\n${archResult.output}`,
      projectId,
      taskId,
      type: "core_feature",
      context: "./workspace/backend",
    };

    const frontendTask: AgentTask = {
      name: "Frontend Development",
      prompt: `Develop the frontend based on the following architecture:\n\n${archResult.output}`,
      projectId,
      taskId,
      type: "core_feature",
      context: "./workspace/frontend",
    };

    // Submit both to scheduler
    await this.agents.get("backend")?.handleTask(backendTask);
    await this.agents.get("frontend")?.handleTask(frontendTask);

    // Wait for all coding to complete
    await this.waitForCodingComplete(projectId);

    // Phase 4: Testing
    const testTask: AgentTask = {
      name: "Testing",
      prompt: `Test based on the following PRD:\n\n${prdResult.output}`,
      projectId,
      taskId,
    };

    const testResult = await this.agents.get("tester")?.handleTask(testTask);

    // Phase 5: Deployment
    if (this.config.human_checkpoints.before_deploy) {
      // Would wait for human approval
    }

    const deployTask: AgentTask = {
      name: "Deployment Configuration",
      prompt: `Generate deployment configuration based on:\n\n${archResult.output}`,
      projectId,
      taskId,
      type: "core_feature",
      context: "./workspace",
    };

    await this.agents.get("devops")?.handleTask(deployTask);

    // Generate project log
    const log = this.eventBus.getProjectLog(projectId);

    return `Project completed. Events: ${log.length}`;
  }

  private async waitForCodingComplete(projectId: string) {
    // Poll until scheduler is idle
    while (!this.scheduler.isIdle) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  getAgent(role: string): BaseAgent | undefined {
    return this.agents.get(role);
  }

  getConfig(): MultiAgentConfig {
    return this.config;
  }
}
