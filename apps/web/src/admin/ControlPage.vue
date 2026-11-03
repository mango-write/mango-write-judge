<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useConfirm } from "primevue/useconfirm";
import { useToast } from "primevue/usetoast";

import QRCode from "qrcode";

import Button from "primevue/button";
import Dialog from "primevue/dialog";
import ProgressBar from "primevue/progressbar";

import type { AdminSnapshotDto, MatrixCellDto } from "@mango-write-judge/contracts";
import { api } from "../lib/api";
import { useRevisionStream } from "../lib/sse";

const props = defineProps<{ id: string }>();
const { t } = useI18n();
const toast = useToast();
const confirm = useConfirm();

const snapshot = ref<AdminSnapshotDto | null>(null);
const expandedProject = ref<string | null>(null);
const displayInvite = ref<{ inviteUrl: string; qrDataUrl?: string } | null>(null);
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
const stale = ref(false);

async function refresh() {
  snapshot.value = await api.get<AdminSnapshotDto>(`/admin/events/${props.id}/snapshot`);
}

const stream = useRevisionStream(`/admin/events/${props.id}/stream`, (revision) => {
  void revision;
  if (refreshTimer) clearTimeout(refreshTimer);
  // 短时连发合并刷新
  refreshTimer = setTimeout(() => {
    refresh().catch(() => undefined);
  }, 200);
});

async function setProject(index: number) {
  const project = event.value?.projects[index];
  if (!project) return;
  try {
    await api.post(`/admin/events/${event.value!.id}/active-project`, { projectId: project.id });
  } catch (error) {
    toast.add({ severity: "error", detail: t(`errors.${(error as { code?: string }).code ?? "internal_error"}`), life: 5000 });
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
    } catch (error) {
      toast.add({ severity: "error", detail: t(`errors.${(error as { code?: string }).code ?? "internal_error"}`), life: 5000 });
    }
  };
  if (firstReveal) {
    confirm.require({
      header: t("admin.control.revealConfirmHeader"),
      message: t("admin.control.revealConfirm"),
      icon: "pi pi-exclamation-triangle",
      acceptLabel: t("common.confirm"),
      rejectLabel: t("common.cancel"),
      accept: doSwitch,
    });
  } else {
    void doSwitch();
  }
}

async function openDisplay() {
  const target = event.value!;
  const invite = await api.post<{ inviteUrl: string }>(`/admin/events/${target.id}/display-token/rotate`);
  try {
    displayInvite.value = { ...invite, qrDataUrl: await QRCode.toDataURL(invite.inviteUrl, { width: 320, margin: 2 }) };
  } catch {
    displayInvite.value = invite;
  }
  await refresh();
}

function fullscreen() {
  if (document.fullscreenElement) {
    void document.exitFullscreen();
  } else {
    void document.documentElement.requestFullscreen();
  }
}

function unlockCell(cell: MatrixCellDto) {
  const target = event.value!;
  confirm.require({
    header: t("admin.control.unlock"),
    message: t("admin.control.unlockConfirm"),
    icon: "pi pi-unlock",
    acceptLabel: t("admin.control.unlock"),
    rejectLabel: t("common.cancel"),
    accept: async () => {
      try {
        await api.post(`/admin/events/${target.id}/evaluations/${cell.evaluationId}/unlock`);
        toast.add({ severity: "success", detail: "已解锁，等待评委重新提交", life: 3000 });
      } catch (error) {
        toast.add({ severity: "error", detail: t(`errors.${(error as { code?: string }).code ?? "internal_error"}`), life: 5000 });
      }
    },
  });
}

function revokeCell(cell: MatrixCellDto) {
  const target = event.value!;
  confirm.require({
    header: t("admin.control.revokeUnlock"),
    message: t("admin.control.revokeConfirm"),
    icon: "pi pi-lock",
    acceptLabel: t("admin.control.revokeUnlock"),
    rejectLabel: t("common.cancel"),
    accept: async () => {
      try {
        await api.delete(`/admin/events/${target.id}/evaluations/${cell.evaluationId}/unlock`);
      } catch (error) {
        toast.add({ severity: "error", detail: t(`errors.${(error as { code?: string }).code ?? "internal_error"}`), life: 5000 });
      }
    },
  });
}

