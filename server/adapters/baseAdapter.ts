import net from "node:net";
import { repository } from "../repository";
import type { MqAdapter } from "./MqAdapter";
import type { BrokerKind, ConnectionProfile, ConnectionTestResult, MessageRecord, SendRequest, SendResult } from "../types";

export abstract class BaseMockAdapter implements MqAdapter {
  protected constructor(private readonly broker: BrokerKind) {}

  async testConnection(profile: ConnectionProfile): Promise<ConnectionTestResult> {
    const started = Date.now();
    const reachable = await canOpenTcp(profile.host, profile.port, 1600);
    return {
      success: reachable,
      latencyMs: Date.now() - started,
      message: reachable ? "端口连通，后续可接入真实协议握手" : "端口未连通或超时"
    };
  }

  async listResources(_profile: ConnectionProfile, keyword?: string) {
    return repository.listResources({ broker: this.broker, keyword });
  }

  async send(_profile: ConnectionProfile, request: SendRequest): Promise<SendResult> {
    return {
      messageId: `local-${Date.now()}`,
      protocol: request.protocol,
      target: request.target,
      status: "SENT",
      latencyMs: 18
    };
  }

  sampleMessage(profile: ConnectionProfile, source: string): MessageRecord {
    return {
      id: `stream-${Date.now()}`,
      time: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
      broker: profile.kind,
      source,
      key: profile.kind === "Kafka" ? "mock-key" : "mock.routing",
      partition: profile.kind === "Kafka" ? "0" : "-",
      offset: profile.kind === "Kafka" ? String(Math.floor(Math.random() * 100000)) : "-",
      size: "1.2KB",
      status: "OK",
      payload: JSON.stringify({
        eventType: "MOCK_MESSAGE",
        broker: profile.kind,
        source,
        traceId: `trace-${Date.now()}`
      }, null, 2)
    };
  }
}

function canOpenTcp(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise(resolve => {
    const socket = net.createConnection({ host, port });
    const finish = (result: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}
