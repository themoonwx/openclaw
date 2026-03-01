// src/multi-agent/boot-hook.ts

// Multi-Agent Boot Hook
// Initializes the multi-agent system on Gateway startup

import path from "node:path";
import type { OpenClawConfig } from "../config/config.js";
import { initializeMultiAgent, shutdownMultiAgent } from "./adapters/integration.js";

/**
 * Initialize multi-agent system on gateway startup
 */
export async function initMultiAgentOnStartup(
  cfg: OpenClawConfig,
  _deps: unknown,
  workspaceDir: string,
): Promise<void> {
  try {
    console.log("[MultiAgent] Initializing...");

    await initializeMultiAgent({
      workspaceDir,
      configPath: "./config/multi-agent.yaml",
      defaultProvider: cfg.models?.providers ? Object.keys(cfg.models.providers)[0] : "minimax",
      defaultModel: "MiniMax-M2.5",
      agentDir: path.join(process.env.HOME ?? "", ".openclaw", "agents", "main", "agent"),
      openclawConfig: cfg,
    });

    console.log("[MultiAgent] Initialized successfully");
  } catch (err) {
    console.error("[MultiAgent] Failed to initialize:", err);
    // Don't fail startup - multi-agent is optional
  }
}

/**
 * Cleanup on shutdown
 */
export async function cleanupMultiAgentOnShutdown(): Promise<void> {
  try {
    await shutdownMultiAgent();
    console.log("[MultiAgent] Cleaned up");
  } catch (err) {
    console.error("[MultiAgent] Cleanup error:", err);
  }
}
