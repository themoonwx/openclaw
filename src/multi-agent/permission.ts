// src/multi-agent/permission.ts

import path from "node:path";

export type AccessLevel = "none" | "read_only" | "read_write";

interface RolePermission {
  code: AccessLevel;
  doc: AccessLevel;
  config: AccessLevel;
}

const ROLE_PERMISSIONS: Record<string, RolePermission> = {
  orchestrator: { code: "none", doc: "read_only", config: "read_write" },
  product_manager: { code: "none", doc: "read_write", config: "none" },
  architect: { code: "read_only", doc: "read_write", config: "read_only" },
  frontend: { code: "none", doc: "read_only", config: "none" },
  backend: { code: "none", doc: "read_only", config: "none" },
  devops: { code: "none", doc: "read_only", config: "none" },
  tester: { code: "read_only", doc: "read_write", config: "none" },
  claude_code: { code: "read_write", doc: "read_write", config: "read_write" },
};

const CODE_EXTENSIONS = new Set([
  ".py",
  ".js",
  ".ts",
  ".jsx",
  ".tsx",
  ".vue",
  ".go",
  ".rs",
  ".java",
  ".css",
  ".scss",
  ".html",
  ".sql",
  ".sh",
]);

const DOC_EXTENSIONS = new Set([".md", ".txt", ".rst", ".yaml", ".yml", ".json", ".toml"]);

const CONFIG_FILENAMES = new Set([
  "Dockerfile",
  "docker-compose.yml",
  "docker-compose.yaml",
  ".env",
  ".env.example",
  "nginx.conf",
  "Makefile",
  "package.json",
  "pyproject.toml",
  "requirements.txt",
]);

export class PermissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermissionError";
  }
}

export class PermissionManager {
  constructor(private workspaceDir: string) {}

  private classifyFile(filepath: string): "code" | "doc" | "config" {
    const ext = path.extname(filepath);
    const basename = path.basename(filepath);

    if (CONFIG_FILENAMES.has(basename)) return "config";
    if (CODE_EXTENSIONS.has(ext)) return "code";
    if (DOC_EXTENSIONS.has(ext)) return "doc";
    return "code"; // Unknown type, treat as code (strict)
  }

  checkAccess(role: string, filepath: string, operation: "read" | "write"): boolean {
    const perm = ROLE_PERMISSIONS[role];
    if (!perm) {
      throw new PermissionError(`Unknown role: ${role}`);
    }

    // Prevent path traversal
    const resolved = path.resolve(filepath);
    const workspace = path.resolve(this.workspaceDir);
    if (!resolved.startsWith(workspace)) {
      throw new PermissionError(`Path outside workspace: ${filepath}`);
    }

    const fileType = this.classifyFile(filepath);
    const level = perm[fileType];

    if (operation === "read") {
      return level === "read_only" || level === "read_write";
    }
    return level === "read_write";
  }

  enforce(role: string, filepath: string, operation: "read" | "write") {
    if (!this.checkAccess(role, filepath, operation)) {
      const perm = ROLE_PERMISSIONS[role];
      const fileType = this.classifyFile(filepath);
      const level = perm?.[fileType] ?? "none";
      throw new PermissionError(
        `Permission denied: [${role}] cannot ${operation} ${fileType} file ${filepath}\n` +
          `  Required access: ${operation}, Current level: ${level}\n` +
          `  Orchestration agents cannot directly operate code files. Use Claude Code subprocess instead.`,
      );
    }
  }

  getRolePermissions(role: string): RolePermission | undefined {
    return ROLE_PERMISSIONS[role];
  }
}
