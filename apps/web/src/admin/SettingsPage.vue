<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useToast } from "primevue/usetoast";

import { PageHeader } from "@mango-write/ui";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import Textarea from "primevue/textarea";

import type { EventDetailDto } from "@mango-write-judge/contracts";
import { api } from "../lib/api";
import CriteriaEditor from "./components/CriteriaEditor.vue";
import ProjectsEditor from "./components/ProjectsEditor.vue";
import JudgesPanel from "./components/JudgesPanel.vue";

const props = defineProps<{ id: string }>();
const { t } = useI18n();
const toast = useToast();

const event = ref<EventDetailDto | null>(null);
const section = ref<"basic" | "criteria" | "projects" | "judges">("basic");
const name = ref("");
const description = ref("");
const savingBasic = ref(false);

const isDraft = computed(() => event.value?.status === "draft");

async function load() {
  event.value = await api.get<EventDetailDto>(`/admin/events/${props.id}`);
  name.value = event.value.name;
  description.value = event.value.description;
}

async function saveBasic() {
  if (!event.value || savingBasic.value) return;
  savingBasic.value = true;
  try {
    event.value = await api.patch<EventDetailDto>(`/admin/events/${props.id}`, {
      name: name.value.trim(),
      description: description.value.trim(),
      expectedRevision: event.value.revision,
    });
    toast.add({ severity: "success", detail: t("common.saved"), life: 2000 });
  } catch (error) {
    toast.add({ severity: "error", detail: t(error instanceof Error ? `errors.${(error as { code?: string }).code ?? "internal_error"}` : "errors.internal_error"), life: 5000 });
  } finally {
    savingBasic.value = false;
  }
}

const sections = computed(() => [
  { key: "basic", label: t("admin.settings.tabs.basic") },
  { key: "criteria", label: t("admin.settings.tabs.criteria") },
  { key: "projects", label: t("admin.settings.tabs.projects") },
  { key: "judges", label: t("admin.settings.tabs.judges") },
] as const);

onMounted(load);
</script>

<template>
  <div v-if="event" class="tw:mt-6">
    <div v-if="!isDraft" class="tw:mb-4 tw:rounded-xl tw:border tw:border-warning/30 tw:bg-warning/10 tw:px-4 tw:py-3 tw:text-sm tw:text-warning">
      {{ t("admin.settings.frozenNotice") }}
    </div>

    <div class="tw:mb-6 tw:flex tw:flex-wrap tw:gap-1">
      <Button
        v-for="item in sections"
        :key="item.key"
        :label="item.label"
        :severity="section === item.key ? 'primary' : 'secondary'"
        :outlined="section !== item.key"
        size="small"
        @click="section = item.key"
      />
    </div>

    <section v-if="section === 'basic'" class="tw:max-w-xl tw:rounded-2xl tw-border tw-border-line tw:bg-surface tw:p-6">
      <form class="tw:flex tw:flex-col tw:gap-4" @submit.prevent="saveBasic">
        <div>
          <label class="tw:mb-1 tw:block tw:text-sm tw:font-medium">{{ t("admin.settings.basicName") }}</label>
          <InputText v-model="name" class="tw:w-full" :disabled="!isDraft && false" />
        </div>
        <div>
          <label class="tw:mb-1 tw:block tw:text-sm tw:font-medium">{{ t("admin.settings.basicDescription") }}</label>
          <Textarea v-model="description" class="tw:w-full" rows="3" auto-resize />
        </div>
        <div class="tw:flex tw:justify-end">
          <Button type="submit" :label="t('common.save')" :loading="savingBasic" />
        </div>
      </form>
    </section>

    <CriteriaEditor v-else-if="section === 'criteria'" :event="event" :disabled="!isDraft" @changed="load" />
    <ProjectsEditor v-else-if="section === 'projects'" :event="event" :disabled="!isDraft" @changed="load" />
    <JudgesPanel v-else :event="event" :disabled="!isDraft" @changed="load" />
  </div>
</template>
