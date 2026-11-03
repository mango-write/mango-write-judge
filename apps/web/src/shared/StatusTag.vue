<script setup lang="ts">
import { useI18n } from "vue-i18n";

defineProps<{ status: "draft" | "judging" | "closed" }>();
const { t } = useI18n();
</script>

<template>
  <span
    class="tw:inline-flex tw:items-center tw:rounded-full tw:px-2 tw:py-0.5 tw:text-xs tw:font-medium"
    :class="{
      'tw:bg-surface-muted tw:text-muted': status === 'draft',
      'tw:bg-primary-100 tw:text-primary-700': status === 'judging',
      'tw:bg-success/15 tw:text-success': status === 'closed',
    }"
  >
    {{ t(`status.${status}`) }}
  </span>
</template>
