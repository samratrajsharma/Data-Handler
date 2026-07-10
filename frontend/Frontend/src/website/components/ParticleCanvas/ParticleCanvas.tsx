import React, { useEffect, useRef } from 'react';
import './ParticleCanvas.css';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  baseVx: number;
  baseVy: number;
  size: number;
  baseSize: number;
  color: string;
  alpha: number;
  alphaDir: number;
  lit: number; // 0..1 — how strongly the cursor / a shockwave is lighting this node
}

interface Ripple {
  x: number;
  y: number;
  r: number;
  max: number;
}

// ── Spotify-green constellation ─────────────────────────────────────
const COLORS = ['#1DB954', '#1ED760', '#22c55e', '#4ade80', '#15803d', '#34d399'];
const LIT_COLOR = '#1ED760';
const LIT_RGB: readonly [number, number, number] = [30, 215, 96];

const MOUSE_RADIUS = 220;
const CONNECT_DIST = 140;
const ATTRACT_STRENGTH = 0.06;
const DAMPING = 0.985;
const BASE_SPEED = 1.4;

// Click-shockwave tuning — the thing that "changes the experience":
// every click drops an expanding ring that shoves nodes outward and
// lights up the web as it sweeps through.
const RIPPLE_SPEED = 9;
const RIPPLE_BAND = 48;
const RIPPLE_PUSH = 4.4;

const hexRgb = (h: string): [number, number, number] => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

