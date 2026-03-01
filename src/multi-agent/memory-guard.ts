// src/multi-agent/memory-guard.ts

import os from "node:os";
import type { EventBus } from "./event-bus.js";
import type { SingleSlotScheduler } from "./scheduler.js";

export class MemoryGuard {
  private criticalMb: number;
  private warningMb: number;
  private intervalMs: number;

  constructor(
    private scheduler: SingleSlotScheduler,
    private eventBus: EventBus,
    config: {
      criticalMb?: number;
      warningMb?: number;
      checkIntervalSeconds?: number;
    } = {},
  ) {
    this.criticalMb = config.criticalMb ?? 200;
    this.warningMb = config.warningMb ?? 500;
    this.intervalMs = (config.checkIntervalSeconds ?? 3) * 1000;
  }

  private getAvailableMb(): number {
    return Math.floor(os.freemem() / (1024 * 1024));
  }

  async start() {
    while (true) {
      await this.check();
      await new Promise((resolve) => setTimeout(resolve, this.intervalMs));
    }
  }

  async check() {
    const available = this.getAvailableMb();

    if (available < this.criticalMb) {
      this.eventBus.publish({
        source: "memory_guard",
        eventType: "memory_critical",
        payload: { availableMb: available, threshold: this.criticalMb },
      });
      await this.scheduler.killCurrent();
      this.scheduler.pause();
      console.error(`[MemoryGuard] CRITICAL: Only ${available}MB available, pausing scheduler`);
    } else if (available < this.warningMb) {
      this.eventBus.publish({
        source: "memory_guard",
        eventType: "memory_warning",
        payload: { availableMb: available, threshold: this.warningMb },
      });
      this.scheduler.pause();
      console.warn(`[MemoryGuard] WARNING: Only ${available}MB available, scheduler paused`);
    } else {
      this.scheduler.resume();
    }
  }
}
