import { parseGIF, decompressFrames } from 'gifuct-js';
type Frame = { image: HTMLCanvasElement; duration: number };
const cache = new Map<string, Promise<Frame[]>>();
const users = new Map<string, number>();
const MAX_CACHED_VISUALS = 24;
function pruneCache() {
  for (const key of cache.keys()) {
    if (cache.size <= MAX_CACHED_VISUALS) break;
    if (!users.get(key)) cache.delete(key);
  }
}
function canvas(width: number, height: number) { const c = document.createElement('canvas'); c.width = width; c.height = height; return c; }
function keyed(source: CanvasImageSource, sx: number, sy: number, sw: number, sh: number) {
  const ratio = Math.min(1, 384 / Math.max(sw, sh));
  const out = canvas(Math.round(sw * ratio), Math.round(sh * ratio));
  const ctx = out.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, out.width, out.height);
  const image = ctx.getImageData(0, 0, out.width, out.height), pixels = image.data;
  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
    // Remove only saturated chroma matte; retain the muted sage plants/furniture.
    if (g > 160 && g - r > 105 && g - b > 95) pixels[i + 3] = 0;
    else if (g > 170 && g - r > 70 && g - b > 70) { pixels[i + 3] = Math.round(pixels[i + 3] * .55); pixels[i + 1] = Math.min(g, Math.max(r,b) + 25); }
  }
  ctx.putImageData(image, 0, 0); return out;
}
async function loadFrames(src: string, sprite?: number): Promise<Frame[]> {
  const key = `${src}:${sprite ?? ''}`;
  if (!cache.has(key)) cache.set(key, (async () => {
    if (!src.endsWith('.gif')) {
      const img = new Image(); img.src = src; await img.decode();
      const cells = sprite == null ? 1 : 4, w = img.naturalWidth / cells, h = img.naturalHeight / cells;
      return [{ image: keyed(img, sprite == null ? 0 : sprite % 4 * w, sprite == null ? 0 : Math.floor(sprite / 4) * h, w, h), duration: 100 }];
    }
    const response = await fetch(src); if (!response.ok) throw Error('动效暂未载入');
    const gif = parseGIF(await response.arrayBuffer());
    const frames = decompressFrames(gif, true);
    const full = canvas(gif.lsd.width, gif.lsd.height), ctx = full.getContext('2d')!;
    const result: Frame[] = [];
    let previous: typeof frames[number] | undefined;
    let restored: ImageData | undefined;
    for (const frame of frames) {
      if (previous?.disposalType === 2) ctx.clearRect(previous.dims.left, previous.dims.top, previous.dims.width, previous.dims.height);
      if (previous?.disposalType === 3 && restored) ctx.putImageData(restored, 0, 0);
      if (frame.disposalType === 3) restored = ctx.getImageData(0, 0, full.width, full.height);
      const patch = canvas(frame.dims.width, frame.dims.height);
      patch.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(frame.patch), frame.dims.width, frame.dims.height), 0, 0);
      ctx.drawImage(patch, frame.dims.left, frame.dims.top);
      result.push({ image: keyed(full, 0, 0, full.width, full.height), duration: Math.max(40, frame.delay || 100) }); previous = frame;
    }
    if (!result.length) throw Error('动效没有可播放帧');
    return result;
  })().catch(error => { cache.delete(key); throw error; }));
  return cache.get(key)!;
}
/** Shared keyed PNG/GIF overlay. Decode once, reuse all species and room sprites. */
export function mountVisual(target: HTMLCanvasElement, src: string, sprite?: number) {
  const key = `${src}:${sprite ?? ''}`;
  users.set(key, (users.get(key) || 0) + 1);
  let stopped = false, timer = 0;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  let resume = () => {};
  const visibility = () => { clearTimeout(timer); timer = 0; if (!document.hidden) resume(); };
  document.addEventListener('visibilitychange', visibility);
  reduced.addEventListener('change', visibility);
  loadFrames(src, sprite).then(frames => {
    if (stopped) return;
    let index = 0;
    target.width = frames[0].image.width; target.height = frames[0].image.height;
    const ctx = target.getContext('2d')!;
    const draw = () => {
      if (stopped) return;
      if (!document.hidden) {
        const frame = frames[reduced.matches ? 0 : index];
        ctx.clearRect(0, 0, target.width, target.height); ctx.drawImage(frame.image, 0, 0);
        if (!reduced.matches) index = (index + 1) % frames.length;
      }
      if (frames.length > 1 && !document.hidden && !reduced.matches) timer = window.setTimeout(draw, frames[(index + frames.length - 1) % frames.length].duration);
    };
    resume = draw;
    target.dataset.loaded = 'true'; draw();
  }).catch(() => { if (!stopped) { target.dataset.failed = 'true'; target.dispatchEvent(new Event('visualerror')); } });
  pruneCache();
  return () => {
    if (stopped) return;
    stopped = true; clearTimeout(timer);
    document.removeEventListener('visibilitychange', visibility);
    reduced.removeEventListener('change', visibility);
    const remaining = (users.get(key) || 1) - 1;
    if (remaining) users.set(key, remaining); else users.delete(key);
    pruneCache();
  };
}
