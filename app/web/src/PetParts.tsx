import { useEffect, useRef } from 'react';

/**
 * 部件动画引擎（Cutout / 补间动画）
 *
 * 核心思路完全对齐 Flash 时代：
 *   一张立绘 → 自动切成若干部件 → 每个部件绕自己的枢轴旋转/缩放/位移
 *   → 关键帧只记录「参数」，中间帧由插值生成
 *
 * 和逐帧序列图的区别：关键帧是数值不是图片，所以插帧免费、帧率无限、
 * 也彻底绕开了 AI 出图帧间不一致的问题。
 */

export type ActionName = 'idle' | 'walk' | 'eat' | 'happy' | 'sleep' | 'sick';

type Part = {
  key: string;
  /** 图片 UV 区间 [x, y, w, h]，0-1 */
  rect: [number, number, number, number];
  /** 枢轴点（图片 UV 坐标）：绕它旋转 */
  pivot: [number, number];
  /** 绘制顺序，小的先画 */
  order: number;
  /** 是否跟随头部（耳朵） */
  follows?: string;
  /** 局部形变：1=头部（眨眼） 2=身体（呼吸） 0=无 */
  deform?: number;
};

/**
 * 部件划分：不追求精确抠图，用带重叠的矩形区域。
 * 重叠是为了旋转时不留缝；枢轴点按部位几何自动定（耳根、颈根、尾根、地面）。
 */
const PARTS: Part[] = [
  { key: 'body',  rect: [0.02, 0.50, 0.96, 0.50], pivot: [0.50, 0.96], order: 0, deform: 2 },
  { key: 'tail',  rect: [0.00, 0.54, 0.28, 0.32], pivot: [0.21, 0.57], order: 1 },
  { key: 'head',  rect: [0.10, 0.00, 0.80, 0.58], pivot: [0.50, 0.50], order: 2, deform: 1 },
  { key: 'earL',  rect: [0.00, 0.02, 0.34, 0.46], pivot: [0.29, 0.11], order: 3, follows: 'head' },
  { key: 'earR',  rect: [0.66, 0.02, 0.34, 0.46], pivot: [0.71, 0.11], order: 4, follows: 'head' },
  { key: 'scarf', rect: [0.24, 0.42, 0.52, 0.28], pivot: [0.50, 0.45], order: 5 },
];

/** 关键帧：t 为秒，其余为部件变换参数 */
type Key = { t: number; rot?: number; sx?: number; sy?: number; dx?: number; dy?: number };
type Track = Record<string, Key[]>;
type Action = { loop: boolean; duration: number; tracks: Track; blink?: boolean; speed?: number };

/**
 * 动作库：全部是数值关键帧，没有一张新图片。
 * 角度单位是弧度；dx/dy 是图片 UV 单位（0-1）。
 */
