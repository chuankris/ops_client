import { BaseMockAdapter } from "./baseAdapter";
import { ActiveMqAdapter } from "./activeMqAdapter";
import { KafkaAdapter } from "./kafkaAdapter";
import { RabbitMqAdapter } from "./rabbitMqAdapter";
import type { BrokerKind } from "../types";

const adapters = {
  RabbitMQ: new RabbitMqAdapter(),
  Kafka: new KafkaAdapter(),
  ActiveMQ: new ActiveMqAdapter()
};

export function getAdapter(kind: BrokerKind) {
  return adapters[kind];
}
