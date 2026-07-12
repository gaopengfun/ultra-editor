<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import UeIcon from './UeIcon.vue';
import type { AIController } from '../composables/useAi';
import type { MessageKey, Translator } from '@ultra-editor/core';

const props = defineProps<{ controller: AIController; t: Translator }>();

const input = ref<HTMLInputElement>();
const state = computed(() => props.controller.state);

// Escape dismisses the panel from any phase. The prompt input owns it while
// shown (it also stops the keystroke reaching the document), so only the
// running / done / error phases need a global handler.
const onKey = (event: KeyboardEvent) => {
  if (event.key !== 'Escape' || state.value.phase === 'prompt') return;
  event.preventDefault();
  props.controller.discard();
};

watch(
  () => state.value.open,
  (open) => {
    if (open) window.addEventListener('keydown', onKey, true);
    else window.removeEventListener('keydown', onKey, true);
  }
);

onBeforeUnmount(() => window.removeEventListener('keydown', onKey, true));

const TASK_LABEL: Record<string, MessageKey> = {
  continue: 'ai.continue',
  write: 'ai.write',
  improve: 'ai.improve',
  translate: 'ai.translate',
  summarize: 'ai.summarize',
  rewrite: 'ai.rewrite',
  expand: 'ai.expand',
  shorten: 'ai.shorten',
  fixGrammar: 'ai.fixGrammar',
  changeTone: 'ai.changeTone',
  custom: 'ai.custom'
};

const title = computed(() => props.t(TASK_LABEL[state.value.task] ?? 'toolbar.ai'));

const promptPlaceholder = computed(() =>
  state.value.task === 'write' ? props.t('ai.writePlaceholder') : props.t('ai.customPlaceholder')
);

watch(
  () => state.value.phase,
  async (phase) => {
    if (phase !== 'prompt') return;
    await nextTick();
    input.value?.focus();
  }
);
</script>

<template>
  <Teleport to="body">
    <div
      v-if="state.open"
      class="ue-ai-panel"
      :style="{ left: state.anchor.x + 'px', top: state.anchor.y + 'px' }"
      role="dialog"
      :aria-label="title"
    >
      <header class="ue-ai-panel__head">
        <span v-if="state.phase === 'running'" class="ue-ai-panel__spinner" />
        <UeIcon v-else name="ai" />
        <span>{{ state.phase === 'running' ? t('ai.generating') : title }}</span>
      </header>

      <div v-if="state.phase === 'prompt'" class="ue-ai-panel__prompt">
        <input
          ref="input"
          v-model="state.instruction"
          class="ue-input"
          :placeholder="promptPlaceholder"
          @keydown.enter.prevent="controller.submit()"
          @keydown.esc.prevent="controller.discard()"
        />
        <button
          type="button"
          class="ue-btn ue-btn--primary"
          :disabled="!state.instruction.trim()"
          @click="controller.submit()"
        >
          {{ t('common.confirm') }}
        </button>
      </div>

      <p v-else-if="state.phase === 'error'" class="ue-ai-panel__error">
        {{ state.error || t('ai.failed') }}
      </p>

      <div
        v-else-if="state.mode === 'transform'"
        class="ue-ai-panel__body"
        :data-empty="t('ai.generating')"
      >
        {{ state.text }}
      </div>

      <footer v-if="state.phase !== 'prompt'" class="ue-ai-panel__foot">
        <template v-if="state.phase === 'running'">
          <button type="button" class="ue-btn" @click="controller.stop()">
            <UeIcon name="stop" />
            {{ t('ai.stop') }}
          </button>
          <span class="ue-ai-panel__spacer" />
          <button type="button" class="ue-btn" @click="controller.discard()">
            {{ t('ai.discard') }}
          </button>
        </template>

        <template v-else>
          <button type="button" class="ue-btn" @click="controller.retry()">
            {{ t('ai.retry') }}
          </button>
          <span class="ue-ai-panel__spacer" />
          <button type="button" class="ue-btn" @click="controller.discard()">
            {{ t('ai.discard') }}
          </button>

          <template v-if="state.phase === 'done'">
            <button
              v-if="state.mode === 'transform'"
              type="button"
              class="ue-btn"
              @click="controller.accept('below')"
            >
              {{ t('ai.insertBelow') }}
            </button>
            <button
              type="button"
              class="ue-btn ue-btn--primary"
              @click="controller.accept('replace')"
            >
              {{ state.mode === 'transform' ? t('ai.replace') : t('ai.accept') }}
            </button>
          </template>
        </template>
      </footer>
    </div>
  </Teleport>
</template>
