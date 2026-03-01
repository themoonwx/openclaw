// src/multi-agent/event-bus.ts

import { randomUUID } from "node:crypto";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export interface AgentEvent {
  eventId: string;
  timestamp: string;
  projectId?: string;
  phase?: string;
  source: string;
  target?: string;
  eventType: string;
  taskId?: string;
  payload: Record<string, unknown>;
  parentEventId?: string;
  consumed: boolean;
}

export class EventBus {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    const resolvedPath = path.resolve(dbPath);
    this.db = new DatabaseSync(resolvedPath);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA busy_timeout = 5000");
    this.initDb();
  }

  private initDb() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        event_id        TEXT PRIMARY KEY,
        timestamp       TEXT NOT NULL,
        project_id      TEXT,
        phase           TEXT,
        source          TEXT NOT NULL,
        target          TEXT,
        event_type      TEXT NOT NULL,
        task_id         TEXT,
        payload         TEXT,
        consumed        INTEGER DEFAULT 0,
        parent_event_id TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_target_consumed
        ON events(target, consumed);
      CREATE INDEX IF NOT EXISTS idx_task_id
        ON events(task_id);
      CREATE INDEX IF NOT EXISTS idx_project_phase
        ON events(project_id, phase);
    `);
  }

  publish(params: {
    source: string;
    eventType: string;
    payload: Record<string, unknown>;
    target?: string;
    taskId?: string;
    projectId?: string;
    phase?: string;
    parentEventId?: string;
  }): string {
    const eventId = randomUUID();
    const stmt = this.db.prepare(`
      INSERT INTO events
      (event_id, timestamp, project_id, phase, source, target,
       event_type, task_id, payload, consumed, parent_event_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
    `);
    stmt.run(
      eventId,
      new Date().toISOString(),
      params.projectId ?? null,
      params.phase ?? null,
      params.source,
      params.target ?? null,
      params.eventType,
      params.taskId ?? null,
      JSON.stringify(params.payload),
      params.parentEventId ?? null,
    );
    return eventId;
  }

  consume(agentId: string, eventTypes?: string[]): AgentEvent[] {
    let query = `
      SELECT event_id, timestamp, source, event_type, task_id, payload, parent_event_id, target
      FROM events
      WHERE (target = ? OR target IS NULL)
        AND consumed = 0
    `;
    const queryParams: (string | null)[] = [agentId];

    if (eventTypes?.length) {
      const placeholders = eventTypes.map(() => "?").join(",");
      query += ` AND event_type IN (${placeholders})`;
      queryParams.push(...eventTypes);
    }
    query += " ORDER BY timestamp ASC";

    const rows = this.db.prepare(query).all(...queryParams) as {
      event_id: string;
      timestamp: string;
      source: string;
      event_type: string;
      task_id: string | null;
      payload: string;
      parent_event_id: string | null;
      target: string | null;
    }[];

    if (rows.length > 0) {
      const ids = rows.map((r) => r.event_id);
      const placeholders = ids.map(() => "?").join(",");
      this.db
        .prepare(`UPDATE events SET consumed = 1 WHERE event_id IN (${placeholders})`)
        .run(...ids);
    }

    return rows.map((r) => ({
      eventId: r.event_id,
      timestamp: r.timestamp,
      source: r.source,
      eventType: r.event_type,
      taskId: r.task_id ?? undefined,
      payload: JSON.parse(r.payload),
      parentEventId: r.parent_event_id ?? undefined,
      target: r.target ?? undefined,
      consumed: true,
    }));
  }

  getProjectLog(projectId: string): AgentEvent[] {
    const rows = this.db
      .prepare(`SELECT * FROM events WHERE project_id = ? ORDER BY timestamp`)
      .all(projectId) as {
      event_id: string;
      timestamp: string;
      project_id: string;
      phase: string;
      source: string;
      target: string;
      event_type: string;
      task_id: string;
      payload: string;
      parent_event_id: string;
      consumed: number;
    }[];

    return rows.map((r) => ({
      eventId: r.event_id,
      timestamp: r.timestamp,
      projectId: r.project_id,
      phase: r.phase,
      source: r.source,
      target: r.target ?? undefined,
      eventType: r.event_type,
      taskId: r.task_id ?? undefined,
      payload: JSON.parse(r.payload),
      parentEventId: r.parent_event_id ?? undefined,
      consumed: r.consumed === 1,
    }));
  }

  close() {
    this.db.close();
  }
}
