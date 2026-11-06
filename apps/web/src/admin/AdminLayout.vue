<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ArrowLeft, KeyRound, LogOut, Users } from "lucide-vue-next";

import { AppLogo, Button } from "@mango-write/ui";

import { api } from "../lib/api";
import { fetchMe, invalidateMe, type AdminMe } from "../lib/session";
import SourceLicenseFooter from "../shared/SourceLicenseFooter.vue";
import ThemeToggle from "../shared/ThemeToggle.vue";
import ChangePasswordDialog from "./ChangePasswordDialog.vue";

const router = useRouter();
const route = useRoute();

const me = ref<AdminMe | null>(null);
const showChangePassword = ref(false);

onMounted(async () => {
  // 401 由路由守卫处理跳登录，这里只负责展示身份
  me.value = await fetchMe().catch(() => null);
});

async function logout() {
  try {
    await api.post("/admin/logout");
  } finally {
    invalidateMe();
    router.replace("/admin/login");
  }
}
</script>

<template>
  <div class="tw:min-h-screen tw:bg-page">
    <header class="tw:sticky tw:top-0 tw:z-20 tw:border-b tw:border-line tw:bg-surface/95 tw:backdrop-blur">
      <div class="tw:mx-auto tw:flex tw:max-w-[1280px] tw:items-center tw:gap-3 tw:px-6 tw:py-3">
        <button
          type="button"
          class="tw:flex tw:cursor-pointer tw:items-center tw:gap-2.5 tw:rounded-lg tw:px-1.5 tw:py-1 tw:text-left transition tw:hover:bg-page-hover"
          @click="router.push('/admin')"
        >
          <AppLogo />
          <span class="tw:text-sm tw:font-semibold tw:text-default">Judge</span>
          <span class="tw:hidden tw:rounded-md tw:bg-surface-muted tw:px-2 tw:py-0.5 tw:text-xs tw:text-muted tw:sm:inline">
            {{ $t("app.tagline") }}
          </span>
        </button>

        <Button
          v-if="route.path !== '/admin'"
          :label="$t('common.allEvents')"
          :icon="ArrowLeft"
          severity="secondary"
          text
          @click="router.push('/admin')"
        />

        <div class="tw:ml-auto tw:flex tw:items-center tw:gap-2">
          <ThemeToggle />
          <span v-if="me" class="tw:text-xs tw:text-faint">{{ me.name }}</span>
          <Button
            v-if="me?.role === 'super'"
            :label="$t('admin.accounts.title')"
            :icon="Users"
            severity="secondary"
            text
            @click="router.push('/admin/accounts')"
          />
          <Button
            :label="$t('common.changePassword')"
            :icon="KeyRound"
            severity="secondary"
            text
            @click="showChangePassword = true"
          />
          <Button :label="$t('common.logout')" :icon="LogOut" severity="secondary" text @click="logout" />
        </div>
      </div>
    </header>
    <main class="tw:mx-auto tw:max-w-[1280px] tw:px-6 tw:py-8">
      <router-view />
      <SourceLicenseFooter />
    </main>
    <ChangePasswordDialog v-model:open="showChangePassword" />
  </div>
</template>
