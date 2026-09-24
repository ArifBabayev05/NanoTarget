// SPDX-License-Identifier: BUSL-1.1
/**
 * Policy engine. A company declares which resources are protected and what
 * happens for each actor assessment. The decision is made at the endpoint
 * that returns the data, never in the UI.
 */
import type { Assessment, Tier } from './assess.ts';

export type Mode = 'allow' | 'mask' | 'step_up' | 'block';

export type Rule = {
  resource: string;
  /** human-readable label for dashboards */
  title: string;
  onAgent: Mode;
  onUnknown: Mode;
  onHumanLike: Mode;
  /** applied when the actor is unknown but environment artifacts point at an agent tool (installed extension, agent-app browser, agent globals) */
  onArtifact: Mode;
  /** which evidence tiers are allowed to trigger `onAgent` */
  actOn: Tier[];
  /** minimum score for behavioral-only evidence */
  minScore: number;
};

export type Policy = {
  version: string;
  /** observe = log what would happen but always allow; enforce = apply */
  enforcement: 'observe' | 'enforce';
  rules: Rule[];
};

export type Decision = {
  id: string;
  resource: string;
  /** decision actually applied to the response */
  decision: Mode;
  /** decision the policy computed (differs from `decision` only in observe mode) */
  computed: Mode;
  enforced: boolean;
  actor: Assessment['actor'];
  score: number | null;
  tiers: Tier[];
  reasonCodes: string[];
  policyVersion: string;
  signalVersion: string;
  /** which branch of the rule fired */
  branch: 'agent' | 'artifact' | 'unknown' | 'human_like' | 'unprotected';
};

const DEFAULT_ACT_ON: Tier[] = ['verified', 'strong', 'control', 'behavioral'];

export const DEFAULT_POLICY: Policy = {
  version: 'policy-default-2',
  enforcement: 'enforce',
  rules: [
    { resource: 'profile.read', title: 'Profil məlumatı', onAgent: 'mask', onUnknown: 'allow', onHumanLike: 'allow', onArtifact: 'allow', actOn: DEFAULT_ACT_ON, minScore: 65 },
    { resource: 'balance.read', title: 'Balans', onAgent: 'block', onUnknown: 'allow', onHumanLike: 'allow', onArtifact: 'mask', actOn: DEFAULT_ACT_ON, minScore: 65 },
    { resource: 'transactions.search', title: 'Əməliyyat axtarışı', onAgent: 'mask', onUnknown: 'allow', onHumanLike: 'allow', onArtifact: 'allow', actOn: DEFAULT_ACT_ON, minScore: 65 },
    { resource: 'report.export', title: 'CSV ixracı', onAgent: 'block', onUnknown: 'step_up', onHumanLike: 'allow', onArtifact: 'step_up', actOn: DEFAULT_ACT_ON, minScore: 65 },
  ],
};

const MODES: Mode[] = ['allow', 'mask', 'step_up', 'block'];
const TIERS: Tier[] = ['verified', 'strong', 'control', 'behavioral', 'artifact'];

/** Validate an untrusted policy document from the dashboard. Returns null when invalid. */
export function parsePolicy(input: unknown, version: string): Policy | null {
  if (!input || typeof input !== 'object') return null;
  const o = input as Record<string, unknown>;
  if (o.enforcement !== 'observe' && o.enforcement !== 'enforce') return null;
  if (!Array.isArray(o.rules) || o.rules.length === 0 || o.rules.length > 50) return null;
  const rules: Rule[] = [];
  for (const r of o.rules) {
    if (!r || typeof r !== 'object') return null;
    const x = r as Record<string, unknown>;
    if (typeof x.resource !== 'string' || !/^[a-z][a-z0-9_.]{1,60}$/.test(x.resource)) return null;
    if (rules.some((k) => k.resource === x.resource)) return null;
    if (typeof x.title !== 'string' || x.title.length > 80) return null;
    for (const key of ['onAgent', 'onUnknown', 'onHumanLike'] as const) if (!MODES.includes(x[key] as Mode)) return null;
    const onArtifact = x.onArtifact === undefined ? 'allow' : x.onArtifact;
    if (!MODES.includes(onArtifact as Mode)) return null;
    if (!Array.isArray(x.actOn) || !x.actOn.every((t) => TIERS.includes(t as Tier))) return null;
    if (typeof x.minScore !== 'number' || x.minScore < 0 || x.minScore > 100) return null;
    rules.push({
      resource: x.resource,
      title: x.title,
      onAgent: x.onAgent as Mode,
      onUnknown: x.onUnknown as Mode,
      onHumanLike: x.onHumanLike as Mode,
      onArtifact: onArtifact as Mode,
      actOn: [...new Set(x.actOn as Tier[])],
      minScore: x.minScore,
    });
  }
  return { version, enforcement: o.enforcement, rules };
}

/**
 * Evaluate a policy for one resource against an assessment.
 * Pure: no I/O, deterministic. The caller persists the decision to the audit log.
 */
export function evaluate(policy: Policy, resource: string, a: Assessment, id: string): Decision {
  const rule = policy.rules.find((r) => r.resource === resource);
  const base = {
    id,
    resource,
    actor: a.actor,
    score: a.score,
    tiers: a.tiers,
    reasonCodes: a.reasons.map((r) => r.code),
    policyVersion: policy.version,
    signalVersion: a.version,
  };
  if (!rule) return { ...base, decision: 'allow', computed: 'allow', enforced: false, branch: 'unprotected' };

  let computed: Mode;
  let branch: Decision['branch'];
  const actionableTiers = a.tiers.filter((t) => rule.actOn.includes(t));
  const agentByPolicy =
    a.actor === 'agent_likely' &&
    actionableTiers.length > 0 &&
    (actionableTiers.some((t) => t === 'verified' || t === 'strong' || t === 'control') || (a.score ?? 0) >= rule.minScore);
  // artifact in actOn = treat environment traces as agent evidence; otherwise they take the softer onArtifact branch
  const artifactAsAgent = a.actor === 'unknown' && actionableTiers.includes('artifact');
  const artifactOnly = a.actor === 'unknown' && a.tiers.includes('artifact');

  if (agentByPolicy || artifactAsAgent) {
    computed = rule.onAgent;
    branch = 'agent';
  } else if (artifactOnly) {
    computed = rule.onArtifact;
    branch = 'artifact';
  } else if (a.actor === 'human_like') {
    computed = rule.onHumanLike;
    branch = 'human_like';
  } else {
    computed = rule.onUnknown;
    branch = 'unknown';
  }
  const enforced = policy.enforcement === 'enforce';
  return { ...base, computed, decision: enforced ? computed : 'allow', enforced, branch };
}
