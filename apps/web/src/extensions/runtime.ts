export interface WebExtensionModuleShape {
  readonly activateWeb?: ((ctx: unknown) => unknown) | undefined;
  readonly default?: ((ctx: unknown) => unknown) | undefined;
}

export function resolveWebExtensionActivator(
  module: WebExtensionModuleShape,
): ((ctx: unknown) => unknown) | null {
  if (typeof module.activateWeb === "function") {
    return module.activateWeb;
  }
  if (typeof module.default === "function") {
    return module.default;
  }
  return null;
}
