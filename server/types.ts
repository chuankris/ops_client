export type BrokerKind = "RabbitMQ" | "Kafka" | "ActiveMQ";
export type ResourceKind = "exchange" | "topic" | "queue";

export interface ConnectionProfile {
  id: string;
  name: string;
  kind: BrokerKind;
  host: string;
  port: number;
  managementPort?: number;
  vhost?: string;
  username: string;
  password: string;
  meta: string;
  connected: boolean;
}

export interface BrokerResource {
  id: string;
  kind: ResourceKind;
  broker: BrokerKind;
  name: string;
  detail: string;
}

export interface MessageRecord {
  id: string;
  time: string;
  broker: BrokerKind;
  source: string;
  key: string;
  partition: string;
  offset: string;
  size: string;
  status: string;
  payload: string;
}

export interface SendRequest {
  protocol: string;
  target: string;
  routingKey?: string;
  key?: string;
  partition?: string;
  body: string;
  headers?: Record<string, string>;
}

export interface SendResult {
  messageId: string;
  protocol: string;
  target: string;
  status: "SENT";
  latencyMs: number;
}

export interface ConnectionTestResult {
  success: boolean;
  latencyMs: number;
  message: string;
}
