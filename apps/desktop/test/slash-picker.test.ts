import assert from 'node:assert/strict';
import { it } from 'node:test';
import type { ContextUsage, SkillSummary, TaskRecipe } from '@vela/shared';
import { slashMenuItems } from '../src/renderer/components/composer/slash-picker.ts';
import { slashCommands, statusItems } from '../src/renderer/components/composer/slash-commands.ts';
const skill = (enabled = true): SkillSummary => ({ name: 'review', description: 'Read a project', enabled, origin: 'project', location: '/skills/review', disableModelInvocation: false, canDelete: false });
const recipe = (id: string, name: string, description = '', tags: string[] = []): TaskRecipe => ({ id, name, description, tags, origin: 'user', revision: 1, createdAt: 1, updatedAt: 1, parameters: [], defaultMode: 'agent', objectiveTemplate: 'Review', workflowTemplate: 'Read', deliverableTemplate: 'Report' });
it('keeps skill and recipe identities separate and includes same-named recipes from distinct libraries', () => {
  const entries = slashMenuItems([skill(), { ...skill(false), location: '/disabled' }], [recipe('a', 'review'), { ...recipe('b', 'review'), origin: 'team', teamWorkspace: '/project' }], 'review');
  assert.deepEqual(entries.map(e => e.type === 'skill' ? e.skill.location : e.recipe.id), ['/skills/review', 'a', 'b']);
});
it('searches recipe names, descriptions and tags without case sensitivity and ranks name prefixes first', () => {
  const recipes = [recipe('tag', 'Bug fix', '', ['Release']), recipe('desc', 'Changelog', 'Review RELEASE notes'), recipe('name', 'Release checklist')];
  assert.deepEqual(slashMenuItems([], recipes, 'ReLeAsE').map(e => e.type === 'recipe' && e.recipe.id), ['name', 'tag', 'desc']);
  assert.equal(slashMenuItems([], recipes, 'missing').length, 0);
  assert.equal(slashMenuItems([], recipes, '').length, 3);
});
it('lists built-in commands before skills and recipes, and only the ones that are available', () => {
  const available = slashCommands({ canChangeModel: true, canCompact: false });
  assert.deepEqual(available.map(c => c.id), ['model', 'status']);
  assert.deepEqual(slashCommands({ canChangeModel: false, canCompact: true }).map(c => c.id), ['compact', 'status']);
  const all = slashCommands({ canChangeModel: true, canCompact: true });
  const entries = slashMenuItems([skill()], [recipe('a', 'Release')], '', all);
  assert.deepEqual(entries.map(e => e.type), ['command', 'command', 'command', 'skill', 'recipe']);
});
it('filters commands by name prefix first, then name, then description', () => {
  const all = slashCommands({ canChangeModel: true, canCompact: true });
  assert.deepEqual(slashMenuItems([], [], 'co', all).map(e => e.type === 'command' && e.command.id), ['compact']);
  assert.deepEqual(slashMenuItems([], [], 'MODEL', all).map(e => e.type === 'command' && e.command.id), ['model']);
  assert.deepEqual(slashMenuItems([], [], 'sta', all).map(e => e.type === 'command' && e.command.id), ['status']);
  assert.equal(slashMenuItems([], [], 'zzz', all).length, 0);
});
it('lists status items for model, reasoning, mode and context usage', () => {
  const usage = { tokens: 42_000, contextWindow: 200_000, percent: 21, compactAt: 180_000, turnCount: 3 } as ContextUsage;
  const text = statusItems({ model: 'anthropic/claude', thinkingLevel: 'high', mode: 'plan', usage }).map(i => i.value).join('|');
  for (const part of ['anthropic/claude', 'Plan', '42K / 200K (21%)', '180K', '3']) assert.ok(text.includes(part), `${part} in ${text}`);
  assert.equal(statusItems({ model: null, thinkingLevel: 'off', mode: 'agent', usage: null }).length, 3);
});
