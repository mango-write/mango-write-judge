// 组件测试挂载辅助：i18n（zh-CN）+ PrimeVue（无主题运行时）。
import { createI18n } from "vue-i18n";
import PrimeVue from "primevue/config";
import type { Component } from "vue";

import { messages } from "../locale";

export function testPlugins() {
  const i18n = createI18n({
    legacy: false,
    locale: "zh-CN",
    fallbackLocale: "zh-CN",
    messages: messages as unknown as { "zh-CN": Record<string, never> },
  });
  return [PrimeVue, i18n];
}

export function mountOptions(extra: Record<string, unknown> = {}) {
  return { global: { plugins: testPlugins() }, ...extra };
}

export type AnyComponent = Component;
