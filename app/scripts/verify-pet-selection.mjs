/** Changing a companion preserves learning/economy state; never uses the family database. */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const dir = mkdtempSync(join(tmpdir(), 'banxue-breeds-'));
process.env.BANXUE_DATA_DIR = dir;
const { q, db } = await import('../server/db.mjs');
const D = await import('../server/daily.mjs');
const V = await import('../server/v2.mjs');
try {
  q.run('INSERT INTO child(id,name,grade,created_at) VALUES(?,?,?,?)', 'breed-test', '伙伴测试', 2, new Date().toISOString());
  V.adoptWithStarter('breed-test', { breed: 'dog_corgi', name: '同一个名字' });
  V.giftPoints('breed-test', { amount: 80, reason: '测试余额' });
  D.buy('breed-test', { key: 'kibble', qty: 1 });
  q.run('UPDATE pet_life SET growth=37, care_count=9, outfit=? WHERE child_id=?', '{"bow":"1"}', 'breed-test');
  const original = V.getStudentState('breed-test');
  assert.ok(original.tasks.length > 0, 'fixture includes learning plans');
  assert.ok(original.inventory.length > 0, 'fixture includes owned materials');
  const manifest = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../web/public/pets/manifest.json')));
  const breeds = Object.keys(manifest.breeds);
  assert.equal(breeds.length, 19);
  for (const breed of breeds) {
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
  assert.throws(() => D.changeBreed('breed-test', 'unknown'));
  assert.throws(() => D.changeBreed('breed-test', '__proto__'));
  assert.throws(() => D.changeBreed('breed-test', null));
  console.log('19 breeds supported first adoption and switching; pet identity, growth, wallet, tasks, inventory and outfit preserved; invalid breeds rejected.');
} finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
