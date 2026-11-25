import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const desktop = fileURLToPath(new URL('..', import.meta.url));

test('desktop text truncation does not insert layout ellipses', () => {
  const offenders: string[] = [];
  // Deliberately check layout declarations, not punctuation in status copy, search excerpts or user content.
  const ellipsis = /text-overflow\s*:\s*ellipsis|textOverflow\s*:\s*['"]ellipsis['"]|(?:-webkit-)?line-clamp\s*:|(?:WebkitLineClamp|lineClamp)\s*:/i;
  for (const root of ['src/renderer', 'test-center']) {
    const dir = join(desktop, root);
    for (const path of readdirSync(dir, { recursive: true, encoding: 'utf8' })) {
      if (!/\.(?:css|[jt]sx?)$/.test(path)) continue;
      const file = join(dir, path);
      if (ellipsis.test(readFileSync(file, 'utf8'))) offenders.push(relative(desktop, file));
    }
  }
  assert.deepEqual(offenders, [], 'Use an overflow-only text mask instead.');
});
