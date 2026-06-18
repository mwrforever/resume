/**
 * useFrameBatchedText：rAF 字符节拍器，解决"断断续续"。
 *
 * 后端 SSE chunk 可能突然 burst 出几十字；
 * 节拍器按指定 cps 匀速 setState，让 UI 维持稳定打字节奏。
 *
 * - block.stop 时调 flush() 立即吐完队列，避免"已完成但仍在打字"。
 * - 低端机 (dt > 50ms) 时动态提升每帧字符数。
 * - prefers-reduced-motion 模式下 cps 提升到 300（近即时）。
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export interface UseFrameBatchedTextOptions {
  cps?: number;
}

export interface UseFrameBatchedTextResult {
  displayed: string;
  flush: () => void;
  pending: number;
}

export function useFrameBatchedText(
  targetText: string,
  options: UseFrameBatchedTextOptions = {},
): UseFrameBatchedTextResult {
  const baseCps = options.cps ?? 80;
  const prefersReducedMotion = typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const cps = prefersReducedMotion ? 300 : baseCps;

  const [displayed, setDisplayed] = useState('');
  const queueRef = useRef('');
  const rafRef = useRef<number | null>(null);
  const lastTickRef = useRef(0);

  useEffect(() => {
    const have = displayed.length + queueRef.current.length;
    if (targetText.length > have) {
      queueRef.current += targetText.slice(have);
    }
    if (rafRef.current !== null) return;
    const tick = (now: number) => {
      const dt = lastTickRef.current ? now - lastTickRef.current : 16;
      lastTickRef.current = now;
      // dt > 50ms：低端机 / 后台标签页；动态提升每帧字符数避免堆积
      const effectiveCps = dt > 50 ? cps * 2.5 : cps;
      const chars = Math.max(1, Math.round((effectiveCps * dt) / 1000));
      if (queueRef.current.length > 0) {
        const take = queueRef.current.slice(0, chars);
        queueRef.current = queueRef.current.slice(chars);
        setDisplayed(prev => prev + take);
        rafRef.current = requestAnimationFrame(tick);
      } else {
        rafRef.current = null;
        lastTickRef.current = 0;
      }
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [targetText, displayed.length, cps]);

  const flush = useCallback(() => {
    if (queueRef.current.length === 0) return;
    setDisplayed(prev => prev + queueRef.current);
    queueRef.current = '';
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      lastTickRef.current = 0;
    }
  }, []);

  useEffect(() => () => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
  }, []);

  return { displayed, flush, pending: queueRef.current.length };
}
