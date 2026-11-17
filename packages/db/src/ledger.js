// @ts-check
/**
 * ledger.js — writing to and reading from the double-entry ledger (PAY-22).
 *
 *   createLedgerAccounts  the 7 accounts every operator gets
 *   postTransaction       write one balanced, idempotent transaction
 *   reverseTransaction    undo one by posting its mirror image (never by editing)
 *   accountBalances       every account's balance
 *   accountStatement      one account's entries with a RUNNING BALANCE
 *   verifyLedger          the nightly "do the books balance?" check
 *   exportLedgerCsv       for the operator's accountant
 *
 * The database itself refuses unbalanced transactions and any edit or delete (see the
 * add_ledger migration). This code adds idempotency and the readable API on top.
 */
import { ACCOUNTS, assertBalanced, reverseLines, normalBalance } from '@okapigo/shared/ledger';
import { koboToDecimal } from '@okapigo/shared/money';

/** A ledger action that isn't allowed, with a code (the API sends 409/404). */
export class LedgerActionError extends Error {
  /** @param {string} code @param {string} message */
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/**
 * Creates the standard accounts for a new operator. (Existing operators got theirs from
 * the add_ledger migration.)
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} operatorId
 */
export function createLedgerAccounts(tx, operatorId) {
  return tx.ledgerAccount.createMany({
    data: Object.entries(ACCOUNTS).map(([key, a]) => ({
      operatorId,
      key,
      code: a.code,
      name: a.name,
      type: a.type,
      normal: a.normal,
    })),
  });
}

/**
 * Posts one transaction. IDEMPOTENT: posting the same idempotencyKey again returns the
 * existing transaction and writes nothing new.
 *
 * Why INSERT … ON CONFLICT DO NOTHING (raw SQL) and not "check, then insert"? Two copies
 * of the same event can arrive at the same instant (a webhook and its retry). With
 * check-then-insert, both see "not there yet", both insert, and the second hits the unique
 * index, an ERROR, and in PostgreSQL any error aborts the WHOLE surrounding transaction
 * (taking the booking change with it). ON CONFLICT DO NOTHING makes the second insert wait
 * for the first to commit and then quietly do nothing. No error, no abort.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx  must be inside $transaction
 * @param {{
 *   operatorId: string,
 *   type: string,
 *   idempotencyKey: string,
 *   description: string,
 *   lines: import('@okapigo/shared/ledger').Line[],
 *   bookingId?: string | null,
 *   occurredAt?: Date,
 *   reversesId?: string | null,
 *   createdById?: string | null,
 * }} input
 * @returns {Promise<{ transactionId: string, created: boolean }>}
 */
export async function postTransaction(tx, input) {
  assertBalanced(input.lines); // fail fast with a clear message (the DB checks again at commit)

  /** @type {Array<{ id: string }>} */
  const inserted = await tx.$queryRaw`
    INSERT INTO ledger_transactions
      (id, operator_id, type, idempotency_key, description, occurred_at, reverses_id, created_by_id)
    VALUES
      (gen_random_uuid(), ${input.operatorId}::uuid, ${input.type}, ${input.idempotencyKey},
       ${input.description}, ${input.occurredAt ?? new Date()}, ${input.reversesId ?? null}::uuid,
       ${input.createdById ?? null}::uuid)
    ON CONFLICT (operator_id, idempotency_key) DO NOTHING
    RETURNING id`;

  if (inserted.length === 0) {
    const existing = await tx.ledgerTransaction.findUniqueOrThrow({
      where: {
        operatorId_idempotencyKey: {
          operatorId: input.operatorId,
          idempotencyKey: input.idempotencyKey,
        },
      },
      select: { id: true },
    });
    return { transactionId: existing.id, created: false };
  }

  const accounts = await tx.ledgerAccount.findMany({ where: { operatorId: input.operatorId } });
  const idByKey = new Map(accounts.map((a) => [a.key, a.id]));
  const transactionId = inserted[0].id;

  await tx.ledgerEntry.createMany({
    data: input.lines.map((line) => {
      const accountId = idByKey.get(line.account);
      if (!accountId)
        throw new LedgerActionError('MISSING_ACCOUNT', `Operator has no ${line.account} account.`);
      return {
        operatorId: input.operatorId,
        transactionId,
        accountId,
        bookingId: input.bookingId ?? null,
        debitKobo: line.debitKobo,
        creditKobo: line.creditKobo,
      };
    }),
  });
  return { transactionId, created: true };
}

/**
 * Undoes a transaction by posting its mirror image. The original stays, untouched and
 * visible, next to its reversal: an honest history. Each transaction can be reversed once
 * (the unique reverses_id column guarantees it), and reversals themselves can't be reversed
 * (post the original again instead).
 *
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{ operatorId: string, transactionId: string, reason: string, createdById?: string | null }} input
 */
export function reverseTransaction(prisma, { operatorId, transactionId, reason, createdById }) {
  return prisma.$transaction(async (tx) => {
    const original = await tx.ledgerTransaction.findFirst({
      where: { id: transactionId, operatorId },
      include: { entries: { include: { account: true } }, reversedBy: true },
    });
    if (!original) throw new LedgerActionError('NOT_FOUND', 'Transaction not found.');
    if (original.type === 'reversal') {
      throw new LedgerActionError(
        'CANNOT_REVERSE_REVERSAL',
        'A reversal can’t be reversed; post the original again instead.',
      );
    }
    if (original.reversedBy)
      throw new LedgerActionError(
        'ALREADY_REVERSED',
        'This transaction has already been reversed.',
      );

    const lines = reverseLines(
      original.entries.map((e) => ({
        account: /** @type {import('@okapigo/shared/ledger').AccountKey} */ (e.account.key),
        debitKobo: e.debitKobo,
        creditKobo: e.creditKobo,
      })),
    );
    return postTransaction(tx, {
      operatorId,
      type: 'reversal',
      idempotencyKey: `reversal:${original.id}`,
      description: `Reversal of "${original.description}": ${reason}`,
      lines,
      bookingId: original.entries[0]?.bookingId ?? null,
      reversesId: original.id,
      createdById,
    });
  });
}

/**
 * Every account with its total debits, credits and balance (on its normal side).
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {string} operatorId
 */
export async function accountBalances(prisma, operatorId) {
  /** @type {Array<{ key: string, code: string, name: string, type: string, normal: 'debit' | 'credit', debits: bigint, credits: bigint }>} */
  const rows = await prisma.$queryRaw`
    SELECT a.key, a.code, a.name, a.type, a.normal,
           COALESCE(SUM(e.debit_kobo), 0) AS debits,
           COALESCE(SUM(e.credit_kobo), 0) AS credits
      FROM ledger_accounts a
      LEFT JOIN ledger_entries e ON e.account_id = a.id
     WHERE a.operator_id = ${operatorId}::uuid
     GROUP BY a.id
     ORDER BY a.code`;
  // SUM() comes back as BigInt; Number() is safe below 9 quadrillion kobo.
  return rows.map((r) => {
    const debits = Number(r.debits);
    const credits = Number(r.credits);
    return { ...r, debits, credits, balanceKobo: normalBalance(r.normal, debits, credits) };
  });
}

/**
 * One account's entries, oldest first, each with the RUNNING BALANCE after it.
 *
 * The running balance is computed by the database with a WINDOW FUNCTION:
 *   SUM(change) OVER (ORDER BY created_at, id)
 * meaning "for each row, add up `change` for this row and every row before it". Nothing is
 * stored, so concurrent postings never fight over a "current balance" row. The window runs
 * over ALL the account's rows before the date filter is applied, so a statement starting
 * mid-month still carries the correct opening balance.
 *
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{ operatorId: string, key: string, from?: Date, to?: Date }} input
 */
export async function accountStatement(prisma, { operatorId, key, from, to }) {
  const account = await prisma.ledgerAccount.findUnique({
    where: { operatorId_key: { operatorId, key } },
  });
  if (!account) throw new LedgerActionError('NOT_FOUND', 'Account not found.');
  const sign = account.normal === 'debit' ? 1 : -1; // so "up" means the account's normal direction

  /** @type {Array<any>} */
  const rows = await prisma.$queryRaw`
    SELECT * FROM (
      SELECT e.id, e.created_at, e.debit_kobo, e.credit_kobo, e.booking_id,
             t.id AS transaction_id, t.type, t.description, t.occurred_at,
             b.reference AS booking_reference,
             SUM(${sign} * (e.debit_kobo - e.credit_kobo))
               OVER (ORDER BY e.created_at, e.id) AS running_balance
        FROM ledger_entries e
        JOIN ledger_transactions t ON t.id = e.transaction_id
        LEFT JOIN bookings b ON b.id = e.booking_id
       WHERE e.account_id = ${account.id}::uuid
    ) s
    WHERE (${from ?? null}::timestamptz IS NULL OR s.created_at >= ${from ?? null}::timestamptz)
      AND (${to ?? null}::timestamptz IS NULL OR s.created_at < ${to ?? null}::timestamptz)
    ORDER BY s.created_at, s.id`;

  return {
    account: { key: account.key, code: account.code, name: account.name, normal: account.normal },
    entries: rows.map((r) => ({
      id: r.id,
      at: r.created_at,
      transactionId: r.transaction_id,
      type: r.type,
      description: r.description,
      bookingReference: r.booking_reference,
      debitKobo: r.debit_kobo,
      creditKobo: r.credit_kobo,
      runningBalanceKobo: Number(r.running_balance),
    })),
  };
}

/**
 * The integrity check (run nightly by the workers app, and on demand by staff).
 *
 * The database already refuses unbalanced transactions, so "errors" here should never
 * appear. If one does, something bypassed the rules, and a human needs to know. "Warnings"
 * are states that are legal but suspicious (we paid out more than came in).
 *
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{ operatorId?: string }} [options] omit to check every operator
 */
export async function verifyLedger(prisma, { operatorId } = {}) {
  /** @type {Array<{ code: string, severity: 'error' | 'warning', operatorId: string, detail: string }>} */
  const issues = [];

  /** @type {Array<{ operator_id: string, debits: bigint, credits: bigint }>} */
  const totals = await prisma.$queryRaw`
    SELECT operator_id, SUM(debit_kobo) AS debits, SUM(credit_kobo) AS credits
      FROM ledger_entries
     WHERE ${operatorId ?? null}::uuid IS NULL OR operator_id = ${operatorId ?? null}::uuid
     GROUP BY operator_id`;
  for (const t of totals) {
    if (t.debits !== t.credits) {
      issues.push({
        code: 'BOOKS_UNBALANCED',
        severity: 'error',
        operatorId: t.operator_id,
        detail: `debits ${t.debits} ≠ credits ${t.credits}`,
      });
    }
  }

  /** @type {Array<{ id: string, operator_id: string }>} */
  const badTransactions = await prisma.$queryRaw`
    SELECT t.id, t.operator_id
      FROM ledger_transactions t
      LEFT JOIN ledger_entries e ON e.transaction_id = t.id
     WHERE ${operatorId ?? null}::uuid IS NULL OR t.operator_id = ${operatorId ?? null}::uuid
     GROUP BY t.id
    HAVING COUNT(e.id) < 2 OR COALESCE(SUM(e.debit_kobo), 0) <> COALESCE(SUM(e.credit_kobo), 0)`;
  for (const t of badTransactions) {
    issues.push({
      code: 'TRANSACTION_UNBALANCED',
      severity: 'error',
      operatorId: t.operator_id,
      detail: `transaction ${t.id}`,
    });
  }

  /** @type {Array<{ operator_id: string, key: string, balance: bigint }>} */
  const negatives = await prisma.$queryRaw`
    SELECT a.operator_id, a.key,
           SUM(CASE WHEN a.normal = 'debit' THEN e.debit_kobo - e.credit_kobo
                    ELSE e.credit_kobo - e.debit_kobo END) AS balance
      FROM ledger_accounts a JOIN ledger_entries e ON e.account_id = a.id
     WHERE a.key IN ('PROVIDER_CLEARING', 'REFUNDS_PAYABLE', 'UNALLOCATED_RECEIPTS')
       AND (${operatorId ?? null}::uuid IS NULL OR a.operator_id = ${operatorId ?? null}::uuid)
     GROUP BY a.id
    HAVING SUM(CASE WHEN a.normal = 'debit' THEN e.debit_kobo - e.credit_kobo
                    ELSE e.credit_kobo - e.debit_kobo END) < 0`;
  for (const n of negatives) {
    issues.push({
      code: 'NEGATIVE_BALANCE',
      severity: 'warning',
      operatorId: n.operator_id,
      detail: `${n.key} is ${n.balance} kobo`,
    });
  }

  return { ok: !issues.some((i) => i.severity === 'error'), issues };
}

/**
 * The ledger as CSV for an accountant (PRD: "exportable"). One row per entry, amounts in
 * naira with two decimals (accountants' spreadsheets expect "50000.00", not kobo).
 *
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{ operatorId: string, from?: Date, to?: Date }} input
 */
export async function exportLedgerCsv(prisma, { operatorId, from, to }) {
  const entries = await prisma.ledgerEntry.findMany({
    where: { operatorId, createdAt: { gte: from, lt: to } },
    include: { transaction: true, account: true, booking: { select: { reference: true } } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  const header = [
    'date',
    'transaction_id',
    'type',
    'description',
    'account_code',
    'account',
    'booking',
    'debit_ngn',
    'credit_ngn',
  ];
  const rows = entries.map((e) => [
    e.transaction.occurredAt.toISOString(),
    e.transactionId,
    e.transaction.type,
    e.transaction.description,
    e.account.code,
    e.account.name,
    e.booking?.reference ?? '',
    e.debitKobo ? koboToDecimal(e.debitKobo) : '',
    e.creditKobo ? koboToDecimal(e.creditKobo) : '',
  ]);
  return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
}

/**
 * Quotes a CSV cell when needed: commas, quotes or line breaks inside a value would
 * otherwise break the columns. A leading = + - @ is prefixed with ' so spreadsheet apps
 * don't run it as a formula ("CSV injection": a guest named "=HYPERLINK(...)").
 * @param {string | number} value
 */
function csvCell(value) {
  let s = String(value);
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
