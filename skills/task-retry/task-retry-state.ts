import { generateErrorFingerprint, type ErrorType } from "./error-classifier.js";

/**
 * Maximum number of consecutive same errors before stopping retry.
 */
export const MAX_CONSECUTIVE_SAME_ERROR = 3;

/**
 * Maximum total failures for a task before forcing human report.
 */
export const MAX_TOTAL_FAILURES = 5;

/**
 * Task retry state tracking interface.
 */
export interface TaskRetryState {
  taskId: string;
  retryGroupId?: string; // Optional group ID to track multiple related task retries
  taskDescription: string;
  consecutiveSameErrorCount: number; // Consecutive same error count
  lastErrorFingerprint: string; // Last error fingerprint
  totalFailureCount: number; // Total failure count
  lastError: string; // Last error message
  lastErrorType: ErrorType; // Last error type
  createdAt: number;
  updatedAt: number;
}

/**
 * In-memory store for task retry states.
 * In production, this could be persisted to disk or database.
 */
const taskRetryStates = new Map<string, TaskRetryState>();

/**
 * Records a task failure and updates retry state.
 * Returns the updated state.
 */
export function recordTaskFailure(
  taskId: string,
  taskDescription: string,
  errorMessage: string,
  errorType: ErrorType,
): TaskRetryState {
  const errorFingerprint = generateErrorFingerprint(errorType, errorMessage);
  const now = Date.now();

  let state = taskRetryStates.get(taskId);

  if (!state) {
    // First failure for this task
    state = {
      taskId,
      taskDescription,
      consecutiveSameErrorCount: 1,
      lastErrorFingerprint: errorFingerprint,
      totalFailureCount: 1,
      lastError: errorMessage,
      lastErrorType: errorType,
      createdAt: now,
      updatedAt: now,
    };
  } else {
    // Update existing state
    if (state.lastErrorFingerprint === errorFingerprint) {
      // Same error as before - increment consecutive count
      state.consecutiveSameErrorCount += 1;
    } else {
      // Different error - reset consecutive count
      state.consecutiveSameErrorCount = 1;
    }

    state.lastErrorFingerprint = errorFingerprint;
    state.totalFailureCount += 1;
    state.lastError = errorMessage;
    state.lastErrorType = errorType;
    state.taskDescription = taskDescription; // Update description in case it changed
    state.updatedAt = now;
  }

  taskRetryStates.set(taskId, state);
  return state;
}

/**
 * Gets the retry state for a task.
 * Returns null if no state exists.
 */
export function getTaskRetryState(taskId: string): TaskRetryState | null {
  return taskRetryStates.get(taskId) ?? null;
}

/**
 * Checks if a task should be retried based on retry limits.
 * Returns { allowed: boolean, reason: string }
 */
export function shouldRetry(taskId: string): { allowed: boolean; reason: string } {
  const state = taskRetryStates.get(taskId);

  if (!state) {
    // No failures recorded yet - allow retry
    return { allowed: true, reason: "No previous failures" };
  }

  // Check consecutive same error limit
  if (state.consecutiveSameErrorCount >= MAX_CONSECUTIVE_SAME_ERROR) {
    return {
      allowed: false,
      reason: `Consecutive same error limit reached (${state.consecutiveSameErrorCount}/${MAX_CONSECUTIVE_SAME_ERROR}). Error: ${state.lastError}`,
    };
  }

  // Check total failure limit
  if (state.totalFailureCount >= MAX_TOTAL_FAILURES) {
    return {
      allowed: false,
      reason: `Total failure limit reached (${state.totalFailureCount}/${MAX_TOTAL_FAILURES}). Last error: ${state.lastError}`,
    };
  }

  const remainingRetries = Math.min(
    MAX_CONSECUTIVE_SAME_ERROR - state.consecutiveSameErrorCount,
    MAX_TOTAL_FAILURES - state.totalFailureCount,
  );

  return {
    allowed: true,
    reason: `Retry allowed. ${remainingRetries} retries remaining before limit.`,
  };
}

/**
 * Clears task state after successful completion.
 */
export function clearTaskState(taskId: string): void {
  taskRetryStates.delete(taskId);
}

/**
 * Gets all task retry states (for debugging/monitoring).
 */
export function getAllTaskRetryStates(): TaskRetryState[] {
  return Array.from(taskRetryStates.values());
}

/**
 * Gets retry statistics summary.
 */
export function getRetryStats(): {
  totalTrackedTasks: number;
  atRetryLimit: number;
  canRetry: number;
} {
  let atRetryLimit = 0;
  let canRetry = 0;

  for (const state of taskRetryStates.values()) {
    if (
      state.consecutiveSameErrorCount >= MAX_CONSECUTIVE_SAME_ERROR ||
      state.totalFailureCount >= MAX_TOTAL_FAILURES
    ) {
      atRetryLimit++;
    } else {
      canRetry++;
    }
  }

  return {
    totalTrackedTasks: taskRetryStates.size,
    atRetryLimit,
    canRetry,
  };
}

// ============================================================================
// Retry Group ID support for tracking related task failures
// ============================================================================

/**
 * In-memory store for retry group states.
 * Tracks aggregated failure counts across multiple related tasks.
 */
