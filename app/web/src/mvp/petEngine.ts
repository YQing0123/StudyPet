/**
 * 宠物舞台引擎
 * ------------------------------------------------------------
 * 直接复用 MengChong 逆向程序的三层显示方案：
 *   1) PNG 姿态图 + CSS 呼吸/压扁
 *   2) H.264兼容动作 / WebM 动作片 + WebGL 实时抠像（左右透明蒙版 / alpha / 绿幕 / 蓝幕）
 *   3) 17 态状态机裁剪成适合网页宠物的 11 态
 * 尺寸补偿沿用原程序的 FR_COMP / VD_COMP / ACT_COMP / CARE_COMP。
 */

import { BREED_COMP } from './breedConfig';
import type { ShopItem } from './types';

type AttachmentPoint = [number, number, number, number, number];
interface AttachmentTracks {
  frames: Record<string, AttachmentPoint>;
  videos: Record<string, { fps: number; points: AttachmentPoint[] }>;
}
let attachmentsPromise: Promise<AttachmentTracks> | null = null;
function loadAttachments() {
  return attachmentsPromise ||= fetch('pets/attachments.json').then(r => {
    if (!r.ok) throw new Error('装扮定位加载失败');
    return r.json() as Promise<AttachmentTracks>;
  }).catch(e => { attachmentsPromise = null; throw e; });
}

type Mode = 'alpha' | 'green' | 'blue' | 'packed-alpha';

interface VideoEntry {
  file: string; mode: Mode; bottom?: number;
  compatible?: { file: string; mode: Mode };
  gait?: { stridePixels: number; supportSeconds: number; canvasPixels: number };
}
interface ManifestBreed {
  name: string;
  species: string;
  avatar: string;
  frames: { key: string; file: string; bottom?: number }[];
  videos: Record<string, VideoEntry>;
  walkTransitions?: boolean;
  sourceVersion?: string;
  growth?: Record<string, { avatar: string; frames: ManifestBreed['frames']; videos: ManifestBreed['videos'] }>;
}
interface Manifest {
  breeds: Record<string, ManifestBreed>;
  eggs: Record<string, { egg?: string; hatch?: string }>;
  sounds: Record<string, string>;
}


function compatibleSource(video: HTMLVideoElement, entry: VideoEntry) {
  return entry.compatible && video.canPlayType('video/mp4; codecs="avc1.4D401F"') ? entry.compatible : entry;
}

const STAGE_SCALE = [0.5, 0.62, 0.8, 0.92, 1.0, 1.0, 0.94];
const STAGE_RATE = [1, 1.12, 1.12, 1, 1, 1, 0.85];
const PET_ZOOM = 0.7;
const GLOBAL_SCALE = 3.1;
const GLOBAL_SCALE_MOBILE = 2.35;
const PET_BASE = 'pets/';

const SOUND_MAP: Record<string, { hello: string[]; happy: string[]; sleep: string[] }> = {
  cat: { hello: ['cat-meow', 'cat-attention'], happy: ['cat-purr', 'cat-attention'], sleep: ['cat-purr'] },
  dog: { hello: ['dog-woof', 'dog-yap'], happy: ['dog-happy', 'dog-puppy'], sleep: ['dog-happy'] },
  bird: { hello: ['bird-chirp', 'bird-call'], happy: ['bird-song', 'bird-chirp'], sleep: ['bird-chirp'] },
  turtle: { hello: ['turtle-grunt', 'turtle-water'], happy: ['turtle-grunt'], sleep: ['turtle-water'] },
  capybara: { hello: [], happy: [], sleep: [] },
  alpaca: { hello: [], happy: [], sleep: [] },
};

let manifestPromise: Promise<Manifest> | null = null;
function loadManifest(): Promise<Manifest> {
  if (!manifestPromise) {
    manifestPromise = fetch(`${PET_BASE}manifest.json`).then((r) => {
      if (!r.ok) throw new Error('素材清单加载失败');
      return r.json();
    }).catch((error) => { manifestPromise = null; throw error; });
  }
  return manifestPromise;
}

