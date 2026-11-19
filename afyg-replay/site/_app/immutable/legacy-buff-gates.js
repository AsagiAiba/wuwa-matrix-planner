// The standalone fast-calc reader bypasses the upstream editor's version
// migration. Use the same upstream converter before initializing its Buff store.
export function normalizeLegacyBuffGates(project, rulesFromLegacyCondition) {
  for (const buffs of [project.buffs, project.phases?.calculation?.data?.buffSets,
    project.encounter?.calculation?.data?.buffSets]) {
    if (!Array.isArray(buffs)) continue;
    for (const buff of buffs) {
      if (!buff?.condition || buff.rules?.length) continue;
      const rules = rulesFromLegacyCondition(buff.condition, buff.conditionRefCharIdx);
      if (rules?.length) buff.rules = rules;
    }
  }
}
