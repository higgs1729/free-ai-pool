import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export interface SupervisorEvent {
  id: number;
  type: string;
  summary: string;
  payload: unknown;
  createdAt: string;
}

export interface WaitResult {
  kind: "event" | "heartbeat";
  cursor: number;
  event: SupervisorEvent | null;
  waitedMs: number;
}

const runtimeDir = path.resolve(process.env.SOL_SUPERVISOR_RUNTIME_DIR ?? ".runtime/sol-supervisor");
const eventsPath = path.join(runtimeDir, "events.jsonl");

let appendChain = Promise.resolve();

export async function ensureState(): Promise<void> {
  await mkdir(runtimeDir, { recursive: true });
  try {
    await readFile(eventsPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await writeFile(eventsPath, "", "utf8");
  }
}

async function readEvents(): Promise<SupervisorEvent[]> {
  const text = await readFile(eventsPath, "utf8");
  if (!text.trim()) return [];

  const events: SupervisorEvent[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as SupervisorEvent;
      if (Number.isSafeInteger(parsed.id) && parsed.id > 0) events.push(parsed);
    } catch {
      // Ignore a malformed tail line. The PoC should keep running and surface new events.
    }
  }
  return events;
}

export async function emitEvent(type: string, summary: string, payload: unknown = null): Promise<SupervisorEvent> {
  let resolveResult!: (event: SupervisorEvent) => void;
  let rejectResult!: (error: unknown) => void;
  const result = new Promise<SupervisorEvent>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });

  appendChain = appendChain.then(async () => {
    try {
      const events = await readEvents();
      const event: SupervisorEvent = {
        id: (events.at(-1)?.id ?? 0) + 1,
        type,
        summary,
        payload,
        createdAt: new Date().toISOString(),
      };
      await appendFile(eventsPath, `${JSON.stringify(event)}\n`, "utf8");
      resolveResult(event);
    } catch (error) {
      rejectResult(error);
    }
  });

  await appendChain.catch(() => undefined);
  return result;
}

export async function waitForEvent(cursor: number, timeoutMs: number): Promise<WaitResult> {
  const startedAt = Date.now();
  const deadline = startedAt + timeoutMs;

  while (true) {
    const events = await readEvents();
    const event = events.find((candidate) => candidate.id > cursor) ?? null;
    if (event) {
      return {
        kind: "event",
        cursor: event.id,
        event,
        waitedMs: Date.now() - startedAt,
      };
    }

    if (Date.now() >= deadline) {
      return {
        kind: "heartbeat",
        cursor: events.at(-1)?.id ?? cursor,
        event: null,
        waitedMs: Date.now() - startedAt,
      };
    }

    await new Promise((resolve) => setTimeout(resolve, Math.min(250, Math.max(1, deadline - Date.now()))));
  }
}

export async function getState(): Promise<{ runtimeDir: string; eventsPath: string; latestCursor: number }> {
  const events = await readEvents();
  return {
    runtimeDir,
    eventsPath,
    latestCursor: events.at(-1)?.id ?? 0,
  };
}
