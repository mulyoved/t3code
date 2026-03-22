export interface WebPluginModuleShape {
  readonly default?: ((ctx: unknown) => unknown) | undefined;
  readonly activateWeb?: ((ctx: unknown) => unknown) | undefined;
}

export function resolveWebPluginActivator(
  module: WebPluginModuleShape,
): ((ctx: unknown) => unknown) | null {
  if (typeof module.default === "function") {
    return module.default;
  }
  if (typeof module.activateWeb === "function") {
    return module.activateWeb;
  }
  return null;
}
