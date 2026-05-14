import amqp from "amqplib";
import type { Channel, ChannelModel } from "amqplib";
import { repository } from "../repository";
import { BaseMockAdapter } from "./baseAdapter";
import type { BrokerResource, ConnectionProfile, ConnectionTestResult, SendRequest, SendResult } from "../types";

interface RabbitManagementItem {
  name: string;
  type?: string;
  messages?: number;
}

export class RabbitMqAdapter extends BaseMockAdapter {
  constructor() {
    super("RabbitMQ");
  }

  override async testConnection(profile: ConnectionProfile): Promise<ConnectionTestResult> {
    const started = Date.now();
    let connection: ChannelModel | undefined;
    try {
      connection = await amqp.connect(buildAmqpUrl(profile), { timeout: 3000 });
      return {
        success: true,
        latencyMs: Date.now() - started,
        message: "AMQP 连接成功"
      };
    } catch (error) {
      return {
        success: false,
        latencyMs: Date.now() - started,
        message: error instanceof Error ? error.message : "AMQP 连接失败"
      };
    } finally {
      await closeConnection(connection);
    }
  }

  override async listResources(profile: ConnectionProfile, keyword?: string): Promise<BrokerResource[]> {
    const managementPort = profile.managementPort;
    if (!managementPort) {
      return repository.listResources({ broker: "RabbitMQ", keyword });
    }

    try {
      const [queues, exchanges] = await Promise.all([
        fetchManagement<RabbitManagementItem[]>(profile, `/api/queues/${encodeURIComponent(vhost(profile))}`),
        fetchManagement<RabbitManagementItem[]>(profile, `/api/exchanges/${encodeURIComponent(vhost(profile))}`)
      ]);

      const mapped: BrokerResource[] = [
        ...queues.map(queue => ({
          id: `rabbit-queue-${queue.name}`,
          kind: "queue" as const,
          broker: "RabbitMQ" as const,
          name: queue.name,
          detail: `${queue.messages ?? 0} msg`
        })),
        ...exchanges
          .filter(exchange => exchange.name)
          .map(exchange => ({
            id: `rabbit-exchange-${exchange.name}`,
            kind: "exchange" as const,
            broker: "RabbitMQ" as const,
            name: exchange.name,
            detail: exchange.type ?? "exchange"
          }))
      ];

      const lowerKeyword = keyword?.trim().toLowerCase();
      if (!lowerKeyword) {
        return mapped;
      }
      return mapped.filter(item => `${item.kind} ${item.name} ${item.detail}`.toLowerCase().includes(lowerKeyword));
    } catch {
      return repository.listResources({ broker: "RabbitMQ", keyword });
    }
  }

  override async send(profile: ConnectionProfile, request: SendRequest): Promise<SendResult> {
    const started = Date.now();
    let connection: ChannelModel | undefined;
    let channel: Channel | undefined;

    try {
      connection = await amqp.connect(buildAmqpUrl(profile), { timeout: 3000 });
      channel = await connection.createChannel();
      const payload = Buffer.from(request.body, "utf8");
      const options = {
        contentType: "application/json",
        messageId: `local-${Date.now()}`,
        headers: request.headers ?? {}
      };

      if (request.protocol === "rabbit-queue") {
        await channel.assertQueue(request.target, { durable: true });
        channel.sendToQueue(request.target, payload, options);
      } else {
        channel.publish(request.target, request.routingKey ?? "", payload, options);
      }

      return {
        messageId: options.messageId,
        protocol: request.protocol,
        target: request.target,
        status: "SENT",
        latencyMs: Date.now() - started
      };
    } finally {
      await closeChannel(channel);
      await closeConnection(connection);
    }
  }
}

function buildAmqpUrl(profile: ConnectionProfile) {
  const user = encodeURIComponent(profile.username);
  const pass = encodeURIComponent(profile.password);
  const host = profile.host;
  const port = profile.port;
  const encodedVhost = encodeURIComponent(vhost(profile));
  return `amqp://${user}:${pass}@${host}:${port}/${encodedVhost}`;
}

function vhost(profile: ConnectionProfile) {
  return profile.vhost || "/";
}

async function fetchManagement<T>(profile: ConnectionProfile, path: string): Promise<T> {
  const url = `http://${profile.host}:${profile.managementPort}${path}`;
  const auth = Buffer.from(`${profile.username}:${profile.password}`).toString("base64");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2000);
  const response = await fetch(url, {
    signal: controller.signal,
    headers: {
      Authorization: `Basic ${auth}`
    }
  }).finally(() => clearTimeout(timer));
  if (!response.ok) {
    throw new Error(`RabbitMQ management request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

async function closeChannel(channel?: Channel) {
  if (!channel) return;
  try {
    await channel.close();
  } catch {
    // Ignore close errors from already-closed channels.
  }
}

async function closeConnection(connection?: ChannelModel) {
  if (!connection) return;
  try {
    await connection.close();
  } catch {
    // Ignore close errors from already-closed connections.
  }
}
