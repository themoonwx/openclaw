// src/multi-agent/router.ts

import type { EventBus } from "./event-bus.js";

export interface RoutableMessage {
  type: string;
  content: string;
  from?: string;
  to?: string;
  taskId?: string;
  projectId?: string;
  [key: string]: unknown;
}

const ROLE_GROUPS: Record<string, Set<string>> = {
  planning: new Set(["product_manager", "architect"]),
  coding: new Set(["frontend", "backend"]),
  ops: new Set(["devops"]),
  quality: new Set(["tester"]),
};

export class MessageRouter {
  constructor(private eventBus: EventBus) {}

  private getGroup(role: string): string | null {
    for (const [group, members] of Object.entries(ROLE_GROUPS)) {
      if (members.has(role)) {
        return group;
      }
    }
    return null;
  }

  send(
    fromRole: string,
    toRole: string,
    message: RoutableMessage,
    projectId?: string,
    taskId?: string,
  ): string {
    const fromGroup = this.getGroup(fromRole);
    const toGroup = this.getGroup(toRole);

    // Same group direct communication (except self)
    if (fromGroup && fromGroup === toGroup && fromRole !== toRole) {
      return this.eventBus.publish({
        source: fromRole,
        target: toRole,
        eventType: "direct_message",
        payload: message,
        projectId,
        taskId,
      });
    }

    // Cross-group must go through orchestrator
    return this.eventBus.publish({
      source: fromRole,
      target: "orchestrator",
      eventType: "routed_message",
      payload: {
        intended_target: toRole,
        message,
      },
      projectId,
      taskId,
    });
  }

  broadcast(source: string, message: RoutableMessage, projectId?: string, taskId?: string): string {
    return this.eventBus.publish({
      source,
      eventType: "broadcast_message",
      payload: message,
      projectId,
      taskId,
    });
  }
}
