<script setup lang="ts">
import { ref, watch } from "vue";
import { useI18n } from "vue-i18n";

import { Button, Dialog, InputText, useNotify } from "@mango-write/ui";

import { api, errorMessageKey } from "../lib/api";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ "update:open": [value: boolean] }>();
const { t } = useI18n();
const notify = useNotify();

const currentPassword = ref("");
const newPassword = ref("");
const confirmPassword = ref("");
const busy = ref(false);

watch(
  () => props.open,
  (open) => {
    if (open) {
      currentPassword.value = "";
      newPassword.value = "";
      confirmPassword.value = "";
      busy.value = false;
    }
  },
);

async function submit() {
  if (busy.value) return;
  if (newPassword.value !== confirmPassword.value) {
    notify.add({ severity: "warn", detail: t("admin.changePassword.mismatch"), life: 4000 });
    return;
  }
  busy.value = true;
  try {
    await api.post("/admin/account/password", {
      currentPassword: currentPassword.value,
      newPassword: newPassword.value,
    });
    notify.add({ severity: "success", detail: t("admin.changePassword.success"), life: 4000 });
    emit("update:open", false);
  } catch (error) {
    notify.add({ severity: "error", detail: t(errorMessageKey(error)), life: 5000 });
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <Dialog
    :open="props.open"
    modal
    :title="t('admin.changePassword.title')"
    width="min(24rem, 92vw)"
    @update:open="(value) => emit('update:open', value)"
  >
    <form class="tw:flex tw:flex-col tw:gap-3" @submit.prevent="submit">
      <div>
        <label for="cp-current" class="tw:mb-1 tw:block tw:text-sm tw:font-medium">
          {{ t("admin.changePassword.currentPassword") }}
        </label>
        <InputText
          v-model="currentPassword"
          type="password"
          input-id="cp-current"
          class="tw:w-full"
          autocomplete="current-password"
          fluid
        />
      </div>
      <div>
        <label for="cp-new" class="tw:mb-1 tw:block tw:text-sm tw:font-medium">
          {{ t("admin.changePassword.newPassword") }}
        </label>
        <InputText
          v-model="newPassword"
          type="password"
          input-id="cp-new"
          class="tw:w-full"
          autocomplete="new-password"
          fluid
        />
        <p class="tw:mt-1 tw:text-xs tw:text-faint">{{ t("admin.changePassword.newPasswordHint") }}</p>
      </div>
      <div>
        <label for="cp-confirm" class="tw:mb-1 tw:block tw:text-sm tw:font-medium">
          {{ t("admin.changePassword.confirmPassword") }}
        </label>
        <InputText
          v-model="confirmPassword"
          type="password"
          input-id="cp-confirm"
          class="tw:w-full"
          autocomplete="new-password"
          fluid
        />
      </div>
      <div class="tw:flex tw:justify-end tw:gap-2 tw:pt-1">
        <Button :label="t('common.cancel')" severity="secondary" text type="button" @click="emit('update:open', false)" />
        <Button type="submit" :label="t('admin.changePassword.submit')" :loading="busy" />
      </div>
    </form>
  </Dialog>
</template>
