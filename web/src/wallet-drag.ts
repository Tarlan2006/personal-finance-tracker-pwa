import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { flushSync } from 'react-dom';

// Preview the move with transforms. The profile and DOM order change only on drop.
export function useWalletDrag(version: number | undefined, disabled: boolean) {
  const stack = useRef<HTMLDivElement>(null);
  const cleanup = useRef<() => void>();
  const suppressClick = useRef(false);

  useEffect(() => () => cleanup.current?.(), [version, disabled]);

  function start(event: ReactPointerEvent<HTMLElement>, handle: boolean, drop: (to: number) => void) {
    if (disabled || !event.isPrimary || event.button !== 0 || !stack.current) return;
    cleanup.current?.();
    suppressClick.current = false;
    const surface = event.currentTarget;
    const container = stack.current;
    const cards = Array.from(container.children) as HTMLElement[];
    const card = surface.closest<HTMLElement>('.wallet-card')!;
    const from = cards.indexOf(card);
    const { pointerId, clientX, clientY } = event;
    let y = clientY, frame = 0, timer = 0, active = false, to = from;
    let startScroll = 0, origin = 0, height = 0;
    let previousOffset = NaN;
    let centers: number[] = [];

    function preview() {
      const dy = y - clientY + window.scrollY - startScroll;
      if (dy === previousOffset) return;
      previousOffset = dy;
      const center = origin + dy;
      const previousSlot = to;
      to = from;
      while (to + 1 < cards.length && center > centers[to + 1]) to++;
      while (to > 0 && center < centers[to - 1]) to--;
      card.style.setProperty('--shift', dy + 'px');
      if (to === previousSlot) return;
      cards.forEach((node, i) => {
        if (i === from) return;
        const shift = from < i && i <= to ? -height : to <= i && i < from ? height : 0;
        node.style.setProperty('--shift', shift + 'px');
      });
    }
    function paint() {
      const edge = 72;
      const speed = y < edge ? y - edge : Math.max(0, y - innerHeight + edge);
      if (speed) window.scrollBy(0, Math.sign(speed) * Math.min(14, Math.ceil(Math.abs(speed) / 5)));
      preview();
      frame = requestAnimationFrame(paint);
    }
    function lift() {
      active = true;
      suppressClick.current = true;
      surface.setPointerCapture(pointerId);
      startScroll = window.scrollY;
      centers = cards.map(node => { const r = node.getBoundingClientRect(); return r.top + r.height / 2; });
      origin = centers[from];
      height = card.offsetHeight + parseFloat(getComputedStyle(container).rowGap);
      container.dataset.dragging = '';
      card.dataset.lifted = '';
      navigator.vibrate?.(10);
      paint();
    }
    function move(e: PointerEvent) {
      if (e.pointerId !== pointerId) return;
      y = e.clientY;
      if (!active && Math.hypot(e.clientX - clientX, y - clientY) > 8) finish();
    }
    function touchMove(e: TouchEvent) {
      // A normal swipe before the hold threshold keeps native page scrolling.
      if (active && e.cancelable) e.preventDefault();
    }
    function finish(commit = false) {
      clearTimeout(timer);
      cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('touchmove', touchMove, true);
      window.removeEventListener('blur', cancel);
      window.removeEventListener('keydown', key);
      surface.removeEventListener('lostpointercapture', cancel);
      cleanup.current = undefined;
      if (!active) return;
      const before = cards.map(node => node.getBoundingClientRect().top);
      delete container.dataset.dragging;
      delete card.dataset.lifted;
      cards.forEach(node => node.style.removeProperty('--shift'));
      if (surface.hasPointerCapture(pointerId)) surface.releasePointerCapture(pointerId);
      if (commit && from !== to) flushSync(() => drop(to));
      if (commit && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
        cards.forEach((node, i) => {
          const dy = before[i] - node.getBoundingClientRect().top;
          if (Math.abs(dy) > 1) node.animate([{transform:`translateY(${dy}px)`}, {transform:'none'}], {duration:220,easing:'ease-out'});
        });
      }
      // The synthetic click following pointerup belongs to the drag.
      window.setTimeout(() => { suppressClick.current = false; }, 0);
    }
    function up(e: PointerEvent) {
      if (e.pointerId !== pointerId) return;
      if (active) { y = e.clientY; preview(); }
      finish(true);
    }
    function cancel() { finish(); }
    function key(e: KeyboardEvent) { if (e.key === 'Escape') finish(); }
    cleanup.current = cancel;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('touchmove', touchMove, {passive:false,capture:true});
    window.addEventListener('blur', cancel);
    window.addEventListener('keydown', key);
    surface.addEventListener('lostpointercapture', cancel);
    if (handle) lift();
    else timer = window.setTimeout(lift, 350);
  }

  return { stack, start, suppressClick };
}
