export const connections = [
  {
    id: "rabbit-test",
    name: "测试-RabbitMQ",
    kind: "RabbitMQ",
    host: "10.19.158.37",
    port: 6005,
    username: "root",
    password: "123456",
    meta: "vhost=/",
    connected: true
  },
  {
    id: "kafka-pre",
    name: "预发-Kafka",
    kind: "Kafka",
    host: "10.19.166.10",
    port: 9092,
    username: "admin",
    password: "******",
    meta: "SASL_SSL",
    connected: false
  },
  {
    id: "amq-dev",
    name: "联调-ActiveMQ",
    kind: "ActiveMQ",
    host: "10.19.158.37",
    port: 7018,
    username: "admin",
    password: "******",
    meta: "queue/topic",
    connected: false
  }
];

export const resources = [
  { id: "r-q-1", kind: "queue", broker: "RabbitMQ", name: "pdms.topic.model.data.tb_fire_tool", detail: "12 msg" },
  { id: "r-q-2", kind: "queue", broker: "RabbitMQ", name: "dif.queue.topic.processChange.plan", detail: "0 msg" },
  { id: "r-e-1", kind: "exchange", broker: "RabbitMQ", name: "amq.topic", detail: "built-in" },
  { id: "r-e-2", kind: "exchange", broker: "RabbitMQ", name: "dif.exchange.process.change", detail: "7 bind" },
  { id: "k-t-1", kind: "topic", broker: "Kafka", name: "pemc.notify.event1", detail: "3 part" },
  { id: "k-t-2", kind: "topic", broker: "Kafka", name: "pdms.topic.water_transducer", detail: "6 part" },
  { id: "a-q-1", kind: "queue", broker: "ActiveMQ", name: "queue://pdms.model.group", detail: "ActiveMQ" },
  { id: "a-t-1", kind: "topic", broker: "ActiveMQ", name: "topic://pdms.model.event", detail: "ActiveMQ" }
];

export const messages = [
  {
    id: "msg-1",
    time: "14:26:44.110",
    broker: "RabbitMQ",
    source: "pdms.topic.model.data.tb_fire_tool",
    key: "plan.created",
    partition: "-",
    offset: "-",
    size: "2.1KB",
    status: "OK",
    payload: JSON.stringify({
      code: "0x000200",
      traceId: "75ef0f3e5d224a8d9c",
      eventType: "PLAN_CREATED",
      data: { taskId: "plan-01", operator: "admin", createdAt: "2026-05-13T14:26:44.109+08:00" }
    }, null, 2)
  },
  {
    id: "msg-2",
    time: "14:26:44.922",
    broker: "RabbitMQ",
    source: "dif.queue.topic.processChange.plan",
    key: "plan.updated",
    partition: "-",
    offset: "-",
    size: "1.4KB",
    status: "OK",
    payload: JSON.stringify({ eventType: "PLAN_UPDATED", taskId: "plan-02" }, null, 2)
  },
  {
    id: "msg-3",
    time: "14:26:45.512",
    broker: "Kafka",
    source: "pemc.notify.event1",
    key: "evt-778",
    partition: "1",
    offset: "88912",
    size: "5.2KB",
    status: "OK",
    payload: JSON.stringify({ eventType: "DEVICE_EVENT", deviceId: "evt-778" }, null, 2)
  },
  {
    id: "msg-4",
    time: "14:26:46.088",
    broker: "ActiveMQ",
    source: "queue://pdms.model.group",
    key: "grp-33",
    partition: "-",
    offset: "-",
    size: "3.9KB",
    status: "OK",
    payload: JSON.stringify({ eventType: "GROUP_SYNC", groupId: "grp-33" }, null, 2)
  }
];
