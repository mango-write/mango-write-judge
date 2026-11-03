<script setup lang="ts">
// 评分页：每评分项一卡（Slider + 数字输入双通道），底部固定操作栏（自动保存态 +
// 确认提交）。加权总分经 @mango-write-judge/domain 同一实现计算，服务端为准。
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { useToast } from "primevue/usetoast";

import Button from "primevue/button";
import Dialog from "primevue/dialog";

import { formatMilli2, judgeTotalMilli } from "@mango-write-judge/domain";
import type { JudgeSnapshotDto, SubmitScoresResponseDto } from "@mango-write-judge/contracts";
import { api, ApiError } from "../lib/api";
import { tenthsToText } from "../lib/format";
import { useRevisionStream } from "../lib/sse";
import CriterionCard from "./CriterionCard.vue";

const props = defineProps<{ slug: string; projectId: string }>();
const { t } = useI18n();
const toast = useToast();
const router = useRouter();

const snapshot = ref<JudgeSnapshotDto | null>(null);
const scores = ref<Record<string, number>>({});
const saveState = ref<"idle" | "dirty" | "saving" | "saved" | "error">("idle");
const confirming = ref(false);
const submitting = ref(false);
const highlightMissing = ref<string | null>(null);
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let operationId: string | null = null;

const project = computed(() => snapshot.value?.projects.find((p) => p.id === props.projectId) ?? null);
const evaluation = computed(() => project.value?.evaluation ?? null);
const readonly = computed(
  () =>
    !snapshot.value ||
    snapshot.value.event.status !== "judging" ||
    !project.value?.unlocked ||
    (evaluation.value !== null && !evaluation.value.canSaveDraft),
);
// 尚无评分行（从未保存过草稿）时，首提交流程与首次草稿同权限：评审中且已解锁即可
const canSubmit = computed(
  () => evaluation.value?.canSubmit ?? (snapshot.value?.event.status === "judging" && project.value?.unlocked === true),
);
const version = computed(() => evaluation.value?.version ?? 0);
const unlockedBanner = computed(() => evaluation.value?.status === "submitted" && canSubmit.value);

const myTotalText = computed(() => {
  if (!snapshot.value) return "—";
  const criteria = snapshot.value.criteria.map((c) => ({ id: c.id, weightPercent: c.weightPercent }));
  const milli = judgeTotalMilli(new Map(Object.entries(scores.value)), criteria);
  return milli === null ? "—" : formatMilli2(milli);
});

const missingCount = computed(
  () => snapshot.value?.criteria.filter((c) => scores.value[c.id] === undefined).length ?? 0,
);

