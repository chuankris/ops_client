import type { BrokerKind, BrokerResource, ConnectionProfile, MessageRecord } from "./types";

export class Repository {
  private readonly connections: ConnectionProfile[] = [];
  private readonly resources: BrokerResource[] = [];
  private readonly messages: MessageRecord[] = [];

  listConnections() {
    return this.connections;
  }

  getConnection(id: string) {
    return this.connections.find(item => item.id === id);
  }

  upsertConnection(connection: ConnectionProfile) {
    const index = this.connections.findIndex(item => item.id === connection.id);
    if (index >= 0) {
      this.connections[index] = connection;
      return;
    }
    this.connections.unshift(connection);
  }

  listResources(params: { broker?: BrokerKind; keyword?: string }) {
    const keyword = params.keyword?.trim().toLowerCase();
    return this.resources.filter(item => {
      const hitBroker = !params.broker || item.broker === params.broker;
      const hitKeyword = !keyword || `${item.kind} ${item.broker} ${item.name}`.toLowerCase().includes(keyword);
      return hitBroker && hitKeyword;
    });
  }

  listMessages() {
    return this.messages;
  }

  appendMessage(message: MessageRecord) {
    this.messages.unshift(message);
  }
}

export const repository = new Repository();
