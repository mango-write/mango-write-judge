<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { KeyRound, Plus, TriangleAlert } from "lucide-vue-next";

import { Button, Dialog, InputText, PageHeader, useConfirm, useNotify } from "@mango-write/ui";

import type { AdminAccountDto } from "@mango-write-judge/contracts";
import { api, errorMessageKey } from "../lib/api";
import { fetchMe } from "../lib/session";

const { t } = useI18n();
const notify = useNotify();
const confirm = useConfirm();

const accounts = ref<AdminAccountDto[]>([]);
const loading = ref(true);
const meId = ref("");

const showCreate = ref(false);
const createForm = ref({ username: "", name: "", password: "" });
const busy = ref(false);

const resetTarget = ref<AdminAccountDto | null>(null);
const resetPassword = ref("");

onMounted(async () => {
  const me = await fetchMe().catch(() => null);
  meId.value = me?.id ?? "";
  await load();
});

async function load() {
  loading.value = true;
  try {
    const res = await api.get<{ accounts: AdminAccountDto[] }>("/admin/accounts");
    accounts.value = res.accounts;
  } catch (error) {
    notify.add({ severity: "error", detail: t(errorMessageKey(error)), life: 5000 });
  } finally {
    loading.value = false;
  }
}

function errorDetail(error: unknown): string {
  return t(errorMessageKey(error));
}

async function create() {
  if (busy.value) return;
  busy.value = true;
  try {
    await api.post("/admin/accounts", {
      username: createForm.value.username.trim(),
      name: createForm.value.name.trim(),
      password: createForm.value.password,
    });
    notify.add({ severity: "success", detail: t("admin.accounts.created"), life: 3000 });
    showCreate.value = false;
    createForm.value = { username: "", name: "", password: "" };
    await load();
  } catch (error) {
    notify.add({ severity: "error", detail: errorDetail(error), life: 5000 });
  } finally {
    busy.value = false;
  }
}

function openReset(account: AdminAccountDto) {
  resetTarget.value = account;
  resetPassword.value = "";
}

async function doReset() {
  const target = resetTarget.value;
  if (!target || busy.value) return;
  busy.value = true;
  try {
    await api.post(`/admin/accounts/${target.id}/reset-password`, { password: resetPassword.value });
    notify.add({ severity: "success", detail: t("admin.accounts.passwordReset"), life: 3000 });
    resetTarget.value = null;
  } catch (error) {
    notify.add({ severity: "error", detail: errorDetail(error), life: 5000 });
  } finally {
    busy.value = false;
  }
}

async function setDisabled(account: AdminAccountDto, disabled: boolean) {
  try {
    await api.post(`/admin/accounts/${account.id}/disabled`, { disabled });
    notify.add({
      severity: "success",
      detail: t(disabled ? "admin.accounts.accountDisabled" : "admin.accounts.accountEnabled"),
      life: 3000,
    });
    await load();
  } catch (error) {
    notify.add({ severity: "error", detail: errorDetail(error), life: 5000 });
  }
}

/** 停用需确认；启用直接执行。 */
function toggleDisabled(account: AdminAccountDto) {
  if (account.disabled) {
    setDisabled(account, false);
    return;
  }
  confirm.require({
    header: t("admin.accounts.disableConfirmHeader"),
    message: t("admin.accounts.disableConfirm", { name: account.name }),
    icon: TriangleAlert,
    acceptLabel: t("admin.accounts.disable"),
    rejectLabel: t("common.cancel"),
    accept: async () => {
      await setDisabled(account, true);
    },
  });
}
</script>