async function refresh() {
  try {
    const next = await api.get<JudgeSnapshotDto>("/judge/snapshot");
    snapshot.value = next;
    const nextEvaluation = next.projects.find((p) => p.id === props.projectId)?.evaluation ?? null;
    if (saveState.value !== "dirty" && saveState.value !== "saving") {
      scores.value = { ...(nextEvaluation?.items ?? {}) };
    }
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

function onScoreChange(criterionId: string) {
  if (readonly.value) return;
  highlightMissing.value = null;
  saveState.value = "dirty";
  if (saveTimer) clearTimeout(saveTimer);
  // 草稿自动保存去抖：停止输入 800ms 后全量保存
  saveTimer = setTimeout(() => void saveDraft(), 800);
}

async function saveDraft() {
  if (saveState.value === "saving" || saveState.value === "saved") return;
  saveState.value = "saving";
  try {
    await api.put(`/judge/projects/${props.projectId}/draft`, {
      scores: scores.value,
      expectedVersion: version.value,
    });
    saveState.value = "saved";
    // 首次草稿保存会创建评分行（权限/版本来自快照），刷新以显示提交入口
    await refresh();
  } catch (error) {
    saveState.value = "error";
    if (error instanceof ApiError && error.code === "revision_conflict") {
      toast.add({ severity: "warn", detail: t("errors.revision_conflict"), life: 4000 });
      await refresh();
      saveState.value = "idle";
    }
  }
}

function openConfirm() {
  if (missingCount.value > 0) {
    const first = snapshot.value!.criteria.find((c) => scores.value[c.id] === undefined);
    if (first) {
      highlightMissing.value = first.id;
      toast.add({
        severity: "warn",
        detail: t("judge.score.missingFirst", { n: missingCount.value }),
        life: 4000,
      });
      document.getElementById(`criterion-${first.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    return;
  }
  confirming.value = true;
}

async function submit() {
  if (submitting.value) return;
  if (!operationId) operationId = crypto.randomUUID();
  submitting.value = true;
  try {
    await saveDraft();
    const result = await api.post<SubmitScoresResponseDto>(`/judge/projects/${props.projectId}/submit`, {
      scores: scores.value,
      expectedVersion: version.value,
      operationId,
    });
    operationId = null;
    confirming.value = false;
    saveState.value = "saved";
    toast.add({
      severity: "success",
      detail: `${t("judge.score.submittedOk")} · v${result.version}`,
      life: 3000,
    });
    await refresh();
  } catch (error) {
    if (error instanceof ApiError && error.code === "revision_conflict") {
      toast.add({ severity: "warn", detail: t("errors.revision_conflict"), life: 4000 });
      await refresh();
    } else if (error instanceof ApiError && error.code === "idempotency_conflict") {
      operationId = null;
      toast.add({ severity: "warn", detail: t("errors.idempotency_conflict"), life: 4000 });
    } else {
      toast.add({
        severity: "error",
        detail: t(error instanceof Error ? `errors.${(error as { code?: string }).code ?? "internal_error"}` : "errors.internal_error"),
        life: 5000,
      });
    }
  } finally {
    submitting.value = false;
  }
}

watch(readonly, (locked) => {
  if (locked && saveTimer) {
    clearTimeout(saveTimer);
    if (saveState.value === "dirty") saveState.value = "idle";
  }
});

onMounted(refresh);
onUnmounted(() => {
  if (saveTimer) clearTimeout(saveTimer);
  if (refreshTimer) clearTimeout(refreshTimer);
  // 离开页面时把未保存草稿立即落库
  if (saveState.value === "dirty") void saveDraft();
});
</script>

<template>
  <div v-if="snapshot && project" class="tw:mx-auto tw:flex tw:max-w-[640px] tw:flex-col tw:px-4 tw-pb-32">
    <header class="tw:sticky tw-top-0 tw:z-10 tw:-mx-4 tw:px-4 tw-py-4" style="background: var(--color-bg-page, var(--color-canvas))">
      <Button
        :label="t('common.back')"
        icon="pi pi-arrow-left"
        severity="secondary"
        text
        size="small"
        @click="router.push(`/judge/${props.slug}/projects`)"
      />
      <div class="tw:mt-2">
        <div class="tw:text-xs tw:text-faint">#{{ project.position }} · {{ snapshot.event.name }}</div>
        <h1 class="tw:text-lg tw:font-semibold">{{ project.name }}</h1>
        <div v-if="project.teamName" class="tw:text-sm tw:text-muted">{{ project.teamName }}</div>
      </div>
      <div class="tw:mt-2 tw:flex tw:items-center tw-gap-2">
        <span class="tw:rounded-full tw:bg-surface-muted tw:px-3 tw:py-1 tw-text-sm">
          {{ t("judge.score.myScore") }}：<span class="tw:text-base tw:font-bold">{{ myTotalText }}</span>
        </span>
        <span v-if="version > 0" class="tw:text-xs tw:text-faint">{{ t("judge.score.versionTag", { version }) }}</span>
      </div>
    </header>

    <div v-if="snapshot.event.status === 'closed'" class="tw:mt-2 tw:rounded-xl tw:bg-surface-muted tw:px-4 tw:py-3 tw-text-sm tw:text-muted">
      {{ t("judge.score.closedBanner") }}
    </div>
    <div v-else-if="readonly" class="tw:mt-2 tw:rounded-xl tw:bg-warning/10 tw:px-4 tw:py-3 tw-text-sm tw:text-warning">
      {{ t("judge.score.readonly") }}
    </div>
    <div v-else-if="unlockedBanner" class="tw:mt-2 tw:rounded-xl tw:bg-success/10 tw:px-4 tw:py-3 tw:text-sm tw:text-success">
      {{ t("judge.score.unlockedBanner") }}
    </div>

    <CriterionCard
      v-for="criterion in snapshot.criteria"
      :id="`criterion-${criterion.id}`"
      :key="criterion.id"
      class="tw:mt-4"
      :name="criterion.name"
      :description="criterion.description"
      :weight-percent="criterion.weightPercent"
      :model-value="scores[criterion.id]"
      :disabled="readonly"
      :highlight="highlightMissing === criterion.id"
      @update="(tenths) => { scores[criterion.id] = tenths; onScoreChange(criterion.id); }"
    />

    <nav
      class="tw:fixed tw:bottom-0 tw:left-0 tw:right-0 tw:z-20 tw:border-t tw:border-line tw:bg-surface judge-footer-safe"
      style="min-height: 56px"
    >
      <div class="tw:mx-auto tw-flex tw:max-w-[640px] tw:items-center tw:gap-3 tw:px-4 tw-py-3">
        <button
          v-if="saveState === 'error'"
          class="tw:text-sm tw:font-medium tw:text-danger"
          style="min-height: 44px"
          @click="saveState = 'dirty'; saveDraft()"
        >
          {{ t("common.saveFailed") }}
        </button>
        <span v-else class="tw:text-sm tw:text-faint">
          {{ saveState === "saving" ? t("common.saving") : saveState === "saved" ? t("common.saved") : "" }}
        </span>
        <div class="tw:ml-auto">
          <Button
            v-if="canSubmit"
            :label="version > 0 ? t('judge.score.resubmit') : t('judge.score.submit')"
            class="tw:px-6"
            style="min-height: 44px"
            @click="openConfirm"
          />
        </div>
      </div>
    </nav>

    <Dialog v-model:visible="confirming" modal :header="t('judge.score.confirmTitle')" class="tw:min-w-80">
      <div class="tw-space-y-2">
        <div class="tw-flex tw:justify-between tw-border-b tw-border-line tw-py-2" v-for="criterion in snapshot.criteria" :key="criterion.id">
          <span>{{ criterion.name }}<span class="tw:ml-1 tw:text-xs tw:text-faint">{{ criterion.weightPercent }}%</span></span>
          <span class="tw:font-semibold">{{ scores[criterion.id] !== undefined ? tenthsToText(scores[criterion.id]!) : "—" }}</span>
        </div>
        <div class="tw:flex tw:justify-between tw-py-2 tw-text-base">
          <span class="tw:font-semibold">{{ t("judge.score.confirmTotal") }}</span>
          <span class="tw:font-bold">{{ myTotalText }}</span>
        </div>
        <p v-if="version > 0" class="tw-text-sm tw:text-warning">
          {{ t("judge.score.confirmOverwrite", { old: version, new: version + 1 }) }}
        </p>
      </div>
      <template #footer>
        <Button :label="t('common.cancel')" severity="secondary" text @click="confirming = false" />
        <Button :label="t('common.confirm')" :loading="submitting" @click="submit" />
      </template>
    </Dialog>
  </div>
</template>
