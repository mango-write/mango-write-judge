<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { Moon, Sun } from "lucide-vue-next";

import { Button, useThemePreference } from "@mango-write/ui";

const { t } = useI18n();
const { resolved, setTheme } = useThemePreference();
const isDark = computed(() => resolved.value === "dark");
const icon = computed(() => (isDark.value ? Sun : Moon));
const label = computed(() => t(isDark.value ? "common.toLight" : "common.toDark"));

/** 两档切换：从当前生效主题翻转，显式写入偏好（覆盖「跟随系统」）。 */
function click() {
  setTheme(resolved.value === "dark" ? "light" : "dark");
}
</script>

<template>
  <Button :label="label" :icon="icon" severity="secondary" text :aria-label="label" @click="click" />
</template>