export async function preloadPetAge(breed: string, age: number) {
  try {
    const manifest = await loadManifest();
    const base = manifest.breeds[breed];
    const look = base?.growth?.[String(age)] || base;
    if (!look) return;
    await Promise.race([Promise.all(look.frames.filter(f => f.key === 'sit' || f.key === 'jump').map(f => new Promise<void>(resolve => {
      const image = new Image(); image.onload = () => resolve(); image.onerror = () => resolve();
      image.src = `${PET_BASE}${f.file}${base.sourceVersion ? `?v=${encodeURIComponent(base.sourceVersion)}` : ''}`;
    }))), new Promise(resolve => setTimeout(resolve, 1800))]);
    const entry = look.videos.greet;
    if (entry) {
      const video = document.createElement('video'); video.preload = 'auto'; video.muted = video.defaultMuted = true; video.playsInline = true;
      const { file } = compatibleSource(video, entry);
      video.src = `${PET_BASE}${file}${base.sourceVersion ? `?v=${encodeURIComponent(base.sourceVersion)}` : ''}`;
      await Promise.race([new Promise(resolve => { video.onloadeddata = resolve; video.onerror = resolve; video.load(); }), new Promise(resolve => setTimeout(resolve, 1200))]);
      video.removeAttribute('src'); video.load();
    }
  } catch { /* The engine can still display the target age's static frame. */ }
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

export type PetAction = 'pet' | 'feed' | 'play' | 'hug' | 'greet' | 'happy' | 'sleep' | 'wake' | 'stretch';

interface PetState {
  breed: string;
  stage: number;
  phase?: number;
  sound: string;
  outfit: Record<string, string>;
}

type StateName = 'BOOT' | 'IDLE' | 'WANDER' | 'HAPPY' | 'GREET' | 'SLEEPY' | 'SLEEP' | 'WAKING' | 'EATING' | 'PETTED' | 'PLAY' | 'HUG' | 'CLEANING';

export class PetEngine {
  private root: HTMLElement;
  private manifest!: Manifest;
  private pet: PetState = { breed: 'cat_orange', stage: 1, sound: 'cat', outfit: {} };
  private destroyed = false;
  private playbackId = 0;
  private timers = new Set<number>();
  private pendingAction: PetAction | null = null;
  private pendingMaterial: Pick<ShopItem, 'key' | 'kind'> | null = null;
  private attachments: AttachmentTracks | null = null;
  private cleanTimer = 0;
  private cleanFinishTimer = 0;
  private pointerHandler = (e: PointerEvent) => this.onPointer(e);
  private keyboardHandler = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.onPetClick ? this.onPetClick() : this.play('pet'); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); this.wanderTo(this.position - 18); }
    if (e.key === 'ArrowRight') { e.preventDefault(); this.wanderTo(this.position + 18); }
  };
  private later(fn: () => void, ms: number) {
    const timer = window.setTimeout(() => { this.timers.delete(timer); if (!this.destroyed) fn(); }, ms);
    this.timers.add(timer);
    return timer;
  }
  private freezeMovement() {
    const width = this.root.clientWidth;
    if (width) this.position = clamp(parseFloat(getComputedStyle(this.mover).left) / width * 100, 15, 85);
    this.mover.style.transition = 'none';
    this.mover.style.left = `${this.position}%`;
  }
  private interrupt() {
    clearTimeout(this.stateTimer); clearTimeout(this.walkTimer); clearTimeout(this.idleTimer);
    this.freezeMovement(); this.stopVideo(); this.showZzz(false);
    this.sleeping = false;
    this.root.classList.remove('is-happy');
    clearTimeout(this.cleanTimer); clearTimeout(this.cleanFinishTimer);
    this.root.querySelector('.pet-cleaning')?.remove();
    delete this.root.dataset.cleaning;
  }
  private muted = false;
  private activeSounds = new Set<HTMLAudioElement>();

  private mover!: HTMLDivElement;
  private flip!: HTMLDivElement;
  private frameA!: HTMLImageElement;
  private frameB!: HTMLImageElement;
  private framesWrap!: HTMLDivElement;
  private videoWrap!: HTMLDivElement;
  private video!: HTMLVideoElement;
  private canvas!: HTMLCanvasElement;
  private gl: WebGLRenderingContext | null = null;
  private uBlue: WebGLUniformLocation | null = null;
  private uAlpha: WebGLUniformLocation | null = null;
  private uPackedAlpha: WebGLUniformLocation | null = null;
  private usingCompatible = false;
  private videoOptions: { loop?: boolean; rate?: number } = {};
  private tex: WebGLTexture | null = null;
  private videoPlaying = false;
  private raf = 0;
  private videoFrameCallback = 0;
  private lastUploadedTime = -1;
  private visibilityHandler = () => {
    if (document.hidden) { this.stopVideoLoop(); this.video.pause(); }
    else if (this.videoPlaying && !this.destroyed) {
      this.startVideoLoop();
      const id = this.playbackId;
      this.video.play().catch(() => { if (id === this.playbackId) this.videoFailed(); });
    }
  };
  private revealed = false;
  private curAction: string | null = null;
  private curMode: Mode = 'green';
  private activeFrame = 'sit';
  private frameLayerOn = true;

  private state: StateName = 'BOOT';
  private idleTimer = 0;
  private stateTimer = 0;
  private walkTimer = 0;
  private moveTimer = 0;
  private bubbleTimer = 0;
  private sayTimer = 0;
  private interactionUntil = 0;
  private bubbleFollow = 0;
  private frameBounds = new Map<string, { top: number; halfWidth: number }>();
  private petHalfWidth = 90;
  private measuringBounds = new Set<string>();
  private position = 50;
  private flipSign = 1;
  private movementRange: [number, number] = [18, 82];
  private sleeping = false;
  private displayScale = 1;
  private onPetClick?: () => void;
  private onResize = () => this.applyScale();
  private scaleForViewport() {
    return (window.innerWidth < 680 ? GLOBAL_SCALE_MOBILE : GLOBAL_SCALE) * this.displayScale;
  }

  constructor(root: HTMLElement, opts: { onPetClick?: () => void; movementRange?: [number, number]; displayScale?: number } = {}) {
    this.root = root;
    this.onPetClick = opts.onPetClick;
    this.displayScale = clamp(opts.displayScale ?? 1, .2, 1);
    this.movementRange = opts.movementRange ?? [18, 82];
    this.build();
    window.addEventListener('resize', this.onResize);
    document.addEventListener('visibilitychange', this.visibilityHandler);
    this.initGL();
    loadAttachments().then(tracks => { if (!this.destroyed) { this.attachments = tracks; this.positionOutfit(); } }).catch(() => { /* Fall back to the measured still-frame head. */ });
    loadManifest().then((m) => {
      this.manifest = m;
      if (!this.destroyed) {
        this.applyBreed();
        this.boot();
      }
        if (this.pendingAction) { const action = this.pendingAction; this.pendingAction = null; this.play(action); }
        if (this.pendingMaterial) { const item = this.pendingMaterial; this.pendingMaterial = null; this.useMaterial(item); }
    }).catch(() => {
      if (!this.destroyed) {
        this.frameA.src = `${PET_BASE}breeds/${this.pet.breed}/frames/frame-sit.png`;
        this.root.dataset.renderer = 'frame';
        this.say('小伙伴的动作暂时没加载好，刷新后再试试。', 6000);
      }
    });
  }

  /* ---------------- DOM ---------------- */
  private build() {
    this.root.innerHTML = `
      <div class="pet-rig">
        <div class="pet-mover">
          <div class="pet-bubble" data-empty="1" role="status" aria-live="polite"></div>
          <div class="pet-shadow"></div>
          <div class="pet-flip" data-flip="1">
            <div class="pet-frames">
              <img class="pet-frame a is-on" alt="" draggable="false" />
              <img class="pet-frame b" alt="" draggable="false" />
            </div>
            <div class="pet-video-wrap">
              <video class="pet-video" muted playsinline preload="auto"></video>
              <canvas class="pet-canvas" width="512" height="512"></canvas>
            </div>
            <div class="pet-outfit" data-on="0" aria-hidden="true">
              <img class="pet-accessory accessory-crown" src="pets/items/crown.svg" alt="" draggable="false" hidden />
              <img class="pet-accessory accessory-bow" src="pets/items/bow.svg" alt="" draggable="false" hidden />
            </div>
            <div class="pet-zzz" aria-hidden="true"><i>z</i><i>z</i><i>z</i></div>
          </div>
          <div class="pet-growth-mark" aria-label="进阶成长星章">✦</div>
        </div>
      </div>`;
    this.mover = this.root.querySelector('.pet-mover')!;
    this.flip = this.root.querySelector('.pet-flip')!;
    this.framesWrap = this.root.querySelector('.pet-frames')!;
    this.frameA = this.root.querySelector('.pet-frame.a')!;
    this.frameB = this.root.querySelector('.pet-frame.b')!;
    this.videoWrap = this.root.querySelector('.pet-video-wrap')!;
    this.video = this.root.querySelector('.pet-video')!;
    // WebKit requires property-level muting and inline playback.
    this.video.muted = this.video.defaultMuted = true;
    this.video.playsInline = true;
    this.video.setAttribute('webkit-playsinline', '');
    this.canvas = this.root.querySelector('.pet-canvas')!;
    this.mover.style.left = `${this.position}%`;
    this.video.addEventListener('ended', () => this.onVideoEnded());
    this.video.addEventListener('error', () => {
      if (this.videoPlaying) this.videoFailed();
    });
    this.root.addEventListener('pointerdown', this.pointerHandler);
    this.root.addEventListener('keydown', this.keyboardHandler);
  }

  private onPointer(e: PointerEvent) {
    if (this.state === 'CLEANING') return;
    const target = e.target as HTMLElement;
    if (target.closest('.pet-bubble')) return;
    const rect = this.root.getBoundingClientRect();
    const x = clamp(((e.clientX - rect.left) / rect.width) * 100, 16, 84);
    if (target.closest('.pet-mover')) {
      if (this.onPetClick) this.onPetClick();
      else this.play('pet');
    } else {
      this.wanderTo(x);
    }
  }

  /* ---------------- WebGL ---------------- */
  private initGL() {
    const gl = this.canvas.getContext('webgl', { alpha: true, premultipliedAlpha: false, preserveDrawingBuffer: true });
    if (!gl) return;
    this.gl = gl;
    const vs = 'attribute vec2 a_pos; varying vec2 v_uv; void main(){ v_uv = vec2(a_pos.x*0.5+0.5, 0.5-a_pos.y*0.5); gl_Position=vec4(a_pos,0.0,1.0); }';
    const fs = `
      precision mediump float;
      uniform sampler2D u_tex;
      uniform float u_blue;
      uniform float u_alpha;
      uniform float u_packed_alpha;
      varying vec2 v_uv;
      void main(){
        vec2 colorUV = vec2(v_uv.x * 0.5, v_uv.y);
        vec4 c = texture2D(u_tex, u_packed_alpha > 0.5 ? colorUV : v_uv);
        if (u_packed_alpha > 0.5) c.a = texture2D(u_tex, colorUV + vec2(0.5, 0.0)).r;
        if (u_alpha > 0.5 || u_packed_alpha > 0.5) {
          vec3 col = c.rgb;
          float domE = c.g - max(c.r, c.b);
          if (domE > 0.30 && c.r < 0.20) col.g = max(c.r, c.b) + 0.10;
          gl_FragColor = vec4(col, c.a);
          return;
        }
        float dom = (u_blue > 0.5) ? (c.b - max(c.r, c.g)) : (c.g - max(c.r, c.b));
        float a = 1.0 - smoothstep(0.06, 0.17, dom);
        float despill = clamp(dom * 2.2, 0.0, 1.0);
        vec3 col = c.rgb - despill * 1.2 * mix(vec3(0.0,1.0,0.0), vec3(0.0,0.0,1.0), u_blue);
        gl_FragColor = vec4(col, a);
      }`;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(s));
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, vs));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(prog); gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'a_pos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.uniform1i(gl.getUniformLocation(prog, 'u_tex'), 0);
    this.uBlue = gl.getUniformLocation(prog, 'u_blue');
    this.uAlpha = gl.getUniformLocation(prog, 'u_alpha');
    this.uPackedAlpha = gl.getUniformLocation(prog, 'u_packed_alpha');
    gl.uniform1f(this.uBlue, 0);
    gl.uniform1f(this.uAlpha, 0);
    gl.uniform1f(this.uPackedAlpha, 0);
    gl.clearColor(0, 0, 0, 0);
    gl.viewport(0, 0, 512, 512);
    this.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault(); this.gl = null; this.fallbackToFrame(this.curAction || undefined);
    });
    this.canvas.addEventListener('webglcontextrestored', () => { if (!this.destroyed) this.initGL(); });
  }

  /* ---------------- 品种 / 尺寸 ---------------- */
  private comp() {
    return BREED_COMP[this.pet.breed] || BREED_COMP.cat_orange as any;
  }

  private petMediaURL(file: string) {
    const info = this.manifest.breeds[this.pet.breed] || this.manifest.breeds.cat_orange;
    return `${PET_BASE}${file}${info.sourceVersion ? `?v=${encodeURIComponent(info.sourceVersion)}` : ''}`;
  }

  private appearance() {
    const base = this.manifest.breeds[this.pet.breed] || this.manifest.breeds.cat_orange;
    return base.growth?.[String(clamp(this.pet.stage, 1, 6))] || base;
  }

  private applyBreed() {
    const breed = this.pet.breed;
    this.root.dataset.breed = breed;
    const info = this.appearance();
    const comp = this.comp();
    for (const f of info.frames) {
      const img = f.key === 'sit' ? this.frameA : new Image();
      img.dataset.frame = f.key;
      img.src = this.petMediaURL(f.file);
    }
    this.frameA.dataset.frame = 'sit';
    this.frameA.src = this.petMediaURL(info.frames.find((f) => f.key === 'sit')?.file || '');
    this.frameB.src = this.frameA.src;
    this.applyScale();
    this.renderOutfit();
  }

  private applyScale() {
    const comp = this.comp();
    const st = clamp(this.pet.stage, 1, 6);
    const stage = STAGE_SCALE[st] ?? 1;
    const zoom = stage * PET_ZOOM * this.scaleForViewport();
    const actKey = this.curAction || '';
    const act = (comp.act as Record<string, number>)[actKey] || (comp.care as Record<string, number>)[actKey] || 1;
    this.root.style.setProperty('--frame-scale', (zoom * comp.fr).toFixed(3));
    this.root.style.setProperty('--video-scale', (zoom * comp.vd * act).toFixed(3));
    const info = this.manifest ? this.appearance() : undefined;
    const frameBottom = info?.frames.find((f) => f.key === this.activeFrame)?.bottom ?? 1;
    const videoBottom = info?.videos[actKey]?.bottom ?? 1;
    this.root.style.setProperty('--frame-offset', `${196 * zoom * comp.fr * (1 - frameBottom)}px`);
    this.root.style.setProperty('--video-offset', `${230 * zoom * comp.vd * act * (1 - videoBottom)}px`);
    this.root.dataset.stage = String(st);
    this.root.dataset.phase = String(this.pet.phase || 1);
    this.positionBubbleHead();
    this.positionOutfit();
  }

  private positionBubbleHead() {
    const comp = this.comp();
    const zoom = (STAGE_SCALE[clamp(this.pet.stage, 1, 6)] ?? 1) * PET_ZOOM * this.scaleForViewport();
    const info = this.manifest ? this.appearance() : undefined;
    const reference = info?.frames.find(f => f.key === (this.curAction === 'sleep' ? 'sleep' : this.activeFrame)) || info?.frames[0];
    if (!reference) return;
    const url = this.petMediaURL(reference.file);
    const bound = this.frameBounds.get(url);
    const top = bound?.top ?? .18;
    this.petHalfWidth = Math.max(48, 196 * zoom * comp.fr * (bound?.halfWidth ?? .38)) + 10;
    this.keepPetVisible();
    const headHeight = 196 * zoom * comp.fr * ((reference.bottom ?? 1) - top);
    this.root.style.setProperty('--pet-head-height', `${Math.max(70, headHeight) + 12}px`);
    this.root.style.setProperty('--pet-body-height', `${Math.max(80, headHeight)}px`);
    this.root.style.setProperty('--pet-body-width', `${this.petHalfWidth * 2}px`);
    if (this.frameBounds.has(url) || this.measuringBounds.has(url)) return;
    this.measuringBounds.add(url);
    const img = new Image();
    img.onload = () => {
      if (this.destroyed) return;
      try {
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, 64, 64);
        const pixels = ctx.getImageData(0, 0, 64, 64).data;
        let first = 64, left = 64, right = 0;
        for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
          if (pixels[(y * 64 + x) * 4 + 3] > 40) { first = Math.min(first, y); left = Math.min(left, x); right = Math.max(right, x); }
        }
        this.frameBounds.set(url, { top: first < 64 ? first / 64 : .18, halfWidth: first < 64 ? Math.max(.5 - left / 64, (right + 1) / 64 - .5) : .38 });
        this.positionBubbleHead();
      } catch { this.frameBounds.set(url, { top: .18, halfWidth: .38 }); }
    };
    img.src = url;
  }

  private renderOutfit() {
    const el = this.root.querySelector('.pet-outfit') as HTMLElement;
    if (!el) return;
    const outfit = this.pet.outfit || {};
    const has = (key: string) => !!outfit[key] || Object.values(outfit).includes(key);
    const crown = el.querySelector<HTMLImageElement>('.accessory-crown')!;
    const bow = el.querySelector<HTMLImageElement>('.accessory-bow')!;
    crown.hidden = !has('crown'); bow.hidden = !has('bow');
    el.dataset.on = has('crown') || has('bow') ? '1' : '0';
    this.positionOutfit();
  }

  private positionOutfit() {
    if (!this.manifest) return;
    const el = this.root.querySelector<HTMLElement>('.pet-outfit');
    if (!el || el.dataset.on !== '1') return;
    const info = this.appearance();
    const comp = this.comp();
    const zoom = (STAGE_SCALE[clamp(this.pet.stage, 1, 6)] ?? 1) * PET_ZOOM * this.scaleForViewport();
    const video = this.videoPlaying && this.revealed && !this.frameLayerOn;
    const entry = video ? info.videos[this.curAction || ''] : info.frames.find(f => f.key === this.activeFrame) || info.frames[0];
    if (!entry) return;
    const act = (comp.act as Record<string, number>)[this.curAction || ''] || (comp.care as Record<string, number>)[this.curAction || ''] || 1;
    const size = video ? 230 : 196;
    const scale = zoom * (video ? comp.vd * act : comp.fr);
    const offset = size * scale * (1 - (entry.bottom ?? 1));
    let point = this.attachments?.frames[entry.file];
    const track = video ? this.attachments?.videos[entry.file] : null;
    if (track?.points.length) {
      const sample = clamp(this.video.currentTime * track.fps, 0, track.points.length - 1);
      const from = track.points[Math.floor(sample)], to = track.points[Math.min(Math.floor(sample) + 1, track.points.length - 1)];
      point = from.map((v, i) => v + (to[i] - v) * (sample % 1)) as AttachmentPoint;
    }
    point ||= [.5, .22, .5, .49, .23];
    el.style.width = el.style.height = `${size}px`;
    el.style.transform = `translateX(-50%) translateY(${offset}px) scale(${scale})`;
    el.dataset.source = video ? 'video' : 'frame';
    const crown = el.querySelector<HTMLElement>('.accessory-crown')!;
    const bow = el.querySelector<HTMLElement>('.accessory-bow')!;
    for (const [node, x, y, width] of [[crown, point[0], point[1], point[4] * .82], [bow, point[2], point[3], point[4] * .72]] as const) {
      node.style.left = `${x * 100}%`; node.style.top = `${y * 100}%`; node.style.width = `${width * 100}%`;
    }
  }

  setPet(pet: PetState) {
    const breedChanged = pet.breed !== this.pet.breed;
    const stageChanged = pet.stage !== this.pet.stage;
    const wasSleeping = this.sleeping;
    this.pet = { ...this.pet, ...pet };
    if (!this.manifest) return;
    if (breedChanged || (stageChanged && this.manifest.breeds[pet.breed]?.growth)) {
      this.interrupt();
      this.state = 'IDLE';
      this.root.dataset.state = 'IDLE';
      this.applyBreed();
      this.showFrame('sit', false);
      this.showFrames(true);
      if (!breedChanged && wasSleeping) this.doSleep();
      else this.scheduleIdle();
    } else {
      this.applyScale();
      this.renderOutfit();
    }
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (m) { for (const sound of this.activeSounds) sound.pause(); this.activeSounds.clear(); }
  }
  setPetClickHandler(fn: () => void) { this.onPetClick = fn; }

  /* ---------------- 帧层 ---------------- */
  private frameEl(key: string): HTMLImageElement | null {
    const info = this.appearance();
    const file = info.frames.find((f) => f.key === key)?.file;
    if (!file) return null;
    const img = new Image();
    img.src = this.petMediaURL(file);
    return img;
  }

  showFrame(key: string, fade = true) {
    if (!this.manifest || this.destroyed) return;
    const info = this.appearance();
    const file = info.frames.find((f) => f.key === key)?.file || info.frames[0]?.file;
    if (!file) return;
    this.activeFrame = key;
    this.applyScale();
    const current = this.frameA.classList.contains('is-on') ? this.frameA : this.frameB;
    const next = current === this.frameA ? this.frameB : this.frameA;
    next.src = this.petMediaURL(file);
    if (!fade) {
      current.classList.remove('is-on');
      next.classList.add('is-on');
      return;
    }
    next.classList.add('is-on');
    current.classList.remove('is-on');
  }

  showFrames(on: boolean) {
    this.frameLayerOn = on;
    this.framesWrap.style.opacity = on ? '1' : '0';
    this.framesWrap.style.pointerEvents = on ? 'auto' : 'none';
    this.root.classList.toggle('is-video', !on);
    if (on) this.root.dataset.renderer = 'frame';
    this.positionOutfit();
  }

  private setFlip(dir: number) {
    const natural = this.comp().facing;
    const flip = natural * dir > 0 ? 1 : -1;
    this.flipSign = flip;
    this.flip.dataset.flip = String(flip);
  }

  /* ---------------- 视频层 ---------------- */
  private videoFor(action: string): VideoEntry | null {
    const info = this.appearance();
    return info.videos[action] || null;
  }

  private playVideo(action: string, opts: { loop?: boolean; rate?: number } = {}, original = false) {
    const entry = this.videoFor(action);
    if (!this.gl || !entry) return false;
    const keepCanvas = this.revealed && this.videoWrap.style.opacity === '1';
    this.stopVideo();
    const id = ++this.playbackId;
    const source = original ? entry : compatibleSource(this.video, entry);
    this.usingCompatible = source !== entry;
    this.videoOptions = opts;
    this.curAction = action;
    this.curMode = source.mode;
    this.applyScale();
    const gl = this.gl;
    gl.uniform1f(this.uBlue, source.mode === 'blue' ? 1 : 0);
    gl.uniform1f(this.uAlpha, source.mode === 'alpha' ? 1 : 0);
    gl.uniform1f(this.uPackedAlpha, source.mode === 'packed-alpha' ? 1 : 0);
    this.video.muted = this.video.defaultMuted = true;
    this.video.src = this.petMediaURL(source.file);
    this.root.dataset.videoFormat = this.usingCompatible ? source.mode === 'packed-alpha' ? 'h264-matte' : 'h264' : 'webm';
    this.video.loop = !!opts.loop;
    this.video.playbackRate = opts.rate ?? (STAGE_RATE[clamp(this.pet.stage, 1, 6)] ?? 1);
    this.video.currentTime = 0;
    this.videoPlaying = true;
    this.revealed = false;
    this.videoWrap.dataset.on = '1';
    this.videoWrap.style.opacity = keepCanvas ? '1' : '0';
    this.root.dataset.renderer = 'loading';
    this.startVideoLoop();
    const startedAt = performance.now();
    if (!document.hidden) this.video.play().catch(() => { if (this.playbackId === id && !this.destroyed) this.videoFailed(); });
    // 看门狗：3.5 秒画面还没推进就回退帧层
    this.later(() => {
      if (this.playbackId !== id) return;
      if (!document.hidden && this.videoPlaying && this.video.currentTime < 0.05 && performance.now() - startedAt > 3500) {
        this.videoFailed();
      }
    }, 3600);
    return true;
  }

  private videoFailed() {
    const action = this.curAction;
    // Keep the original source as a fallback for a missing/unsupported MP4.
    if (action && this.usingCompatible && this.playVideo(action, this.videoOptions, true)) return;
    this.fallbackToFrame(action || undefined);
  }

  private startVideoLoop() {
    if (this.raf || this.videoFrameCallback || document.hidden) return;
    const schedule = () => {
      if (!this.videoPlaying || this.destroyed || document.hidden) return;
      if (typeof this.video.requestVideoFrameCallback === 'function') this.videoFrameCallback = this.video.requestVideoFrameCallback(tick);
      else this.raf = requestAnimationFrame(tick);
    };
    const tick = () => {
      this.raf = 0; this.videoFrameCallback = 0;
      if (!this.videoPlaying || !this.gl || document.hidden) return;
      if (this.video.readyState >= 2 && !this.video.seeking && this.video.currentTime !== this.lastUploadedTime) {
        this.lastUploadedTime = this.video.currentTime;
        const gl = this.gl;
        gl.bindTexture(gl.TEXTURE_2D, this.tex);
        try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.video); }
        catch { this.raf = 0; this.videoFailed(); return; }
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        this.positionOutfit();
        if (!this.revealed) {
          if (this.curMode === 'alpha') {
            const pixel = new Uint8Array(4);
            let opaqueCorners = 0;
            for (const [x, y] of [[0, 0], [511, 0], [0, 511], [511, 511]]) {
              gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
              if (pixel[3] > 250) opaqueCorners++;
            }
            // Some decoders play VP9 colour but discard its alpha plane.
            if (opaqueCorners === 4) { this.raf = 0; this.videoFailed(); return; }
          }
          this.revealed = true;
          this.videoWrap.style.opacity = '1';
          this.showFrames(false);
          this.root.dataset.renderer = 'video';
        }
      }
      schedule();
    };
    schedule();
  }

  private stopVideoLoop() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    if (this.videoFrameCallback) this.video.cancelVideoFrameCallback(this.videoFrameCallback);
    this.videoFrameCallback = 0;
    this.lastUploadedTime = -1;
  }

  private stopVideo() {
    this.playbackId++;
    this.videoPlaying = false;
    this.stopVideoLoop();
    try { this.video.pause(); } catch {}
    this.videoWrap.dataset.on = '0';
    this.videoWrap.style.opacity = '0';
    this.curAction = null;
  }

  private onVideoEnded() {
    if (this.destroyed || !this.video.ended) return;
    const action = this.curAction;
    if (!action) return;
    if (action === 'walk-start' && this.state === 'WANDER') {
      this.startWalking(); return;
    }
    if (action === 'walk') {
      if (this.state === 'WANDER') {
        this.video.currentTime = 0;
        this.video.play().catch(() => {});
        return;
      }
      this.playWalkStop();
      return;
    }
    if (action === 'petted') {
      if (this.state === 'PETTED' && this.videoFor('petted-out')) {
        this.playVideo('petted-out');
        return;
      }
      this.finishAction();
      return;
    }
    if (action === 'eat' && this.videoFor('eatrev')) { this.playVideo('eatrev'); return; }
    if (action === 'sleep') {
      this.video.pause();
      this.videoPlaying = false;
      this.stopVideoLoop();
      return;
    }
    this.finishAction();
  }

  private finishAction() {
    this.stopVideo();
    this.state = 'IDLE';
    this.sleeping = false;
    this.showZzz(false);
    this.curAction = null;
    this.applyScale();
    this.showFrames(true);
    this.showFrame('sit', true);
    this.root.dataset.state = 'IDLE';
    this.scheduleIdle();
  }

  private fallbackToFrame(action?: string) {
    this.stopVideo();
    this.showFrames(true);
    this.root.dataset.renderer = 'frame';
    this.applyScale();
    const map: Record<string, string> = { eat: 'sit', petted: 'sit', play: 'roll', hug: 'jump', walk: 'walk', sleep: 'sleep', wake: 'sit' };
    this.showFrame(map[action || ''] || 'sit', true);
    if (this.state === 'SLEEP') { this.showZzz(true); return; }
    if (this.state === 'WANDER') {
      if (action === 'walk-start') this.startWalking();
      if (action !== 'walk-stop') return;
    }
    clearTimeout(this.stateTimer);
    this.stateTimer = this.later(() => this.finishAction(), 1600);
  }

  private playWalkStop() {
    const info = this.manifest.breeds[this.pet.breed];
    if (!info?.walkTransitions || !this.playVideo('walk-stop')) this.finishAction();
  }

  /* ---------------- 状态机 ---------------- */
  private boot() {
    this.showFrame('sit', false);
    this.showFrames(true);
    this.state = 'IDLE';
    this.root.dataset.state = 'IDLE';
    this.scheduleIdle(6000, 9000);
  }

  getState() { return this.state; }

  play(action: PetAction) {
    if (this.destroyed) return;
    if (this.state === 'CLEANING') return;
    if (!this.manifest) { this.pendingAction = action; return; }
    this.interrupt();
    this.showFrames(true);
    switch (action) {
      case 'pet': return this.doPetted();
      case 'feed': return this.doEat();
      case 'play': return this.doCare('PLAY', 'play');
      case 'hug': return this.doCare('HUG', 'hug');
      case 'greet': return this.doGreet();
      case 'happy': return this.doHappy();
      case 'sleep': return this.doSleep();
      case 'wake': return this.doWake();
      case 'stretch': return this.doStretch();
    }
  }

  useMaterial(item: Pick<ShopItem, 'key' | 'kind'>) {
    if (this.destroyed) return;
    if (!this.manifest) { this.pendingMaterial = item; return; }
    if (item.kind !== 'clean') {
      this.interrupt();
      if (item.kind === 'deco') { this.finishAction(); return; }
      this.play(item.kind === 'food' ? 'feed' : 'play');
      return;
    }
    this.interrupt();
    this.state = 'CLEANING'; this.root.dataset.state = 'CLEANING';
    this.root.dataset.cleaning = 'washing';
    this.showFrame('sit', false); this.showFrames(true);
    const layer = document.createElement('div');
    layer.className = 'pet-cleaning'; layer.setAttribute('aria-hidden', 'true');
    const tool = document.createElement('img');
    tool.className = 'clean-tool'; tool.alt = ''; tool.draggable = false;
    tool.src = `${PET_BASE}items/${item.key === 'brush' ? 'brush' : 'bath'}.svg`;
    layer.append(tool);
    for (let i = 0; i < 9; i++) {
      const bubble = document.createElement('i'); bubble.className = 'clean-bubble';
      bubble.style.setProperty('--i', String(i)); bubble.style.setProperty('--row', String(i % 3)); layer.append(bubble);
      const star = document.createElement('span'); star.className = 'clean-sparkle'; star.textContent = '✦';
      star.style.setProperty('--i', String(i)); star.style.setProperty('--row', String(i % 3)); layer.append(star);
    }
    this.flip.append(layer);
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.cleanTimer = this.later(() => {
      this.root.dataset.cleaning = 'sparkling';
      this.say('Buling buling，干干净净啦！', 2500);
    }, reduced ? 250 : 2000);
    this.cleanFinishTimer = this.later(() => {
      layer.remove(); delete this.root.dataset.cleaning;
      this.finishAction();
    }, reduced ? 1000 : 3000);
  }

  private doPetted() {
    this.state = 'PETTED';
    this.root.dataset.state = 'PETTED';
    if (!this.playVideo('petted')) {
      this.showFrame('sit', true);
      this.stateTimer = this.later(() => this.finishAction(), 1400);
    }
  }

  private doEat() {
    this.state = 'EATING';
    this.root.dataset.state = 'EATING';
    this.playSfx('hello');
    if (!this.playVideo('eat')) {
      this.showFrame('sit', true);
      this.stateTimer = this.later(() => this.finishAction(), 2200);
    }
  }

  private doCare(state: 'PLAY' | 'HUG', action: string) {
    this.state = state;
    this.root.dataset.state = state;
    this.playSfx('happy');
    if (!this.playVideo(action)) {
      this.showFrame(state === 'PLAY' ? 'roll' : 'jump', true);
      this.stateTimer = this.later(() => this.finishAction(), 1800);
    }
  }

  private doGreet() {
    this.state = 'GREET';
    this.root.dataset.state = 'GREET';
    this.playSfx('hello');
    if (!this.playVideo('greet')) {
      this.showFrame('sit', true);
      this.stateTimer = this.later(() => this.finishAction(), 1500);
    }
  }

  private doHappy() {
    this.state = 'HAPPY';
    this.root.dataset.state = 'HAPPY';
    this.playSfx('happy');
    this.showFrames(true);
    this.showFrame('jump', true);
    this.root.classList.add('is-happy');
    this.later(() => this.root.classList.remove('is-happy'), 900);
    this.stateTimer = this.later(() => this.finishAction(), 1200);
  }

  private doStretch() {
    this.state = 'IDLE';
    this.root.dataset.state = 'IDLE';
    if (this.playVideo('stretch')) return;
    this.showFrames(true);
    this.showFrame('stretch', true);
    this.stateTimer = this.later(() => { this.showFrame('sit', true); this.scheduleIdle(); }, 2200);
  }

  private doSleep() {
    this.state = 'SLEEP';
    this.root.dataset.state = 'SLEEP';
    this.sleeping = true;
    this.showZzz(true);
    if (!this.playVideo('sleep')) {
      this.showFrame('sleep', true);
    }
  }

  private doWake() {
    this.state = 'WAKING';
    this.root.dataset.state = 'WAKING';
    this.sleeping = false;
    this.showZzz(false);
    if (!this.playVideo('wake')) {
      this.showFrame('sit', true);
      this.stateTimer = this.later(() => this.finishAction(), 1200);
    }
  }

  private showZzz(on: boolean) {
    const el = this.root.querySelector('.pet-zzz') as HTMLElement | null;
    if (el) el.dataset.on = on ? '1' : '0';
  }

  private safeMovementRange(): [number, number] {
    const scene = this.root.getBoundingClientRect();
    if (!scene.width) return this.movementRange;
    const dock = this.root.parentElement?.querySelector('.care-dock')?.getBoundingClientRect();
    const rail = dock ? Math.max(0, dock.right - scene.left) + 12 : 12;
    const min = Math.max(this.movementRange[0], (rail + this.petHalfWidth) / scene.width * 100);
    const max = Math.min(this.movementRange[1], (scene.width - this.petHalfWidth - 12) / scene.width * 100);
    return min <= max ? [min, max] : [50, 50];
  }

  private keepPetVisible() {
    const next = clamp(this.position, ...this.safeMovementRange());
    if (Math.abs(next - this.position) > .1) {
      this.position = next; this.walkTarget = next;
      this.mover.style.left = `${next}%`;
    }
  }

  /* ---------------- 走动 ---------------- */
  wanderTo(targetPercent: number) {
    if (!this.manifest || this.destroyed || this.state === 'CLEANING' || this.state === 'EATING' || this.state === 'PETTED' || this.state === 'HUG' || this.state === 'PLAY') return;
    this.interrupt();
    const target = clamp(targetPercent, ...this.safeMovementRange());
    const start = this.position;
    const distance = Math.abs(target - start);
    if (distance < 3) { this.finishAction(); return; }
    this.walkTarget = target;
    this.state = 'WANDER';
    this.root.dataset.state = 'WANDER';
    this.setFlip(target > start ? 1 : -1);
    const info = this.manifest.breeds[this.pet.breed];
    if (!info?.walkTransitions || !this.playVideo('walk-start')) this.startWalking();
  }

  private walkTarget = 50;
  private startWalking() {
    const target = this.walkTarget;
    const distance = Math.abs(target - this.position);
    const playing = this.playVideo('walk', { loop: true });
    const gait = playing ? this.videoFor('walk')?.gait : undefined;
    let duration = clamp(distance / 9, 2.4, 9) * 1000;
    if (gait && gait.stridePixels > 0 && gait.supportSeconds > 0 && gait.canvasPixels > 0) {
      const pixelsPerSecond = gait.stridePixels / gait.supportSeconds
        * this.videoWrap.getBoundingClientRect().width / gait.canvasPixels * this.video.playbackRate;
      if (pixelsPerSecond > 0) duration = distance / 100 * this.root.clientWidth / pixelsPerSecond * 1000;
    }
    this.mover.getBoundingClientRect();
    this.mover.style.transition = `left ${duration}ms linear`;
    this.position = target;
    this.mover.style.left = `${target}%`;
    if (!playing) {
      this.showFrames(true); this.showFrame('walk', true);
    }
    this.walkTimer = this.later(() => {
      this.freezeMovement(); this.playWalkStop();
    }, duration);
  }

  wanderRandom() {
    if (!this.manifest) return;
    const [min, max] = this.safeMovementRange();
    const direction = this.position <= min + 3 ? 1 : this.position >= max - 3 ? -1 : Math.random() < 0.5 ? -1 : 1;
    const target = clamp(this.position + direction * (18 + Math.random() * 28), min, max);
    this.wanderTo(target);
  }

  /* ---------------- 自主行为 ---------------- */
  private scheduleIdle(min = 32000, max = 56000) {
    clearTimeout(this.idleTimer as any);
    if (this.destroyed) return;
    const wait = min + Math.random() * (max - min);
    this.idleTimer = this.later(() => {
      if (this.state !== 'IDLE') return;
      const r = Math.random();
      if (r < 0.38) this.wanderRandom();
      else if (r < 0.6) this.doHappy();
      else if (r < 0.9) this.doStretch();
      else if (r < 0.96) this.doGreet();
      else this.doSleep();
      this.scheduleIdle();
    }, wait) as unknown as number;
  }

  /* ---------------- 声音 / 气泡 ---------------- */
  private playSfx(kind: 'hello' | 'happy' | 'sleep') {
    if (this.muted || !this.manifest) return;
    const map = SOUND_MAP[this.pet.sound] || SOUND_MAP.cat;
    const pool = map[kind];
    const name = pool[Math.floor(Math.random() * pool.length)];
    const file = this.manifest.sounds[name];
    if (!file) return;
    try {
      const a = new Audio(`${PET_BASE}${file}`);
      a.volume = 0.38;
      this.activeSounds.add(a);
      a.onended = a.onerror = () => { this.activeSounds.delete(a); };
      a.play().catch(() => { this.activeSounds.delete(a); });
    } catch {}
  }

  say(text: string, ms = 3200, priority: 'reminder' | 'interaction' = 'interaction') {
    if (priority === 'reminder' && Date.now() < this.interactionUntil) return;
    if (priority === 'interaction') this.interactionUntil = Date.now() + ms;
    const el = this.root.querySelector('.pet-bubble') as HTMLElement;
    if (!el) return;
    el.textContent = text;
    el.dataset.empty = '0';
    el.dataset.on = '1';
    // 气泡随宠物移动，文字不镜像，并限制在场景内。
    clearInterval(this.bubbleFollow);
    const follow = () => {
      if (this.destroyed) return;
      const scene = this.root.getBoundingClientRect();
      const pet = this.mover.getBoundingClientRect();
      const half = el.offsetWidth / 2;
      const center = pet.left + pet.width / 2;
      const dock = this.root.parentElement?.querySelector('.care-dock')?.getBoundingClientRect();
      const bubble = el.getBoundingClientRect();
      const dockOverlaps = dock && bubble.bottom > dock.top && bubble.top < dock.bottom;
      const minLeft = dockOverlaps ? dock.right + 10 : scene.left + 12;
      const shift = clamp(center, Math.min(minLeft + half, scene.right - half - 12), scene.right - half - 12) - center;
      el.style.marginLeft = `${shift}px`;
      el.style.setProperty('--bubble-tail', `${clamp(half - shift, 16, el.offsetWidth - 16)}px`);
    };
    follow(); this.bubbleFollow = window.setInterval(follow, 120);
    clearTimeout(this.sayTimer as any);
    this.sayTimer = this.later(() => {
      el.dataset.on = '0';
      clearInterval(this.bubbleFollow);
      this.later(() => { if (el.dataset.on === '0') el.dataset.empty = '1'; }, 260);
    }, ms) as unknown as number;
  }

  onStageUp() {
    this.root.classList.add('is-levelup');
    this.later(() => this.root.classList.remove('is-levelup'), 1800);
    if (!this.sleeping && this.state !== 'SLEEP') this.play('greet');
  }

  focusForGrowth() {
    this.interrupt();
    this.position = 50;
    this.mover.style.left = '50%';
    this.state = 'IDLE'; this.root.dataset.state = 'IDLE';
    if (this.manifest) { this.showFrame('sit', false); this.showFrames(true); }
  }

  destroy() {
    this.destroyed = true;
    for (const sound of this.activeSounds) sound.pause();
    this.activeSounds.clear();
    clearTimeout(this.idleTimer as any);
    clearTimeout(this.stateTimer as any);
    clearTimeout(this.walkTimer as any);
    clearTimeout(this.bubbleTimer as any);
    clearInterval(this.bubbleFollow);
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    this.root.removeEventListener('pointerdown', this.pointerHandler);
    this.root.removeEventListener('keydown', this.keyboardHandler);
    this.video.removeAttribute('src');
    this.video.load();
    window.removeEventListener('resize', this.onResize);
    document.removeEventListener('visibilitychange', this.visibilityHandler);
    this.stopVideo();
    this.root.innerHTML = '';
  }
}

export { STAGE_SCALE, STAGE_RATE };
export const SOUND_SPECIES = SOUND_MAP;
