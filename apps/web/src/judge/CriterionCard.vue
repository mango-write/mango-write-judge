<script setup lang="ts">
// 单个评分项卡片：快捷分值点选 + 微调步进 + Slider + 数字输入多通道（0–10、步进 0.1、十分位整数存储）。
import { computed } from "vue";
import { useI18n } from "vue-i18n";

import { InputNumber, Slider } from "@mango-write/ui";

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

const QUICK_SCORES = [6, 7, 8, 8.5, 9, 9.5, 10] as const;

const display = computed(() => (props.modelValue === undefined ? null : props.modelValue / 10));

function commit(value: number | number[] | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return;
  const tenths = Math.round(Number(value) * 10);
  if (tenths >= 0 && tenths <= 100 && tenths !== props.modelValue) emit("update", tenths);
}

function stepBy(deltaTenths: number) {
  if (props.disabled) return;
  const base = props.modelValue ?? 80;
  const next = Math.max(0, Math.min(100, base + deltaTenths));
  emit("update", next);
}

defineExpose({ commit });
</script>

<template>
  <article
    class="tw:rounded-2xl tw:border tw:bg-surface tw:p-4 tw:shadow-xs transition"
    :class="highlight ? 'tw:border-danger' : 'tw:border-line'"
  >
    <div class="tw:flex tw:flex-wrap tw:items-center tw:gap-2">
      <span class="tw:text-base tw:font-semibold tw:text-default">{{ name }}</span>
      <span class="tw:rounded-full tw:bg-primary-50 tw:px-2.5 tw:py-0.5 tw:text-xs tw:font-semibold tw:text-primary-700">
        {{ t("judge.score.weight", { weight: weightPercent }) }}
      </span>
      <div class="tw:ml-auto tw:flex tw:items-center tw:gap-1.5">
        <InputNumber
          :model-value="display"
          mode="decimal"
          :min="0"
          :max="10"
          :step="0.1"
          :min-fraction-digits="1"
          :max-fraction-digits="1"
          :disabled="disabled"
          input-class="tw:w-20 tw:text-right tw:font-mono tw:font-bold"
          :aria-label="name"
          @update:model-value="commit"
        />
        <span class="tw:text-sm tw:text-faint">/ 10</span>
      </div>
    </div>

    <p v-if="description" class="tw:mt-1.5 tw:text-sm tw:text-muted">{{ description }}</p>

    <!-- 手机端一键快捷给分档位 -->
    <div v-if="!disabled" class="tw:mt-3 tw:flex tw:flex-wrap tw:items-center tw:gap-1.5">
      <button
        v-for="preset in QUICK_SCORES"
        :key="preset"
        type="button"
        class="tw:min-w-10 tw:cursor-pointer tw:rounded-lg tw:border tw:px-2.5 tw:py-1.5 tw:font-mono tw:text-xs tw:font-semibold transition"
        :class="
          modelValue === Math.round(preset * 10)
            ? 'tw:border-primary-500 tw:bg-primary-500 tw:text-on-brand'
            : 'tw:border-line tw:bg-canvas tw:text-default tw:active:bg-primary-50'
        "
        @click="commit(preset)"
      >
        {{ preset }}
      </button>
    </div>

    <Slider
      :model-value="display ?? 0"
      :min="0"
      :max="10"
      :step="0.1"
      :disabled="disabled"
      class="tw:mt-4"
      :aria-label="name"
      @update:model-value="commit"
    />

    <div class="tw:mt-2 tw:flex tw:items-center tw:justify-between tw:text-xs tw:text-faint">
      <span>0</span>
      <div v-if="!disabled" class="tw:flex tw:items-center tw:gap-1.5">
        <button
          type="button"
          class="tw:cursor-pointer tw:rounded tw:border tw:border-line tw:bg-canvas tw:px-2 tw:py-0.5 tw:font-mono tw:text-xs tw:text-muted tw:active:bg-surface-muted"
          @click="stepBy(-5)"
        >
          -0.5
        </button>
        <button
          type="button"
          class="tw:cursor-pointer tw:rounded tw:border tw:border-line tw:bg-canvas tw:px-2 tw:py-0.5 tw:font-mono tw:text-xs tw:text-muted tw:active:bg-surface-muted"
          @click="stepBy(-1)"
        >
          -0.1
        </button>
        <span class="tw:min-w-10 tw:text-center tw:font-mono tw:text-sm tw:font-bold tw:text-default">
          {{ modelValue === undefined ? "—" : tenthsToText(modelValue) }}
        </span>
        <button
          type="button"
          class="tw:cursor-pointer tw:rounded tw:border tw:border-line tw:bg-canvas tw:px-2 tw:py-0.5 tw:font-mono tw:text-xs tw:text-muted tw:active:bg-surface-muted"
          @click="stepBy(1)"
        >
          +0.1
        </button>
        <button
          type="button"
          class="tw:cursor-pointer tw:rounded tw:border tw:border-line tw:bg-canvas tw:px-2 tw:py-0.5 tw:font-mono tw:text-xs tw:text-muted tw:active:bg-surface-muted"
          @click="stepBy(5)"
        >
          +0.5
        </button>
      </div>
      <span v-else class="tw:font-mono tw:font-semibold">
        {{ modelValue === undefined ? "—" : tenthsToText(modelValue) }}
      </span>
      <span>10</span>
    </div>
  </article>
</template>
