import type { SkillSummary, TaskRecipe } from '@vela/shared';
import { filterSkills } from './skill-picker';
import { filterCommands, type SlashCommand } from './slash-commands';

export type SlashMenuItem =
  | { type: 'command'; command: SlashCommand }
  | { type: 'skill'; skill: SkillSummary }
  | { type: 'recipe'; recipe: TaskRecipe };

/** 内置命令排在最前，其次是技能和任务配方。 */
export function slashMenuItems(skills: SkillSummary[], recipes: TaskRecipe[], query: string, commands: SlashCommand[] = []): SlashMenuItem[] {
  const needle = query.trim().toLocaleLowerCase();
  const matchingRecipes = recipes.filter(recipe => `${recipe.name} ${recipe.description} ${recipe.tags.join(' ')}`.toLocaleLowerCase().includes(needle))
    .sort((a, b) => Number(b.name.toLocaleLowerCase().startsWith(needle)) - Number(a.name.toLocaleLowerCase().startsWith(needle)) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return [...filterCommands(commands, query).map(command => ({ type: 'command' as const, command })),
    ...filterSkills(skills, query).map(skill => ({ type: 'skill' as const, skill })),
    ...matchingRecipes.map(recipe => ({ type: 'recipe' as const, recipe }))];
}
