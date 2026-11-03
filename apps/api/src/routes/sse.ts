import type { Context } from "hono";

import { hub } from "../realtime/hub";

export interface SseDeps {
  eventId: string;
  /** 连接建立时发送当前 revision（客户端仍会先拉完整快照）。 */
  currentRevision: () => Promise<number>;
}

/** SSE 端点：心跳 15s；业务更新只推 {revision}；断开即清理。 */
export function sseResponse(c: Context, deps: SseDeps): Response {
  const encoder = new TextEncoder();
  let client: { id: number; send(text: string): void } | null = null;
  let heartbeat: NodeJS.Timeout | null = null;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (text: string) => {
        if (closed) return;
        controller.enqueue(encoder.encode(text));
      };
      write("retry: 3000\n\n");
      deps.currentRevision().then(
        (revision) => write(`data: ${JSON.stringify({ revision })}\n\n`),
        () => write(`data: ${JSON.stringify({ revision: 0 })}\n\n`),
      );
      client = hub.subscribe(deps.eventId, { send: write });
      heartbeat = setInterval(() => {
        try {
          write(": ping\n\n");
        } catch {
          cleanup();
        }
      }, 15_000);
      const cleanup = () => {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        if (client) hub.unsubscribe(deps.eventId, client.id);
        try {
          controller.close();
        } catch {
          // 已关闭
        }
      };
      c.req.raw.signal.addEventListener("abort", cleanup);
    },
    cancel() {
      closed = true;
      if (heartbeat) clearInterval(heartbeat);
      if (client) hub.unsubscribe(deps.eventId, client.id);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Caddy 等反代禁止缓冲 SSE 响应
      "X-Accel-Buffering": "no",
    },
  });
}
