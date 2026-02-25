// src/multi-agent/gateway-hook.ts

// Gateway Hook for Multi-Agent Integration
// This hook intercepts messages and routes to multi-agent system if needed

import type { FinalizedMsgContext } from "./auto-reply/templating.js";
import type { OpenClawConfig } from "./config/config.js";
import {
  isMultiAgentRequest,
  runMultiAgentProject,
  initializeMultiAgent,
  getMultiAgentSystem,
  shutdownMultiAgent,
} from "./multi-agent/adapters/integration.js";

export interface GatewayHookOptions {
  // Whether to enable multi-agent mode
  enabled?: boolean;
  // Message patterns that trigger multi-agent (overrides config)
  triggerPatterns?: string[];
}

/**
 * Pre-process message to check if it should go to multi-agent system
 */
export async function preprocessMessage(
  ctx: FinalizedMsgContext,
  cfg: OpenClawConfig,
  options: GatewayHookOptions = {},
): Promise<{
  shouldHandle: boolean;
  isMultiAgent: boolean;
  result?: string;
}> {
  // Check if multi-agent is enabled
  const multiAgent = getMultiAgentSystem();
  if (!multiAgent || !multiAgent.isEnabled()) {
    return { shouldHandle: true, isMultiAgent: false };
  }

  // Get message text from context
  const messageText = extractMessageText(ctx);
  if (!messageText) {
    return { shouldHandle: true, isMultiAgent: false };
  }

  // Check if it's a multi-agent request
  if (isMultiAgentRequest(messageText)) {
    try {
      const result = await runMultiAgentProject(messageText, {
        projectId: ctx.SessionKey,
      });
      return {
        shouldHandle: false,
        isMultiAgent: true,
        result,
      };
    } catch (err) {
      console.error("[MultiAgent] Error processing request:", err);
      // Fall back to normal processing
      return { shouldHandle: true, isMultiAgent: false };
    }
  }

  return { shouldHandle: true, isMultiAgent: false };
}

function extractMessageText(ctx: FinalizedMsgContext): string | null {
  // Try to extract message text from different possible fields
  const text = ctx.Message ?? ctx.text ?? ctx.content ?? ctx.body;
  return typeof text === "string" ? text : null;
}

/**
 * Initialize multi-agent system
 * Call this during OpenClaw startup
 */
export async function initMultiAgentGateway(config?: {
  workspaceDir?: string;
  configPath?: string;
  dbPath?: string;
  defaultProvider?: string;
  defaultModel?: string;
  openclawConfig?: OpenClawConfig;
}): Promise<void> {
  await initializeMultiAgent({
    workspaceDir: config?.workspaceDir,
    configPath: config?.configPath,
    dbPath: config?.dbPath,
    defaultProvider: config?.defaultProvider ?? "minimax",
    defaultModel: config?.defaultModel ?? "MiniMax-M2.5",
    openclawConfig: config?.openclawConfig,
  });
}

/**
 * Cleanup on shutdown
 */
export async function cleanupMultiAgentGateway(): Promise<void> {
  await shutdownMultiAgent();
}