async function copyText(text: string) {
  try {
    await navigator.clipboard?.writeText(text);
  } catch {
    // 无剪贴板权限时忽略；链接已完整展示
  }
}

function judgeName(judgeId: string): string {
  return event.value?.judges.find((j) => j.id === judgeId)?.name ?? judgeId;
}

function cellTag(cell: MatrixCellDto): { label: string; tone: string } {
  if (cell.unlocked) return { label: t("admin.control.unlockedTag"), tone: "tw:bg-warning/15 tw:text-warning" };
  if (cell.status === "submitted") return { label: t("admin.control.submittedTag"), tone: "tw:bg-success/15 tw:text-success" };
  if (cell.status === "draft") return { label: t("admin.control.draftTag"), tone: "tw:bg-info/15 tw:text-info" };
  return { label: t("admin.control.none"), tone: "tw:bg-surface-muted tw:text-faint" };
}

onMounted(refresh);
onUnmounted(() => {
  if (refreshTimer) clearTimeout(refreshTimer);
});
void stale;
</script>

<template>
  <div v-if="event && snapshot" class="tw:mt-6 tw:grid tw:gap-6 lg:tw:grid-cols-[1fr_360px]">
    <section class="tw:space-y-6">
      <div class="tw:rounded-2xl tw:border tw:border-line tw:bg-surface tw:p-6">
        <h2 class="tw:text-base tw:font-semibold">{{ t("admin.control.currentProject") }}</h2>
        <div v-if="activeProject" class="tw:mt-4">
          <div class="tw:text-xs tw:text-faint"># {{ activeIndex + 1 }} / {{ event.projects.length }}</div>
          <div class="tw:mt-1 tw:text-2xl tw:font-semibold">{{ activeProject.name }}</div>
          <div v-if="activeProject.teamName" class="tw:text-sm tw:text-muted">{{ activeProject.teamName }}</div>
          <div class="tw:mt-3 tw:max-w-sm">
            <div class="tw:mb-1 tw:text-sm tw:text-muted">
              {{ t("admin.control.submitted", { submitted: activeSubmitted, total: event.judges.length }) }}
            </div>
            <ProgressBar :value="(activeSubmitted / Math.max(event.judges.length, 1)) * 100" :show-value="false" class="tw:h-2" />
          </div>
        </div>
        <div v-else class="tw:mt-4 tw:text-sm tw:text-muted">{{ t("admin.control.noActive") }}</div>
        <div class="tw:mt-4 tw:flex tw-items-center tw-gap-2">
          <Button
            icon="pi pi-chevron-left"
            :label="t('admin.control.prev')"
            severity="secondary"
            outlined
            size="small"
            :disabled="event.status !== 'judging' || activeIndex <= 0"
            @click="setProject(activeIndex - 1)"
          />
          <Button
            icon="pi pi-chevron-right"
            :label="t('admin.control.next')"
            size="small"
            :disabled="event.status !== 'judging' || activeIndex >= event.projects.length - 1"
            @click="setProject(activeIndex + 1)"
          />
        </div>
      </div>

      <div class="tw:rounded-2xl tw:border tw:border-line tw:bg-surface tw:p-6">
        <h2 class="tw:text-base tw:font-semibold">{{ t("admin.control.matrix") }}</h2>
        <p class="tw:mt-1 tw:text-sm tw:text-muted">{{ t("admin.control.matrixHint") }}</p>
        <div class="tw:mt-4 tw:overflow-x-auto">
          <table class="tw:w-full tw:text-sm">
            <thead>
              <tr class="tw:border-b tw:border-line tw:text-left tw:text-xs tw:text-faint">
                <th class="tw:py-2 tw:pr-2">#</th>
                <th class="tw:py-2 tw:pr-2">项目</th>
                <th v-for="judge in event.judges" :key="judge.id" class="tw:py-2 tw:px-1">{{ judge.name }}</th>
              </tr>
            </thead>
            <tbody>
              <template v-for="(row, index) in snapshot.matrix" :key="row.projectId">
                <tr
                  class="tw:cursor-pointer tw:border-b tw:border-line hover:tw-bg-canvas"
                  @click="expandedProject = expandedProject === row.projectId ? null : row.projectId"
                >
                  <td class="tw:py-2 tw:pr-2 tw:text-faint">{{ index + 1 }}</td>
                  <td class="tw:py-2 tw:pr-2 tw:font-medium">
                    <i
                      class="pi"
                      :class="expandedProject === row.projectId ? 'pi-chevron-down' : 'pi-chevron-right'"
                      style="font-size: 0.7rem"
                    />
                    {{ event.projects.find((p) => p.id === row.projectId)?.name }}
                  </td>
                  <td v-for="cell in row.cells" :key="cell.judgeId" class="tw:px-1">
                    <span class="tw:rounded-full tw:px-2 tw:py-0.5 tw:text-xs" :class="cellTag(cell).tone">
                      {{ cellTag(cell).label }}
                    </span>
                  </td>
                </tr>
                <tr v-if="expandedProject === row.projectId" class="tw:border-b tw:border-line tw:bg-canvas">
                  <td />
                  <td colspan="100" class="tw:py-3">
                    <div class="tw:space-y-2">
                      <div v-for="cell in row.cells" :key="cell.judgeId" class="tw:flex tw:items-center tw:gap-2 tw:text-sm">
                        <span class="tw:w-20 tw:font-medium">{{ judgeName(cell.judgeId) }}</span>
                        <span class="tw:text-faint">{{ cellTag(cell).label }}</span>
                        <span v-if="cell.submittedTotalText" class="tw:font-semibold">{{ cell.submittedTotalText }}</span>
                        <span v-if="cell.version > 0" class="tw:text-xs tw:text-faint">v{{ cell.version }}</span>
                        <div class="tw:ml-auto tw:flex tw:gap-1">
                          <template v-if="cell.unlocked">
                            <Button :label="t('admin.control.revokeUnlock')" size="small" severity="secondary" text @click.stop="revokeCell(cell)" />
                          </template>
                          <template v-else-if="cell.status === 'submitted' && event.revealedAt && event.status === 'judging'">
                            <Button :label="t('admin.control.unlock')" size="small" severity="warning" text @click.stop="unlockCell(cell)" />
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
            size="small"
            @click="switchMode('progress')"
          />
          <Button
            :label="t('admin.control.modeRanking')"
            :severity="event.displayMode === 'ranking' ? 'primary' : 'secondary'"
            :outlined="event.displayMode !== 'ranking'"
            size="small"
            @click="switchMode('ranking')"
          />
        </div>
        <p v-if="event.revealedAt" class="tw:mt-3 tw:text-xs tw:text-warning">{{ t("admin.control.revealedNotice") }}</p>
        <div class="tw:mt-4 tw:flex tw:gap-2">
          <Button :label="t('admin.control.openDisplay')" icon="pi pi-external-link" size="small" severity="secondary" outlined @click="openDisplay" />
          <Button :label="t('admin.control.fullscreen')" icon="pi pi-window-maximize" size="small" severity="secondary" text @click="fullscreen" />
        </div>
        <p v-if="event.status === 'closed'" class="tw:mt-3 tw:text-xs tw:text-muted">{{ t("admin.control.closedNotice") }}</p>
      </div>

      <div v-if="stream.stale.value" class="tw:rounded-xl tw:bg-warning/10 tw:px-4 tw:py-3 tw:text-sm tw:text-warning">
        {{ t("common.offline") }}
      </div>
    </aside>

    <Dialog
      :visible="displayInvite !== null"
      modal
      header="大屏链接"
      class="tw:min-w-80"
      closable
      @update:visible="(value) => { if (!value) displayInvite = null; }"
    >
      <div v-if="displayInvite" class="tw:flex tw:flex-col tw:items-center tw:gap-3">
        <img v-if="displayInvite.qrDataUrl" :src="displayInvite.qrDataUrl" alt="QR" class="tw:h-72 tw:w-72" />
        <code class="tw:max-w-full tw:break-all tw:rounded tw-bg-canvas tw:p-2 tw:text-xs">{{ displayInvite.inviteUrl }}</code>
        <Button
          :label="t('common.copy')"
          size="small"
          severity="secondary"
          outlined
          @click="copyText(displayInvite!.inviteUrl)"
        />
        <p class="tw:text-xs tw:text-faint">首次生成或重置都会使旧链接立即失效。</p>
      </div>
    </Dialog>
  </div>
</template>
