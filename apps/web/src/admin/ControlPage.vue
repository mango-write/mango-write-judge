<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  ExternalLink,
  Lock,
  LockOpen,
  QrCode,
  RefreshCw,
  TriangleAlert,
} from "lucide-vue-next";

import QRCode from "qrcode";

import { Button, Dialog, ProgressBar, useConfirm, useNotify } from "@mango-write/ui";

import type { AdminSnapshotDto, MatrixCellDto } from "@mango-write-judge/contracts";
import { api } from "../lib/api";
import { useRevisionStream } from "../lib/sse";

const props = defineProps<{ id: string }>();
const { t } = useI18n();
const notify = useNotify();
const confirm = useConfirm();

const snapshot = ref<AdminSnapshotDto | null>(null);
const expandedProject = ref<string | null>(null);
const displayInvite = ref<{ inviteUrl: string; qrDataUrl?: string } | null>(null);
const busy = ref(false);
let refreshTimer: ReturnType<typeof setTimeout> | null = null;

const event = computed(() => snapshot.value?.event ?? null);
const activeIndex = computed(() => {
  if (!event.value) return -1;
  return event.value.projects.findIndex((p) => p.id === event.value!.activeProjectId);
});
const activeProject = computed(() => (activeIndex.value >= 0 ? event.value!.projects[activeIndex.value]! : null));
const activeRow = computed(() => snapshot.value?.matrix.find((m) => m.projectId === activeProject.value?.id));
const activeSubmitted = computed(() => {
  const cells = activeRow.value?.cells ?? [];
  return cells.filter((c) => c.status === "submitted").length;
});
const allProjectsUnlocked = computed(
  () => (event.value?.projects.length ?? 0) > 0 && event.value!.projects.every((p) => p.unlockedAt !== null),
);
const incompleteProjectsCount = computed(() => {
  const rows = snapshot.value?.results?.rows ?? [];
  return rows.filter((r) => !r.complete).length;
});

async function refresh() {
  snapshot.value = await api.get<AdminSnapshotDto>(`/admin/events/${props.id}/snapshot`);
}

const stream = useRevisionStream(`/admin/events/${props.id}/stream`, (revision) => {
  void revision;
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    refresh().catch(() => undefined);
  }, 200);
});

async function setProject(index: number) {
  const project = event.value?.projects[index];
  if (!project) return;
  try {
    await api.post(`/admin/events/${event.value!.id}/active-project`, { projectId: project.id });
    await refresh();
  } catch (error) {
    notify.add({
      severity: "error",
      detail: t(`errors.${(error as { code?: string }).code ?? "internal_error"}`),
      life: 5000,
    });
  }
}

async function unlockAllProjects() {
  if (!event.value || busy.value) return;
  busy.value = true;
  try {
    await api.post(`/admin/events/${event.value.id}/projects/unlock-all`);
    notify.add({ severity: "success", detail: t("admin.control.unlockAllProjectsDone"), life: 2500 });
    await refresh();
  } catch (error) {
    notify.add({
      severity: "error",
      detail: t(`errors.${(error as { code?: string }).code ?? "internal_error"}`),
      life: 5000,
    });
  } finally {
    busy.value = false;
  }
}

function switchMode(mode: "progress" | "ranking") {
  const target = event.value;
  if (!target || target.displayMode === mode) return;
  const firstReveal = mode === "ranking" && !target.revealedAt;
  const doSwitch = async () => {
    try {
      await api.post(`/admin/events/${target.id}/display-mode`, {
        mode,
        confirmReveal: firstReveal ? true : undefined,
      });
      await refresh();
    } catch (error) {
      notify.add({
        severity: "error",
        detail: t(`errors.${(error as { code?: string }).code ?? "internal_error"}`),
        life: 5000,
      });
    }
  };
  if (firstReveal) {
    confirm.require({
      header: t("admin.control.revealConfirmHeader"),
      message: t("admin.control.revealConfirm"),
      icon: TriangleAlert,
      acceptLabel: t("common.ok"),
      rejectLabel: t("common.cancel"),
      accept: doSwitch,
    });
  } else {
    void doSwitch();
  }
}

