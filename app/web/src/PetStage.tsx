import { useEffect, useRef } from 'react';

/**
 * 宠物舞台：单张立绘 + WebGL 网格变形。
 * 不做序列帧、不绑骨——形变由着色器按屏幕坐标权重实时计算。
 * 表情通过 posture 参数驱动（下垂/上扬/蜷缩），配合气泡文字表达情绪。
 */

type Props = {
  mood?: string;          // happy | hungry | sleepy | dirty | bored | sick
  energy?: number;        // 0-100，越低越慵懒
  scale?: number;         // 成长比例
  action?: 'idle' | 'hop' | 'eat' | 'sleep';
  walking?: boolean;      // 行走中：步频加快、身体前后摆
  showMesh?: boolean;     // 调试：叠加变形网格
  onTap?: () => void;
};

const VS = `#version 300 es
in vec2 a_uv;
uniform vec2 u_res, u_size, u_offset, u_look;
uniform float u_time, u_blink, u_hop, u_tilt, u_sink, u_squash, u_liveliness;
out vec2 v_uv;

void main(){
  vec2 uv = a_uv;
  float t = u_time;
  float wHead = 1.0 - smoothstep(0.30, 0.52, uv.y);
  float wEarL = 1.0 - smoothstep(0.10, 0.30, uv.x);
  float wEarR = smoothstep(0.70, 0.90, uv.x);
  float wEar  = (wEarL + wEarR) * wHead;
  float wTail = smoothstep(0.05, 0.30, 0.25 - abs(uv.y - 0.62)) * (1.0 - smoothstep(0.18, 0.40, uv.x));
  float wBot  = smoothstep(0.55, 1.0, uv.y);

  vec2 d = vec2(0.0);

  // 呼吸：活力越低幅度越小、频率越慢
  float br = sin(t * (1.35 + u_liveliness * 0.7));
  d.x += (uv.x - 0.5) * 0.012 * br * (1.0 - wHead * 0.5);
  d.y -= 0.006 * br * wHead * (0.5 + u_liveliness * 0.5);

  // 重心摆动
  float sw = sin(t * 0.62);
  d.x += 0.008 * sw * (1.0 - wBot * 0.85) * (0.4 + u_liveliness * 0.6);

  // 朝向指针
  d.x += u_look.x * 0.045 * wHead;
  d.y += u_look.y * 0.026 * wHead;
  d.x += sin(t * 0.9) * 0.004 * wHead * u_liveliness;

  // 耳朵跟随
  float fl = sin(t * 1.35);
  d.x += fl * 0.010 * wEar * (0.5 + u_liveliness * 0.5);
  d.y += cos(t * 1.35) * 0.006 * wEar * (0.5 + u_liveliness * 0.5);

  // 尾巴
  d.x += sin(t * 2.6) * 0.014 * wTail * u_liveliness;
  d.y += cos(t * 2.6) * 0.006 * wTail * u_liveliness;

  // 眨眼
  float band = smoothstep(0.16, 0.22, uv.y) * (1.0 - smoothstep(0.27, 0.33, uv.y));
  d.y += (0.245 - uv.y) * 0.90 * band * u_blink;

  // 弹跳
  d.y -= 0.032 * u_hop * (1.0 - smoothstep(0.62, 1.0, uv.y));
  // 歪头
  d.x += (uv.y - 0.5) * u_tilt * 0.10 * wHead;
  // 下垂（生病/困倦）
  d.y += u_sink * (1.0 - wBot) * 0.05;
  // 压扁（开心/撒欢）
  d.y += (0.5 - uv.y) * u_squash * 0.06;

  uv += d;
  vec2 px = u_offset + vec2((uv.x - 0.5) * u_size.x, (uv.y - 0.5) * u_size.y);
  gl_Position = vec4(px.x / u_res.x * 2.0 - 1.0, 1.0 - px.y / u_res.y * 2.0, 0.0, 1.0);
  v_uv = a_uv;
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

const FS_LINE = `#version 300 es
precision mediump float;
uniform vec4 u_color;
out vec4 o;
void main(){ o = u_color; }`;

function compile(gl: WebGL2RenderingContext, type: number, src: string) {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
  return s;
}

const MOOD_PARAM: Record<string, { tilt: number; sink: number; squash: number; liveliness: number }> = {
  happy:  { tilt: 0.10, sink: -0.15, squash: 0.25, liveliness: 1.0 },
  hungry: { tilt: -0.18, sink: 0.25, squash: -0.1, liveliness: 0.6 },
  sleepy: { tilt: 0.22, sink: 0.6, squash: -0.2, liveliness: 0.28 },
  dirty:  { tilt: -0.08, sink: 0.2, squash: -0.1, liveliness: 0.55 },
  bored:  { tilt: 0.14, sink: 0.35, squash: -0.15, liveliness: 0.4 },
  sick:   { tilt: -0.3, sink: 0.7, squash: -0.25, liveliness: 0.22 },
};

export default function PetStage({ mood = 'happy', energy = 80, scale = 1, action = 'idle', walking = false, showMesh = false, onTap }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const params = useRef({ mood, energy, scale, action, walking });
  params.current = { mood, energy, scale, action, walking };
  const tapRef = useRef<{ hop: number; hopV: number }>({ hop: 0, hopV: 0 });
  const lookRef = useRef({ x: 0, y: 0, tx: 0, ty: 0 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext('webgl2', { alpha: true, antialias: true, premultipliedAlpha: true });
    if (!gl) {
      canvas.style.display = 'none';
      const fb = document.createElement('img');
      fb.src = '/pet/idle.png';
      fb.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:contain';
      canvas.parentElement?.appendChild(fb);
      return;
    }

    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error(gl.getProgramInfoLog(prog));
      return;
    }
    gl.useProgram(prog);

    // 线框调试用：同一套顶点着色器，输出纯色
    const lineProg = gl.createProgram()!;
    gl.attachShader(lineProg, compile(gl, gl.VERTEX_SHADER, VS));
    gl.attachShader(lineProg, compile(gl, gl.FRAGMENT_SHADER, FS_LINE));
    gl.linkProgram(lineProg);
    const lineU: Record<string, WebGLUniformLocation | null> = {};
    ['u_res', 'u_size', 'u_offset', 'u_look', 'u_time', 'u_blink', 'u_hop', 'u_tilt',
     'u_sink', 'u_squash', 'u_liveliness', 'u_color'].forEach((n) => (lineU[n] = gl.getUniformLocation(lineProg, n)));

    const NX = 48, NY = 72;
    const verts = new Float32Array((NX + 1) * (NY + 1) * 2);
    let p = 0;
    for (let j = 0; j <= NY; j++) for (let i = 0; i <= NX; i++) { verts[p++] = i / NX; verts[p++] = j / NY; }
    const indices = new Uint32Array(NX * NY * 6);
    let k = 0;
    for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
      const a = j * (NX + 1) + i, b = a + 1, c = a + NX + 1, d = c + 1;
      indices[k++] = a; indices[k++] = c; indices[k++] = b;
      indices[k++] = b; indices[k++] = c; indices[k++] = d;
    }

    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'a_uv');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

    // 调试线框：每 6 条取一条，画出肉眼可读的稀疏网格
    const STEP = 6;
    const edges: number[] = [];
    for (let j = 0; j <= NY; j += STEP) {
      for (let i = 0; i < NX; i++) {
        edges.push(j * (NX + 1) + i, j * (NX + 1) + i + 1);
      }
    }
    for (let i = 0; i <= NX; i += STEP) {
      for (let j = 0; j < NY; j++) {
        edges.push(j * (NX + 1) + i, (j + 1) * (NX + 1) + i);
      }
    }
    const ebo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ebo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(edges), gl.STATIC_DRAW);
    const edgeCount = edges.length;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);

    const U: Record<string, WebGLUniformLocation | null> = {};
    ['u_res', 'u_size', 'u_offset', 'u_look', 'u_time', 'u_blink', 'u_hop', 'u_tilt', 'u_sink', 'u_squash', 'u_liveliness', 'u_tex']
      .forEach((n) => (U[n] = gl.getUniformLocation(prog, n)));

    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    let imgW = 1, imgH = 1, ready = false;
    const img = new Image();
    img.onload = () => {
      imgW = img.naturalWidth; imgH = img.naturalHeight;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      ready = true;
    };
    img.src = '/pet/idle.png';

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

    const onMove = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      lookRef.current.tx = Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / (r.width * 0.5)));
      lookRef.current.ty = Math.max(-1, Math.min(1, (e.clientY - (r.top + r.height * 0.34)) / (r.height * 0.5)));
    };
    const onLeave = () => { lookRef.current.tx = 0; lookRef.current.ty = 0; };
    const onDown = () => { tapRef.current.hopV = 1.2; onTap?.(); };
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerleave', onLeave);
    canvas.addEventListener('pointerdown', onDown);

    let raf = 0, last = performance.now(), t0 = nowSec(), blink = 0, blinkT = -1, blinkNext = 2.2;
    const qs = new URLSearchParams(location.search);
    const freezeAt = qs.has('freeze') ? parseFloat(qs.get('freeze')!) : null;
    const tmp = { tilt: 0, sink: 0, squash: 0, live: 1 };

    function nowSec() { return performance.now() / 1000; }
    const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

    function frame(now: number) {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      const t = freezeAt !== null ? freezeAt : (now / 1000 - t0);
      const { mood: m, energy: en, scale: sc, action: act, walking: wk } = params.current;
      const mp = MOOD_PARAM[m] ?? MOOD_PARAM.happy;

      const energyK = Math.max(0.2, Math.min(1, en / 100));
      const targetLive = mp.liveliness * (0.45 + energyK * 0.55);
      const targetSink = act === 'sleep' ? 0.9 : mp.sink;
      const targetTilt = act === 'sleep' ? 0.3 : mp.tilt;
      const targetSquash = act === 'eat' ? 0.5 : mp.squash;

      // 行走：步频提高，身体随步点上下起伏
      const walkK = wk ? 1 : 0;
      const stepBob = walkK ? Math.sin(t * 9.2) * 0.016 : 0;
      const stepTilt = walkK ? Math.sin(t * 4.6) * 0.14 : 0;

      tmp.live = lerp(tmp.live, targetLive * (wk ? 1.55 : 1), 0.12);
      tmp.sink = lerp(tmp.sink, targetSink - stepBob, 0.14);
      tmp.tilt = lerp(tmp.tilt, targetTilt + stepTilt, 0.16);
      tmp.squash = lerp(tmp.squash, targetSquash, 0.06);

      lookRef.current.x = lerp(lookRef.current.x, lookRef.current.tx, 0.08);
      lookRef.current.y = lerp(lookRef.current.y, lookRef.current.ty, 0.08);

      const tap = tapRef.current;
      tap.hopV += -tap.hop * 120 * dt;
      tap.hopV *= 0.9;
      tap.hop += tap.hopV * dt;

      if (blinkT < 0 && t > blinkNext) blinkT = 0;
      if (blinkT >= 0) {
        blinkT += dt;
        const d = 0.17;
        blink = blinkT < d / 2 ? blinkT / (d / 2) : Math.max(0, 1 - (blinkT - d / 2) / (d / 2));
        if (blinkT > d) { blinkT = -1; blink = 0; blinkNext = t + 2.4 + Math.random() * 3.2; }
      }

      if (ready) {
        gl.clear(gl.COLOR_BUFFER_BIT);
        const fit = Math.min(W / imgW, H / imgH) * 0.92 * sc;
        const sizeX = imgW * fit, sizeY = imgH * fit;
        gl.uniform2f(U.u_res as any, W, H);
        gl.uniform2f(U.u_size as any, sizeX, sizeY);
        gl.uniform2f(U.u_offset as any, W / 2, H / 2 + sizeY * 0.02);
        gl.uniform2f(U.u_look as any, dLookX, dLookY);
        gl.uniform1f(U.u_time as any, t * (act === 'sleep' ? 0.55 : 1));
        gl.uniform1f(U.u_blink as any, blink);
        gl.uniform1f(U.u_hop as any, Math.max(0, tap.hop));
        gl.uniform1f(U.u_tilt as any, dTilt);
        gl.uniform1f(U.u_sink as any, dSink);
        gl.uniform1f(U.u_squash as any, dSquash);
        gl.uniform1f(U.u_liveliness as any, tmp.live);
        gl.uniform1i(U.u_tex as any, 0);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.drawElements(gl.TRIANGLES, indices.length, gl.UNSIGNED_INT, 0);
      }

      // 线框叠加：让人直接看到「这张图被切成了多少块、每块怎么弯」
      if (showMesh && ready) {
        gl.useProgram(lineProg);
        const fit2 = Math.min(W / imgW, H / imgH) * 0.92 * sc;
        const sx = imgW * fit2, sy = imgH * fit2;
        gl.uniform2f(lineU.u_res as any, W, H);
        gl.uniform2f(lineU.u_size as any, sx, sy);
        gl.uniform2f(lineU.u_offset as any, W / 2, H / 2 + sy * 0.02);
        gl.uniform2f(lineU.u_look as any, dLookX, dLookY);
        gl.uniform1f(lineU.u_time as any, t * (act === 'sleep' ? 0.55 : 1));
        gl.uniform1f(lineU.u_blink as any, blink);
        gl.uniform1f(lineU.u_hop as any, Math.max(0, tap.hop));
        gl.uniform1f(lineU.u_tilt as any, dTilt);
        gl.uniform1f(lineU.u_sink as any, dSink);
        gl.uniform1f(lineU.u_squash as any, dSquash);
        gl.uniform1f(lineU.u_liveliness as any, tmp.live);
        gl.uniform4f(lineU.u_color as any, 0.14, 0.45, 0.33, 0.85);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ebo);
        gl.drawElements(gl.LINES, edgeCount, gl.UNSIGNED_INT, 0);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
        gl.useProgram(prog);
      }
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('pointerdown', onDown);
    };
  }, [onTap]);

  return <canvas id="petCanvas" ref={canvasRef} aria-label="宠物" />;
}
