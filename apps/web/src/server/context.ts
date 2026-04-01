import type { RonbunContext } from "@ronbun/api";

const RONBUN_CONTEXT_BINDINGS = ["DB", "STORAGE", "VECTOR_INDEX", "AI", "INGEST_QUEUE"] as const;

type RonbunContextBinding = (typeof RONBUN_CONTEXT_BINDINGS)[number];

type RuntimeOptions = {
  env?: unknown;
  context?: {
    env?: unknown;
    cloudflare?: {
      env?: unknown;
    };
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

function hasBinding(value: unknown, key: RonbunContextBinding): boolean {
  return isRecord(value) && key in value;
}

function extractEnvCandidates(options: unknown): unknown[] {
  if (!isRecord(options)) {
    return [];
  }

  const candidate = options as RuntimeOptions;
  return [candidate.env, candidate.context?.env, candidate.context?.cloudflare?.env];
}

export function hasRonbunContextBindings(value: unknown): value is Env {
  return RONBUN_CONTEXT_BINDINGS.every((key) => hasBinding(value, key));
}

export function missingRonbunContextBindings(value: unknown): string[] {
  return RONBUN_CONTEXT_BINDINGS.filter((key) => !hasBinding(value, key));
}

export function resolveEnvFromOptions(options: unknown): Env | null {
  if (hasRonbunContextBindings(options)) {
    return options;
  }

  for (const candidate of extractEnvCandidates(options)) {
    if (hasRonbunContextBindings(candidate)) {
      return candidate;
    }
  }

  return null;
}

export function describeMissingRonbunContextBindings(options: unknown): string[] {
  const candidates = [options, ...extractEnvCandidates(options)];
  const contextLikeCandidate = candidates.find(
    (candidate) =>
      isRecord(candidate) && RONBUN_CONTEXT_BINDINGS.some((binding) => binding in candidate),
  );

  if (contextLikeCandidate) {
    return missingRonbunContextBindings(contextLikeCandidate);
  }

  const firstObjectCandidate = candidates.find((candidate) => isRecord(candidate));

  return missingRonbunContextBindings(firstObjectCandidate);
}

export function createRonbunContext(env: Env): RonbunContext {
  return {
    db: env.DB,
    storage: env.STORAGE,
    vectorIndex: env.VECTOR_INDEX,
    ai: env.AI,
    queue: env.INGEST_QUEUE,
  };
}
