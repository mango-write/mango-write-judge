<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import { useToast } from "primevue/usetoast";

import Button from "primevue/button";
import Dialog from "primevue/dialog";
import InputText from "primevue/inputtext";
import Textarea from "primevue/textarea";

import type { EventDetailDto, ProjectDto } from "@mango-write-judge/contracts";
import { api } from "../../lib/api";

const props = defineProps<{ event: EventDetailDto; disabled: boolean }>();
const emit = defineEmits<{ changed: [] }>();
const { t } = useI18n();
const toast = useToast();

const creating = ref(false);
const form = ref({ name: "", teamName: "", summary: "" });
const editingId = ref<string | null>(null);
const editing = ref({ name: "", teamName: "", summary: "" });
const showPaste = ref(false);
const pasteText = ref("");
const busy = ref(false);
const importFile = ref<File | null>(null);

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
    await withRevisionRetry((revision) =>
      api.post(`/admin/events/${props.event.id}/projects`, {
        name: form.value.name.trim(),
        teamName: form.value.teamName.trim(),
        summary: form.value.summary.trim(),
        expectedRevision: revision,
      }),
    );
    form.value = { name: "", teamName: "", summary: "" };
    creating.value = false;
    emit("changed");
  } catch (error) {
    toast.add({ severity: "error", detail: errorDetail(error), life: 5000 });
  } finally {
    busy.value = false;
  }
}

function startEdit(project: ProjectDto) {
  editingId.value = project.id;
  editing.value = {
    name: project.name,
    teamName: project.teamName,
    summary: project.summary,
  };
}

