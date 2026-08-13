<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import UeDialog from './UeDialog.vue';
import type { PromptController } from '../composables/usePrompt';
import type { Translator } from '@ultra-editor/core/lean';

let promptSeq = 0;

const props = defineProps<{ controller: PromptController; t: Translator }>();

const input = ref<HTMLInputElement>();
const inputId = `ue-prompt-input-${(promptSeq += 1)}`;

watch(
  () => props.controller.state.visible,
  async (open) => {
    if (!open) return;
    await nextTick();
    input.value?.focus();
    input.value?.select();
  }
);
</script>

<template>
  <UeDialog
    :model-value="controller.state.visible"
    :title="controller.state.title"
    :close-label="t('common.close')"
    width="420px"
    @update:model-value="controller.cancel()"
  >
    <label class="ue-field__label" :for="inputId">{{ controller.state.label }}</label>
    <input
      :id="inputId"
      ref="input"
      v-model="controller.state.input"
      class="ue-input"
      :class="{ 'ue-input--error': controller.state.error }"
      :placeholder="controller.state.placeholder"
      @keydown.enter.prevent="controller.confirm()"
      @input="controller.state.error = null"
    />
    <p v-if="controller.state.error" class="ue-field__error">{{ controller.state.error }}</p>

    <template #footer>
      <button type="button" class="ue-btn" @click="controller.cancel()">
        {{ t('common.cancel') }}
      </button>
      <button type="button" class="ue-btn ue-btn--primary" @click="controller.confirm()">
        {{ t('common.confirm') }}
      </button>
    </template>
  </UeDialog>
</template>
