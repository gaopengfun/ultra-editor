<script setup lang="ts">
import UeMenu from './UeMenu.vue';
import UeIcon from './UeIcon.vue';
import type { ImageAlign, Translator } from '@ultra-editor/core';

defineProps<{
  visible: boolean;
  x: number;
  y: number;
  align: ImageAlign | null;
  hasCaption: boolean;
  t: Translator;
}>();

const emit = defineEmits<{
  (e: 'rotate', degrees: 90 | -90): void;
  (e: 'crop'): void;
  (e: 'align', value: ImageAlign): void;
  (e: 'caption'): void;
  (e: 'close'): void;
}>();

const ALIGNMENTS: Array<{ value: ImageAlign; icon: string; key: 'left' | 'center' | 'right' }> = [
  { value: 'left', icon: 'alignLeft', key: 'left' },
  { value: 'center', icon: 'alignCenter', key: 'center' },
  { value: 'right', icon: 'alignRight', key: 'right' }
];

const LABEL = {
  left: 'image.alignLeft',
  center: 'image.alignCenter',
  right: 'image.alignRight'
} as const;

function pick(action: () => void) {
  action();
  emit('close');
}
</script>

<template>
  <UeMenu
    :visible="visible"
    :x="x"
    :y="y"
    :label="t('toolbar.image')"
    @close="emit('close')"
  >
    <button type="button" class="ue-menu__item" role="menuitem" @click="pick(() => emit('rotate', 90))">
      <UeIcon name="rotateCw" />
      <span class="ue-menu__label">{{ t('image.rotateCw') }}</span>
    </button>
    <button
      type="button"
      class="ue-menu__item"
      role="menuitem"
      @click="pick(() => emit('rotate', -90))"
    >
      <UeIcon name="rotateCcw" />
      <span class="ue-menu__label">{{ t('image.rotateCcw') }}</span>
    </button>
    <button type="button" class="ue-menu__item" role="menuitem" @click="pick(() => emit('crop'))">
      <UeIcon name="crop" />
      <span class="ue-menu__label">{{ t('image.crop') }}</span>
    </button>

    <div class="ue-menu__divider" role="separator" />

    <button
      v-for="option in ALIGNMENTS"
      :key="option.value"
      type="button"
      class="ue-menu__item"
      role="menuitemradio"
      :aria-checked="align === option.value"
      :class="{ 'is-active': align === option.value }"
      @click="pick(() => emit('align', option.value))"
    >
      <UeIcon :name="option.icon" />
      <span class="ue-menu__label">{{ t(LABEL[option.key]) }}</span>
      <UeIcon v-if="align === option.value" name="check" class="ue-menu__check" />
    </button>

    <div class="ue-menu__divider" role="separator" />

    <button type="button" class="ue-menu__item" role="menuitem" @click="pick(() => emit('caption'))">
      <UeIcon name="caption" />
      <span class="ue-menu__label">
        {{ hasCaption ? t('image.editCaption') : t('image.addCaption') }}
      </span>
    </button>
  </UeMenu>
</template>
