// ページの動き。文言は HTML 側に持ち、スクリプトが動かなくても最後の状態が読めるようにする
(() => {
  const root = document.documentElement;
  const lang = root.lang === "ja" ? "ja" : "en";
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const T = {
    en: { accepted: "Accepted", rejected: "Rejected. Nothing changes until you accept.", waiting: "Waiting for you" },
    ja: { accepted: "採用しました", rejected: "却下しました。採用するまで何も変わりません。", waiting: "あなたの判断待ち" },
  }[lang];

  // ---- ヒーロー: 読む → 走査 → 指摘 → 採用 ----
  const hero = document.querySelector(".hero");
  if (hero) {
    const accept = hero.querySelector("[data-act=accept]");
    const reject = hero.querySelector("[data-act=reject]");
    const status = hero.querySelector(".comment-status");
    let timers = [];
    const later = (ms, fn) => timers.push(setTimeout(fn, ms));
    const decide = (accepted) => {
      timers.forEach(clearTimeout);
      timers = [];
      hero.dataset.stage = "done";
      accept.setAttribute("aria-pressed", String(accepted));
      reject.setAttribute("aria-pressed", String(!accepted));
      if (accepted) delete hero.dataset.rejected;
      else hero.dataset.rejected = "";
      status.textContent = accepted ? T.accepted : T.rejected;
    };
    accept.addEventListener("click", () => decide(true));
    reject.addEventListener("click", () => decide(false));
    if (reduced) {
      decide(true);
    } else {
      accept.setAttribute("aria-pressed", "false");
      reject.setAttribute("aria-pressed", "false");
      status.textContent = T.waiting;
      hero.dataset.stage = "read";
      later(500, () => { hero.dataset.stage = "scan"; });
      later(1150, () => { hero.dataset.stage = "found"; });
      later(2500, () => decide(true));
    }
  }

  // ---- ヒーローの列: PR の差分がスキャン線を通り過ぎる ----
  const canvas = document.querySelector(".hero-map");
  if (canvas && getComputedStyle(canvas).display !== "none") {
    const ctx = canvas.getContext("2d");
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const ROW = 5;
    let width = 0;
    let height = 0;
    // 種付きの乱数で、毎回同じ見た目の列を作る
    let seed = 482;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    const rows = [];
    while (rows.length < 900) {
      const risky = rnd() < 0.16;
      const len = 26 + Math.floor(rnd() * 70);
      let indent = 0;
      for (let i = 0; i < len; i += 1) {
        if (rnd() < 0.25) indent = Math.floor(rnd() * 4);
        const roll = rnd();
        const kind = risky && roll < 0.42 ? "del" : roll < 0.3 ? "add" : roll < 0.38 ? "del" : "ctx";
        rows.push({ kind, x: indent * 0.05, w: rnd() < 0.08 ? 0 : 0.1 + rnd() * 0.62, risky });
      }
      for (let i = 0; i < 4; i += 1) rows.push({ kind: "gap", x: 0, w: 0, risky: false });
    }
    const color = { ctx: "138,180,240", add: "61,255,176", del: "255,123,156" };
    const resize = () => {
      const box = canvas.getBoundingClientRect();
      width = box.width;
      height = box.height;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
    };
    const draw = (t) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      const offset = t * 0.016;
      const first = Math.floor(offset / ROW);
      const scanY = height * 0.42;
      for (let i = 0; i <= height / ROW + 1; i += 1) {
        const row = rows[(first + i) % rows.length];
        if (row.w === 0) continue;
        const y = i * ROW - (offset % ROW);
        const dist = Math.abs(y - scanY);
        // スキャン線を過ぎた行（上）は確定した色、これからの行（下）は沈める
        const reviewed = y < scanY;
        const near = Math.max(0, 1 - dist / 46);
        let alpha = reviewed ? (row.kind === "ctx" ? 0.2 : 0.62) : 0.13;
        if (!reviewed && row.kind !== "ctx") alpha = 0.2;
        alpha = Math.min(1, alpha + near * 0.6);
        // 右端に向かって消して、見出しの帯と喧嘩させない
        ctx.fillStyle = `rgba(${color[row.kind]},${alpha})`;
        ctx.fillRect(width * (0.1 + row.x), y, width * row.w * 0.86, ROW - 2);
        if (reviewed && row.risky) {
          ctx.fillStyle = "rgba(255,123,156,0.85)";
          ctx.fillRect(width * 0.04, y, 3, ROW);
        }
      }
      ctx.fillStyle = "rgba(46,233,255,0.95)";
      ctx.fillRect(0, scanY, width, 1.5);
      const glow = ctx.createLinearGradient(0, scanY - 40, 0, scanY);
      glow.addColorStop(0, "rgba(46,233,255,0)");
      glow.addColorStop(1, "rgba(46,233,255,0.14)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, scanY - 40, width, 40);
    };
    resize();
    addEventListener("resize", () => { resize(); draw(performance.now()); });
    if (reduced) {
      draw(90000);
    } else {
      let visible = true;
      new IntersectionObserver(([e]) => {
        visible = e.isIntersecting;
        if (visible) requestAnimationFrame(loop);
      }).observe(canvas);
      const loop = (t) => {
        if (!visible) return;
        draw(t + 90000);
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    }
  }

  // ---- 動画: 見えたら無音で再生し、音は操作で出す ----
  const film = document.querySelector(".film video");
  if (film) {
    const buttons = [...document.querySelectorAll("[data-film]")];
    const caption = document.querySelector("[data-film-caption]");
    const playBtn = document.querySelector("[data-film-play]");
    const soundBtn = document.querySelector("[data-film-sound]");
    const L = {
      en: { play: "Play", pause: "Pause", replay: "Replay", sound: "Play with sound", mute: "Mute" },
      ja: { play: "再生", pause: "一時停止", replay: "もう一度見る", sound: "音ありで再生", mute: "消音" },
    }[lang];
    const saveData = Boolean(navigator.connection?.saveData);
    // 見えているか、利用者が止めたか。止めた動画はスクロールで勝手に再開しない
    let inView = false;
    let userPaused = reduced || saveData;
    let kind = "film";
    // 狭い画面と通信節約の設定では軽い版を使う
    const srcOf = (base) =>
      kind === "film" && (innerWidth < 900 || saveData) ? `${base}-720.mp4` : `${base}.mp4`;
    const refresh = () => {
      playBtn.hidden = false;
      soundBtn.hidden = kind !== "film";
      playBtn.textContent = film.ended ? L.replay : film.paused ? L.play : L.pause;
      soundBtn.textContent = film.muted ? L.sound : L.mute;
    };
    const tryPlay = () => film.play().catch(() => {}).finally(refresh);
    const select = (button) => {
      for (const b of buttons) b.setAttribute("aria-pressed", String(b === button));
      kind = button.dataset.film;
      film.loop = kind !== "film";
      film.muted = true;
      film.width = Number(button.dataset.w);
      film.height = Number(button.dataset.h);
      film.poster = `${button.dataset.src}.jpg`;
      film.src = srcOf(button.dataset.src);
      film.setAttribute("aria-label", button.dataset.alt);
      caption.textContent = button.dataset.caption;
    };
    for (const button of buttons) {
      button.addEventListener("click", () => {
        select(button);
        userPaused = false;
        tryPlay();
      });
    }
    playBtn.addEventListener("click", () => {
      if (film.paused || film.ended) {
        userPaused = false;
        if (film.ended) film.currentTime = 0;
        tryPlay();
      } else {
        userPaused = true;
        film.pause();
      }
    });
    soundBtn.addEventListener("click", () => {
      // 音は物語に合わせてあるので、初めて音を出すときは頭から見せる
      if (film.muted) film.currentTime = 0;
      film.muted = !film.muted;
      userPaused = false;
      tryPlay();
    });
    for (const event of ["play", "pause", "ended", "volumechange"]) {
      film.addEventListener(event, refresh);
    }
    select(buttons[0]);
    refresh();
    new IntersectionObserver(
      ([e]) => {
        inView = e.isIntersecting;
        if (!inView) film.pause();
        else if (!userPaused && !film.ended) tryPlay();
      },
      { threshold: 0.35 },
    ).observe(film);
  }

  // ---- 行番号: 本文の高さまで続ける ----
  const gutter = document.querySelector(".gutter");
  if (gutter) {
    const fill = () => {
      const top = hero ? hero.offsetTop + hero.offsetHeight : 0;
      const end = document.querySelector(".get-it")?.offsetTop ?? document.body.scrollHeight;
      gutter.style.top = `${top}px`;
      gutter.style.height = `${end - top}px`;
      const count = Math.ceil((end - top) / 28);
      if (gutter.childElementCount === count) return;
      gutter.textContent = Array.from({ length: count }, (_, i) => i + 45).join("\n");
    };
    fill();
    new ResizeObserver(fill).observe(document.body);
  }

  // ---- 流れ: 読んでいる段落に合わせて舞台を進める ----
  const stage = document.querySelector(".stage");
  if (stage) {
    const steps = [...document.querySelectorAll(".step")];
    const num = stage.querySelector("[data-gauge]");
    const label = stage.querySelector("[data-gauge-label]");
    const state = stage.querySelector("[data-state-text]");
    const meter = stage.querySelector("[data-meter]");
    let current = Number(num.textContent);
    let raf = 0;
    const moveTo = (target) => {
      cancelAnimationFrame(raf);
      meter.style.width = `${target}%`;
      if (reduced) {
        current = target;
        num.textContent = target;
        return;
      }
      const from = current;
      const start = performance.now();
      const tick = (now) => {
        const p = Math.min(1, (now - start) / 700);
        current = Math.round(from + (target - from) * (1 - (1 - p) ** 3));
        num.textContent = current;
        if (p < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    };
    const set = (el) => {
      steps.forEach((s) => s.classList.toggle("on", s === el));
      stage.dataset.step = el.dataset.step;
      moveTo(Number(el.dataset.score));
      label.textContent = el.dataset.scoreLabel;
      state.textContent = el.dataset.stateText;
    };
    document.querySelector(".steps").classList.add("live");
    set(steps[0]);
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) set(e.target);
      },
      { rootMargin: "-46% 0px -50% 0px" },
    );
    steps.forEach((s) => io.observe(s));
  }

  // ---- 完全自動運転: つまみを回すと順に処理して振り分ける ----
  const queue = document.querySelector(".queue");
  if (queue) {
    const knob = document.querySelector(".knob");
    const items = [...queue.children];
    const count = document.querySelector(".queue-count");
    const label = knob.querySelector("[data-knob-label]");
    let timers = [];
    let touched = false;
    const reset = () => {
      timers.forEach(clearTimeout);
      timers = [];
      for (const li of items) {
        li.dataset.state = "queued";
        li.querySelector(".out").textContent = li.dataset.queued;
        li.querySelector(".why").textContent = "";
      }
    };
    const finish = (li) => {
      li.dataset.state = li.dataset.result;
      li.querySelector(".out").textContent = li.dataset.out;
      li.querySelector(".why").textContent = li.dataset.why;
    };
    const summary = () => {
      const by = (s) => items.filter((li) => li.dataset.state === s).length;
      count.textContent = count.dataset.template
        .replace("{h}", by("human"))
        .replace("{c}", by("comment"))
        .replace("{o}", by("ok"));
    };
    const run = () => {
      knob.setAttribute("aria-checked", "true");
      label.textContent = label.dataset.on;
      if (reduced) {
        items.forEach(finish);
        summary();
        return;
      }
      items.forEach((li, i) => {
        timers.push(setTimeout(() => {
          li.dataset.state = "busy";
          li.querySelector(".out").textContent = queue.dataset.busy;
        }, i * 620));
        timers.push(setTimeout(() => { finish(li); summary(); }, i * 620 + 560));
      });
    };
    const stop = () => {
      reset();
      knob.setAttribute("aria-checked", "false");
      label.textContent = label.dataset.off;
      count.textContent = count.dataset.idle;
    };
    knob.addEventListener("click", () => {
      touched = true;
      if (knob.getAttribute("aria-checked") === "true") stop();
      else { reset(); run(); }
    });
    stop();
    new IntersectionObserver(([e], io) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      if (!touched) run();
    }, { threshold: 0.6 }).observe(queue);
  }
})();
