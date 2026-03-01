// src/multi-agent/adapters/claude-code.ts

import { randomUUID } from "node:crypto";
import { runClaudeCliAgent } from "../../agents/cli-runner.js";
import type { ClaudeCodeRunner } from "../scheduler.js";

/**
 * Claude Code Runner implementation
 * Reuses existing OpenClaw Claude Code calling logic
 */
export class OpenClawClaudeCodeRunner implements ClaudeCodeRunner {
  async run(params: {
    prompt: string;
    workingDir: string;
    timeoutMs: number;
  }): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    const sessionId = `multi-agent-${randomUUID()}`;
    const runId = randomUUID();

    try {
      const result = await runClaudeCliAgent({
        sessionId,
        sessionFile: "", // Would be set by the runner
        workspaceDir: params.workingDir,
        prompt: params.prompt,
        timeoutMs: params.timeoutMs,
        runId,
        // Add any other required params
      });

      return {
        exitCode: result.meta.error ? 1 : 0,
        stdout: result.payloads?.[0]?.text ?? "",
        stderr: result.meta.error?.message ?? "",
      };
    } catch (err) {
      return {
        exitCode: 1,
        stdout: "",
        stderr: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
