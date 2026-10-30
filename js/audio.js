/*
 * Kenny's birthday page: every sound is synthesized live with the Web Audio API (no files).
 * Exposes one global, window.KennyAudio (API at the bottom of this file).
 *
 *   voices -> music / sfx bus -> master gain -> compressor (gentle limiter) -> speakers
 *         \-> reverb send -> convolver (generated impulse response) -> master
 *
 * Every synth has the shape fn(ctx, out, when, opts), so it renders just as well into an
 * OfflineAudioContext (KennyAudio._dev.render, used for QA).
 */
(function () {
  'use strict';

  var AC = window.AudioContext || window.webkitAudioContext;
  var OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  var MASTER = 1;              // master gain when not muted
  var LEAD = 0.012;            // scheduling headroom for one-shots (s)

  var ctx = null;              // the live AudioContext, created lazily by unlock()
  var G = null;                // its graph: { master, music, sfx, verb }
  var unlocked = false, muted = false, song = null;

  // ------------------------------------------------------------------ helpers
  function noop() {}
  function clamp(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }
  function rand(lo, hi) { return lo + Math.random() * (hi - lo); }
  function mtof(m) { return 440 * Math.pow(2, (m - 69) / 12); }
  function num(x, dflt) { x = parseFloat(x); return isFinite(x) ? x : dflt; }
  function wire(nodes) { for (var i = 1; i < nodes.length; i++) nodes[i - 1].connect(nodes[i]); }
  function quiet(p) { if (p && p.catch) p.catch(noop); }       // swallow a promise rejection
  function call(fn, arg) {                                      // run page callbacks, report bugs async
    if (typeof fn !== 'function') return;
    try { fn(arg); } catch (e) { setTimeout(function () { throw e; }, 0); }
  }
  function filter(c, type, freq, q) {
    var f = c.createBiquadFilter();
    f.type = type; f.frequency.value = freq;
    if (q != null) f.Q.value = q;
    return f;
  }
  // Plucked envelope: linear attack, then exponential decay; t60 = seconds to fall 60 dB.
  function pluck(param, when, peak, attack, t60) {
    param.setValueAtTime(0, when);
    param.linearRampToValueAtTime(peak, when + attack);
    param.setTargetAtTime(0, when + attack, t60 / 6.9);
  }
  // Click-free move of a gain from its current value.
  function glide(c, param, value, secs) {
    var t = c.currentTime;
    param.cancelScheduledValues(t);
    param.setValueAtTime(param.value, t);
    param.linearRampToValueAtTime(value, t + secs);
  }

  // ----------------------------------------------- shared buffers (per context)
  var cache = new WeakMap();
  function res(c) {
    var r = cache.get(c);
    if (!r) { r = { noise: makeNoise(c), ir: makeImpulse(c, 2.2, 1.9), crackle: null }; cache.set(c, r); }
    return r;
  }
  function makeNoise(c) {                       // 1 s of white noise, looped from random offsets
    var n = c.sampleRate, b = c.createBuffer(1, n, n), d = b.getChannelData(0);
    for (var i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }
  // Reverb impulse response: stereo noise with an exponential decay (t60 seconds) that also
  // grows darker as it fades (a one-pole lowpass closing over time), like air soaking up highs.
  function makeImpulse(c, secs, t60) {
    var rate = c.sampleRate, len = Math.floor(rate * secs), b = c.createBuffer(2, len, rate);
    for (var ch = 0; ch < 2; ch++) {
      var d = b.getChannelData(ch), lp = 0;
      for (var i = 0; i < len; i++) {
        var t = i / rate;
        lp += (0.92 - 0.75 * t / secs) * (Math.random() * 2 - 1 - lp);
        d[i] = lp * Math.exp(-6.9 * t / t60) * Math.min(1, t / 0.006);
      }
    }
    return b;
  }
  // Firework crackle (1.3 s, mono): a thinning Poisson stream of tiny noise ticks and high
  // sine glints, rendered once so that every boom's tail costs a single buffer source.
  function crackle(c) {
    var r = res(c);
    if (r.crackle) return r.crackle;
    var rate = c.sampleRate, len = Math.floor(rate * 1.3), b = c.createBuffer(1, len, rate);
    var d = b.getChannelData(0), t = 0.01, peak = 0, i, k;
    for (;;) {
      t += -Math.log(1 - Math.random()) / (60 * Math.exp(-2.4 * t) + 4);
      if (t > 1.2) break;
      var i0 = Math.floor(t * rate), amp = (0.3 + 0.7 * Math.random()) * Math.exp(-1.6 * t);
      if (Math.random() < 0.65) {
        var n = Math.floor(rate * rand(0.001, 0.004));
        for (k = 0; k < n && i0 + k < len; k++) d[i0 + k] += amp * (Math.random() * 2 - 1) * Math.exp(-4 * k / n);
      } else {
        var w = 2 * Math.PI * rand(3000, 7500) / rate, m = Math.floor(rate * rand(0.008, 0.025));
        for (k = 0; k < m && i0 + k < len; k++) d[i0 + k] += 0.6 * amp * Math.sin(w * k) * Math.exp(-5 * k / m);
      }
    }
    for (var x1 = 0, y1 = 0, j = 0; j < len; j++) {     // DC-blocking highpass, then normalise
      y1 = 0.97 * (y1 + d[j] - x1); x1 = d[j]; d[j] = y1;
      peak = Math.max(peak, Math.abs(y1));
    }
    for (i = 0; i < len && peak > 0; i++) d[i] *= 0.9 / peak;
    return (r.crackle = b);
  }

  // -------------------------------------------------------------------- graph
  function buildGraph(c, level) {
    var g = { master: c.createGain(), music: c.createGain(), sfx: c.createGain(), verb: c.createGain() };
    var comp = c.createDynamicsCompressor(), conv = c.createConvolver(), trim = c.createGain();
    comp.threshold.value = -9;      // gentle limiter: leaves single sounds alone and
    comp.knee.value = 6;            // holds stacks of booms just under full scale...
    comp.ratio.value = 12;
    comp.attack.value = 0.002;
    comp.release.value = 0.2;
    conv.buffer = res(c).ir;
    g.master.gain.value = level;
    g.music.connect(g.master);
    g.sfx.connect(g.master);
    wire([g.verb, conv, g.master]);
    trim.gain.value = 0.78;         // ...then this offsets its built-in make-up gain: peaks ~-3 dBFS
    wire([g.master, comp, trim, c.destination]);
    return g;
  }

  // A voice is a tiny sub-graph ending in `out` (optionally panned, optionally sent to the
  // reverb). Sources started with v.play() disconnect themselves and their private nodes when
  // they end; the voice's shared nodes go with the last source, so nothing lingers.
  function voice(c, out, gain, o) {
    o = o || {};
    var input = c.createGain(), tail = input, shared = [input], live = 0;
    input.gain.value = gain;
    if (o.pan && c.createStereoPanner) {
      tail = c.createStereoPanner();
      tail.pan.value = clamp(o.pan, -1, 1);
      input.connect(tail); shared.push(tail);
    }
    tail.connect(out);
    if (o.verb && o.wet) {
      var send = c.createGain();
      send.gain.value = o.wet;
      wire([tail, send, o.verb]); shared.push(send);
    }
    return {
      c: c, input: input,
      own: function (node) { shared.push(node); return node; },
      play: function (src, when, stop, chain, offset) {
        live++;
        src.onended = function () {
          src.disconnect();
          for (var i = 0; i < chain.length; i++) chain[i].disconnect();
          if (--live === 0) for (i = 0; i < shared.length; i++) shared[i].disconnect();
        };
        src.start(when, offset || 0);
        src.stop(stop);
        if (o.reg) o.reg.push(src);         // the song keeps handles so stopSong() can cut them
      }
    };
  }
  function noise(v) {
    var s = v.c.createBufferSource();
    s.buffer = res(v.c).noise; s.loop = true;
    return s;
  }
  // A sine partial with a plucked envelope.
  function partial(v, freq, when, level, t60, cents) {
    var o = v.c.createOscillator(), g = v.c.createGain();
    o.frequency.value = freq;
    if (cents) o.detune.value = cents;
    pluck(g.gain, when, level, 0.002, t60);
    wire([o, g, v.input]);
    v.play(o, when, when + t60 * 1.15, [g]);
  }

  // --------------------------------------------------------------- music box
  // A plucked steel tine, sine partials only: the fundamental plus a twin a few cents sharp
  // (their slow beating is the shimmer), a 2nd harmonic that dies faster, and the inharmonic
  // bending modes of a clamped bar (2.76x, 5.4x, 8.93x) that ring for only a moment.
  var TINE = [[1, 1, 1], [2, 0.3, 0.45], [2.76, 0.16, 0.12], [5.4, 0.08, 0.06], [8.93, 0.045, 0.035]];
  function tineT60(f) { return clamp(2.2 - 0.6 * Math.log(f / 392) / Math.LN2, 1, 2.2); } // G4 2.2 s .. G6 1 s

  function tine(c, out, when, freq, vel, o) {
    o = o || {};
    var t60 = o.t60 || tineT60(freq), v = voice(c, out, 0.2 * vel, o), top = c.sampleRate * 0.45;
    for (var i = 0; i < (o.lite ? 3 : 5) && freq * TINE[i][0] < top; i++) {
      partial(v, freq * TINE[i][0], when, TINE[i][1], t60 * TINE[i][2], 0);
    }
    partial(v, freq, when, 0.4, t60 * 1.1, rand(3, 5));
    if (o.click !== 0) {                     // the pin snapping off the tine: a tiny bright tick
      var s = noise(v), hp = filter(c, 'highpass', 5000, 0.7), g = c.createGain();
      pluck(g.gain, when, o.click || 0.12, 0.0005, 0.02);
      wire([s, hp, g, v.input]);
      v.play(s, when, when + 0.03, [hp, g], Math.random() * 0.9);
    }
  }

  // ---------------------------------------------------------------- one-shots
  // All take (ctx, out, when, o) where o = { verb, pan, size, big, level }.
  function vo(o, pan, wet) { return { pan: pan, verb: o.verb, wet: wet }; }

  // Balloon pop: a bright noise crack plus a tiny rubbery snap (a fast falling blip).
  function pop(c, out, when, o) {
    var k = rand(0.85, 1.2), v = voice(c, out, 0.75, vo(o, rand(-0.2, 0.2), 0.08));
    var s = noise(v), hp = filter(c, 'highpass', 800 * k, 0.7), pk = filter(c, 'peaking', 2600 * k, 1);
    var g = c.createGain();
    pk.gain.value = 6;
    pluck(g.gain, when, 1, 0.0006, 0.09);
    wire([s, hp, pk, g, v.input]);
    v.play(s, when, when + 0.12, [hp, pk, g], rand(0, 0.9));
    var sn = c.createOscillator(), sg = c.createGain();
    sn.frequency.setValueAtTime(1000 * k, when);
    sn.frequency.exponentialRampToValueAtTime(150 * k, when + 0.04);
    pluck(sg.gain, when, 0.45, 0.001, 0.07);
    wire([sn, sg, v.input]);
    v.play(sn, when, when + 0.09, [sg]);
  }

  // Brass stab: detuned sawtooth pairs through a lowpass that flares open on the attack, a
  // little scoop up into pitch, and (on long notes) delayed vibrato. Used for the ta-DA.
  function brass(c, v, when, notes, dur, bright, vib) {
    var lp = v.own(filter(c, 'lowpass', 300, 1.4)), env = v.own(c.createGain()), depth = null;
    var end = when + dur + 0.4, f = lp.frequency, a = env.gain;
    f.setValueAtTime(300, when);
    f.exponentialRampToValueAtTime(bright, when + 0.035);
    f.exponentialRampToValueAtTime(bright * 0.5, when + 0.3);
    a.setValueAtTime(0, when);
    a.linearRampToValueAtTime(1, when + 0.02);
    a.setTargetAtTime(0.65, when + 0.02, 0.1);
    a.setTargetAtTime(0, when + dur, 0.07);
    wire([lp, env, v.input]);
    if (vib) {
      var lfo = c.createOscillator();
      depth = v.own(c.createGain());
      lfo.frequency.value = 5.5;
      depth.gain.setValueAtTime(0, when + 0.15);
      depth.gain.linearRampToValueAtTime(14, when + 0.5);      // cents
      lfo.connect(depth);
      v.play(lfo, when, end, []);
    }
    for (var i = 0; i < notes.length; i++) {
      for (var j = -1; j <= 1; j += 2) {
        var s = c.createOscillator();
        s.type = 'sawtooth';
        s.frequency.value = mtof(notes[i]);
        s.detune.setValueAtTime(j * 6 - 35, when);
        s.detune.linearRampToValueAtTime(j * 6, when + 0.06);
        if (depth) depth.connect(s.detune);
        s.connect(lp);
        v.play(s, when, end, []);
      }
    }
  }
  // "ta-DA!": a short stab, then a longer, brighter, wider chord with a splash of shimmer.
  function tada(c, out, when, o) {
    brass(c, voice(c, out, 0.09, vo(o, 0, 0.12)), when, [55, 60, 64, 67], 0.11, 2200, false);
    var t = when + 0.17, v = voice(c, out, 0.08, vo(o, 0, 0.2));
    brass(c, v, t, [48, 60, 64, 67, 72, 76], 0.95, 5200, true);
    var s = noise(v), hp = filter(c, 'highpass', 6500, 0.7), g = c.createGain();
    pluck(g.gain, t, 1.6, 0.004, 0.9);
    wire([s, hp, g, v.input]);
    v.play(s, t, t + 1.1, [hp, g], rand(0, 0.9));
  }

  // Party blower: a buzzy reed (saw + square) through a nasal formant, fluttering at ~24 Hz
  // as the paper tube unrolls, swelling and bending up at the end: brrrrRRRT!
  function partyHorn(c, out, when, o) {
    var v = voice(c, out, 0.115, vo(o, 0, 0.06)), f0 = rand(320, 360), end = when + 0.95;
    var hp = v.own(filter(c, 'highpass', 250, 0.7)), pk = v.own(filter(c, 'peaking', 1300, 2));
    var lp = v.own(filter(c, 'lowpass', 3800, 0.8)), flut = v.own(c.createGain()), env = v.own(c.createGain());
    var lfo = c.createOscillator(), lfoAmp = v.own(c.createGain()), lfoPitch = v.own(c.createGain());
    pk.gain.value = 9;
    flut.gain.value = 0.6; lfoAmp.gain.value = 0.4; lfoPitch.gain.value = 30;   // flutter depth
    lfo.frequency.setValueAtTime(20, when);
    lfo.frequency.linearRampToValueAtTime(30, end);
    wire([lfo, lfoAmp]); lfoAmp.connect(flut.gain); lfo.connect(lfoPitch);
    env.gain.setValueAtTime(0, when);
    env.gain.linearRampToValueAtTime(0.55, when + 0.04);
    env.gain.linearRampToValueAtTime(1, when + 0.7);
    env.gain.setValueAtTime(1, end - 0.04);
    env.gain.linearRampToValueAtTime(0, end);
    wire([hp, pk, lp, flut, env, v.input]);
    ['sawtooth', 'square'].forEach(function (type, i) {
      var s = c.createOscillator(), f = s.frequency;
      s.type = type;
      s.detune.value = i ? 7 : -7;
      f.setValueAtTime(f0 * 0.88, when);
      f.exponentialRampToValueAtTime(f0, when + 0.08);
      f.setValueAtTime(f0, when + 0.5);
      f.exponentialRampToValueAtTime(f0 * 1.4, end - 0.05);
      lfoPitch.connect(s.detune);
      s.connect(hp);
      v.play(s, when, end + 0.02, []);
    });
    v.play(lfo, when, end + 0.02, []);
  }

  // Firework: a deep sine thump with falling pitch, a noise burst whose lowpass closes as it
  // fades and, a beat later, the pre-rendered crackle. About ten nodes per boom.
  function boom(c, out, when, o) {
    var size = o.size, v = voice(c, out, 0.4 + 0.3 * size, vo(o, o.pan * 0.8, 0.15));
    var th = c.createOscillator(), tg = c.createGain(), d = 0.3 + 0.35 * size;
    th.frequency.setValueAtTime(rand(90, 125), when);
    th.frequency.exponentialRampToValueAtTime(36, when + d);
    pluck(tg.gain, when, 0.9, 0.005, d * 2);
    wire([th, tg, v.input]);
    v.play(th, when, when + d * 2.3, [tg]);
    var s = noise(v), lp = filter(c, 'lowpass', 3000, 0.5), ng = c.createGain(), nd = 0.6 + 0.8 * size;
    lp.frequency.setValueAtTime(2200 + 2400 * size, when);
    lp.frequency.exponentialRampToValueAtTime(220, when + nd);
    pluck(ng.gain, when, 0.75, 0.003, nd);
    wire([s, lp, ng, v.input]);
    v.play(s, when, when + nd * 1.1, [lp, ng], rand(0, 0.9));
    var cr = c.createBufferSource(), cg = c.createGain(), t2 = when + rand(0.22, 0.4);
    cr.buffer = crackle(c);
    cr.playbackRate.value = rand(0.85, 1.2);
    cg.gain.value = 0.25 + 0.3 * size;
    wire([cr, cg, v.input]);
    v.play(cr, t2, t2 + 1.6, [cg]);
  }

  // Rocket launch: a whoosh (noise through a rising bandpass) with a thin whistle on top.
  function launch(c, out, when, o) {
    var v = voice(c, out, 0.95, vo(o, o.pan, 0.1)), dur = rand(0.8, 1), end = when + dur;
    var s = noise(v), bp = filter(c, 'bandpass', 500, 2.2), g = c.createGain();
    bp.frequency.setValueAtTime(500, when);
    bp.frequency.exponentialRampToValueAtTime(3200, end);
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(1, when + dur * 0.35);
    g.gain.linearRampToValueAtTime(0, end);
    wire([s, bp, g, v.input]);
    v.play(s, when, end + 0.01, [bp, g], rand(0, 0.9));
    var w = c.createOscillator(), wg = c.createGain(), f = rand(800, 1000);
    w.frequency.setValueAtTime(f, when);
    w.frequency.exponentialRampToValueAtTime(f * 2.8, end);
    wg.gain.setValueAtTime(0, when);
    wg.gain.linearRampToValueAtTime(0.1, when + dur * 0.5);
    wg.gain.linearRampToValueAtTime(0, end);
    wire([w, wg, v.input]);
    v.play(w, when, end + 0.01, [wg]);
  }

  // Slot-reel tick: 3 ms of noise through a resonant bandpass, like a pawl clicking a tooth.
  function tick(c, out, when) {
    var v = voice(c, out, 1.2), s = noise(v), bp = filter(c, 'bandpass', rand(2600, 3400), 3), g = c.createGain();
    pluck(g.gain, when, 1, 0.0003, 0.02);
    wire([s, bp, g, v.input]);
    v.play(s, when, when + 0.03, [bp, g], rand(0, 0.9));
  }

  // Slot chime: bright music-box bells. A rising "ding-ding", or for a jackpot an arpeggio
  // up two octaves, a held chord and a sparkle.
  function ding(c, out, when, o) {
    var w = { verb: o.verb, wet: 0.5, t60: 1.6 }, i;
    if (!o.big) {
      tine(c, out, when, mtof(88), 1, w);
      tine(c, out, when + 0.09, mtof(96), 0.9, w);
      return;
    }
    var arp = [72, 76, 79, 84, 88, 91, 96], t = when + arp.length * 0.065 + 0.05;
    for (i = 0; i < arp.length; i++) tine(c, out, when + i * 0.065, mtof(arp[i]), 0.75 + 0.04 * i, w);
    w = { verb: o.verb, wet: 0.5, t60: 2.2 };
    [84, 88, 91, 96].forEach(function (m) { tine(c, out, t, mtof(m), 0.6, w); });
    sparkle(c, out, t + 0.1, { verb: o.verb, level: 0.7 });
  }

  // Rubber stamp / wax seal: a heavy thud (falling sine + dark noise) and, a few ms in,
  // the bright slap of paper.
  function stamp(c, out, when, o) {
    var v = voice(c, out, 0.8, vo(o, 0, 0.08));
    var th = c.createOscillator(), tg = c.createGain();
    th.frequency.setValueAtTime(150, when);
    th.frequency.exponentialRampToValueAtTime(48, when + 0.09);
    pluck(tg.gain, when, 1, 0.002, 0.25);
    wire([th, tg, v.input]);
    v.play(th, when, when + 0.3, [tg]);
    var s = noise(v), lp = filter(c, 'lowpass', 600, 0.8), ng = c.createGain();
    pluck(ng.gain, when, 0.8, 0.001, 0.12);
    wire([s, lp, ng, v.input]);
    v.play(s, when, when + 0.15, [lp, ng], rand(0, 0.9));
    var p = noise(v), bp = filter(c, 'bandpass', 2400, 0.9), pg = c.createGain(), t = when + 0.006;
    pluck(pg.gain, t, 0.6, 0.0008, 0.07);
    wire([p, bp, pg, v.input]);
    v.play(p, t, t + 0.09, [bp, pg], rand(0, 0.9));
  }

  // Candle puff: breathy band-limited noise that swells for 50 ms and sighs away.
  function blow(c, out, when, o) {
    var v = voice(c, out, 0.55, vo(o, 0, 0.1)), s = noise(v), g = c.createGain();
    var hp = filter(c, 'highpass', 350, 0.5), bp = filter(c, 'bandpass', 1600, 0.6);
    bp.frequency.setValueAtTime(1600, when);
    bp.frequency.exponentialRampToValueAtTime(700, when + 0.45);
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(1, when + 0.05);
    g.gain.setTargetAtTime(0, when + 0.08, 0.1);
    wire([s, hp, bp, g, v.input]);
    v.play(s, when, when + 0.6, [hp, bp, g], rand(0, 0.9));
  }

  // Comedic "wee-woo" alarm (1.2 s): square + triangle swooping between two pitches.
  function siren(c, out, when, o) {
    var v = voice(c, out, 0.115, vo(o, 0, 0.05)), end = when + 1.2;
    var lp = v.own(filter(c, 'lowpass', 2600, 0.7)), env = v.own(c.createGain());
    env.gain.setValueAtTime(0, when);
    env.gain.linearRampToValueAtTime(1, when + 0.02);
    env.gain.setValueAtTime(1, end - 0.06);
    env.gain.linearRampToValueAtTime(0, end);
    wire([lp, env, v.input]);
    ['square', 'triangle'].forEach(function (type, k) {
      var s = c.createOscillator(), f = s.frequency;
      s.type = type;
      s.detune.value = k ? 8 : -8;
      for (var i = 0; i < 4; i++) {
        var t = when + i * 0.3, wee = i % 2 === 0;
        f.setValueAtTime(wee ? 700 : 1000, t);
        f.exponentialRampToValueAtTime(wee ? 1000 : 700, t + 0.07);
      }
      s.connect(lp);
      v.play(s, when, end + 0.01, []);
    });
  }

  // "Wish granted": a quick rising pentatonic glissando of tiny bells sweeping left to
  // right over an airy swish, with plenty of reverb.
  function sparkle(c, out, when, o) {
    var notes = [84, 86, 88, 91, 93, 96, 98, 100, 103, 105, 108], n = notes.length;
    var lvl = num(o.level, 1), t = when;
    for (var i = 0; i < n; i++) {
      tine(c, out, t, mtof(notes[i]), lvl * (0.45 + 0.35 * i / n),
        { lite: true, t60: 0.9, click: 0, pan: -0.6 + 1.2 * i / (n - 1), verb: o.verb, wet: 0.8 });
      t += 0.075 * (1 - 0.4 * i / n);
    }
    var v = voice(c, out, 0.3 * lvl, vo(o, 0, 0.8)), s = noise(v), g = c.createGain();
    var bp = filter(c, 'bandpass', 2500, 1.2);
    bp.frequency.setValueAtTime(2500, when);
    bp.frequency.exponentialRampToValueAtTime(9000, when + 0.9);
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(1, when + 0.3);
    g.gain.linearRampToValueAtTime(0, when + 1);
    wire([s, bp, g, v.input]);
    v.play(s, when, when + 1.01, [bp, g], rand(0, 0.9));
  }

  // ----------------------------------------------------------------- the song
  // "Happy Birthday" (public-domain melody) in C, written an octave low: [syllable, MIDI, beats].
  var LINES = [
    ['Happy birthday to you', [['Hap', 67, 0.75], ['py', 67, 0.25], ['birth', 69, 1], ['day', 67, 1], ['to', 72, 1], ['you', 71, 2]]],
    ['Happy birthday to you', [['Hap', 67, 0.75], ['py', 67, 0.25], ['birth', 69, 1], ['day', 67, 1], ['to', 74, 1], ['you', 72, 2]]],
    ['Happy birthday dear Kenny', [['Hap', 67, 0.75], ['py', 67, 0.25], ['birth', 79, 1], ['day', 76, 1], ['dear', 72, 1], ['Ken', 71, 1], ['ny', 69, 1]]],
    ['Happy birthday to you', [['Hap', 77, 0.75], ['py', 77, 0.25], ['birth', 76, 1], ['day', 72, 1], ['to', 74, 1], ['you', 72, 3]]]
  ];
  // Waltz accompaniment in sounding pitch, [bass, tone, tone]: one chord per bar after the
  // pickup, or one per beat where the harmony moves inside the bar. Bar 8 is the rolled chord.
  var CHORDS = { C: [60, 64, 67], G7: [55, 65, 71], C7: [60, 64, 70], F: [53, 65, 69] };
  var BARS = ['C', 'G7', 'G7', 'C', 'C7', 'F', ['C', 'C', 'G7']];
  var SONG_LEAD = 0.12, BEAT = 0.6;          // s before the first note; quarter = 100 bpm

  // Rubato: linger a touch on pickups, on the phrase-ending "you"s and on the high "birth";
  // hold the fermata on "Ken-ny" about two beats; broaden steadily through the last line.
  function stretch(b) {
    if (b >= 17 && b < 18) return 2.1;
    if (b >= 18) return 1.03 + 0.35 * Math.pow((b - 18) / 7, 1.5);
    if (b >= 13 && b < 14) return 1.05;
    var p = b % 6;
    return p < 1 ? 1.03 : p >= 4 ? 1.05 : 0.985;
  }

  // Builds (once) the tine strikes and the per-syllable callbacks, in seconds from the top.
  var PLAN = null;
  function plan() {
    if (PLAN) return PLAN;
    var T = [0], ev = [], notes = [], beat = 0, total = 0, end = 0, q;
    for (q = 0; q < 26 * 4; q++) T.push(T[q] + BEAT / 4 * stretch(q / 4));
    function at(b) { return T[Math.round(b * 4)]; }
    function add(t, m, vel, x) {
      ev.push({ t: t, m: m, vel: vel, pan: x.pan || 0, lite: x.lite, click: x.click, t60: x.t60 });
      end = Math.max(end, t + 0.8 * (x.t60 || tineT60(mtof(m))));   // ~-48 dB: the song is over
    }
    LINES.forEach(function (l) { total += l[1].length; });
    LINES.forEach(function (l, line) {
      l[1].forEach(function (n) {
        var m = n[1] + 12, t = at(beat), index = notes.length;
        var vel = n[2] < 0.5 ? 0.72 : beat % 3 === 1 ? 1 : 0.88;      // soft "py", strong downbeats
        add(t, m, vel, { pan: (m - 84) / 40, t60: index === total - 1 ? 2.6 : n[0] === 'ny' ? 2.2 : 0 });
        notes.push({ t: t, info: { index: index, total: total, syllable: n[0], line: line, lineText: l[0],
          midi: m, duration: at(beat + n[2]) - t } });
        beat += n[2];
      });
    });
    BARS.forEach(function (bar, i) {                // oom-pah-pah, much softer than the tune
      for (var k = 0; k < 3; k++) {
        var ch = CHORDS[typeof bar === 'string' ? bar : bar[k]], t = at(1 + 3 * i + k);
        if (k === 0) { add(t, ch[0], 0.42, { pan: -0.15, lite: true }); continue; }
        add(t, ch[1], k === 1 ? 0.2 : 0.16, { pan: 0.15, lite: true, click: 0.05 });
        add(t + 0.012, ch[2], k === 1 ? 0.18 : 0.15, { pan: 0.25, lite: true, click: 0.05 });
      }
    });
    [48, 55, 60, 64, 67, 72, 76].forEach(function (m, i) {          // rolled final C chord
      add(at(22) + 0.05 * i, m, 0.24 + 0.03 * i, { pan: -0.3 + 0.1 * i, lite: true, t60: 2.4 });
    });
    [96, 100, 103, 108].forEach(function (m, i) {                   // and a tiny sparkle
      add(at(23.5) + 0.07 * i, m, 0.22, { pan: 0.1 * i, lite: true, click: 0, t60: 1.2 });
    });
    ev.sort(function (a, b) { return a.t - b.t; });
    return (PLAN = { ev: ev, notes: notes, end: end });
  }

  function songBus(c, g) {
    var bus = c.createGain(), send = c.createGain();
    bus.gain.value = 1.25;
    send.gain.value = 0.75;             // reverb send: wet about a third of dry, i.e. a 25 % wet mix
    bus.connect(g.music);
    wire([bus, send, g.verb]);
    return { bus: bus, send: send };
  }
  function strike(c, bus, t0, e, reg) {
    tine(c, bus, t0 + e.t, mtof(e.m), e.vel * rand(0.96, 1.04),
      { pan: e.pan, lite: e.lite, click: e.click, t60: e.t60, reg: reg });
  }
  // Seconds from ctx.currentTime until a sample actually leaves the speakers.
  function latency() {
    var l = (ctx.baseLatency || 0) + (ctx.outputLatency || 0);
    return l > 0 && l < 0.5 ? l : 0;
  }
  function emit(playing, reason) {
    try {
      window.dispatchEvent(new CustomEvent('kenny:song', { detail: { playing: playing, reason: reason } }));
    } catch (e) { /* ignore */ }
  }

  function playSong(opts) {
    if (!unlocked && !unlock()) return;
    var restart = !!song, sb;
    if (song) endSong('restart');
    sb = songBus(ctx, G);
    song = { opts: opts && typeof opts === 'object' ? opts : {}, p: plan(), bus: sb.bus, send: sb.send,
      ai: 0, ci: 0, timer: 0, reg: [], start: ctx.currentTime + SONG_LEAD + (restart ? 0.1 : 0) };
    emit(true, restart ? 'restart' : 'start');
    pump();
  }

  // Song scheduler: a lazy timer (no busy loop) that schedules strikes about a second ahead
  // on the audio clock and fires onNote as each syllable reaches the speakers. It re-reads
  // ctx.currentTime on every wake-up, so it stays in step even if the context is suspended.
  function pump() {
    var s = song;
    if (!s) return;
    s.timer = 0;
    try {
      var now = ctx.currentTime, L = latency(), ev = s.p.ev, cb = s.p.notes, next;
      while (s.ai < ev.length && s.start + ev[s.ai].t < now + 1) strike(ctx, s.bus, s.start, ev[s.ai++], s.reg);
      while (s.ci < cb.length && s.start + cb[s.ci].t + L <= now + 0.01) {
        var info = cb[s.ci++].info, copy = {};
        for (var k in info) copy[k] = info[k];
        call(s.opts.onNote, copy);
        if (song !== s) return;                     // the callback stopped or restarted it
      }
      next = s.start + s.p.end + L;
      if (s.ai >= ev.length && s.ci >= cb.length && now >= next) return endSong('end');
      if (s.ci < cb.length) next = Math.min(next, s.start + cb[s.ci].t + L);
      if (s.ai < ev.length) next = Math.min(next, s.start + ev[s.ai].t - 0.9);
      s.timer = setTimeout(pump, clamp((next - now) * 1000, 5, 250));
    } catch (e) {
      endSong('error');
    }
  }

  function endSong(reason) {
    var s = song;
    if (!s) return;
    song = null;
    clearTimeout(s.timer);
    if (reason !== 'end') {                         // fade out and cancel what's queued
      var t = ctx.currentTime;
      glide(ctx, s.bus.gain, 0, reason === 'restart' ? 0.08 : 0.15);
      for (var i = 0; i < s.reg.length; i++) {
        try { s.reg[i].stop(t + 0.16); } catch (e) { /* already gone */ }
      }
    }
    setTimeout(function () { s.bus.disconnect(); s.send.disconnect(); }, reason === 'end' ? 3000 : 500);
    emit(false, reason);
    if (reason === 'end' || reason === 'error') call(s.opts.onEnd);
  }

  // ------------------------------------------------------------ blow detector
  // Blowing on a phone mic makes loud, steady, noise-like (turbulent) energy, mostly below
  // ~1.5 kHz. Speech is harmonic (a peaky spectrum) and choppy, claps and plosives are brief,
  // and a test beep is a pure tone. About 30 times a second we measure:
  //   E     energy 80-1500 Hz (dB), against a running noise floor
  //   flat  spectral flatness 100-2500 Hz after removing the overall tilt (noise ~0.5, tones ~0)
  //   H     energy 3-8 kHz, where hiss and "sss" live (a blow is much stronger below)
  // A blow is 120 ms or more of frames with E well above the floor, a flat noise-like spectrum
  // and E beating H, that is not dying away like the room tail of a clap.
  var MIC_MSG = {
    unsupported: 'This browser can’t listen through the microphone here. Tap the candles to blow them out instead!',
    denied: 'No microphone access, no problem: tap the candles to blow them out instead!',
    nodevice: 'No microphone was found. Tap the candles to blow them out instead!',
    busy: 'The microphone is busy with another app. Tap the candles to blow them out instead!',
    locked: 'Tap the page once to wake up the sound, then try again.',
    error: 'The microphone didn’t start. Tap the candles to blow them out instead!'
  };
  function micError(reason, cause) {
    var e = new Error(MIC_MSG[reason]);
    e.name = 'KennyMicError';
    e.reason = reason;
    if (cause) e.cause = cause;
    return e;
  }
  function stopTracks(stream) {
    try { stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) { /* ignore */ }
  }

  function listenForBlow(o) {
    try {
      o = o && typeof o === 'object' ? o : {};
      var md = navigator.mediaDevices, session = navigator.audioSession, changed = false;
      if (!AC || !md || !md.getUserMedia) return Promise.reject(micError('unsupported'));
      if (!unlocked && !unlock()) return Promise.reject(micError('locked'));
      resume();
      // iOS (Safari 16.4+) needs a recording-capable audio session while the mic is open.
      try {
        if (session && session.type !== 'play-and-record') { session.type = 'play-and-record'; changed = true; }
      } catch (e) { /* ignore */ }
      var restore = function () {
        if (changed) { changed = false; try { session.type = 'playback'; } catch (e) { /* ignore */ } }
      };
      return new Promise(function (ok) {
        ok(md.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } }));
      }).then(function (stream) {
        try { return detect(stream, o, restore); } catch (e) { stopTracks(stream); restore(); throw micError('error', e); }
      }, function (err) {
        var n = err && err.name;
        restore();
        throw micError(/NotAllowed|Security|PermissionDenied/.test(n) ? 'denied'
          : /NotFound|DevicesNotFound|Overconstrained/.test(n) ? 'nodevice'
          : /NotReadable|TrackStart|Abort/.test(n) ? 'busy' : 'error', err);
      });
    } catch (e) {
      return Promise.reject(micError('error', e));
    }
  }

  function detect(stream, o, restore) {
    var src = ctx.createMediaStreamSource(stream), an = ctx.createAnalyser();
    an.fftSize = 2048;
    an.smoothingTimeConstant = 0;
    src.connect(an);                               // analysis only: never routed to the speakers
    var spec = new Float32Array(an.frequencyBinCount), hz = ctx.sampleRate / an.fftSize, DB = Math.LN10 / 10;
    var bin = function (f) { return clamp(Math.round(f / hz), 1, spec.length - 1); };
    var e0 = bin(80), e1 = bin(1500), f0 = bin(100), f1 = bin(2500), h0 = bin(3000), h1 = bin(8000);
    var n = f1 - f0 + 1, lu = new Float32Array(n), mu = 0, vu = 0, i;
    for (i = 0; i < n; i++) { lu[i] = Math.log(f0 + i); mu += lu[i] / n; }
    for (i = 0; i < n; i++) { lu[i] -= mu; vu += lu[i] * lu[i]; }     // centred log-frequency
    var t0 = performance.now(), last = 0, floor = null, peak = -300, run = 0, gap = 0;
    var lastBlow = -1e9, level = 0, raf = 0, dead = false;

    function band(a, b) {                          // summed power of bins a..b, in dB
      for (var s = 0, k = a; k <= b; k++) s += Math.exp(spec[k] * DB);
      return 10 * Math.log(s + 1e-30) / Math.LN10;
    }
    function frame(now) {
      if (dead) return;
      raf = requestAnimationFrame(frame);
      var dt = now - last;
      if (dt < 30) return;                         // ~30 analyses a second is plenty
      last = now;
      dt = Math.min(dt, 100);
      an.getFloatFrequencyData(spec);
      var E = band(e0, e1), H = band(h0, h1), mean = 0, cov = 0, acc = 0, k, x;
      // Flatness with the spectral tilt removed: fit dB against log(f), then compare the
      // geometric and arithmetic means of the residual power (which has a geometric mean of 1).
      for (k = 0; k < n; k++) { x = Math.max(spec[f0 + k], -200); mean += x / n; cov += x * lu[k]; }
      for (k = 0; k < n; k++) acc += Math.exp((Math.max(spec[f0 + k], -200) - mean - cov / vu * lu[k]) * DB);
      var flat = n / acc;

      if (floor === null) floor = E;
      var warm = now - t0 < 300, rel = E - floor;
      peak = Math.max(E, peak - 0.015 * dt);       // peak hold falling 15 dB/s
      var blowy = !warm && rel > 12 && E > -58 && flat > 0.28 && E > H + 6 && E > peak - 9;
      // Noise floor: drops fast, rises slowly, and barely moves while something blow-like is on.
      floor += (E - floor) * (warm ? 0.3 : E < floor ? 0.25 : blowy ? 0.004 : 0.03);
      if (blowy) { run += dt; gap = 0; } else if ((gap += dt) > 90) run = 0;

      level = Math.max(clamp((rel - 3) / 30, 0, 1), level * 0.8);
      call(o.onLevel, level);
      if (!dead && blowy && run >= 120 && now - lastBlow >= 250) {
        lastBlow = now;
        call(o.onBlow, 0.2 + 0.8 * clamp((rel - 12) / 24, 0, 1));
      }
    }
    function stop() {
      if (dead) return;
      dead = true;
      try { cancelAnimationFrame(raf); src.disconnect(); an.disconnect(); } catch (e) { /* ignore */ }
      stopTracks(stream);
      restore();
    }
    raf = requestAnimationFrame(frame);
    return { stop: stop };
  }

  // ---------------------------------------------------------- unlock & lifecycle
  function resume() {
    try { if (ctx && ctx.state !== 'running') quiet(ctx.resume()); } catch (e) { /* ignore */ }
  }
  function unlock() {
    try {
      if (!AC) return false;
      if (!ctx) {
        // Before any user gesture a new context could only start suspended and log an
        // autoplay warning, so wait for one (Safari < 16.4 has no userActivation: just try).
        var ua = navigator.userActivation;
        if (ua && !ua.hasBeenActive) return false;
        // Safari 16.4+: play through the ringer/silent switch like a media app.
        try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* ignore */ }
        ctx = new AC();
        G = buildGraph(ctx, muted ? 0 : MASTER);
        lifecycle();
      }
      if (!unlocked || ctx.state !== 'running') {
        resume();
        var s = ctx.createBufferSource();          // the classic iOS unlock: one silent sample
        s.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
        s.connect(ctx.destination);
        s.onended = function () { s.disconnect(); };
        s.start(0);
      }
      unlocked = true;
      return true;
    } catch (e) {
      return false;
    }
  }
  function lifecycle() {
    // iOS can leave the context 'interrupted' (calls, Siri, other apps) or 'suspended':
    // any later tap or key press brings it back.
    var wake = function () { if (!document.hidden) resume(); };
    ['pointerdown', 'touchend', 'keydown'].forEach(function (type) {
      window.addEventListener(type, wake, { passive: true, capture: true });
    });
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) return resume();
      try { quiet(ctx.suspend()); } catch (e) { /* ignore */ }   // a playing song pauses in place
    });
  }
  function setMuted(m) {
    muted = !!m;
    if (G) glide(ctx, G.master.gain, muted ? 0 : MASTER, 0.06);
    return muted;
  }

  // ---------------------------------------------------------------- one-shots
  // name: [synth, max voices sounding at once, min spacing (s), voice length (s)]
  var SFX = {
    pop: [pop, 8, 0.02, 0.15], tada: [tada, 2, 0.15, 1.6], partyHorn: [partyHorn, 2, 0.2, 1],
    boom: [boom, 6, 0, 2], launch: [launch, 6, 0.03, 1], tick: [tick, 3, 0.03, 0.03],
    ding: [ding, 4, 0.05, 1.6], stamp: [stamp, 3, 0.05, 0.3], blow: [blow, 3, 0.08, 0.6],
    siren: [siren, 1, 0.3, 1.2], sparkle: [sparkle, 3, 0.1, 1.8]
  };
  var busy = {};                                   // name -> [[start, end], ...]

  // Voice limiter: drop a call when too many of that sound are already sounding at its start
  // time, or the previous one started less than the minimum spacing earlier.
  function admit(name, t0) {
    var d = SFX[name], now = ctx.currentTime, keep = [], n = 0, ok = true;
    (busy[name] || []).forEach(function (v) {
      if (v[1] <= now) return;
      keep.push(v);
      if (Math.abs(v[0] - t0) < d[2]) ok = false;
      if (v[0] <= t0 && t0 < v[1]) n++;
    });
    if (ok && n < d[1]) keep.push([t0, t0 + d[3]]); else ok = false;
    busy[name] = keep;
    return ok;
  }
  function sfxOpts(name, arg, verb) {
    var o = { verb: verb, pan: 0, size: 0.6, delay: 0, big: false };
    if (arg && typeof arg === 'object') {
      o.pan = clamp(num(arg.pan, 0), -1, 1);
      o.size = clamp(num(arg.size, 0.6), 0, 1);
      o.delay = clamp(num(arg.delay, 0), 0, 10);
      o.big = !!arg.big;
    } else if (name === 'ding') {
      o.big = !!arg;
    }
    return o;
  }
  function oneShot(name) {
    return function (arg) {
      try {
        if (!unlocked || muted || document.hidden) return;   // nothing to hear: skip the work
        var o = sfxOpts(name, arg, G.verb), when = ctx.currentTime + LEAD + o.delay;
        if (admit(name, when)) SFX[name][0](ctx, G.sfx, when, o);
      } catch (e) { /* a sound effect must never break the page */ }
    };
  }

  // QA hook: render through a copy of the full chain into an OfflineAudioContext (44.1 kHz
  // stereo). `what` is 'song', an SFX name (with `arg`), or a list of [name, arg, atSeconds].
  function render(what, arg) {
    return new Promise(function (resolve, reject) {
      var list = typeof what === 'string' ? [[what, arg, 0]] : what, secs = 3.5, rate = 44100;
      list.forEach(function (j) {
        if (!OAC || !(j[0] === 'song' || SFX[j[0]])) throw new Error('Cannot render ' + j[0]);
        secs = Math.max(secs, (j[2] || 0) + (j[0] === 'song' ? SONG_LEAD + plan().end + 1.5 : 3.5));
      });
      var off = new OAC(2, Math.ceil(secs * rate), rate), g = buildGraph(off, MASTER);
      list.forEach(function (j) {
        var at = j[2] || 0;
        if (j[0] !== 'song') return SFX[j[0]][0](off, g.sfx, at + 0.05, sfxOpts(j[0], j[1], g.verb));
        var bus = songBus(off, g).bus;
        plan().ev.forEach(function (e) { strike(off, bus, at + SONG_LEAD, e, null); });
      });
      var p = off.startRendering();
      if (p && p.then) p.then(resolve, reject);
      else off.oncomplete = function (e) { resolve(e.renderedBuffer); };
    });
  }

  // --------------------------------------------------------------- public API
  var api = {
    unlock: unlock,
    isUnlocked: function () { return unlocked; },
    setMuted: function (m) { try { return setMuted(m); } catch (e) { return muted; } },
    isMuted: function () { return muted; },
    toggleMute: function () { try { setMuted(!muted); } catch (e) { /* ignore */ } return muted; },
    playSong: function (opts) { try { playSong(opts); } catch (e) { /* never throw */ } },
    stopSong: function () { try { endSong('stop'); } catch (e) { /* ignore */ } },
    isSongPlaying: function () { return !!song; },
    songDuration: function () { return SONG_LEAD + plan().end; },
    listenForBlow: listenForBlow,
    _dev: { render: render, plan: plan }
  };
  Object.keys(SFX).forEach(function (name) { api[name] = oneShot(name); });
  window.KennyAudio = api;
})();
