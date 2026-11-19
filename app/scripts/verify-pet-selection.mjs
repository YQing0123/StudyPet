/** Published companions and legacy identities, using only a disposable database. */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const dir = mkdtempSync(join(tmpdir(), 'banxue-breeds-'));
process.env.BANXUE_DATA_DIR = dir;
const { q, db } = await import('../server/db.mjs');
const D = await import('../server/daily.mjs');
const V = await import('../server/v2.mjs');
const { AVAILABLE_PET_BREEDS } = await import('../web/src/shared/availablePetBreeds.mjs');
try {
  q.run('INSERT INTO child(id,name,grade,created_at) VALUES(?,?,?,?)', 'breed-test', '伙伴测试', 2, new Date().toISOString());
  V.adoptWithStarter('breed-test', { breed: 'capybara_toon', name: '同一个名字' });
  V.giftPoints('breed-test', { amount: 80, reason: '测试余额' });
  D.buy('breed-test', { key: 'kibble', qty: 1 });
  q.run('UPDATE pet_life SET growth=37, care_count=9, outfit=? WHERE child_id=?', '{"bow":"1"}', 'breed-test');
  const original = V.getStudentState('breed-test');
  assert.ok(original.tasks.length > 0, 'fixture includes learning plans');
  assert.ok(original.inventory.length > 0, 'fixture includes owned materials');
  const publicDir = join(dirname(fileURLToPath(import.meta.url)), '../web/public');
  const manifest = JSON.parse(readFileSync(join(publicDir, 'pets/manifest.json')));
  assert.deepEqual(Object.keys(manifest.breeds).sort(), [...AVAILABLE_PET_BREEDS].sort());
  assert.deepEqual([...AVAILABLE_PET_BREEDS].sort(), ['alpaca_toon', 'capybara_toon']);
  assert.deepEqual(D.breedList().map(b => b.id).sort(), [...AVAILABLE_PET_BREEDS].sort());
  const media = new Set();
  const collectMedia = value => {
    if (typeof value === 'string' && /\.(svg|png|webm|mp4)$/.test(value)) media.add(value);
    else if (value && typeof value === 'object') Object.values(value).forEach(collectMedia);
  };
  collectMedia(manifest.breeds);
  for (const file of media) assert.ok(existsSync(join(publicDir, 'pets', file)), file);
  for (const folder of ['breeds', 'avatars', 'videos', 'compatible']) {
    const relativePaths = readdirSync(join(publicDir, 'pets', folder), { recursive: true, withFileTypes: true });
    for (const file of relativePaths.filter(entry => entry.isFile())) {
      const path = join(file.parentPath, file.name).slice(join(publicDir, 'pets').length + 1);
      assert.ok(media.has(path), `Unexpected pet media in public build: ${path}`);
    }
  }
  assert.deepEqual(readdirSync(join(publicDir, 'travel/pets')).sort(), ['alpaca_toon.gif', 'alpaca_toon.webp']);
  assert.deepEqual(manifest.sounds, {});
  const storedBreeds = D.breedList({includeUnavailable:true});
  assert.equal(storedBreeds.length, 19);
  for (const breed of AVAILABLE_PET_BREEDS) {
    D.changeBreed('breed-test', breed);
    const state = V.getStudentState('breed-test');
    assert.equal(state.pet.breed, breed);
    assert.equal(state.pet.species, manifest.breeds[breed].species);
    for (const key of ['id', 'name', 'growth', 'careCount', 'adoptedAt']) assert.equal(state.pet[key], original.pet[key], key);
    assert.deepEqual(state.pet.outfit, original.pet.outfit);
    assert.deepEqual(state.wallet, original.wallet);
    assert.deepEqual(state.tasks, original.tasks);
    assert.deepEqual(state.inventory, original.inventory);
    const child = `adopt-${breed}`;
    q.run('INSERT INTO child(id,name,grade,created_at) VALUES(?,?,?,?)', child, '首次领养测试', 2, new Date().toISOString());
    const adopted = V.adoptWithStarter(child, { breed, name: '新伙伴' });
    assert.equal(adopted.pet.breed, breed);
    assert.equal(adopted.pet.species, manifest.breeds[breed].species);
  }
  const unpublished = storedBreeds.filter(b => !AVAILABLE_PET_BREEDS.includes(b.id));
  assert.equal(unpublished.length, 17);
  for (const { id: breed, species } of unpublished) {
    const before = D.getPetRow('breed-test');
    assert.throws(() => D.changeBreed('breed-test', breed), /完善动作/);
    assert.equal(D.getPetRow('breed-test').breed, before.breed);
    const child = `unpublished-${breed}`;
    q.run('INSERT INTO child(id,name,created_at) VALUES(?,?,?)', child, '下架测试', new Date().toISOString());
    assert.throws(() => D.adopt(child,{breed}), /完善动作/);
    assert.equal(D.getPetRow(child), null);
    // Model an existing companion from before unpublishing; reads must preserve it.
    q.run('UPDATE pet_life SET breed=?,species=? WHERE child_id=?',breed,species,'breed-test');
    assert.equal(V.getStudentState('breed-test').pet.breed, breed);
  }
  for (const breed of ['unknown','__proto__',null]) {
    assert.throws(() => D.changeBreed('breed-test', breed));
    assert.throws(() => D.adopt('invalid-adopt', {breed}));
  }
  console.log('2 published breeds; 17 unpublished choices blocked, with legacy records preserved.');
} finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
