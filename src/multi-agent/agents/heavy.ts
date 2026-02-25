// src/multi-agent/agents/heavy.ts

import type { AgentPersona, AgentTask } from "./base-agent.js";
import { BaseAgent } from "./base-agent.js";
import type { SingleSlotScheduler, CodingTask } from "../scheduler.js";

// LLM Client interface
export interface LLMClient {
  chat(params: {
    messages: { role: "system" | "user"; content: string }[];
    model?: string;
    provider?: string;
  }): Promise<{ content: string }>;
}

export abstract class HeavyAgent extends BaseAgent {
  protected abstract scheduler: SingleSlotScheduler;
  protected abstract llmClient: LLMClient;

  async handleTask(task: AgentTask): Promise<{ output: string }> {
    // Step 1: Translate high-level task to coding prompt using LLM
    const codingPrompt = await this.translateToCodingPrompt(task);

    // Step 2: Submit to scheduler for Claude Code execution
    const codingTask: CodingTask = {
      name: task.name,
      type: (task.type as CodingTask["type"]) ?? "core_feature",
      prompt: codingPrompt,
      outputDir: task.context ?? "./workspace", // Would come from task config
      requestingAgent: this.role,
      projectId: task.projectId,
      taskId: task.taskId,
    };

    this.scheduler.submit(codingTask);

    // Step 3: Wait for completion via event bus
    const events = this.waitForEvents(["task_completed", "task_error"], 300000);

    if (events.length === 0) {
      return { output: "Task timed out" };
    }

    const event = events[0];
    if (event.eventType === "task_error") {
      return { output: `Task failed: ${JSON.stringify(event.payload)}` };
    }

    return {
      output: `Task completed: ${JSON.stringify(event.payload).slice(0, 500)}`,
    };
  }

  private async translateToCodingPrompt(task: AgentTask): Promise<string> {
    const messages = [
      {
        role: "system" as const,
        content: this.systemPrompt,
      },
      {
        role: "user" as const,
        content: `Please translate the following task into specific coding instructions.\n\nTask: ${task.prompt}\n\nOutput directory: ${task.context ?? "./workspace"}\n\nFormat: Be specific about which files to create/modify and what functionality to implement.`,
      },
    ];

    const response = await this.llmClient.chat({ messages });
    return response.content;
  }
}

// Concrete implementations for each heavy role
export class FrontendAgent extends HeavyAgent {
  protected scheduler: SingleSlotScheduler;
  protected llmClient: LLMClient;

  constructor(
    persona: AgentPersona,
    eventBus: ReturnType<typeof import("../event-bus.js")>["EventBus"],
    router: ReturnType<typeof import("../router.js")>["MessageRouter"],
    permission: ReturnType<typeof import("../permission.js")>["PermissionManager"],
    scheduler: SingleSlotScheduler,
    llmClient: LLMClient,
  ) {
    super("frontend", persona, eventBus, router, permission);
    this.scheduler = scheduler;
    this.llmClient = llmClient;
  }
}

export class BackendAgent extends HeavyAgent {
  protected scheduler: SingleSlotScheduler;
  protected llmClient: LLMClient;

  constructor(
    persona: AgentPersona,
    eventBus: ReturnType<typeof import("../event-bus.js")>["EventBus"],
    router: ReturnType<typeof import("../router.js")>["MessageRouter"],
    permission: ReturnType<typeof import("../permission.js")>["PermissionManager"],
    scheduler: SingleSlotScheduler,
    llmClient: LLMClient,
  ) {
    super("backend", persona, eventBus, router, permission);
    this.scheduler = scheduler;
    this.llmClient = llmClient;
  }
}

export class DevopsAgent extends HeavyAgent {
  protected scheduler: SingleSlotScheduler;
  protected llmClient: LLMClient;

  constructor(
    persona: AgentPersona,
    eventBus: ReturnType<typeof import("../event-bus.js")>["EventBus"],
    router: ReturnType<typeof import("../router.js")>["MessageRouter"],
    permission: ReturnType<typeof import("../permission.js")>["PermissionManager"],
    scheduler: SingleSlotScheduler,
    llmClient: LLMClient,
  ) {
    super("devops", persona, eventBus, router, permission);
    this.scheduler = scheduler;
    this.llmClient = llmClient;
  }
}
