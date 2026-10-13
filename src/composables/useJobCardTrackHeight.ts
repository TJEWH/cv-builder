import { onBeforeUnmount, ref, watchPostEffect, type Ref } from 'vue';

/** Size a mobile list's vertical scroll area to its current card only. */
export function useJobCardTrackHeight(root: Ref<HTMLElement | null>, active: () => boolean) {
  const viewport = window.matchMedia('(max-width: 760px)');
  const mobile = ref(viewport.matches);
  const onViewportChange = () => { mobile.value = viewport.matches; };
  viewport.addEventListener('change', onViewportChange);
  onBeforeUnmount(() => viewport.removeEventListener('change', onViewportChange));

  watchPostEffect(onCleanup => {
    const container = root.value;
    if (!container || !mobile.value || !active()) return;
    let frame = 0;
    const observed = new Set<HTMLElement>();
    const sizedTracks = new Set<HTMLElement>();
    const resize = new ResizeObserver(schedule);

    function update() {
      frame = 0;
      const cardsToObserve = new Set<HTMLElement>();
      for (const track of container!.querySelectorAll<HTMLElement>('.jobs-card-track')) {
        const cards = [...track.querySelectorAll<HTMLElement>('.jobs-result-row')];
        cards.forEach(card => cardsToObserve.add(card));
        if (!cards.length || !track.getClientRects().length) continue;
        const style = getComputedStyle(track);
        const start = track.getBoundingClientRect().left + (parseFloat(style.scrollPaddingLeft) || 0);
        const current = cards.reduce((nearest, card, index) =>
          Math.abs(card.getBoundingClientRect().left - start) < Math.abs(cards[nearest].getBoundingClientRect().left - start) ? index : nearest, 0);
        const height = cards[current].getBoundingClientRect().height
          + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
        const value = `${Math.ceil(height)}px`;
        if (track.style.getPropertyValue('--jobs-card-track-height') !== value) track.style.setProperty('--jobs-card-track-height', value);
        sizedTracks.add(track);
      }
      for (const card of observed) {
        if (!cardsToObserve.has(card)) { resize.unobserve(card); observed.delete(card); }
      }
      for (const card of cardsToObserve) {
        if (!observed.has(card)) { resize.observe(card); observed.add(card); }
      }
    }
    function schedule() { if (!frame) frame = requestAnimationFrame(update); }

    const mutations = new MutationObserver(schedule);
    mutations.observe(container, { childList: true, characterData: true, subtree: true });
    resize.observe(container);
    container.addEventListener('scroll', schedule, { capture: true, passive: true });
    update();
    onCleanup(() => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      mutations.disconnect();
      container.removeEventListener('scroll', schedule, true);
      sizedTracks.forEach(track => track.style.removeProperty('--jobs-card-track-height'));
    });
  });
}
