<script setup lang="ts">
// 单个评分项卡片：Slider 与数字输入双通道（0–10、步进 0.1、十分位整数存储）。
import { computed } from "vue";
import { useI18n } from "vue-i18n";

import InputNumber from "primevue/inputnumber";
import Slider from "primevue/slider";

import { tenthsToText } from "../lib/format";

const props = defineProps<{
  name: string;
  description?: string;
  weightPercent: number;
  modelValue: number | undefined;
  disabled?: boolean;
  highlight?: boolean;
}>();
const emit = defineEmits<{ update: [tenths: number] }>();
const { t } = useI18n();

const display = computed(() => (props.modelValue === undefined ? null : props.modelValue / 10));

function commit(value: number | number[] | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return;
  const tenths = Math.round(Number(value) * 10);
  if (tenths >= 0 && tenths <= 100 && tenths !== props.modelValue) emit("update", tenths);
}
</script>

<template>
  <article
    class="tw:rounded-2xl tw:border tw-bg-surface tw-p-4"
    :class="highlight ? 'tw:border-danger' : 'tw:border-line'"
  >
    <div class="tw:flex tw:flex-wrap tw:items-center tw:gap-2">
      <span class="tw:font-semibold">{{ name }}</span>
      <span class="tw:rounded-full tw:bg-surface-muted tw:px-2 tw:py-0.5 tw:text-xs tw:text-muted">
        {{ t("judge.score.weight", { weight: weightPercent }) }}
      </span>
      <div class="tw:ml-auto tw:flex tw:items-center tw:gap-2">
        <InputNumber
          :model-value="display"
          mode="decimal"
          :min="0"
          :max="10"
          :step="0.1"
          :min-fraction-digits="1"
          :max-fraction-digits="1"
          :disabled="disabled"
          input-class="tw:w-20 tw:text-right"
          :aria-label="name"
          @update:model-value="commit"
        />
        <span class="tw:text-sm tw:text-faint">/ 10</span>
      </div>
    </div>
    <p v-if="description" class="tw:mt-1 tw:text-sm tw:text-muted">{{ description }}</p>
    <Slider
      :model-value="display ?? 0"
      :min="0"
      :max="10"
      :step="0.1"
      :disabled="disabled"
      class="tw:mt-3"
      :aria-label="name"
      @update:model-value="commit"
    />
    <div class="tw:mt-1 tw:flex tw:justify-between tw:text-xs tw:text-faint">
      <span>0</span>
      <span>{{ modelValue === undefined ? "—" : tenthsToText(modelValue) }}</span>
      <span>10</span>
    </div>
  </article>
</template>
