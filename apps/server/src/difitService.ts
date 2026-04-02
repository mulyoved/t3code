import { NetService } from "@t3tools/shared/Net";
import { Effect } from "effect";

import { createDifitManager, type DifitManager } from "./difitManager";
import { OrchestrationEngineService } from "./orchestration/Services/OrchestrationEngine";

export interface DifitManagerShape extends DifitManager {}

let sharedDifitManager: DifitManagerShape | null = null;
let testDifitManager: DifitManagerShape | null = null;

async function closeManager(manager: DifitManagerShape | null): Promise<void> {
  if (!manager) {
    return;
  }
  try {
    await manager.close();
  } catch {
    // Swallow shutdown errors so cleanup never masks the main result.
  }
}

export const getDifitManager = Effect.gen(function* () {
  if (testDifitManager) {
    return testDifitManager;
  }
  if (sharedDifitManager) {
    return sharedDifitManager;
  }
  const orchestrationEngine = yield* OrchestrationEngineService;
  const net = yield* NetService;
  sharedDifitManager = createDifitManager({
    getSnapshot: () => Effect.runPromise(orchestrationEngine.getReadModel()),
    reserveLoopbackPort: () => Effect.runPromise(net.reserveLoopbackPort()),
  });
  return sharedDifitManager;
});

export const closeDifitManager = Effect.tryPromise({
  try: async () => {
    await closeManager(sharedDifitManager);
    sharedDifitManager = null;
  },
  catch: () => undefined,
}).pipe(Effect.ignore);

export function __setDifitManagerForTests(manager: DifitManagerShape | null): void {
  testDifitManager = manager;
}

export async function __resetDifitManagerForTests(): Promise<void> {
  testDifitManager = null;
  await closeManager(sharedDifitManager);
  sharedDifitManager = null;
}