const ACTIONS: Record<ActionName, Action> = {
  idle: {
    loop: true, duration: 3.4, blink: true,
    tracks: {
      body:  [{ t: 0, sy: 1 }, { t: 1.7, sy: 1.022 }, { t: 3.4, sy: 1 }],
      head:  [{ t: 0, rot: 0 }, { t: 1.2, rot: 0.018 }, { t: 2.3, rot: -0.012 }, { t: 3.4, rot: 0 }],
      earL:  [{ t: 0, rot: 0 }, { t: 0.9, rot: 0.05 }, { t: 1.8, rot: -0.02 }, { t: 3.4, rot: 0 }],
      earR:  [{ t: 0, rot: 0 }, { t: 1.1, rot: -0.045 }, { t: 2.0, rot: 0.02 }, { t: 3.4, rot: 0 }],
      tail:  [{ t: 0, rot: 0 }, { t: 0.6, rot: 0.1 }, { t: 1.2, rot: -0.06 }, { t: 1.8, rot: 0.1 }, { t: 2.4, rot: -0.06 }, { t: 3.4, rot: 0 }],
    },
  },

  walk: {
    loop: true, duration: 0.62,
    tracks: {
      body:  [{ t: 0, dy: 0, rot: 0 }, { t: 0.15, dy: -0.012 }, { t: 0.31, dy: 0, rot: 0.02 }, { t: 0.46, dy: -0.012 }, { t: 0.62, dy: 0, rot: 0 }],
      head:  [{ t: 0, rot: -0.03 }, { t: 0.31, rot: 0.03 }, { t: 0.62, rot: -0.03 }],
      earL:  [{ t: 0, rot: 0.12 }, { t: 0.31, rot: -0.04 }, { t: 0.62, rot: 0.12 }],
      earR:  [{ t: 0, rot: -0.1 }, { t: 0.31, rot: 0.06 }, { t: 0.62, rot: -0.1 }],
      tail:  [{ t: 0, rot: 0.2 }, { t: 0.31, rot: -0.2 }, { t: 0.62, rot: 0.2 }],
    },
  },

  eat: {
    loop: true, duration: 1.7,
    tracks: {
      head:  [
        { t: 0, rot: 0.05, dy: 0.034, sy: 0.94 },
        { t: 0.35, rot: 0.02, dy: 0.020, sy: 0.975 },
        { t: 0.7, rot: 0.06, dy: 0.036, sy: 0.935 },
        { t: 1.05, rot: 0.02, dy: 0.020, sy: 0.975 },
        { t: 1.4, rot: 0.06, dy: 0.036, sy: 0.935 },
        { t: 1.7, rot: 0.05, dy: 0.034, sy: 0.94 },
      ],
      body:  [{ t: 0, sy: 1 }, { t: 0.35, sy: 1.018 }, { t: 0.7, sy: 1 }, { t: 1.05, sy: 1.018 }, { t: 1.7, sy: 1 }],
      tail:  [{ t: 0, rot: 0.28 }, { t: 0.2, rot: -0.28 }, { t: 0.4, rot: 0.28 }, { t: 0.6, rot: -0.28 }, { t: 0.8, rot: 0.28 }, { t: 1.0, rot: -0.28 }, { t: 1.2, rot: 0.28 }, { t: 1.4, rot: -0.28 }, { t: 1.7, rot: 0.28 }],
      earL:  [{ t: 0, rot: 0.06 }, { t: 0.7, rot: -0.02 }, { t: 1.4, rot: 0.06 }, { t: 1.7, rot: 0.06 }],
      earR:  [{ t: 0, rot: -0.05 }, { t: 0.7, rot: 0.03 }, { t: 1.4, rot: -0.05 }, { t: 1.7, rot: -0.05 }],
    },
  },

  happy: {
    loop: true, duration: 1.1,
    tracks: {
      body:  [{ t: 0, dy: 0, sy: 1 }, { t: 0.18, dy: -0.035, sy: 1.03 }, { t: 0.36, dy: 0, sy: 0.985 }, { t: 0.55, dy: -0.03, sy: 1.02 }, { t: 0.75, dy: 0, sy: 1 }, { t: 1.1, dy: 0, sy: 1 }],
      head:  [{ t: 0, rot: 0 }, { t: 0.3, rot: -0.10 }, { t: 0.6, rot: 0.10 }, { t: 1.1, rot: 0 }],
      earL:  [{ t: 0, rot: 0.05 }, { t: 0.3, rot: 0.30 }, { t: 0.6, rot: 0.05 }, { t: 1.1, rot: 0.05 }],
      earR:  [{ t: 0, rot: -0.05 }, { t: 0.3, rot: 0.18 }, { t: 0.6, rot: -0.30 }, { t: 1.1, rot: -0.05 }],
      tail:  [{ t: 0, rot: 0.35 }, { t: 0.14, rot: -0.35 }, { t: 0.28, rot: 0.35 }, { t: 0.42, rot: -0.35 }, { t: 0.56, rot: 0.35 }, { t: 0.7, rot: -0.35 }, { t: 0.84, rot: 0.35 }, { t: 1.1, rot: 0.35 }],
    },
  },

  sleep: {
    loop: true, duration: 4.6, blink: false,
    tracks: {
      body:  [{ t: 0, sy: 0.975 }, { t: 2.3, sy: 0.995 }, { t: 4.6, sy: 0.975 }],
      head:  [{ t: 0, rot: 0.14, dy: 0.030, sy: 0.958 }, { t: 2.3, rot: 0.16, dy: 0.034, sy: 0.952 }, { t: 4.6, rot: 0.14, dy: 0.030, sy: 0.958 }],
      earL:  [{ t: 0, rot: 0.12 }, { t: 2.3, rot: 0.16 }, { t: 4.6, rot: 0.12 }],
      earR:  [{ t: 0, rot: -0.12 }, { t: 2.3, rot: -0.16 }, { t: 4.6, rot: -0.12 }],
      tail:  [{ t: 0, rot: 0.04 }, { t: 2.3, rot: -0.02 }, { t: 4.6, rot: 0.04 }],
    },
  },

  sick: {
    loop: true, duration: 3.0, blink: true,
    tracks: {
      body:  [{ t: 0, sy: 0.968 }, { t: 1.5, sy: 0.98 }, { t: 3.0, sy: 0.968 }],
      head:  [{ t: 0, rot: -0.07, dy: 0.026, sy: 0.965 }, { t: 1.5, rot: -0.05, dy: 0.030, sy: 0.960 }, { t: 3.0, rot: -0.07, dy: 0.026, sy: 0.965 }],
      earL:  [{ t: 0, rot: -0.06 }, { t: 1.5, rot: -0.02 }, { t: 3.0, rot: -0.06 }],
      earR:  [{ t: 0, rot: 0.06 }, { t: 1.5, rot: 0.02 }, { t: 3.0, rot: 0.06 }],
      tail:  [{ t: 0, rot: -0.04 }, { t: 3.0, rot: -0.04 }],
    },
  },
};