async function openDisplay() {
  const target = event.value!;
  let inviteUrl = target.displayInviteUrl;
  if (!inviteUrl) {
    const rotated = await api.post<{ inviteUrl: string }>(`/admin/events/${target.id}/display-token/rotate`);
    inviteUrl = rotated.inviteUrl;
    await refresh();
  }
  try {
    displayInvite.value = { inviteUrl, qrDataUrl: await QRCode.toDataURL(inviteUrl, { width: 320, margin: 2 }) };
  } catch {
    displayInvite.value = { inviteUrl };
  }
}

async function rotateDisplay() {
  const target = event.value!;
  const rotated = await api.post<{ inviteUrl: string }>(`/admin/events/${target.id}/display-token/rotate`);
  try {
    displayInvite.value = {
      inviteUrl: rotated.inviteUrl,
      qrDataUrl: await QRCode.toDataURL(rotated.inviteUrl, { width: 320, margin: 2 }),
    };
  } catch {
    displayInvite.value = rotated;
  }
  notify.add({ severity: "success", detail: "大屏链接已重置", life: 2500 });
  await refresh();
}

function openDisplayWindow(url?: string) {
  const targetUrl = url || event.value?.displayInviteUrl;
  if (!targetUrl) return;
  window.open(targetUrl, "_blank", "noopener");
}

function unlockCell(cell: MatrixCellDto) {
  const target = event.value!;
  confirm.require({
    header: t("admin.control.unlock"),
    message: t("admin.control.unlockConfirm"),
    icon: LockOpen,
    acceptLabel: t("admin.control.unlock"),
    rejectLabel: t("common.cancel"),
    accept: async () => {
      try {
        await api.post(`/admin/events/${target.id}/evaluations/${cell.evaluationId}/unlock`);
        notify.add({ severity: "success", detail: "已解锁，等待评委重新提交", life: 3000 });
        await refresh();
      } catch (error) {
        notify.add({
          severity: "error",
          detail: t(`errors.${(error as { code?: string }).code ?? "internal_error"}`),
          life: 5000,
        });
      }
    },
  });
}

async function unlockAllEvaluations() {
  const target = event.value;
  if (!target) return;
  try {
    await api.post(`/admin/events/${target.id}/evaluations/unlock-all`);
    notify.add({ severity: "success", detail: "已解锁全部已提交评分，评委可修改重交", life: 3000 });
    await refresh();
  } catch (error) {
    notify.add({
      severity: "error",
      detail: t(`errors.${(error as { code?: string }).code ?? "internal_error"}`),
      life: 5000,
    });
  }
}

function revokeCell(cell: MatrixCellDto) {
  const target = event.value!;
  confirm.require({
    header: t("admin.control.revokeUnlock"),
    message: t("admin.control.revokeConfirm"),
    icon: Lock,
    acceptLabel: t("admin.control.revokeUnlock"),
    rejectLabel: t("common.cancel"),
    accept: async () => {
      try {
        await api.delete(`/admin/events/${target.id}/evaluations/${cell.evaluationId}/unlock`);
        await refresh();
      } catch (error) {
        notify.add({
          severity: "error",
          detail: t(`errors.${(error as { code?: string }).code ?? "internal_error"}`),
          life: 5000,
        });
      }
    },
  });
}

