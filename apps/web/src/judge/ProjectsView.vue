<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";

import type { JudgeSnapshotDto } from "@mango-write-judge/contracts";
import { api } from "../lib/api";
import { useRevisionStream } from "../lib/sse";

const props = defineProps<{ slug: string }>();
const { t } = useI18n();
const router = useRouter();

const snapshot = ref<JudgeSnapshotDto | null>(null);
let refreshTimer: ReturnType<typeof setTimeout> | null = null;

async function refresh() {
  try {
    snapshot.value = await api.get<JudgeSnapshotDto>("/judge/snapshot");
  } catch {
    router.replace(`/judge/${props.slug}`);
  }
}

useRevisionStream("/judge/stream", () => {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    refresh().catch(() => undefined);
  }, 250);
});

const closed = computed(() => snapshot.value?.event.status === "closed");
const submittedCount = computed(
  () => snapshot.value?.projects.filter((p) => p.evaluation?.status === "submitted").length ?? 0,
);
const sourceUrl = import.meta.env.VITE_JUDGING_SOURCE_URL as string | undefined;

function statusOf(project: NonNullable<JudgeSnapshotDto["projects"][number]>): { label: string; tone: string } {
  const evaluation = project.evaluation;
  if (closed.value) return { label: t("judge.projects.closedNotice"), tone: "tw:text-faint" };
  if (!project.unlocked) return { label: t("judge.projects.statusLocked"), tone: "tw:text-faint" };
  if (!evaluation) return { label: t("judge.projects.statusPending"), tone: "tw:text-info" };
  if (evaluation.status === "draft") return { label: t("judge.projects.statusDraft"), tone: "tw:text-info" };
  if (evaluation.lockedByReveal) return { label: t("judge.projects.statusReadonly"), tone: "tw:text-warning" };
  return { label: t("judge.projects.statusSubmitted"), tone: "tw:text-success" };
}

onMounted(refresh);
</script>

<template>
  <div v-if="snapshot" class="tw:mx-auto tw:flex tw:max-w-[640px] tw:flex-col tw:px-4 tw:py-6">
    <header class="tw:flex tw:items-center tw:justify-between tw:gap-3 tw:rounded-2xl tw:border tw:border-line tw:bg-surface tw:p-4 tw:shadow-xs">
      <div>
        <h1 class="tw:text-lg tw:font-bold tw:text-default">{{ snapshot.event.name }}</h1>
        <p class="tw:mt-0.5 tw:text-sm tw:text-muted">{{ snapshot.judge.name }} · {{ t("judge.projects.title") }}</p>
      </div>
      <div class="tw:rounded-full tw:bg-primary-50 tw:px-3 tw:py-1 tw:text-xs tw:font-semibold tw:text-primary-700">
        {{ t("judge.projects.progress", { submitted: submittedCount, total: snapshot.projects.length }) }}
      </div>
    </header>

    <ul class="tw:mt-5 tw:space-y-3">
      <li v-for="project in snapshot.projects" :key="project.id">
        <button
          class="tw:w-full tw:cursor-pointer tw:rounded-2xl tw:border tw:bg-surface tw:p-4 tw:text-left tw:shadow-xs transition disabled:tw:cursor-not-allowed"
          :class="
            project.unlocked
              ? 'tw:border-line tw:hover:border-primary-300 tw:active:border-primary-400'
              : 'tw:border-dashed tw:border-line tw:opacity-60'
          "
          :style="project.active ? { borderWidth: '2px', borderColor: 'var(--color-brand-500)' } : undefined"
          :disabled="!project.unlocked"
          :aria-label="project.name"
          style="min-height: 44px"
          @click="project.unlocked && router.push(`/judge/${props.slug}/projects/${project.id}`)"
        >
          <div class="tw:flex tw:items-center tw:gap-2">
            <span class="tw:rounded tw:bg-surface-muted tw:px-1.5 tw:py-0.5 tw:font-mono tw:text-xs tw:text-faint">
              #{{ project.position }}
            </span>
            <span class="tw:text-base tw:font-semibold tw:text-default">{{ project.name }}</span>
            <span
              v-if="project.active"
              class="tw:rounded-full tw:bg-primary-100 tw:px-2.5 tw:py-0.5 tw:text-xs tw:font-semibold tw:text-primary-700"
            >
              {{ t("judge.projects.activeTag") }}
            </span>
            <div class="tw:ml-auto tw:flex tw:items-center tw:gap-2">
              <span
                v-if="project.evaluation?.submittedTotalText"
                class="tw:rounded-md tw:bg-success/10 tw:px-2 tw:py-0.5 tw:font-mono tw:text-xs tw:font-bold tw:text-success"
              >
                {{ project.evaluation.submittedTotalText }} 分
              </span>
              <span class="tw:text-xs tw:font-medium" :class="statusOf(project).tone">
                {{ statusOf(project).label }}
              </span>
            </div>
          </div>
          <div v-if="project.teamName" class="tw:mt-1.5 tw:text-sm tw:font-medium tw:text-muted">
            {{ project.teamName }}
          </div>
          <div v-if="project.summary" class="tw:mt-1 tw:text-xs tw:text-faint">
            {{ project.summary }}
          </div>
        </button>
      </li>
    </ul>

    <p class="tw:mt-6 tw:text-center tw:text-xs tw:text-faint">
      <a v-if="sourceUrl" :href="sourceUrl" target="_blank" rel="noopener" class="tw:underline">源代码</a>
    </p>
  </div>
</template>
