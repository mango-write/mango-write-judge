<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { useToast } from "primevue/usetoast";

import { PageHeader } from "@mango-write/ui";
import Button from "primevue/button";
import Dialog from "primevue/dialog";
import InputText from "primevue/inputtext";

import type { EventSummaryDto } from "@mango-write-judge/contracts";
import { api } from "../lib/api";
import { formatDateTime } from "../lib/format";
import StatusTag from "../shared/StatusTag.vue";

const { t } = useI18n();
const toast = useToast();
const router = useRouter();

const events = ref<EventSummaryDto[]>([]);
const loading = ref(true);
const showCreate = ref(false);
const creating = ref(false);
const form = ref({ name: "", slug: "", description: "" });

async function load() {
  loading.value = true;
  try {
    const result = await api.get<{ events: EventSummaryDto[] }>("/admin/events");
    events.value = result.events;
  } finally {
    loading.value = false;
  }
}

async function create() {
  if (!form.value.name.trim() || creating.value) return;
  creating.value = true;
  try {
    const created = await api.post<{ id: string }>("/admin/events", {
      name: form.value.name.trim(),
      slug: form.value.slug.trim() || undefined,
      description: form.value.description.trim(),
    });
    showCreate.value = false;
    router.push(`/admin/events/${created.id}/settings`);
  } catch (error) {
    toast.add({ severity: "error", detail: t(error instanceof Error ? `errors.${(error as { code?: string }).code ?? "internal_error"}` : "errors.internal_error"), life: 5000 });
  } finally {
    creating.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div>
    <PageHeader :title="t('admin.events.title')" flush>
      <template #actions>
        <Button :label="t('admin.events.create')" icon="pi pi-plus" @click="showCreate = true" />
      </template>
    </PageHeader>

    <div v-if="loading" class="tw:py-16 tw:text-center tw:text-muted">{{ t("common.loading") }}</div>
    <div v-else-if="events.length === 0" class="tw:py-16 tw:text-center tw:text-muted">
      {{ t("admin.events.emptyHint") }}
    </div>
    <div v-else class="tw:grid tw:gap-4 sm:tw:grid-cols-2 lg:tw:grid-cols-3">
      <button
        v-for="event in events"
        :key="event.id"
        class="tw:rounded-2xl tw:border tw:border-line tw:bg-surface tw:p-5 tw:text-left tw:shadow-sm transition hover:tw:border-primary-300"
        @click="router.push(`/admin/events/${event.id}/${event.status === 'draft' ? 'settings' : 'control'}`)"
      >
        <div class="tw:flex tw:items-center tw:gap-2">
          <span class="tw:font-semibold">{{ event.name }}</span>
          <StatusTag :status="event.status" />
        </div>
        <p class="tw:mt-2 tw:text-sm tw:text-muted">
          {{ t("admin.events.counts", { projects: event.projectCount, judges: event.judgeCount, criteria: event.criterionCount }) }}
        </p>
        <p class="tw:mt-1 tw:text-xs tw:text-faint">{{ t("admin.events.updatedAt", { time: formatDateTime(event.updatedAt) }) }}</p>
      </button>
    </div>

    <Dialog v-model:visible="showCreate" modal :header="t('admin.events.create')" class="tw:min-w-90">
      <form class="tw:flex tw:flex-col tw:gap-3" @submit.prevent="create">
        <div>
          <label class="tw:mb-1 tw:block tw:text-sm">{{ t("admin.events.name") }}</label>
          <InputText v-model="form.name" class="tw:w-full" :aria-label="t('admin.events.name')" autofocus />
        </div>
        <div>
          <label class="tw:mb-1 tw:block tw:text-sm">{{ t("admin.events.slug") }}</label>
          <InputText v-model="form.slug" class="tw:w-full" :aria-label="t('admin.events.slug')" :placeholder="t('admin.events.slugHint')" />
        </div>
        <div>
          <label class="tw:mb-1 tw:block tw:text-sm">{{ t("admin.events.description") }}</label>
          <InputText v-model="form.description" class="tw:w-full" />
        </div>
        <div class="tw:flex tw:justify-end tw:gap-2">
          <Button :label="t('common.cancel')" severity="secondary" text @click="showCreate = false" />
          <Button type="submit" :label="t('common.confirm')" :loading="creating" />
        </div>
      </form>
    </Dialog>
  </div>
</template>