const ParticleCanvas: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const ripplesRef = useRef<Ripple[]>([]);
  const mouseRef = useRef<{ x: number; y: number; active: boolean }>({ x: -9999, y: -9999, active: false });
  const animRef = useRef<number>(0);

  const createParticle = (width: number, height: number): Particle => {
    const vx = (Math.random() - 0.5) * BASE_SPEED;
    const vy = (Math.random() - 0.5) * BASE_SPEED;
    const size = Math.random() * 3 + 1.6;
    return {
      x: Math.random() * width,
      y: Math.random() * height,
      vx, vy,
      baseVx: vx,
      baseVy: vy,
      size,
      baseSize: size,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      alpha: Math.random() * 0.6 + 0.30,
      alphaDir: Math.random() > 0.5 ? 1 : -1,
      lit: 0,
    };
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resize = () => {
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
    };
    resize();

    const densityFor = (w: number, h: number) =>
      Math.min(260, Math.floor((w * h) / 5000));

    particlesRef.current = Array.from(
      { length: densityFor(canvas.width, canvas.height) },
      () => createParticle(canvas.width, canvas.height)
    );

    // Listen on the window and translate into canvas space, so the WHOLE
    // hero is interactive — moving over the headline and buttons drives the
    // web too, not just the empty gaps. Guarded on the canvas rect so it
    // only reacts while the hero is on screen.
    const inBounds = (x: number, y: number, w: number, h: number) =>
      x >= 0 && x <= w && y >= 0 && y <= h;

    const onMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      if (inBounds(x, y, rect.width, rect.height)) {
        mouseRef.current.x = x;
        mouseRef.current.y = y;
        mouseRef.current.active = true;
      } else {
        mouseRef.current.active = false;
      }
    };

    const onPointerDown = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      if (!inBounds(x, y, rect.width, rect.height)) return;
      ripplesRef.current.push({
        x, y, r: 0,
        max: Math.max(canvas.width, canvas.height) * 0.95,
      });
      if (ripplesRef.current.length > 6) ripplesRef.current.shift();
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('pointerdown', onPointerDown);

    const animate = () => {
      const W = canvas.width;
      const H = canvas.height;
      ctx.clearRect(0, 0, W, H);

      const particles = particlesRef.current;
      const mouse = mouseRef.current;

      // Advance shockwaves, retire spent ones.
      for (const rp of ripplesRef.current) rp.r += RIPPLE_SPEED;
      ripplesRef.current = ripplesRef.current.filter((rp) => rp.r < rp.max);
      const ripples = ripplesRef.current;

      for (const p of particles) {
        if (mouse.active) {
          const dx = mouse.x - p.x;
          const dy = mouse.y - p.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < MOUSE_RADIUS && dist > 0) {
            const t = 1 - dist / MOUSE_RADIUS;
            const force = t * ATTRACT_STRENGTH;
            p.vx += (dx / dist) * force * 8;
            p.vy += (dy / dist) * force * 8;
            p.size = p.baseSize + t * 3;
            if (t > p.lit) p.lit = t;
          } else {
            p.size += (p.baseSize - p.size) * 0.05;
          }
        } else {
          p.size += (p.baseSize - p.size) * 0.05;
        }

        // Shockwave push — nodes inside the expanding band get an outward
        // kick and light up as the ring sweeps over them.
        for (const rp of ripples) {
          const dx = p.x - rp.x;
          const dy = p.y - rp.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 0.001;
          const offset = Math.abs(dist - rp.r);
          if (offset < RIPPLE_BAND) {
            const f = (1 - offset / RIPPLE_BAND) * RIPPLE_PUSH;
            p.vx += (dx / dist) * f;
            p.vy += (dy / dist) * f;
            if (p.lit < 0.85) p.lit = 0.85;
          }
        }

        p.lit *= 0.94;

        p.vx += (p.baseVx - p.vx) * 0.015;
        p.vy += (p.baseVy - p.vy) * 0.015;
        p.vx *= DAMPING;
        p.vy *= DAMPING;
        p.x += p.vx;
        p.y += p.vy;

        p.alpha += 0.008 * p.alphaDir;
        if (p.alpha <= 0.18 || p.alpha >= 0.85) p.alphaDir *= -1;

        if (p.x < -10) p.x = W + 10;
        if (p.x > W + 10) p.x = -10;
        if (p.y < -10) p.y = H + 10;
        if (p.y > H + 10) p.y = -10;
      }

      // Connection web (brightens where nodes are lit).
      const cd2 = CONNECT_DIST * CONNECT_DIST;
      for (let i = 0; i < particles.length; i++) {
        const a = particles[i];
        for (let j = i + 1; j < particles.length; j++) {
          const b = particles[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < cd2) {
            const dist = Math.sqrt(d2);
            const lit = a.lit > b.lit ? a.lit : b.lit;
            const opacity = (1 - dist / CONNECT_DIST) * (0.13 + lit * 0.6);
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.strokeStyle = `rgba(29, 185, 84, ${opacity})`;
            ctx.lineWidth = 0.7 + lit * 0.9;
            ctx.stroke();
          }
        }
      }

      // Shockwave rings.
      for (const rp of ripples) {
        const fade = 1 - rp.r / rp.max;
        ctx.beginPath();
        ctx.arc(rp.x, rp.y, rp.r, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(30, 215, 96, ${0.5 * fade})`;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(rp.x, rp.y, Math.max(0, rp.r - 10), 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(29, 185, 84, ${0.22 * fade})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // Cursor lines + glow.
      if (mouse.active) {
        for (const p of particles) {
          const dx = mouse.x - p.x;
          const dy = mouse.y - p.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < MOUSE_RADIUS) {
            const opacity = (1 - dist / MOUSE_RADIUS) * 0.40;
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(mouse.x, mouse.y);
            ctx.strokeStyle = `rgba(30, 215, 96, ${opacity})`;
            ctx.lineWidth = 0.8;
            ctx.stroke();
          }
        }
        const gradient = ctx.createRadialGradient(mouse.x, mouse.y, 0, mouse.x, mouse.y, MOUSE_RADIUS * 0.65);
        gradient.addColorStop(0, 'rgba(29, 185, 84, 0.14)');
        gradient.addColorStop(1, 'rgba(29, 185, 84, 0)');
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(mouse.x, mouse.y, MOUSE_RADIUS * 0.65, 0, Math.PI * 2);
        ctx.fill();
      }

      // Nodes last; lit ones shift to bright green and glow.
      for (const p of particles) {
        const [br, bg, bb] = hexRgb(p.color);
        const r = Math.round(br + (LIT_RGB[0] - br) * p.lit);
        const g = Math.round(bg + (LIT_RGB[1] - bg) * p.lit);
        const b = Math.round(bb + (LIT_RGB[2] - bb) * p.lit);
        if (p.lit > 0.15) {
          ctx.shadowColor = LIT_COLOR;
          ctx.shadowBlur = 10 * p.lit;
        }
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size + p.lit * 1.6, 0, Math.PI * 2);
        ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
        ctx.globalAlpha = Math.min(1, p.alpha + p.lit * 0.5);
        ctx.fill();
        ctx.shadowBlur = 0;
      }
      ctx.globalAlpha = 1;

      animRef.current = requestAnimationFrame(animate);
    };

    animate();

    const handleResize = () => {
      resize();
      particlesRef.current = Array.from(
        { length: densityFor(canvas.width, canvas.height) },
        () => createParticle(canvas.width, canvas.height)
      );
    };

    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('pointerdown', onPointerDown);
      cancelAnimationFrame(animRef.current);
    };
  }, []);

  return <canvas ref={canvasRef} className="particle-canvas" />;
};

export default ParticleCanvas;
