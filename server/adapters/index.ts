import { BaseMockAdapter } from "./baseAdapter";
import { ActiveMqAdapter } from "./activeMqAdapter";
import { RabbitMqAdapter } from "./rabbitMqAdapter";
import type { BrokerKind } from "../types";

class KafkaAdapter extends BaseMockAdapter {
  constructor() {
    super("Kafka");
  }
}

const adapters = {
  RabbitMQ: new RabbitMqAdapter(),
  Kafka: new KafkaAdapter(),
  ActiveMQ: new ActiveMqAdapter()
};

export function getAdapter(kind: BrokerKind) {
  return adapters[kind];
}
