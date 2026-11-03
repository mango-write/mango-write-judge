// Judge 前端装配：createApp + PrimeVue（MangoPreset）+ vue-router + vue-i18n。
// MVP 文案 zh-CN（i18n 已接好，en-US 可后续补充为独立 locale 文件）。
import { createApp } from "vue";
import { createI18n } from "vue-i18n";
import PrimeVue from "primevue/config";
import ConfirmationService from "primevue/confirmationservice";
import ToastService from "primevue/toastservice";

import { initTheme, MangoPreset, mergeUiMessages, vTooltip } from "@mango-write/ui";

import { messages } from "./locale";
import App from "./App.vue";
import { router } from "./router";
import "./styles.css";

initTheme();
document.documentElement.lang = "zh-CN";

const i18n = createI18n({
  legacy: false,
  locale: "zh-CN",
  fallbackLocale: "zh-CN",
  messages,
});
mergeUiMessages(i18n);

const app = createApp(App);
app.use(PrimeVue, {
  theme: { preset: MangoPreset, options: { darkModeSelector: '[data-theme="dark"]' } },
});
app.use(ToastService);
app.use(ConfirmationService);
app.use(i18n);
app.use(router);
app.directive("tooltip", vTooltip);
app.mount("#app");
