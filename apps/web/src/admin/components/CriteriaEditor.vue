<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useToast } from "primevue/usetoast";

import Button from "primevue/button";
import InputNumber from "primevue/inputnumber";
import InputText from "primevue/inputtext";

import type { EventDetailDto } from "@mango-write-judge/contracts";
import { api } from "../../lib/api";

const props = defineProps<{ event: EventDetailDto; disabled: boolean }>();
const emit = defineEmits<{ changed: [] }>();
const { t } = useI18n();
const toast = useToast();

const editingId = ref<string | null>(null);
const editing = ref({ name: "", description: "", weightPercent: 50 });
const creating = ref(false);
const form = ref({ name: "", description: "", weightPercent: 30 });
const busy = ref(false);

const weightsSum = computed(() => props.event.criteria.reduce((sum, c) => sum + c.weightPercent, 0));
const sumOk = computed(() => weightsSum.value === 100);


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
  if (busy.value) return;
  busy.value = true;
  try {
    await withRevisionRetry((revision) =>
      api.post(`/admin/events/${props.event.id}/criteria`, {
        name: form.value.name.trim(),
        description: form.value.description.trim(),
        weightPercent: form.value.weightPercent,
        expectedRevision: revision,
      }),
    );
    form.value = { name: "", description: "", weightPercent: 30 };
    creating.value = false;
    emit("changed");
  } catch (error) {
    toast.add({ severity: "error", detail: errorDetail(error), life: 5000 });
  } finally {
    busy.value = false;
  }
}

async function saveEdit() {
  if (busy.value || !editingId.value) return;
  busy.value = true;
  try {
    await api.patch(`/admin/events/${props.event.id}/criteria/${editingId.value}`, {
      name: editing.value.name.trim(),
      description: editing.value.description.trim(),
      weightPercent: editing.value.weightPercent,
      expectedRevision: props.event.revision,
    });
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
    await api.delete(`/admin/events/${props.event.id}/criteria/${id}?expectedRevision=${props.event.revision}`);
    emit("changed");
  } catch (error) {
    toast.add({ severity: "error", detail: errorDetail(error), life: 5000 });
  } finally {
    busy.value = false;
  }
}

async function move(index: number, offset: -1 | 1) {
  const ids = props.event.criteria.map((c) => c.id);
  const target = index + offset;
  if (target < 0 || target >= ids.length) return;
  [ids[index], ids[target]] = [ids[target]!, ids[index]!];
  try {
    await api.post(`/admin/events/${props.event.id}/criteria/reorder`, { ids, expectedRevision: props.event.revision });
    emit("changed");
  } catch (error) {
    toast.add({ severity: "error", detail: errorDetail(error), life: 5000 });
  }
}
</script>

<template>
  <div class="tw:rounded-2xl tw:border tw:border-line tw:bg-surface tw:p-6">
    <div class="tw:flex tw:items-center tw:gap-3">
      <h2 class="tw:text-base tw:font-semibold">{{ t("admin.settings.criteriaTitle") }}</h2>
      <span class="tw:ml-auto tw:text-sm" :class="sumOk ? 'tw:text-success' : 'tw:text-danger'">
        {{ sumOk ? t("admin.settings.weightsOk") : t("admin.settings.weightsSum", { sum: weightsSum }) }}
      </span>
    </div>

    <div class="tw:mt-4 tw:divide-y tw:divide-line">
      <div v-for="(criterion, index) in event.criteria" :key="criterion.id" class="tw:flex tw:flex-wrap tw:items-center tw:gap-3 tw:py-3">
        <template v-if="editingId === criterion.id">
          <InputText v-model="editing.name" class="tw:w-48" />
          <InputNumber v-model="editing.weightPercent" :min="1" :max="100" class="tw:w-24" :suffix="'%'" />
          <InputText v-model="editing.description" class="tw:min-w-40 tw:flex-1" :placeholder="t('admin.settings.criterionDescription')" />
          <Button :label="t('common.save')" size="small" :loading="busy" @click="saveEdit" />
          <Button :label="t('common.cancel')" size="small" severity="secondary" text @click="editingId = null" />
        </template>
        <template v-else>
          <span class="tw:w-8 tw:text-xs tw:text-faint">{{ index + 1 }}</span>
          <span class="tw:font-medium">{{ criterion.name }}</span>
          <span class="tw:rounded-full tw:bg-surface-muted tw:px-2 tw:py-0.5 tw:text-xs tw:text-muted">{{ criterion.weightPercent }}%</span>
          <span v-if="criterion.description" class="tw:text-sm tw:text-muted">{{ criterion.description }}</span>
          <div class="tw:ml-auto tw:flex tw:gap-1">
            <Button icon="pi pi-arrow-up" size="small" severity="secondary" text :disabled="disabled || index === 0" @click="move(index, -1)" />
            <Button icon="pi pi-arrow-down" size="small" severity="secondary" text :disabled="disabled || index === event.criteria.length - 1" @click="move(index, 1)" />
            <Button
              icon="pi pi-pencil"
              size="small"
              severity="secondary"
              text
              :disabled="disabled"
              @click="editingId = criterion.id; editing = { name: criterion.name, description: criterion.description, weightPercent: criterion.weightPercent }"
            />
            <Button icon="pi pi-trash" size="small" severity="danger" text :disabled="disabled" @click="remove(criterion.id)" />
          </div>
        </template>
      </div>
    </div>

    <div v-if="creating" class="tw:mt-4 tw:flex tw:flex-wrap tw:items-center tw:gap-3 tw:rounded-xl tw:bg-canvas tw:p-4">
      <InputText v-model="form.name" class="tw:w-48" :placeholder="t('admin.settings.criterionName')" :aria-label="t('admin.settings.criterionName')" />
      <InputNumber v-model="form.weightPercent" :min="1" :max="100" class="tw:w-24" suffix="%" :aria-label="t('admin.settings.criterionWeight')" />
      <InputText v-model="form.description" class="tw:min-w-40 tw:flex-1" :placeholder="t('admin.settings.criterionDescription')" />
      <Button :label="t('common.save')" size="small" :loading="busy" @click="create" />
      <Button :label="t('common.cancel')" size="small" severity="secondary" text @click="creating = false" />
    </div>
    <Button
      v-else
      class="tw:mt-4"
      :label="t('admin.settings.addCriterion')"
      icon="pi pi-plus"
      severity="secondary"
      outlined
      size="small"
      :disabled="disabled"
      @click="creating = true"
    />
    <p v-if="disabled" class="tw:mt-3 tw:text-xs tw:text-faint">{{ t("admin.settings.lockedEditHint") }}</p>
  </div>
</template>