/** 哪些动作换用哪张贴图；null 表示用基准图（保留眨眼） */
const EXPRESSION_OF: Record<ActionName, string | null> = {
  idle: null,
  walk: null,
  eat: 'happy',
  happy: 'happy',
  sleep: 'sleep',
  sick: 'sick',
};

/* ---------------- 插值 ---------------- */
const easeInOut = (x: number) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);

function sampleTrack(keys: Key[], t: number): Key {
  if (!keys.length) return { t };
  if (keys.length === 1) return keys[0];
  let i = 0;
  while (i < keys.length - 1 && t > keys[i + 1].t) i++;
  const a = keys[i];
  const b = keys[Math.min(i + 1, keys.length - 1)];
  if (b.t === a.t) return a;
  const raw = Math.max(0, Math.min(1, (t - a.t) / (b.t - a.t)));
  const k = easeInOut(raw);
  const mix = (p: keyof Key, d = 0) => (a[p] ?? d) + ((b[p] ?? d) - (a[p] ?? d)) * k;
  return { t, rot: mix('rot'), sx: mix('sx', 1), sy: mix('sy', 1), dx: mix('dx'), dy: mix('dy') };
}

/** 2x3 仿射矩阵（uv 空间） */
type M = [number, number, number, number, number, number];
const IDENT: M = [1, 0, 0, 1, 0, 0];
function mul(a: M, b: M): M {
  return [
    a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}
/** 绕 pivot 旋转缩放后再平移 */
function localMatrix(pivot: [number, number], k: Key): M {
  const rot = k.rot ?? 0, sx = k.sx ?? 1, sy = k.sy ?? 1;
  const c = Math.cos(rot), s = Math.sin(rot);
  const a = c * sx, b = s * sx, cc = -s * sy, d = c * sy;
  const [px, py] = pivot;
  return [a, b, cc, d, px - a * px - cc * py + (k.dx ?? 0), py - b * px - d * py + (k.dy ?? 0)];
}

/* ---------------- 着色器 ---------------- */
const VS = `#version 300 es
in vec2 a_local;          // 部件内 0..1
uniform vec4 u_rect;      // 部件在图片中的 UV 区间
uniform mat3 u_mat;       // 部件变换（uv 空间）
uniform float u_deform;   // 0 无 / 1 头(眨眼) / 2 身(呼吸)
uniform float u_blink;
uniform float u_breath;
uniform vec2 u_canvas;    // 画布像素
uniform vec2 u_origin;    // 图片左上角在画布中的像素位置
uniform vec2 u_imgSize;   // 图片显示尺寸（像素）
uniform vec2 u_uvOffset;  // 采样起点（基准贴图=部件 rect.xy；裁剪贴图=0）
uniform vec2 u_uvScale;   // 采样跨度（基准贴图=部件 rect.zw；裁剪贴图=1）
out vec2 v_uv;

void main(){
  vec2 uv = u_rect.xy + a_local * u_rect.zw;

  // 局部形变（在部件自己的区域里做，不影响别的部件）
  if (u_deform > 0.5 && u_deform < 1.5) {
    float band = smoothstep(0.18, 0.24, uv.y) * (1.0 - smoothstep(0.29, 0.35, uv.y));
    uv.y += (0.265 - uv.y) * 0.92 * band * u_blink;
  } else if (u_deform > 1.5) {
    uv.x += (uv.x - 0.5) * 0.014 * u_breath;
  }

  // 部件仿射变换
  vec3 p = u_mat * vec3(uv, 1.0);
  vec2 uv2 = p.xy;

  vec2 px = u_origin + uv2 * u_imgSize;
  gl_Position = vec4(px.x / u_canvas.x * 2.0 - 1.0, 1.0 - px.y / u_canvas.y * 2.0, 0.0, 1.0);
  // 基准贴图按图片坐标采样；头部裁剪贴图按部件内 0-1 采样
  v_uv = u_uvOffset + a_local * u_uvScale;
}`;

const FS = `#version 300 es
precision mediump float;
in vec2 v_uv;
uniform sampler2D u_tex;
out vec4 o;
void main(){
  vec4 c = texture(u_tex, v_uv);
  o = vec4(c.rgb * c.a, c.a);
}`;

function compile(gl: WebGL2RenderingContext, type: number, src: string) {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
  return s;
}

type Props = {
  action?: ActionName;
  /** 用来驱动生病时的脸色，暂未使用 */
  health?: number;
  scale?: number;
  onTap?: () => void;
};

export default function PetParts({ action = 'idle', scale = 1, onTap }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const actionRef = useRef(action);
  actionRef.current = action;
  const startRef = useRef({ action, t0: performance.now() });

  // 动作切换时重新计时，避免从上一个动作的进度接着播
  if (startRef.current.action !== action) {
    startRef.current = { action, t0: performance.now() };
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext('webgl2', { alpha: true, antialias: true, premultipliedAlpha: true });
    if (!gl) return;

    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { console.error(gl.getProgramInfoLog(prog)); return; }
    gl.useProgram(prog);

    // 每个部件一个小网格（6×6），既够做局部形变，又几乎不耗性能
    const G = 6;
    const localVerts: number[] = [];
    const localIdx: number[] = [];
    for (let j = 0; j <= G; j++) for (let i = 0; i <= G; i++) localVerts.push(i / G, j / G);
    for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
      const a = j * (G + 1) + i, b = a + 1, c = a + G + 1, d = c + 1;
      localIdx.push(a, c, b, b, c, d);
    }

    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(localVerts), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'a_local');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(localIdx), gl.STATIC_DRAW);

    const U: Record<string, WebGLUniformLocation | null> = {};
    ['u_rect', 'u_mat', 'u_deform', 'u_blink', 'u_breath', 'u_canvas', 'u_origin', 'u_imgSize', 'u_tex', 'u_uvOffset', 'u_uvScale']
      .forEach((n) => (U[n] = gl.getUniformLocation(prog, n)));

    // 基准立绘 + 头部表情贴图（裁好的头部区域，节省 60% 体积）
    const makeTex = () => {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    };
    const tex = makeTex();
    const headTex: Record<string, WebGLTexture> = {
      happy: makeTex(), sleep: makeTex(), sick: makeTex(),
    };

    let imgW = 1, imgH = 1, ready = false;
    let headReady = false;

    const img = new Image();
    img.onload = () => {
      imgW = img.naturalWidth; imgH = img.naturalHeight;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      ready = true;
    };
    img.src = '/pet/idle.png';

    let headsLoaded = 0;
    for (const key of Object.keys(headTex)) {
      const himg = new Image();
      himg.onload = () => {
        gl.bindTexture(gl.TEXTURE_2D, headTex[key]);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, himg);
        if (++headsLoaded === Object.keys(headTex).length) headReady = true;
      };
      himg.src = `/pet/heads/${key}.png`;
    }

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 0);

    let W = 1, H = 1;
    const resize = () => {
      const r = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = Math.max(1, Math.round(r.width * dpr));
      H = Math.max(1, Math.round(r.height * dpr));
      canvas.width = W; canvas.height = H;
      gl.viewport(0, 0, W, H);
    };
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();

    const onDown = () => onTap?.();
    canvas.addEventListener('pointerdown', onDown);

    let raf = 0, blinkT = -1, blinkNext = 2.4, blink = 0, last = performance.now();

    function frame(now: number) {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      const act = ACTIONS[actionRef.current] ?? ACTIONS.idle;
      const elapsed = (performance.now() - startRef.current.t0) / 1000;
      const t = act.loop ? elapsed % act.duration : Math.min(elapsed, act.duration);

      // 眨眼：与动作无关的独立节奏
      const exprNow = EXPRESSION_OF[actionRef.current] ?? null;
      if (act.blink && !exprNow) {
        if (blinkT < 0 && elapsed > blinkNext) blinkT = 0;
        if (blinkT >= 0) {
          blinkT += dt;
          const d = 0.18;
          blink = blinkT < d / 2 ? blinkT / (d / 2) : Math.max(0, 1 - (blinkT - d / 2) / (d / 2));
          if (blinkT > d) { blinkT = -1; blink = 0; blinkNext = elapsed + 2.2 + Math.random() * 3; }
        }
      } else { blink = 0; }

      const breath = Math.sin(t * 1.9);

      if (ready) {
        gl.clear(gl.COLOR_BUFFER_BIT);

        // 部件旋转时顶点会略微越出图片边界，用 0.86 的缩放留出空间
        const fit = Math.min(W / imgW, H / imgH) * 0.86 * scale;
        const dispW = imgW * fit, dispH = imgH * fit;
        const originX = (W - dispW) / 2;
        const originY = (H - dispH) / 2 + dispH * 0.03;

        gl.useProgram(prog);
        gl.uniform2f(U.u_canvas as any, W, H);
        gl.uniform2f(U.u_origin as any, originX, originY);
        gl.uniform2f(U.u_imgSize as any, dispW, dispH);
        gl.uniform1f(U.u_blink as any, blink);
        gl.uniform1f(U.u_breath as any, breath);
        gl.uniform1i(U.u_tex as any, 0);
        gl.activeTexture(gl.TEXTURE0);

        // 调试：?headrot=0.4 强制头部额外转角，用来找穿帮临界角
        const headExtra = (() => {
          const v = new URLSearchParams(location.search).get('headrot');
          return v ? parseFloat(v) : 0;
        })();

      // 先算每个部件的局部关键帧，再按顺序合成父子矩阵
        const world: Record<string, M> = {};
        const sorted = [...PARTS].sort((a, b) => a.order - b.order);
        for (const part of sorted) {
          const keys = act.tracks[part.key] ?? [];
          let k = keys.length ? sampleTrack(keys, t) : { t } as Key;
          if (part.key === 'head' && headExtra) k = { ...k, rot: (k.rot ?? 0) + headExtra };
          const m = localMatrix(part.pivot, k);
          world[part.key] = part.follows && world[part.follows]
            ? mul(world[part.follows], m)
            : m;
        }

        const expr = EXPRESSION_OF[actionRef.current] ?? null;
        const useHeadCrop = part0NeedsHeadCrop();

        function part0NeedsHeadCrop() { return expr !== null && headReady; }

        for (const part of sorted) {
          const m = world[part.key];
          gl.uniform4f(U.u_rect as any, part.rect[0], part.rect[1], part.rect[2], part.rect[3]);
          gl.uniformMatrix3fv(U.u_mat as any, false, [
            m[0], m[1], 0,
            m[2], m[3], 0,
            m[4], m[5], 1,
          ]);

          const isHead = part.key === 'head';
          const useCrop = isHead && useHeadCrop && headTex[expr!];
          if (useCrop) {
            // 头部用裁剪贴图：部件内 0-1 直接映射到贴图
            gl.uniform2f(U.u_uvOffset as any, 0, 0);
            gl.uniform2f(U.u_uvScale as any, 1, 1);
            gl.bindTexture(gl.TEXTURE_2D, headTex[expr!]);
            gl.uniform1f(U.u_deform as any, 0);   // 表情已烘焙，不再叠加眨眼
          } else {
            gl.uniform2f(U.u_uvOffset as any, part.rect[0], part.rect[1]);
            gl.uniform2f(U.u_uvScale as any, part.rect[2], part.rect[3]);
            gl.bindTexture(gl.TEXTURE_2D, tex);
            gl.uniform1f(U.u_deform as any, part.deform ?? 0);
          }
          gl.drawElements(gl.TRIANGLES, localIdx.length, gl.UNSIGNED_INT, 0);
        }
      }

      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener('pointerdown', onDown);
    };
  }, [onTap, scale]);

  return <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} aria-label="宠物" />;
}
