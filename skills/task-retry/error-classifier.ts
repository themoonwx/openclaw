import { createHash } from "node:crypto";

/**
 * Normalizes error message by removing dynamic content that varies between errors.
 * This ensures that the same error type generates consistent fingerprints.
 */
export function normalizeErrorMessage(errorMessage: string): string {
  let normalized = errorMessage;

  // Remove timestamps (various formats)
  // ISO timestamps: 2024-01-15T10:30:00.000Z
  normalized = normalized.replace(
    /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z?/g,
    "<TIMESTAMP>",
  );
  // Unix timestamps (10-13 digits)
  normalized = normalized.replace(/\b\d{10,13}\b/g, "<TIMESTAMP>");
  // Common date formats: 2024/01/15, 01/15/2024
  normalized = normalized.replace(/\b\d{4}[-/]\d{2}[-/]\d{2}\b/g, "<DATE>");
  normalized = normalized.replace(/\b\d{2}[-/]\d{2}[-/]\d{4}\b/g, "<DATE>");

  // Remove UUIDs (8-4-4-4-12 format)
  normalized = normalized.replace(
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
    "<UUID>",
  );

  // Remove request IDs / correlation IDs
  normalized = normalized.replace(
    /\b(req|request|corr|correlation)[-_\s]?id[-:]\s*[a-zA-Z0-9]+/gi,
    "<REQUEST_ID>",
  );
  normalized = normalized.replace(/\b(rid)[-:]\s*[a-zA-Z0-9]+/gi, "<REQUEST_ID>");

  // Remove session IDs
  normalized = normalized.replace(
    /\b(session|ses)[-_\s]?id[-:]\s*[a-zA-Z0-9_-]+/gi,
    "<SESSION_ID>",
  );

  // Remove temporary paths with random suffixes
  // /tmp/xxx-123456, /var/folders/xx/xxx
  normalized = normalized.replace(/\/tmp\/[a-zA-Z0-9_-]+/g, "/tmp/<TEMP>");
  normalized = normalized.replace(/\/var\/folders\/[a-zA-Z0-9\/]+/g, "/var/folders/<TEMP>");
  normalized = normalized.replace(
    /\/Users\/[a-zA-Z0-9_\/.-]+\/AppData\/Local\/Temp\/[a-zA-Z0-9_-]+/g,
    "<TEMP_PATH>",
  );

  // Remove port numbers (common patterns)
  normalized = normalized.replace(/localhost:\d+/g, "localhost:<PORT>");
  normalized = normalized.replace(/127\.0\.0\.1:\d+/g, "127.0.0.1:<PORT>");
  normalized = normalized.replace(/0\.0\.0\.0:\d+/g, "0.0.0.0:<PORT>");

  // Remove process IDs
  normalized = normalized.replace(/\b(pid|process[-_\s]?id)[-:]\s*\d+/gi, "<PID>");

  // Remove memory addresses
  normalized = normalized.replace(/0x[a-f0-9]+/gi, "<ADDR>");

  // Remove line/column numbers in file paths
  normalized = normalized.replace(/:\d+:\d+/g, ":<LINE>");

  // Normalize whitespace (compress multiple spaces to one)
  normalized = normalized.replace(/\s+/g, " ");

  // Trim and convert to lowercase
  normalized = normalized.trim().toLowerCase();

  return normalized;
}

/**
 * Error type classification for subagent task failures.
 * Used to determine appropriate retry strategies.
 */
export type ErrorType =
  | "authentication" // Login/authentication failure
  | "network" // Network connectivity issues
  | "permission" // Insufficient permissions
  | "dependency" // Missing dependency
  | "not_found" // Resource not found
  | "timeout" // Operation timeout
  | "rate_limit" // Rate limited by external service
  | "unknown"; // Unknown error type

/**
 * Classifies an error message into an error type.
 */
export function classifyError(errorMessage: string): ErrorType {
  const lowerMessage = errorMessage.toLowerCase();

  // Authentication errors
  if (
    lowerMessage.includes("auth") ||
    lowerMessage.includes("login") ||
    lowerMessage.includes("unauthorized") ||
    lowerMessage.includes("401") ||
    lowerMessage.includes("403") ||
    lowerMessage.includes("credential") ||
    lowerMessage.includes("token")
  ) {
    return "authentication";
  }

  // Network errors
  if (
    lowerMessage.includes("network") ||
    lowerMessage.includes("connect") ||
    lowerMessage.includes("econnrefused") ||
    lowerMessage.includes("enotfound") ||
    lowerMessage.includes("dns") ||
    lowerMessage.includes("socket")
  ) {
    return "network";
  }

  // Permission errors
  if (
    lowerMessage.includes("permission") ||
    lowerMessage.includes("access denied") ||
    lowerMessage.includes("eacces") ||
    lowerMessage.includes("epERM") ||
    lowerMessage.includes("not allowed") ||
    lowerMessage.includes("forbidden")
  ) {
    return "permission";
  }

  // Not found errors (check before dependency - more specific)
  // But exclude package-related "not found" which is a dependency issue
  const isNotFoundError =
    (lowerMessage.includes("404") ||
      lowerMessage.includes("not found") ||
      lowerMessage.includes("does not exist") ||
      lowerMessage.includes("enoent") ||
      lowerMessage.includes("no such file")) &&
    !lowerMessage.includes("package"); // package not found is dependency

  if (isNotFoundError) {
    return "not_found";
  }

  // Dependency errors
  if (
    lowerMessage.includes("missing") ||
    lowerMessage.includes("dependency") ||
    lowerMessage.includes("require") ||
    lowerMessage.includes("install") ||
    lowerMessage.includes("package") ||
    lowerMessage.includes("npm") ||
    lowerMessage.includes("pnpm") ||
    lowerMessage.includes("bun")
  ) {
    return "dependency";
  }

  // Timeout errors
  if (
    lowerMessage.includes("timeout") ||
    lowerMessage.includes("timed out") ||
    lowerMessage.includes("etimedout")
  ) {
    return "timeout";
  }

  // Rate limit errors
  if (
    lowerMessage.includes("rate limit") ||
    lowerMessage.includes("too many requests") ||
    lowerMessage.includes("429") ||
    lowerMessage.includes("throttle")
  ) {
    return "rate_limit";
  }

  return "unknown";
}

