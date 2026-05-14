import stompit from "stompit";
import { repository } from "../repository";
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
    return repository.listResources({ broker: "ActiveMQ", keyword });
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
