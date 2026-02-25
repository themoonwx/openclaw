// src/multi-agent/agents/base-agent.ts

import type { EventBus, AgentEvent } from "../event-bus.js";
import type { MessageRouter, RoutableMessage } from "../router.js";
import type { PermissionManager } from "../permission.js";

export type AgentType = "orchestrator" | "lightweight" | "heavy";

export interface AgentPersona {
  role: string;
  name: string;
  type: AgentType;
  system_prompt: string;
  constraints: string[];
  output_format?: string;
}

export interface AgentTask {
  name: string;
  prompt: string;
  type?: string;
  projectId?: string;
  taskId?: string;
  context?: string;
  dependencies?: string[];
  expected_output?: string;
}

export abstract class BaseAgent {
  constructor(
    public readonly role: string,
    public readonly persona: AgentPersona,
    protected eventBus: EventBus,
    protected router: MessageRouter,
    protected permission: PermissionManager,
  ) {}

  get systemPrompt(): string {
    return this.persona.system_prompt;
  }

  get constraints(): string[] {
    return this.persona.constraints;
  }

  abstract handleTask(task: AgentTask): Promise<{ output: string }>;

  sendMessage(
    toRole: string,
    message: RoutableMessage,
    projectId?: string,
    taskId?: string,
  ): string {
    return this.router.send(this.role, toRole, message, projectId, taskId);
  }

  protected readFile(filepath: string): string {
    this.permission.enforce(this.role, filepath, "read");
    // Implementation would use fs
    return "";
  }

  protected writeFile(filepath: string, _content: string): void {
    this.permission.enforce(this.role, filepath, "write");
    // Implementation would use fs
  }

  waitForEvents(eventTypes: string[], timeoutMs: number = 30000): AgentEvent[] {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const events = this.eventBus.consume(this.role, eventTypes);
      if (events.length > 0) {
        return events;
      }
      // Simple polling - in production would use more efficient approach
    }
    return [];
  }
}
