/** Growth boundaries and asset completeness, using an isolated disposable database. */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = mkdtempSync(join(tmpdir(), 'banxue-growth-'));
process.env.BANXUE_DATA_DIR = dir;
const { q, db } = await import('../server/db.mjs');
const D = await import('../server/daily.mjs');
const P = await import('../server/pet-progression.mjs');
await import('../server/v2.mjs'); // Apply the same v2 schema initialization as the running app.
let checks = 0;
try {
  assert.equal(P.LEVEL_DAYS.length, 12);
  const manifest = JSON.parse(readFileSync(join(root, 'web/public/pets/manifest.json')));
  for (const breed of ['dog_corgi_toon', 'capybara_toon']) {
    const child = `growth-${breed}`;
    q.run('INSERT INTO child(id,name,created_at) VALUES(?,?,?)', child, '成长检查', new Date().toISOString());
    D.adopt(child, { breed, name: '同一个伙伴' });
    const identity = D.getToday(child).pet;
    for (let stage = 1; stage <= 6; stage++) {
      // Long offline time can make every phase ready but cannot change the confirmed age.
      q.run('UPDATE pet_life SET natural_anchor_at=? WHERE child_id=?', new Date(Date.now()-200*86400000).toISOString(), child);
      while(D.getToday(child).pet.progression.level < stage * 2 - 1) {
        const current = D.getToday(child).pet;
        P.confirmLevel(child, { expectedPetId: current.id, expectedLevel: current.progression.level, requestId: crypto.randomUUID() });
      }
      const pet = D.getToday(child).pet;
      assert.equal(pet.stage, stage, `${breed} stage ${stage}`);
      assert.equal(pet.id, identity.id);
      assert.equal(pet.growth, identity.growth);
      assert.equal(pet.stageInfo.nextDays, P.LEVEL_DAYS[pet.progression.level]);
      assert.ok(pet.stageInfo.progress >= 0 && pet.stageInfo.progress <= 1);
      assert.equal(pet.stageInfo.nextInDays, 0);
      const base = manifest.breeds[breed];
      const look = base.growth?.[stage] || base;
      if (stage > 1) assert.ok(base.growth[stage], 'Every dressed age has a complete own pack');
      const needed = ['greet','walk','eat','eatrev','petted','petted-out','play','hug','sleep','wake'];
      if (breed === 'capybara_toon' || stage > 1) needed.push('stretch');
      for (const action of needed) {
        assert.equal(look.videos[action].mode, 'alpha');
        assert.ok(existsSync(join(root,'web/public/pets',look.videos[action].file)));
      }
      for (const pose of ['sit','walk','sleep','stretch','roll','jump']) {
        const file = look.frames.find(f => f.key === pose);
        assert.ok(file && existsSync(join(root,'web/public/pets',file.file)));
      }
      assert.ok(existsSync(join(root,'web/public/pets',look.avatar)));
      checks++;
    }
    const last = D.getToday(child).pet;
    P.confirmLevel(child, { expectedPetId: last.id, expectedLevel: 11, requestId: crypto.randomUUID() });
    assert.equal(D.getToday(child).pet.stageInfo.nextDays, null, 'No phantom next stage after final manual advancement');
  }
  console.log(`${checks} age/appearance checks passed; all action assets and static fallbacks exist; manual phases and terminal stage verified.`);
} finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
