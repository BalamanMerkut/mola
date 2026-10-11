import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/*
 * 10 Ekim son kullanıcı testi: the owner's licence agreement window opened twice on about a third of the sign-ins (both in
 * the same workspace; accepting the one on top left the other). OwnerAgreementPrompt and ImportantAnnouncement are siblings
 * in src/Workspace.tsx and both had key={data.username}: React's "two children with the same key" duplicates children.
 * Every keyed element among the workspace's direct children must have its own key.
 */
test('the workspace\'s keyed siblings have unique keys', () => {
  const source = readFileSync('src/Workspace.tsx', 'utf8');
  const keys = [...source.matchAll(/\{owner && <(\w+) key=\{([^}]+)\}/g)].map(m => ({ component: m[1], key: m[2].trim() }));
  const agreement = keys.find(k => k.component === 'OwnerAgreementPrompt'), announcement = keys.find(k => k.component === 'ImportantAnnouncement');
  assert.ok(agreement && announcement, 'both owner windows are keyed by the signed-in user');
  const seen = new Map<string, string>();
  for (const k of keys) { assert.ok(!seen.has(k.key), `${k.component} and ${seen.get(k.key)} share key={${k.key}}`); seen.set(k.key, k.component); }
});
