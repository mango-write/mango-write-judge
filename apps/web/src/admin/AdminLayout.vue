<script setup lang="ts">
import { useRouter } from "vue-router";

import { AppLogo } from "@mango-write/ui";
import Button from "primevue/button";

import { api } from "../lib/api";
import SourceLicenseFooter from "../shared/SourceLicenseFooter.vue";

const router = useRouter();

async function logout() {
  try {
    await api.post("/admin/logout");
  } finally {
    router.replace("/admin/login");
  }
}
</script>

<template>
  <div class="tw:min-h-screen tw:bg-page">
    <header class="tw:border-b tw:border-line tw:bg-surface">
      <div class="tw:mx-auto tw:flex tw:max-w-[1280px] tw:items-center tw:gap-3 tw:px-6 tw:py-3">
        <AppLogo />
        <span class="tw:text-sm tw:font-semibold">Judge</span>
        <div class="tw:ml-auto">
          <Button :label="$t('common.logout')" severity="secondary" size="small" text @click="logout" />
        </div>
      </div>
    </header>
    <main class="tw:mx-auto tw:max-w-[1280px] tw:px-6 tw:py-8">
      <router-view />
      <SourceLicenseFooter />
    </main>
  </div>
</template>
