// @ts-check
/**
 * operators.js — creating a new tenant (tour business).
 *
 * Every new operator needs its three preset roles (owner, manager, guide) and its ledger
 * accounts (session 10a) before it can do anything. This function is the ONE place that
 * happens, used by:
 *   - sign-up (apps/api, ACC-01): a real new business
 *   - the demo seed: Ìrìn Lagos Tours and its sandbox copies
 */
import { PRESET_ROLES } from '@okapigo/shared/permissions';
import { createLedgerAccounts } from './ledger.js';

/**
 * Creates an operator plus its preset roles. Must be called INSIDE a transaction (pass the
 * `tx` from prisma.$transaction) so callers can create the first users in the same
 * all-or-nothing unit.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {{ name: string, slug: string }} data
 * @returns {Promise<{ operator: import('@prisma/client').Operator, roleIds: Record<string, string> }>}
 *   roleIds maps a preset key ("owner") to the new role's id.
 */
export async function createOperatorWithPresetRoles(tx, { name, slug }) {
  const operator = await tx.operator.create({
    data: { name, slug, currency: 'NGN', timeZone: 'Africa/Lagos' },
  });

  /** @type {Record<string, string>} */
  const roleIds = {};
  for (const preset of PRESET_ROLES) {
    const role = await tx.role.create({
      data: {
        operatorId: operator.id,
        key: preset.key,
        name: preset.name,
        isPreset: true,
        permissions: preset.permissions,
      },
    });
    roleIds[preset.key] = role.id;
  }

  // The 7 standard ledger accounts (Paystack clearing, Tour sales, Refunds payable…).
  await createLedgerAccounts(tx, operator.id);

  return { operator, roleIds };
}
