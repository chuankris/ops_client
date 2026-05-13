import type { Response } from "express";
import { getAdapter } from "./adapters";
import { repository } from "./repository";

interface SubscriptionSession {
  id: string;
  connectionId: string;
  source: string;
  timer?: NodeJS.Timeout;
}

const sessions = new Map<string, SubscriptionSession>();

export function startSubscription(connectionId: string, source: string) {
  const connection = repository.getConnection(connectionId);
  if (!connection) {
    throw new Error("连接不存在");
  }
  const id = `sub-${Date.now()}`;
  sessions.set(id, { id, connectionId, source });
  return { id, connectionId, source, status: "RUNNING" };
}

export function stopSubscription(id: string) {
  const session = sessions.get(id);
  if (session?.timer) {
    clearInterval(session.timer);
  }
  sessions.delete(id);
  return { id, status: "STOPPED" };
}

export function streamSubscription(id: string, res: Response) {
  const session = sessions.get(id);
  if (!session) {
    res.status(404).json({ code: "404", msg: "订阅不存在" });
    return;
  }

  const connection = repository.getConnection(session.connectionId);
  if (!connection) {
    res.status(404).json({ code: "404", msg: "连接不存在" });
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
    Connection: "keep-alive"
  });

  const adapter = getAdapter(connection.kind);
  session.timer = setInterval(() => {
    const message = adapter.sampleMessage(connection, session.source);
    repository.appendMessage(message);
    res.write(`event: message\n`);
    res.write(`data: ${JSON.stringify(message)}\n\n`);
  }, 2000);

  res.on("close", () => {
    if (session.timer) {
      clearInterval(session.timer);
    }
  });
}
