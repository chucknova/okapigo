// @ts-check
/**
 * policies.js — creating cancellation policies and their versions (BKG-26).
 *
 * Versions are append-only (a database trigger blocks UPDATEs), so "changing a policy"
 * always means addPolicyVersion(). Existing bookings keep pointing at the version they
 * were sold under; new bookings get the latest.
 */

/**
 * @typedef {{ rules: Array<{ hoursBefore: number, refundBasisPoints: number }>, noShowRefundBasisPoints: number, depositRefundable: boolean }} PolicyTerms
 */

/**
 * Creates a policy and its version 1.
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {{ operatorId: string, name: string, terms: PolicyTerms }} input
 */
export async function createPolicy(tx, { operatorId, name, terms }) {
  const policy = await tx.cancellationPolicy.create({ data: { operatorId, name } });
  const version = await addPolicyVersion(tx, policy.id, terms);
  return { policy, version };
}

/**
 * Adds the next version (2, 3, …) of a policy. If two people do this at the same moment,
 * the unique (policy, version) index rejects one of them (the API answers 409).
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} policyId
 * @param {PolicyTerms} terms
 */
export async function addPolicyVersion(tx, policyId, terms) {
  const latest = await tx.cancellationPolicyVersion.findFirst({
    where: { policyId },
    orderBy: { version: 'desc' },
    select: { version: true },
  });
  return tx.cancellationPolicyVersion.create({
    data: {
      policyId,
      version: (latest?.version ?? 0) + 1,
      // Store tiers most-generous-first, so they read naturally in the database.
      rules: [...terms.rules].sort((a, b) => b.hoursBefore - a.hoursBefore),
      noShowRefundBasisPoints: terms.noShowRefundBasisPoints,
      depositRefundable: terms.depositRefundable,
    },
  });
}

/**
 * The version new bookings should use, or null if the policy has none.
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} policyId
 */
export function currentPolicyVersion(tx, policyId) {
  return tx.cancellationPolicyVersion.findFirst({
    where: { policyId },
    orderBy: { version: 'desc' },
  });
}
