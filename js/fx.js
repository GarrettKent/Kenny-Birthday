/*!
 * KennyFX: single-canvas particle engine for Kenny's birthday page.
 * Confetti, fireworks (incl. text fireworks), sparkle trails and emoji confetti.
 * Classic script, no dependencies. Exposes exactly one global: window.KennyFX.
 * All public coordinates are viewport CSS pixels (clientX / clientY).
 */
(function () {
  'use strict';

  /* ------------------------------------------------------------ constants */

  const TAU = Math.PI * 2, D2R = Math.PI / 180;
  const SS = 2;                       // sprites are pre-rendered at 2x (the DPR cap)
  const POOL_MAX = 1100;              // largest particle cap; buffers are sized once
  const HMAX = 16;                    // max trail points stored per spark
  const AL = 8, WC = 3, MAXC = 40;    // spark batches: alpha levels x width classes x colours
  const NB = MAXC * AL * WC;
  const WIDTHS = [1.1, 1.9, 3.1];     // trail stroke width (CSS px) per width class
  const T_CONF = 1, T_SPRITE = 2, T_SPARK = 3, T_ROCKET = 4, T_TEXT = 5, T_GLINT = 6;
  const S_RECT = 0, S_CIRCLE = 1, S_RIBBON = 2, S_STAR = 3;
  const LOW = 0, MID = 1, HIGH = 2;   // spawn priority: LOW stops early to leave room for fireworks
  // Photosensitivity rules for explosion glows: local, dim, short and rate limited.
  const GLOW_MAX = 3, GLOW_WINDOW = 1000, GLOW_LIFE = 0.25, GLOW_ALPHA = 0.35, GLOW_R = 120;
  const SHOW_GAP = 0.34;              // >= 0.34 s between show launches => at most 3 per second

  const P = {
    purple: '#8B3DFF', plum: '#6A1B9A', green: '#19C37D', jade: '#0BA360', gold: '#FFD23F',
    amber: '#F5B700', pink: '#FF2FB3', cyan: '#22E5FF', cream: '#FFF6E0', red: '#FF3B5C'
  };
  // Palettes below hold palette names; C[name] is the registered colour id.
  const CONFETTI = ['purple', 'purple', 'plum', 'green', 'green', 'jade', 'gold', 'gold', 'amber', 'pink', 'cyan', 'cream'];
  const SCHEMES = [['gold', 'cream'], ['purple', 'gold'], ['green', 'gold'], ['pink', 'cyan'], ['cyan', 'cream'],
    ['purple', 'green'], ['pink', 'gold'], ['green', 'purple'], ['cyan', 'pink'], ['gold', 'purple']];
  const LETTERS = ['gold', 'pink', 'cyan', 'green', 'purple'];
  const GLINTS = ['gold', 'cream', 'cyan'];
  const HEARTS = ['pink', 'red', 'purple'];
  const RAIN = ['⚜️', '🎉', '💜', '💚', '💛'];
  const HEART_EMOJI = { '💜': 'purple', '💚': 'green', '💛': 'gold', '❤': 'red', '♥': 'red', '💖': 'pink',
    '💗': 'pink', '💕': 'pink', '💓': 'pink', '🩷': 'pink', '💙': 'cyan', '🧡': 'amber', '🤍': 'cream' };
  const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji","Twemoji Mozilla","Segoe UI Symbol",sans-serif';
  const TEXT_FONT = 'Bungee, Impact, "Arial Black", sans-serif';
  const PATTERNS = ['peony', 'ring', 'heart', 'willow', 'palm', 'crossette'];
  const PATTERN_W = [0.28, 0.14, 0.1, 0.16, 0.14, 0.18];

  // Spark styles: life range (s), drag k (1/s), gravity g (px/s^2), width class, trail points,
  // trail sample interval (s), head dot size (px, 0 = none), twinkle chance, fade fraction of life.
  const ST = {
    peony:    { life: [1.3, 1.9],   k: 3.1, g: 140, wc: 1, hm: 5,  hd: 0.016, dot: 9,  tw: 0.22, fd: 0.45 },
    ring:     { life: [1.35, 1.65], k: 3.1, g: 110, wc: 1, hm: 5,  hd: 0.016, dot: 10, tw: 0.12, fd: 0.4 },
    heart:    { life: [1.6, 2.0],   k: 3.0, g: 55,  wc: 1, hm: 4,  hd: 0.016, dot: 10, tw: 0.1,  fd: 0.4 },
    willow:   { life: [2.8, 3.6],   k: 2.2, g: 80,  wc: 1, hm: 16, hd: 0.08,  dot: 5,  tw: 0.35, fd: 0.5 },
    frond:    { life: [1.7, 2.1],   k: 1.9, g: 190, wc: 2, hm: 14, hd: 0.035, dot: 13, tw: 0,    fd: 0.45 },
    leaf:     { life: [1.4, 1.9],   k: 2.0, g: 190, wc: 1, hm: 10, hd: 0.035, dot: 6,  tw: 0.2,  fd: 0.45 },
    cross:    { life: [0.7, 0.7],   k: 2.6, g: 90,  wc: 1, hm: 5,  hd: 0.016, dot: 10, tw: 0,    fd: 0.05 },
    crossKid: { life: [0.7, 1.0],   k: 2.0, g: 110, wc: 1, hm: 8,  hd: 0.016, dot: 8,  tw: 0.3,  fd: 0.5 },
    ember:    { life: [0.25, 0.5],  k: 3.0, g: 200, wc: 0, hm: 3,  hd: 0.016, dot: 0,  tw: 0,    fd: 0.6 },
    glitter:  { life: [0.5, 0.9],   k: 3.5, g: 120, wc: 0, hm: 3,  hd: 0.016, dot: 5,  tw: 0.5,  fd: 0.6 },
    gentle:   { life: [2.0, 2.6],   k: 2.2, g: 22,  wc: 0, hm: 0,  hd: 0,     dot: 9,  tw: 0,    fd: 0.8 }
  };

  /* ---------------------------------------------------------------- state */

  let canvas = null, ctx = null, ready = false, bound = false;
  let W = 1, H = 1, dpr = 1, cap = POOL_MAX, lowCap = 935, reserve = 0;
  let reduced = false, followMedia = true, userPaused = false, hidden = false;
  let raf = 0, lastT = -1, simT = 0, ftAvg = 16.7, quality = 1;
  let ambientReq = 0, ambAcc = 0, ambEmoAcc = 0, resizeTimer = 0;
  let lastSparkT = -1e9, lastSpX = 0, lastSpY = 0, inFrame = false, flushing = false;
  let cannonH = 0, cannonV = 0, heartPts = null, scratchCtx = null, nLive = 0, nPool = 0;
  const live = new Array(POOL_MAX).fill(null), pool = new Array(POOL_MAX).fill(null);
  const emitters = [];                // timed spawners: cannons, rain, shows, delayed launches
  const glows = [], glowStarts = [];  // active glows; wall-clock starts of recent glows
  const showLaunches = [];            // sim times of recent show launches (rate limit)
  const hooks = [];                   // deferred page hook calls: name, payload, ...
  const glyphs = Object.create(null); // emoji sprites by glyph
  const colors = [], colorIds = Object.create(null), C = {};
  // scratch buffers for batching sparks by (colour, alpha level, width) with a counting sort
  const bCount = new Int32Array(NB), bEnd = new Int32Array(NB);
  const ents = new Int32Array(POOL_MAX * 2), ekeys = new Int32Array(POOL_MAX * 2), sorted = new Int32Array(POOL_MAX * 2);

  /* ------------------------------------------------------------ utilities */

  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[(Math.random() * arr.length) | 0];
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const isNum = (v) => typeof v === 'number' && isFinite(v);
  const num = (v, d) => (isNum(v) ? v : d);
  const noop = function () {};
  const report = (e) => { if (window.__FX_DEBUG && window.console) console.error('[KennyFX]', e); };

  // Shared canvas for pixel readback (emoji blank checks, text sampling) and colour parsing.
  function scratch(w, h) {
    if (!scratchCtx) scratchCtx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    const c = scratchCtx.canvas;
    if (c.width < w || c.height < h) { c.width = Math.max(c.width, Math.ceil(w)); c.height = Math.max(c.height, Math.ceil(h)); }
    scratchCtx.setTransform(1, 0, 0, 1, 0, 0);
    scratchCtx.clearRect(0, 0, c.width, c.height);
    return scratchCtx;
  }

  // A w x h CSS px sprite rendered at 2x by fn(ctx).
  function makeSprite(w, h, fn) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(w * SS));
    c.height = Math.max(1, Math.ceil(h * SS));
    const x = c.getContext('2d');
    x.scale(SS, SS);
    fn(x);
    return c;
  }

  /* -------------------------------------------------------------- colours */

  const rgba = (c, a) => 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',' + a + ')';
  // colour c with brightness scaled by f, then lifted toward white by `lift`
  function tone(c, f, lift, a) {
    const ch = (v) => Math.round(Math.min(255, v * f) + (255 - Math.min(255, v * f)) * lift);
    const s = ch(c.r) + ',' + ch(c.g) + ',' + ch(c.b);
    return a === undefined ? 'rgb(' + s + ')' : 'rgba(' + s + ',' + a + ')';
  }

  // Map any CSS colour to a small integer id (sparks are batched by colour); sprites cache on it.
  function colorId(css) {
    const key = String(css);
    if (colorIds[key] !== undefined) return colorIds[key];
    const fallback = C.gold || 0;
    if (colors.length >= MAXC) return fallback;
    const x = scratch(1, 1);
    x.fillStyle = '#010203';
    x.fillStyle = key;
    const n = String(x.fillStyle);
    if (n === '#010203' && key.toLowerCase() !== '#010203') return fallback;   // not a colour
    const m = n[0] === '#' ? [1, 3, 5].map((i) => parseInt(n.slice(i, i + 2), 16))
      : (n.match(/[\d.]+/g) || [255, 210, 63]).map(Number);
    const col = { r: m[0], g: m[1], b: m[2], css: '', shades: [], dot: null, glow: null, glint: null,
      heart: null, star: null, rib: null };
    col.css = tone(col, 1, 0);
    // confetti faces: [front, back] x 4 brightness levels (edge-on .. face-on with a glint)
    for (let s = 0; s < 2; s++) {
      for (let l = 0; l < 4; l++) col.shades.push(tone(col, (0.6 + l * 0.14) * (s ? 0.78 : 1), !s && l === 3 ? 0.2 : 0));
    }
    colorIds[key] = colors.length;
    colors.push(col);
    return colors.length - 1;
  }

  function colorList(opt, def) {
    const arr = typeof opt === 'string' ? [opt] : Array.isArray(opt) ? opt : [];
    const out = arr.filter((s) => typeof s === 'string' && s).slice(0, 12).map((s) => colorId(s));
    return out.length ? out : def;
  }

  function charList(opt, def) {
    const arr = typeof opt === 'string' ? [opt] : Array.isArray(opt) ? opt : [];
    const out = arr.filter((s) => typeof s === 'string' && s).slice(0, 24);
    return out.length ? out : def;
  }

  /* -------------------------------------------------------------- sprites */

  // Add [offset, colour, ...] stops to a gradient.
  function stops(g, list) {
    for (let i = 0; i < list.length; i += 2) g.addColorStop(list[i], list[i + 1]);
    return g;
  }
  function radial(x, r, list) {
    x.fillStyle = stops(x.createRadialGradient(r, r, 0, r, r, r), list);
    x.fillRect(0, 0, r * 2, r * 2);
  }

  // Soft white-hot spark head.
  function dotSprite(ci) {
    const c = colors[ci];
    return c.dot || (c.dot = makeSprite(16, 16, (x) => radial(x, 8,
      [0, '#fff', 0.16, tone(c, 1, 0.7), 0.32, rgba(c, 0.85), 0.6, rgba(c, 0.2), 1, rgba(c, 0)])));
  }

  // Local explosion glow (drawn at <= 120 px radius and <= 0.35 alpha); a 132x132 px canvas.
  function glowSprite(ci) {
    const c = colors[ci];
    return c.glow || (c.glow = makeSprite(66, 66, (x) => radial(x, 33, [0, tone(c, 1, 0.45), 0.2,
      tone(c, 1, 0.2, 0.62), 0.45, rgba(c, 0.26), 0.72, rgba(c, 0.08), 1, rgba(c, 0)])));
  }

  // Four-point twinkle star with a soft halo (sparkle trail, burst pops).
  function glintSprite(ci) {
    const c = colors[ci];
    return c.glint || (c.glint = makeSprite(24, 24, (x) => {
      radial(x, 12, [0, rgba(c, 0.5), 0.35, rgba(c, 0.12), 1, rgba(c, 0)]);
      x.fillStyle = stops(x.createRadialGradient(12, 12, 0, 12, 12, 12), [0, '#fff', 0.3, tone(c, 1, 0.55), 1, rgba(c, 0.85)]);
      x.fill(new Path2D('M12 0Q13 11 24 12Q13 13 12 24Q11 13 0 12Q11 11 12 0Z'));   // concave four-point star
    }));
  }

  // Five-point confetti stars: [front, darker back].
  function starSprites(ci) {
    const c = colors[ci];
    return c.star || (c.star = [1, 0.72].map((f) => makeSprite(16, 16, (x) => {
      for (let i = 0; i < 10; i++) {
        const r = i & 1 ? 3.3 : 7.6, a = -Math.PI / 2 + (i * Math.PI) / 5;
        x.lineTo(8 + Math.cos(a) * r, 8.4 + Math.sin(a) * r);
      }
      x.fillStyle = stops(x.createLinearGradient(2, 1, 13, 15), [0, tone(c, f * 1.1, 0.3), 1, tone(c, f * 0.82, 0)]);
      x.fill();
    })));
  }

  // Curly streamers: a wavy strip shaded light/dark so it reads as a twisted ribbon. [front, back]
  function ribbonSprites(ci) {
    const c = colors[ci];
    return c.rib || (c.rib = [1, 0.74].map((f) => makeSprite(40, 12, (x) => {
      const g = x.createLinearGradient(3, 0, 37, 0);
      for (let i = 0; i <= 6; i++) g.addColorStop(i / 6, i & 1 ? tone(c, f * 1.08, 0.22) : tone(c, f * 0.6, 0));
      Object.assign(x, { strokeStyle: g, lineWidth: 2.6, lineCap: 'round' });
      for (let i = 0; i <= 36; i++) x.lineTo(3 + (i / 36) * 34, 6 + Math.sin((i / 36) * Math.PI * 3) * 3.3);
      x.stroke();
    })));
  }

  const HEART_PATH = 'M50 89C45 84 9 63 7 37C5 20 17 9 31 9C40 9 47 14 50 22C53 14 60 9 69 9' +
    'C83 9 95 20 93 37C91 63 55 84 50 89Z';
  // Fleur-de-lis in a 100-unit box: centre petal, band, foot, plus mirrored side petals.
  const FLEUR_MID = 'M50 3C59 14 66.5 26 64.5 40C63 50 57.5 56 55 62L45 62C42.5 56 37 50 35.5 40' +
    'C33.5 26 41 14 50 3Z M30 60L70 60Q74 60 74 64.5Q74 69 70 69L30 69Q26 69 26 64.5Q26 60 30 60Z' +
    'M45.5 69L54.5 69L52.5 83Q50 91 47.5 83Z';
  const FLEUR_SIDE = 'M56 62C56 49 63 37 75 33C87 29 98 37 97 49C96 58 88 62 83 58C79 55 81 49 86 50' +
    'C82 44 74 45 69 51C65 56 62 61 61 65Z M56 69C58 75 64 80 70.5 80C77 80 80 74 76.5 71' +
    'C74 69 71 70 71 72.5C68 73 63 72 61 69Z';
  const mirrorX = (d) => { let i = 0; return d.replace(/-?\d*\.?\d+/g, (n) => (i++ % 2 ? n : String(100 - n))); };

  function drawHeart(x, c, s) {
    x.save();
    x.scale(s / 100, s / 100);
    x.fillStyle = stops(x.createRadialGradient(36, 30, 3, 50, 48, 62), [0, tone(c, 1, 0.6), 0.45, c.css, 1, tone(c, 0.62, 0)]);
    x.fill(new Path2D(HEART_PATH));
    x.fillStyle = 'rgba(255,255,255,0.55)';       // glossy highlight
    x.beginPath();
    x.ellipse(29, 29, 11, 6.5, -0.65, 0, TAU);
    x.fill();
    x.restore();
  }

  function drawFleur(x, s) {
    x.save();
    x.scale(s / 100, s / 100);
    const path = new Path2D(FLEUR_MID + FLEUR_SIDE + mirrorX(FLEUR_SIDE));
    x.fillStyle = stops(x.createLinearGradient(20, 0, 80, 100), [0, '#FFF0A8', 0.35, P.gold, 0.7, P.amber, 1, '#C98A00']);
    x.fill(path);
    Object.assign(x, { lineWidth: 2.2, strokeStyle: 'rgba(110,60,0,0.55)' });
    x.stroke(path);
    x.restore();
  }

  function heartSprite(ci) {
    const c = colors[ci];
    return c.heart || (c.heart = makeSprite(64, 64, (x) => drawHeart(x, c, 64)));
  }

  // Emoji sprite (40 CSS px, scaled when drawn), cropped to its ink and centred. A blank glyph
  // falls back to vector art: gold fleur-de-lis for the fleur, a vector heart for hearts, else a star.
  function glyphSprite(ch) {
    if (glyphs[ch]) return glyphs[ch];
    const S = 96, x = scratch(S, S);
    // (gold fill: a monochrome fallback glyph still reads on a dark sky)
    Object.assign(x, { font: '72px ' + EMOJI_FONT, textAlign: 'center', textBaseline: 'middle', fillStyle: P.gold });
    x.fillText(ch, S / 2, S / 2);
    const d = x.getImageData(0, 0, S, S).data;
    let n = 0, x0 = S, y0 = S, x1 = 0, y1 = 0;
    for (let i = 3, p = 0; i < d.length; i += 4, p++) {
      if (d[i] <= 24) continue;
      const px = p % S, py = (p / S) | 0;
      n++;
      x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py);
    }
    const blank = n < S * S * 0.03, base = ch.replace(/\uFE0F/g, '');
    return (glyphs[ch] = makeSprite(40, 40, (o) => {
      if (!blank) {
        const bw = x1 - x0 + 1, bh = y1 - y0 + 1, k = 37.6 / Math.max(bw, bh);
        o.drawImage(x.canvas, x0, y0, bw, bh, 20 - (bw * k) / 2, 20 - (bh * k) / 2, bw * k, bh * k);
      } else if (base === '⚜') drawFleur(o, 40);
      else if (HEART_EMOJI[base]) drawHeart(o, colors[C[HEART_EMOJI[base]]], 40);
      else o.drawImage(starSprites(C.gold)[0], 2, 2, 36, 36);
    }));
  }

  /* ------------------------------------------------------ particles & pool */

  // One monomorphic particle shape for every effect, recycled through a pool.
  function Particle() {
    this.type = 0; this.shape = 0; this.c = 0; this.wc = 1; this.x = 0; this.y = 0; this.vx = 0; this.vy = 0;
    this.ox = 0; this.oy = 0; this.tx = 0; this.ty = 0; this.age = 0; this.life = 1; this.fade = 0.5; this.da = 0;
    this.w = 1; this.h = 1; this.scale = 1; this.grow = 0; this.rot = 0; this.vr = 0; this.flip = 0; this.vf = 0;
    this.sw = 0; this.swf = 0; this.swa = 0; this.k0 = 0; this.k1 = 0; this.g = 0; this.tw = 0; this.dot = 0;
    this.split = 0; this.eacc = 0; this.t1 = 0; this.t2 = 0; this.t3 = 0; this.ph = 0; this.img = null; this.data = null;
    this.hist = new Float32Array(HMAX * 2); this.hn = 0; this.hi = 0; this.hm = 0; this.hd = 0; this.ht = 0;
  }

  // A fresh particle, or null when over the cap for this priority (the spawn is trimmed).
  function spawn(pri, type, x, y, vx, vy) {
    if (nLive >= (pri === HIGH ? cap : (pri === MID ? cap - 6 : lowCap) - reserve)) return null;
    const p = nPool ? pool[--nPool] : new Particle();
    p.age = p.da = p.grow = p.rot = p.vr = p.flip = p.vf = p.sw = p.swf = p.swa = p.k0 = p.k1 = p.g = 0;
    p.tw = p.dot = p.split = p.eacc = p.ph = p.hn = p.hi = p.hm = p.hd = p.ht = 0;
    p.scale = p.wc = 1; p.fade = 0.5;
    p.type = type; p.x = x; p.y = y; p.vx = vx; p.vy = vy;
    return (live[nLive++] = p);
  }

  function killAt(i) {
    const p = live[i];
    p.img = p.data = null;
    pool[nPool++] = p;
    live[i] = live[--nLive]; live[nLive] = null;
  }

  // Requested count scaled by adaptive quality (and ~30% in reduced motion).
  const scaleCount = (n) => Math.max(0, Math.min(cap, Math.round(n * quality * (reduced ? 0.3 : 1))));

  // Confetti piece. mode: 0 burst/ambient, 1 cannon (less drag so it can climb high).
  function confetti(x, y, vx, vy, c, mode, pri) {
    const p = spawn(pri, T_CONF, x, y, vx, vy), r = Math.random();
    if (!p) return null;
    let vt;                              // terminal fall speed (px/s)
    if (r < 0.42) { p.shape = S_RECT; p.w = rand(5, 8); p.h = p.w * rand(1.4, 2); vt = rand(105, 140); }
    else if (r < 0.62) { p.shape = S_CIRCLE; p.w = p.h = rand(2.6, 4); vt = rand(135, 170); }
    else if (r < 0.8) { p.shape = S_RIBBON; p.w = rand(24, 34); p.h = p.w * 0.3; vt = rand(70, 95); ribbonSprites(c); }
    else { p.shape = S_STAR; p.w = p.h = rand(10, 14); vt = rand(95, 125); starSprites(c); }
    p.c = c; p.k0 = mode === 1 ? rand(0.85, 1.15) : rand(1.9, 2.5); p.k1 = mode === 1 ? 0.0011 : 0.0045;
    p.g = (p.k0 + p.k1 * vt) * vt;       // gravity that yields this terminal velocity
    p.rot = rand(0, TAU); p.vr = rand(-5, 5); p.flip = rand(0, TAU);
    p.vf = rand(5, 11) * (Math.random() < 0.5 ? -1 : 1) * (p.shape === S_RIBBON ? 0.6 : 1);
    p.sw = rand(0, TAU); p.swf = rand(2.2, 3.8); p.swa = p.shape === S_RIBBON ? rand(50, 90) : rand(30, 65);
    p.life = rand(4.5, 7); p.fade = 0.9;
    if (reduced) { p.swa = p.vf = 0; p.vr *= 0.3; p.life = rand(1.1, 1.6); p.fade = 0.8; }
    return p;
  }

  // Emoji / heart sprite piece: tumbles gently (rotates) rather than flipping.
  function spritePiece(x, y, vx, vy, img, size, pri) {
    const p = spawn(pri, T_SPRITE, x, y, vx, vy), vt = rand(140, 185);
    if (!p) return null;
    p.img = img; p.w = size; p.k0 = rand(1.4, 1.8); p.k1 = 0.003; p.g = (p.k0 + p.k1 * vt) * vt;
    p.rot = rand(-0.35, 0.35); p.vr = rand(-1.6, 1.6); p.sw = rand(0, TAU); p.swf = rand(2, 3.2); p.swa = rand(18, 36);
    p.life = rand(3, 4.2); p.fade = 0.8;
    if (reduced) { p.swa = p.vr = 0; p.life = rand(1.1, 1.6); }
    return p;
  }

  function spark(x, y, vx, vy, c, st, pri) {
    const p = spawn(pri, T_SPARK, x, y, vx, vy);
    if (!p) return null;
    p.c = c; p.life = rand(st.life[0], st.life[1]); p.fade = p.life * st.fd;
    p.k0 = st.k; p.g = st.g; p.wc = st.wc; p.hm = st.hm; p.hd = st.hd; p.dot = st.dot; p.tw = st.tw;
    return p;
  }

  function glint(x, y, size, life, pri) {
    const p = spawn(pri, T_GLINT, x, y, rand(-12, 12), rand(-10, 25));
    if (!p) return null;
    p.g = 40; p.c = C[pick(GLINTS)]; p.img = glintSprite(p.c); p.w = size; p.life = life; p.fade = life * 0.5;
    p.rot = rand(0, 0.8); p.vr = rand(-2.5, 2.5); p.scale = 0;
    return p;
  }

  // A few twinkles at a burst point for the initial "pop".
  function popGlints(x, y, n, spread) {
    for (let i = 0; i < n; i++) glint(x + rand(-spread, spread), y + rand(-spread, spread), rand(12, 22), rand(0.3, 0.5), LOW);
  }

  function addEmitter(step, data, kind) {
    return emitters[emitters.push({ step: step, d: data, kind: kind, t: 0, acc: 0, done: false }) - 1];
  }

  // Run fn after `sec` seconds of engine time (pauses with the engine); cancelled by owner.done.
  function later(sec, fn, owner) {
    addEmitter(laterStep, { at: sec, fn: fn, owner: owner || null }, owner ? owner.kind : 'later');
  }
  function laterStep(e, dt) {
    if (e.d.owner && e.d.owner.done) return true;
    if ((e.t += dt) < e.d.at) return false;
    e.d.fn();
    return true;
  }

  // Page hooks run outside the particle loop, so they can safely call the API (even clear()).
  function queueHook(name, payload) {
    hooks.push(name, payload);
    if (!inFrame) flushHooks();
  }
  function flushHooks() {
    if (flushing) return;
    flushing = true;
    for (let i = 0; i < hooks.length; i += 2) {
      const fn = api[hooks[i]];
      if (typeof fn === 'function') { try { fn(hooks[i + 1]); } catch (e) { report(e); } }
    }
    hooks.length = 0;
    flushing = false;
  }

  /* --------------------------------------------------------- confetti FX */

  function burst(x, y, o) {
    o = o || {};
    x = num(x, W / 2); y = num(y, H / 2);
    const n = scaleCount(num(o.count, 36)), pw = clamp(num(o.power, 1), 0.1, 4);
    const ang = num(o.angle, -90) * D2R, spread = clamp(num(o.spread, 360), 0, 360) * D2R;
    const cols = colorList(o.colors, null), emo = o.emoji === true ? RAIN : charList(o.emoji, null);
    const lift = reduced || spread < 5.5 ? 0 : 120 * pw;    // full-circle bursts get a small upward kick
    for (let i = 0; i < n; i++) {
      const a = ang + (Math.random() - 0.5) * spread;
      const sp = pw * (reduced ? 0.55 : 1) * (320 + 650 * Math.pow(Math.random(), 0.8));
      const vx = Math.cos(a) * sp, vy = Math.sin(a) * sp - lift;
      if (emo && Math.random() < 0.22) spritePiece(x, y, vx, vy, glyphSprite(pick(emo)), rand(22, 32), MID);
      else confetti(x, y, vx, vy, cols ? pick(cols) : C[pick(CONFETTI)], 0, MID);
    }
    if (!reduced) popGlints(x, y, 5, 10);
  }

  // Launch speed that carries cannon confetti to ~80% of the viewport height (cached per height).
  function cannonSpeed() {
    if (cannonH === H) return cannonV;
    const k0 = 1, k1 = 0.0011, g = (k0 + k1 * 120) * 120;
    let lo = 200, hi = 8000;
    for (let it = 0; it < 18; it++) {
      const v = (lo + hi) / 2;
      let vx = v * 0.37, vy = -v * 0.93, y = 0;
      for (let s = 0; s < 600 && vy < 0; s++) {
        const f = 1 / (1 + (k0 + k1 * Math.sqrt(vx * vx + vy * vy)) / 60);
        vx *= f; vy = vy * f + g / 60; y += vy / 60;
      }
      if (-y < H * 0.8) lo = v; else hi = v;
    }
    cannonH = H;
    return (cannonV = (lo + hi) / 2);
  }

  function cannons(o) {
    o = o || {};
    const n = scaleCount(num(o.count, 70)), pw = clamp(num(o.power, 1), 0.2, 3), emo = o.emoji ? RAIN : null;
    if (o.side !== 'right') addEmitter(cannonStep, { right: false, n: n, pw: pw, emo: emo }, 'cannon');
    if (o.side !== 'left') addEmitter(cannonStep, { right: true, n: n, pw: pw, emo: emo }, 'cannon');
  }
  // Streams one cannon's pieces over ~0.4 s from its bottom corner, up and inward.
  function cannonStep(e, dt) {
    const d = e.d, v0 = cannonSpeed() * d.pw * (reduced ? 0.6 : 1), x = d.right ? W + 4 : -4;
    e.t += dt;
    for (const want = Math.min(d.n, Math.ceil(d.n * Math.min(1, e.t / 0.4))); e.acc < want; e.acc++) {
      const el = rand(67, 88) * D2R, a = d.right ? Math.PI + el : -el, sp = v0 * rand(0.55, 1.04);
      const vx = Math.cos(a) * sp, vy = Math.sin(a) * sp;
      if (d.emo && Math.random() < 0.18) {
        const p = spritePiece(x, H + 4, vx, vy, glyphSprite(pick(d.emo)), rand(22, 32), MID);
        if (p) { p.k0 = 1; p.k1 = 0.0011; p.g = 1.165 * 150; }
      } else confetti(x, H + 4, vx, vy, C[pick(CONFETTI)], 1, MID);
    }
    if (!d.popped && !reduced) { d.popped = true; popGlints(d.right ? W - 14 : 14, H - 14, 3, 8); }
    return e.acc >= d.n;
  }

  function emojiBurst(x, y, o) {
    o = o || {};
    x = num(x, W / 2); y = num(y, H / 2);
    const chars = charList(o.chars, ['⚜️']), n = scaleCount(num(o.count, 14)), pw = clamp(num(o.power, 1), 0.1, 4);
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU), sp = rand(260, 600) * pw * (reduced ? 0.5 : 1);
      spritePiece(x, y, Math.cos(a) * sp, Math.sin(a) * sp - (reduced ? 0 : 140 * pw), glyphSprite(pick(chars)), rand(24, 36), MID);
    }
    if (!reduced) popGlints(x, y, 4, 10);
  }

  // Double-tap hearts: a big heart pops and floats up while small hearts burst around it.
  function hearts(x, y) {
    x = num(x, W / 2); y = num(y, H / 2);
    const big = spritePiece(x, y, 0, -40, heartSprite(C.pink), 58, MID);
    if (big) {
      big.grow = 0.35; big.k0 = 2; big.k1 = big.rot = big.vr = big.swa = 0; big.g = -50;
      big.life = reduced ? 0.9 : 1.3; big.fade = 0.5;
    }
    for (let i = 0, n = scaleCount(16); i < n; i++) {
      const a = rand(0, TAU), sp = rand(170, 380) * (reduced ? 0.5 : 1);
      const p = spritePiece(x, y, Math.cos(a) * sp, Math.sin(a) * sp - 60, heartSprite(C[pick(HEARTS)]), rand(14, 30), MID);
      if (!p) break;
      p.grow = 0.22; p.k0 = 3.2; p.k1 = 0.002; p.g = -90; p.rot = rand(-0.4, 0.4); p.fade = 0.6; p.swf = rand(3, 5);
      p.vr = reduced ? 0 : rand(-0.8, 0.8); p.swa = reduced ? 0 : rand(20, 40);
      p.life = reduced ? rand(0.8, 1.1) : rand(1.1, 1.7);
    }
    if (!reduced) popGlints(x, y, 6, 22);
  }

  // Finger / mouse trail: tiny twinkles that pop and fade in under half a second (throttled).
  function sparkle(x, y) {
    const t = performance.now();
    if (reduced || !isNum(x) || !isNum(y) || t - lastSparkT < 16) return;
    const u = t - lastSparkT > 120 ? 1 : Math.random();       // scatter along the finger's path
    const sx = lastSpX + (x - lastSpX) * u, sy = lastSpY + (y - lastSpY) * u;
    lastSparkT = t; lastSpX = x; lastSpY = y;
    glint(sx + rand(-4, 4), sy + rand(-4, 4), rand(8, 15), rand(0.32, 0.48), LOW);
    if (Math.random() < 0.6) {
      const p = spark(sx, sy, rand(-30, 30), rand(-20, 30), C[pick(GLINTS)], ST.glitter, LOW);
      if (p) { p.life = rand(0.3, 0.5); p.fade = p.life * 0.7; p.dot = rand(4, 6); }
    }
  }

  function dropEmoji(ch) {
    const size = rand(22, 34), p = spritePiece(rand(12, W - 12), -size, rand(-20, 20), rand(110, 200), glyphSprite(ch), size, LOW);
    if (p) { p.life = (H + 2 * size) / 120 + 2; p.fade = 0.5; p.vr = 0; p.swa = rand(20, 40); p.swf = rand(1.5, 2.5); }
  }

  function rain(o) {
    if (reduced) return noop;
    o = o || {};
    const e = addEmitter(rainStep, { chars: charList(o.chars, RAIN), dur: clamp(num(o.duration, 4000), 0, 6e5) / 1000,
      rate: clamp(num(o.rate, 8), 0, 60) }, 'rain');
    return function stop() { e.done = true; };
  }
  function rainStep(e, dt) {
    if (e.done || reduced || (e.t += dt) > e.d.dur) return true;
    for (e.acc += dt * e.d.rate * quality; e.acc >= 1; e.acc--) dropEmoji(pick(e.d.chars));
    return false;
  }

  // Ambient: a gentle trickle from the top (level 1) or a party (level 2), off in reduced motion.
  function ambientStep(dt) {
    const lvl = reduced ? 0 : ambientReq;
    if (!lvl) return;
    for (ambAcc += dt * (lvl > 1 ? 14 : 4) * quality; ambAcc >= 1; ambAcc--) {
      const p = confetti(rand(-10, W + 10), -14, rand(-15, 15), 60, C[pick(CONFETTI)], 0, LOW);
      if (p) p.life = (H + 40) / 65 + 1.5;
    }
    for (ambEmoAcc += dt * (lvl > 1 ? 1.6 : 0.22) * quality; ambEmoAcc >= 1; ambEmoAcc--) dropEmoji(lvl > 1 ? pick(RAIN) : '⚜️');
  }

  /* ------------------------------------------------------------ fireworks */

  const baseR = () => clamp(Math.min(W, H) * 0.36, 110, 270);

  function pickPattern() {
    let r = Math.random();
    for (let i = 0; i < PATTERNS.length; i++) if ((r -= PATTERN_W[i]) < 0) return PATTERNS[i];
    return 'peony';
  }

  // Shell carried by a rocket: resolved pattern, colour ids and size.
  function shell(pattern, colorsOpt, size) {
    const pat = PATTERNS.indexOf(pattern) >= 0 ? pattern : pickPattern();
    const def = pat === 'heart' ? ['pink', 'red'] : pat === 'willow' ? ['gold', 'amber']
      : pat === 'palm' ? (Math.random() < 0.5 ? ['gold', 'green'] : ['amber', 'gold']) : pick(SCHEMES);
    const cols = colorList(colorsOpt, null) || def.map((s) => C[s]);
    if (cols.length < 2) cols.push(cols[0]);
    return { pattern: pat, cols: cols, size: size, text: null };
  }

  // Sparks for one shell: quality scaled, and never more than ~60% of the free slots, so the
  // next shell of a barrage still gets some.
  const shellN = (n, size) => Math.max(0, Math.min(Math.round(n * Math.pow(size, 0.8) * quality), Math.floor((cap - nLive - 6) * 0.6)));

  function launch(tx, ty, d) {
    const p = spawn(HIGH);
    if (!p) return;
    const x0 = clamp(tx + rand(-0.08, 0.08) * W, 8, W - 8), rise = Math.max(40, H + 6 - ty);
    const t = rand(0.95, 1.2) * clamp(Math.sqrt(H / 800), 0.75, 1.1);      // flight time to the apex
    p.type = T_ROCKET; p.x = x0; p.y = H + 6; p.ty = ty; p.data = d;
    p.g = (2 * rise) / (t * t); p.vy = -p.g * t; p.vx = (tx - x0) / t;     // the apex lands on the target
    p.life = t + 0.6; p.c = C.cream; p.wc = 2; p.hm = 8; p.hd = 0.016; p.dot = 14;
    if (d.text) reserve += d.text.n;     // hold slots so the spelled text arrives complete
    queueHook('onLaunch', { x: x0 });
  }

  // Local glow at an explosion: at most 3 may start in any 1 s window (wall clock), else skipped.
  function tryGlow(x, y, ci, R) {
    if (reduced) return false;
    const t = performance.now();
    while (glowStarts.length && t - glowStarts[0] > GLOW_WINDOW) glowStarts.shift();
    if (glowStarts.length >= GLOW_MAX) return false;
    glowStarts.push(t);
    glows.push({ x: x, y: y, r: Math.min(GLOW_R, R * 0.85), age: 0, img: glowSprite(ci) });
    return true;
  }

  function explode(r) {
    const d = r.data, x = r.x, y = r.y, R = baseR() * d.size, ivx = r.vx * 0.25;
    if (d.text) reserve = Math.max(0, reserve - d.text.n);
    queueHook('onExplode', { x: x, y: y, size: d.size, pattern: d.pattern, glow: tryGlow(x, y, d.cols[0], R) });
    switch (d.pattern) {
      case 'text': return explodeText(x, y, d, R);
      case 'ring': return ring(x, y, R, d, ivx);
      case 'heart': return heart(x, y, R, d, ivx);
      case 'willow': return sphere(x, y, R * 0.95, d, ivx, ST.willow, 85, 0);
      case 'palm': return palm(x, y, R, d, ivx);
      case 'crossette': return crossette(x, y, R, d, ivx);
      default: return sphere(x, y, R, d, ivx, ST.peony, 100, Math.random() < 0.5 ? 1 : 2);
    }
  }

  // Peony / willow: directions on a sphere projected to 2D (denser toward the rim, like the real
  // thing). two: 0 = mostly colour 1, 1 = inner "pistil" core in colour 2, 2 = two-tone halves.
  function sphere(x, y, R, d, ivx, st, base, two) {
    const n = shellN(base, d.size), v0 = R * st.k, c1 = d.cols[0], c2 = d.cols[1];
    for (let i = 0; i < n; i++) {
      const z = Math.random() * 2 - 1, t = Math.random() * TAU, rr = Math.sqrt(1 - z * z);
      const core = two === 1 && i < n * 0.22, sp = v0 * (core ? 0.45 : 1) * rand(0.9, 1.04);
      const c = two === 1 ? (core ? c2 : c1) : two === 2 ? (z > 0 ? c1 : c2) : Math.random() < 0.75 ? c1 : c2;
      spark(x, y, Math.cos(t) * rr * sp + ivx, Math.sin(t) * rr * sp, c, st, MID);
    }
  }

  // A clean circle (sometimes tilted into an ellipse).
  function ring(x, y, R, d, ivx) {
    const n = shellN(56, d.size), v0 = R * ST.ring.k, tilt = Math.random() < 0.6 ? 1 : Math.cos(rand(0.3, 0.9));
    const rot = rand(0, TAU), cr = Math.cos(rot), sr = Math.sin(rot);
    for (let i = 0; i < n; i++) {
      const a = rot + (i / n) * TAU, ux = Math.cos(a), uy = Math.sin(a) * tilt, sp = v0 * rand(0.985, 1.015);
      spark(x, y, (ux * cr - uy * sr) * sp + ivx, (ux * sr + uy * cr) * sp, d.cols[0], ST.ring, MID);
    }
  }

  // Unit heart outline resampled to even arc length (computed once).
  function heartOutline() {
    if (heartPts) return heartPts;
    const N = 600, raw = [], len = [0], M = 256, out = new Float32Array(M * 2);
    for (let i = 0; i <= N; i++) {
      const t = (i / N) * TAU, s = Math.sin(t);
      raw.push(16 * s * s * s, -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)));
      if (i) len.push(len[i - 1] + Math.hypot(raw[i * 2] - raw[i * 2 - 2], raw[i * 2 + 1] - raw[i * 2 - 1]));
    }
    for (let j = 0, i = 0; j < M; j++) {
      while (i < N - 1 && len[i + 1] < (j / M) * len[N]) i++;
      out[j * 2] = raw[i * 2] / 16;
      out[j * 2 + 1] = (raw[i * 2 + 1] + 2.5) / 16;   // shifted so the shape is centred
    }
    return (heartPts = out);
  }

  function heart(x, y, R, d, ivx) {
    const n = shellN(68, d.size), v0 = R * ST.heart.k * 0.95, pts = heartOutline();
    const rot = rand(-0.12, 0.12), cr = Math.cos(rot), sr = Math.sin(rot);
    for (let i = 0; i < n; i++) {
      const j = ((i / n) * 256) | 0, hx = pts[j * 2], hy = pts[j * 2 + 1], sp = v0 * rand(0.98, 1.02);
      spark(x, y, (hx * cr - hy * sr) * sp + ivx, (hx * sr + hy * cr) * sp, d.cols[i % 3 ? 0 : 1], ST.heart, MID);
    }
  }

  // A few thick drooping fronds, each a bright head with a sheaf of followers.
  function palm(x, y, R, d, ivx) {
    const fr = Math.round(rand(7, 9)), per = Math.max(0, Math.floor(shellN(fr * 5, d.size) / fr) - 1);
    const v0 = R * ST.frond.k * 1.1, base = rand(0, TAU);
    for (let f = 0; f < fr; f++) {
      const a = base + (f / fr) * TAU + rand(-0.12, 0.12);
      spark(x, y, Math.cos(a) * v0 + ivx, Math.sin(a) * v0, d.cols[0], ST.frond, MID);
      for (let j = 0; j < per; j++) {
        const b = a + rand(-0.06, 0.06), s = v0 * rand(0.7, 0.95);
        spark(x, y, Math.cos(b) * s + ivx, Math.sin(b) * s, d.cols[j & 1], ST.leaf, MID);
      }
    }
  }

  // Crossette: stars fly out, then each splits into a cross of four.
  function crossette(x, y, R, d, ivx) {
    const n = shellN(13, d.size), v0 = R * ST.cross.k * 0.78, base = rand(0, TAU);
    for (let i = 0; i < n; i++) {
      const a = base + (i / n) * TAU + rand(-0.08, 0.08), sp = v0 * rand(0.94, 1.06);
      const p = spark(x, y, Math.cos(a) * sp + ivx, Math.sin(a) * sp, d.cols[0], ST.cross, MID);
      if (p) { p.split = rand(0.5, 0.66); p.life = p.split + 0.1; p.fade = 0.05; p.data = d; }
    }
  }
  function splitCross(p) {
    const d = p.data, a0 = rand(0, TAU), sp = rand(140, 190) * Math.sqrt((baseR() / 140) * d.size);
    for (let j = 0; j < 4; j++) {
      const a = a0 + (j * TAU) / 4;
      spark(p.x, p.y, Math.cos(a) * sp + p.vx * 0.3, Math.sin(a) * sp + p.vy * 0.3, d.cols[1], ST.crossKid, MID);
    }
  }

  // Reduced motion: no rocket and no glow, just a small soft burst that fades slowly.
  function gentleBurst(x, y, d) {
    const v0 = baseR() * 0.42 * ST.gentle.k;
    for (let i = 0, n = Math.round(28 * quality); i < n; i++) {
      const a = rand(0, TAU), sp = v0 * rand(0.5, 1);
      spark(x, y, Math.cos(a) * sp, Math.sin(a) * sp, d.cols[i & 1], ST.gentle, MID);
    }
    queueHook('onExplode', { x: x, y: y, size: 0.5, pattern: d.pattern, glow: false });
  }

  function firework(x, y, o) {
    if (x && typeof x === 'object') { o = x; x = y = undefined; }
    o = o || {};
    const tx = isNum(x) ? x : W * rand(0.15, 0.85), ty = isNum(y) ? y : H * rand(0.12, 0.45);
    const d = shell(o.pattern, o.colors, clamp(num(o.size, 1), 0.2, 3)), delay = Math.max(0, num(o.delay, 0)) / 1000;
    const go = reduced ? () => gentleBurst(tx, ty, d) : () => launch(tx, ty, d);
    if (delay > 0) later(delay, go); else go();
  }

  /* -------------------------------------------------------- text fireworks */

  const textFont = (px) => '900 ' + px.toFixed(1) + 'px ' + TEXT_FONT;

  // Rasterise text offscreen (fit to ~85% of the viewport width; two lines if one would be tiny)
  // and sample glyph pixels on a jittered hex grid. Returns offsets from the text centre.
  function sampleText(text, maxPts, cols) {
    let x = scratch(8, 8);
    x.font = textFont(100);
    const words = text.split(' ');
    let lines = [text], widest = Math.max(1, x.measureText(text).width), fs = Math.min((85 * W) / widest, H * 0.3);
    if (words.length > 1 && fs < 64) {
      let best = null, bw = 1e9;
      for (let i = 1; i < words.length; i++) {
        const a = words.slice(0, i).join(' '), b = words.slice(i).join(' ');
        const m = Math.max(x.measureText(a).width, x.measureText(b).width);
        if (m < bw) { bw = m; best = [a, b]; }
      }
      const fs2 = Math.min((85 * W) / bw, H * 0.18);
      if (fs2 > fs * 1.2) { lines = best; fs = fs2; widest = bw; }
    }
    const sc = Math.min(1, 380 / ((widest * fs) / 100)), fpx = fs * sc, lh = fpx * 1.1;   // sc: canvas px per CSS px
    const cw = Math.ceil((widest * fpx) / 100 + fpx * 0.5), ch = Math.ceil(lh * lines.length + fpx * 0.5);
    x = scratch(cw, ch);
    x.font = textFont(fpx);
    x.textBaseline = 'middle';
    x.fillStyle = '#fff';
    const info = [];
    let letter = 0;
    lines.forEach((s, L) => {
      const x0 = (cw - x.measureText(s).width) / 2, cy = ch / 2 + (L - (lines.length - 1) / 2) * lh, starts = [], ids = [];
      for (let i = 0; i < s.length; i++) { starts.push(x0 + x.measureText(s.slice(0, i)).width); ids.push(s[i] === ' ' ? -1 : letter++); }
      x.fillText(s, x0, cy);
      info.push({ cy: cy, starts: starts, ids: ids });
    });
    const img = x.getImageData(0, 0, cw, ch).data;
    let filled = 0;
    for (let i = 3; i < img.length; i += 4) if (img[i] > 128) filled++;
    const gap = Math.max(1.5, Math.sqrt(filled / (0.866 * maxPts))), px = [], py = [], pc = [];
    let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    for (let r = 0, yy = gap / 2; yy < ch; r++, yy += gap * 0.866) {
      for (let xx = r & 1 ? gap : gap / 2; xx < cw; xx += gap) {
        const sx = Math.round(xx + rand(-0.12, 0.12) * gap), sy = Math.round(yy + rand(-0.12, 0.12) * gap);
        if (sx < 0 || sy < 0 || sx >= cw || sy >= ch || img[(sy * cw + sx) * 4 + 3] < 128) continue;
        let line = info[0], li = 0;                  // nearest line, then the letter under x
        for (let L = 1; L < info.length; L++) if (Math.abs(info[L].cy - sy) < Math.abs(line.cy - sy)) line = info[L];
        while (li + 1 < line.starts.length && line.starts[li + 1] <= sx) li++;
        px.push(sx); py.push(sy); pc.push(cols[Math.max(0, line.ids[li]) % cols.length]);
        minX = Math.min(minX, sx); maxX = Math.max(maxX, sx); minY = Math.min(minY, sy); maxY = Math.max(maxY, sy);
      }
    }
    const n = px.length, xs = new Float32Array(n), ys = new Float32Array(n), cs = new Uint8Array(n);
    for (let i = 0; i < n; i++) { xs[i] = (px[i] - (minX + maxX) / 2) / sc; ys[i] = (py[i] - (minY + maxY) / 2) / sc; cs[i] = pc[i]; }
    return n ? { xs: xs, ys: ys, cs: cs, n: n, w: (maxX - minX) / sc, h: (maxY - minY) / sc, dot: clamp((gap / sc) * 2.1, 7, 20) } : null;
  }

  function textFirework(text, x, y, o) {
    o = o || {};
    text = String(text == null ? '' : text).replace(/\s+/g, ' ').trim().slice(0, 40);
    if (!text) return;
    const cols = colorList(o.colors, null) || LETTERS.map((s) => C[s]), delay = Math.max(0, num(o.delay, 0)) / 1000;
    if (reduced) {
      later(delay, () => gentleBurst(num(x, W / 2), num(y, H * 0.35), { pattern: 'text', cols: [cols[0], cols[cols.length - 1]] }));
      return;
    }
    const t = sampleText(text, Math.round((cap > 700 ? 760 : 340) * Math.max(0.7, quality)), cols);
    if (!t) return firework(x, y, { delay: o.delay });
    const cx = clamp(num(x, W / 2), Math.min(W / 2, t.w / 2 + 8), Math.max(W / 2, W - t.w / 2 - 8));
    const cy = clamp(num(y, H * 0.32), Math.min(H / 2, t.h / 2 + 12), Math.max(H / 2, H - t.h / 2 - 12));
    const d = { pattern: 'text', cols: cols, size: 1.2, text: t };
    if (delay > 0) later(delay, () => launch(cx, cy, d)); else launch(cx, cy, d);
  }

  // Text sparks burst out, swoop into place, hold ~1 s twinkling, then fall and fade.
  function explodeText(x, y, d, R) {
    const t = d.text, k = 2.8, v0 = R * 1.1 * k, take = Math.min(t.n, Math.max(0, cap - nLive)), step = t.n / Math.max(1, take);
    for (let m = 0; m < take; m++) {
      const i = Math.min(t.n - 1, (m * step) | 0), p = spawn(HIGH);
      if (!p) break;
      const a = rand(0, TAU), sp = v0 * (0.3 + 0.7 * Math.sqrt(Math.random()));
      p.type = T_TEXT; p.x = p.ox = x; p.y = p.oy = y; p.vx = Math.cos(a) * sp; p.vy = Math.sin(a) * sp;
      p.tx = x + t.xs[i]; p.ty = y + t.ys[i]; p.c = t.cs[i]; p.k0 = k; p.g = rand(110, 190);
      p.t1 = rand(0.12, 0.24); p.t2 = p.t1 + rand(0.6, 0.8); p.t3 = p.t2 + rand(0.95, 1.15);
      p.life = p.t3 + rand(1, 1.5); p.fade = p.life - p.t3;
      p.hm = 5; p.hd = 0.016; p.dot = t.dot * rand(0.85, 1.1);
    }
    for (let i = 0, n = shellN(24, 1); i < n; i++) {
      const a = rand(0, TAU), sp = R * ST.glitter.k * rand(0.3, 0.8);
      spark(x, y, Math.cos(a) * sp, Math.sin(a) * sp, C.gold, ST.glitter, LOW);
    }
  }

  /* ---------------------------------------------------------------- shows */

  function fireworksShow(o) {
    o = o || {};
    const dur = clamp(num(o.duration, 6000), 300, 6e5) / 1000, inten = clamp(num(o.intensity, 1), 0.2, 3);
    const owner = { done: false, kind: 'show' };
    if (reduced) {                       // one or two gentle bursts instead of a barrage
      later(0, () => gentleBurst(W * rand(0.25, 0.45), H * rand(0.2, 0.35), shell('peony', null, 0.8)), owner);
      later(0.9, () => gentleBurst(W * rand(0.55, 0.75), H * rand(0.2, 0.35), shell('peony', null, 0.8)), owner);
    } else {
      const fin = o.finale !== false;
      addEmitter(showStep, { owner: owner, dur: dur, inten: inten, next: 0, finAt: fin ? Math.max(0, dur - 1.3) : dur,
        finDone: !fin }, 'show');
    }
    return function stop() { owner.done = true; };
  }

  // Launch-rate gate shared by all shows: >= SHOW_GAP apart and at most 3 in any second.
  function showAllowed() {
    while (showLaunches.length && simT - showLaunches[0] >= 1) showLaunches.shift();
    return showLaunches.length < 3 && (!showLaunches.length || simT - showLaunches[showLaunches.length - 1] >= SHOW_GAP);
  }

  function showStep(e, dt) {
    const d = e.d;
    if (d.owner.done || reduced) return (d.owner.done = true);
    e.t += dt;
    if (e.t >= d.next && e.t < d.finAt) {
      d.next = e.t + 0.05;
      if (showAllowed()) {
        showLaunches.push(simT);
        const size = rand(0.8, 1.05) * (Math.random() < 0.15 * d.inten ? 1.25 : 1) * (1 + 0.1 * (d.inten - 1));
        launch(W * rand(0.12, 0.88), H * rand(0.12, 0.42), shell(null, null, size));
        d.next = e.t + Math.max(SHOW_GAP, rand(0.55, 0.85) / d.inten);
      }
    }
    if (!d.finDone && e.t >= d.finAt) { d.finDone = true; finale(d.inten, d.owner); }
    return e.t >= d.dur && d.finDone;
  }

  // Finale: a volley of big shells across the sky, crowned by a hanging gold willow.
  function finale(inten, owner) {
    const n = Math.round(clamp(5 + 2.5 * inten, 5, 11) * (quality > 0.7 ? 1 : 0.75));
    const pats = ['peony', 'peony', 'crossette', 'ring', 'palm', 'peony', 'heart'];
    for (let i = 0; i < n; i++) {
      const tx = W * (0.1 + (0.8 * (i + 0.5)) / n) + rand(-0.04, 0.04) * W, ty = H * rand(0.12, 0.36), pat = pats[i % pats.length];
      later(i * 0.06 + rand(0, 0.08), () => launch(tx, ty, shell(pat, null, rand(1.05, 1.3))), owner);
    }
    later(0.55, () => launch(W / 2, H * 0.17, shell('willow', null, 1.45)), owner);
  }

  /* ---------------------------------------------------------------- update */

  // Ring buffer of past positions (time sampled) for motion trails.
  function histPush(p, dt) {
    if (!p.hm || (p.ht += dt) < p.hd) return;
    p.ht = p.ht >= p.hd * 2 ? 0 : p.ht - p.hd;
    p.hist[p.hi * 2] = p.x;
    p.hist[p.hi * 2 + 1] = p.y;
    p.hi = p.hi + 1 === p.hm ? 0 : p.hi + 1;
    if (p.hn < p.hm) p.hn++;
  }

  const fadeA = (p) => Math.min(1, (p.life - p.age) / p.fade);
  // ease-out-back pop for sprites that grow in
  const popScale = (u) => (u >= 1 ? 1 : 1 + 2.70158 * Math.pow(u - 1, 3) + 1.70158 * Math.pow(u - 1, 2));

  // Confetti and sprites: linear + quadratic air drag gives a fast pop, then terminal-velocity flutter.
  function stepPiece(p, dt) {
    const sp = Math.sqrt(p.vx * p.vx + p.vy * p.vy), f = 1 / (1 + (p.k0 + p.k1 * sp) * dt);
    p.vx *= f;
    p.vy = p.vy * f + p.g * dt;
    let wob = 0;
    if (p.swa) {                        // side-to-side swing, only once the pop has slowed
      p.sw += p.swf * dt;
      wob = Math.cos(p.sw) * p.swa * (sp < 300 ? 1 - sp / 300 : 0);
    }
    p.x += (p.vx + wob) * dt;
    if (p.type === T_CONF) {            // a piece falling edge-on drops faster than one falling flat
      p.y += p.vy * dt * (p.vy > 0 ? 0.72 + 0.28 * Math.abs(Math.sin(p.flip)) : 1);
      p.flip += p.vf * dt;
      p.rot += p.vr * dt;
    } else {
      p.y += p.vy * dt;
      p.rot += (p.vr + (p.swa ? Math.cos(p.sw) * 0.5 : 0)) * dt;
      if (p.grow) p.scale = popScale(p.age / p.grow);
    }
    p.da = fadeA(p);
    return p.y < H + 40 && p.x > -60 && p.x < W + 60;
  }

  function stepSpark(p, dt) {
    histPush(p, dt);
    const f = 1 / (1 + p.k0 * dt);
    p.vx *= f;
    p.vy = p.vy * f + p.g * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    if (p.split && p.age >= p.split) { splitCross(p); return false; }
    p.da = fadeA(p) * (p.tw && p.age > p.life * 0.4 && Math.random() < p.tw ? 0.25 : 1);   // twinkle
    return p.y < H + 30;
  }

  function stepRocket(p, dt) {
    histPush(p, dt);
    p.vy += p.g * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    for (p.eacc += dt * 55 * quality; p.eacc >= 1; p.eacc--) {     // spark trail
      spark(p.x + rand(-1.5, 1.5), p.y + rand(0, 4), rand(-35, 35) - p.vx * 0.1, rand(0, 60) - p.vy * 0.12,
        Math.random() < 0.6 ? C.gold : C.amber, ST.ember, LOW);
    }
    p.da = rand(0.75, 1);
    if (p.vy < 0 && p.y > p.ty && p.age < p.life - 0.05) return true;
    explode(p);
    return false;
  }

  function stepText(p, dt) {
    histPush(p, dt);
    const a = p.age;
    if (a < p.t2) {                     // free burst, then ease from the burst path to the target
      const f = 1 / (1 + p.k0 * dt);
      p.vx *= f; p.vy *= f;
      p.ox += p.vx * dt; p.oy += p.vy * dt;
      const s = a < p.t1 ? 0 : (a - p.t1) / (p.t2 - p.t1), e = s < 0.5 ? 4 * s * s * s : 1 - Math.pow(2 - 2 * s, 3) / 2;
      p.x = p.ox + (p.tx - p.ox) * e;
      p.y = p.oy + (p.ty - p.oy) * e;
      p.da = Math.min(1, 0.15 + a * 4);
    } else if (a < p.t3) {              // hold, twinkling
      p.x = p.tx; p.y = p.ty;
      p.da = Math.random() < 0.2 ? 0.4 : 1;
    } else {                            // release: fall and fade
      if (!p.ph) { p.ph = 1; p.vx = rand(-18, 18); p.vy = rand(-25, 15); }
      const f = 1 / (1 + 1.2 * dt);
      p.vx *= f;
      p.vy = p.vy * f + p.g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.da = fadeA(p) * (Math.random() < 0.15 ? 0.4 : 1);
    }
    return p.y < H + 30;
  }

  function stepGlint(p, dt) {
    p.vy += p.g * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.rot += p.vr * dt;
    const u = p.age / p.life;
    p.scale = u < 0.2 ? u / 0.2 : 1 - (u - 0.2);       // pop in fast, then shrink
    p.da = fadeA(p);
    return true;
  }

  function update(dt) {
    simT += dt;
    for (let i = 0; i < emitters.length; i++) if (emitters[i].step(emitters[i], dt)) emitters.splice(i--, 1);
    ambientStep(dt);
    for (let i = 0; i < nLive; i++) {
      const p = live[i], t = p.type;
      p.age += dt;
      const ok = t === T_SPARK ? stepSpark(p, dt) : t === T_ROCKET ? stepRocket(p, dt) : t === T_TEXT ? stepText(p, dt)
        : t === T_GLINT ? stepGlint(p, dt) : stepPiece(p, dt);
      if (!ok || p.age >= p.life) killAt(i--);
    }
    for (let i = glows.length - 1; i >= 0; i--) if ((glows[i].age += dt) >= GLOW_LIFE) glows.splice(i, 1);
  }

  /* ------------------------------------------------------------------ draw */

  // Append one spark's trail to the current path: the older half (tail) or newer half (head).
  function trace(c, p, head) {
    const hn = p.hn, hm = p.hm, h = p.hist;
    if (!hn) return;
    let k = head ? hn >> 1 : 0, idx = (p.hi - hn + k + hm) % hm;
    c.moveTo(h[idx * 2], h[idx * 2 + 1]);
    for (const k1 = head ? hn - 1 : hn >> 1; k < k1; k++) {
      idx = idx + 1 === hm ? 0 : idx + 1;
      c.lineTo(h[idx * 2], h[idx * 2 + 1]);
    }
    if (head) c.lineTo(p.x, p.y);
  }

  // Sparks, rockets and text sparks: counting-sort trail segments into (colour, alpha level, width)
  // buckets, stroke each bucket once with 'lighter', then add the glowing heads in colour order.
  function drawSparks(c) {
    bCount.fill(0);
    let ne = 0;
    for (let i = 0; i < nLive; i++) {
      const p = live[i], t = p.type;
      if ((t !== T_SPARK && t !== T_ROCKET && t !== T_TEXT) || p.da < 0.02) continue;
      let key = (p.c * AL + Math.min(AL - 1, (p.da * AL) | 0)) * WC + p.wc;
      ekeys[ne] = key; ents[ne++] = i * 2 + 1; bCount[key]++;
      if (p.hn > 2) {                   // dimmer, thinner tail
        key = (p.c * AL + Math.min(AL - 1, (p.da * 0.4 * AL) | 0)) * WC + (p.wc ? p.wc - 1 : 0);
        ekeys[ne] = key; ents[ne++] = i * 2; bCount[key]++;
      }
    }
    if (!ne) return;
    for (let b = 0, s = 0; b < NB; b++) { bEnd[b] = s; s += bCount[b]; }
    for (let e = 0; e < ne; e++) sorted[bEnd[ekeys[e]]++] = ents[e];
    c.lineCap = c.lineJoin = 'round';
    for (let b = 0; b < NB; b++) {
      const n = bCount[b], end = bEnd[b];
      if (!n) continue;
      c.globalAlpha = ((((b / WC) | 0) % AL) + 1) / AL;
      c.strokeStyle = colors[(b / (WC * AL)) | 0].css;
      c.lineWidth = WIDTHS[b % WC];
      c.beginPath();
      for (let j = end - n; j < end; j++) trace(c, live[sorted[j] >> 1], sorted[j] & 1);
      c.stroke();
    }
    for (let j = 0; j < ne; j++) {
      const v = sorted[j], p = live[v >> 1], s = p.dot;
      if (!(v & 1) || !s || (quality < 0.6 && p.type === T_SPARK && s < 8)) continue;
      c.globalAlpha = p.da;
      c.drawImage(colors[p.c].dot || dotSprite(p.c), p.x - s / 2, p.y - s / 2, s, s);
    }
  }

  // Confetti, emoji and glints: setTransform + fillRect / arc / sprite; confetti flips in 3D by
  // scaling one local axis with cos(flip), and is shaded by how face-on it is.
  function drawPieces(c, glints) {
    const d = dpr;
    for (let i = 0; i < nLive; i++) {
      const p = live[i], t = p.type;
      if ((glints ? t !== T_GLINT : t !== T_CONF && t !== T_SPRITE) || p.da < 0.01) continue;
      const cr = Math.cos(p.rot), sr = Math.sin(p.rot);
      c.globalAlpha = p.da;
      if (t !== T_CONF) {
        const s = p.scale * d, hw = p.w / 2;
        c.setTransform(cr * s, sr * s, -sr * s, cr * s, p.x * d, p.y * d);
        c.drawImage(p.img, -hw, -hw, p.w, p.w);
        continue;
      }
      const fl = Math.cos(p.flip), col = colors[p.c];
      c.setTransform(cr * d, sr * d, -sr * fl * d, cr * fl * d, p.x * d, p.y * d);
      if (p.shape === S_RECT || p.shape === S_CIRCLE) {
        c.fillStyle = col.shades[(fl < 0 ? 4 : 0) + Math.min(3, (Math.abs(fl) * 4) | 0)];
        if (p.shape === S_RECT) c.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        else { c.beginPath(); c.arc(0, 0, p.w, 0, TAU); c.fill(); }
      } else {
        c.drawImage((p.shape === S_RIBBON ? col.rib : col.star)[fl < 0 ? 1 : 0], -p.w / 2, -p.h / 2, p.w, p.h);
      }
    }
  }

  function draw() {
    const c = ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalCompositeOperation = 'source-over';
    c.globalAlpha = 1;
    c.clearRect(0, 0, canvas.width, canvas.height);
    if (!nLive && !glows.length) return;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.globalCompositeOperation = 'lighter';
    let sum = 0;                        // combined glow alpha never exceeds GLOW_ALPHA
    for (let i = 0; i < glows.length; i++) sum += Math.pow(1 - glows[i].age / GLOW_LIFE, 2);
    for (let i = 0; i < glows.length; i++) {
      const g = glows[i], u = g.age / GLOW_LIFE, r = g.r * (0.8 + 0.2 * u);
      c.globalAlpha = (GLOW_ALPHA / Math.max(1, sum)) * (1 - u) * (1 - u);
      c.drawImage(g.img, g.x - r, g.y - r, r * 2, r * 2);
    }
    drawSparks(c);
    c.globalCompositeOperation = 'source-over';
    drawPieces(c, false);
    c.globalCompositeOperation = 'lighter';
    drawPieces(c, true);
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalCompositeOperation = 'source-over';
    c.globalAlpha = 1;
  }

  /* ------------------------------------------------------------------ loop */

  const hasWork = () => nLive > 0 || glows.length > 0 || emitters.length > 0 || (!reduced && ambientReq > 0);

  function frame(t) {
    raf = 0;
    if (!ready || userPaused || hidden) return;
    let dt = 1 / 60;
    if (lastT >= 0) {
      const raw = (t - lastT) / 1000;
      dt = raw > 0 ? Math.min(raw, 0.05) : 1 / 240;    // clamp so a resumed tab doesn't explode
      if (raw > 0 && raw < 0.1) {                      // rolling frame time (one-off hitches ignored)
        ftAvg += (Math.min(raw * 1000, 50) - ftAvg) * 0.05;
        quality = ftAvg > 22 ? Math.max(0.4, quality - dt * 0.6) : ftAvg < 19 ? Math.min(1, quality + dt * 0.04) : quality;
      }
    }
    lastT = t;
    inFrame = true;
    try { update(dt); } catch (e) { report(e); }
    inFrame = false;
    flushHooks();
    try { draw(); } catch (e) { report(e); }
    if (hasWork()) raf = requestAnimationFrame(frame);
  }

  // Start the loop if there is work; it stops itself (fully idle) once there is none.
  function kick() {
    if (!ready || raf || userPaused || hidden || !hasWork()) return;
    lastT = -1;
    ftAvg = 16.7;
    raf = requestAnimationFrame(frame);
  }

  function stopLoop() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  function resize() {
    W = canvas.clientWidth || window.innerWidth || 1;
    H = canvas.clientHeight || window.innerHeight || 1;
    dpr = Math.min(window.devicePixelRatio || 1, 2);   // hard cap on the backing store
    const bw = Math.max(1, Math.round(W * dpr)), bh = Math.max(1, Math.round(H * dpr));
    if (canvas.width !== bw || canvas.height !== bh) { canvas.width = bw; canvas.height = bh; }
  }

  function setReduced(on) {
    reduced = !!on;
    if (reduced) {                      // stop motion-heavy emitters; live particles just finish
      emitters.forEach((e) => { if (e.kind === 'rain' || e.kind === 'show') { e.done = true; if (e.d.owner) e.d.owner.done = true; } });
    }
  }

  const mql = (q) => { try { return window.matchMedia ? window.matchMedia(q) : null; } catch (e) { return null; } };

  function bind() {
    bound = true;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => { try { resize(); kick(); } catch (e) { report(e); } }, 150);
    });
    document.addEventListener('visibilitychange', () => {
      hidden = !!document.hidden;
      if (hidden) stopLoop(); else kick();
    });
    const mq = mql('(prefers-reduced-motion: reduce)');
    const onChange = (e) => { if (followMedia && ready) { setReduced(e.matches); kick(); } };
    if (mq && mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq && mq.addListener) mq.addListener(onChange);
  }

  /* ------------------------------------------------------------------- API */

  function init(cv, opts) {
    try {
      if (typeof cv === 'string') cv = document.querySelector(cv);
      if (!cv || typeof cv.getContext !== 'function') cv = document.getElementById('fx');
      const c2 = cv && typeof cv.getContext === 'function' ? cv.getContext('2d') : null;
      if (!c2) return api;
      canvas = cv;
      ctx = c2;
      if (!colors.length) Object.keys(P).forEach((k) => { C[k] = colorId(P[k]); });
      const coarse = mql('(pointer: coarse)');
      cap = coarse && coarse.matches ? 600 : 1100;
      lowCap = Math.round(cap * 0.85);
      if (!bound) bind();
      resize();
      hidden = !!document.hidden;
      followMedia = !(opts && typeof opts.reducedMotion === 'boolean');
      const mq = mql('(prefers-reduced-motion: reduce)');
      setReduced(followMedia ? !!(mq && mq.matches) : opts.reducedMotion);
      ready = true;
      if (document.fonts && document.fonts.load) document.fonts.load(textFont(64)).catch(noop);
      setTimeout(() => {                // warm the sprite cache off the critical path
        try { RAIN.forEach(glyphSprite); HEARTS.forEach((k) => heartSprite(C[k])); } catch (e) { report(e); }
      }, 300);
      kick();
    } catch (e) { report(e); }
    return api;
  }

  // Public methods never throw and are harmless no-ops before init().
  function guard(fn, fallback) {
    return function () {
      if (!ready) return fallback;
      try {
        const r = fn.apply(null, arguments);
        kick();
        return r === undefined ? fallback : r;
      } catch (e) { report(e); return fallback; }
    };
  }

  function clear() {
    while (nLive) killAt(nLive - 1);
    glows.length = emitters.length = hooks.length = 0;
    reserve = 0;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  const api = {
    init: init,
    burst: guard(burst),
    cannons: guard(cannons),
    firework: guard(firework),
    fireworksShow: guard(fireworksShow, noop),
    textFirework: guard(textFirework),
    sparkle: guard(sparkle),
    emoji: guard(emojiBurst),
    hearts: guard(hearts),
    rain: guard(rain, noop),
    setAmbient: guard((level) => { ambientReq = clamp(Math.round(num(level, 0)), 0, 2); }),
    setReducedMotion: guard((on) => { followMedia = false; setReduced(on); }),
    pause: guard(() => { userPaused = true; stopLoop(); }),
    resume: guard(() => { userPaused = false; }),
    clear: guard(clear),
    count: guard(() => nLive, 0),
    onExplode: null,
    onLaunch: null
  };

  window.KennyFX = api;
})();
