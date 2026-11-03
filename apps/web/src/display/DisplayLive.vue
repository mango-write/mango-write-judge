<script setup lang="ts">
// 大屏直播面：在会话建立后由 DisplayView 挂载。固定深色（不跟随管理端主题），
// 基准 1920×1080 / 16:9，内容不滚动。progress 模式不渲染任何分数字段；
// ranking 模式每页 10 行、>10 行每 8s 翻页，prefers-reduced-motion 下取消位移与
// 自动翻页。断线保留最后快照并显示 stale。
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

import type { DisplaySnapshotDto, RankingSnapshotDto } from "@mango-write-judge/contracts";
import { api } from "../lib/api";
import { useRevisionStream } from "../lib/sse";

const { t } = useI18n();

const snapshot = ref<DisplaySnapshotDto | null>(null);
const page = ref(0);
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let pageTimer: ReturnType<typeof setInterval> | null = null;

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

async function refresh() {
  try {
    snapshot.value = await api.get<DisplaySnapshotDto>("/display/snapshot");
  } catch {
    // 保留最后快照，stale 标记由流状态负责
  }
}

const stream = useRevisionStream("/display/stream", () => {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    refresh().catch(() => undefined);
  }, 250);
});

const ranking = computed(() => (snapshot.value?.mode === "ranking" ? (snapshot.value as RankingSnapshotDto) : null));
const pageSize = 10;
const pageCount = computed(() => Math.max(1, Math.ceil((ranking.value?.rows.length ?? 0) / pageSize)));
const pageRows = computed(() => {
  const rows = ranking.value?.rows ?? [];
  return rows.slice(page.value * pageSize, (page.value + 1) * pageSize);
});

watch(pageCount, () => {
  page.value = 0;
});

function startPaging() {
  if (reduceMotion || pageCount.value <= 1) return;
  pageTimer = setInterval(() => {
    page.value = (page.value + 1) % pageCount.value;
  }, 8000);
}
function stopPaging() {
  if (pageTimer) clearInterval(pageTimer);
}
watch(pageCount, startPaging, { immediate: true });
onUnmounted(stopPaging);

onMounted(refresh);

const progressPercent = computed(() => {
  if (snapshot.value?.mode !== "progress") return 0;
  const total = Math.max(snapshot.value.judgeCount, 1);
  return Math.min(100, (snapshot.value.submittedCount / total) * 100);
});
</script>

<template>
  <div class="display-root">
    <template v-if="snapshot">
      <header class="display-header">
        <span class="display-title">{{ snapshot.eventName }}</span>
        <span v-if="stream.stale.value" class="display-stale">{{ t("display.stale") }}</span>
        <span v-else class="display-live-dot" aria-hidden="true" />
      </header>

      <!-- 进度模式：只有当前项目与提交进度，没有任何分数 -->
      <main v-if="snapshot.mode === 'progress'" class="display-progress">
        <template v-if="snapshot.status === 'closed'">
          <p class="display-idle">{{ t("display.progress.closedPending") }}</p>
        </template>
        <template v-else-if="!snapshot.currentProject">
          <p class="display-idle">{{ t("display.progress.idle") }}</p>
        </template>
        <template v-else>
          <p class="display-order"># {{ snapshot.currentProject.position }}</p>
          <h1 class="display-project-name">{{ snapshot.currentProject.name }}</h1>
          <p v-if="snapshot.currentProject.teamName" class="display-team">{{ snapshot.currentProject.teamName }}</p>
          <div class="display-meter">
            <div class="display-meter-label">
              {{ t("display.progress.submitting") }} {{ snapshot.submittedCount }} / {{ snapshot.judgeCount }}
            </div>
            <div class="display-meter-track">
              <div class="display-meter-fill" :style="{ width: `${progressPercent}%` }" />
            </div>
          </div>
        </template>
      </main>

      <!-- 排行模式 -->
      <main v-else class="display-ranking">
        <div class="display-ranking-head">
          <span :class="snapshot.final ? 'display-badge-final' : 'display-badge-live'">
            {{ snapshot.final ? t("display.ranking.final") : t("display.ranking.live") }}
          </span>
        </div>
        <TransitionGroup name="display-row" tag="ol" class="display-rows">
          <li v-for="row in pageRows" :key="row.projectId" class="display-row" :class="{ 'display-row-top': (row.rank ?? 99) <= 3 && row.rank !== null }">
            <span class="display-rank">{{ row.rank ?? "—" }}</span>
            <div class="display-row-main">
              <span class="display-row-name">{{ row.name }}</span>
              <span v-if="row.teamName" class="display-row-team">{{ row.teamName }}</span>
            </div>
            <span class="display-row-submitted">
              {{ t("display.ranking.submittedShort", { n: row.submittedCount, total: row.judgeCount }) }}
              <span v-if="!row.complete" class="display-row-missing">{{ t("display.ranking.missing") }}</span>
            </span>
            <span class="display-row-score">{{ row.scoreText ?? "—" }}</span>
          </li>
        </TransitionGroup>
        <p v-if="pageCount > 1" class="display-page">{{ page + 1 }} / {{ pageCount }}</p>
      </main>
    </template>
  </div>
