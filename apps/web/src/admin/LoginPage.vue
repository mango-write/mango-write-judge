<script setup lang="ts">
import { ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";

import { AppLogo, Button, InputText, useNotify } from "@mango-write/ui";

import { api, ApiError } from "../lib/api";
import SourceLicenseFooter from "../shared/SourceLicenseFooter.vue";

const { t } = useI18n();
const notify = useNotify();
const router = useRouter();
const route = useRoute();

const password = ref("");
const submitting = ref(false);

async function submit() {
  if (!password.value || submitting.value) return;
  submitting.value = true;
  try {
    await api.post("/admin/login", { password: password.value });
    router.replace(typeof route.query.redirect === "string" ? route.query.redirect : "/admin");
  } catch (error) {
    const key = error instanceof ApiError && error.code === "rate_limited" ? "admin.login.limited" : "admin.login.badCredentials";
    notify.add({ severity: "error", detail: t(key), life: 4000 });
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="tw:flex tw:min-h-screen tw:flex-col tw:items-center tw:justify-center tw:bg-page tw:gap-8 tw:px-6">
    <div class="tw:flex tw:flex-col tw:items-center tw:gap-3">
      <AppLogo />
      <h1 class="tw:text-lg tw:font-semibold">{{ t("admin.login.title") }}</h1>
    </div>
    <form class="tw:w-full tw:max-w-sm tw:rounded-2xl tw:border tw:border-line tw:bg-surface tw:p-6 tw:shadow-sm" @submit.prevent="submit">
      <label for="admin-password" class="tw:mb-2 tw:block tw:text-sm tw:font-medium">{{ t("admin.login.password") }}</label>
      <InputText
        v-model="password"
        type="password"
        input-id="admin-password"
        class="tw:w-full"
        autocomplete="current-password"
        autofocus
        fluid
      />
      <Button
        type="submit"
        :label="t('admin.login.submit')"
        class="tw:mt-4 tw:w-full"
        :loading="submitting"
      />
    </form>
    <SourceLicenseFooter />
  </div>
</template>
