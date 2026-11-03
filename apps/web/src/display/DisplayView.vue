<script setup lang="ts">
// 大屏门：链接 fragment 中的 token 换 HttpOnly 会话后渲染直播面。
// EventSource 必须在会话建立后创建——401 会让浏览器永久关闭该连接。
import { onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";

import { AppLogo } from "@mango-write/ui";

import { api } from "../lib/api";
import DisplayLive from "./DisplayLive.vue";

const props = defineProps<{ slug: string }>();
const { t } = useI18n();

const state = ref<"gate" | "exchanging" | "live">("gate");

async function exchange(token: string) {
  state.value = "exchanging";
  try {
    await api.post("/display/session", { token });
    history.replaceState(null, "", `/display/${props.slug}`);
    state.value = "live";
  } catch {
    state.value = "gate";
  }
}

onMounted(() => {
  document.documentElement.dataset.theme = "dark";
  const token = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : "";
  if (token) {
    void exchange(token);
    return;
  }
  api
    .get("/display/snapshot")
    .then(() => {
      state.value = "live";
    })
    .catch(() => {
      state.value = "gate";
    });
});
</script>

<template>
  <div v-if="state !== 'live'" class="display-root">
    <div class="tw:flex tw:h-screen tw:flex-col tw:items-center tw:justify-center tw:gap-4">
      <AppLogo />
      <p v-if="state === 'exchanging'" class="tw:text-xl tw:opacity-70">{{ t("display.gate.exchanging") }}</p>
      <p v-else class="tw:px-8 tw:text-center tw:text-xl tw:opacity-80">{{ t("display.gate.invalid") }}</p>
    </div>
  </div>
  <DisplayLive v-else />
</template>

<style scoped>
.display-root {
  --d-bg: #0b1020;
  height: 100vh;
  background: var(--d-bg);
  color: #f2f5fb;
}
</style>
