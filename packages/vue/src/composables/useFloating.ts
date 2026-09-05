import { nextTick, onBeforeUnmount, ref, watch, type Ref } from 'vue';

export interface FloatingAnchor {
  x: number;
  y: number;
}

/**
 * Nudge a measured box back inside the viewport.
 *
 * Takes the box's real size rather than an assumed one: surfaces here grow with
 * their contents — the slash palette gains a whole group when an AI provider is
 * wired up — so a constant guessed at the call site is wrong for half the states
 * the surface can be in, and wrong silently.
 */
export function clampToViewport(
  anchor: FloatingAnchor,
  rect: { width: number; height: number },
  gap = 8
): { left: number; top: number } {
  let left = anchor.x;
  let top = anchor.y;
  if (left + rect.width + gap > window.innerWidth) {
    left = Math.max(gap, window.innerWidth - rect.width - gap);
  }
  if (top + rect.height + gap > window.innerHeight) {
    top = Math.max(gap, window.innerHeight - rect.height - gap);
  }
  return { left, top };
}

/**
 * Position a floating element at a viewport point, clamped inside the viewport,
 * and close it on the usual escape hatches.
 *
 * The listeners bind a frame late on purpose: opening a menu from a `mousedown`
 * would otherwise see that very event bubble to `window` and close it again.
 */
export function useFloating(
  visible: Ref<boolean>,
  anchor: Ref<FloatingAnchor>,
  close: () => void,
  options: { closeOnScroll?: boolean } = {}
) {
  const element = ref<HTMLElement>();
  const position = ref({ left: 0, top: 0 });

  async function place() {
    position.value = { left: anchor.value.x, top: anchor.value.y };
    await nextTick();

    const el = element.value;
    if (!el) return;

    position.value = clampToViewport(anchor.value, el.getBoundingClientRect());
  }

  // A flyout opened *from* a floating surface (the table menu's colour panel) is
  // teleported to <body> too, so `contains` reports it as "outside" and both the
  // click-away and the Escape would close the surface underneath it. Treat any
  // event that originates inside a flyout as belonging to whoever opened it: the
  // flyout closes itself, its opener stays put.
  const inFlyout = (event: Event) => {
    const target = event.target as HTMLElement | null;
    const flyout = target?.closest?.('[data-ue-flyout]');
    return !!flyout && flyout !== element.value;
  };

  const onPointerDown = (event: MouseEvent) => {
    if (element.value && !element.value.contains(event.target as Node) && !inFlyout(event)) close();
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && !inFlyout(event)) close();
  };

  let frame = 0;

  function bind() {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      window.addEventListener('mousedown', onPointerDown, true);
      window.addEventListener('keydown', onKey, true);
      window.addEventListener('resize', close);
      if (options.closeOnScroll !== false) window.addEventListener('scroll', close, true);
    });
  }

  function unbind() {
    cancelAnimationFrame(frame);
    window.removeEventListener('mousedown', onPointerDown, true);
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', close);
    window.removeEventListener('scroll', close, true);
  }

  watch(visible, (open) => {
    if (open) {
      void place();
      bind();
    } else {
      unbind();
    }
  });

  watch(anchor, () => {
    if (visible.value) void place();
  });

  onBeforeUnmount(unbind);

  return { element, position, place };
}
