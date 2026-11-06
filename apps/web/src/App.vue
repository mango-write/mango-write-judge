<script setup lang="ts">
import { ConfirmHost, ToastHost } from "@mango-write/ui";
</script>

<template>
  <router-view />
  <ToastHost position="top-right" />
  <ConfirmHost />
</template>
