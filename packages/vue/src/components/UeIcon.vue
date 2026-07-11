<script setup lang="ts">
import { computed } from 'vue';
import { ICONS } from '../icons';

const props = defineProps<{ name: string; class?: string }>();

const body = computed(() => ICONS[props.name] ?? '');
</script>

<template>
  <svg :class="props.class || 'ue-ico'" viewBox="0 0 24 24" aria-hidden="true" v-html="body" />
</template>
