import { Effect, Layer, Schema, ServiceMap } from "effect";

import { ServerConfig } from "../config";
import { createPluginManager, type PluginManager } from "./manager";

export interface PluginManagerShape extends PluginManager {}

export class PluginManagerService extends ServiceMap.Service<
  PluginManagerService,
  PluginManagerShape
>()("t3/plugins/PluginManager") {}

class PluginManagerServiceInitError extends Schema.TaggedErrorClass<PluginManagerServiceInitError>()(
  "PluginManagerServiceInitError",
  {
    message: Schema.String,
  },
) {}

const make = Effect.gen(function* () {
  const { cwd } = yield* ServerConfig;
  const manager = yield* Effect.tryPromise({
    try: () => createPluginManager({ cwd }),
    catch: (cause) =>
      new PluginManagerServiceInitError({
        message: `Failed to create plugin manager: ${String(cause)}`,
      }),
  });

  yield* Effect.addFinalizer(() =>
    Effect.tryPromise({
      try: () => manager.close(),
      catch: () => undefined,
    }).pipe(Effect.ignore),
  );

  return manager satisfies PluginManagerShape;
});

export const PluginManagerLive = Layer.effect(PluginManagerService, make);
