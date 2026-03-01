// src/multi-agent/scheduler.ts

import type { EventBus, AgentEvent } from "./event-bus.js";

export interface CodingTask {
  name: string;
  type: "blocking_dependency" | "bug_fix" | "core_feature" | "enhancement" | "documentation";
  prompt: string;
  outputDir: string;
  requestingAgent: string;
  projectId?: string;
  taskId?: string;
  timeoutMs?: number;
}

interface QueueEntry {
  priority: number;
  arrivalTime: number;
  task: CodingTask;
}

const PRIORITY_MAP: Record<string, number> = {
  blocking_dependency: 0,
  bug_fix: 1,
  core_feature: 2,
  enhancement: 3,
  documentation: 4,
};

// Claude Code runner interface - to be implemented
export interface ClaudeCodeRunner {
  run(params: { prompt: string; workingDir: string; timeoutMs: number }): Promise<{
    exitCode: number;
    stdout: string;
    stderr: string;
  }>;
}

export class SingleSlotScheduler {
  private queue: QueueEntry[] = [];
  private running: CodingTask | null = null;
  private paused = false;
  private maxRetry: number;
  private taskTimeout: number;
  private pollIntervalMs: number;
  private claudeRunner: ClaudeCodeRunner;
  private runningPromise: Promise<void> | null = null;
  private stopSignal = false;

  constructor(
    private eventBus: EventBus,
    claudeRunner: ClaudeCodeRunner,
    config: {
      maxRetry?: number;
      taskTimeoutSeconds?: number;
      pollIntervalSeconds?: number;
    } = {},
  ) {
    this.claudeRunner = claudeRunner;
    this.maxRetry = config.maxRetry ?? 2;
    this.taskTimeout = (config.taskTimeoutSeconds ?? 300) * 1000;
    this.pollIntervalMs = (config.pollIntervalSeconds ?? 1) * 1000;
  }

  get isIdle(): boolean {
    return this.running === null && this.queue.length === 0;
  }

  get queueSnapshot(): string[] {
    return [...this.queue]
      .sort((a, b) => a.priority - b.priority || a.arrivalTime - b.arrivalTime)
      .map((e) => e.task.name);
  }

  pause() {
    this.paused = true;
  }

  resume() {
    this.paused = false;
  }

  submit(task: CodingTask) {
    const priority = PRIORITY_MAP[task.type] ?? 3;
    this.queue.push({
      priority,
      arrivalTime: Date.now(),
      task,
    });
    // Sort by priority, then by arrival time
    this.queue.sort((a, b) => a.priority - b.priority || a.arrivalTime - b.arrivalTime);

    this.eventBus.publish({
      source: "scheduler",
      eventType: "task_queued",
      payload: { taskName: task.name, priority, queue: this.queueSnapshot },
      projectId: task.projectId,
      taskId: task.taskId,
    });
  }

  async start() {
    this.stopSignal = false;
    this.runningPromise = this.runLoop();
    await this.runningPromise;
  }

  async stop() {
    this.stopSignal = true;
    if (this.runningPromise) {
      await this.runningPromise;
    }
  }

  private async runLoop() {
    while (!this.stopSignal) {
      if (this.paused || this.queue.length === 0 || this.running !== null) {
        await this.sleep(this.pollIntervalMs);
        continue;
      }

      const entry = this.queue.shift()!;
      await this.executeWithRetry(entry.task);
    }
  }

  private async executeWithRetry(task: CodingTask) {
    for (let attempt = 1; attempt <= this.maxRetry; attempt++) {
      const success = await this.execute(task, attempt);
      if (success) return;

      this.eventBus.publish({
        source: "scheduler",
        eventType: "task_retry",
        payload: { taskName: task.name, attempt },
        projectId: task.projectId,
        taskId: task.taskId,
      });
    }

    // All retries failed
    this.eventBus.publish({
      source: "scheduler",
      eventType: "task_failed",
      target: task.requestingAgent,
      payload: { taskName: task.name, reason: "max retries exceeded" },
      projectId: task.projectId,
      taskId: task.taskId,
    });
  }

  private async execute(task: CodingTask, attempt: number): Promise<boolean> {
    this.running = task;

    this.eventBus.publish({
      source: "scheduler",
      eventType: "task_started",
      payload: { taskName: task.name, attempt },
      projectId: task.projectId,
      taskId: task.taskId,
    });

    try {
      const timeout = task.timeoutMs ?? this.taskTimeout;

      const result = await Promise.race([
        this.claudeRunner.run({
          prompt: task.prompt,
          workingDir: task.outputDir,
          timeoutMs: timeout,
        }),
        this.timeout(timeout),
      ]);

      const success = result.exitCode === 0;

      this.eventBus.publish({
        source: "claude_code",
        eventType: success ? "task_completed" : "task_error",
        target: task.requestingAgent,
        payload: {
          taskName: task.name,
          stdout: result.stdout.slice(-2000),
          stderr: result.stderr.slice(-1000),
          exitCode: result.exitCode,
          outputDir: task.outputDir,
        },
        projectId: task.projectId,
        taskId: task.taskId,
      });

      return success;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      this.eventBus.publish({
        source: "scheduler",
        eventType: "task_error",
        payload: { taskName: task.name, error: errorMessage },
        projectId: task.projectId,
        taskId: task.taskId,
      });
      return false;
    } finally {
      this.running = null;
    }
  }

  async killCurrent() {
    // Implementation depends on Claude Code process management
    // For now, just reset the running state
    this.running = null;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private timeout(ms: number): Promise<never> {
    return new Promise((_, reject) => setTimeout(() => reject(new Error("Task timed out")), ms));
  }
}
