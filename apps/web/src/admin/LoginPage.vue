<script setup lang="ts">
import { ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";

import { AppLogo, Button, InputText, useNotify } from "@mango-write/ui";

import { api, ApiError } from "../lib/api";
import { invalidateMe } from "../lib/session";
import SourceLicenseFooter from "../shared/SourceLicenseFooter.vue";
import ThemeToggle from "../shared/ThemeToggle.vue";

const { t } = useI18n();
const notify = useNotify();
const router = useRouter();
const route = useRoute();

const username = ref("");
const password = ref("");
const submitting = ref(false);

async function submit() {
  if (!username.value || !password.value || submitting.value) return;
  submitting.value = true;
  try {
    await api.post("/admin/login", { username: username.value.trim(), password: password.value });
    invalidateMe();
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
    <div class="tw:fixed tw:right-4 tw:top-4 tw:z-10">
      <ThemeToggle />
    </div>
    <div class="tw:flex tw:flex-col tw:items-center tw:gap-3">
      <AppLogo />
      <h1 class="tw:text-lg tw:font-semibold">{{ t("admin.login.title") }}</h1>
    </div>
    <form class="tw:flex tw:w-full tw:max-w-sm tw:flex-col tw:gap-4 tw:rounded-2xl tw:border tw:border-line tw:bg-surface tw:p-6 tw:shadow-sm" @submit.prevent="submit">
      <div>
        <label for="admin-username" class="tw:mb-2 tw:block tw:text-sm tw:font-medium">{{ t("admin.login.username") }}</label>
        <InputText
          v-model="username"
          input-id="admin-username"
          class="tw:w-full"
          autocomplete="username"
          autofocus
          fluid
        />
      </div>
      <div>
        <label for="admin-password" class="tw:mb-2 tw:block tw:text-sm tw:font-medium">{{ t("admin.login.password") }}</label>
        <InputText
          v-model="password"
          type="password"
          input-id="admin-password"
          class="tw:w-full"
          autocomplete="current-password"
          fluid
        />
      </div>
      <Button
        type="submit"
        :label="t('admin.login.submit')"
        class="tw:w-full"
        :loading="submitting"
      />
    </form>
    <SourceLicenseFooter />
  </div>
</template>
