// 进程内 SSE Hub（单实例口径，多副本不可用）。业务事务提交后只发布最新
// revision；短时高频更新在 100ms 窗口内合并。心跳由路由层按连接发送。
export interface SseClient {
  id: number;
  send(text: string): void;
}

export class RevisionHub {
  private nextClientId = 1;
  private readonly subscribers = new Map<string, Map<number, SseClient>>();
  private readonly pending = new Map<string, { revision: number; timer: NodeJS.Timeout }>();

  subscribe(eventId: string, client: Omit<SseClient, "id">): SseClient {
    const id = this.nextClientId++;
    const full: SseClient = { id, ...client };
    let set = this.subscribers.get(eventId);
    if (!set) {
      set = new Map();
      this.subscribers.set(eventId, set);
    }
    set.set(id, full);
    return full;
  }

  unsubscribe(eventId: string, clientId: number): void {
    this.subscribers.get(eventId)?.delete(clientId);
    if (this.subscribers.get(eventId)?.size === 0) this.subscribers.delete(eventId);
  }

  subscriberCount(eventId: string): number {
    return this.subscribers.get(eventId)?.size ?? 0;
  }

  /** 事务提交后调用；同一 event 的连发只送最新 revision。 */
  publish(eventId: string, revision: number): void {
    const existing = this.pending.get(eventId);
    if (existing) {
      existing.revision = revision;
      return;
    }
    const timer = setTimeout(() => {
      const latest = this.pending.get(eventId);
      this.pending.delete(eventId);
      if (!latest) return;
      const text = `data: ${JSON.stringify({ revision: latest.revision })}\n\n`;
      for (const client of this.subscribers.get(eventId)?.values() ?? []) {
        try {
          client.send(text);
        } catch {
          this.unsubscribe(eventId, client.id);
        }
      }
    }, 100);
    this.pending.set(eventId, { revision, timer });
  }

  /** 测试与进程退出用：清空待发与订阅。 */
  dispose(): void {
    for (const { timer } of this.pending.values()) clearTimeout(timer);
    this.pending.clear();
    this.subscribers.clear();
  }
}

export const hub = new RevisionHub();
