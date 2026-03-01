// src/multi-agent/adapters/integration.ts

// Multi-Agent Integration with OpenClaw Gateway
// This file bridges the multi-agent system with existing OpenClaw

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MultiAgentSystem } from "../index.js";
import { OpenClawClaudeCodeRunner } from "./claude-code.js";
import { DirectLLMClient } from "./llm-client.js";

// Type alias for the multi-agent system
type MultiAgentSystemType = InstanceType<typeof MultiAgentSystem>;

let multiAgentSystem: MultiAgentSystemType | null = null;

/**
 * Initialize the multi-agent system
 * Should be called during OpenClaw startup
 */
export async function initializeMultiAgent(config?: {
  workspaceDir?: string;
  configPath?: string;
  dbPath?: string;
  defaultProvider?: string;
  defaultModel?: string;
  openclawConfig?: any;
  agentDir?: string;
}): Promise<MultiAgentSystemType | null> {
  const workspaceDir =
    config?.workspaceDir ??
    process.env.OPENCLAW_WORKSPACE ??
    path.join(os.homedir(), ".openclaw", "workspace");
  const dbPath =
    config?.dbPath ?? path.join(os.homedir(), ".openclaw", "data", "multi-agent-events.db");

  // Ensure db directory exists
  const dbDir = path.dirname(dbPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  // Create Claude Code runner
  const claudeRunner = new OpenClawClaudeCodeRunner();

  // Create LLM client
  const llmClient = new DirectLLMClient({
    defaultProvider: config?.defaultProvider,
    defaultModel: config?.defaultModel,
    config: config?.openclawConfig,
    agentDir: config?.agentDir,
  });

  // Create multi-agent system
  multiAgentSystem = new MultiAgentSystem(
    workspaceDir,
    dbPath,
    claudeRunner,
    llmClient,
    config?.configPath,
  );

  // Initialize with personas directory
  const personasDir = path.join(process.cwd(), "config", "personas");
  await multiAgentSystem.initialize(fs.existsSync(personasDir) ? personasDir : undefined);

  return multiAgentSystem;
}

/**
 * Get the multi-agent system instance
 */
export function getMultiAgentSystem(): MultiAgentSystemType | null {
  return multiAgentSystem;
}

/**
 * Check if a message should trigger multi-agent mode
 */
export function isMultiAgentRequest(message: string): boolean {
  if (!multiAgentSystem) {
    return false;
  }

  const orchestrator = multiAgentSystem.getOrchestrator();
  if (!orchestrator) {
    return false;
  }

  return orchestrator.isProjectRequest(message);
}

/**
 * Run a project request through the multi-agent system
 */
export async function runMultiAgentProject(
  message: string,
  options?: {
    projectId?: string;
    onProgress?: (progress: string) => void;
  },
): Promise<string> {
  if (!multiAgentSystem) {
    throw new Error("Multi-agent system not initialized");
  }

  const orchestrator = multiAgentSystem.getOrchestrator();
  if (!orchestrator) {
    throw new Error("Orchestrator not initialized");
  }

  const projectId = options?.projectId ?? `proj_${Date.now()}`;

  // Run the project
  const result = await orchestrator.runProject(message, projectId);

  return result;
}

/**
 * Shutdown the multi-agent system
 */
export async function shutdownMultiAgent(): Promise<void> {
  if (multiAgentSystem) {
    await multiAgentSystem.shutdown();
    multiAgentSystem = null;
  }
}
