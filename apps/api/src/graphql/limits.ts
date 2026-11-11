import { GraphQLError, Kind, type ValidationRule, type SelectionSetNode, type FragmentDefinitionNode } from 'graphql';

const ROOT_COST: Record<string, number> = { parallel: 5000, passage: 1000, chapter: 1000, verses: 1000, translations: 1000, translation: 1000, search: 100 };

/** Count expanded selections, including every fragment reuse, before resolvers run. */
export const queryLimitsRule: ValidationRule = context => ({
  Document(document) {
    const operations = document.definitions.filter(d => d.kind === Kind.OPERATION_DEFINITION);
    const fragments = new Map<string, FragmentDefinitionNode>();
    for (const d of document.definitions) if (d.kind === Kind.FRAGMENT_DEFINITION) fragments.set(d.name.value, d);
    let fields = 0, aliases = 0, cost = 0, expansions = 0;
    let violation = operations.length > 1 ? 'one operation per document' : '';
    const walk = (set: SelectionSetNode, depth: number, seen: Set<string>): void => {
      if (violation) return;
      if (depth > 12) { violation = 'depth limit 12'; return; }
      for (const selection of set.selections) {
        if (selection.kind === Kind.FRAGMENT_SPREAD) {
          if (++expansions > 500) { violation = 'fragment expansion limit exceeded'; return; }
          const name = selection.name.value;
          if (seen.has(name)) { violation = 'fragment cycle'; return; }
          const fragment = fragments.get(name);
          if (fragment) walk(fragment.selectionSet, depth, new Set([...seen, name]));
        } else if (selection.kind === Kind.INLINE_FRAGMENT) {
          if (++expansions > 500) { violation = 'fragment expansion limit exceeded'; return; }
          walk(selection.selectionSet, depth, seen);
        }
        else {
          fields++; if (selection.alias) aliases++;
          // Root data fields dominate backend work; descendants are also bounded.
          cost += depth === 1 ? (ROOT_COST[selection.name.value] ?? 1) : 1;
          if (fields > 500 || aliases > 30 || cost > 10000) { violation = 'field, alias or cost limit exceeded'; return; }
          if (selection.selectionSet) walk(selection.selectionSet, depth + 1, seen);
        }
        if (violation) return;
      }
    };
    for (const op of operations) walk(op.selectionSet, 1, new Set());
    if (violation) context.reportError(new GraphQLError(`Query limit exceeded: ${violation}`, { extensions: { code: 'QUERY_LIMIT' } }));
    return false;
  },
});
