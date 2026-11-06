<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { ArrowRight, Plus, Trash2 } from "lucide-vue-next";

import { Button, Dialog, InputText, PageHeader, useConfirm, useNotify } from "@mango-write/ui";

import type { EventSummaryDto } from "@mango-write-judge/contracts";
import { api } from "../lib/api";
import { formatDateTime } from "../lib/format";
import StatusTag from "../shared/StatusTag.vue";

const { t } = useI18n();
const notify = useNotify();
const confirm = useConfirm();
const router = useRouter();

const events = ref<EventSummaryDto[]>([]);
const loading = ref(true);
const showCreate = ref(false);
const creating = ref(false);
const form = ref({
  name: "",
  slug: "",
  description: "",
  template: "blank" as "blank" | "roadshow" | "hackathon",
});

const TEMPLATES = {
  roadshow: [
    { name: "创新性与技术壁垒", description: "核心技术创新度、差异化与竞争壁垒", weightPercent: 30 },
    { name: "产品完成度与体验", description: "产品功能完整度、交互体验与演示效果", weightPercent: 30 },
    { name: "商业价值与落地", description: "目标市场规模、商业模式清晰度与落地可行性", weightPercent: 20 },
    { name: "路演表达与答辩", description: "逻辑清晰度、时间把控与现场问答表现", weightPercent: 20 },
  ],
  hackathon: [
    { name: "创意与破题", description: "痛点定义是否准确、解法是否有新意", weightPercent: 30 },
    { name: "技术实现与完成度", description: "现场可运行 Demo 的完整度与技术难度", weightPercent: 35 },
    { name: "用户体验与设计", description: "界面交互流畅度与可用性", weightPercent: 20 },
    { name: "现场演示效果", description: "展示感染力与团队配合", weightPercent: 15 },
  ],
} as const;

async function load() {
  loading.value = true;
  try {
    const result = await api.get<{ events: EventSummaryDto[] }>("/admin/events");
    events.value = result.events;
  } finally {
    loading.value = false;
  }
}

function openCreateModal(defaultTemplate: "blank" | "roadshow" = "blank") {
  form.value = { name: "", slug: "", description: "", template: defaultTemplate };
  showCreate.value = true;
}

async function create() {
  if (!form.value.name.trim() || creating.value) return;
  creating.value = true;
  try {
    const criteria =
      form.value.template === "blank" ? undefined : [...TEMPLATES[form.value.template]];
    const created = await api.post<{ id: string }>("/admin/events", {
      name: form.value.name.trim(),
      slug: form.value.slug.trim() || undefined,
      description: form.value.description.trim(),
      criteria,
    });
    showCreate.value = false;
    router.push(`/admin/events/${created.id}/settings`);
  } catch (error) {
    notify.add({
      severity: "error",
      detail: t(
        error instanceof Error
          ? `errors.${(error as { code?: string }).code ?? "internal_error"}`
          : "errors.internal_error",
      ),
      life: 5000,
    });
  } finally {
    creating.value = false;
  }
}

function removeEvent(event: EventSummaryDto) {
  confirm.require({
    header: t("admin.events.deleteConfirmHeader"),
    message: t("admin.events.deleteConfirm", { name: event.name }),
    icon: Trash2,
    acceptLabel: t("common.delete"),
    rejectLabel: t("common.cancel"),
    accept: async () => {
      try {
        await api.delete(`/admin/events/${event.id}`);
        await load();
      } catch (error) {
        notify.add({
          severity: "error",
          detail: t(
            error instanceof Error
              ? `errors.${(error as { code?: string }).code ?? "internal_error"}`
              : "errors.internal_error",
          ),
          life: 5000,
        });
      }
    },
  });
}

function targetRouteOf(event: EventSummaryDto): string {
  if (event.status === "draft") return `/admin/events/${event.id}/settings`;
  if (event.status === "judging") return `/admin/events/${event.id}/control`;
  return `/admin/events/${event.id}/results`;
}

onMounted(load);
</script>

