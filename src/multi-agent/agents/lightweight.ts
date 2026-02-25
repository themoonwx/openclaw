// src/multi-agent/agents/lightweight.ts

import type { AgentPersona, AgentTask } from "./base-agent.js";
import { BaseAgent } from "./base-agent.js";

// LLM Client interface - to be implemented
export interface LLMClient {
  chat(params: {
    messages: { role: "system" | "user"; content: string }[];
    model?: string;
    provider?: string;
  }): Promise<{ content: string }>;
}

export abstract class LightweightAgent extends BaseAgent {
  protected abstract llmClient: LLMClient;

  async handleTask(task: AgentTask): Promise<{ output: string }> {
    const messages: { role: "system" | "user"; content: string }[] = [
      { role: "system", content: this.systemPrompt },
    ];

    if (task.context) {
      messages.push({
        role: "user",
        content: `Project Context:\n${task.context}`,
      });
    }

    messages.push({
      role: "user",
      content: task.prompt,
    });

    const response = await this.llmClient.chat({ messages });

    this.eventBus.publish({
      source: this.role,
      eventType: "task_completed",
      target: "orchestrator",
      payload: { output: response.content, task_name: task.name },
      projectId: task.projectId,
      taskId: task.taskId,
    });

    return { output: response.content };
  }
}

// Concrete implementations for each lightweight role
export class ProductManagerAgent extends LightweightAgent {
  protected llmClient: LLMClient;

  constructor(
    persona: AgentPersona,
    eventBus: ReturnType<typeof import("../event-bus.js")>["EventBus"],
    router: ReturnType<typeof import("../router.js")>["MessageRouter"],
    permission: ReturnType<typeof import("../permission.js")>["PermissionManager"],
    llmClient: LLMClient,
  ) {
    super("product_manager", persona, eventBus, router, permission);
    this.llmClient = llmClient;
  }
}

export class ArchitectAgent extends LightweightAgent {
  protected llmClient: LLMClient;

  constructor(
    persona: AgentPersona,
    eventBus: ReturnType<typeof import("../event-bus.js")>["EventBus"],
    router: ReturnType<typeof import("../router.js")>["MessageRouter"],
    permission: ReturnType<typeof import("../permission.js")>["PermissionManager"],
    llmClient: LLMClient,
  ) {
    super("architect", persona, eventBus, router, permission);
    this.llmClient = llmClient;
  }
}

export class TesterAgent extends LightweightAgent {
  protected llmClient: LLMClient;

  constructor(
    persona: AgentPersona,
    eventBus: ReturnType<typeof import("../event-bus.js")>["EventBus"],
    router: ReturnType<typeof import("../router.js")>["MessageRouter"],
    permission: ReturnType<typeof import("../permission.js")>["PermissionManager"],
    llmClient: LLMClient,
  ) {
    super("tester", persona, eventBus, router, permission);
    this.llmClient = llmClient;
  }
}
