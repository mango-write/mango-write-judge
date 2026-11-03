<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import { useConfirm } from "primevue/useconfirm";
import { useToast } from "primevue/usetoast";

import QRCode from "qrcode";

import Button from "primevue/button";
import Dialog from "primevue/dialog";
import InputText from "primevue/inputtext";

import type { EventDetailDto, JudgeInviteDto } from "@mango-write-judge/contracts";
import { api } from "../../lib/api";

const props = defineProps<{ event: EventDetailDto; disabled: boolean }>();
const emit = defineEmits<{ changed: [] }>();
const { t } = useI18n();
const toast = useToast();
const confirm = useConfirm();

const creating = ref(false);
const form = ref({ name: "" });
const busy = ref(false);
const importFile = ref<File | null>(null);
const qrInvite = ref<(JudgeInviteDto & { qrDataUrl?: string }) | null>(null);
// 本次会话新生成的邀请（含导入与轮换），token 只在生成时返回一次
const sessionInvites = ref<JudgeInviteDto[]>([]);

function rememberInvite(invite: JudgeInviteDto) {
  sessionInvites.value = [...sessionInvites.value.filter((i) => i.id !== invite.id), invite];
}


/** 配置写带一次 revision 冲突重试：父组件刷新有竞态，现场重取最新 revision。 */
async function withRevisionRetry<T>(fn: (revision: number) => Promise<T>): Promise<T> {
  try {
    return await fn(props.event.revision);
  } catch (error) {
    if ((error as { code?: string }).code === "revision_conflict") {
      const detail = await api.get<{ revision: number }>(`/admin/events/${props.event.id}`);
      emit("changed");
      return await fn(detail.revision);
    }
    throw error;
  }
}

function errorDetail(error: unknown): string {
  const code = error instanceof Error ? (error as { code?: string }).code : undefined;
  return t(`errors.${code ?? "internal_error"}`);
}

async function create() {
  if (busy.value || !form.value.name.trim()) return;
  busy.value = true;
  try {
    const invite = await withRevisionRetry((revision) =>
      api.post<JudgeInviteDto>(`/admin/events/${props.event.id}/judges`, {
        name: form.value.name.trim(),
        expectedRevision: revision,
      }),
    );
    form.value = { name: "" };
    creating.value = false;
    rememberInvite(invite);
    await openQr(invite);
    emit("changed");
  } catch (error) {
    toast.add({ severity: "error", detail: errorDetail(error), life: 5000 });
  } finally {
    busy.value = false;
  }
}

async function openQr(invite: JudgeInviteDto) {
  try {
    qrInvite.value = { ...invite, qrDataUrl: await QRCode.toDataURL(invite.inviteUrl, { width: 320, margin: 2 }) };
  } catch {
    qrInvite.value = { ...invite };
  }
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.add({ severity: "success", detail: t("common.copied"), life: 1500 });
  } catch {
    toast.add({ severity: "warn", detail: text, life: 8000 });
  }
}

function confirmAction(header: string, message: string, accept: () => Promise<void>) {
  confirm.require({
    header,
    message,
    icon: "pi pi-exclamation-triangle",
    acceptLabel: t("common.confirm"),
    rejectLabel: t("common.cancel"),
    accept: async () => {
      try {
        await accept();
      } catch (error) {
        toast.add({ severity: "error", detail: errorDetail(error), life: 5000 });
      }
    },
  });
}

function rotateJudge(judgeId: string) {
  confirmAction(t("admin.settings.rotateToken"), t("admin.settings.rotateTokenConfirm"), async () => {
    const invite = await api.post<JudgeInviteDto>(`/admin/events/${props.event.id}/judges/${judgeId}/rotate-token`);
    await openQr(invite);
  });
}

async function remove(judgeId: string) {
  if (busy.value) return;
  busy.value = true;
  try {
    await api.delete(`/admin/events/${props.event.id}/judges/${judgeId}?expectedRevision=${props.event.revision}`);
    emit("changed");
  } catch (error) {
    toast.add({ severity: "error", detail: errorDetail(error), life: 5000 });
  } finally {
    busy.value = false;
  }
}

