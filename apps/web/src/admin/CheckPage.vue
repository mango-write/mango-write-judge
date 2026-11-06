<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { useConfirm } from "primevue/useconfirm";
import { useToast } from "primevue/usetoast";

import Button from "primevue/button";

import type { EventDetailDto } from "@mango-write-judge/contracts";
import { api } from "../lib/api";

const props = defineProps<{ id: string }>();
const { t } = useI18n();
const toast = useToast();
const confirm = useConfirm();
const router = useRouter();

const event = ref<EventDetailDto | null>(null);
const starting = ref(false);

const check = computed(() => event.value?.startCheck ?? null);
const issues = computed(() => {
  if (!check.value || check.value.ok) return [];
  const codes = [check.value.code];
  return codes.filter(Boolean).map((code) => t(`admin.check.issueCodes.${code}`));
});

async function load() {
  event.value = await api.get<EventDetailDto>(`/admin/events/${props.id}`);
}

function start() {
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
        toast.add({ severity: "success", detail: "比赛已启动", life: 3000 });
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

onMounted(load);
</script>

<template>
  <div v-if="event && check" class="tw:mt-6 tw:max-w-xl">
    <div v-if="event.status === 'draft'" class="tw:rounded-2xl tw:border tw:border-line tw:bg-surface tw:p-6">
      <h2 class="tw:text-base tw:font-semibold">{{ t("admin.check.title") }}</h2>
      <dl class="tw:mt-4 tw:divide-y tw:divide-line">
        <div class="tw:flex tw:items-center tw:justify-between tw:py-3">
          <dt>{{ t("admin.check.criteriaCount") }}</dt>
          <dd class="tw:font-semibold">{{ check.criterionCount }}</dd>
        </div>
        <div class="tw:flex tw:items-center tw:justify-between tw:py-3">
          <dt>{{ t("admin.check.projectsCount") }}</dt>
          <dd class="tw:font-semibold">{{ check.projectCount }}</dd>
        </div>
        <div class="tw:flex tw:items-center tw:justify-between tw:py-3">
          <dt>{{ t("admin.check.judgesCount") }}</dt>
          <dd class="tw:font-semibold">{{ check.judgeCount }}</dd>
        </div>
        <div class="tw:flex tw:items-center tw:justify-between tw:py-3">
          <dt>{{ t("admin.check.weights") }}</dt>
          <dd class="tw:font-semibold" :class="check.weightsSum === 100 ? 'tw:text-success' : 'tw:text-danger'">
            {{ check.weightsSum }}%
          </dd>
        </div>
        <div class="tw:flex tw:items-center tw:justify-between tw:py-3">
          <dt>{{ t("admin.check.displayLink") }}</dt>
          <dd class="tw:font-semibold tw:text-success">{{ t("admin.check.displayReady") }}</dd>
        </div>
      </dl>

      <ul v-if="issues.length" class="tw:mt-4 tw:rounded-xl tw:bg-danger/10 tw:p-4 tw:text-sm tw:text-danger">
        <li v-for="issue in issues" :key="issue">{{ issue }}</li>
      </ul>
      <p class="tw:mt-4 tw:text-sm tw:text-muted">{{ t("admin.check.freezeNotice") }}</p>
      <Button class="tw:mt-4" :label="t('admin.check.start')" :disabled="!check.ok" :loading="starting" @click="start" />
    </div>
    <div v-else class="tw:rounded-2xl tw:border tw:border-line tw:bg-surface tw:p-6 tw:text-sm tw:text-muted">
      {{ t("admin.settings.frozenNotice") }}
    </div>
  </div>
</template>
