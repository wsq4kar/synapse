// Живое ASCII-поле на canvas: силуэт из символов, текучий шум, отклик на курсор и всплески.
(() => {
  const CHARS = 'abcdefghijkmnopqrstuvwxyz0123456789ABCDEFGHJKLMNPQRSTUVWXYZ#$%&*+=?<>/\\|:;~^';
  const LEVELS = 7;
  const HUES = 10;

  // Сглаженный шум по решётке
  const P = new Uint8Array(512);
  { const p = [...Array(256).keys()]; for (let i = 255; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [p[i], p[j]] = [p[j], p[i]]; } for (let i = 0; i < 512; i++) P[i] = p[i & 255]; }
  const fade = t => t * t * (3 - 2 * t);
  function noise(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const h = (a, b) => P[(P[(a & 255)] + (b & 255)) & 511] / 255;
    const u = fade(xf), v = fade(yf);
    const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }

  class AsciiField {
    constructor(canvas) {
      this.c = canvas;
      this.ctx = canvas.getContext('2d', { alpha: true });
      this.shape = 'logo';
      this.dim = false;
      this.ripples = [];
      this.mouse = { x: -1e4, y: -1e4 };
      this.ultra = false;
      this.running = false;
      this.reduced = (document.documentElement.classList.contains('rm') || matchMedia('(prefers-reduced-motion: reduce)').matches);
      this.last = 0;
      this.t0 = performance.now();
      new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
      addEventListener('mousemove', (e) => {
        const r = this.c.getBoundingClientRect();
        this.mouse.x = (e.clientX - r.left) / this.cw;
        this.mouse.y = (e.clientY - r.top) / this.ch;
      }, { passive: true });
      document.addEventListener('visibilitychange', () => { if (!document.hidden) this.kick(); });
      this.resize();
    }

    colors() {
      const cs = getComputedStyle(document.documentElement);
      return { lo: cs.getPropertyValue('--ascii-lo').trim() || '#1d5c50', hi: cs.getPropertyValue('--ascii-hi').trim() || '#8ef0d0' };
    }

    // Атлас символов: строки — уровни яркости (цвет темы) и радужные оттенки
    buildAtlas() {
      const dpr = this.dpr, cw = this.cw, ch = this.ch;
      const a = document.createElement('canvas');
      a.width = Math.ceil(CHARS.length * cw * dpr);
      a.height = Math.ceil((LEVELS + HUES) * ch * dpr);
      const x = a.getContext('2d');
      x.scale(dpr, dpr);
      x.font = `500 ${this.fontPx}px ui-monospace, "SF Mono", "Cascadia Code", Consolas, monospace`;
      x.textBaseline = 'middle';
      x.textAlign = 'center';
      const { lo, hi } = this.colors();
      const mix = (k) => {
        const p = (h) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
        const A = p(lo.length === 7 ? lo : '#1d5c50'), B = p(hi.length === 7 ? hi : '#8ef0d0');
        return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * k)).join(',')})`;
      };
      for (let l = 0; l < LEVELS; l++) {
        const k = l / (LEVELS - 1);
        x.fillStyle = mix(k);
        x.globalAlpha = 0.28 + 0.72 * k;
        for (let i = 0; i < CHARS.length; i++) x.fillText(CHARS[i], i * cw + cw / 2, l * ch + ch / 2 + 0.5);
      }
      x.globalAlpha = 1;
      for (let h = 0; h < HUES; h++) {
        x.fillStyle = `hsl(${(h / HUES) * 360}, 92%, 70%)`;
        for (let i = 0; i < CHARS.length; i++) x.fillText(CHARS[i], i * cw + cw / 2, (LEVELS + h) * ch + ch / 2 + 0.5);
      }
      this.atlas = a;
    }

    resize() {
      const r = this.c.parentElement.getBoundingClientRect();
      if (!r.width || !r.height) return;
      this.dpr = Math.min(devicePixelRatio || 1, 2);
      this.fontPx = 11;
      this.cw = 7.4; this.ch = 13;
      this.c.width = Math.round(r.width * this.dpr);
      this.c.height = Math.round(r.height * this.dpr);
      this.c.style.width = r.width + 'px';
      this.c.style.height = r.height + 'px';
      this.cols = Math.ceil(r.width / this.cw);
      this.rows = Math.ceil(r.height / this.ch);
      this.chars = new Uint8Array(this.cols * this.rows).map(() => (Math.random() * CHARS.length) | 0);
      this.buildAtlas();
      this.buildMask();
      this.kick();
    }

    setShape(s) { if (s !== this.shape) { this.shape = s; this.buildMask(); this.kick(); } }
    setDim(d) { this.dim = d; this.kick(); }
    setUltra(u) { this.ultra = u; }
    refreshTheme() { this.buildAtlas(); this.kick(); }

    // Маска силуэта в клетках сетки
    buildMask() {
      if (!this.cols) return;
      const m = document.createElement('canvas');
      m.width = this.cols; m.height = this.rows;
      const x = m.getContext('2d');
      const aspect = this.ch / this.cw; // клетки выше, чем шире
      const size = Math.min(this.rows * 0.78, (this.cols / aspect) * 0.5);
      const cx = this.cols / 2, cy = this.rows * 0.42;
      x.filter = 'blur(1.2px)';
      x.fillStyle = '#fff'; x.strokeStyle = '#fff';
      x.save();
      x.translate(cx, cy);
      x.scale(aspect, 1);
      if (this.shape === 'code') {
        x.font = `800 ${size * 0.9}px ui-monospace, Consolas, monospace`;
        x.textAlign = 'center'; x.textBaseline = 'middle';
        x.fillText('{ }', 0, size * 0.04);
      } else {
        // Крупная четырёхлучевая искра и малая рядом
        const star = (cx0, cy0, r, w) => {
          x.beginPath();
          for (let k = 0; k < 8; k++) {
            const a = (Math.PI / 4) * k - Math.PI / 2;
            const rr = k % 2 === 0 ? r : r * w;
            x.lineTo(cx0 + Math.cos(a) * rr, cy0 + Math.sin(a) * rr);
          }
          x.closePath(); x.fill();
        };
        x.filter = 'blur(0.8px)';
        star(-size * 0.06, size * 0.04, size * 0.5, 0.17);
        star(size * 0.36, -size * 0.3, size * 0.15, 0.2);
        star(size * 0.3, size * 0.32, size * 0.08, 0.22);
      }
      x.restore();
      const d = x.getImageData(0, 0, this.cols, this.rows).data;
      this.mask = new Float32Array(this.cols * this.rows);
      for (let i = 0; i < this.mask.length; i++) this.mask[i] = d[i * 4 + 3] / 255;
    }

    burst(px, py) {
      const r = this.c.getBoundingClientRect();
      this.ripples.push({ x: (px - r.left) / this.cw, y: (py - r.top) / this.ch, t: performance.now() });
      this.kick();
    }

    kick() {
      if (this.running) return;
      this.running = true;
      requestAnimationFrame((t) => this.frame(t));
    }

    frame(now) {
      if (document.hidden) { this.running = false; return; }
      const fps = this.dim ? 8 : 24;
      if (now - this.last < 1000 / fps) { requestAnimationFrame((t) => this.frame(t)); return; }
      this.last = now;
      this.draw(now);
      this.ripples = this.ripples.filter(r => now - r.t < 2600);
      if (this.reduced && !this.ripples.length) { this.running = false; return; }
      requestAnimationFrame((t) => this.frame(t));
    }

    draw(now) {
      const { ctx, cols, rows, cw, ch, mask, chars, atlas, dpr } = this;
      if (!atlas || !mask) return;
      const t = (now - this.t0) / 1000;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cols * cw, rows * ch);
      const sw = cw * dpr, sh = ch * dpr;
      const mx = this.mouse.x, my = this.mouse.y;
      const ripples = this.ripples.map(r => ({ x: r.x, y: r.y, rad: ((now - r.t) / 1000) * 70, life: 1 - (now - r.t) / 2600 }));
      const mutate = this.reduced ? 0 : 0.035;
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const i = y * cols + x;
          const m = mask[i];
          // волны по силуэту + редкая россыпь по всему полю
          const wave = 0.62 + 0.38 * Math.sin(t * 1.1 + x * 0.09 - y * 0.16 + noise(x * 0.05, y * 0.08 + t * 0.2) * 3);
          let v = m * wave;
          const n = noise(x * 0.045 + t * 0.07, y * 0.09 - t * 0.05);
          if (n > 0.6) v = Math.max(v, (n - 0.6) * 1.1);
          // свечение у курсора
          const dx = (x - mx) * 0.55, dy = y - my;
          const dm = dx * dx + dy * dy;
          if (dm < 64) v += (1 - dm / 64) * 0.45 * (m > 0.1 ? 1 : 0.6);
          let hue = -1;
          for (const r of ripples) {
            const dd = Math.abs(Math.sqrt(((x - r.x) * 0.55) ** 2 + (y - r.y) ** 2) - r.rad);
            if (dd < 4) { const k = (1 - dd / 4) * r.life; v = Math.max(v, k); if (k > 0.25) hue = ((x + y + (t * 20 | 0)) % HUES); }
          }
          if (this.ultra && m > 0.35 && Math.random() < 0.012) hue = ((x + (t * 8 | 0)) % HUES);
          if (v < 0.07) continue;
          if (Math.random() < mutate * (0.3 + v)) chars[i] = (Math.random() * CHARS.length) | 0;
          const row = hue >= 0 ? LEVELS + hue : Math.min(LEVELS - 1, (v * LEVELS) | 0);
          ctx.drawImage(atlas, chars[i] * sw, row * sh, sw, sh, x * cw, y * ch, cw, ch);
        }
      }
    }
  }

  window.AsciiField = AsciiField;
})();
