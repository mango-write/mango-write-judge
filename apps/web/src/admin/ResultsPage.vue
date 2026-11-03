<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";

import Button from "primevue/button";

import type { AdminSnapshotDto } from "@mango-write-judge/contracts";
import { api } from "../lib/api";
import { formatDateTime, shortHash } from "../lib/format";
import { useRevisionStream } from "../lib/sse";

const props = defineProps<{ id: string }>();
const { t } = useI18n();

const snapshot = ref<AdminSnapshotDto | null>(null);
const detailProject = ref<string | null>(null);
let refreshTimer: ReturnType<typeof setTimeout> | null = null;

const event = computed(() => snapshot.value?.event ?? null);
const results = computed(() => snapshot.value?.results ?? null);
const final = computed(() => event.value?.status === "closed");
const projectName = (id: string) => event.value?.projects.find((p) => p.id === id)?.name ?? id;

async function refresh() {
  snapshot.value = await api.get<AdminSnapshotDto>(`/admin/events/${props.id}/snapshot`);
}

useRevisionStream(`/admin/events/${props.id}/stream`, () => {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    refresh().catch(() => undefined);
  }, 300);
});

function openExport(kind: "results.csv" | "scores.csv") {
  const target = event.value;
  if (!target) return;
  window.open(`/api/admin/events/${target.id}/export/${kind}`, "_blank", "noopener");
}

onMounted(refresh);
</script>

<template>
  <div v-if="event && results" class="tw:mt-6 tw:space-y-6">
    <div class="tw:flex tw:flex-wrap tw:items-center tw:gap-3">
      <span
        class="tw:rounded-full tw:px-3 tw:py-1 tw:text-sm tw-font-medium"
        :class="final ? 'tw:bg-success/15 tw:text-success' : 'tw:bg-warning/15 tw:text-warning'"
      >
        {{ final ? t("admin.results.finalNotice") : t("admin.results.liveNotice") }}
      </span>
      <span v-if="final" class="tw:text-xs tw:text-faint">
        {{ t("admin.results.closedAt") }} {{ formatDateTime(event.closedAt) }} · {{ t("admin.results.resultHash") }}
        {{ shortHash(results.resultHash) }}
      </span>
      <div class="tw:ml-auto tw:flex tw:gap-2">
        <Button :label="t('admin.results.exportResults')" icon="pi pi-download" size="small" severity="secondary" outlined @click="openExport('results.csv')" />
        <Button :label="t('admin.results.exportScores')" icon="pi pi-download" size="small" severity="secondary" outlined @click="openExport('scores.csv')" />
      </div>
    </div>

    <div class="tw:rounded-2xl tw:border tw:border-line tw:bg-surface tw:p-6">
      <table class="tw:w-full tw:text-sm">
        <thead>
          <tr class="tw:border-b tw:border-line tw:text-left tw-text-xs tw:text-faint">
            <th class="tw:py-2">{{ t("admin.results.rank") }}</th>
            <th class="tw:py-2">{{ t("admin.results.project") }}</th>
            <th class="tw:py-2">{{ t("admin.results.score") }}</th>
            <th class="tw:py-2">已提交 / {{ event.judges.length }}</th>
            <th class="tw:py-2">{{ t("admin.results.completeness") }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in results.rows"
            :key="row.projectId"
            class="tw:cursor-pointer tw:border-b tw:border-line hover:tw:bg-canvas"
            @click="detailProject = detailProject === row.projectId ? null : row.projectId"
          >
            <td class="tw:py-2 tw:font-semibold">{{ row.rank ?? "—" }}</td>
            <td class="tw:py-2 tw:font-medium">
              <i class="pi" :class="detailProject === row.projectId ? 'pi-chevron-down' : 'pi-chevron-right'" style="font-size: 0.7rem" />
              {{ projectName(row.projectId) }}
            </td>
            <td class="tw:py-2 tw:font-semibold">{{ row.scoreText ?? "—" }}</td>
            <td class="tw:py-2 tw:text-muted">{{ row.submittedCount }} / {{ row.judgeCount }}</td>
            <td class="tw:py-2">
              <span v-if="row.complete" class="tw:text-success">{{ t("admin.results.complete") }}</span>
              <span v-else class="tw:text-warning">{{ t("admin.results.incomplete", { n: row.judgeCount - row.submittedCount }) }}</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="detailProject" class="tw:rounded-2xl tw:border tw:border-line tw:bg-surface tw:p-6">
      <h2 class="tw:text-base tw:font-semibold">{{ t("admin.results.detail") }} · {{ projectName(detailProject) }}</h2>
      <div class="tw:mt-4 tw:space-y-3">
        <div
          v-for="cell in snapshot!.matrix.find((m) => m.projectId === detailProject)?.cells ?? []"
          :key="cell.judgeId"
          class="tw:rounded-xl tw:bg-canvas tw:p-3"
        >
          <div class="tw:flex tw:items-center tw:gap-2">
            <span class="tw:font-medium">{{ event.judges.find((j) => j.id === cell.judgeId)?.name ?? cell.judgeId }}</span>
            <span v-if="cell.version > 0" class="tw:text-xs tw:text-faint">v{{ cell.version }}</span>
            <span v-if="cell.unlocked" class="tw:rounded-full tw:bg-warning/15 tw:px-2 tw:text-xs tw:text-warning">
              {{ t("admin.control.unlockedTag") }}
            </span>
            <span class="tw:ml-auto tw:font-semibold">{{ cell.submittedTotalText ?? "—" }}</span>
          </div>
          <div v-if="cell.submittedItems" class="tw:mt-2 tw:flex tw:flex-wrap tw:gap-2">
            <span
              v-for="criterion in event.criteria"
              :key="criterion.id"
              class="tw:rounded-full tw:bg-surface-muted tw:px-2 tw:py-0.5 tw:text-xs tw:text-muted"
            >
              {{ criterion.name }} {{ ((cell.submittedItems![criterion.id] ?? 0) / 10).toFixed(1) }}
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
