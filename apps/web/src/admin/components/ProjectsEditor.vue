<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import { useToast } from "primevue/usetoast";

import Button from "primevue/button";
import InputText from "primevue/inputtext";

import type { EventDetailDto } from "@mango-write-judge/contracts";
import { api } from "../../lib/api";

const props = defineProps<{ event: EventDetailDto; disabled: boolean }>();
const emit = defineEmits<{ changed: [] }>();
const { t } = useI18n();
const toast = useToast();

const creating = ref(false);
const form = ref({ name: "", teamName: "", summary: "" });
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

async function remove(id: string) {
  if (busy.value) return;
  busy.value = true;
  try {
    await api.delete(`/admin/events/${props.event.id}/projects/${id}?expectedRevision=${props.event.revision}`);
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
    await api.post(`/admin/events/${props.event.id}/projects/reorder`, { ids, expectedRevision: props.event.revision });
    emit("changed");
  } catch (error) {
    toast.add({ severity: "error", detail: errorDetail(error), life: 5000 });
  }
}

async function doImport() {
  if (!importFile.value || busy.value) return;
  busy.value = true;
  try {
    const result = await api.upload<{ created: number; errors: { row: number; message: string }[] }>(
      `/admin/events/${props.event.id}/projects/import?expectedRevision=${props.event.revision}`,
      importFile.value,
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

function onFile(event: Event) {
  const input = event.target as HTMLInputElement;
  importFile.value = input.files?.[0] ?? null;
}
</script>

<template>
  <div class="tw:rounded-2xl tw:border tw:border-line tw:bg-surface tw:p-6">
    <div class="tw:flex tw:items-center tw:gap-3">
      <h2 class="tw:text-base tw:font-semibold">{{ t("admin.settings.projectsTitle") }}</h2>
      <label v-if="!disabled" class="tw:ml-auto tw:cursor-pointer tw:text-sm tw-text-primary-700 hover:tw:underline">
        {{ t("admin.settings.importCsv") }}
        <input type="file" accept=".csv,text/csv" class="tw:hidden" @change="onFile" />
      </label>
    </div>
    <p v-if="importFile" class="tw:mt-2 tw-text-sm tw:text-muted">
      {{ importFile.name }}
      <Button :label="t('common.confirm')" size="small" :loading="busy" @click="doImport" />
    </p>

    <div class="tw:mt-4 tw:divide-y tw:divide-line">
      <div v-for="(project, index) in event.projects" :key="project.id" class="tw:flex tw:items-center tw:gap-3 tw:py-3">
        <span class="tw:w-8 tw:text-xs tw:text-faint">{{ index + 1 }}</span>
        <div class="tw:min-w-0">
          <div class="tw:font-medium">{{ project.name }}</div>
          <div v-if="project.teamName" class="tw:text-sm tw:text-muted">{{ project.teamName }}</div>
        </div>
        <span v-if="project.summary" class="tw:truncate tw:text-sm tw:text-faint">{{ project.summary }}</span>
        <div class="tw:ml-auto tw:flex tw:gap-1">
          <Button icon="pi pi-arrow-up" size="small" severity="secondary" text :disabled="disabled || index === 0" @click="move(index, -1)" />
          <Button icon="pi pi-arrow-down" size="small" severity="secondary" text :disabled="disabled || index === event.projects.length - 1" @click="move(index, 1)" />
          <Button icon="pi pi-trash" size="small" severity="danger" text :disabled="disabled" @click="remove(project.id)" />
        </div>
      </div>
    </div>

    <div v-if="creating" class="tw:mt-4 tw:flex tw:flex-wrap tw:items-center tw:gap-3 tw:rounded-xl tw:bg-canvas tw:p-4">
      <InputText v-model="form.name" class="tw:w-44" :placeholder="t('admin.settings.projectName')" />
      <InputText v-model="form.teamName" class="tw:w-36" :placeholder="t('admin.settings.teamName')" />
      <InputText v-model="form.summary" class="tw:min-w-40 tw:flex-1" :placeholder="t('admin.settings.summary')" />
      <Button :label="t('common.save')" size="small" :loading="busy" @click="create" />
      <Button :label="t('common.cancel')" size="small" severity="secondary" text @click="creating = false" />
    </div>
    <Button
      v-else
      class="tw:mt-4"
      :label="t('admin.settings.addProject')"
      icon="pi pi-plus"
      severity="secondary"
      outlined
      size="small"
      :disabled="disabled"
      @click="creating = true"
    />
  </div>
</template>
