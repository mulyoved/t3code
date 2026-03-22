import { queryOptions } from "@tanstack/react-query";
import type { PromptsListResult } from "@t3tools/contracts";

import { ensureNativeApi } from "../nativeApi";

export const promptQueryKeys = {
  all: ["prompts"] as const,
  list: (cwd: string | null) => ["prompts", "list", cwd] as const,
};

const EMPTY_PROMPTS_RESULT: PromptsListResult = {
  prompts: [],
};

export function promptsListQueryOptions(input: { cwd: string | null; enabled?: boolean }) {
  return queryOptions({
    queryKey: promptQueryKeys.list(input.cwd),
    queryFn: async () => {
      const api = ensureNativeApi();
      return api.prompts.list(input.cwd ? { cwd: input.cwd } : {});
    },
    enabled: input.enabled ?? true,
    staleTime: 30_000,
    placeholderData: (previous) => previous ?? EMPTY_PROMPTS_RESULT,
  });
}
