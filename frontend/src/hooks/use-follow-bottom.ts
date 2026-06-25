/**
 * useFollowBottom：流式中智能粘附滚动。
 *
 * - 用户已在底部 48px 内 → 新内容到达时自动滚到底部
 * - 用户上滚阅读历史 → 不被拽回
 * - 流式期间用 instant；结束后调用方可显式 smooth 对齐
 */

import { useCallback, useEffect, useRef } from 'react';

const FOLLOW_THRESHOLD_PX = 48;

export interface UseFollowBottomResult {
  ref: React.RefObject<HTMLDivElement | null>;
  followIfNeeded: () => void;
  forceSmoothToBottom: () => void;
}

export function useFollowBottom(): UseFollowBottomResult {
  const ref = useRef<HTMLDivElement | null>(null);
  const followingRef = useRef(true);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onScroll = () => {
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      followingRef.current = distance < FOLLOW_THRESHOLD_PX;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  const followIfNeeded = useCallback(() => {
    const el = ref.current;
    if (!el || !followingRef.current) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'instant' as ScrollBehavior });
  }, []);

  const forceSmoothToBottom = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, []);

  return { ref, followIfNeeded, forceSmoothToBottom };
}