function confirmCloseEvent() {
  const target = event.value;
  if (!target || target.status !== "judging") return;
  const missingCount = incompleteProjectsCount.value;
  confirm.require({
    header: t("admin.control.closeConfirmHeader"),
    message:
      missingCount > 0
        ? t("admin.control.closeConfirmWithMissing", { count: missingCount })
        : t("admin.control.closeConfirmAllComplete"),
    icon: Lock,
    acceptLabel: t("admin.control.closeEvent"),
    rejectLabel: t("common.cancel"),
    accept: async () => {
      try {
        await api.post(`/admin/events/${target.id}/close`, { confirm: true });
        notify.add({ severity: "success", detail: t("admin.control.closedSuccess"), life: 4000 });
        await refresh();
      } catch (error) {
        notify.add({
          severity: "error",
          detail: t(`errors.${(error as { code?: string }).code ?? "internal_error"}`),
          life: 5000,
        });
      }
    },
  });
}

async function copyText(text: string) {
  try {
    await navigator.clipboard?.writeText(text);
    notify.add({ severity: "success", detail: t("common.copied"), life: 1500 });
  } catch {
    // 无剪贴板权限时忽略；链接已完整展示
  }
}

function judgeName(judgeId: string): string {
  return event.value?.judges.find((j) => j.id === judgeId)?.name ?? judgeId;
}

function cellTag(cell: MatrixCellDto): { label: string; tone: string } {
  if (cell.unlocked) return { label: t("admin.control.unlockedTag"), tone: "tw:bg-warning/15 tw:text-warning" };
  if (cell.status === "submitted")
    return { label: t("admin.control.submittedTag"), tone: "tw:bg-success/15 tw:text-success" };
  if (cell.status === "draft") return { label: t("admin.control.draftTag"), tone: "tw:bg-info/15 tw:text-info" };
  return { label: t("admin.control.none"), tone: "tw:bg-surface-muted tw:text-faint" };
}

function submittedCountOf(projectId: string): number {
  const row = snapshot.value?.matrix.find((m) => m.projectId === projectId);
  return row?.cells.filter((c) => c.status === "submitted").length ?? 0;
}

onMounted(refresh);
onUnmounted(() => {
  if (refreshTimer) clearTimeout(refreshTimer);
});
</script>

