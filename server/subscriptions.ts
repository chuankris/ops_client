import type { Response } from "express";
import stompit from "stompit";
import { getAdapter } from "./adapters";
import { repository } from "./repository";
import type { MessageRecord } from "./types";

interface SubscriptionSession {
  id: string;
  connectionId: string;
  source: string;
  timer?: NodeJS.Timeout;
  stopRealtime?: () => void;
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
  if (session?.stopRealtime) {
    session.stopRealtime();
  }
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

  if (connection.kind === "ActiveMQ") {
    startActiveMqStream(session, res);
  } else {
    session.timer = setInterval(() => {
      const message = adapter.sampleMessage(connection, session.source);
      repository.appendMessage(message);
      res.write(`event: message\n`);
      res.write(`data: ${JSON.stringify(message)}\n\n`);
    }, 2000);
  }

  res.on("close", () => {
    if (session.stopRealtime) {
      session.stopRealtime();
    }
    if (session.timer) {
      clearInterval(session.timer);
    }
  });
}

function startActiveMqStream(session: SubscriptionSession, res: Response) {
  const connection = repository.getConnection(session.connectionId);
  if (!connection) return;

  const connectOptions = {
    host: connection.host,
    port: connection.port,
    connectHeaders: {
      host: "/",
      login: connection.username,
      passcode: connection.password,
      "heart-beat": "5000,5000"
    }
  };
  const destination = toActiveMqDestination(session.source);

  (stompit as any).connect(connectOptions, (error: Error | null, client: any) => {
    if (error) {
      res.write(`event: error\n`);
      res.write(`data: ${JSON.stringify({ message: error.message })}\n\n`);
      return;
    }

    client.subscribe({ destination, ack: "auto" }, (subError: Error | null, message: any) => {
      if (subError) {
        res.write(`event: error\n`);
        res.write(`data: ${JSON.stringify({ message: subError.message })}\n\n`);
        return;
      }

      message.readString("utf-8", (readError: Error | null, body: string) => {
        if (readError) {
          return;
        }
        const record = buildActiveMqMessage(connection.name, session.source, body);
        repository.appendMessage(record);
        res.write(`event: message\n`);
        res.write(`data: ${JSON.stringify(record)}\n\n`);
      });
    });

    session.stopRealtime = () => {
      try {
        client.disconnect(() => undefined);
      } catch {
        // Ignore disconnect errors from closed socket.
      }
    };
  });
}

function toActiveMqDestination(source: string) {
  if (source.startsWith("/queue/") || source.startsWith("/topic/")) return source;
  if (source.startsWith("queue://")) return `/queue/${source.slice("queue://".length)}`;
  if (source.startsWith("topic://")) return `/topic/${source.slice("topic://".length)}`;
  return `/queue/${source}`;
}

function buildActiveMqMessage(connectionName: string, source: string, body: string): MessageRecord {
  const payload = toPrettyPayload(body);
  return {
    id: `stream-${Date.now()}`,
    time: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
    broker: "ActiveMQ",
    source,
    key: connectionName,
    partition: "-",
    offset: "-",
    size: `${Buffer.byteLength(body || "", "utf8")}B`,
    status: "OK",
    payload
  };
}

function toPrettyPayload(body: string) {
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}
