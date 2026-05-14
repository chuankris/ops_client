import { Kafka, logLevel, type Producer } from "kafkajs";
import { repository } from "../repository";
import { BaseMockAdapter } from "./baseAdapter";
import type { BrokerResource, ConnectionProfile, ConnectionTestResult, SendRequest, SendResult } from "../types";

export class KafkaAdapter extends BaseMockAdapter {
  constructor() {
    super("Kafka");
  }

  override async testConnection(profile: ConnectionProfile): Promise<ConnectionTestResult> {
    const started = Date.now();
    const kafka = createKafka(profile);
    const admin = kafka.admin();
    try {
      await admin.connect();
      await admin.listTopics();
      return {
        success: true,
        latencyMs: Date.now() - started,
        message: "Kafka connection success"
      };
    } catch (error) {
      return {
        success: false,
        latencyMs: Date.now() - started,
        message: error instanceof Error ? error.message : "Kafka connection failed"
      };
    } finally {
      await admin.disconnect().catch(() => undefined);
    }
  }

  override async listResources(profile: ConnectionProfile, keyword?: string): Promise<BrokerResource[]> {
    const kafka = createKafka(profile);
    const admin = kafka.admin();
    try {
      await admin.connect();
      const topics = await admin.listTopics();
      const mapped: BrokerResource[] = topics.map(name => ({
        id: `kafka-topic-${name}`,
        kind: "topic",
        broker: "Kafka",
        name,
        detail: "topic"
      }));
      const lowerKeyword = keyword?.trim().toLowerCase();
      if (!lowerKeyword) return mapped;
      return mapped.filter(item => item.name.toLowerCase().includes(lowerKeyword));
    } catch {
      return repository.listResources({ broker: "Kafka", keyword });
    } finally {
      await admin.disconnect().catch(() => undefined);
    }
  }

  override async send(profile: ConnectionProfile, request: SendRequest): Promise<SendResult> {
    const started = Date.now();
    const kafka = createKafka(profile);
    let producer: Producer | undefined;
    const messageId = `local-${Date.now()}`;
    try {
      producer = kafka.producer();
      await producer.connect();
      await producer.send({
        topic: request.target,
        messages: [
          {
            key: request.key || messageId,
            value: request.body,
            headers: request.headers
          }
        ]
      });
      return {
        messageId,
        protocol: request.protocol,
        target: request.target,
        status: "SENT",
        latencyMs: Date.now() - started
      };
    } finally {
      await producer?.disconnect().catch(() => undefined);
    }
  }
}

function createKafka(profile: ConnectionProfile) {
  return new Kafka({
    clientId: `ops-client-${profile.id}`,
    brokers: [`${profile.host}:${profile.port}`],
    connectionTimeout: 3000,
    requestTimeout: 5000,
    retry: { retries: 1 },
    logLevel: logLevel.NOTHING
  });
}
