<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import { useConfirm } from "primevue/useconfirm";
import { useToast } from "primevue/usetoast";

import Button from "primevue/button";

import type { EventDetailDto } from "@mango-write-judge/contracts";
import { api } from "../lib/api";
import { useRevisionStream } from "../lib/sse";
import StatusTag from "../shared/StatusTag.vue";

const props = defineProps<{ id: string }>();
const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const confirm = useConfirm();
const toast = useToast();

const event = ref<EventDetailDto | null>(null);
const starting = ref(false);

const tabs = computed(() => {
  const base = `/admin/events/${props.id}`;
  const ev = event.value;
  const countBadge = ev
    ? `${ev.criteria.length}项 · ${ev.projects.length}项目 · ${ev.judges.length}评委`
    : "";
  return [
    {
      label: t("admin.nav.settings"),
      sub: countBadge,
      icon: "pi pi-sliders-h",
      to: `${base}/settings`,
    },
    {
      label: t("admin.check.title"),
      sub: ev?.startCheck.ok ? "已就绪" : "待完善",
      icon: "pi pi-check-circle",
      to: `${base}/check`,
    },
    {
      label: t("admin.control.title"),
      sub: ev?.status === "judging" ? "进行中" : "",
      icon: "pi pi-play-circle",
      to: `${base}/control`,
    },
    {
      label: t("admin.results.title"),
      sub: ev?.status === "closed" ? "最终榜" : "实时榜",
      icon: "pi pi-chart-bar",
      to: `${base}/results`,
    },
  ];
});

async function load() {
  event.value = await api.get<EventDetailDto>(`/admin/events/${props.id}`);
}

function quickStart() {
  if (!event.value?.startCheck.ok) {
    router.push(`/admin/events/${props.id}/check`);
    return;
  }
  confirm.require({
    header: t("admin.check.startConfirmHeader"),
    message: t("admin.check.startConfirm"),
    icon: "pi pi-exclamation-triangle",
    acceptLabel: t("admin.check.start"),
    rejectLabel: t("common.cancel"),
    accept: async () => {
      starting.value = true;
      try {
        await api.post(`/admin/events/${event.value!.id}/start`);
        toast.add({ severity: "success", detail: "比赛已启动，已进入现场导播台", life: 3000 });
        await load();
        router.push(`/admin/events/${props.id}/control`);
      } catch (error) {
        toast.add({
          severity: "error",
          detail: t(`errors.${(error as { code?: string }).code ?? "internal_error"}`),
          life: 5000,
        });
        await load();
      } finally {
        starting.value = false;
      }
    },
  });
}

function openDisplayTab() {
  if (!event.value?.displayInviteUrl) return;
  window.open(event.value.displayInviteUrl, "_blank", "noopener");
}

// 头部状态（启动/闭幕/配置计数）随业务事件刷新
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
useRevisionStream(`/admin/events/${props.id}/stream`, () => {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    load().catch(() => undefined);
  }, 250);
});

onMounted(load);
</script>

<template>
  <div v-if="event">
    <div class="tw:rounded-2xl tw:border tw:border-line tw:bg-surface tw:p-5 tw:shadow-xs">
      <div class="tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-4">
        <div class="tw:min-w-0">
          <div class="tw:flex tw:flex-wrap tw:items-center tw:gap-2.5">
            <h1 class="tw:text-xl tw:font-bold tw:text-default">{{ event.name }}</h1>
            <StatusTag :status="event.status" />
            <span class="tw:rounded-md tw:bg-surface-muted tw:px-2 tw:py-0.5 tw:font-mono tw:text-xs tw:text-muted">
              /{{ event.slug }}
            </span>
          </div>
          <p v-if="event.description" class="tw:mt-1 tw:text-sm tw:text-muted">{{ event.description }}</p>
        </div>

        <div class="tw:flex tw:flex-wrap tw:items-center tw:gap-2">
          <Button
            v-if="event.displayInviteUrl"
            :label="t('admin.control.openDisplayWindow')"
            icon="pi pi-desktop"
            severity="secondary"
            outlined
            @click="openDisplayTab"
          />
          <Button
            v-if="event.status === 'draft' && route.path !== `/admin/events/${id}/check`"
            :label="t('admin.check.start')"
            icon="pi pi-play"
            :severity="event.startCheck.ok ? 'primary' : 'secondary'"
            :loading="starting"
            @click="quickStart"
          />
        </div>
      </div>

      <nav class="tw:mt-5 tw:flex tw:flex-wrap tw:gap-2 tw:border-t tw:border-line tw:pt-4">
        <Button
          v-for="tab in tabs"
          :key="tab.to"
          :label="tab.label"
          :icon="tab.icon"
          :severity="route.path === tab.to ? 'primary' : 'secondary'"
          :outlined="route.path !== tab.to"
          :class="{ 'admin-tab-active': route.path === tab.to }"
          @click="$router.push(tab.to)"
        />
      </nav>
    </div>

    <router-view :id="id" />
  </div>
  <div v-else class="tw:py-16 tw:text-center tw:text-muted">{{ t("common.loading") }}</div>
</template>
