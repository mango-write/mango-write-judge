<script setup lang="ts">
// 评委壳：链接 fragment 里的 token 换 HttpOnly 会话后立即从地址栏移除；
// 无有效会话时显示门视图（token 不落 localStorage）。
import { onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";

import { AppLogo } from "@mango-write/ui";

import { api, ApiError } from "../lib/api";

const props = defineProps<{ slug: string }>();
const { t } = useI18n();

const state = ref<"exchanging" | "gate" | "ready">("gate");

async function exchange(token: string) {
  state.value = "exchanging";
  try {
    await api.post("/judge/session", { token });
    history.replaceState(null, "", `/judge/${props.slug}/projects`);
    state.value = "ready";
  } catch (error) {
    state.value = "gate";
    if (!(error instanceof ApiError && error.status === 401)) {
      // 404：链接无效或已被重置，不泄露更多信息
    }
  }
}

onMounted(() => {
  const token = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : "";
  if (token) {
    void exchange(token);
    return;
  }
  // 无 fragment：探一下已有会话
  api
    .get("/judge/snapshot")
    .then(() => {
      state.value = "ready";
    })
    .catch(() => {
      state.value = "gate";
    });
});
</script>

<template>
  <div v-if="state !== 'ready'" class="tw:flex tw:min-h-screen tw:flex-col tw:items-center tw:justify-center tw:gap-4 tw:bg-page tw:px-6 judge-touch">
    <AppLogo />
    <div v-if="state === 'exchanging'" class="tw:text-sm tw:text-muted">{{ t("judge.gate.exchanging") }}</div>
    <div v-else class="tw:max-w-sm tw:rounded-2xl tw:border tw:border-line tw:bg-surface tw:p-6 tw:text-center">
      <p class="tw:font-medium tw:text-danger">{{ t("judge.gate.invalid") }}</p>
      <p class="tw:mt-2 tw:text-sm tw:text-muted">{{ t("judge.gate.retryHint") }}</p>
    </div>
  </div>
  <div v-else class="tw:min-h-screen tw:bg-page judge-touch">
    <router-view />
  </div>
</template>
