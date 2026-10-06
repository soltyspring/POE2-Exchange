export type RuneRecipe = {id: string; name: string; url: string; quantity: number; level: string; minLevel: number; maxLevel: number; runes: string[]}
export function remainingRunes(recipe: string[], entered: string[], mode: 'sequence' | 'contains'): string[] | null {
  if (mode === 'sequence') return entered.every((r,i) => recipe[i] === r) ? recipe.slice(entered.length) : null
  const remaining = [...recipe]
  for (const rune of entered) { const index = remaining.indexOf(rune); if (index < 0) return null; remaining.splice(index,1) }
  return remaining
}

export function runeSelectionLimit(recipes: {runes:string[]}[], id:string): number {
  return recipes.reduce((limit,recipe)=>Math.max(limit,recipe.runes.filter(rune=>rune===id).length),0)
}

/** Extra inventory runes never disqualify a recipe; consume each copy once. */
export function matchRuneInventory(recipe:string[], inventory:string[]) {
  const pool=[...inventory], remaining:string[]=[], available:boolean[]=[]
  for(const rune of recipe){
    const index=pool.indexOf(rune)
    available.push(index>=0)
    if(index>=0)pool.splice(index,1);else remaining.push(rune)
  }
  return {remaining,available,matched:recipe.length-remaining.length}
}
export function compareRuneCandidates(a:{remaining:string[];price:number|null;matched:number},b:{remaining:string[];price:number|null;matched:number}) {
  return a.remaining.length-b.remaining.length || (b.price??-1)-(a.price??-1) || b.matched-a.matched
}
