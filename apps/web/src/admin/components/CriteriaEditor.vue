<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import {
  ArrowDown,
  ArrowUp,
  Pencil,
  Plus,
  SlidersHorizontal,
  Sparkles,
  Trash2,
} from "lucide-vue-next";

import { Button, InputNumber, InputText, useNotify } from "@mango-write/ui";

import type { EventDetailDto } from "@mango-write-judge/contracts";
import { api } from "../../lib/api";

const props = defineProps<{ event: EventDetailDto; disabled: boolean }>();
const emit = defineEmits<{ changed: [] }>();
const { t } = useI18n();
const notify = useNotify();

const editingId = ref<string | null>(null);
const editing = ref({ name: "", description: "", weightPercent: 50 });
const creating = ref(false);
const form = ref({ name: "", description: "", weightPercent: 30 });
const busy = ref(false);

const weightsSum = computed(() => props.event.criteria.reduce((sum, c) => sum + c.weightPercent, 0));
const sumOk = computed(() => weightsSum.value === 100);
const remainingWeight = computed(() => Math.max(1, Math.min(100, 100 - weightsSum.value || 25)));

const ROADSHOW_PRESET = [
  { name: "创新性与技术壁垒", description: "核心技术创新度、差异化与竞争壁垒", weightPercent: 30 },
  { name: "产品完成度与体验", description: "产品功能完整度、交互体验与演示效果", weightPercent: 30 },
  { name: "商业价值与落地", description: "目标市场规模、商业模式清晰度与落地可行性", weightPercent: 20 },
  { name: "路演表达与答辩", description: "逻辑清晰度、时间把控与现场问答表现", weightPercent: 20 },
] as const;

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

function openCreate() {
  form.value = { name: "", description: "", weightPercent: remainingWeight.value };
  creating.value = true;
}

async function create() {
  if (busy.value || !form.value.name.trim()) return;
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
    notify.add({ severity: "error", detail: errorDetail(error), life: 5000 });
  } finally {
    busy.value = false;
  }
}

async function applyPreset() {
  if (busy.value || props.disabled) return;
  busy.value = true;
  try {
    let detail = await api.get<{ revision: number }>(`/admin/events/${props.event.id}`);
    for (const item of ROADSHOW_PRESET) {
      const res = await api.post<{ revision: number }>(`/admin/events/${props.event.id}/criteria`, {
        name: item.name,
        description: item.description,
        weightPercent: item.weightPercent,
        expectedRevision: detail.revision,
      });
      detail = { revision: res.revision };
    }
    emit("changed");
  } catch (error) {
    notify.add({ severity: "error", detail: errorDetail(error), life: 5000 });
  } finally {
    busy.value = false;
  }
}

async function balanceWeights() {
  const items = props.event.criteria;
  if (busy.value || props.disabled || items.length === 0) return;
  busy.value = true;
  try {
    const count = items.length;
    const base = Math.floor(100 / count);
    const remainder = 100 - base * count;
    let detail = await api.get<{ revision: number }>(`/admin/events/${props.event.id}`);
    for (let i = 0; i < count; i++) {
      const targetWeight = i < remainder ? base + 1 : base;
      const res = await api.patch<{ revision: number }>(
        `/admin/events/${props.event.id}/criteria/${items[i]!.id}`,
        {
          weightPercent: targetWeight,
          expectedRevision: detail.revision,
        },
      );
      detail = { revision: res.revision };
    }
    emit("changed");
  } catch (error) {
    notify.add({ severity: "error", detail: errorDetail(error), life: 5000 });
  } finally {
    busy.value = false;
  }
}

async function saveEdit() {
  if (busy.value || !editingId.value) return;
  busy.value = true;
  try {
    await withRevisionRetry((revision) =>
      api.patch(`/admin/events/${props.event.id}/criteria/${editingId.value}`, {
        name: editing.value.name.trim(),
        description: editing.value.description.trim(),
        weightPercent: editing.value.weightPercent,
        expectedRevision: revision,
      }),
    );
    editingId.value = null;
    emit("changed");
  } catch (error) {
    notify.add({ severity: "error", detail: errorDetail(error), life: 5000 });
  } finally {
    busy.value = false;
  }
}

async function remove(id: string) {
  if (busy.value) return;
  busy.value = true;
  try {
    await withRevisionRetry((revision) =>
      api.delete(`/admin/events/${props.event.id}/criteria/${id}?expectedRevision=${revision}`),
    );
    emit("changed");
  } catch (error) {
    notify.add({ severity: "error", detail: errorDetail(error), life: 5000 });
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
    await withRevisionRetry((revision) =>
      api.post(`/admin/events/${props.event.id}/criteria/reorder`, { ids, expectedRevision: revision }),
    );
    emit("changed");
  } catch (error) {
    notify.add({ severity: "error", detail: errorDetail(error), life: 5000 });
  }
}
</script>

