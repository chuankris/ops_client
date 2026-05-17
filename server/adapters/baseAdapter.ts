import net from "node:net";
import type { MqAdapter } from "./MqAdapter";
import type { BrokerKind, BrokerResource, ConnectionProfile, ConnectionTestResult, SendRequest, SendResult } from "../types";

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

  async listResources(_profile: ConnectionProfile, keyword?: string): Promise<BrokerResource[]> {
    void keyword;
    return [];
  }

  async send(_profile: ConnectionProfile, request: SendRequest): Promise<SendResult> {
    void request;
    throw new Error(`${this.broker} send not implemented`);
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
