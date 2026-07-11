<script setup lang="ts">
import type { Toast } from '../composables/useToasts';

defineProps<{ toasts: Toast[] }>();
</script>

<template>
  <Teleport to="body">
    <div v-if="toasts.length" class="ue-toasts" role="status" aria-live="polite">
      <div
        v-for="toast in toasts"
        :key="toast.id"
        class="ue-toast"
        :class="`ue-toast--${toast.kind}`"
      >
        {{ toast.message }}
      </div>
    </div>
  </Teleport>
</template>
