import stompit from "stompit";
import { BaseMockAdapter } from "./baseAdapter";
import type { BrokerResource, ConnectionProfile, ConnectionTestResult, SendRequest, SendResult } from "../types";

type StompClient = {
  send(headers: Record<string, string>): NodeJS.WritableStream;
  disconnect(callback: () => void): void;
};

export class ActiveMqAdapter extends BaseMockAdapter {
  constructor() {
    super("ActiveMQ");
  }

  override async testConnection(profile: ConnectionProfile): Promise<ConnectionTestResult> {
    const started = Date.now();
    let client: StompClient | undefined;
    try {
      client = await connectStomp(profile);
      return {
        success: true,
        latencyMs: Date.now() - started,
        message: "STOMP connection success"
      };
    } catch (error) {
      return {
        success: false,
        latencyMs: Date.now() - started,
        message: error instanceof Error ? error.message : "STOMP connection failed"
      };
    } finally {
      await closeStomp(client);
    }
  }

  override async listResources(_profile: ConnectionProfile, keyword?: string): Promise<BrokerResource[]> {
    const managementPort = _profile.managementPort;
    if (!managementPort) {
      return [];
    }

    try {
      const [queues, topics] = await Promise.all([
        searchDestinations(_profile, managementPort, "Queue"),
        searchDestinations(_profile, managementPort, "Topic")
      ]);

      const mapped: BrokerResource[] = [
        ...queues.map(name => ({
          id: `activemq-queue-${name}`,
          kind: "queue" as const,
          broker: "ActiveMQ" as const,
          name,
          detail: "queue"
        })),
        ...topics
          .filter(name => !name.startsWith("ActiveMQ.Advisory"))
          .map(name => ({
            id: `activemq-topic-${name}`,
            kind: "topic" as const,
            broker: "ActiveMQ" as const,
            name,
            detail: "topic"
          }))
      ];

      const lowerKeyword = keyword?.trim().toLowerCase();
      if (!lowerKeyword) {
        return mapped;
      }

      return mapped.filter(item => `${item.kind} ${item.name} ${item.detail}`.toLowerCase().includes(lowerKeyword));
    } catch {
      return [];
    }
  }

  override async send(profile: ConnectionProfile, request: SendRequest): Promise<SendResult> {
    const started = Date.now();
    let client: StompClient | undefined;
    const messageId = `local-${Date.now()}`;
    try {
      client = await connectStomp(profile);
      const destination = toDestination(request.protocol, request.target);
      const frame = client.send({
        destination,
        "content-type": "application/json",
        persistent: "true",
        "message-id": messageId,
        ...(request.headers ?? {})
      });
      frame.write(request.body, "utf8");
      frame.end();

      return {
        messageId,
        protocol: request.protocol,
        target: request.target,
        status: "SENT",
        latencyMs: Date.now() - started
      };
    } finally {
      await closeStomp(client);
    }
  }
}

function connectStomp(profile: ConnectionProfile): Promise<StompClient> {
  return new Promise((resolve, reject) => {
    const connectOptions = {
      host: profile.host,
      port: profile.port,
      connectHeaders: {
        host: "/",
        login: profile.username,
        passcode: profile.password,
        "heart-beat": "5000,5000"
      }
    };
    const timer = setTimeout(() => reject(new Error("ActiveMQ connection timeout")), 3000);

    (stompit as any).connect(connectOptions, (error: Error | null, client: StompClient) => {
      clearTimeout(timer);
      if (error) {
        reject(error);
        return;
      }
      resolve(client);
    });
  });
}

function toDestination(protocol: string, target: string): string {
  if (target.startsWith("/queue/") || target.startsWith("/topic/")) return target;
  if (protocol === "activemq-topic") return `/topic/${target}`;
  return `/queue/${target}`;
}

function closeStomp(client?: StompClient) {
  if (!client) return Promise.resolve();
  return new Promise<void>(resolve => {
    try {
      client.disconnect(() => resolve());
    } catch {
      resolve();
    }
  });
}

async function searchDestinations(
  profile: ConnectionProfile,
  managementPort: number,
  destinationType: "Queue" | "Topic"
): Promise<string[]> {
  const encodedPattern = encodeURIComponent(
    `org.apache.activemq:type=Broker,brokerName=*,destinationType=${destinationType},destinationName=*`
  );
  const url = `http://${profile.host}:${managementPort}/api/jolokia/search/${encodedPattern}`;
  const response = await fetchWithBasicAuth(url, profile, 2500);

  if (!response.ok) {
    throw new Error(`ActiveMQ management request failed: ${response.status}`);
  }

  const payload = (await response.json()) as { value?: string[] };
  const objectNames = Array.isArray(payload.value) ? payload.value : [];
  return objectNames
    .map(readDestinationName)
    .filter((name): name is string => Boolean(name))
    .sort((a, b) => a.localeCompare(b));
}

function readDestinationName(objectName: string): string | null {
  const match = objectName.match(/destinationName=([^,]+)/);
  return match?.[1] ?? null;
}

async function fetchWithBasicAuth(url: string, profile: ConnectionProfile, timeoutMs: number) {
  const auth = Buffer.from(`${profile.username}:${profile.password}`).toString("base64");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: {
        Authorization: `Basic ${auth}`,
        Origin: "http://localhost"
      }
    });
  } finally {
    clearTimeout(timer);
  }
}
