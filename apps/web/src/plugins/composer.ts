import type { PluginComposerItem } from "@t3tools/contracts";

export function comparePluginComposerItems(
  left: PluginComposerItem,
  right: PluginComposerItem,
): number {
  const leftPriority = left.priority ?? 0;
  const rightPriority = right.priority ?? 0;
  if (leftPriority !== rightPriority) {
    return rightPriority - leftPriority;
  }
  return left.label.localeCompare(right.label);
}
