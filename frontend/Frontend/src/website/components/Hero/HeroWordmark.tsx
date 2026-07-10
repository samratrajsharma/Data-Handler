import React, { useEffect, useRef } from 'react';
import './HeroWordmark.css';

// Full-section node field: a green constellation fills the whole hero (long
// connecting lines, like the original ambient web), and "ORCHESTRATY" is
// formed LARGE inside a reserved slot — its letter dots linked by a fine mesh
// so the word stays crisp, and bridged into the surrounding constellation so
// it's one fabric. One canvas (no second background layer), reacts to the
// cursor everywhere and scatters / reforms on click.

interface Dot {
  x: number; y: number; vx: number; vy: number;
  tx: number; ty: number; bvx: number; bvy: number; bound: boolean;
  r: number; c: [number, number, number]; ph: number; lit: number;
}

interface Slot { x: number; y: number; w: number; h: number; }

const GREENS: [number, number, number][] = [
  [29, 185, 84], [30, 215, 96], [74, 222, 128], [34, 211, 153],
];
const LIT: [number, number, number] = [30, 215, 96];

const HeroWordmark: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const DPR = Math.min(window.devicePixelRatio || 1, 1.5);
    let W = 0;
    let H = 0;
    let dots: Dot[] = [];
    let freeList: Dot[] = [];
    const ripples: { x: number; y: number; r: number; max: number }[] = [];
    const mouse = { x: -9999, y: -9999, active: false };
    let raf = 0;
    let rt = 0;

    const SP = 0.35;
    const MR = 160;          // cursor influence radius
    const CD = 34;           // bridge link distance (word <-> constellation) = grid cell
    const CD2 = CD * CD;
    const WD = 18;           // fine letter link distance
    const WD2 = WD * WD;
    const FD = 125;          // constellation web link distance (free <-> free)
    const FD2 = FD * FD;

    const size = () => {
      W = canvas.clientWidth;
      H = canvas.clientHeight;
      canvas.width = W * DPR;
      canvas.height = H * DPR;
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    };

    const readSlot = (): Slot => {
      const el = document.getElementById('hero-wordslot');
      if (el) {
        const rb = el.getBoundingClientRect();
        const cb = canvas.getBoundingClientRect();
        if (rb.width > 40 && rb.height > 20) {
          return { x: rb.left - cb.left, y: rb.top - cb.top, w: rb.width, h: rb.height };
        }
      }
      return { x: W * 0.07, y: H * 0.34, w: W * 0.86, h: H * 0.24 };
    };

    const sample = (slot: Slot): Array<[number, number]> => {
      const oc = document.createElement('canvas');
      oc.width = W;
      oc.height = H;
      const o = oc.getContext('2d');
      if (!o) return [];
      const txt = 'ORCHESTRATY';
      const base = 200;
      o.font = '800 ' + base + 'px Montserrat, Arial, sans-serif';
      const wt = o.measureText(txt).width || base * 6;
      const f = Math.max(22, base * Math.min((slot.w * 0.96) / wt, (slot.h * 0.92) / base));
      o.font = '800 ' + f + 'px Montserrat, Arial, sans-serif';
      o.textAlign = 'center';
      o.textBaseline = 'middle';
      o.fillStyle = '#fff';
      o.fillText(txt, slot.x + slot.w / 2, slot.y + slot.h / 2);
      const data = o.getImageData(0, 0, W, H).data;
      const step = Math.max(2, Math.round(slot.w / 380));
      const pts: Array<[number, number]> = [];
      const y0 = Math.max(0, (slot.y - 30) | 0);
      const y1 = Math.min(H, (slot.y + slot.h + 30) | 0);
      for (let y = y0; y < y1; y += step) {
        for (let x = 0; x < W; x += step) {
          if (data[(y * W + x) * 4 + 3] > 130) pts.push([x, y]);
        }
      }
      const CAP = 780;
      if (pts.length > CAP) {
        const keep: Array<[number, number]> = [];
        const s = pts.length / CAP;
        for (let i = 0; i < CAP; i++) keep.push(pts[(i * s) | 0]);
        return keep;
      }
      return pts;
    };

    const mkFree = (): Dot => {
      const vx = (Math.random() - 0.5) * SP;
      const vy = (Math.random() - 0.5) * SP;
      const g = GREENS[(Math.random() * GREENS.length) | 0];
      return {
        x: Math.random() * W, y: Math.random() * H, vx, vy,
        tx: 0, ty: 0, bvx: vx, bvy: vy, bound: false,
        r: Math.random() * 0.9 + 1.0, c: g, ph: Math.random() * 6.28, lit: 0,
      };
    };

    const build = () => {
      size();
      const slot = readSlot();
      dots = sample(slot).map((t): Dot => {
        const g = GREENS[(Math.random() * GREENS.length) | 0];
        return {
          x: Math.random() * W, y: Math.random() * H, vx: 0, vy: 0,
          tx: t[0], ty: t[1], bvx: 0, bvy: 0, bound: true,
          r: Math.random() * 0.8 + 1.5, c: g, ph: Math.random() * 6.28, lit: 0,
        };
      });
      freeList = [];
      const freeN = Math.max(60, Math.min(170, ((W * H) / 8500) | 0));
      for (let i = 0; i < freeN; i++) {
        const fd = mkFree();
        dots.push(fd);
        freeList.push(fd);
      }
    };

    const inRect = (x: number, y: number) => x > -60 && x < W + 60 && y > -60 && y < H + 60;
    const onMove = (e: MouseEvent) => {
      const b = canvas.getBoundingClientRect();
      mouse.x = e.clientX - b.left;
      mouse.y = e.clientY - b.top;
      mouse.active = inRect(mouse.x, mouse.y);
    };
    const onDown = (e: PointerEvent) => {
      const b = canvas.getBoundingClientRect();
      const cx = e.clientX - b.left;
      const cy = e.clientY - b.top;
      if (!inRect(cx, cy)) return;
      ripples.push({ x: cx, y: cy, r: 0, max: Math.max(W, H) * 1.3 });
      for (const p of dots) {
        const dx = p.x - cx;
        const dy = p.y - cy;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        const f = Math.min(16, 2400 / (d + 50));
        p.vx += (dx / d) * f + (Math.random() - 0.5) * 5;
        p.vy += (dy / d) * f + (Math.random() - 0.5) * 5;
        p.lit = 1;
      }
    };
    const onResize = () => {
      window.clearTimeout(rt);
      rt = window.setTimeout(build, 160);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('resize', onResize);

    const t0 = performance.now();
    const frame = (now: number) => {
      const tt = (now - t0) / 1000;
      ctx.clearRect(0, 0, W, H);

      for (const r of ripples) r.r += 9;
      for (let i = ripples.length - 1; i >= 0; i--) {
        if (ripples[i].r >= ripples[i].max) ripples.splice(i, 1);
      }

      for (const p of dots) {
        if (p.bound) {
          const tx = p.tx + Math.cos(tt * 1.0 + p.ph) * 0.6;
          const ty = p.ty + Math.sin(tt * 1.2 + p.ph) * 0.6;
          p.vx += (tx - p.x) * 0.03;
          p.vy += (ty - p.y) * 0.03;
        } else {
          p.vx += (p.bvx - p.vx) * 0.01;
          p.vy += (p.bvy - p.vy) * 0.01;
        }
        if (mouse.active) {
          const dx = mouse.x - p.x;
          const dy = mouse.y - p.y;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < MR && d > 0) {
            const t = 1 - d / MR;
            const f = t * (p.bound ? 0.45 : 1.1);
            p.vx += (dx / d) * f;
            p.vy += (dy / d) * f;
            if (t > p.lit) p.lit = t;
          }
        }
        p.vx *= p.bound ? 0.85 : 0.92;
        p.vy *= p.bound ? 0.85 : 0.92;
        p.x += p.vx;
        p.y += p.vy;
        p.lit *= 0.94;
        if (!p.bound) {
          if (p.x < -14) p.x = W + 14;
          if (p.x > W + 14) p.x = -14;
          if (p.y < -14) p.y = H + 14;
          if (p.y > H + 14) p.y = -14;
        }
      }

      // ── constellation web: long lines among the free nodes (full-section) ──
      for (let i = 0; i < freeList.length; i++) {
        const p = freeList[i];
        for (let j = i + 1; j < freeList.length; j++) {
          const q = freeList[j];
          const dx = p.x - q.x;
          const dy = p.y - q.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < FD2) {
            const dd = Math.sqrt(d2);
            const lit = p.lit > q.lit ? p.lit : q.lit;
            const op = (1 - dd / FD) * (0.10 + lit * 0.5);
            ctx.strokeStyle = 'rgba(29, 185, 84, ' + op + ')';
            ctx.lineWidth = 0.6 + lit * 0.7;
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(q.x, q.y);
            ctx.stroke();
          }
        }
      }

      // ── fine mesh (grid): letter lines (both bound) + bridges (one bound) ──
      const cell = CD;
      const grid: Record<string, number[]> = {};
      for (let i = 0; i < dots.length; i++) {
        const p = dots[i];
        const k = ((p.x / cell) | 0) + ',' + ((p.y / cell) | 0);
        (grid[k] || (grid[k] = [])).push(i);
      }
      for (let i = 0; i < dots.length; i++) {
        const p = dots[i];
        const gx = (p.x / cell) | 0;
        const gy = (p.y / cell) | 0;
        for (let ox = 0; ox <= 1; ox++) {
          const oyStart = ox === 0 ? 0 : -1;
          for (let oy = oyStart; oy <= 1; oy++) {
            const arr = grid[(gx + ox) + ',' + (gy + oy)];
            if (!arr) continue;
            for (let a = 0; a < arr.length; a++) {
              const j = arr[a];
              if (ox === 0 && oy === 0 && j <= i) continue;
              const q = dots[j];
              const both = p.bound && q.bound;
              const one = p.bound !== q.bound;
              if (!both && !one) continue; // free-free handled above
              const dx = p.x - q.x;
              const dy = p.y - q.y;
              const d2 = dx * dx + dy * dy;
              if (both) {
                if (d2 < WD2) {
                  const dd = Math.sqrt(d2);
                  const lit = p.lit > q.lit ? p.lit : q.lit;
                  const op = (1 - dd / WD) * (0.52 + lit * 0.4);
                  ctx.strokeStyle = 'rgba(30, 215, 96, ' + op + ')';
                  ctx.lineWidth = 1.0 + lit * 0.7;
                  ctx.beginPath();
                  ctx.moveTo(p.x, p.y);
                  ctx.lineTo(q.x, q.y);
                  ctx.stroke();
                }
              } else if (d2 < CD2) {
                const dd = Math.sqrt(d2);
                const lit = p.lit > q.lit ? p.lit : q.lit;
                const op = (1 - dd / CD) * (0.18 + lit * 0.5);
                ctx.strokeStyle = 'rgba(34, 211, 153, ' + op + ')';
                ctx.lineWidth = 0.6 + lit * 0.6;
                ctx.beginPath();
                ctx.moveTo(p.x, p.y);
                ctx.lineTo(q.x, q.y);
                ctx.stroke();
              }
            }
          }
        }
      }

      if (mouse.active) {
        const g = ctx.createRadialGradient(mouse.x, mouse.y, 0, mouse.x, mouse.y, MR);
        g.addColorStop(0, 'rgba(29, 185, 84, 0.08)');
        g.addColorStop(1, 'rgba(29, 185, 84, 0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(mouse.x, mouse.y, MR, 0, Math.PI * 2);
        ctx.fill();
      }

      for (const r of ripples) {
        const fade = 1 - r.r / r.max;
        ctx.strokeStyle = 'rgba(30, 215, 96, ' + 0.35 * fade + ')';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2);
        ctx.stroke();
      }

      for (const p of dots) {
        const R = Math.round(p.c[0] + (LIT[0] - p.c[0]) * p.lit);
        const G = Math.round(p.c[1] + (LIT[1] - p.c[1]) * p.lit);
        const B = Math.round(p.c[2] + (LIT[2] - p.c[2]) * p.lit);
        ctx.fillStyle = 'rgb(' + R + ',' + G + ',' + B + ')';
        ctx.globalAlpha = (p.bound ? 0.95 : 0.55) + p.lit * 0.3;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r + p.lit * 1.1, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(frame);
    };

    const start = () => {
      build();
      raf = requestAnimationFrame(frame);
    };
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => start());
      window.setTimeout(() => { if (!dots.length) start(); }, 600);
    } else {
      window.setTimeout(start, 300);
    }

    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(rt);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  return <canvas ref={canvasRef} className="hero-wordmark" role="img" aria-label="Orchestraty" />;
};

export default HeroWordmark;
