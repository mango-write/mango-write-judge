<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useConfirm } from "primevue/useconfirm";
import { useToast } from "primevue/usetoast";

import QRCode from "qrcode";

import Button from "primevue/button";
import Dialog from "primevue/dialog";
import InputText from "primevue/inputtext";
import Textarea from "primevue/textarea";

import type { EventDetailDto, JudgeDto, JudgeInviteDto } from "@mango-write-judge/contracts";
import { api } from "../../lib/api";

const props = defineProps<{ event: EventDetailDto; disabled: boolean; canDelete?: boolean }>();
const emit = defineEmits<{ changed: [] }>();
const { t } = useI18n();
const toast = useToast();
const confirm = useConfirm();

const creating = ref(false);
const form = ref({ name: "" });
const editingId = ref<string | null>(null);
const editingName = ref("");
const showPaste = ref(false);
const pasteText = ref("");
const busy = ref(false);
const importFile = ref<File | null>(null);
const qrInvite = ref<(JudgeInviteDto & { qrDataUrl?: string }) | null>(null);
const showQrWall = ref(false);
const qrWallItems = ref<{ id: string; name: string; inviteUrl: string; qrDataUrl: string }[]>([]);
const sessionInvites = ref<JudgeInviteDto[]>([]);

function rememberInvite(invite: JudgeInviteDto) {
  sessionInvites.value = [...sessionInvites.value.filter((i) => i.id !== invite.id), invite];
}

const allInvites = computed<JudgeInviteDto[]>(() => {
  const byId = new Map(sessionInvites.value.map((i) => [i.id, i]));
  return props.event.judges.map((j) => ({
    id: j.id,
    name: j.name,
    inviteUrl: j.inviteUrl || byId.get(j.id)?.inviteUrl || "",
  }));
});

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

function startEdit(judge: JudgeDto) {
  editingId.value = judge.id;
  editingName.value = judge.name;
}

async function saveEdit() {
  if (busy.value || !editingId.value || !editingName.value.trim()) return;
  busy.value = true;
  try {
    await withRevisionRetry((revision) =>
      api.patch(`/admin/events/${props.event.id}/judges/${editingId.value}`, {
        name: editingName.value.trim(),
        expectedRevision: revision,
      }),
    );
    editingId.value = null;
    emit("changed");
  } catch (error) {
    toast.add({ severity: "error", detail: errorDetail(error), life: 5000 });
  } finally {
    busy.value = false;
  }
}

async function openQr(invite: JudgeInviteDto) {
  try {
    qrInvite.value = {
      ...invite,
      qrDataUrl: invite.inviteUrl ? await QRCode.toDataURL(invite.inviteUrl, { width: 320, margin: 2 }) : undefined,
    };
  } catch {
    qrInvite.value = { ...invite };
  }
}

async function openQrWall() {
  const items: { id: string; name: string; inviteUrl: string; qrDataUrl: string }[] = [];
  for (const inv of allInvites.value) {
    if (!inv.inviteUrl) continue;
    const qrDataUrl = await QRCode.toDataURL(inv.inviteUrl, { width: 240, margin: 2 }).catch(() => "");
    items.push({ id: inv.id, name: inv.name, inviteUrl: inv.inviteUrl, qrDataUrl });
  }
  qrWallItems.value = items;
  showQrWall.value = true;
}

async function copy(text: string) {
  if (!text) return;
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
    rememberInvite(invite);
    await openQr(invite);
    emit("changed");
  });
}

