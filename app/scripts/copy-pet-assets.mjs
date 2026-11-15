/**
 * 从逆向研究归档中，抽取 MVP 需要的宠物素材到 web/public/pets。
 * 复制 16 个品种，应用可复现的本地质量修补，
 * 生成 manifest.json，前端据此决定 alpha / 绿幕 / 蓝幕渲染方式。
 */
import { mkdirSync, copyFileSync, renameSync, readdirSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, '..', 'MengChong_Research_20261111', 'research', 'recovered', 'assets');
const OUT = join(ROOT, 'web', 'public', 'pets');
const boundsPath = join(ROOT, 'scripts', 'asset-bounds.json');
const bounds = existsSync(boundsPath) ? JSON.parse(readFileSync(boundsPath, 'utf8')) : {};

const BREEDS = {
  cat_orange: { name: '橘猫', species: 'cat', dir: 'cat_frames/transparent' },
  cat_ragdoll: { name: '布偶猫', species: 'cat', dir: 'cat_frames/ragdoll/transparent' },
  cat_black: { name: '黑猫', species: 'cat', dir: 'cat_frames/black/transparent' },
  cat_blue: { name: '蓝猫', species: 'cat', dir: 'cat_frames/blue/transparent' },
  dog_dairy: { name: '橘白奶狗', species: 'dog', dir: 'dog_frames/transparent' },
  dog_golden: { name: '金毛', species: 'dog', dir: 'dog_frames/golden/transparent' },
  dog_corgi: { name: '柯基', species: 'dog', dir: 'dog_frames/corgi/transparent' },
  dog_german: { name: '德国牧羊犬', species: 'dog', dir: 'dog_frames/german/transparent' },
  bird_parakeet: { name: '虎皮鹦鹉', species: 'bird', dir: 'bird_frames/bird_parakeet/transparent' },
  bird_cockatiel: { name: '玄凤鹦鹉', species: 'bird', dir: 'bird_frames/bird_cockatiel/transparent' },
  bird_peachface: { name: '牡丹鹦鹉', species: 'bird', dir: 'bird_frames/bird_peachface/transparent' },
  bird_pigeon: { name: '信鸽', species: 'bird', dir: 'bird_frames/bird_pigeon/transparent' },
  turtle_redear: { name: '巴西红耳龟', species: 'turtle', dir: 'turtle_frames/turtle_redear/transparent' },
  turtle_grass: { name: '中华草龟', species: 'turtle', dir: 'turtle_frames/turtle_grass/transparent' },
  turtle_flower: { name: '中华花龟', species: 'turtle', dir: 'turtle_frames/turtle_flower/transparent' },
  turtle_map: { name: '地图龟', species: 'turtle', dir: 'turtle_frames/turtle_map/transparent' },
};

// 原程序按品种/动作登记抠像方式：alpha 优先，其次蓝幕，其余绿幕
const BLUE_ALL = new Set(['bird_parakeet', 'bird_peachface']);
const GREEN_WALK = new Set(['turtle_redear', 'turtle_grass', 'turtle_flower']);
const FRAMES = ['sit', 'walk', 'jump', 'sleep', 'stretch', 'roll'];

function walk(dir, base = dir) {
  const out = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walk(full, base));
    else out.push(full.slice(base.length + 1));
  }
  return out;
}

function copy(src, dst) {
  mkdirSync(dirname(dst), { recursive: true });
  copyFileSync(src, `${dst}.tmp`);
  renameSync(`${dst}.tmp`, dst);
  return statSync(dst).size;
}

function actionMode(breed, action) {
  if (GREEN_WALK.has(breed)) return /^walk/.test(action) ? 'green' : 'blue';
  return BLUE_ALL.has(breed) ? 'blue' : 'green';
}

mkdirSync(OUT, { recursive: true });
mkdirSync(join(OUT, 'breeds'), { recursive: true });
mkdirSync(join(OUT, 'videos'), { recursive: true });
mkdirSync(join(OUT, 'eggs'), { recursive: true });
mkdirSync(join(OUT, 'avatars'), { recursive: true });
mkdirSync(join(OUT, 'sounds'), { recursive: true });

const manifest = { version: 2, breeds: {}, eggs: {}, sounds: {}, banner: 'banner_task.jpg' };
const WALK_TRANSITIONS = new Set(['cat_ragdoll', 'dog_corgi', 'dog_dairy', 'dog_golden', 'bird_cockatiel', 'bird_parakeet', 'bird_peachface', 'bird_pigeon', 'turtle_flower', 'turtle_map']);

for (const [breed, info] of Object.entries(BREEDS)) {
  const frames = [];
  for (const f of FRAMES) {
    const src = join(SRC, info.dir, `frame-${f}.png`);
    if (!existsSync(src)) continue;
    const rel = `breeds/${breed}/frames/frame-${f}.png`;
    copy(src, join(OUT, rel));
    frames.push({ key: f, file: rel, bottom: bounds[breed]?.frames[f]?.bottom ?? 1 });
  }

  const videoDir = join(SRC, 'videos', breed);
  const files = readdirSync(videoDir).filter((f) => f.endsWith('.webm'));
  const videos = {};
  for (const file of files) {
    const action = basename(file, '.webm');
    const rel = `videos/${breed}/${file}`;
    copy(join(videoDir, file), join(OUT, rel));
    const isAlpha = action.endsWith('.alpha');
    const clean = isAlpha ? action.slice(0, -'.alpha'.length) : action;
    const current = videos[clean];
    // alpha 版优先
    if (!current || isAlpha) {
      videos[clean] = { file: rel, mode: isAlpha ? 'alpha' : actionMode(breed, clean), bottom: bounds[breed]?.videos[clean]?.bottom ?? 1 };
    }
  }

  const avatarSrc = join(SRC, 'skin', 'avatars', `${breed}.png`);
  const avatarRel = `avatars/${breed}.png`;
  if (existsSync(avatarSrc)) copy(avatarSrc, join(OUT, avatarRel));

  manifest.breeds[breed] = {
    name: info.name,
    species: info.species,
    avatar: avatarRel,
    frames,
    videos,
    walkTransitions: WALK_TRANSITIONS.has(breed),
  };
}