<template>
  <div class="tw:rounded-2xl tw:border tw:border-line tw:bg-surface tw:p-6">
    <div class="tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-3">
      <div>
        <h2 class="tw:text-base tw:font-semibold">{{ t("admin.settings.criteriaTitle") }}</h2>
        <p class="tw:mt-0.5 tw:text-xs tw:text-muted">{{ t("admin.settings.criteriaHint") }}</p>
      </div>
      <div class="tw:flex tw:items-center tw:gap-3">
        <Button
          v-if="!disabled && event.criteria.length > 0 && !sumOk"
          :label="t('admin.settings.balanceWeights')"
          :icon="SlidersHorizontal"
          severity="secondary"
          outlined
          :loading="busy"
          @click="balanceWeights"
        />
        <span
          class="tw:rounded-full tw:px-3 tw:py-1 tw:text-xs tw:font-semibold"
          :class="sumOk ? 'tw:bg-success/15 tw:text-success' : 'tw:bg-danger/15 tw:text-danger'"
        >
          {{
            sumOk
              ? t("admin.settings.weightsOk")
              : t("admin.settings.weightsSum", {
                  sum: weightsSum,
                  diff: weightsSum > 100 ? `+${weightsSum - 100}` : `${weightsSum - 100}`,
                })
          }}
        </span>
      </div>
    </div>

    <!-- 权重分布可视化条 -->
    <div
      v-if="event.criteria.length > 0"
      class="tw:mt-4 tw:flex tw:h-2.5 tw:overflow-hidden tw:rounded-full tw:bg-surface-muted"
    >
      <div
        v-for="(c, idx) in event.criteria"
        :key="c.id"
        class="tw:h-full transition-all"
        :style="{
          width: `${Math.min(100, c.weightPercent)}%`,
          backgroundColor: `hsl(${(idx * 55 + 215) % 360} 75% 55%)`,
        }"
        :title="`${c.name}: ${c.weightPercent}%`"
      />
    </div>

    <!-- 空状态一键套用模板 -->
    <div
      v-if="event.criteria.length === 0 && !creating"
      class="tw:mt-4 tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-3 tw:rounded-xl tw:border tw:border-dashed tw:border-line tw:bg-canvas tw:p-4"
    >
      <div class="tw:text-sm tw:text-muted">
        尚未添加评分项，可一键载入标准路演评分维度（创新性 30% · 完成度 30% · 商业价值 20% · 路演表现 20%）或手动添加。
      </div>
      <Button
        v-if="!disabled"
        :label="t('admin.settings.applyRoadshowPreset')"
        :icon="Sparkles"
        severity="secondary"
        outlined
        :loading="busy"
        @click="applyPreset"
      />
    </div>

    <div class="tw:mt-4 tw:divide-y tw:divide-line">
      <div
        v-for="(criterion, index) in event.criteria"
        :key="criterion.id"
        class="tw:flex tw:flex-wrap tw:items-center tw:gap-3 tw:py-3"
      >
        <template v-if="editingId === criterion.id">
          <InputText v-model="editing.name" class="tw:w-48" :placeholder="t('admin.settings.criterionName')" />
          <InputNumber v-model="editing.weightPercent" :min="1" :max="100" class="tw:w-28" :suffix="'%'" />
          <InputText
            v-model="editing.description"
            class="tw:min-w-40 tw:flex-1"
            :placeholder="t('admin.settings.criterionDescription')"
          />
          <Button :label="t('common.save')" :loading="busy" @click="saveEdit" />
          <Button :label="t('common.cancel')" severity="secondary" text @click="editingId = null" />
        </template>
        <template v-else>
          <span class="tw:w-6 tw:text-xs tw:font-medium tw:text-faint">#{{ index + 1 }}</span>
          <span class="tw:font-semibold">{{ criterion.name }}</span>
          <span class="tw:rounded-full tw:bg-primary-50 tw:px-2.5 tw:py-0.5 tw:text-xs tw:font-semibold tw:text-primary-700">
            {{ criterion.weightPercent }}%
          </span>
          <span v-if="criterion.description" class="tw:text-sm tw:text-muted">{{ criterion.description }}</span>
          <div class="tw:ml-auto tw:flex tw:gap-1">
            <Button
              :icon="ArrowUp"
              severity="secondary"
              text
              :disabled="disabled || index === 0"
              @click="move(index, -1)"
            />
            <Button
              :icon="ArrowDown"
              severity="secondary"
              text
              :disabled="disabled || index === event.criteria.length - 1"
              @click="move(index, 1)"
            />
            <Button
              :icon="Pencil"
              severity="secondary"
              text
              :disabled="disabled"
              @click="
                editingId = criterion.id;
                editing = {
                  name: criterion.name,
                  description: criterion.description,
                  weightPercent: criterion.weightPercent,
                };
              "
            />
            <Button :icon="Trash2" severity="danger" text :disabled="disabled" @click="remove(criterion.id)" />
          </div>
        </template>
      </div>
    </div>

    <div
      v-if="creating"
      class="tw:mt-4 tw:flex tw:flex-wrap tw:items-center tw:gap-3 tw:rounded-xl tw:bg-canvas tw:p-4"
    >
      <InputText
        v-model="form.name"
        class="tw:w-48"
        :placeholder="t('admin.settings.criterionName')"
        :aria-label="t('admin.settings.criterionName')"
        autofocus
      />
      <InputNumber
        v-model="form.weightPercent"
        :min="1"
        :max="100"
        class="tw:w-28"
        suffix="%"
        :aria-label="t('admin.settings.criterionWeight')"
      />
      <InputText
        v-model="form.description"
        class="tw:min-w-40 tw:flex-1"
        :placeholder="t('admin.settings.criterionDescription')"
      />
      <Button :label="t('common.save')" :loading="busy" @click="create" />
      <Button :label="t('common.cancel')" severity="secondary" text @click="creating = false" />
    </div>
    <Button
      v-else
      class="tw:mt-4"
      :label="t('admin.settings.addCriterion')"
      :icon="Plus"
      severity="secondary"
      outlined
      :disabled="disabled"
      @click="openCreate"
    />
    <p v-if="disabled" class="tw:mt-3 tw:text-xs tw:text-faint">{{ t("admin.settings.lockedEditHint") }}</p>
  </div>
</template>
