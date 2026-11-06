<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { useConfirm } from "primevue/useconfirm";
import { useToast } from "primevue/usetoast";

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
const confirm = useConfirm();
const router = useRouter();

const event = ref<EventDetailDto | null>(null);
const section = ref<"basic" | "criteria" | "projects" | "judges">("criteria");
const name = ref("");
const description = ref("");
const savingBasic = ref(false);
const starting = ref(false);

const isDraft = computed(() => event.value?.status === "draft");
const isClosed = computed(() => event.value?.status === "closed");

async function load() {
  event.value = await api.get<EventDetailDto>(`/admin/events/${props.id}`);
  name.value = event.value.name;
  description.value = event.value.description;
}

async function saveBasic() {
  if (!event.value || savingBasic.value || isClosed.value) return;
  savingBasic.value = true;
  try {
    event.value = await api.patch<EventDetailDto>(`/admin/events/${props.id}`, {
      name: name.value.trim(),
      description: description.value.trim(),
      expectedRevision: event.value.revision,
    });
    toast.add({ severity: "success", detail: t("common.saved"), life: 2000 });
  } catch (error) {
    toast.add({
      severity: "error",
      detail: t(
        error instanceof Error
          ? `errors.${(error as { code?: string }).code ?? "internal_error"}`
          : "errors.internal_error",
      ),
      life: 5000,
    });
  } finally {
    savingBasic.value = false;
  }
}

function startNow() {
  if (!event.value?.startCheck.ok) return;
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

const sections = computed(() => {
  const ev = event.value;
  return [
    {
      key: "basic" as const,
      label: t("admin.settings.tabs.basic"),
      badge: "",
      ok: Boolean(ev?.name),
    },
    {
      key: "criteria" as const,
      label: t("admin.settings.tabs.criteria"),
      badge: ev ? `${ev.criteria.length} · ${ev.weightsSum}%` : "",
      ok: ev ? ev.criteria.length > 0 && ev.weightsSum === 100 : false,
    },
    {
      key: "projects" as const,
      label: t("admin.settings.tabs.projects"),
      badge: ev ? `${ev.projects.length}` : "",
      ok: ev ? ev.projects.length > 0 : false,
    },
    {
      key: "judges" as const,
      label: t("admin.settings.tabs.judges"),
      badge: ev ? `${ev.judges.length}` : "",
      ok: ev ? ev.judges.length > 0 : false,
    },
  ];
});

onMounted(load);
</script>

<template>
  <div v-if="event" class="tw:mt-6 tw:space-y-6">
    <div
      v-if="event.status === 'judging'"
      class="tw:rounded-xl tw:border tw:border-info/30 tw:bg-info/10 tw:px-4 tw:py-3 tw:text-sm tw:text-info"
    >
      {{ t("admin.settings.frozenNotice") }}
    </div>
    <div
      v-else-if="event.status === 'closed'"
      class="tw:rounded-xl tw:border tw:border-warning/30 tw:bg-warning/10 tw:px-4 tw:py-3 tw:text-sm tw:text-warning"
    >
      {{ t("admin.settings.closedNotice") }}
    </div>

    <div class="tw:flex tw:flex-wrap tw:items-center tw:gap-2">
      <Button
        v-for="item in sections"
        :key="item.key"
        :label="item.label"
        :badge="item.badge || undefined"
        :severity="section === item.key ? 'primary' : 'secondary'"
        :outlined="section !== item.key"
        @click="section = item.key"
      />
    </div>

    <section
      v-if="section === 'basic'"
      class="tw:max-w-2xl tw:rounded-2xl tw:border tw:border-line tw:bg-surface tw:p-6"
    >
      <form class="tw:flex tw:flex-col tw:gap-4" @submit.prevent="saveBasic">
        <div>
          <label class="tw:mb-1 tw:block tw:text-sm tw:font-medium">{{ t("admin.settings.basicName") }}</label>
          <InputText v-model="name" class="tw:w-full" :disabled="isClosed" />
        </div>
        <div>
          <label class="tw:mb-1 tw:block tw:text-sm tw:font-medium">{{ t("admin.settings.basicDescription") }}</label>
          <Textarea v-model="description" class="tw:w-full" rows="3" auto-resize :disabled="isClosed" />
        </div>
        <div class="tw:flex tw:justify-end">
          <Button type="submit" :label="t('common.save')" :loading="savingBasic" :disabled="isClosed" />
        </div>
      </form>
    </section>

    <CriteriaEditor v-else-if="section === 'criteria'" :event="event" :disabled="!isDraft" @changed="load" />
    <ProjectsEditor v-else-if="section === 'projects'" :event="event" :disabled="isClosed" @changed="load" />
    <JudgesPanel v-else :event="event" :disabled="isClosed" :can-delete="isDraft" @changed="load" />

    <!-- 草稿期底部常驻就绪进度与快速启动栏 -->
    <div
      v-if="isDraft"
      class="tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-4 tw:rounded-2xl tw:border tw:p-5"
      :class="
        event.startCheck.ok
          ? 'tw:border-success/40 tw:bg-success/5'
          : 'tw:border-line tw:bg-surface'
      "
    >
      <div class="tw:space-y-1">
        <div class="tw:flex tw:items-center tw:gap-2 tw:text-sm tw:font-semibold">
          <i
            class="pi"
            :class="event.startCheck.ok ? 'pi-check-circle tw:text-success' : 'pi-info-circle tw:text-warning'"
          />
          <span>
            {{ event.startCheck.ok ? t("admin.check.readyTitle") : t("admin.check.notReadyTitle") }}
          </span>
        </div>
        <div class="tw:flex tw:flex-wrap tw:gap-4 tw:text-xs tw:text-muted">
          <span :class="event.criteria.length > 0 && event.weightsSum === 100 ? 'tw:text-success' : 'tw:text-danger'">
            1. 评分规则：{{ event.criteria.length }} 项（权重 {{ event.weightsSum }}%）
          </span>
          <span :class="event.projects.length > 0 ? 'tw:text-success' : 'tw:text-danger'">
            2. 参赛项目：{{ event.projects.length }} 个
          </span>
          <span :class="event.judges.length > 0 ? 'tw:text-success' : 'tw:text-danger'">
            3. 评审评委：{{ event.judges.length }} 位
          </span>
        </div>
      </div>

      <div class="tw:flex tw:items-center tw:gap-2">
        <Button
          :label="t('admin.check.start')"
          icon="pi pi-play"
          :disabled="!event.startCheck.ok"
          :loading="starting"
          @click="startNow"
        />
      </div>
    </div>
  </div>
</template>