for (const species of ['cat', 'dog', 'bird', 'turtle']) {
  const egg = species === 'cat' ? 'frame-egg.png' : `frame-egg-${species}.png`;
  const hatch = species === 'cat' ? 'frame-hatch.png' : `frame-hatch-${species}.png`;
  for (const [kind, file] of [['egg', egg], ['hatch', hatch]]) {
    const src = join(SRC, 'egg_frames', 'transparent', file);
    if (!existsSync(src)) continue;
    const rel = `eggs/${species}-${kind}.png`;
    copy(src, join(OUT, rel));
    manifest.eggs[species] = { ...(manifest.eggs[species] || {}), [kind]: rel };
  }
}

const SOUNDS = [
  'cat-meow', 'cat-purr', 'cat-hungry', 'cat-attention',
  'dog-woof', 'dog-happy', 'dog-puppy', 'dog-yap',
  'bird-chirp', 'bird-song', 'bird-call',
  'turtle-grunt', 'turtle-water', 'startup-theme',
];
for (const s of SOUNDS) {
  const src = join(SRC, 'sounds', `${s}.mp3`);
  if (!existsSync(src)) continue;
  copy(src, join(OUT, 'sounds', `${s}.mp3`));
  manifest.sounds[s] = `sounds/${s}.mp3`;
}

copy(join(SRC, 'skin', 'banner_task.jpg'), join(OUT, 'banner_task.jpg'));

// 人工修补覆盖：原始素材的离线抠像在个别位置误删了深色区域
// （例如柯基 play 片里的黑白小球：黑色条纹被抠成透明，小球看起来"被挖空"）。
// 修补文件按相同相对路径放在 scripts/patches/ 下，复制后覆盖。
const PATCH = join(ROOT, 'scripts', 'patches');
if (existsSync(PATCH)) {
  for (const rel of walk(PATCH)) {
    if (!/\.(png|webm|jpe?g|mp3)$/i.test(rel)) continue;
    const target = join(OUT, rel.replace(/^\/+/, ''));
    copy(join(PATCH, rel), target);
    const video = /^videos\/([^/]+)\/([^.]+)\.alpha\.webm$/.exec(rel);
    if (video && manifest.breeds[video[1]]?.videos[video[2]]) {
      manifest.breeds[video[1]].videos[video[2]] = {
        ...manifest.breeds[video[1]].videos[video[2]], file: rel, mode: 'alpha',
      };
    }
    console.log('patched:', rel);
  }
}

// 项目自有宠物包与研究归档分开维护，复制时按包内清单发布。
const OWN = join(ROOT, 'assets', 'pets');
if (existsSync(OWN)) {
  for (const ent of readdirSync(OWN, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    const pack = join(OWN, ent.name), specFile = join(pack, 'pet.json');
    if (!existsSync(specFile)) continue;
    const spec = JSON.parse(readFileSync(specFile, 'utf8'));
    const breed = spec.id;
    const publishLook = (look, stage) => {
      const prefix = stage ? `breeds/${breed}/growth/${stage}` : `breeds/${breed}`;
      const frames = look.frames.map((f) => {
        const file = `${prefix}/frames/frame-${f.key}.png`;
        copy(join(pack, f.file), join(OUT, file));
        return { key: f.key, file, bottom: f.bottom ?? 1 };
      });
      const videos = {};
      for (const [action, video] of Object.entries(look.videos)) {
        const file = stage ? `${prefix}/videos/${basename(video.file)}` : `videos/${breed}/${basename(video.file)}`;
        copy(join(pack, video.file), join(OUT, file));
        videos[action] = { ...video, file };
      }
      const avatar = stage ? `${prefix}/avatar.png` : `avatars/${breed}.png`;
      copy(join(pack, look.avatar), join(OUT, avatar));
      return { avatar, frames, videos };
    };
    const { frames, videos, avatar } = publishLook(spec);
    const growth = {};
    for (const [stage, look] of Object.entries(spec.growth || {})) {
      const required = ['greet', 'walk', 'eat', 'eatrev', 'petted', 'petted-out', 'play', 'hug', 'sleep', 'wake', 'stretch'];
      if (required.some(action => !look.videos[action])) throw Error(`${breed} stage ${stage}: incomplete actions`);
      growth[stage] = publishLook(look, stage);
    }
    manifest.breeds[breed] = { name: spec.name, species: spec.species, avatar, frames, videos,
      walkTransitions: !!spec.walkTransitions, sourceVersion: spec.version, ...(Object.keys(growth).length ? { growth } : {}) };
    console.log('own pet:', breed, spec.version);
  }
}

writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`pets -> ${OUT}`);
console.log(`breeds: ${Object.keys(manifest.breeds).join(', ')}`);

// Keep iPad-compatible motion variants in sync with all published pet packages.
await (await import('./build-compatible-pet-videos.mjs')).buildCompatiblePetVideos();
