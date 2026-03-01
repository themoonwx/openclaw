// src/multi-agent/health-monitor.ts

// Health Monitor Integration
// Runs health check after startup and triggers auto-fix if needed

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const HEALTH_CHECK_SCRIPT = "/home/ubuntu/openclaw/scripts/health-check.sh";
const AUTO_FIX_SCRIPT = "/home/ubuntu/openclaw/scripts/auto-fix.sh";
const FAIL_COUNT_FILE = "/tmp/openclaw-health-fail-count";

export interface HealthCheckResult {
  success: boolean;
  output: string;
  exitCode: number;
}

export class HealthMonitor {
  private consecutiveFailures = 0;
  private maxRetries = 3;

  constructor(private enabled: boolean = true) {
    // Load previous failure count
    this.loadFailCount();
  }

  private loadFailCount() {
    try {
      if (fs.existsSync(FAIL_COUNT_FILE)) {
        const count = parseInt(fs.readFileSync(FAIL_COUNT_FILE, "utf-8").trim(), 10);
        if (!isNaN(count)) {
          this.consecutiveFailures = count;
        }
      }
    } catch {
      // Ignore errors
    }
  }

  private saveFailCount() {
    try {
      fs.writeFileSync(FAIL_COUNT_FILE, String(this.consecutiveFailures));
    } catch {
      // Ignore errors
    }
  }

  async runHealthCheck(): Promise<HealthCheckResult> {
    return new Promise((resolve) => {
      const proc = spawn("bash", [HEALTH_CHECK_SCRIPT], {
        cwd: path.dirname(HEALTH_CHECK_SCRIPT),
      });

      let output = "";
      proc.stdout.on("data", (data) => {
        output += data.toString();
      });
      proc.stderr.on("data", (data) => {
        output += data.toString();
      });

      proc.on("close", (code) => {
        resolve({
          success: code === 0,
          output,
          exitCode: code ?? 0,
        });
      });

      proc.on("error", (err) => {
        resolve({
          success: false,
          output: err.message,
          exitCode: 1,
        });
      });
    });
  }

  async runAutoFix(): Promise<HealthCheckResult> {
    return new Promise((resolve) => {
      const proc = spawn("bash", [AUTO_FIX_SCRIPT], {
        cwd: path.dirname(AUTO_FIX_SCRIPT),
      });

      let output = "";
      proc.stdout.on("data", (data) => {
        output += data.toString();
      });
      proc.stderr.on("data", (data) => {
        output += data.toString();
      });

      proc.on("close", (code) => {
        resolve({
          success: code === 0,
          output,
          exitCode: code ?? 0,
        });
      });

      proc.on("error", (err) => {
        resolve({
          success: false,
          output: err.message,
          exitCode: 1,
        });
      });
    });
  }

  async checkAndFix(): Promise<{
    action: "none" | "health_check" | "auto_fix" | "trigger_cc";
    message: string;
  }> {
    if (!this.enabled) {
      return { action: "none", message: "Health monitor disabled" };
    }

    console.log("[HealthMonitor] Running health check...");
    const result = await this.runHealthCheck();

    if (result.success) {
      // Reset failure count on success
      if (this.consecutiveFailures > 0) {
        console.log("[HealthMonitor] Health check passed, resetting failure count");
        this.consecutiveFailures = 0;
        this.saveFailCount();
      }
      return {
        action: "none",
        message: "Health check passed",
      };
    }

    // Health check failed
    this.consecutiveFailures++;
    this.saveFailCount();

    console.log(
      `[HealthMonitor] Health check failed (consecutive: ${this.consecutiveFailures}/${this.maxRetries})`,
    );

    if (this.consecutiveFailures < this.maxRetries) {
      // Run auto-fix
      console.log("[HealthMonitor] Running auto-fix...");
      const fixResult = await this.runAutoFix();
      return {
        action: "auto_fix",
        message: `Health check failed, auto-fix triggered\n${fixResult.output}`,
      };
    }

    // Three consecutive failures - trigger CC
    console.log("[HealthMonitor] Three consecutive failures! CC repair should be triggered.");
    return {
      action: "trigger_cc",
      message: "三次启动失败，已达到触发 Claude Code 修复的条件\n请通过 /p 或 @角色 触发修复任务",
    };
  }

  getConsecutiveFailures(): number {
    return this.consecutiveFailures;
  }

  resetFailCount() {
    this.consecutiveFailures = 0;
    this.saveFailCount();
  }
}