const retryGroupStates = new Map<
  string,
  {
    consecutiveSameErrorCount: number;
    lastErrorFingerprint: string;
    totalFailureCount: number;
    lastError: string;
    lastErrorType: ErrorType;
    taskIds: Set<string>; // All task IDs in this group
    createdAt: number;
    updatedAt: number;
  }
>();

/**
 * Creates a new retry group ID for tracking multiple related task failures.
 * @returns A new unique retry group ID
 */
export function createRetryGroupId(): string {
  return `rg:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Records a task failure within a retry group.
 * Updates both the individual task state and the group aggregate state.
 */
export function recordTaskFailureWithGroup(
  taskId: string,
  retryGroupId: string,
  taskDescription: string,
  errorMessage: string,
  errorType: ErrorType,
): TaskRetryState {
  const errorFingerprint = generateErrorFingerprint(errorType, errorMessage);
  const now = Date.now();

  // Get or create group state
  let groupState = retryGroupStates.get(retryGroupId);
  if (!groupState) {
    groupState = {
      consecutiveSameErrorCount: 0,
      lastErrorFingerprint: "",
      totalFailureCount: 0,
      lastError: "",
      lastErrorType: "unknown",
      taskIds: new Set(),
      createdAt: now,
      updatedAt: now,
    };
    retryGroupStates.set(retryGroupId, groupState);
  }

  // Update group state
  if (groupState.lastErrorFingerprint === errorFingerprint) {
    groupState.consecutiveSameErrorCount += 1;
  } else {
    groupState.consecutiveSameErrorCount = 1;
  }
  groupState.lastErrorFingerprint = errorFingerprint;
  groupState.totalFailureCount += 1;
  groupState.lastError = errorMessage;
  groupState.lastErrorType = errorType;
  groupState.taskIds.add(taskId);
  groupState.updatedAt = now;

  // Update individual task state
  let state = taskRetryStates.get(taskId);
  if (!state) {
    state = {
      taskId,
      retryGroupId,
      taskDescription,
      consecutiveSameErrorCount: 1,
      lastErrorFingerprint: errorFingerprint,
      totalFailureCount: 1,
      lastError: errorMessage,
      lastErrorType: errorType,
      createdAt: now,
      updatedAt: now,
    };
  } else {
    if (state.lastErrorFingerprint === errorFingerprint) {
      state.consecutiveSameErrorCount += 1;
    } else {
      state.consecutiveSameErrorCount = 1;
    }
    state.lastErrorFingerprint = errorFingerprint;
    state.totalFailureCount += 1;
    state.lastError = errorMessage;
    state.lastErrorType = errorType;
    state.taskDescription = taskDescription;
    state.updatedAt = now;
  }

  taskRetryStates.set(taskId, state);
  return state;
}

/**
 * Checks if a retry group should continue retrying based on group-level limits.
 * Returns { allowed: boolean, reason: string }
 */
export function shouldRetryByGroup(retryGroupId: string): { allowed: boolean; reason: string } {
  const groupState = retryGroupStates.get(retryGroupId);

  if (!groupState) {
    return { allowed: true, reason: "No previous failures in group" };
  }

  // Check consecutive same error limit
  if (groupState.consecutiveSameErrorCount >= MAX_CONSECUTIVE_SAME_ERROR) {
    return {
      allowed: false,
      reason: `Group consecutive same error limit reached (${groupState.consecutiveSameErrorCount}/${MAX_CONSECUTIVE_SAME_ERROR}). Error: ${groupState.lastError}`,
    };
  }

  // Check total failure limit
  if (groupState.totalFailureCount >= MAX_TOTAL_FAILURES) {
    return {
      allowed: false,
      reason: `Group total failure limit reached (${groupState.totalFailureCount}/${MAX_TOTAL_FAILURES}). Last error: ${groupState.lastError}`,
    };
  }

  const remainingRetries = Math.min(
    MAX_CONSECUTIVE_SAME_ERROR - groupState.consecutiveSameErrorCount,
    MAX_TOTAL_FAILURES - groupState.totalFailureCount,
  );

  return {
    allowed: true,
    reason: `Group retry allowed. ${remainingRetries} retries remaining.`,
  };
}

/**
 * Gets all task IDs in a retry group.
 */
export function getRetryGroupTaskIds(retryGroupId: string): string[] {
  const groupState = retryGroupStates.get(retryGroupId);
  return groupState ? Array.from(groupState.taskIds) : [];
}

/**
 * Clears all state for a retry group after successful completion.
 */
export function clearRetryGroup(retryGroupId: string): void {
  const groupState = retryGroupStates.get(retryGroupId);
  if (groupState) {
    // Clear individual task states
    for (const taskId of groupState.taskIds) {
      taskRetryStates.delete(taskId);
    }
    // Clear group state
    retryGroupStates.delete(retryGroupId);
  }
}

/**
 * Gets retry statistics for a specific group.
 */
export function getRetryGroupStats(retryGroupId: string): {
  consecutiveSameErrorCount: number;
  totalFailureCount: number;
  taskCount: number;
} | null {
  const groupState = retryGroupStates.get(retryGroupId);
  if (!groupState) return null;

  return {
    consecutiveSameErrorCount: groupState.consecutiveSameErrorCount,
    totalFailureCount: groupState.totalFailureCount,
    taskCount: groupState.taskIds.size,
  };
}
