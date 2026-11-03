<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute } from "vue-router";

import Button from "primevue/button";

import type { EventDetailDto } from "@mango-write-judge/contracts";
import { api } from "../lib/api";
import { useRevisionStream } from "../lib/sse";
import StatusTag from "../shared/StatusTag.vue";

const props = defineProps<{ id: string }>();
const { t } = useI18n();
const route = useRoute();

const event = ref<EventDetailDto | null>(null);

const tabs = computed(() => {
  const base = `/admin/events/${props.id}`;
  return [
    { label: t("admin.settings.tabs.basic"), to: `${base}/settings` },
    { label: t("admin.check.title"), to: `${base}/check` },
    { label: t("admin.control.title"), to: `${base}/control` },
    { label: t("admin.results.title"), to: `${base}/results` },
  ];
});

async function load() {
  event.value = await api.get<EventDetailDto>(`/admin/events/${props.id}`);
}

// 头部状态（启动/闭幕）随业务事件刷新
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
useRevisionStream(`/admin/events/${props.id}/stream`, () => {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    load().catch(() => undefined);
  }, 300);
});

onMounted(load);
</script>

<template>
  <div v-if="event">
    <div class="tw:flex tw:flex-wrap tw:items-center tw:gap-3">
      <h1 class="tw:text-xl tw:font-semibold">{{ event.name }}</h1>
      <StatusTag :status="event.status" />
    </div>
    <nav class="tw:mt-4 tw:flex tw:gap-1 tw:border-b tw:border-line">
      <Button
        v-for="tab in tabs"
        :key="tab.to"
        :label="tab.label"
        severity="secondary"
        text
        size="small"
        :class="{ 'admin-tab-active': route.path === tab.to }"
        @click="$router.push(tab.to)"
      />
    </nav>
    <router-view :id="id" />
  </div>
  <div v-else class="tw:py-16 tw:text-center tw:text-muted">{{ t("common.loading") }}</div>
</template>

<style scoped>
.admin-tab-active {
  border-bottom: 2px solid var(--color-brand-500);
  border-radius: 0;
}
</style>
