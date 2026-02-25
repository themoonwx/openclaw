// src/multi-agent/single-agent-handler.ts

// Single agent handler for direct role calls

import type { EventBus } from "./event-bus.js";
import type { SingleSlotScheduler } from "./scheduler.js";
import type { BaseAgent, AgentTask } from "./agents/base-agent.js";
import { AGENT_TYPES } from "./trigger.js";

export class SingleAgentHandler {
  constructor(
    private eventBus: EventBus,
    private scheduler: SingleSlotScheduler,
    private agents: Map<string, BaseAgent>,
  ) {}

  async handle(targetAgent: string, userMessage: string): Promise<string> {
    const agent = this.agents.get(targetAgent);
    if (!agent) {
      return `❌ 未知角色: ${targetAgent}`;
    }

    const agentType = AGENT_TYPES[targetAgent];

    const task: AgentTask = {
      name: `单次调用-${targetAgent}`,
      prompt: userMessage,
    };

    if (agentType === "lightweight") {
      // Lightweight Agent: Direct LLM API call
      // Product Manager / Architect / Tester
      try {
        const result = await agent.handleTask(task);
        return result.output;
      } catch (err) {
        return `❌ ${targetAgent} 执行失败: ${err instanceof Error ? err.message : String(err)}`;
      }
    } else {
      // Heavy Agent: Scheduler → Claude Code
      // Frontend / Backend / DevOps
      try {
        const result = await agent.handleTask({
          ...task,
          type: "core_feature",
          context: "./workspace",
        });

        // For heavy agents, the result is just a confirmation
        // The actual coding happens via scheduler
        return `✅ ${targetAgent} 任务已提交到调度器\n\n${result.output}`;
      } catch (err) {
        return `❌ ${targetAgent} 任务提交失败: ${err instanceof Error ? err.message : String(err)}`;
      }
    }
  }

  // Check if scheduler has pending tasks for this agent
  hasPendingTasks(agentRole: string): boolean {
    // Could check scheduler queue for tasks from this agent
    return false;
  }
}