async function doImport() {
  if (!importFile.value || busy.value) return;
  busy.value = true;
  try {
    const result = await withRevisionRetry((revision) =>
      api.upload<{ created: number; errors: { row: number; message: string }[]; judges: JudgeInviteDto[] }>(
        `/admin/events/${props.event.id}/judges/import?expectedRevision=${revision}`,
        importFile.value!,
      ),
    );
    importFile.value = null;
    for (const invite of result.judges ?? []) rememberInvite(invite);
    toast.add({
      severity: result.errors.length ? "warn" : "success",
      detail: result.errors.length
        ? `${result.created} 已导入；${result.errors.map((e) => `#${e.row} ${e.message}`).join("；")}`
        : `${result.created} 已导入`,
      life: 6000,
    });
    emit("changed");
  } catch (error) {
    toast.add({ severity: "error", detail: errorDetail(error), life: 5000 });
  } finally {
    busy.value = false;
  }
}

function onFile(event: Event) {
  const input = event.target as HTMLInputElement;
  importFile.value = input.files?.[0] ?? null;
}

function downloadInvites() {
  const lines = ["姓名,邀请链接", ...sessionInvites.value.map((j) => `${j.name},${j.inviteUrl}`)];
  const blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${props.event.slug}-judge-links.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast.add({
    severity: "info",
    detail: "只包含本次会话新生成的链接；历史评委的链接需逐个「重置链接」后获取（token 只在生成时返回一次）",
    life: 8000,
  });
}
</script>

<template>
  <div class="tw:rounded-2xl tw:border tw:border-line tw:bg-surface tw:p-6">
    <div class="tw:flex tw:items-center tw:gap-3">
      <h2 class="tw:text-base tw:font-semibold">{{ t("admin.settings.judgesTitle") }}</h2>
      <div class="tw:ml-auto tw:flex tw:gap-2">
        <Button
          :label="t('admin.settings.downloadInvites')"
          size="small"
          severity="secondary"
          text
          :disabled="sessionInvites.length === 0"
          @click="downloadInvites"
        />
        <label v-if="!disabled" class="tw:cursor-pointer tw:text-sm tw:text-primary-700 hover:tw:underline">
          {{ t("admin.settings.importCsv") }}
          <input type="file" accept=".csv,text/csv" class="tw:hidden" @change="onFile" />
        </label>
      </div>
    </div>
    <p v-if="importFile" class="tw:mt-2 tw:text-sm tw:text-muted">
      {{ importFile.name }}
      <Button :label="t('common.confirm')" size="small" :loading="busy" @click="doImport" />
    </p>

    <div class="tw:mt-4 tw:divide-y tw:divide-line">
      <div v-for="judge in event.judges" :key="judge.id" class="tw:flex tw:items-center tw:gap-3 tw:py-3">
        <span class="tw:font-medium">{{ judge.name }}</span>
        <div class="tw:ml-auto tw:flex tw:gap-1">
          <Button
            :label="t('admin.settings.rotateToken')"
            size="small"
            severity="secondary"
            text
            @click="rotateJudge(judge.id)"
          />
          <Button icon="pi pi-trash" size="small" severity="danger" text :disabled="disabled" @click="remove(judge.id)" />
        </div>
      </div>
    </div>

    <div v-if="creating" class="tw:mt-4 tw:flex tw:items-center tw:gap-3 tw:rounded-xl tw:bg-canvas tw:p-4">
      <InputText v-model="form.name" class="tw:w-44" :placeholder="t('admin.settings.judgeName')" />
      <Button :label="t('common.save')" size="small" :loading="busy" @click="create" />
      <Button :label="t('common.cancel')" size="small" severity="secondary" text @click="creating = false" />
    </div>
    <Button
      v-else
      class="tw:mt-4"
      :label="t('admin.settings.addJudge')"
      icon="pi pi-plus"
      severity="secondary"
      outlined
      size="small"
      :disabled="disabled"
      @click="creating = true"
    />

    <Dialog
      :visible="qrInvite !== null"
      modal
      :header="qrInvite?.name ?? ''"
      class="tw:min-w-80"
      closable
      @update:visible="(value) => { if (!value) qrInvite = null; }"
    >
      <div v-if="qrInvite" class="tw:flex tw:flex-col tw:items-center tw:gap-3">
        <img v-if="qrInvite.qrDataUrl" :src="qrInvite.qrDataUrl" alt="QR" class="tw:h-72 tw:w-72" />
        <code class="tw:max-w-full tw:break-all tw:rounded tw-bg-canvas tw:p-2 tw:text-xs">{{ qrInvite.inviteUrl }}</code>
        <div class="tw:flex tw:gap-2">
          <Button :label="t('common.copy')" size="small" severity="secondary" outlined @click="copy(qrInvite.inviteUrl)" />
        </div>
        <p class="tw:text-xs tw:text-faint">token 只在生成/重置时返回一次；关闭后请通过二维码或复制的链接分享。</p>
      </div>
    </Dialog>
  </div>
</template>
