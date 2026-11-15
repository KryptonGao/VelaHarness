import assert from 'node:assert/strict';
import { it } from 'node:test';
import type { ContextUsage, CustomCommand, SkillSummary, TaskRecipe } from '@vela/shared';
import { expandCustomCommand, parseSlashInvocation } from '../../../packages/shared/src/custom-commands.ts';
import { slashMenuItems } from '../src/renderer/components/composer/slash-picker.ts';
import {
  buildReviewPrompt,
  isBuiltinSlashCommand,
  parseEffortArg,
  parseModeArg,
  slashCommandAcceptsArguments,
  slashCommands,
  statusItems,
} from '../src/renderer/components/composer/slash-commands.ts';
const skill = (enabled = true): SkillSummary => ({ name: 'review', description: 'Read a project', enabled, origin: 'project', location: '/skills/review', disableModelInvocation: false, canDelete: false });
const recipe = (id: string, name: string, description = '', tags: string[] = []): TaskRecipe => ({ id, name, description, tags, origin: 'user', revision: 1, createdAt: 1, updatedAt: 1, parameters: [], defaultMode: 'agent', objectiveTemplate: 'Review', workflowTemplate: 'Read', deliverableTemplate: 'Report' });
const customCommand = (name: string, origin: 'project' | 'user' = 'project', description = 'Custom prompt', acceptsArguments = false): CustomCommand => ({
  name,
  description,
  content: acceptsArguments ? `Run ${name} on $ARGUMENTS` : `Run ${name}`,
  location: `/commands/${name}.md`,
  origin,
  acceptsArguments,
});
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

it('exposes the full built-in command family in expected order and respects availability flags', () => {
  const full = slashCommands({
    canChangeModel: true,
    canChangeEffort: true,
    canChangeMode: true,
    canHandoff: true,
    canRace: true,
    canReview: true,
    canCompact: true,
  });
  assert.deepEqual(full.map(c => c.id), ['model', 'effort', 'mode', 'handoff', 'race', 'review', 'compact', 'status']);
  assert.equal(isBuiltinSlashCommand('review'), true);
  assert.equal(isBuiltinSlashCommand('deploy'), false);
  assert.equal(slashCommandAcceptsArguments('effort'), true);
  assert.equal(slashCommandAcceptsArguments('handoff'), false);
});

it('places custom commands between built-in commands and skills/recipes', () => {
  const builtIns = slashCommands({ canChangeModel: true, canCompact: false });
  const customs = [customCommand('zebra', 'user'), customCommand('alpha', 'project', 'Check build', true)];
  const entries = slashMenuItems([skill()], [recipe('a', 'Release')], '', builtIns, customs);
  assert.deepEqual(entries.map(e => e.type), ['command', 'command', 'customCommand', 'customCommand', 'skill', 'recipe']);
  assert.deepEqual(
    entries.filter(e => e.type === 'customCommand').map(e => e.customCommand.name),
    ['alpha', 'zebra'],
  );
  assert.deepEqual(
    slashMenuItems([skill()], [], 'al', builtIns, customs).map(e => e.type === 'customCommand' && e.customCommand.name),
    ['alpha'],
  );
});

it('parses /effort and /mode arguments and builds a read-only /review prompt', () => {
  assert.deepEqual(parseEffortArg('high', ['off', 'low', 'medium', 'high']), { ok: true, level: 'high' });
  assert.deepEqual(parseEffortArg('MED', ['off', 'low', 'medium', 'high']), { ok: true, level: 'medium' });
  assert.deepEqual(parseEffortArg('max', ['off', 'low', 'medium', 'high', 'xhigh']), { ok: true, level: 'xhigh' });
  const unsupported = parseEffortArg('ultra', ['low', 'high']);
  assert.equal(unsupported.ok, false);
  assert.match(unsupported.error, /ultra/);
  assert.match(unsupported.error, /low, high/);
  const unknown = parseEffortArg('turbo', ['low', 'high']);
  assert.equal(unknown.ok, false);
  assert.match(unknown.error, /turbo/);

  assert.equal(parseModeArg('plan'), 'plan');
  assert.equal(parseModeArg('GOAL'), 'goal');
  assert.equal(parseModeArg('default'), 'agent');
  assert.equal(parseModeArg('unknown'), null);

  assert.match(buildReviewPrompt('src/auth.ts'), /src\/auth\.ts/);
  assert.match(buildReviewPrompt(), /git diff/);
  assert.deepEqual(parseSlashInvocation('/review src/auth.ts'), { name: 'review', args: 'src/auth.ts' });
  assert.equal(expandCustomCommand('Audit $ARGUMENTS', 'auth module'), 'Audit auth module');
});
