// ヒーローの場面。リングがレンズになって広がり、内側では PR の山が崩れて、人が読む 3 件だけが残る。
// 動きを減らす設定では何もしない。WebGL が使えないときは CSS の丸い切り抜きで同じ流れを見せる
(() => {
  const hero = document.querySelector(".hero");
  if (!hero || !document.documentElement.classList.contains("motion")) return;
  const pin = hero.querySelector(".hero-pin");
  const canvas = hero.querySelector(".scene-gl");

  // 背景画の中の山頂と地平線の高さ（画像の高さに対する割合）
  const IMG_ASPECT = 1536 / 1024;
  const IMG_SUMMIT = 0.352;
  const IMG_HORIZON = 0.86;

  let width = 0;
  let height = 0;
  let fit = { x: 0, y: 0, w: 0, h: 0, summit: 0, horizon: 0 };
  let progress = 0;
  let shown = 0;
  let pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  let visible = true;

  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const smooth = (a, b, v) => {
    const k = clamp((v - a) / (b - a));
    return k * k * (3 - 2 * k);
  };

  const measure = () => {
    const style = getComputedStyle(hero);
    width = pin.clientWidth;
    height = pin.clientHeight;
    const summit = parseFloat(style.getPropertyValue("--summit")) * height;
    const horizon = parseFloat(style.getPropertyValue("--horizon")) * height;
    const h = (horizon - summit) / (IMG_HORIZON - IMG_SUMMIT);
    const w = h * IMG_ASPECT;
    fit = { x: (width - w) / 2, y: summit - IMG_SUMMIT * h, w, h, summit, horizon };
  };

  // スクロールの進み具合からリングの位置と大きさを決める
  const ring = (p) => {
    const grow = smooth(0.1, 0.84, p);
    const r0 = Math.min(height * 0.13, width * 0.28);
    const rEnd = Math.hypot(width, height) * 1.12;
    return {
      x: width / 2,
      y: fit.summit + r0 * 0.3 + (fit.horizon * 0.72 - fit.summit - r0 * 0.3) * grow,
      r: r0 + (rEnd - r0) * grow ** 2.1,
      reveal: smooth(0.1, 0.2, p),
    };
  };

  const VERT = "attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}";
  const FRAG = `
precision highp float;
uniform sampler2D A, B;
uniform vec2 res, c;
uniform vec4 fit;
uniform float t, r, reveal, hasB, intro, dpr, summit;
uniform vec2 mouse;

float hash(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }

// 画像の外は折り返して読み、端を暗くして夜に溶かす
vec3 plate(sampler2D T, vec2 px, float edge){
  vec2 uv = (px - fit.xy) / fit.zw;
  vec2 m = abs(mod(uv + 1., 2.) - 1.);
  vec3 col = texture2D(T, m).rgb;
  // 折り返すと崩れるのは山だけなので、山の高さの範囲だけを暗くする
  float side = smoothstep(-0.02, 0.17, uv.x) * smoothstep(1.02, 0.83, uv.x);
  col *= mix(1., side, edge * smoothstep(0.28, 0.46, uv.y));
  col *= smoothstep(1.0, 0.93, uv.y);
  col = mix(vec3(0.012, 0.016, 0.055), col, smoothstep(-0.06, 0.02, uv.y));
  return col;
}

vec3 lens(sampler2D T, vec2 px, vec2 off){
  return vec3(plate(T, px + off * 1.25, 0.).r, plate(T, px + off, 0.).g, plate(T, px + off * 0.75, 0.).b);
}

void main(){
  vec2 px = vec2(gl_FragCoord.x, res.y - gl_FragCoord.y) / dpr;
  vec2 size = res / dpr;
  vec2 d = px - c;
  float dist = length(d);
  vec2 n = d / max(dist, 1.);
  float w = abs(dist - r);

  // ガラス板の大きさの格子。段ごとにずらして積み重なりに見せる
  float scale = clamp(size.y / 900., 0.55, 1.4);
  vec2 cell = vec2(104., 40.) * scale;
  float row = floor(px.y / cell.y);
  vec2 id = floor(vec2(px.x / cell.x + hash(vec2(row, 3.)) * 3., row));
  float h = hash(id);

  vec2 par = mouse * 7.;
  float lum = dot(plate(A, px + par, 1.), vec3(0.3, 0.5, 0.2));
  // 山の部分だけ板の形に崩す。空は丸いレンズのまま切り替える
  float rock = smoothstep(0.07, 0.3, lum);
  float blocky = smoothstep(-34., 34., dist - (r * reveal + (h - 0.5) * min(300. * scale, r * 0.7) * reveal));
  float keep = mix(smoothstep(-30., 30., dist - r * reveal), blocky, rock);
  if (reveal <= 0.001) keep = 1.;

  // 崩れる板はリングの外へ押し出され、少し光る
  float loose = (1. - keep) * keep * 4. * rock;
  vec2 drift = n * (1. - keep) * (70. + h * 150.) * scale + vec2(0., (h - 0.5) * 60. * (1. - keep));
  vec3 a = plate(A, px + par + drift * rock, 1.);
  // またたくのは光っている板だけ。空と霧に格子を見せない
  float lit = smoothstep(0.42, 0.72, lum) * smoothstep(0.8, 0.72, (px.y - fit.y) / fit.w * 1.5);
  a *= (1. + 0.14 * sin(t * (0.35 + h * 0.8) + h * 40.) * lit) * (1. + loose * 1.7);

  // リングのすぐ内側は屈折させて色をずらす
  float bend = exp(-pow((r - dist) / (46. * scale), 2.)) * step(dist, r + 80.);
  vec3 b = hasB > 0.5 ? lens(B, px + par * 0.4, -n * bend * 26. * scale) : vec3(0.012, 0.016, 0.055);
  vec3 col = mix(b, a, keep);

  // リング。静止中は山の後ろに回す
  // 山頂から下へ広がる三角の中はリングを隠す
  float inside = smoothstep(0., 10., (px.y - summit) * 1.75 - abs(px.x - size.x * 0.5));
  float hide = mix(1. - max(inside, smoothstep(0.1, 0.34, lum) * step(summit, px.y)), 1., reveal);
  vec3 cyan = vec3(0.2, 0.88, 1.);
  float glow = exp(-w * w / 3.2) * 1.5 + exp(-w / 8.) * 0.5 + exp(-w / 60.) * 0.2;
  col += cyan * glow * hide * intro * (0.92 + 0.08 * sin(t * 0.9));
  col += vec3(0.8, 0.97, 1.) * exp(-w * w / 1.2) * hide * intro;

  // 読み込み時に闇から現す。粒子を足して帯状のむらを消す
  col *= smoothstep(0., 1., intro * 1.4);
  col += (hash(px + fract(t) * 7.) - 0.5) * 0.022;
  gl_FragColor = vec4(col, 1.);
}`;

  const initGl = () => {
    if (!canvas) return null;
    const gl = canvas.getContext("webgl", { antialias: false, alpha: false, powerPreference: "low-power" });
    if (!gl) return null;
    const compile = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
    };
    const vs = compile(gl.VERTEX_SHADER, VERT);
    const fs = compile(gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) return null;
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "a");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const u = {};
    for (const name of ["A", "B", "res", "c", "fit", "t", "r", "reveal", "hasB", "intro", "dpr", "mouse", "summit"]) {
      u[name] = gl.getUniformLocation(prog, name);
    }
    gl.uniform1i(u.A, 0);
    gl.uniform1i(u.B, 1);
    return { gl, u, ready: { a: false, b: false } };
  };

  const scene = initGl();

  const loadTexture = (img, unit, key) => {
    const { gl, ready } = scene;
    const go = () => {
      const tex = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img);
      ready[key] = true;
      if (key === "a") hero.classList.add("gl-on");
    };
    if (img.complete && img.naturalWidth) go();
    else img.addEventListener("load", go, { once: true });
  };

  const plateA = hero.querySelector(".plate-a");
  const plateB = hero.querySelector(".plate-b");
  if (plateB) {
    plateB.loading = "eager";
    if (plateB.dataset.src) plateB.src = plateB.dataset.src;
  }
  if (scene) {
    loadTexture(plateA, 0, "a");
    loadTexture(plateB, 1, "b");
  }

  const resize = () => {
    measure();
    if (!scene) return;
    const dpr = Math.min(devicePixelRatio || 1, width < 700 ? 2 : 1.5);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    scene.dpr = dpr;
    scene.gl.viewport(0, 0, canvas.width, canvas.height);
  };

  const readScroll = () => {
    const range = hero.offsetHeight - pin.clientHeight;
    const top = hero.getBoundingClientRect().top;
    progress = range > 0 ? clamp(-top / range) : 0;
  };

  // 文字の出入り。--p だけを渡し、見え方は CSS に任せる
  const drawCopy = (p) => {
    hero.style.setProperty("--p", p.toFixed(4));
    hero.style.setProperty("--out", (1 - smooth(0.015, 0.11, p)).toFixed(3));
    hero.style.setProperty("--act2", (smooth(0.13, 0.2, p) * (1 - smooth(0.4, 0.47, p))).toFixed(3));
    hero.style.setProperty("--act3", smooth(0.6, 0.72, p).toFixed(3));
    hero.classList.toggle("past-copy", p > 0.11);
  };

  const start = performance.now();
  const frame = (now) => {
    if (!visible) return;
    readScroll();
    shown += (progress - shown) * 0.14;
    if (Math.abs(progress - shown) < 0.0002) shown = progress;
    pointer.x += (pointer.tx - pointer.x) * 0.05;
    pointer.y += (pointer.ty - pointer.y) * 0.05;
    drawCopy(shown);
    // 縦長の画面では文字が消えたあと、下の余白に場面を下ろす
    const drop = height > width ? height * 0.17 * smooth(0.02, 0.2, shown) : 0;
    const o = ring(shown);
    o.y += drop;
    if (scene?.ready.a) {
      const { gl, u, dpr, ready } = scene;
      const t = (now - start) / 1000;
      gl.uniform2f(u.res, canvas.width, canvas.height);
      gl.uniform2f(u.c, o.x, o.y);
      gl.uniform4f(u.fit, fit.x, fit.y + drop, fit.w, fit.h);
      gl.uniform1f(u.t, t);
      gl.uniform1f(u.r, o.r);
      gl.uniform1f(u.reveal, ready.b ? o.reveal : 0);
      gl.uniform1f(u.hasB, ready.b ? 1 : 0);
      gl.uniform1f(u.intro, smooth(0.15, 1.7, t));
      gl.uniform1f(u.dpr, dpr);
      gl.uniform1f(u.summit, fit.summit + drop);
      gl.uniform2f(u.mouse, pointer.x, pointer.y);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    } else {
      // WebGL なしでも流れは同じにする
      hero.style.setProperty("--ring-x", `${o.x}px`);
      hero.style.setProperty("--ring-y", `${o.y}px`);
      hero.style.setProperty("--ring-r", `${o.r}px`);
      hero.style.setProperty("--ring-cut", `${o.reveal > 0 ? o.r : 0}px`);
    }
    requestAnimationFrame(frame);
  };

  addEventListener("resize", resize);
  addEventListener(
    "pointermove",
    (e) => {
      if (e.pointerType === "touch") return;
      pointer.tx = (e.clientX / innerWidth - 0.5) * 2;
      pointer.ty = (e.clientY / innerHeight - 0.5) * 2;
    },
    { passive: true },
  );
  new IntersectionObserver(([e]) => {
    const was = visible;
    visible = e.isIntersecting;
    if (visible && !was) requestAnimationFrame(frame);
  }).observe(hero);

  resize();
  requestAnimationFrame(frame);
})();
