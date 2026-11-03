// SSE 订阅：服务端只推 {revision}；收到更高 revision 后由调用方重拉快照。
// 心跳 15s；20s 无事件进入 stale（保留最后快照展示，不清空屏幕），并在
// 下一个巡检周期关闭并重建 EventSource——中途死掉的连接最终必能自愈。
import { onUnmounted, readonly, ref } from "vue";

export interface RevisionStream {
  revision: number;
  stale: Readonly<{ value: boolean }>;
}

export function useRevisionStream(
  path: string,
  onRevision: (revision: number) => void,
): RevisionStream {
  const stale = ref(false);
  let lastRevision = 0;
  let lastEventAt = Date.now();
  let disposed = false;
  let source: EventSource | null = null;

  const connect = () => {
    if (disposed) return;
    source = new EventSource(`/api${path}`);
    source.onopen = () => {
      lastEventAt = Date.now();
      stale.value = false;
      onRevision(lastRevision); // 重连后重拉完整快照
    };
    source.onmessage = (event) => {
      lastEventAt = Date.now();
      stale.value = false;
      try {
        const payload = JSON.parse(event.data) as { revision: number };
        if (payload.revision > lastRevision) {
          lastRevision = payload.revision;
          onRevision(payload.revision);
        }
      } catch {
        // 忽略非 revision 载荷（心跳注释不会进 onmessage）
      }
    };
  };

  const watchdog = setInterval(() => {
    if (Date.now() - lastEventAt <= 20_000) return;
    stale.value = true;
    // 死连接自愈：关闭重建（EventSource 对部分失败态不会自行重连）
    source?.close();
    connect();
  }, 5_000);

  connect();

  onUnmounted(() => {
    disposed = true;
    clearInterval(watchdog);
    source?.close();
  });

  return { revision: lastRevision, stale: readonly(stale) };
}