<template>
  <div>
    <PageHeader :title="t('admin.accounts.title')" :subtitle="t('admin.accounts.subtitle')" flush>
      <template #actions>
        <Button :label="t('admin.accounts.create')" :icon="Plus" @click="showCreate = true" />
      </template>
    </PageHeader>

    <div v-if="loading" class="tw:py-16 tw:text-center tw:text-muted">{{ t("common.loading") }}</div>
    <div
      v-else-if="accounts.length === 0"
      class="tw:mt-6 tw:rounded-2xl tw:border tw:border-dashed tw:border-line tw:bg-surface tw:p-12 tw:text-center tw:text-muted"
    >
      {{ t("admin.accounts.emptyHint") }}
    </div>

    <div v-else class="tw:mt-6 tw:rounded-2xl tw:border tw:border-line tw:bg-surface tw:px-6 tw:py-2">
      <div class="tw:divide-y tw:divide-line">
        <div
          v-for="account in accounts"
          :key="account.id"
          class="tw:flex tw:flex-wrap tw:items-center tw:gap-3 tw:py-3"
        >
          <span class="tw:font-mono tw:text-sm">{{ account.username }}</span>
          <span class="tw:font-semibold">{{ account.name }}</span>
          <span v-if="account.id === meId" class="tw:text-xs tw:text-faint">{{ t("admin.accounts.self") }}</span>
          <span
            v-if="account.role === 'super'"
            class="tw:rounded-md tw:bg-primary-50 tw:px-2 tw:py-0.5 tw:text-xs tw:font-medium tw:text-primary-700"
          >
            {{ t("admin.accounts.roleSuper") }}
          </span>
          <span
            v-else
            class="tw:rounded-md tw:bg-surface-muted tw:px-2 tw:py-0.5 tw:text-xs tw:text-muted"
          >
            {{ t("admin.accounts.roleAdmin") }}
          </span>
          <span
            v-if="account.disabled"
            class="tw:rounded-md tw:border tw:border-danger/40 tw:bg-danger/5 tw:px-2 tw:py-0.5 tw:text-xs tw:text-danger"
          >
            {{ t("admin.accounts.disabledTag") }}
          </span>
          <div class="tw:ml-auto tw:flex tw:flex-wrap tw:items-center tw:gap-1.5">
            <Button
              :label="t('admin.accounts.resetPassword')"
              :icon="KeyRound"
              severity="secondary"
              outlined
              @click="openReset(account)"
            />
            <Button
              :label="account.disabled ? t('admin.accounts.enable') : t('admin.accounts.disable')"
              :severity="account.disabled ? 'secondary' : 'danger'"
              text
              :disabled="account.id === meId"
              @click="toggleDisabled(account)"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- 新建管理员 -->
    <Dialog v-model:open="showCreate" modal :title="t('admin.accounts.createTitle')" width="min(26rem, 92vw)">
      <form class="tw:flex tw:flex-col tw:gap-3" @submit.prevent="create">
        <div>
          <label for="acc-username" class="tw:mb-1 tw:block tw:text-sm tw:font-medium">
            {{ t("admin.accounts.username") }}
          </label>
          <InputText v-model="createForm.username" input-id="acc-username" class="tw:w-full" autofocus fluid />
          <p class="tw:mt-1 tw:text-xs tw:text-faint">{{ t("admin.accounts.usernameHint") }}</p>
        </div>
        <div>
          <label for="acc-name" class="tw:mb-1 tw:block tw:text-sm tw:font-medium">
            {{ t("admin.accounts.name") }}
          </label>
          <InputText v-model="createForm.name" input-id="acc-name" class="tw:w-full" fluid />
        </div>
        <div>
          <label for="acc-password" class="tw:mb-1 tw:block tw:text-sm tw:font-medium">
            {{ t("admin.accounts.initialPassword") }}
          </label>
          <InputText
            v-model="createForm.password"
            type="password"
            input-id="acc-password"
            class="tw:w-full"
            autocomplete="new-password"
            fluid
          />
          <p class="tw:mt-1 tw:text-xs tw:text-faint">{{ t("admin.accounts.initialPasswordHint") }}</p>
        </div>
        <div class="tw:flex tw:justify-end tw:gap-2 tw:pt-1">
          <Button :label="t('common.cancel')" severity="secondary" text type="button" @click="showCreate = false" />
          <Button type="submit" :label="t('common.save')" :loading="busy" />
        </div>
      </form>
    </Dialog>

    <!-- 重置密码 -->
    <Dialog
      :open="resetTarget !== null"
      modal
      :title="t('admin.accounts.resetTitle', { name: resetTarget?.name ?? '' })"
      width="min(26rem, 92vw)"
      @update:open="(value) => { if (!value) resetTarget = null; }"
    >
      <form v-if="resetTarget" class="tw:flex tw:flex-col tw:gap-3" @submit.prevent="doReset">
        <div>
          <label for="acc-reset-password" class="tw:mb-1 tw:block tw:text-sm tw:font-medium">
            {{ t("admin.accounts.newPassword") }}
          </label>
          <InputText
            v-model="resetPassword"
            type="password"
            input-id="acc-reset-password"
            class="tw:w-full"
            autocomplete="new-password"
            autofocus
            fluid
          />
          <p class="tw:mt-1 tw:text-xs tw:text-faint">{{ t("admin.accounts.newPasswordHint") }}</p>
        </div>
        <div class="tw:flex tw:justify-end tw:gap-2 tw:pt-1">
          <Button :label="t('common.cancel')" severity="secondary" text type="button" @click="resetTarget = null" />
          <Button type="submit" :label="t('common.save')" :loading="busy" />
        </div>
      </form>
    </Dialog>
  </div>
</template>
