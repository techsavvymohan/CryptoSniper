'use client';

import { useEffect, useRef } from 'react';

const GLYPHS = '$◎SOLUSDC₿+-%0123456789bpsARBJITO'.split('');

interface Column {
  x: number;
  y: number;
  speed: number;
  chars: string[];
  hue: number;
}

export function MoneyRainMatrix() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationId = 0;
    let columns: Column[] = [];
    const fontSize = 16;
    let width = 0;
    let height = 0;

    const randomGlyph = () => GLYPHS[Math.floor(Math.random() * GLYPHS.length)]!;

    const initColumns = () => {
      const columnCount = Math.ceil(width / fontSize);
      columns = Array.from({ length: columnCount }, (_, i) => ({
        x: i * fontSize,
        y: Math.random() * height,
        speed: 0.4 + Math.random() * 1.2,
        chars: Array.from({ length: 24 }, randomGlyph),
        hue: Math.random() > 0.35 ? 155 : 270, // Solana green or purple
      }));
    };

    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width;
      canvas.height = height;
      initColumns();
    };

    const draw = () => {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.08)';
      ctx.fillRect(0, 0, width, height);

      ctx.font = `bold ${fontSize}px "Courier New", monospace`;

      for (const col of columns) {
        const headIndex = Math.floor(col.y / fontSize) % col.chars.length;
        const trailLength = 18;

        for (let t = 0; t < trailLength; t++) {
          const charIndex = (headIndex - t + col.chars.length) % col.chars.length;
          const char = col.chars[charIndex]!;
          const y = col.y - t * fontSize;

          if (y < -fontSize || y > height + fontSize) continue;

          if (t === 0) {
            ctx.fillStyle = col.hue === 155 ? '#14F195' : '#9945FF';
            ctx.shadowColor = ctx.fillStyle;
            ctx.shadowBlur = 12;
          } else {
            const alpha = Math.max(0, 1 - t / trailLength);
            const color = col.hue === 155
              ? `rgba(20, 241, 149, ${alpha * 0.55})`
              : `rgba(153, 69, 255, ${alpha * 0.55})`;
            ctx.fillStyle = color;
            ctx.shadowBlur = 0;
          }

          ctx.fillText(char, col.x, y);
        }

        col.y += col.speed * fontSize * 0.12;

        if (col.y > height + fontSize * trailLength) {
          col.y = -Math.random() * height * 0.3;
          col.chars = Array.from({ length: 24 }, randomGlyph);
          col.hue = Math.random() > 0.35 ? 155 : 270;
          col.speed = 0.4 + Math.random() * 1.2;
        }
      }

      ctx.shadowBlur = 0;
      animationId = requestAnimationFrame(draw);
    };

    resize();
    draw();

    window.addEventListener('resize', resize);

    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="fixed inset-0 z-0 pointer-events-none opacity-70"
    />
  );
}