</template>

<style scoped>
/* 大屏专属深色主题：不引用管理端 token，只用品牌色与中性深色阶 */
.display-root {
  --d-bg: #0b1020;
  --d-panel: #121a33;
  --d-text: #f2f5fb;
  --d-muted: #9aa6c4;
  --d-brand: var(--color-brand-400, #7aa2ff);
  --d-brand-strong: var(--color-brand-500, #4f7dff);
  height: 100vh;
  overflow: hidden;
  background:
    radial-gradient(1200px 600px at 70% -10%, rgba(122, 162, 255, 0.16), transparent),
    var(--d-bg);
  color: var(--d-text);
  font-family: var(--font-family-sans);
  display: flex;
  flex-direction: column;
}

.display-header {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 28px 64px 0;
}
.display-title {
  font-size: 28px;
  font-weight: 600;
  letter-spacing: 0.04em;
}
.display-live-dot {
  width: 12px;
  height: 12px;
  border-radius: 999px;
  background: #35d07f;
  box-shadow: 0 0 12px #35d07f;
}
.display-stale {
  margin-left: auto;
  color: #ffcf70;
  font-size: 18px;
  background: rgba(255, 207, 112, 0.12);
  border: 1px solid rgba(255, 207, 112, 0.4);
  border-radius: 999px;
  padding: 4px 16px;
}

.display-progress {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 20px;
  padding: 0 64px 64px;
  text-align: center;
}
.display-idle {
  font-size: 48px;
  color: var(--d-muted);
}
.display-order {
  font-size: 32px;
  color: var(--d-brand);
  font-weight: 600;
}
.display-project-name {
  font-size: 84px;
  font-weight: 700;
  line-height: 1.15;
  margin: 0;
}
.display-team {
  font-size: 32px;
  color: var(--d-muted);
}
.display-meter {
  margin-top: 36px;
  width: min(720px, 70%);
}
.display-meter-label {
  font-size: 40px;
  font-weight: 700;
  margin-bottom: 14px;
}
.display-meter-track {
  height: 18px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
  overflow: hidden;
}
.display-meter-fill {
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, var(--d-brand), var(--d-brand-strong));
  transition: width 0.3s ease;
}

.display-ranking {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 16px 64px 32px;
  min-height: 0;
}
.display-ranking-head {
  display: flex;
  justify-content: flex-end;
  padding: 8px 0 16px;
}
.display-badge-live,
.display-badge-final {
  font-size: 20px;
  border-radius: 999px;
  padding: 6px 20px;
}
.display-badge-live {
  color: #ffd28a;
  background: rgba(255, 210, 138, 0.12);
  border: 1px solid rgba(255, 210, 138, 0.45);
}
.display-badge-final {
  color: #7ef0b2;
  background: rgba(126, 240, 178, 0.12);
  border: 1px solid rgba(126, 240, 178, 0.45);
}

.display-rows {
  list-style: none;
  margin: 0;
  padding: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: space-evenly;
  gap: 10px;
}
.display-row {
  display: flex;
  align-items: center;
  gap: 28px;
  background: var(--d-panel);
  border: 1px solid rgba(255, 255, 255, 0.07);
  border-radius: 18px;
  padding: 14px 36px;
  min-height: 64px;
}
.display-row-top {
  border: 2px solid var(--d-brand);
  background: linear-gradient(90deg, rgba(122, 162, 255, 0.14), var(--d-panel) 55%);
  min-height: 76px;
}
.display-rank {
  width: 64px;
  font-size: 34px;
  font-weight: 700;
  color: var(--d-brand);
  text-align: center;
  flex-shrink: 0;
}
.display-row-top .display-rank {
  font-size: 40px;
}
.display-row-main {
  min-width: 0;
  flex: 1;
  display: flex;
  align-items: baseline;
  gap: 16px;
}
.display-row-name {
  font-size: 30px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.display-row-top .display-row-name {
  font-size: 34px;
}
.display-row-team {
  font-size: 20px;
  color: var(--d-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.display-row-submitted {
  font-size: 20px;
  color: var(--d-muted);
  flex-shrink: 0;
}
.display-row-missing {
  margin-left: 10px;
  color: #ffd28a;
  border: 1px solid rgba(255, 210, 138, 0.45);
  border-radius: 999px;
  padding: 1px 10px;
  font-size: 16px;
}
.display-row-score {
  width: 150px;
  text-align: right;
  font-size: 34px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}
.display-row-top .display-row-score {
  font-size: 40px;
}
.display-page {
  text-align: center;
  color: var(--d-muted);
  font-size: 18px;
  padding-top: 10px;
}

.display-row-move,
.display-row-enter-active,
.display-row-leave-active {
  transition: transform 0.25s ease, opacity 0.25s ease;
}
.display-row-enter-from,
.display-row-leave-to {
  opacity: 0;
  transform: translateY(12px);
}

@media (prefers-reduced-motion: reduce) {
  .display-row-move,
  .display-row-enter-active,
  .display-row-leave-active,
  .display-meter-fill {
    transition: none;
  }
}
</style>