<template>
  <div>
    <PageHeader :title="t('admin.events.title')" :subtitle="t('admin.events.subtitle')" flush>
      <template #actions>
        <Button :label="t('admin.events.create')" :icon="Plus" @click="openCreateModal('blank')" />
      </template>
    </PageHeader>

    <div v-if="loading" class="tw:py-16 tw:text-center tw:text-muted">{{ t("common.loading") }}</div>
    <div
      v-else-if="events.length === 0"
      class="tw:mt-6 tw:flex tw:flex-col tw:items-center tw:justify-center tw:gap-4 tw:rounded-2xl tw:border tw:border-dashed tw:border-line tw:bg-surface tw:p-12 tw:text-center"
    >
      <div class="tw:text-base tw:font-medium tw:text-default">{{ t("admin.events.emptyHint") }}</div>
      <div class="tw:flex tw:flex-wrap tw:gap-3">
        <Button :label="t('admin.events.create')" :icon="Plus" @click="openCreateModal('roadshow')" />
      </div>
    </div>
    <div v-else class="tw:mt-6 tw:grid tw:gap-4 tw:sm:grid-cols-2 tw:lg:grid-cols-3">
      <div
        v-for="event in events"
        :key="event.id"
        class="tw:group tw:flex tw:flex-col tw:justify-between tw:rounded-2xl tw:border tw:border-line tw:bg-surface tw:p-5 tw:shadow-xs transition tw:hover:border-primary-300 tw:hover:shadow-sm"
      >
        <div class="tw:cursor-pointer" @click="router.push(targetRouteOf(event))">
          <div class="tw:flex tw:items-start tw:justify-between tw:gap-2">
            <span class="tw:text-base tw:font-semibold tw:text-default group-hover:tw:text-primary-700">
              {{ event.name }}
            </span>
            <StatusTag :status="event.status" />
          </div>
          <div class="tw:mt-1 tw:font-mono tw:text-xs tw:text-faint">/{{ event.slug }}</div>
          <p class="tw:mt-3 tw:text-sm tw:text-muted">
            {{
              t("admin.events.counts", {
                projects: event.projectCount,
                judges: event.judgeCount,
                criteria: event.criterionCount,
              })
            }}
          </p>
        </div>

        <div class="tw:mt-4 tw:flex tw:items-center tw:justify-between tw:border-t tw:border-line tw:pt-3">
          <span class="tw:text-xs tw:text-faint">
            {{ t("admin.events.updatedAt", { time: formatDateTime(event.updatedAt) }) }}
          </span>
          <div class="tw:flex tw:items-center tw:gap-1">
            <Button
              :icon="Trash2"
              severity="danger"
              text
              :aria-label="t('common.delete')"
              @click.stop="removeEvent(event)"
            />
            <Button
              :label="
                event.status === 'draft'
                  ? t('admin.events.enterDraft')
                  : event.status === 'judging'
                    ? t('admin.events.enterJudging')
                    : t('admin.events.enterClosed')
              "
              :icon="ArrowRight"
              icon-pos="right"
              severity="secondary"
              text
              @click="router.push(targetRouteOf(event))"
            />
          </div>
        </div>
      </div>
    </div>

    <Dialog
      v-model:open="showCreate"
      modal
      :title="t('admin.events.create')"
      width="min(32rem, 92vw)"
    >
      <form class="tw:flex tw:flex-col tw:gap-4" @submit.prevent="create">
        <div>
          <label class="tw:mb-1 tw:block tw:text-sm tw:font-medium">{{ t("admin.events.name") }}</label>
          <InputText
            v-model="form.name"
            class="tw:w-full"
            :aria-label="t('admin.events.name')"
            placeholder="例如：2026 春季创业路演决赛"
            autofocus
          />
        </div>
        <div>
          <label class="tw:mb-1 tw:block tw:text-sm tw:font-medium">{{ t("admin.events.slug") }}</label>
          <InputText
            v-model="form.slug"
            class="tw:w-full"
            :aria-label="t('admin.events.slug')"
            :placeholder="t('admin.events.slugHint')"
          />
        </div>
        <div>
          <label class="tw:mb-1 tw:block tw:text-sm tw:font-medium">{{ t("admin.events.description") }}</label>
          <InputText
            v-model="form.description"
            class="tw:w-full"
            placeholder="例如：单轮全评委打分，大屏实时展示"
          />
        </div>
        <div>
          <label class="tw:mb-1.5 tw:block tw:text-sm tw:font-medium">{{ t("admin.events.template") }}</label>
          <div class="tw:grid tw:gap-2">
            <label
              v-for="opt in [
                { key: 'roadshow', label: t('admin.events.templateRoadshow') },
                { key: 'hackathon', label: t('admin.events.templateHackathon') },
                { key: 'blank', label: t('admin.events.templateBlank') },
              ]"
              :key="opt.key"
              class="tw:flex tw:cursor-pointer tw:items-center tw:gap-2.5 tw:rounded-xl tw:border tw:px-3.5 tw:py-2.5 tw:text-sm"
              :class="
                form.template === opt.key
                  ? 'tw:border-primary-400 tw:bg-primary-50/50 tw:font-medium'
                  : 'tw:border-line tw:bg-surface'
              "
            >
              <input v-model="form.template" type="radio" :value="opt.key" class="tw:accent-primary-600" />
              <span>{{ opt.label }}</span>
            </label>
          </div>
        </div>
        <div class="tw:flex tw:justify-end tw:gap-2 tw:pt-2">
          <Button :label="t('common.cancel')" severity="secondary" text @click="showCreate = false" />
          <Button type="submit" :label="t('common.ok')" :loading="creating" />
        </div>
      </form>
    </Dialog>
  </div>
</template>
