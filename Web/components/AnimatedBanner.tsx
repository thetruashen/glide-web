'use client';
import { useEffect, useRef, useState } from 'react';
const BASE = process.env.NEXT_PUBLIC_BASE_PATH || '';
export default function AnimatedBanner() {
  const video = useRef<HTMLVideoElement>(null);
  const [enabled, setEnabled] = useState(false);
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setEnabled(!motion.matches && !(navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData);
    update(); motion.addEventListener('change', update);
    const observer = new IntersectionObserver(entries => setVisible(entries[0].isIntersecting));
    if (video.current) observer.observe(video.current);
    return () => { observer.disconnect(); motion.removeEventListener('change', update); };
  }, []);
  useEffect(() => {
    const update = () => { if (enabled && visible && !document.hidden) void video.current?.play().catch(() => {}); else video.current?.pause(); };
    update(); document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, [enabled, visible]);
  return <><video className="banner-video" ref={video} src={enabled ? `${BASE}/banner.mp4` : undefined} poster={`${BASE}/banner-poster.jpg`} muted loop playsInline preload="none" aria-hidden="true"/><button className="animation-control" onClick={() => setEnabled(!enabled)} aria-label={enabled ? 'Pause banner animation' : 'Play banner animation'}>{enabled ? 'Ⅱ Pause animation' : '▶ Play animation'}</button></>;
}