async function saveEdit() {
  if (busy.value || !editingId.value || !editing.value.name.trim()) return;
  busy.value = true;
  try {
    await withRevisionRetry((revision) =>
      api.patch(`/admin/events/${props.event.id}/projects/${editingId.value}`, {
        name: editing.value.name.trim(),
        teamName: editing.value.teamName.trim(),
        summary: editing.value.summary.trim(),
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

async function remove(id: string) {
  if (busy.value) return;
  busy.value = true;
  try {
    await withRevisionRetry((revision) =>
      api.delete(`/admin/events/${props.event.id}/projects/${id}?expectedRevision=${revision}`),
    );
    emit("changed");
  } catch (error) {
    toast.add({ severity: "error", detail: errorDetail(error), life: 5000 });
  } finally {
    busy.value = false;
  }
}

async function move(index: number, offset: -1 | 1) {
  const ids = props.event.projects.map((p) => p.id);
  const target = index + offset;
  if (target < 0 || target >= ids.length) return;
  [ids[index], ids[target]] = [ids[target]!, ids[index]!];
  try {
    await withRevisionRetry((revision) =>
      api.post(`/admin/events/${props.event.id}/projects/reorder`, { ids, expectedRevision: revision }),
    );
    emit("changed");
  } catch (error) {
    toast.add({ severity: "error", detail: errorDetail(error), life: 5000 });
  }
}

async function doImport() {
  if (!importFile.value || busy.value) return;
  busy.value = true;
  try {
    const result = await withRevisionRetry((revision) =>
      api.upload<{ created: number; errors: { row: number; message: string }[] }>(
        `/admin/events/${props.event.id}/projects/import?expectedRevision=${revision}`,
        importFile.value!,
      ),
    );
    importFile.value = null;
    toast.add({
      severity: result.errors.length ? "warn" : "success",
      detail: result.errors.length
        ? `${result.created} 已导入；${result.errors.length} 行失败：${result.errors.map((e) => `#${e.row} ${e.message}`).join("；")}`
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
  const lines = pasteText.value
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0 || busy.value) return;
  const csvRows = [
    "项目名称,团队名称,简介",
    ...lines.map((line) => {
      const parts = line.includes("|")
        ? line.split("|")
        : line.includes("\t")
          ? line.split("\t")
          : line.split(/[,，]/);
      const [n = "", team = "", sum = ""] = parts.map((s) => s.trim());
      const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
      return `${esc(n)},${esc(team)},${esc(sum)}`;
    }),
  ];
  const file = new File([csvRows.join("\n")], "paste-projects.csv", { type: "text/csv" });
  importFile.value = file;
  await doImport();
  showPaste.value = false;
  pasteText.value = "";
}

function downloadTemplate() {
  const sample = "\uFEFF项目名称,团队名称,简介\r\n智能科研写作助手,Mango 团队,从文献精读到论文成稿的全流程 AI 科研伙伴\r\n实时路演评审系统,Judge 团队,多端实时同步的线下路演评分与大屏系统\r\n";
  const blob = new Blob([sample], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "projects-template.csv";
  a.click();
  URL.revokeObjectURL(url);
}

function onFile(event: Event) {
  const input = event.target as HTMLInputElement;
  importFile.value = input.files?.[0] ?? null;
}
</script>

<template>
  <div class="tw:rounded-2xl tw:border tw:border-line tw:bg-surface tw:p-6">
    <div class="tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-3">
      <div>
        <h2 class="tw:text-base tw:font-semibold">{{ t("admin.settings.projectsTitle") }}</h2>
        <p class="tw:mt-0.5 tw:text-xs tw:text-muted">{{ t("admin.settings.projectsHint") }}</p>
      </div>
      <div v-if="!disabled" class="tw:flex tw:flex-wrap tw:items-center tw:gap-2">
        <Button
          :label="t('admin.settings.batchPasteProjects')"
          icon="pi pi-clipboard"
          severity="secondary"
          outlined
          @click="showPaste = true"
        />
        <Button
          :label="t('admin.settings.downloadTemplate')"
          icon="pi pi-download"
          severity="secondary"
          text
          @click="downloadTemplate"
        />
        <label class="tw:cursor-pointer tw:rounded-lg tw:px-3 tw:py-1.5 tw:text-sm tw:font-medium tw:text-primary-700 tw:hover:bg-primary-50 tw:hover:underline">
          {{ t("admin.settings.importCsv") }}
          <input type="file" accept=".csv,text/csv" class="tw:hidden" @change="onFile" />
        </label>
      </div>
    </div>

    <p v-if="importFile" class="tw:mt-3 tw:flex tw:items-center tw:gap-3 tw:rounded-xl tw:bg-canvas tw:px-4 tw:py-2.5 tw:text-sm tw:text-muted">
      <i class="pi pi-file" />
      <span>{{ importFile.name }}</span>
      <Button :label="t('common.confirm')" :loading="busy" @click="doImport" />
      <Button :label="t('common.cancel')" severity="secondary" text @click="importFile = null" />
    </p>

    <div class="tw:mt-4 tw:divide-y tw:divide-line">
      <div
        v-for="(project, index) in event.projects"
        :key="project.id"
        class="tw:flex tw:flex-wrap tw:items-center tw:gap-3 tw:py-3"
      >
        <template v-if="editingId === project.id">
          <InputText v-model="editing.name" class="tw:w-44" :placeholder="t('admin.settings.projectName')" />
          <InputText v-model="editing.teamName" class="tw:w-36" :placeholder="t('admin.settings.teamName')" />
          <InputText v-model="editing.summary" class="tw:min-w-44 tw:flex-1" :placeholder="t('admin.settings.summary')" />
          <Button :label="t('common.save')" :loading="busy" @click="saveEdit" />
          <Button :label="t('common.cancel')" severity="secondary" text @click="editingId = null" />
        </template>
        <template v-else>
          <span class="tw:w-6 tw:text-xs tw:font-medium tw:text-faint">#{{ index + 1 }}</span>
          <div class="tw:min-w-0 tw:flex-1">
            <div class="tw:flex tw:flex-wrap tw:items-center tw:gap-2">
              <span class="tw:font-semibold">{{ project.name }}</span>
              <span
                v-if="project.teamName"
                class="tw:rounded-md tw:bg-surface-muted tw:px-2 tw:py-0.5 tw:text-xs tw:text-muted"
              >
                {{ project.teamName }}
              </span>
            </div>
            <div v-if="project.summary" class="tw:mt-0.5 tw:text-sm tw:text-muted">{{ project.summary }}</div>
          </div>
          <div class="tw:ml-auto tw:flex tw:gap-1">
            <Button
              icon="pi pi-arrow-up"
              severity="secondary"
              text
              :disabled="disabled || index === 0"
              @click="move(index, -1)"
            />
            <Button
              icon="pi pi-arrow-down"
              severity="secondary"
              text
              :disabled="disabled || index === event.projects.length - 1"
              @click="move(index, 1)"
            />
            <Button
              icon="pi pi-pencil"
              severity="secondary"
              text
              :disabled="disabled"
              @click="startEdit(project)"
            />
            <Button
              v-if="event.status === 'draft'"
              icon="pi pi-trash"
              severity="danger"
              text
              :disabled="disabled"
              @click="remove(project.id)"
            />
          </div>
        </template>
      </div>
    </div>

    <div
      v-if="creating"
      class="tw:mt-4 tw:flex tw:flex-wrap tw:items-center tw:gap-3 tw:rounded-xl tw:bg-canvas tw:p-4"
    >
      <InputText v-model="form.name" class="tw:w-44" :placeholder="t('admin.settings.projectName')" autofocus />
      <InputText v-model="form.teamName" class="tw:w-36" :placeholder="t('admin.settings.teamName')" />
      <InputText v-model="form.summary" class="tw:min-w-40 tw:flex-1" :placeholder="t('admin.settings.summary')" />
      <Button :label="t('common.save')" :loading="busy" @click="create" />
      <Button :label="t('common.cancel')" severity="secondary" text @click="creating = false" />
    </div>
    <Button
      v-else
      class="tw:mt-4"
      :label="t('admin.settings.addProject')"
      icon="pi pi-plus"
      severity="secondary"
      outlined
      :disabled="disabled"
      @click="creating = true"
    />

    <Dialog
      v-model:visible="showPaste"
      modal
      :header="t('admin.settings.batchPasteProjects')"
      class="tw:w-full tw:max-w-lg"
    >
      <div class="tw:flex tw:flex-col tw:gap-3">
        <p class="tw:text-sm tw:text-muted">{{ t("admin.settings.batchPasteProjectsHint") }}</p>
        <Textarea
          v-model="pasteText"
          rows="6"
          class="tw:w-full tw:font-mono tw:text-sm"
          placeholder="智能写作助手 | 芒果团队 | AI 驱动的全流程论文工作台&#10;语音科研笔记 | 声学实验室 | 随时随地记录实验灵感"
        />
        <div class="tw:flex tw:justify-end tw:gap-2">
          <Button :label="t('common.cancel')" severity="secondary" text @click="showPaste = false" />
          <Button :label="t('common.confirm')" :loading="busy" @click="doPasteImport" />
        </div>
      </div>
    </Dialog>
  </div>
</template>