/**
 * Generates an error fingerprint from error type and message.
 * Used to identify repeated identical errors.
 */
export function generateErrorFingerprint(errorType: ErrorType, errorMessage: string): string {
  // Use advanced normalization to remove dynamic content
  const normalizedMessage = normalizeErrorMessage(errorMessage).slice(0, 200);

  const fingerprintInput = `${errorType}:${normalizedMessage}`;
  return createHash("sha256").update(fingerprintInput).digest("hex").slice(0, 16);
}

/**
 * Returns a suggested solution for the given error type.
 */
export function getSolutionForError(errorType: ErrorType): string {
  switch (errorType) {
    case "authentication":
      return "Try running the login command or checking credentials configuration.";
    case "network":
      return "Check network connectivity. Try again or use a different network.";
    case "permission":
      return "Check file/directory permissions. Try using chmod or running with appropriate permissions.";
    case "dependency":
      return "Install the missing dependency. Check package.json or run install command.";
    case "not_found":
      return "Verify the resource exists or the path is correct.";
    case "timeout":
      return "Try again with a longer timeout, or break down the task into smaller steps.";
    case "rate_limit":
      return "Wait before retrying. Consider adding delays between attempts.";
    default:
      return "Analyze the error message and try a different approach.";
  }
}

/**
 * Returns a human-readable description of the error type.
 */
export function getErrorTypeDescription(errorType: ErrorType): string {
  switch (errorType) {
    case "authentication":
      return "Authentication/login failure";
    case "network":
      return "Network connectivity issue";
    case "permission":
      return "Permission/access denied";
    case "dependency":
      return "Missing dependency";
    case "not_found":
      return "Resource not found";
    case "timeout":
      return "Operation timed out";
    case "rate_limit":
      return "Rate limit exceeded";
    default:
      return "Unknown error";
  }
}

/**
 * Retry policy for different error types.
 * Defines whether an error type is retryable and what fixes might be needed.
 */
export interface RetryPolicy {
  /** Whether this error type is retryable */
  retryable: boolean;
  /** Whether a fix is required before retrying (e.g., login, install dependency) */
  requiresFixBeforeRetry: boolean;
  /** Human-readable description of the retry strategy */
  description: string;
}

/**
 * Retry policies for each error type.
 */
export const RETRY_POLICIES: Record<ErrorType, RetryPolicy> = {
  authentication: {
    retryable: true,
    requiresFixBeforeRetry: true,
    description: "Requires login/credentials fix before retry",
  },
  network: {
    retryable: true,
    requiresFixBeforeRetry: false,
    description: "Network issues are often transient, retry allowed",
  },
  permission: {
    retryable: true,
    requiresFixBeforeRetry: true,
    description: "Requires permission fix before retry",
  },
  dependency: {
    retryable: true,
    requiresFixBeforeRetry: true,
    description: "Requires dependency installation before retry",
  },
  not_found: {
    retryable: false,
    requiresFixBeforeRetry: false,
    description: "Resource does not exist, retry unlikely to help",
  },
  timeout: {
    retryable: true,
    requiresFixBeforeRetry: false,
    description: "Timeouts may be transient, retry allowed",
  },
  rate_limit: {
    retryable: true,
    requiresFixBeforeRetry: false,
    description: "Requires wait before retry (throttled)",
  },
  unknown: {
    retryable: true,
    requiresFixBeforeRetry: false,
    description: "Unknown errors may be transient",
  },
};

/**
 * Gets the retry policy for an error type.
 */
export function getRetryPolicy(errorType: ErrorType): RetryPolicy {
  return RETRY_POLICIES[errorType];
}

/**
 * Checks if an error is retryable based on its type.
 */
export function isErrorRetryable(errorType: ErrorType): boolean {
  return RETRY_POLICIES[errorType].retryable;
}

/**
 * Checks if an error requires a fix before retrying.
 */
export function requiresFixBeforeRetry(errorType: ErrorType): boolean {
  return RETRY_POLICIES[errorType].requiresFixBeforeRetry;
}
