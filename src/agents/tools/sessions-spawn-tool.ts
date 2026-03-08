import { Type } from "@sinclair/typebox";
import type { GatewayMessageChannel } from "../../utils/message-channel.js";
import { ACP_SPAWN_MODES, spawnAcpDirect } from "../acp-spawn.js";
import { classifyError } from "../error-classifier.js";
import { optionalStringEnum } from "../schema/typebox.js";
import { SUBAGENT_SPAWN_MODES, spawnSubagentDirect } from "../subagent-spawn.js";
import {
  MAX_CONSECUTIVE_SAME_ERROR,
  MAX_TOTAL_FAILURES,
  createRetryGroupId,
  recordTaskFailureWithGroup,
  shouldRetryByGroup,
  clearRetryGroup,
} from "../task-retry-state.js";
import type { AnyAgentTool } from "./common.js";
import { jsonResult, readStringParam } from "./common.js";

const SESSIONS_SPAWN_RUNTIMES = ["subagent", "acp"] as const;

const SessionsSpawnToolSchema = Type.Object({
  task: Type.String(),
  label: Type.Optional(Type.String()),
  runtime: optionalStringEnum(SESSIONS_SPAWN_RUNTIMES),
  agentId: Type.Optional(Type.String()),
  model: Type.Optional(Type.String()),
  thinking: Type.Optional(Type.String()),
  cwd: Type.Optional(Type.String()),
  runTimeoutSeconds: Type.Optional(Type.Number({ minimum: 0 })),
  // Back-compat: older callers used timeoutSeconds for this tool.
  timeoutSeconds: Type.Optional(Type.Number({ minimum: 0 })),
  thread: Type.Optional(Type.Boolean()),
  mode: optionalStringEnum(SUBAGENT_SPAWN_MODES),
  cleanup: optionalStringEnum(["delete", "keep"] as const),
});

/**
 * Maximum number of retry attempts for task spawn failures.
 */
const MAX_RETRY_ATTEMPTS = 3;

/**
 * Delay between retry attempts (in ms).
 */
const RETRY_DELAY_MS = 1000;

function createRetryTaskId(task: string, label: string): string {
  // Create a stable task ID for retry tracking based on task content
  // This ensures same task gets tracked together across retries
  const taskHash = Array.from(task)
    .reduce((hash, char) => ((hash << 5) - hash + char.charCodeAt(0)) | 0, 0)
    .toString(36);
  return `task:${label || "default"}:${taskHash}`;
}

