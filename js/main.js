/* Happy Birthday, Kenny! — page logic.
   Talks to window.KennyAudio (js/audio.js) and window.KennyFX (js/fx.js) through
   safe wrappers, so the page still works if either one is missing. */
(function () {
  'use strict';

  const doc = document;
  const root = doc.documentElement;
  const $ = (sel, ctx) => (ctx || doc).querySelector(sel);
  const $$ = (sel, ctx) => Array.prototype.slice.call((ctx || doc).querySelectorAll(sel));

  const reduceMQ = window.matchMedia('(prefers-reduced-motion: reduce)');
  let reduced = reduceMQ.matches;
  const coarse = window.matchMedia('(pointer: coarse)').matches;

  const A = window.KennyAudio || null;
  const F = window.KennyFX || null;
  const sfx = (name, ...args) => {
    try { if (A && typeof A[name] === 'function') return A[name](...args); } catch (e) { /* sound is a bonus */ }
    return undefined;
  };
  const fx = (name, ...args) => {
    try { if (F && typeof F[name] === 'function') return F[name](...args); } catch (e) { /* so is confetti */ }
    return undefined;
  };

  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const vw = () => window.innerWidth;
  const vh = () => window.innerHeight;
  const centerOf = (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, r };
  };
  const hasIO = 'IntersectionObserver' in window;

  const hero = $('#hero');
  let introDone = false;

  /* ---------------------------------------------------------------------
     Section visibility: pause CSS animations offscreen, notify listeners
     --------------------------------------------------------------------- */
  const sectionListeners = new Map();
  const onSectionVisibility = (el, fn) => {
    if (!el) return;
    if (!sectionListeners.has(el)) sectionListeners.set(el, []);
    sectionListeners.get(el).push(fn);
  };
  function watchSections() {
    if (!hasIO) return;
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        en.target.classList.toggle('is-off', !en.isIntersecting);
        (sectionListeners.get(en.target) || []).forEach((fn) => fn(en.isIntersecting));
      });
    }, { rootMargin: '80px 0px' });
    $$('[data-section]').forEach((el) => io.observe(el));
  }

  // Fire once when an element is meaningfully in view.
  function whenSeen(el, fn, threshold) {
    if (!el) return;
    if (!hasIO) { fn(); return; }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((en) => en.isIntersecting)) { io.disconnect(); fn(); }
    }, { threshold: threshold || 0.4 });
    io.observe(el);
  }

  function setupReveal() {
    if (!hasIO || reduced) return;
    const els = $$('.section .kicker, .section-title, .section-sub, .carousel, .cake-stage, .slot, .stat-card, .cool-card, .proclamation, .danger-panel, .footer-big');
    els.forEach((el, i) => {
      el.classList.add('reveal');
      if (el.classList.contains('stat-card')) el.style.transitionDelay = (i % 5) * 70 + 'ms';
    });
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        en.target.classList.add('in');
        io.unobserve(en.target);
        // Drop the stagger delay so later transforms (party mode) are instant.
        setTimeout(() => { en.target.style.transitionDelay = ''; }, 1200);
      });
    }, { rootMargin: '0px 0px -6% 0px', threshold: 0.12 });
    els.forEach((el) => io.observe(el));
  }

  /* ---------------------------------------------------------------------
     Toast
     --------------------------------------------------------------------- */
  let toastTimer = 0;
  function toast(msg, ms) {
    const t = $('#toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), ms || 2600);
  }

  /* ---------------------------------------------------------------------
     Background: bokeh lights
     --------------------------------------------------------------------- */
  function buildBokeh() {
    const host = $('#bokeh');
    if (!host) return;
    const colors = ['rgba(139,61,255,.6)', 'rgba(25,195,125,.5)', 'rgba(255,210,63,.5)', 'rgba(255,47,179,.55)', 'rgba(34,229,255,.5)'];
    const n = coarse ? 9 : 14;
    let html = '';
    for (let i = 0; i < n; i++) {
      html += '<i style="--x:' + rand(0, 100).toFixed(1) + '%;--y:' + rand(0, 100).toFixed(1) + '%;--s:' + Math.round(rand(70, 230)) +
        'px;--c:' + colors[i % colors.length] + ';--o:' + rand(0.25, 0.6).toFixed(2) + ';--d:' + rand(18, 38).toFixed(1) +
        's;--delay:' + (-rand(0, 30)).toFixed(1) + 's;--dx:' + Math.round(rand(-60, 60)) + 'px;--dy:' + Math.round(rand(-90, 90)) + 'px"></i>';
    }
    host.innerHTML = html;
  }

  /* ---------------------------------------------------------------------
     Hero: string lights (static SVG + 3 twinkling halo groups)
     --------------------------------------------------------------------- */
  const SL_COLORS = ['#b07cff', '#2fe08f', '#ffd23f', '#ff4fc0', '#3ae9ff'];
  const SL_HALOS = ['rgba(176,124,255,.9)', 'rgba(47,224,143,.85)', 'rgba(255,210,63,.9)', 'rgba(255,79,192,.9)', 'rgba(58,233,255,.85)'];
  function buildStringLights() {
    const svg = $('#stringLights');
    if (!svg || !hero) return;
    const W = hero.clientWidth;
    const H = 120;
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    let halos = $('.sl-halos', hero);
    if (!halos) {
      halos = doc.createElement('div');
      halos.className = 'sl-halos';
      halos.setAttribute('aria-hidden', 'true');
      hero.insertBefore(halos, svg);
    }
    halos.innerHTML = '<div class="sl-group sl-g0"></div><div class="sl-group sl-g1"></div><div class="sl-group sl-g2"></div>';
    const groups = $$('.sl-group', halos);
    const strands = [
      { y0: 2, y2: 12, sag: 70, bend: 0.07 },
      { y0: 18, y2: 0, sag: 40, bend: -0.09 },
    ];
    let markup = '';
    let k = 0;
    strands.forEach((st, si) => {
      const x0 = -14;
      const x2 = W + 14;
      const x1 = W / 2 + W * st.bend;
      const yc = (st.y0 + st.y2) / 2 + 2 * st.sag; // quadratic control point for the requested sag
      markup += '<path d="M' + x0 + ',' + st.y0 + ' Q' + x1.toFixed(1) + ',' + yc.toFixed(1) + ' ' + x2 + ',' + st.y2 + '" fill="none" stroke="#2c2542" stroke-width="2"/>';
      const count = Math.max(7, Math.round((W + 28) / (coarse ? 36 : 42)));
      for (let i = 1; i < count; i++) {
        const t = i / count + (si ? 0.5 / count : 0);
        if (t >= 1) continue;
        const u = 1 - t;
        const x = u * u * x0 + 2 * u * t * x1 + t * t * x2;
        const y = u * u * st.y0 + 2 * u * t * yc + t * t * st.y2;
        const dx = 2 * u * (x1 - x0) + 2 * t * (x2 - x1);
        const dy = 2 * u * (yc - st.y0) + 2 * t * (st.y2 - yc);
        const ang = Math.atan2(dy, dx) * 0.35; // bulbs mostly hang straight down
        const ci = (k + si * 2) % SL_COLORS.length;
        const deg = (ang * 180 / Math.PI).toFixed(1);
        markup += '<g transform="translate(' + x.toFixed(1) + ',' + y.toFixed(1) + ') rotate(' + deg + ')">' +
          '<rect x="-3" y="-2" width="6" height="6.5" rx="1.3" fill="#3d3654"/>' +
          '<ellipse class="sl-glass" cx="0" cy="11" rx="4.8" ry="7.2" fill="' + SL_COLORS[ci] + '"/>' +
          '<ellipse cx="-1.5" cy="8.4" rx="1.3" ry="2.6" fill="#fff" opacity=".75"/></g>';
        const h = doc.createElement('span');
        h.className = 'sl-halo';
        const gx = x - Math.sin(ang) * 11;
        const gy = y + Math.cos(ang) * 11;
        h.style.cssText = 'left:' + gx.toFixed(1) + 'px;top:' + gy.toFixed(1) + 'px;--c:' + SL_HALOS[ci];
        groups[k % 3].appendChild(h);
        k++;
      }
    });
    svg.innerHTML = markup;
  }

  /* ---------------------------------------------------------------------
     Hero: marquee chasing bulbs (3 groups = 3 composited layers)
     --------------------------------------------------------------------- */
  function buildMarqueeBulbs() {
    const board = $('#marqueeBoard');
    const host = $('#marqueeBulbs');
    if (!board || !host) return;
    const w = board.offsetWidth;
    const h = board.offsetHeight;
    if (!w || !h) return;
    const inset = 9;
    const iw = w - inset * 2;
    const ih = h - inset * 2;
    const perimeter = 2 * (iw + ih);
    const n = Math.max(12, Math.round(perimeter / 21 / 3) * 3); // multiple of 3 keeps the chase seamless
    const step = perimeter / n;
    host.innerHTML = '<span class="chase chase-0"></span><span class="chase chase-1"></span><span class="chase chase-2"></span>';
    const groups = $$('.chase', host);
    for (let i = 0; i < n; i++) {
      let d = i * step;
      let x;
      let y;
      if (d < iw) { x = d; y = 0; }
      else if ((d -= iw) < ih) { x = iw; y = d; }
      else if ((d -= ih) < iw) { x = iw - d; y = ih; }
      else { d -= iw; x = 0; y = ih - d; }
      const b = doc.createElement('i');
      b.className = 'mb';
      b.style.left = (x + inset).toFixed(1) + 'px';
      b.style.top = (y + inset).toFixed(1) + 'px';
      groups[i % 3].appendChild(b);
    }
  }

  /* ---------------------------------------------------------------------
     Hero: disco reflections + a real rotating mirror-ball on a small canvas
     --------------------------------------------------------------------- */
  function buildDiscoSpots() {
    const host = $('#discoSpots');
    if (!host) return;
    const cols = ['rgba(255,255,255,.95)', 'rgba(255,79,192,.9)', 'rgba(58,233,255,.9)', 'rgba(255,210,63,.9)', 'rgba(176,124,255,.9)'];
    const n = coarse ? 14 : 22;
    let html = '';
    for (let i = 0; i < n; i++) {
      html += '<i style="--y:' + rand(4, 96).toFixed(1) + '%;--s:' + Math.round(rand(8, 24)) + 'px;--c:' + pick(cols) +
        ';--d:' + rand(7, 12).toFixed(1) + 's;--delay:' + (-rand(0, 12)).toFixed(1) + 's;--o:' + rand(0.35, 0.85).toFixed(2) + '"></i>';
    }
    host.innerHTML = html;
  }

  const Disco = (function () {
    const cv = $('#discoBall');
    if (!cv || !cv.getContext) return null;
    const ctx = cv.getContext('2d');
    const norm = (x, y, z) => { const l = Math.hypot(x, y, z) || 1; return { x: x / l, y: y / l, z: z / l }; };
    const L1 = norm(-0.5, -0.6, 0.65); // key light, upper left
    const L2 = norm(0.65, 0.35, 0.6); // pink fill, lower right
    const H1 = norm(L1.x, L1.y, L1.z + 1);
    const H2 = norm(L2.x, L2.y, L2.z + 1);
    const TINTS = [[255, 255, 255], [255, 255, 255], [255, 255, 255], [255, 140, 220], [120, 235, 255], [255, 220, 120], [190, 150, 255]];
    const tiles = [];
    const BANDS = 14;
    for (let b = 0; b < BANDS; b++) {
      const lat0 = -Math.PI / 2 + (b / BANDS) * Math.PI;
      const lat1 = -Math.PI / 2 + ((b + 1) / BANDS) * Math.PI;
      const n = Math.max(6, Math.round(BANDS * 2 * Math.cos((lat0 + lat1) / 2)));
      for (let i = 0; i < n; i++) {
        tiles.push({ lat0, lat1, lon0: (i / n) * Math.PI * 2, lon1: ((i + 1) / n) * Math.PI * 2, tint: pick(TINTS), ph: Math.random() * 6.28 });
      }
    }
    let size = 120;
    let dpr = 1;
    let angle = 0;
    let raf = 0;
    let running = false;
    let last = 0;

    function resize() {
      size = cv.clientWidth || 120;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      cv.width = Math.round(size * dpr);
      cv.height = Math.round(size * dpr);
    }

    function draw(now) {
      const R = size * 0.35;
      const cx = size / 2;
      const cy = size / 2;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      ctx.clearRect(0, 0, size, size);
      // halo
      const halo = ctx.createRadialGradient(cx, cy, R * 0.8, cx, cy, size / 2);
      halo.addColorStop(0, 'rgba(200,170,255,0.35)');
      halo.addColorStop(1, 'rgba(200,170,255,0)');
      ctx.fillStyle = halo;
      ctx.fillRect(0, 0, size, size);
      // grout / dark sphere
      const base = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.1, cx, cy, R);
      base.addColorStop(0, '#4d4862');
      base.addColorStop(1, '#100d1b');
      ctx.fillStyle = base;
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.fill();

      const tw = now * 0.004;
      const glints = [];
      for (let i = 0; i < tiles.length; i++) {
        const t = tiles[i];
        const a0 = t.lon0 + angle;
        const a1 = t.lon1 + angle;
        const am = (a0 + a1) / 2;
        const lm = (t.lat0 + t.lat1) / 2;
        const cl = Math.cos(lm);
        const nz = cl * Math.cos(am);
        if (nz <= 0.04) continue;
        const nx = cl * Math.sin(am);
        const ny = Math.sin(lm);
        const g = 0.09;
        const la0 = t.lat0 + (t.lat1 - t.lat0) * g;
        const la1 = t.lat1 - (t.lat1 - t.lat0) * g;
        const lo0 = a0 + (a1 - a0) * g;
        const lo1 = a1 - (a1 - a0) * g;
        const c0 = Math.cos(la0);
        const c1 = Math.cos(la1);
        const s0 = Math.sin(la0);
        const s1 = Math.sin(la1);
        const diff = Math.max(0, nx * L1.x + ny * L1.y + nz * L1.z);
        const spec = Math.pow(Math.max(0, nx * H1.x + ny * H1.y + nz * H1.z), 48);
        const spec2 = Math.pow(Math.max(0, nx * H2.x + ny * H2.y + nz * H2.z), 30);
        const shimmer = 0.85 + 0.15 * Math.sin(tw + t.ph);
        const lum = (34 + diff * 150 * shimmer + spec * 140) * (0.55 + 0.45 * nz);
        const r = Math.min(255, lum * t.tint[0] / 255 + spec2 * 170);
        const gg = Math.min(255, lum * t.tint[1] / 255 + spec2 * 40);
        const bb = Math.min(255, lum * t.tint[2] / 255 + spec2 * 150);
        ctx.fillStyle = 'rgb(' + (r | 0) + ',' + (gg | 0) + ',' + (bb | 0) + ')';
        ctx.beginPath();
        ctx.moveTo(cx + R * c0 * Math.sin(lo0), cy + R * s0);
        ctx.lineTo(cx + R * c0 * Math.sin(lo1), cy + R * s0);
        ctx.lineTo(cx + R * c1 * Math.sin(lo1), cy + R * s1);
        ctx.lineTo(cx + R * c1 * Math.sin(lo0), cy + R * s1);
        ctx.closePath();
        ctx.fill();
        if (spec > 0.55) glints.push({ x: cx + R * nx, y: cy + R * ny, s: spec });
      }
      // rim shading for roundness
      const rim = ctx.createRadialGradient(cx - R * 0.2, cy - R * 0.25, R * 0.55, cx, cy, R * 1.02);
      rim.addColorStop(0, 'rgba(0,0,0,0)');
      rim.addColorStop(1, 'rgba(6,2,20,0.65)');
      ctx.fillStyle = rim;
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.fill();
      // star glints on the hottest tiles
      ctx.globalCompositeOperation = 'lighter';
      glints.sort((p, q) => q.s - p.s);
      for (let i = 0; i < Math.min(3, glints.length); i++) {
        const p = glints[i];
        const len = 7 + p.s * 13;
        const grd = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, len * 0.7);
        grd.addColorStop(0, 'rgba(255,255,255,0.9)');
        grd.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = grd;
        ctx.fillRect(p.x - len, p.y - len, len * 2, len * 2);
        ctx.strokeStyle = 'rgba(255,255,255,' + (0.55 * p.s).toFixed(2) + ')';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(p.x - len, p.y);
        ctx.lineTo(p.x + len, p.y);
        ctx.moveTo(p.x, p.y - len);
        ctx.lineTo(p.x, p.y + len);
        ctx.stroke();
      }
    }

    function loop(now) {
      if (!running) return;
      raf = requestAnimationFrame(loop);
      if (now - last < 32) return; // ~30fps is plenty for a mirror ball
      const dt = Math.min(100, now - last);
      last = now;
      angle += dt * 0.0006;
      draw(now);
    }

    return {
      resize,
      draw: () => draw(performance.now()),
      start() {
        if (running) return;
        if (reduced) { draw(0); return; }
        running = true;
        last = performance.now();
        raf = requestAnimationFrame(loop);
      },
      stop() {
        running = false;
        cancelAnimationFrame(raf);
      },
    };
  })();

  let heroVisible = true;
  const syncDisco = () => {
    if (!Disco) return;
    if (introDone && heroVisible && !doc.hidden && !reduced) Disco.start();
    else Disco.stop();
  };

  /* ---------------------------------------------------------------------
     Sound helpers: song, lyrics chip, controls
     --------------------------------------------------------------------- */
  const songBtn = $('#songBtn');
  const muteBtn = $('#muteBtn');
  const lyrics = $('#lyrics');
  const lyricsText = $('#lyricsText');
  let lyricLine = -1;
  let lyricStr = '';
  let lyricCursor = 0;

  function onNote(info) {
    if (!info || !lyrics) return;
    if (info.line !== lyricLine) {
      lyricLine = info.line;
      lyricStr = String(info.lineText || '');
      lyricCursor = 0;
    }
    const syl = String(info.syllable || '').trim().toLowerCase();
    if (syl) {
      const at = lyricStr.toLowerCase().indexOf(syl, lyricCursor);
      if (at >= 0) lyricCursor = at + syl.length;
    }
    const sung = doc.createElement('span');
    sung.className = 'sung';
    sung.textContent = lyricStr.slice(0, lyricCursor);
    lyricsText.textContent = '';
    lyricsText.append(sung, doc.createTextNode(lyricStr.slice(lyricCursor)));
    showLyrics(true);
  }

  function showLyrics(on) {
    if (lyrics) lyrics.classList.toggle('show', on);
    root.classList.toggle('lyrics-on', on);
  }

  function playSong() {
    sfx('unlock');
    lyricLine = -1;
    sfx('playSong', { onNote, onEnd: () => showLyrics(false) });
  }

  function syncMuteBtn() {
    if (muteBtn) muteBtn.setAttribute('aria-pressed', sfx('isMuted') ? 'true' : 'false');
  }

  function setupControls() {
    window.addEventListener('kenny:song', (e) => {
      const playing = !!(e.detail && e.detail.playing);
      if (songBtn) songBtn.setAttribute('aria-pressed', playing ? 'true' : 'false');
      if (!playing) showLyrics(false);
    });

    if (songBtn) songBtn.addEventListener('click', () => {
      if (sfx('isSongPlaying')) { sfx('stopSong'); return; }
      sfx('unlock');
      if (sfx('isMuted')) { sfx('setMuted', false); syncMuteBtn(); toast('Sound on 🔊'); }
      playSong();
    });

    if (muteBtn) muteBtn.addEventListener('click', () => {
      sfx('unlock');
      const muted = sfx('toggleMute');
      syncMuteBtn();
      toast(muted ? 'Sound off 🔇' : 'Sound on 🔊');
    });

    $$('#shareBtn, #shareBtn2').forEach((b) => b.addEventListener('click', share));
  }

  async function share() {
    const og = $('meta[property="og:url"]');
    const url = (og && og.content) || location.href.split('#')[0];
    const data = { title: 'Happy Birthday, Kenny! 🎉', text: "Kenny's got a delivery 🎁 Open it with the sound on 🔊", url };
    if (navigator.share) {
      try { await navigator.share(data); return; } catch (err) { if (err && err.name === 'AbortError') return; }
    }
    const ok = await copyText(url);
    toast(ok ? 'Link copied! Go spread the love 📋' : url, ok ? 2600 : 6000);
  }

  async function copyText(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; }
    } catch (e) { /* fall through to the old way */ }
    try {
      const ta = doc.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;';
      doc.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, text.length);
      const ok = doc.execCommand('copy');
      ta.remove();
      return ok;
    } catch (e) {
      return false;
    }
  }

  /* ---------------------------------------------------------------------
     Taps: confetti wherever you tap, sparkles where you drag
     --------------------------------------------------------------------- */
  let tap = null;
  const cancelTap = () => { tap = null; };
  function setupTaps() {
    doc.addEventListener('pointerdown', (e) => {
      if (!e.isPrimary) return;
      tap = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId };
    }, { capture: true, passive: true });
    doc.addEventListener('pointercancel', cancelTap, { passive: true });
    doc.addEventListener('pointerup', (e) => {
      const d = tap;
      tap = null;
      if (!d || e.pointerId !== d.id || !introDone) return;
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      if (dx * dx + dy * dy > 196 || performance.now() - d.t > 650) return;
      const t = e.target;
      if (t && t.closest && t.closest('button, a, input, label, .photo, .balloon, [data-no-burst]')) return;
      fx('burst', e.clientX, e.clientY, { count: coarse ? 26 : 34, emoji: Math.random() < 0.35 ? ['⚜️'] : false });
    }, { passive: true });

    let lastSparkle = 0;
    const sparkleAt = (x, y) => {
      const now = performance.now();
      if (now - lastSparkle < 24) return;
      lastSparkle = now;
      fx('sparkle', x, y);
    };
    doc.addEventListener('touchmove', (e) => {
      if (!introDone) return;
      const t = e.touches && e.touches[0];
      if (t) sparkleAt(t.clientX, t.clientY);
    }, { passive: true });
    doc.addEventListener('pointermove', (e) => {
      if (introDone && e.pointerType === 'mouse') sparkleAt(e.clientX, e.clientY);
    }, { passive: true });
  }

  /* ---------------------------------------------------------------------
     The delivery (gift box intro)
     --------------------------------------------------------------------- */
  function setupIntro() {
    const intro = $('#intro');
    const giftBtn = $('#giftBtn');
    const quietBtn = $('#quietBtn');
    if (!intro || !giftBtn) { reveal(); return; }
    setInert(true);

    function openGift(quiet) {
      if (introDone) return;
      introDone = true;
      // This click is the gesture that unlocks Web Audio on iOS. Do it first, synchronously.
      if (quiet) sfx('setMuted', true);
      sfx('unlock');
      syncMuteBtn();
      if (!quiet) sfx('partyHorn');
      intro.classList.add('is-opening');
      setTimeout(() => {
        intro.classList.add('is-open');
        const c = centerOf(giftBtn);
        fx('burst', c.x, c.y, { count: 150, power: 1.7, angle: -90, spread: 130 });
        fx('cannons', { count: 80, power: 1.15 });
        fx('emoji', c.x, c.y, { chars: ['⚜️'], count: 16, power: 1.2 });
        if (!quiet) sfx('tada');
        setTimeout(() => fx('firework', vw() * 0.26, vh() * 0.2, { pattern: 'peony' }), 380);
        setTimeout(() => fx('firework', vw() * 0.74, vh() * 0.16, { pattern: 'heart' }), 760);
        setTimeout(() => reveal(intro, quiet), reduced ? 30 : 480);
      }, reduced ? 0 : 420);
    }

    giftBtn.addEventListener('click', () => openGift(false));
    if (quietBtn) quietBtn.addEventListener('click', () => openGift(true));
  }

  // While the delivery dialog is open, everything behind it is inert.
  function setInert(on) {
    ['.page', '.fab', '#shareBtn'].forEach((sel) => { const el = $(sel); if (el) el.inert = on; });
  }

  function reveal(intro, quiet) {
    introDone = true;
    root.classList.remove('intro-open');
    root.classList.add('revealed');
    if (hero) hero.classList.add('lit');
    setInert(false);
    if (intro) {
      intro.classList.add('is-leaving');
      setTimeout(() => { intro.hidden = true; }, 900);
    }
    const title = $('#mainTitle');
    if (title) { try { title.focus({ preventScroll: true }); } catch (e) { /* old browsers */ } }
    fx('setAmbient', reduced ? 0 : 1);
    if (!quiet) setTimeout(playSong, reduced ? 200 : 650);
    startBalloons();
    syncDisco();
  }

  /* ---------------------------------------------------------------------
     Balloons
     --------------------------------------------------------------------- */
  const BALLOON_COLORS = ['b-purple', 'b-green', 'b-gold', 'b-pink', 'b-cyan'];
  const STRING_SVG = '<svg class="balloon-string" viewBox="0 0 20 70" aria-hidden="true"><path d="M10 0 C 4 12, 16 22, 10 34 S 4 56, 11 70"/></svg>';
  let balloonsOn = false;
  let balloonTimer = 0;
  let popped = 0;

  function spawnBalloon(opts) {
    opts = opts || {};
    const layer = opts.host || $('#balloons');
    if (!layer || doc.hidden) return;
    const cap = (coarse ? 3 : 5) + (opts.extra ? 4 : 0);
    if (!opts.still && layer.childElementCount >= cap) return;
    const b = doc.createElement('button');
    b.type = 'button';
    b.tabIndex = -1;
    b.className = 'balloon ' + pick(BALLOON_COLORS);
    const size = Math.round(rand(46, 66) * (vw() >= 720 ? 1.25 : 1));
    b.style.cssText = '--x:' + (opts.x != null ? opts.x : rand(2, 80)).toFixed(1) + '%;--size:' + size + 'px;--dur:' + rand(11, 17).toFixed(1) +
      's;--sway:' + rand(2.2, 3.6).toFixed(2) + 's;--drift:' + Math.round(rand(-40, 40)) + 'px' + (opts.y != null ? ';--y:' + opts.y + 'px' : '');
    if (opts.still) b.classList.add('still');
    b.innerHTML = '<span class="balloon-inner"><span class="balloon-body"></span><span class="balloon-knot"></span>' + STRING_SVG + '</span>';
    b.addEventListener('pointerdown', (e) => popBalloon(e, b));
    b.addEventListener('animationend', (e) => { if (e.animationName === 'rise') b.remove(); });
    layer.appendChild(b);
  }

  function popBalloon(e, b) {
    if (b.classList.contains('popped')) return;
    cancelTap();
    if (e && e.cancelable) e.preventDefault();
    sfx('unlock');
    b.classList.add('popped');
    const r = b.getBoundingClientRect();
    const color = getComputedStyle(b).getPropertyValue('--c2').trim() || '#ff2fb3';
    fx('burst', r.left + r.width / 2, r.top + r.height * 0.45, { count: 36, power: 1, colors: [color, '#ffffff', '#ffd23f'] });
    sfx('pop');
    setTimeout(() => b.remove(), 220);
    popped++;
    if (popped === 5) toast('5 balloons popped. The Committee is impressed. 🎈');
    else if (popped === 15) toast('15 balloons?! Seek help. (Happy birthday!) 🎈');
  }

  function startBalloons() {
    if (reduced) {
      // No floating motion: a few still balloons parked in the hero instead.
      if (!hero || $('.balloons-still', hero)) return;
      const host = doc.createElement('div');
      host.className = 'balloons-still';
      host.setAttribute('aria-hidden', 'true');
      hero.appendChild(host);
      [{ x: 2, y: 70 }, { x: 83, y: 52 }].forEach((p) => spawnBalloon({ still: true, host, x: p.x, y: p.y }));
      return;
    }
    if (balloonsOn) return;
    balloonsOn = true;
    const loop = () => {
      if (!balloonsOn) return;
      spawnBalloon();
      balloonTimer = setTimeout(loop, rand(3400, 6400));
    };
    spawnBalloon();
    balloonTimer = setTimeout(loop, 1600);
  }

  function stopBalloons() {
    balloonsOn = false;
    clearTimeout(balloonTimer);
  }

  /* ---------------------------------------------------------------------
     Photo carousel
     --------------------------------------------------------------------- */
  const HEART_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#ff2f7a" d="M12 21.3s-7.6-4.7-9.7-9.5C.8 8.3 2.9 4.4 6.7 4.4c2.1 0 3.6 1.2 5.3 3.1 1.7-1.9 3.2-3.1 5.3-3.1 3.8 0 5.9 3.9 4.4 7.4-2.1 4.8-9.7 9.5-9.7 9.5z"/><path fill="#ff8fc5" d="M6.9 6.6c-1.7.1-2.9 1.7-2.6 3.5.1.5.6.6.9.2.6-1 1.4-1.8 2.4-2.3.6-.3.4-1.4-.7-1.4z"/></svg>';

  function setupCarousel() {
    const track = $('#track');
    if (!track) return;
    const slides = $$('.slide', track);
    const dots = $$('.dot');
    const n = slides.length;
    const apBtn = $('#autoplayBtn');
    const apLabel = apBtn && $('.ap-label', apBtn);
    let current = 0;
    let userPaused = reduced;
    let holdUntil = 0;
    let inView = false;

    const setActive = (i) => {
      current = i;
      dots.forEach((d, k) => { if (k === i) d.setAttribute('aria-current', 'true'); else d.removeAttribute('aria-current'); });
    };
    let lastMove = performance.now();
    let lockUntil = 0; // while our own smooth scroll is in flight, don't let it fight the dots
    const syncFromScroll = () => {
      const step = n > 1 ? slides[1].offsetLeft - slides[0].offsetLeft : track.clientWidth;
      const i = clamp(Math.round(track.scrollLeft / (step || 1)), 0, n - 1);
      if (i !== current) setActive(i);
    };
    const goTo = (i, smooth) => {
      i = (i + n) % n;
      const s = slides[i];
      const left = s.offsetLeft - (track.clientWidth - s.offsetWidth) / 2;
      lockUntil = performance.now() + 900;
      track.scrollTo({ left, behavior: smooth === false || reduced ? 'auto' : 'smooth' });
      setActive(i);
      lastMove = performance.now();
      setTimeout(syncFromScroll, 950);
    };

    let ticking = false;
    track.addEventListener('scroll', () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        if (performance.now() >= lockUntil) syncFromScroll();
      });
    }, { passive: true });

    // Autoplay: only while the carousel is mostly on screen, never in hidden tabs or for reduced
    // motion, and it backs off for 7s after any touch, wheel, key or focus.
    const hold = () => { holdUntil = performance.now() + 7000; lockUntil = 0; };
    ['pointerdown', 'touchstart', 'wheel', 'keydown', 'focusin'].forEach((ev) => track.addEventListener(ev, hold, { passive: true }));
    const canAuto = () => !userPaused && !reduced && inView && !doc.hidden && performance.now() > holdUntil;
    setInterval(() => {
      if (canAuto() && performance.now() - lastMove >= 4200) goTo(current + 1);
    }, 500);
    if (hasIO) {
      new IntersectionObserver((entries) => {
        const v = entries.some((en) => en.isIntersecting);
        if (v && !inView) lastMove = performance.now(); // give the first photo a full beat
        inView = v;
      }, { threshold: 0.55 }).observe(track);
    } else {
      inView = true;
    }

    const setPaused = (p) => {
      userPaused = p;
      if (apBtn) apBtn.dataset.paused = p ? 'true' : 'false';
      if (apLabel) apLabel.textContent = p ? 'Play slideshow' : 'Pause slideshow';
    };
    setPaused(userPaused);
    if (apBtn) apBtn.addEventListener('click', () => setPaused(!userPaused));

    const prev = $('#prevBtn');
    const next = $('#nextBtn');
    if (prev) prev.addEventListener('click', () => { hold(); goTo(current - 1); });
    if (next) next.addEventListener('click', () => { hold(); goTo(current + 1); });
    dots.forEach((d, i) => d.addEventListener('click', () => { hold(); goTo(i); }));

    // Double-tap (or double-click) a photo to send love.
    $$('.photo', track).forEach((ph) => {
      let lastT = 0;
      let lastX = 0;
      let lastY = 0;
      let loves = 0;
      const loveEl = $('.love', ph);
      const love = (x, y) => {
        hold();
        sfx('unlock');
        const r = ph.getBoundingClientRect();
        const h = doc.createElement('span');
        h.className = 'big-heart';
        h.innerHTML = HEART_SVG;
        h.style.left = (x - r.left) + 'px';
        h.style.top = (y - r.top) + 'px';
        h.addEventListener('animationend', () => h.remove());
        setTimeout(() => h.remove(), 1400);
        ph.appendChild(h);
        fx('hearts', x, y);
        sfx('pop');
        loves++;
        if (loveEl) {
          loveEl.textContent = '❤️ ' + loves;
          loveEl.classList.add('has');
          loveEl.classList.remove('bump');
          void loveEl.offsetWidth;
          loveEl.classList.add('bump');
        }
      };
      ph.addEventListener('pointerup', (e) => {
        const now = performance.now();
        if (now - lastT < 340 && Math.abs(e.clientX - lastX) < 40 && Math.abs(e.clientY - lastY) < 40) {
          lastT = 0;
          love(e.clientX, e.clientY);
        } else {
          lastT = now;
          lastX = e.clientX;
          lastY = e.clientY;
        }
      });
      ph.addEventListener('dblclick', (e) => e.preventDefault());
    });
  }

  /* ---------------------------------------------------------------------
     Cake: tap or blow out the candles
     --------------------------------------------------------------------- */
  function setupCake() {
    const candles = $$('.candle');
    if (!candles.length) return;
    const wish = $('#wish');
    const relight = $('#relightBtn');
    const micBtn = $('#micBtn');
    const micLabel = micBtn && $('.mic-label', micBtn);
    const meter = $('#micMeter');
    const meterFill = meter && meter.firstElementChild;
    const status = $('#cakeStatus');
    const glow = $('.cake-glow');
    let mic = null;
    let granted = false;
    const total = candles.length;

    const isLit = (c) => !c.classList.contains('out');
    const litCandles = () => candles.filter(isLit);
    const label = (c, i) => c.setAttribute('aria-label', 'Candle ' + (i + 1) + ' of ' + total + (isLit(c) ? ', lit. Tap to blow it out.' : ', blown out.'));

    function update() {
      const lit = litCandles().length;
      if (glow) glow.style.opacity = (0.12 + 0.88 * lit / total).toFixed(2);
      if (lit === 0 && !granted) grant();
    }

    function blow(c) {
      if (!c || !isLit(c)) return;
      c.classList.remove('relit');
      c.classList.add('out');
      label(c, candles.indexOf(c));
      sfx('blow');
      const f = $('.flame', c);
      if (f) {
        const p = centerOf(f);
        fx('burst', p.x, p.y, { count: 8, power: 0.35, colors: ['#ffffff', '#ffd23f', '#d8d2ee'] });
      }
      update();
    }

    function grant() {
      granted = true;
      stopMic();
      if (status) status.textContent = 'All the candles are out. Wish granted!';
      setTimeout(() => {
        if (wish) {
          wish.hidden = false;
          try { wish.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' }); } catch (e) { /* ok */ }
        }
        sfx('tada');
        setTimeout(() => sfx('sparkle'), 450);
        fx('fireworksShow', { duration: reduced ? 1200 : 4600, intensity: 1.2, finale: true });
        setTimeout(() => fx('textFirework', 'WISH GRANTED', vw() / 2, vh() * 0.3), reduced ? 0 : 900);
      }, 380);
    }

    const setMicLabel = (txt) => { if (micLabel) micLabel.textContent = txt; };

    function stopMic() {
      if (mic) { try { mic.stop(); } catch (e) { /* already stopped */ } mic = null; }
      if (meter) meter.hidden = true;
      if (meterFill) meterFill.style.transform = 'scaleX(0)';
      if (micBtn) micBtn.classList.remove('on');
      setMicLabel('Use the mic');
    }

    async function startMic() {
      sfx('unlock');
      if (!A || typeof A.listenForBlow !== 'function') { toast('No mic here. Tap the candles instead!'); return; }
      if (!litCandles().length) { toast('Relight the candles first! 🔥'); return; }
      micBtn.disabled = true;
      setMicLabel('Asking for the mic…');
      try {
        const session = await A.listenForBlow({
          onBlow: (strength) => {
            const lit = litCandles();
            if (!lit.length) return;
            blow(pick(lit));
            if (strength > 0.75) {
              setTimeout(() => { const more = litCandles(); if (more.length) blow(pick(more)); }, 140);
            }
          },
          onLevel: (lvl) => {
            if (meterFill) meterFill.style.transform = 'scaleX(' + clamp(lvl || 0, 0, 1).toFixed(3) + ')';
          },
        });
        mic = session;
        if (!litCandles().length) { stopMic(); return; }
        if (meter) meter.hidden = false;
        micBtn.classList.add('on');
        setMicLabel('Listening… blow! (tap to stop)');
      } catch (err) {
        mic = null;
        setMicLabel('Use the mic');
        toast((err && err.message) || "Couldn't reach the mic. Tap the candles instead!", 4000);
      } finally {
        micBtn.disabled = false;
      }
    }

    candles.forEach((c) => c.addEventListener('click', () => blow(c)));
    if (micBtn) micBtn.addEventListener('click', () => (mic ? stopMic() : startMic()));
    doc.addEventListener('visibilitychange', () => { if (doc.hidden) stopMic(); });

    if (relight) relight.addEventListener('click', () => {
      granted = false;
      if (wish) wish.hidden = true;
      if (status) status.textContent = 'Candles relit. Make another wish!';
      candles.forEach((c, i) => setTimeout(() => {
        c.classList.remove('out');
        c.classList.add('relit');
        label(c, i);
        sfx('tick');
        update();
        if (i === total - 1) sfx('ding');
      }, reduced ? 0 : i * 140));
      try { candles[0].focus({ preventScroll: true }); } catch (e) { /* ok */ }
    });
  }

  /* ---------------------------------------------------------------------
     "How old is Kenny?" slot machine
     --------------------------------------------------------------------- */
  const RESULTS = [
    { t: 'VINTAGE', q: 'Like a fine bourbon. Smooth, aged, and worth the wait.' },
    { t: 'CLASSIFIED', q: 'That information is above your clearance level. Even yours.' },
    { t: '29 (AGAIN)', q: 'Our records show this keeps happening.' },
    { t: 'LEGENDARY', q: 'JACKPOT! Ages are for mortals.', jackpot: true },
    { t: 'TIMELESS', q: 'Carbon dating came back inconclusive.' },
    { t: 'MINT CONDITION', q: 'Original parts. Original shirt.' },
    { t: 'OLD ENOUGH', q: 'Old enough to know better. Young enough to do it anyway.' },
    { t: 'ERROR 404', q: 'Age not found. Have you tried turning it off and on again?' },
    { t: 'STILL COOL', q: 'Scientifically verified. See the stats below.' },
    { t: 'NUNYA', q: 'As in: nunya business.' },
  ];
  const SCIENTISTS = ['baffled', 'sweating', 'in denial', 'asking for a raise', 'out to lunch', 'rechecking the math', 'on strike'];

  function setupSlot() {
    const reel = $('#reel');
    if (!reel) return;
    const win = reel.parentElement;
    const slot = $('.slot');
    const result = $('#slotResult');
    const spinBtn = $('#spinBtn');
    const lever = $('#lever');
    const count = $('#slotCount');
    const N = RESULTS.length;
    const REPS = 6;
    let html = '';
    for (let r = 0; r < REPS; r++) {
      RESULTS.forEach((res) => { html += '<span' + (res.t.length > 10 ? ' class="long"' : '') + '>' + res.t + '</span>'; });
    }
    reel.innerHTML = html;
    const cells = reel.children;
    let cell = 58;
    let pos = N + Math.floor(Math.random() * N);
    let spinning = false;
    let lastResult = -1;
    let spins = 0;

    const measure = () => { cell = cells[0].offsetHeight || 58; };
    const place = (p) => { reel.style.transform = 'translate3d(0,' + (-(p - 1) * cell).toFixed(2) + 'px,0)'; };
    measure();
    place(pos);
    window.addEventListener('resize', () => { if (!spinning) { measure(); place(pos); } }, { passive: true });

    const easeOut = (t) => 1 - Math.pow(1 - t, 4);

    function spin() {
      if (spinning) return;
      sfx('unlock');
      spinning = true;
      spins++;
      measure();
      let r;
      do { r = Math.floor(Math.random() * N); } while (r === lastResult);
      lastResult = r;
      const from = N + (pos % N);
      place(from);
      let target = N * (reduced ? 1 : 4) + r;
      if (target <= from) target += N;
      const dist = target - from;
      $$('.hit', reel).forEach((el) => el.classList.remove('hit'));
      if (slot) slot.classList.add('spinning');
      if (lever) { lever.classList.add('pulled'); setTimeout(() => lever.classList.remove('pulled'), 320); }
      if (spinBtn) { spinBtn.disabled = true; spinBtn.textContent = 'Spinning…'; }
      if (result) { result.classList.remove('pop'); result.textContent = 'Consulting the scientists…'; }

      const dur = reduced ? 1 : 2700 + Math.random() * 500;
      const t0 = performance.now();
      let lastCell = Math.round(from);
      const frame = (now) => {
        const t = Math.min(1, (now - t0) / dur);
        // Ease out, plus a small spring past the payline at the very end.
        const settle = t > 0.86 ? 0.28 * Math.sin(Math.PI * (t - 0.86) / 0.14) : 0;
        const p = from + dist * easeOut(t) + settle;
        place(p);
        const c = Math.round(p);
        if (c !== lastCell) { lastCell = c; sfx('tick'); }
        if (t < 1) requestAnimationFrame(frame);
        else land(target, r);
      };
      requestAnimationFrame(frame);
    }

    function land(target, r) {
      pos = target;
      place(pos);
      spinning = false;
      if (slot) slot.classList.remove('spinning');
      if (spinBtn) { spinBtn.disabled = false; spinBtn.innerHTML = 'Spin again <span aria-hidden="true">🎰</span>'; }
      if (cells[target]) cells[target].classList.add('hit');
      const res = RESULTS[r];
      if (result) {
        result.textContent = '';
        const strong = doc.createElement('strong');
        strong.textContent = res.t;
        result.append(strong, doc.createTextNode(res.q));
        void result.offsetWidth;
        result.classList.add('pop');
      }
      if (count) count.textContent = 'Spins: ' + spins + '. Scientists: ' + pick(SCIENTISTS) + '.';
      const c = centerOf(win);
      if (res.jackpot) {
        sfx('ding', true);
        fx('cannons', { count: 60, emoji: true });
        fx('emoji', c.x, c.y, { chars: ['⚜️', '👑', '🎉'], count: 22, power: 1.3 });
        fx('firework', c.x, Math.max(90, c.r.top - 80), { pattern: 'ring' });
      } else {
        sfx('ding', false);
        fx('burst', c.x, c.y, { count: 44, power: 1.1, emoji: ['⚜️'] });
      }
    }

    if (spinBtn) spinBtn.addEventListener('click', spin);
    if (lever) lever.addEventListener('click', spin);
  }

  /* ---------------------------------------------------------------------
     Official Kenny Stats
     --------------------------------------------------------------------- */
  function setupStats() {
    const section = $('#stats');
    if (!section) return;
    const nums = $$('.stat-grid [data-count]', section);
    const cool = $('#coolCard');
    const coolVal = $('#coolVal');
    const fill = cool && $('.cool-fill', cool);
    const fmt = (v) => v.toLocaleString('en-US');

    if (!reduced) nums.forEach((el) => { el.textContent = '0'; });
    if (!reduced && coolVal) coolVal.textContent = '0';

    function countUp(el, dur) {
      const to = Number(el.dataset.count) || 0;
      const fin = el.dataset.final;
      const finish = () => {
        if (!fin) { el.textContent = fmt(to); return; }
        el.textContent = '';
        const s = doc.createElement('span');
        s.className = 'inf';
        s.textContent = fin;
        el.appendChild(s);
      };
      if (reduced) { finish(); return; }
      const t0 = performance.now();
      const step = (now) => {
        const t = Math.min(1, (now - t0) / dur);
        el.textContent = fmt(Math.round(to * (1 - Math.pow(1 - t, 3))));
        if (t < 1) requestAnimationFrame(step);
        else { finish(); if (fin) sfx('ding'); }
      };
      requestAnimationFrame(step);
    }

    whenSeen($('.stat-grid', section), () => nums.forEach((el, i) => setTimeout(() => countUp(el, 1700), i * 120)), 0.3);

    function breach() {
      cool.classList.add('breach');
      sfx('stamp');
      sfx('pop');
      const r = cool.getBoundingClientRect();
      const tr = $('.cool-track', cool).getBoundingClientRect();
      fx('burst', Math.min(r.right - 4, vw() - 8), tr.top + tr.height / 2, { count: 34, power: 1.1, angle: 0, spread: 90, colors: ['#ffffff', '#22e5ff', '#ffd23f', '#ff2fb3'] });
    }

    whenSeen(cool, () => {
      if (!fill) return;
      if (reduced) {
        fill.style.transform = 'scaleX(1)';
        if (coolVal) coolVal.textContent = '137';
        cool.classList.add('breach');
        return;
      }
      const dur = 2600;
      const t0 = performance.now();
      let breached = false;
      const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
      const step = (now) => {
        const t = Math.min(1, (now - t0) / dur);
        const e = ease(t);
        fill.style.transform = 'scaleX(' + e.toFixed(4) + ')';
        const pct = Math.round(137 * e);
        if (coolVal) coolVal.textContent = pct;
        if (!breached && pct >= 100) { breached = true; breach(); }
        if (t < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }, 0.6);
  }

  /* ---------------------------------------------------------------------
     Official Proclamation: the seal stamps down
     --------------------------------------------------------------------- */
  function setupProclamation() {
    const seal = $('#seal');
    const card = $('#procCard');
    if (!seal || !card) return;
    whenSeen($('.proc-sign', card) || card, () => {
      seal.classList.add('stamped');
      setTimeout(() => {
        card.classList.add('thud');
        setTimeout(() => card.classList.remove('thud'), 450);
        sfx('stamp');
        const c = centerOf(seal);
        fx('burst', c.x, c.y, { count: 30, power: 0.7, colors: ['#ffd23f', '#f5b700', '#fff2b0', '#c48a00'] });
      }, reduced ? 0 : 330);
    }, 0.6);
  }

  /* ---------------------------------------------------------------------
     DO NOT PRESS (party mode)
     --------------------------------------------------------------------- */
  const PARTY_LINES = [
    'You pressed it. Of course you did.',
    'Again?! The Committee is not even surprised.',
    "Okay, at this point it's a lifestyle.",
    'Supreme Ruler of the Thermostat AND the Button.',
  ];

  function setupDanger() {
    const btn = $('#bigRed');
    const msg = $('#dangerMsg');
    if (!btn) return;
    const label = $('.big-red-label', btn);
    let presses = 0;
    let partyTimer = 0;
    let stopShow = null;
    let partyStarts = [];

    btn.addEventListener('click', () => {
      sfx('unlock');
      presses++;
      btn.classList.add('pressed');
      setTimeout(() => btn.classList.remove('pressed'), 160);
      if (msg) {
        msg.textContent = PARTY_LINES[Math.min(presses - 1, PARTY_LINES.length - 1)];
        msg.classList.remove('pop');
        void msg.offsetWidth;
        msg.classList.add('pop');
      }
      startParty();
    });

    function startParty() {
      clearTimeout(partyTimer);
      partyStarts.forEach(clearTimeout);
      partyStarts = [];
      if (typeof stopShow === 'function') { try { stopShow(); } catch (e) { /* ok */ } }
      doc.body.classList.add('party');
      sfx('siren');
      const songLen = (Number(sfx('songDuration')) || 16) * 1000;
      const dur = Math.max(9000, songLen + 2000);
      partyStarts.push(setTimeout(() => { sfx('partyHorn'); playSong(); }, reduced ? 0 : 950));
      stopShow = fx('fireworksShow', { duration: dur, intensity: reduced ? 0.4 : 1.5, finale: true });
      fx('setAmbient', reduced ? 0 : 2);
      fx('cannons', { count: 90, power: 1.2, emoji: true });
      fx('rain', { chars: ['⚜️', '🎉', '💜', '💚', '💛', '🎈'], duration: Math.min(dur, 8000), rate: 7 });
      partyStarts.push(setTimeout(() => fx('textFirework', 'KENNY', vw() / 2, vh() * 0.3), reduced ? 0 : 2400));
      if (!reduced) for (let i = 0; i < 4; i++) partyStarts.push(setTimeout(() => spawnBalloon({ extra: true }), 300 + i * 450));
      if (label) label.innerHTML = 'Party<br>mode';
      partyTimer = setTimeout(endParty, dur);
    }

    function endParty() {
      doc.body.classList.remove('party');
      fx('setAmbient', reduced ? 0 : 1);
      stopShow = null;
      if (label) label.innerHTML = 'Press<br>again?';
      if (msg) {
        const small = doc.createElement('small');
        small.textContent = "Party complete. We both know you'll press it again.";
        msg.appendChild(small);
      }
    }
  }

  /* ---------------------------------------------------------------------
     Boot
     --------------------------------------------------------------------- */
  function boot() {
    fx('init', $('#fx'), { reducedMotion: reduced });
    if (F) {
      F.onExplode = (info) => {
        const x = info && typeof info.x === 'number' ? info.x : vw() / 2;
        const size = info && typeof info.size === 'number' ? info.size : 0.6;
        sfx('boom', { pan: clamp((x / vw()) * 2 - 1, -1, 1), size: clamp(size, 0.2, 1) });
      };
      let lastLaunch = 0;
      F.onLaunch = (info) => {
        const now = performance.now();
        if (now - lastLaunch < 400) return;
        lastLaunch = now;
        const x = info && typeof info.x === 'number' ? info.x : vw() / 2;
        sfx('launch', { pan: clamp((x / vw()) * 2 - 1, -1, 1) });
      };
    }

    buildBokeh();
    buildStringLights();
    buildMarqueeBulbs();
    buildDiscoSpots();
    if (Disco) { Disco.resize(); Disco.draw(); }

    watchSections();
    onSectionVisibility(hero, (v) => { heroVisible = v; syncDisco(); });
    doc.addEventListener('visibilitychange', syncDisco);

    setupIntro();
    setupTaps();
    setupControls();
    setupCarousel();
    setupCake();
    setupSlot();
    setupStats();
    setupProclamation();
    setupDanger();
    setupReveal();
    syncMuteBtn();

    // Rebuild width-dependent decorations (ignore height-only changes from mobile URL bars).
    let lastW = vw();
    let rT = 0;
    window.addEventListener('resize', () => {
      clearTimeout(rT);
      rT = setTimeout(() => {
        if (vw() === lastW) return;
        lastW = vw();
        buildStringLights();
        buildMarqueeBulbs();
        if (Disco) { Disco.resize(); Disco.draw(); }
      }, 160);
    }, { passive: true });
    const board = $('#marqueeBoard');
    if (board && 'ResizeObserver' in window) {
      let lastBox = '';
      new ResizeObserver(() => {
        const box = board.offsetWidth + 'x' + board.offsetHeight;
        if (box !== lastBox) { lastBox = box; buildMarqueeBulbs(); }
      }).observe(board);
    } else if (doc.fonts && doc.fonts.ready) {
      doc.fonts.ready.then(buildMarqueeBulbs);
    }

    const onReduce = () => {
      reduced = reduceMQ.matches;
      fx('setReducedMotion', reduced);
      if (reduced) { fx('setAmbient', 0); stopBalloons(); } else if (introDone) { fx('setAmbient', 1); startBalloons(); }
      syncDisco();
      if (reduced && Disco) Disco.draw();
    };
    if (reduceMQ.addEventListener) reduceMQ.addEventListener('change', onReduce);
    else if (reduceMQ.addListener) reduceMQ.addListener(onReduce);
  }

  boot();
})();
