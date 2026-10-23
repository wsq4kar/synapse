// Пиксельные питомцы: бегают по композеру, спят, прыгают, реагируют на задачи. Можно таскать мышью.
(() => {
  const SCALE = 2;
  const T = (s) => (window.I18N ? window.I18N.t(s) : s);

  // Спрайты 16×N. Буквы — цвета палитры, точка — пусто.
  const PETS = {
    dumpling: {
      name: 'Пельмешек',
      palette: { o: '#4a3426', W: '#f7ecd6', s: '#d9c39b', S: '#e6d3ad', E: '#2b1d15', P: '#f4a6a0', M: '#8c4636' },
      body: [
        '......oooo......',
        '....ooWWWWoo....',
        '...oWWsWWsWWo...',
        '..oWWWWsWsWWWo..',
        '.oWWWWWWWWWWWWo.',
        '.oWWWWWWWWWWWWo.',
        'oWWWEWWWWWWEWWWo',
        'oWWWEWWWWWWEWWWo',
        'oWPPWWWMMWWWPPWo',
        'oWWWWWWWWWWWWWWo',
        '.oSSSSSSSSSSSSo.',
        '..oooooooooooo..',
      ],
      feet: ['...oo......oo...', '....oo....oo....'],
      blinkChar: 'W',
      speed: 34,
      lines: { work: ['леплю код…', 'кручу-верчу', 'почти готово'], done: ['готово!', 'вкусно вышло'], error: ['ой…', 'не слиплось'], pet: ['мур', 'хи-хи', '♪'] },
    },
    bot: {
      name: 'Искра',
      palette: { o: '#26323c', B: '#d5dde3', K: '#16222b', c: '#5df2cf', d: '#2f8f7a', m: '#2f8f7a', y: '#ffd34d', Y: '#fff3b0' },
      body: [
        '.......y........',
        '.......o........',
        '...oooooooooo...',
        '..oBBBBBBBBBBo..',
        '..oBKKKKKKKKBo..',
        '..oBKcKKKKcKBo..',
        '..oBKcKKKKcKBo..',
        '..oBKKKmmKKKBo..',
        '..oBBBBBBBBBBo..',
        '...oBBBBBBBBo...',
        '..oBo......oBo..',
      ],
      feet: ['....oo....oo....', '.....oo..oo.....'],
      blinkChar: 'd',
      speed: 42,
      lines: { work: ['вычисляю…', 'бип-буп', 'компилирую'], done: ['задача закрыта', 'готово!'], error: ['ошибка 0x01', 'перезагрузка…'], pet: ['бип!', 'заряжен', '>_<'] },
    },
    slime: {
      name: 'Мох',
      palette: { o: '#1f3d27', L: '#86d993', D: '#58b56b', E: '#16261a', w: '#ffffff', g: '#3f9a4f', P: '#c7f0b8' },
      body: [
        '.......gg.......',
        '........g.......',
        '.....oooooo.....',
        '...ooLLLLLLoo...',
        '..oLLLLLLLLLLo..',
        '.oLLwELLLLwELLo.',
        'oLLLEELLLLEELLLo',
        'oLLLLLLLLLLLLLLo',
        'oLPLLLLLLLLLLPLo',
        'oDDDDDDDDDDDDDDo',
        '.oooooooooooooo.',
      ],
      feet: ['................', '................'],
      blinkChar: 'L',
      speed: 26,
      hop: true,
      lines: { work: ['буль-буль…', 'расту', 'впитываю'], done: ['готово!', 'буль!'], error: ['хлюп…'], pet: ['буль', 'липко!', '♪'] },
    },
  };

  // Отрисовка кадра в canvas
  function renderFrame(def, { feet = 0, blink = false, glow = false, bob = 0 }) {
    const rows = def.body.map((r, i) => {
      if (!blink) return r;
      // закрываем глаза: верхний ряд глаз заливаем цветом тела
      const eyeRows = def.body.map((x, j) => /[Ec]/.test(x) ? j : -1).filter(j => j >= 0);
      if (i === eyeRows[0]) return r.replace(/[Ecw]/g, def.blinkChar);
      if (eyeRows.length === 1 || def.blinkChar === 'd') return r.replace(/c/g, 'd');
      return r;
    });
    rows.push(def.feet[feet % def.feet.length]);
    const h = rows.length + 2, w = 16;
    const cv = document.createElement('canvas');
    cv.width = w * SCALE; cv.height = h * SCALE;
    const x = cv.getContext('2d');
    rows.forEach((row, yy) => [...row].forEach((ch, xx) => {
      if (ch === '.') return;
      let col = def.palette[ch];
      if (ch === 'y' && glow) col = def.palette.Y;
      if (!col) return;
      x.fillStyle = col;
      x.fillRect(xx * SCALE, (yy + 2 - bob) * SCALE, SCALE, SCALE);
    }));
    return cv;
  }

  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[(Math.random() * arr.length) | 0];

  class Pet {
    constructor(world, type, x) {
      this.world = world;
      this.type = type;
      this.def = PETS[type];
      this.frames = {
        walk: [renderFrame(this.def, { feet: 0 }), renderFrame(this.def, { feet: 1, bob: this.def.hop ? 1 : 0 })],
        blink: renderFrame(this.def, { feet: 0, blink: true }),
        glow: renderFrame(this.def, { feet: 0, glow: true }),
        held: renderFrame(this.def, { feet: 1, bob: 1 }),
      };
      const el = this.el = document.createElement('div');
      el.className = 'pet';
      el.title = T(this.def.name);
      this.cv = document.createElement('canvas');
      this.cv.width = this.frames.walk[0].width; this.cv.height = this.frames.walk[0].height;
      el.appendChild(this.cv);
      world.layer.appendChild(el);
      this.w = this.cv.width; this.h = this.cv.height;
      this.x = x; this.y = -40; this.vy = 0; this.dir = Math.random() < 0.5 ? -1 : 1;
      this.state = 'fall'; this.timer = 0; this.frameT = 0; this.frameI = 0; this.blinkT = rnd(2, 5);
      this.target = x;
      this.bindPointer();
    }

    bindPointer() {
      let downAt = null;
      this.el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.el.setPointerCapture(e.pointerId);
        downAt = { x: e.clientX, y: e.clientY, t: performance.now() };
        this.dragOff = { x: e.clientX - this.x, y: e.clientY - this.y };
      });
      this.el.addEventListener('pointermove', (e) => {
        if (!downAt) return;
        if (this.state !== 'held' && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 4) { this.state = 'held'; this.el.classList.add('held'); this.say(pick(['эй!', 'куда?', 'ой-ой'])); }
        if (this.state === 'held') {
          const r = this.world.bounds();
          this.x = Math.max(r.minX - 200, Math.min(e.clientX - this.dragOff.x, r.maxX + 200));
          this.y = Math.max(r.top, e.clientY - this.dragOff.y);
        }
      });
      const up = () => {
        if (!downAt) return;
        if (this.state === 'held') { this.el.classList.remove('held'); this.state = 'fall'; this.vy = 0; }
        else { this.jump(260); this.heart(); this.say(pick(this.def.lines.pet)); }
        downAt = null;
      };
      this.el.addEventListener('pointerup', up);
      this.el.addEventListener('pointercancel', up);
    }

    jump(v = 240) { if (this.state === 'held') return; this.vy = -v; this.state = 'jump'; }

    say(text, ms = 1800) {
      this.bubble?.remove();
      const b = this.bubble = document.createElement('div');
      b.className = 'pet-bubble';
      b.textContent = T(text);
      this.el.appendChild(b);
      clearTimeout(this.bubbleT);
      this.bubbleT = setTimeout(() => { b.classList.add('out'); setTimeout(() => b.remove(), 250); }, ms);
    }

    heart() {
      const h = document.createElement('div');
      h.className = 'pet-fx heart';
      h.innerHTML = '<svg viewBox="0 0 7 6" width="14" height="12" shape-rendering="crispEdges"><path fill="#ff6b8b" d="M1 0h2v1h1V0h2v1h1v2H6v1H5v1H4v1H3V5H2V4H1V3H0V1h1z"/></svg>';
      h.style.left = (this.x + this.w / 2 - 7) + 'px';
      h.style.top = (this.y - 6) + 'px';
      this.world.layer.appendChild(h);
      setTimeout(() => h.remove(), 1000);
    }

    zzz() {
      const z = document.createElement('div');
      z.className = 'pet-fx z';
      z.textContent = 'z';
      z.style.left = (this.x + this.w * (this.dir > 0 ? 0.8 : 0.1)) + 'px';
      z.style.top = (this.y - 2) + 'px';
      this.world.layer.appendChild(z);
      setTimeout(() => z.remove(), 1600);
    }

    think(dt) {
      const r = this.world.bounds();
      const w = this.world;
      this.timer -= dt;
      if (this.state === 'fall' || this.state === 'jump') {
        this.vy += 1100 * dt;
        this.y += this.vy * dt;
        if (this.state === 'jump') this.x += this.dir * 20 * dt;
        this.x = Math.max(r.minX, Math.min(this.x, r.maxX - this.w));
        if (this.y >= r.floor - this.h) {
          this.y = r.floor - this.h; this.vy = 0;
          this.el.classList.remove('squish'); void this.el.offsetWidth; this.el.classList.add('squish');
          this.state = 'idle'; this.timer = rnd(0.6, 2);
        }
        return;
      }
      if (this.state === 'held') return;
      this.y = r.floor - this.h;
      this.x = Math.max(r.minX, Math.min(this.x, r.maxX - this.w));

      if (w.mood === 'work' && this.state !== 'work') {
        this.target = rnd(r.minX + 30, r.maxX - this.w - 30); this.state = 'walk'; this.workAfter = true;
      }
      if (this.state === 'sleep') {
        if (w.idleFor() < 2) { this.state = 'idle'; this.jump(160); this.say(pick(['а?', 'проснулся', '…'])); return; }
        if (this.timer <= 0) { this.zzz(); this.timer = 1.1; }
        return;
      }
      if (this.state === 'walk') {
        const speed = this.def.speed * (w.mood === 'work' ? 1.8 : 1);
        const d = this.target - this.x;
        this.dir = Math.sign(d) || this.dir;
        this.x += Math.sign(d) * Math.min(Math.abs(d), speed * dt);
        if (this.def.hop && this.frameI === 1 && Math.random() < 0.02) this.jump(110);
        if (Math.abs(d) < 1) {
          if (this.workAfter && w.mood === 'work') { this.state = 'work'; this.workAfter = false; this.say(pick(this.def.lines.work), 2200); this.timer = rnd(2.5, 4); }
          else { this.state = 'idle'; this.timer = rnd(1.5, 5); }
        }
        return;
      }
      if (this.state === 'work') {
        if (w.mood !== 'work') { this.state = 'idle'; this.timer = 1; return; }
        if (this.timer <= 0) {
          this.timer = rnd(2.5, 5);
          if (Math.random() < 0.5) { this.target = Math.max(r.minX, Math.min(this.x + rnd(-60, 60), r.maxX - this.w)); this.state = 'walk'; this.workAfter = true; }
          else this.say(pick(this.def.lines.work), 2000);
        }
        return;
      }
      // idle
      if (w.idleFor() > 50 && w.mood !== 'work') { this.state = 'sleep'; this.timer = 0.5; return; }
      if (this.timer <= 0) {
        const roll = Math.random();
        if (roll < 0.62) { this.target = rnd(r.minX, r.maxX - this.w); this.state = 'walk'; }
        else if (roll < 0.72) this.jump(rnd(160, 230));
        else this.timer = rnd(1.5, 4);
      }
    }

    draw(dt) {
      this.frameT += dt;
      this.blinkT -= dt;
      let frame;
      const moving = this.state === 'walk' || (this.state === 'work' && Math.sin(performance.now() / 90) > 0);
      if (this.state === 'held') frame = this.frames.held;
      else if (this.state === 'sleep') frame = this.frames.blink;
      else if (moving) {
        if (this.frameT > (this.state === 'work' ? 0.09 : 0.16)) { this.frameT = 0; this.frameI ^= 1; }
        frame = this.frames.walk[this.frameI];
      } else if (this.blinkT < 0) {
        frame = this.frames.blink;
        if (this.blinkT < -0.14) this.blinkT = rnd(2.5, 6);
      } else frame = this.type === 'bot' && Math.sin(performance.now() / 300) > 0.6 ? this.frames.glow : this.frames.walk[0];
      if (frame !== this.cur) {
        const x = this.cv.getContext('2d');
        x.clearRect(0, 0, this.cv.width, this.cv.height);
        x.drawImage(frame, 0, 0);
        this.cur = frame;
      }
      this.el.style.transform = `translate(${Math.round(this.x)}px, ${Math.round(this.y)}px)`;
      this.cv.style.transform = `scaleX(${this.dir < 0 ? -1 : 1})`;
      this.el.classList.toggle('asleep', this.state === 'sleep');
    }

    destroy() { this.el.remove(); }
  }

  class PetWorld {
    constructor(layer, getBounds) {
      this.layer = layer;
      this.getBounds = getBounds;
      this.pets = [];
      this.mood = 'idle';
      this.lastActive = performance.now();
      this.reduced = (document.documentElement.classList.contains('rm') || matchMedia('(prefers-reduced-motion: reduce)').matches);
      ['keydown', 'pointerdown', 'mousemove'].forEach(ev => addEventListener(ev, () => { this.lastActive = performance.now(); }, { passive: true }));
      this.prev = performance.now();
      const loop = (t) => {
        const dt = Math.min(0.1, (t - this.prev) / 1000); this.prev = t;
        if (!document.hidden && this.pets.length) {
          this._b = null;
          for (const p of this.pets) { if (!this.reduced || p.state === 'held') p.think(dt); else { const r = this.bounds(); p.y = r.floor - p.h; } p.draw(dt); }
        }
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    }
    bounds() { return this._b || (this._b = this.getBounds()); }
    idleFor() { return (performance.now() - this.lastActive) / 1000; }
    set(list) {
      const want = list.filter(t => PETS[t]);
      this.pets = this.pets.filter(p => { if (!want.includes(p.type)) { p.destroy(); return false; } return true; });
      const r = this.getBounds();
      for (const t of want) if (!this.pets.some(p => p.type === t)) this.pets.push(new Pet(this, t, rnd(r.minX, r.maxX - 40)));
    }
    // события задач
    react(kind) {
      if (kind === 'start') { this.mood = 'work'; this.pets.forEach(p => { if (p.state === 'sleep') p.state = 'idle'; }); }
      if (kind === 'done' || kind === 'error') {
        this.mood = 'idle';
        this.pets.forEach((p, i) => setTimeout(() => {
          p.state = p.state === 'held' ? 'held' : 'idle';
          if (kind === 'done') { p.jump(280); p.heart(); p.say(pick(p.def.lines.done)); }
          else p.say(pick(p.def.lines.error), 2400);
        }, i * 180));
      }
      if (kind === 'ultra') this.pets.forEach((p, i) => setTimeout(() => p.jump(300 + i * 20), i * 90));
    }
    preview(type) {
      const c = renderFrame(PETS[type], { feet: 0 });
      return c.toDataURL();
    }
  }

  window.Pets = { PetWorld, PETS };
})();
