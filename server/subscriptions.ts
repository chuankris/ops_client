import type { Response } from "express";
import amqp, { type Channel, type ChannelModel } from "amqplib";
import { Kafka, logLevel } from "kafkajs";
import stompit from "stompit";
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

  if (connection.kind === "ActiveMQ") {
    startActiveMqStream(session, res);
  } else if (connection.kind === "Kafka") {
    void startKafkaStream(session, res);
  } else if (connection.kind === "RabbitMQ") {
    void startRabbitMqStream(session, res);
  } else {
    res.write(`event: error\n`);
    res.write(`data: ${JSON.stringify({ message: "unsupported broker" })}\n\n`);
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

async function startRabbitMqStream(session: SubscriptionSession, res: Response) {
  const connection = repository.getConnection(session.connectionId);
  if (!connection) return;
  let client: ChannelModel | undefined;
  let channel: Channel | undefined;
  try {
    client = await amqp.connect(buildRabbitUrl(connection), { timeout: 3000 });
    channel = await client.createChannel();
    const source = session.source;
    let queueName = source;
    if (source.startsWith("amq.") || source.includes("exchange")) {
      const temp = await channel.assertQueue("", { exclusive: true, autoDelete: true });
      queueName = temp.queue;
      await channel.bindQueue(queueName, source, "#");
    } else {
      await channel.assertQueue(queueName, { durable: true });
    }

    await channel.consume(
      queueName,
      message => {
        if (!message) return;
        const body = message.content.toString("utf8");
        const record: MessageRecord = {
          id: `stream-${Date.now()}`,
          time: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
          broker: "RabbitMQ",
          source: session.source,
          key: message.fields.routingKey || "",
          partition: "-",
          offset: "-",
          size: `${message.content.byteLength}B`,
          status: "OK",
          payload: toPrettyPayload(body)
        };
        repository.appendMessage(record);
        res.write(`event: message\n`);
        res.write(`data: ${JSON.stringify(record)}\n\n`);
        channel?.ack(message);
      },
      { noAck: false }
    );

    session.stopRealtime = () => {
      void channel?.close().catch(() => undefined);
      void client?.close().catch(() => undefined);
    };
  } catch (error) {
    res.write(`event: error\n`);
    res.write(`data: ${JSON.stringify({ message: error instanceof Error ? error.message : "RabbitMQ subscribe failed" })}\n\n`);
    await channel?.close().catch(() => undefined);
    await client?.close().catch(() => undefined);
  }
}

function buildRabbitUrl(connection: { host: string; port: number; username: string; password: string; vhost?: string }) {
  const user = encodeURIComponent(connection.username);
  const pass = encodeURIComponent(connection.password);
  const vhost = encodeURIComponent(connection.vhost || "/");
  return `amqp://${user}:${pass}@${connection.host}:${connection.port}/${vhost}`;
}

async function startKafkaStream(session: SubscriptionSession, res: Response) {
  const connection = repository.getConnection(session.connectionId);
  if (!connection) return;
  const topic = toKafkaTopic(session.source);
  const kafka = new Kafka({
    clientId: `ops-client-sub-${connection.id}`,
    brokers: [`${connection.host}:${connection.port}`],
    connectionTimeout: 3000,
    requestTimeout: 5000,
    retry: { retries: 1 },
    logLevel: logLevel.NOTHING
  });
  const consumer = kafka.consumer({
    groupId: `ops-client-group-${Date.now()}`
  });

  try {
    await consumer.connect();
    await consumer.subscribe({ topic, fromBeginning: false });
    await consumer.run({
      eachMessage: async ({ partition, message }) => {
        const payloadRaw = message.value?.toString("utf8") ?? "";
        const record: MessageRecord = {
          id: `stream-${Date.now()}`,
          time: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
          broker: "Kafka",
          source: topic,
          key: message.key?.toString("utf8") ?? "",
          partition: String(partition),
          offset: message.offset,
          size: `${message.size ?? Buffer.byteLength(payloadRaw, "utf8")}B`,
          status: "OK",
          payload: toPrettyPayload(payloadRaw)
        };
        repository.appendMessage(record);
        res.write(`event: message\n`);
        res.write(`data: ${JSON.stringify(record)}\n\n`);
      }
    });
  } catch (error) {
    res.write(`event: error\n`);
    res.write(`data: ${JSON.stringify({ message: error instanceof Error ? error.message : "Kafka subscribe failed" })}\n\n`);
  }

  session.stopRealtime = () => {
    void consumer.disconnect().catch(() => undefined);
  };
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

function toKafkaTopic(source: string) {
  if (source.startsWith("topic://")) return source.slice("topic://".length);
  if (source.startsWith("/topic/")) return source.slice("/topic/".length);
  return source;
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