<template>
  <div v-if="event && snapshot" class="tw:mt-6 tw:grid tw:gap-6 tw:lg:grid-cols-[1fr_360px]">
    <section class="tw:space-y-6">
      <!-- 当前路演项目与快速切场 -->
      <div class="tw:rounded-2xl tw:border tw:border-line tw:bg-surface tw:p-6">
        <div class="tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-2">
          <h2 class="tw:text-base tw:font-semibold">{{ t("admin.control.currentProject") }}</h2>
          <Button
            v-if="event.status === 'judging' && !allProjectsUnlocked"
            :label="t('admin.control.unlockAllProjects')"
            :icon="LockOpen"
            severity="secondary"
            outlined
            :loading="busy"
            @click="unlockAllProjects"
          />
          <span
            v-else-if="allProjectsUnlocked"
            class="tw:rounded-full tw:bg-success/15 tw:px-2.5 tw:py-0.5 tw:text-xs tw:font-medium tw:text-success"
          >
            {{ t("admin.control.unlockAllProjectsDone") }}
          </span>
        </div>

        <div v-if="activeProject" class="tw:mt-4 tw:rounded-xl tw:border tw:border-primary-200 tw:bg-primary-50/40 tw:p-4">
          <div class="tw:flex tw:items-center tw:gap-2">
            <span class="tw:rounded-md tw:bg-primary-100 tw:px-2 tw:py-0.5 tw:text-xs tw:font-bold tw:text-primary-700">
              # {{ activeIndex + 1 }} / {{ event.projects.length }}
            </span>
            <span class="tw:text-xs tw:font-medium tw:text-primary-700">{{ t("admin.control.activeBadge") }}</span>
          </div>
          <div class="tw:mt-2 tw:text-2xl tw:font-bold tw:text-default">{{ activeProject.name }}</div>
          <div v-if="activeProject.teamName" class="tw:mt-0.5 tw:text-sm tw:text-muted">{{ activeProject.teamName }}</div>
          <div v-if="activeProject.summary" class="tw:mt-1 tw:text-xs tw:text-faint">{{ activeProject.summary }}</div>
          <div class="tw:mt-4 tw:max-w-md">
            <div class="tw:mb-1.5 tw:flex tw:justify-between tw:text-sm tw:font-medium tw:text-muted">
              <span>{{ t("admin.control.submitted", { submitted: activeSubmitted, total: event.judges.length }) }}</span>
              <span>{{ Math.round((activeSubmitted / Math.max(event.judges.length, 1)) * 100) }}%</span>
            </div>
            <ProgressBar
              :value="(activeSubmitted / Math.max(event.judges.length, 1)) * 100"
              :show-value="false"
              class="tw:h-2.5"
            />
          </div>
        </div>
        <div
          v-else
          class="tw:mt-4 tw:rounded-xl tw:border tw:border-dashed tw:border-line tw:bg-canvas tw:p-4 tw:text-sm tw:text-muted"
        >
          {{ t("admin.control.noActive") }}
        </div>

        <div class="tw:mt-4 tw:flex tw:flex-wrap tw:items-center tw:gap-2">
          <Button
            :icon="ChevronLeft"
            :label="t('admin.control.prev')"
            severity="secondary"
            outlined
            :disabled="event.status !== 'judging' || activeIndex <= 0"
            @click="setProject(activeIndex - 1)"
          />
          <Button
            :icon="ChevronRight"
            icon-pos="right"
            :label="t('admin.control.next')"
            :disabled="event.status !== 'judging' || activeIndex >= event.projects.length - 1"
            @click="setProject(activeIndex + 1)"
          />
        </div>

        <!-- 项目直达切场条 -->
        <div v-if="event.projects.length > 0" class="tw:mt-5 tw:border-t tw:border-line tw:pt-4">
          <div class="tw:mb-2 tw:text-xs tw:font-medium tw:text-muted">点击任意项目可直接切为当前路演并开放评分：</div>
          <div class="tw:grid tw:gap-2 tw:sm:grid-cols-2 tw:md:grid-cols-3">
            <button
              v-for="(proj, idx) in event.projects"
              :key="proj.id"
              type="button"
              :disabled="event.status !== 'judging'"
              class="tw:flex tw:cursor-pointer tw:items-center tw:justify-between tw:gap-2 tw:rounded-xl tw:border tw:px-3 tw:py-2 tw:text-left tw:text-xs transition disabled:tw:cursor-not-allowed disabled:tw:opacity-60"
              :class="
                proj.active
                  ? 'tw:border-primary-500 tw:bg-primary-50 tw:font-semibold'
                  : proj.unlockedAt
                    ? 'tw:border-line tw:bg-surface tw:hover:border-primary-300'
                    : 'tw:border-dashed tw:border-line tw:bg-canvas tw:text-muted tw:hover:border-primary-300'
              "
              @click="setProject(idx)"
            >
              <span class="tw:truncate">#{{ idx + 1 }} {{ proj.name }}</span>
              <span class="tw:shrink-0 tw:text-faint">
                {{ submittedCountOf(proj.id) }}/{{ event.judges.length }}
              </span>
            </button>
          </div>
        </div>
      </div>

      <!-- 提交矩阵 -->
      <div class="tw:rounded-2xl tw:border tw:border-line tw:bg-surface tw:p-6">
        <div class="tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-2">
          <div>
            <h2 class="tw:text-base tw:font-semibold">{{ t("admin.control.matrix") }}</h2>
            <p class="tw:mt-0.5 tw:text-sm tw:text-muted">{{ t("admin.control.matrixHint") }}</p>
          </div>
          <Button
            v-if="event.revealedAt && event.status === 'judging'"
            :label="t('admin.control.unlockAll')"
            :icon="LockOpen"
            severity="warning"
            outlined
            @click="unlockAllEvaluations"
          />
        </div>

        <div class="tw:mt-4 tw:overflow-x-auto">
          <table class="tw:w-full tw:text-sm">
            <thead>
              <tr class="tw:border-b tw:border-line tw:text-left tw:text-xs tw:text-faint">
                <th class="tw:py-2.5 tw:pr-2">#</th>
                <th class="tw:py-2.5 tw:pr-2">项目</th>
                <th v-for="judge in event.judges" :key="judge.id" class="tw:px-1.5 tw:py-2.5">{{ judge.name }}</th>
              </tr>
            </thead>
            <tbody>
              <template v-for="(row, index) in snapshot.matrix" :key="row.projectId">
                <tr
                  class="tw:cursor-pointer tw:border-b tw:border-line tw:hover:bg-canvas"
                  @click="expandedProject = expandedProject === row.projectId ? null : row.projectId"
                >
                  <td class="tw:py-3 tw:pr-2 tw:text-faint">{{ index + 1 }}</td>
                  <td class="tw:py-3 tw:pr-2 tw:font-medium">
                    <component
                      :is="expandedProject === row.projectId ? ChevronDown : ChevronRight"
                      class="tw:mr-1 tw:inline-block"
                      :size="12"
                    />
                    {{ event.projects.find((p) => p.id === row.projectId)?.name }}
                  </td>
                  <td v-for="cell in row.cells" :key="cell.judgeId" class="tw:px-1.5 tw:py-3">
                    <div class="tw:inline-flex tw:items-center tw:gap-1.5">
                      <span class="tw:rounded-full tw:px-2 tw:py-0.5 tw:text-xs" :class="cellTag(cell).tone">
                        {{ cellTag(cell).label }}
                      </span>
                      <span v-if="cell.submittedTotalText" class="tw:font-mono tw:text-xs tw:font-semibold">
                        {{ cell.submittedTotalText }}
                      </span>
                    </div>
                  </td>
                </tr>
                <tr v-if="expandedProject === row.projectId" class="tw:border-b tw:border-line tw:bg-canvas">
                  <td />
                  <td colspan="100" class="tw:py-3 tw:pr-4">
                    <div class="tw:space-y-2">
                      <div
                        v-for="cell in row.cells"
                        :key="cell.judgeId"
                        class="tw:flex tw:flex-wrap tw:items-center tw:gap-2 tw:rounded-lg tw:bg-surface tw:px-3 tw:py-2 tw:text-sm"
                      >
                        <span class="tw:w-24 tw:font-medium">{{ judgeName(cell.judgeId) }}</span>
                        <span class="tw:rounded-full tw:px-2 tw:py-0.5 tw:text-xs" :class="cellTag(cell).tone">
                          {{ cellTag(cell).label }}
                        </span>
                        <span v-if="cell.submittedTotalText" class="tw:font-semibold">
                          {{ cell.submittedTotalText }} 分
                        </span>
                        <span v-if="cell.version > 0" class="tw:text-xs tw:text-faint">v{{ cell.version }}</span>
                        <div class="tw:ml-auto tw:flex tw:gap-2">
                          <template v-if="cell.unlocked">
                            <Button
                              :label="t('admin.control.revokeUnlock')"
                              severity="secondary"
                              text
                              @click.stop="revokeCell(cell)"
                            />
                          </template>
                          <template
                            v-else-if="cell.status === 'submitted' && event.revealedAt && event.status === 'judging'"
                          >
                            <Button
                              :label="t('admin.control.unlock')"
                              severity="warning"
                              text
                              @click.stop="unlockCell(cell)"
                            />
                          </template>
                        </div>
                      </div>
                    </div>
                  </td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <aside class="tw:space-y-6">
      <div class="tw:rounded-2xl tw:border tw:border-line tw:bg-surface tw:p-6">
        <h2 class="tw:text-base tw:font-semibold">{{ t("admin.control.displayControl") }}</h2>
        <div class="tw:mt-3 tw:grid tw:grid-cols-2 tw:gap-2">
          <Button
            :label="t('admin.control.modeProgress')"
            :severity="event.displayMode === 'progress' ? 'primary' : 'secondary'"
            :outlined="event.displayMode !== 'progress'"
            @click="switchMode('progress')"
          />
          <Button
            :label="t('admin.control.modeRanking')"
            :severity="event.displayMode === 'ranking' ? 'primary' : 'secondary'"
            :outlined="event.displayMode !== 'ranking'"
            @click="switchMode('ranking')"
          />
        </div>
        <p v-if="event.revealedAt" class="tw:mt-3 tw:text-xs tw:text-warning">{{ t("admin.control.revealedNotice") }}</p>
        <div class="tw:mt-4 tw:flex tw:flex-wrap tw:gap-2">
          <Button
            :label="t('admin.control.openDisplay')"
            :icon="QrCode"
            severity="secondary"
            outlined
            @click="openDisplay"
          />
          <Button
            v-if="event.displayInviteUrl"
            :label="t('admin.control.openDisplayWindow')"
            :icon="ExternalLink"
            severity="secondary"
            text
            @click="openDisplayWindow()"
          />
        </div>
      </div>

      <!-- 闭幕锁定卡片 -->
      <div class="tw:rounded-2xl tw:border tw:border-line tw:bg-surface tw:p-6">
        <h2 class="tw:text-base tw:font-semibold">比赛阶段与闭幕</h2>
        <template v-if="event.status === 'judging'">
          <p class="tw:mt-2 tw:text-xs tw:text-muted">
            全部路演与评分结束后，可闭幕锁定最终成绩并生成防篡改结果快照。
          </p>
          <Button
            class="tw:mt-4 tw:w-full"
            :label="t('admin.control.closeEvent')"
            :icon="Lock"
            severity="danger"
            outlined
            @click="confirmCloseEvent"
          />
        </template>
        <p v-else-if="event.status === 'closed'" class="tw:mt-2 tw:text-sm tw:text-success">
          {{ t("admin.control.closedNotice") }}
        </p>
        <p v-else class="tw:mt-2 tw:text-sm tw:text-muted">
          比赛尚未启动，请先完成配置并启动比赛。
        </p>
      </div>

      <div v-if="stream.stale.value" class="tw:rounded-xl tw:bg-warning/10 tw:px-4 tw:py-3 tw:text-sm tw:text-warning">
        {{ t("common.offline") }}
      </div>
    </aside>

    <Dialog
      :open="displayInvite !== null"
      modal
      title="大屏链接"
      width="min(24rem, 92vw)"
      closable
      @update:open="(value) => { if (!value) displayInvite = null; }"
    >
      <div v-if="displayInvite" class="tw:flex tw:flex-col tw:items-center tw:gap-3">
        <img v-if="displayInvite.qrDataUrl" :src="displayInvite.qrDataUrl" alt="QR" class="tw:h-72 tw:w-72" />
        <code class="tw:max-w-full tw:break-all tw:rounded tw:bg-canvas tw:p-2 tw:text-xs">{{ displayInvite.inviteUrl }}</code>
        <div class="tw:flex tw:flex-wrap tw:justify-center tw:gap-2">
          <Button
            :label="t('common.copy')"
            :icon="Copy"
            severity="secondary"
            outlined
            @click="copyText(displayInvite!.inviteUrl)"
          />
          <Button
            :label="t('admin.control.openDisplayWindow')"
            :icon="ExternalLink"
            severity="primary"
            @click="openDisplayWindow(displayInvite!.inviteUrl)"
          />
          <Button
            :label="t('admin.settings.rotateDisplayToken')"
            :icon="RefreshCw"
            severity="secondary"
            text
            @click="rotateDisplay"
          />
        </div>
        <p class="tw:text-xs tw:text-faint">可直接在新窗口打开大屏投屏，或复制链接至现场大屏电脑打开。</p>
      </div>
    </Dialog>
  </div>
</template>
