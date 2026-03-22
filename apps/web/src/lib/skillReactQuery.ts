import { queryOptions } from "@tanstack/react-query";
import type { SkillsListResult } from "@t3tools/contracts";

import { ensureNativeApi } from "~/nativeApi";

export const skillQueryKeys = {
  all: ["skills"] as const,
  list: (cwd: string | null) => ["skills", "list", cwd] as const,
};

const EMPTY_SKILLS_RESULT: SkillsListResult = {
  skills: [],
};

export function skillsListQueryOptions(input: { cwd: string | null; enabled?: boolean }) {
  return queryOptions({
    queryKey: skillQueryKeys.list(input.cwd),
    queryFn: async () => {
      const api = ensureNativeApi();
      return api.skills.list(input.cwd ? { cwd: input.cwd } : {});
    },
    enabled: input.enabled ?? true,
    staleTime: 30_000,
    placeholderData: (previous) => previous ?? EMPTY_SKILLS_RESULT,
  });
}
