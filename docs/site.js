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

  // ---- 上部: ヒーローを過ぎたら背景を付ける ----
  const top = document.querySelector(".top");
  if (top) {
    const heroEl = document.querySelector(".hero");
    const update = () => {
      const end = heroEl ? heroEl.offsetHeight - innerHeight * 0.5 : 40;
      top.classList.toggle("solid", scrollY > end);
    };
    update();
    addEventListener("scroll", update, { passive: true });
    addEventListener("resize", update);
  }

  // ---- 動画: 見えたら無音で再生し、音は操作で出す ----
  const film = document.querySelector(".screen video");
  if (film) {
    const screen = film.closest(".screen");
    const theatre = film.closest(".theatre");
    const glow = screen.querySelector(".screen-glow");
    const buttons = [...document.querySelectorAll("[data-film]")];
    const caption = document.querySelector("[data-film-caption]");
    const playBtn = document.querySelector("[data-film-play]");
    const bigBtn = document.querySelector("[data-film-big]");
    const soundBtn = document.querySelector("[data-film-sound]");
    const fullBtn = document.querySelector("[data-film-full]");
    const seek = document.querySelector("[data-film-seek]");
    const time = document.querySelector("[data-film-time]");
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
    const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
    const refresh = () => {
      const label = film.ended ? L.replay : film.paused ? L.play : L.pause;
      playBtn.setAttribute("aria-label", label);
      playBtn.dataset.state = film.paused || film.ended ? "play" : "pause";
      bigBtn.setAttribute("aria-label", label);
      bigBtn.hidden = !(film.paused || film.ended);
      screen.dataset.playing = String(!film.paused && !film.ended);
      soundBtn.hidden = kind !== "film";
      soundBtn.textContent = film.muted ? L.sound : L.mute;
    };
    const paintTime = () => {
      const total = film.duration || 0;
      const ratio = total ? film.currentTime / total : 0;
      seek.value = String(Math.round(ratio * 1000));
      seek.style.setProperty("--v", `${ratio * 100}%`);
      seek.setAttribute("aria-valuetext", clock(film.currentTime));
      time.textContent = total ? `${clock(film.currentTime)} / ${clock(total)}` : "0:00";
    };
    const tryPlay = () => film.play().catch(() => {}).finally(refresh);
    const toggle = () => {
      if (film.paused || film.ended) {
        userPaused = false;
        if (film.ended) film.currentTime = 0;
        tryPlay();
      } else {
        userPaused = true;
        film.pause();
      }
    };
    const select = (button) => {
      for (const b of buttons) b.setAttribute("aria-pressed", String(b === button));
      kind = button.dataset.film;
      film.loop = kind !== "film";
      film.muted = true;
      film.width = Number(button.dataset.w);
      film.height = Number(button.dataset.h);
      theatre.style.setProperty("--ar", String(Number(button.dataset.w) / Number(button.dataset.h)));
      film.poster = `${button.dataset.src}.jpg`;
      glow.src = `${button.dataset.src}.jpg`;
      film.src = srcOf(button.dataset.src);
      film.setAttribute("aria-label", button.dataset.alt);
      caption.textContent = button.dataset.caption;
      paintTime();
    };
    for (const button of buttons) {
      button.addEventListener("click", () => {
        select(button);
        userPaused = false;
        tryPlay();
      });
    }
    playBtn.addEventListener("click", toggle);
    bigBtn.addEventListener("click", toggle);
    film.addEventListener("click", toggle);
    soundBtn.addEventListener("click", () => {
      // 音は物語に合わせてあるので、初めて音を出すときは頭から見せる
      if (film.muted) film.currentTime = 0;
      film.muted = !film.muted;
      userPaused = false;
      tryPlay();
    });
    seek.addEventListener("input", () => {
      if (film.duration) film.currentTime = (Number(seek.value) / 1000) * film.duration;
      paintTime();
    });
    fullBtn.addEventListener("click", () => {
      if (document.fullscreenElement) document.exitFullscreen();
      else if (screen.requestFullscreen) screen.requestFullscreen();
      else film.webkitEnterFullscreen?.();
    });
    for (const event of ["play", "pause", "ended", "volumechange"]) {
      film.addEventListener(event, refresh);
    }
    for (const event of ["timeupdate", "loadedmetadata", "seeked"]) {
      film.addEventListener(event, paintTime);
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
      const at = steps.indexOf(el);
      steps.forEach((s, i) => {
        s.classList.toggle("on", s === el);
        s.classList.toggle("done", i < at);
      });
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