async function remove(judgeId: string) {
  if (busy.value) return;
  busy.value = true;
  try {
    await withRevisionRetry((revision) =>
      api.delete(`/admin/events/${props.event.id}/judges/${judgeId}?expectedRevision=${revision}`),
    );
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

async function doPasteImport() {
  const names = pasteText.value
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (names.length === 0 || busy.value) return;
  const csvRows = ["姓名", ...names.map((n) => `"${n.replace(/"/g, '""')}"`)];
  importFile.value = new File([csvRows.join("\n")], "paste-judges.csv", { type: "text/csv" });
  await doImport();
  showPaste.value = false;
  pasteText.value = "";
}

function onFile(event: Event) {
  const input = event.target as HTMLInputElement;
  importFile.value = input.files?.[0] ?? null;
}

function downloadInvites() {
  const rows = allInvites.value.filter((j) => j.inviteUrl);
  const lines = ["姓名,邀请链接", ...rows.map((j) => `${j.name},${j.inviteUrl}`)];
  const blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${props.event.slug}-judge-links.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
</script>

<template>
  <div class="tw:rounded-2xl tw:border tw:border-line tw:bg-surface tw:p-6">
    <div class="tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-3">
      <div>
        <h2 class="tw:text-base tw:font-semibold">{{ t("admin.settings.judgesTitle") }}</h2>
        <p class="tw:mt-0.5 tw:text-xs tw:text-muted">{{ t("admin.settings.judgesHint") }}</p>
      </div>
      <div class="tw:flex tw:flex-wrap tw:items-center tw:gap-2">
        <Button
          v-if="allInvites.length > 0"
          :label="t('admin.settings.showAllQr')"
          icon="pi pi-qrcode"
          severity="secondary"
          outlined
          @click="openQrWall"
        />
        <Button
          :label="t('admin.settings.downloadInvites')"
          icon="pi pi-download"
          severity="secondary"
          outlined
          :disabled="allInvites.length === 0"
          @click="downloadInvites"
        />
        <Button
          v-if="!disabled"
          :label="t('admin.settings.batchPasteJudges')"
          icon="pi pi-clipboard"
          severity="secondary"
          outlined
          @click="showPaste = true"
        />
        <label
          v-if="!disabled"
          class="tw:cursor-pointer tw:rounded-lg tw:px-3 tw:py-1.5 tw:text-sm tw:font-medium tw:text-primary-700 tw:hover:bg-primary-50 tw:hover:underline"
        >
          {{ t("admin.settings.importCsv") }}
          <input type="file" accept=".csv,text/csv" class="tw:hidden" @change="onFile" />
        </label>
      </div>
    </div>

    <p
      v-if="importFile"
      class="tw:mt-3 tw:flex tw:items-center tw:gap-3 tw:rounded-xl tw:bg-canvas tw:px-4 tw:py-2.5 tw:text-sm tw:text-muted"
    >
      <i class="pi pi-file" />
      <span>{{ importFile.name }}</span>
      <Button :label="t('common.confirm')" :loading="busy" @click="doImport" />
      <Button :label="t('common.cancel')" severity="secondary" text @click="importFile = null" />
    </p>

    <div class="tw:mt-4 tw:divide-y tw:divide-line">
      <div
        v-for="(judge, index) in allInvites"
        :key="judge.id"
        class="tw:flex tw:flex-wrap tw:items-center tw:gap-3 tw:py-3"
      >
        <template v-if="editingId === judge.id">
          <InputText v-model="editingName" class="tw:w-48" :placeholder="t('admin.settings.judgeName')" />
          <Button :label="t('common.save')" :loading="busy" @click="saveEdit" />
          <Button :label="t('common.cancel')" severity="secondary" text @click="editingId = null" />
        </template>
        <template v-else>
          <span class="tw:w-6 tw:text-xs tw:font-medium tw:text-faint">#{{ index + 1 }}</span>
          <span class="tw:font-semibold">{{ judge.name }}</span>
          <div class="tw:ml-auto tw:flex tw:flex-wrap tw:items-center tw:gap-1.5">
            <Button
              v-if="judge.inviteUrl"
              :label="t('admin.settings.showQr')"
              icon="pi pi-qrcode"
              severity="secondary"
              outlined
              @click="openQr(judge)"
            />
            <Button
              v-if="judge.inviteUrl"
              :label="t('common.copy')"
              icon="pi pi-copy"
              severity="secondary"
              text
              @click="copy(judge.inviteUrl)"
            />
            <Button
              :label="t('admin.settings.rotateToken')"
              icon="pi pi-refresh"
              severity="secondary"
              text
              :disabled="disabled"
              @click="rotateJudge(judge.id)"
            />
            <Button
              icon="pi pi-pencil"
              severity="secondary"
              text
              :disabled="disabled"
              @click="startEdit(event.judges[index]!)"
            />
            <Button
              v-if="canDelete !== false && event.status === 'draft'"
              icon="pi pi-trash"
              severity="danger"
              text
              :disabled="disabled"
              @click="remove(judge.id)"
            />
          </div>
        </template>
      </div>
    </div>

    <div v-if="creating" class="tw:mt-4 tw:flex tw:items-center tw:gap-3 tw:rounded-xl tw:bg-canvas tw:p-4">
      <InputText v-model="form.name" class="tw:w-48" :placeholder="t('admin.settings.judgeName')" autofocus />
      <Button :label="t('common.save')" :loading="busy" @click="create" />
      <Button :label="t('common.cancel')" severity="secondary" text @click="creating = false" />
    </div>
    <Button
      v-else
      class="tw:mt-4"
      :label="t('admin.settings.addJudge')"
      icon="pi pi-plus"
      severity="secondary"
      outlined
      :disabled="disabled"
      @click="creating = true"
    />

    <!-- 单个评委二维码弹窗 -->
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
        <code class="tw:max-w-full tw:break-all tw:rounded tw:bg-canvas tw:p-2 tw:text-xs">{{ qrInvite.inviteUrl }}</code>
        <div class="tw:flex tw:gap-2">
          <Button :label="t('common.copy')" icon="pi pi-copy" severity="secondary" outlined @click="copy(qrInvite.inviteUrl)" />
        </div>
        <p class="tw:text-xs tw:text-faint">评委手机扫码或打开链接即可直接进入评分页，无需输入账号密码。</p>
      </div>
    </Dialog>

    <!-- 评委二维码墙弹窗 -->
    <Dialog
      v-model:visible="showQrWall"
      modal
      :header="`${event.name} · ${t('admin.settings.showAllQr')}`"
      class="tw:w-full tw:max-w-4xl"
    >
      <div class="tw:grid tw:gap-4 tw:sm:grid-cols-2 tw:md:grid-cols-3">
        <div
          v-for="item in qrWallItems"
          :key="item.id"
          class="tw:flex tw:flex-col tw:items-center tw:rounded-2xl tw:border tw:border-line tw:bg-surface tw:p-4 tw:text-center"
        >
          <div class="tw:text-base tw:font-bold">{{ item.name }}</div>
          <img v-if="item.qrDataUrl" :src="item.qrDataUrl" :alt="item.name" class="tw:my-2 tw:h-44 tw:w-44" />
          <Button :label="t('common.copy')" icon="pi pi-copy" severity="secondary" text @click="copy(item.inviteUrl)" />
        </div>
      </div>
    </Dialog>

    <!-- 批量粘贴评委弹窗 -->
    <Dialog
      v-model:visible="showPaste"
      modal
      :header="t('admin.settings.batchPasteJudges')"
      class="tw:w-full tw:max-w-md"
    >
      <div class="tw:flex tw:flex-col tw:gap-3">
        <p class="tw:text-sm tw:text-muted">{{ t("admin.settings.batchPasteJudgesHint") }}</p>
        <Textarea
          v-model="pasteText"
          rows="6"
          class="tw:w-full"
          placeholder="张评委&#10;李评委&#10;王评委"
        />
        <div class="tw:flex tw:justify-end tw:gap-2">
          <Button :label="t('common.cancel')" severity="secondary" text @click="showPaste = false" />
          <Button :label="t('common.confirm')" :loading="busy" @click="doPasteImport" />
        </div>
      </div>
    </Dialog>
  </div>
</template>
