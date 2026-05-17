import type { BrokerResource, ConnectionProfile, ConnectionTestResult, SendRequest, SendResult } from "../types";

export interface MqAdapter {
  testConnection(profile: ConnectionProfile): Promise<ConnectionTestResult>;
  listResources(profile: ConnectionProfile, keyword?: string): Promise<BrokerResource[]>;
  send(profile: ConnectionProfile, request: SendRequest): Promise<SendResult>;
}