export function createSessionsSpawnTool(opts?: {
  agentSessionKey?: string;
  agentChannel?: GatewayMessageChannel;
  agentAccountId?: string;
  agentTo?: string;
  agentThreadId?: string | number;
  agentGroupId?: string | null;
  agentGroupChannel?: string | null;
  agentGroupSpace?: string | null;
  sandboxed?: boolean;
  /** Explicit agent ID override for cron/hook sessions where session key parsing may not work. */
  requesterAgentIdOverride?: string;
}): AnyAgentTool {
  return {
    label: "Sessions",
    name: "sessions_spawn",
    description:
      'Spawn an isolated session (runtime="subagent" or runtime="acp"). mode="run" is one-shot and mode="session" is persistent/thread-bound.',
    parameters: SessionsSpawnToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const task = readStringParam(params, "task", { required: true });
      const label = typeof params.label === "string" ? params.label.trim() : "";
      const runtime = params.runtime === "acp" ? "acp" : "subagent";
      const requestedAgentId = readStringParam(params, "agentId");
      const modelOverride = readStringParam(params, "model");
      const thinkingOverrideRaw = readStringParam(params, "thinking");
      const cwd = readStringParam(params, "cwd");
      const mode = params.mode === "run" || params.mode === "session" ? params.mode : undefined;
      const cleanup =
        params.cleanup === "keep" || params.cleanup === "delete" ? params.cleanup : "keep";
      // Back-compat: older callers used timeoutSeconds for this tool.
      const timeoutSecondsCandidate =
        typeof params.runTimeoutSeconds === "number"
          ? params.runTimeoutSeconds
          : typeof params.timeoutSeconds === "number"
            ? params.timeoutSeconds
            : undefined;
      const runTimeoutSeconds =
        typeof timeoutSecondsCandidate === "number" && Number.isFinite(timeoutSecondsCandidate)
          ? Math.max(0, Math.floor(timeoutSecondsCandidate))
          : undefined;
      const thread = params.thread === true;

      // Create a stable task ID for retry tracking
      const taskId = createRetryTaskId(task, label);

      // Create a retry group ID to track this task chain across retries
      const retryGroupId = createRetryGroupId();

      // Helper function to spawn the task
      const spawnTask = async () => {
        return runtime === "acp"
          ? await spawnAcpDirect(
              {
                task,
                label: label || undefined,
                agentId: requestedAgentId,
                cwd,
                mode: mode && ACP_SPAWN_MODES.includes(mode) ? mode : undefined,
                thread,
              },
              {
                agentSessionKey: opts?.agentSessionKey,
                agentChannel: opts?.agentChannel,
                agentAccountId: opts?.agentAccountId,
                agentTo: opts?.agentTo,
                agentThreadId: opts?.agentThreadId,
              },
            )
          : await spawnSubagentDirect(
              {
                task,
                label: label || undefined,
                agentId: requestedAgentId,
                model: modelOverride,
                thinking: thinkingOverrideRaw,
                runTimeoutSeconds,
                thread,
                mode,
                cleanup,
                expectsCompletionMessage: true,
              },
              {
                agentSessionKey: opts?.agentSessionKey,
                agentChannel: opts?.agentChannel,
                agentAccountId: opts?.agentAccountId,
                agentTo: opts?.agentTo,
                agentThreadId: opts?.agentThreadId,
                agentGroupId: opts?.agentGroupId,
                agentGroupChannel: opts?.agentGroupChannel,
                agentGroupSpace: opts?.agentGroupSpace,
                requesterAgentIdOverride: opts?.requesterAgentIdOverride,
              },
            );
      };

      // Execute with retry logic for spawn failures
      let lastError: string | undefined;
      let lastErrorType: string | undefined;

      for (let attempt = 0; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
        const result = await spawnTask();

        // Check if the spawn was successful (accepted or non-retryable error)
        if (result.status === "accepted") {
          // Clear retry group state on success
          clearRetryGroup(retryGroupId);
          return jsonResult(result);
        }

        // For non-accepted status, check if it's a retryable error
        const errorMessage = result.error || `Spawn failed with status: ${result.status}`;

        // Only handle retryable errors (not "forbidden" which indicates permission issues)
        if (result.status !== "error" || !result.error) {
          // Non-retryable status (forbidden, etc.) - return immediately
          return jsonResult(result);
        }

        // Classify the error
        const errorType = classifyError(errorMessage);

        // Record the failure for tracking (using retry group for aggregated tracking)
        recordTaskFailureWithGroup(taskId, retryGroupId, task, errorMessage, errorType);

        // Check if we should retry using group-level limits
        const retryCheck = shouldRetryByGroup(retryGroupId);

        // Store error info for potential retry
        lastError = errorMessage;
        lastErrorType = errorType;

        if (!retryCheck.allowed) {
          // Retry limit reached - return error with retry info
          return jsonResult({
            ...result,
            retryInfo: {
              reason: retryCheck.reason,
              consecutiveErrorCount: Math.min(MAX_CONSECUTIVE_SAME_ERROR, 0),
              totalFailureCount: Math.min(MAX_TOTAL_FAILURES, 0),
              forceHumanReport: true,
              retryGroupId,
            },
          });
        }

        // Check if we have more attempts
        if (attempt < MAX_RETRY_ATTEMPTS) {
          // Wait before retrying
          await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * (attempt + 1)));
        }
      }

      // All retries exhausted
      return jsonResult({
        status: "error",
        error: lastError,
        errorType: lastErrorType,
        retryInfo: {
          attemptsMade: MAX_RETRY_ATTEMPTS + 1,
          reason: `Max retry attempts (${MAX_RETRY_ATTEMPTS + 1}) exhausted`,
          forceHumanReport: true,
        },
      });
    },
  };
}
