// Never use scrollIntoView here: it also scrolls ancestors on mobile Safari.
// Restoring a row must move only the inventory list, not the app or page.
export function restoreCountScroll(scroller: HTMLElement | null | undefined, target?: HTMLElement | null) {
  if (!scroller) return;
  const top = target
    ? scroller.scrollTop + target.getBoundingClientRect().top - scroller.getBoundingClientRect().top - (scroller.clientHeight - target.getBoundingClientRect().height) / 2
    : 0;
  scroller.scrollTo({ top: Math.max(0, Math.min(top, scroller.scrollHeight - scroller.clientHeight)), behavior: "instant" });
}
