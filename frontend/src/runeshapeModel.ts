export type RuneRecipe = {id: string; name: string; url: string; quantity: number; level: string; minLevel: number; maxLevel: number; runes: string[]}
export function remainingRunes(recipe: string[], entered: string[], mode: 'sequence' | 'contains'): string[] | null {
  if (mode === 'sequence') return entered.every((r,i) => recipe[i] === r) ? recipe.slice(entered.length) : null
  const remaining = [...recipe]
  for (const rune of entered) { const index = remaining.indexOf(rune); if (index < 0) return null; remaining.splice(index,1) }
  return remaining
}
