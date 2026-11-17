/**
 * The double-entry ledger (PAY-22) against the real database: posting, idempotency,
 * the DATABASE's own guards (balanced, append-only), reversals, statements, checks, CSV.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { ACCOUNTS, POSTINGS } from '@okapigo/shared/ledger';
import {
  createPrismaClient,
  seedDemoOperator,
  postTransaction,
  reverseTransaction,
  accountBalances,
  accountStatement,
  verifyLedger,
  exportLedgerCsv,
} from '../src/index.js';

let prisma;
const created = [];

beforeAll(() => {
  prisma = createPrismaClient(process.env.DATABASE_URL);
});
afterAll(() => prisma.$disconnect());
afterEach(async () => {
  await prisma.operator.deleteMany({ where: { id: { in: created.splice(0) } } });
});

async function operator() {
  const op = await seedDemoOperator(prisma, { slug: `test-${randomUUID().slice(0, 8)}` });
  created.push(op.id);
  return op;
}

/** Posts in its own transaction (the API and jobs always post inside one). */
function post(
  op,
  {
    type = 'payment_received',
    key = randomUUID(),
    lines = POSTINGS.paymentReceived(5_000_000),
    description = 'Test',
  } = {},
) {
  return prisma.$transaction((tx) =>
    postTransaction(tx, { operatorId: op.id, type, idempotencyKey: key, description, lines }),
  );
}

const balanceOf = async (op, key) =>
  (await accountBalances(prisma, op.id)).find((a) => a.key === key).balanceKobo;

/** Runs raw SQL in a transaction and returns the error message, or 'OK'. */
async function rawOutcome(fn) {
  try {
    await prisma.$transaction(fn);
    return 'OK';
  } catch (err) {
    return String(err.message);
  }
}

describe('accounts', () => {
  it('every new operator gets the standard chart of accounts', async () => {
    const op = await operator();
    const accounts = await prisma.ledgerAccount.findMany({
      where: { operatorId: op.id },
      orderBy: { code: 'asc' },
    });
    expect(accounts.map((a) => [a.code, a.key, a.normal])).toEqual(
      Object.entries(ACCOUNTS)
        .map(([key, a]) => [a.code, key, a.normal])
        .sort(),
    );
  });

  it('the migration that backfilled existing operators lists exactly the same accounts', () => {
    // The add_ledger migration has its own copy of the account list (SQL can't import
    // JavaScript). This test fails if the two ever drift apart.
    const dir = new URL('../prisma/migrations/', import.meta.url);
    const folder = readdirSync(dir).find((f) => f.endsWith('_add_ledger'));
    const sql = readFileSync(new URL(`${folder}/migration.sql`, dir), 'utf8');
    // \s* between columns: the SQL lines up its columns with extra spaces.
    const rows = [
      ...sql.matchAll(/\('(\d{4})',\s*'([A-Z_]+)',\s*'([^']+)',\s*'(\w+)',\s*'(\w+)'\)/g),
    ].map((m) => m.slice(1));
    expect(rows).toEqual(
      Object.entries(ACCOUNTS).map(([key, a]) => [a.code, key, a.name, a.type, a.normal]),
    );
  });
});

describe('posting', () => {
  it('a payment and its fee update the balances', async () => {
    const op = await operator();
    await post(op, { lines: POSTINGS.paymentReceived(5_000_000) });
    await post(op, { type: 'payment_fee', lines: POSTINGS.paymentFee(75_000) });

    expect(await balanceOf(op, 'PROVIDER_CLEARING')).toBe(4_925_000);
    expect(await balanceOf(op, 'TOUR_SALES')).toBe(5_000_000);
    expect(await balanceOf(op, 'PAYMENT_FEES')).toBe(75_000);
  });

  it('posting the same event twice writes it once', async () => {
    const op = await operator();
    const first = await post(op, { key: 'payment:PSK_123' });
    const again = await post(op, { key: 'payment:PSK_123' });

    expect(first.created).toBe(true);
    expect(again).toEqual({ transactionId: first.transactionId, created: false });
    expect(await balanceOf(op, 'TOUR_SALES')).toBe(5_000_000); // not ₦100,000
  });

  it('RACE: 10 copies of one event posted at the same instant are written once', async () => {
    const op = await operator();
    const results = await Promise.all(
      Array.from({ length: 10 }, () => post(op, { key: 'payment:PSK_RACE' })),
    );

    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(new Set(results.map((r) => r.transactionId)).size).toBe(1);
    expect(await prisma.ledgerEntry.count({ where: { operatorId: op.id } })).toBe(2);
  });
});

describe("the database's own guards", () => {
  // These bypass our code entirely, with raw SQL, as a buggy script or a person in psql might.
  /** Inserts a transaction row and the given [debit, credit] entries on clearing/sales. */
  const rawTransaction = (op, entries) => async (tx) => {
    const [t] = await tx.$queryRaw`
      INSERT INTO ledger_transactions (id, operator_id, type, idempotency_key, description, occurred_at)
      VALUES (gen_random_uuid(), ${op.id}::uuid, 'adjustment', ${randomUUID()}, 'raw', now()) RETURNING id`;
    const accounts = await tx.ledgerAccount.findMany({ where: { operatorId: op.id } });
    const clearing = accounts.find((a) => a.key === 'PROVIDER_CLEARING').id;
    for (const [debit, credit] of entries) {
      await tx.$executeRaw`
        INSERT INTO ledger_entries (id, operator_id, transaction_id, account_id, debit_kobo, credit_kobo)
        VALUES (gen_random_uuid(), ${op.id}::uuid, ${t.id}::uuid, ${clearing}::uuid, ${debit}, ${credit})`;
    }
  };

  it('an unbalanced transaction is refused at COMMIT', async () => {
    const op = await operator();
    const message = await rawOutcome(
      rawTransaction(op, [
        [10_000, 0],
        [0, 9_000],
      ]),
    );
    expect(message).toMatch(/unbalanced/);
    expect(await prisma.ledgerTransaction.count({ where: { operatorId: op.id } })).toBe(0); // nothing saved
  });

  it('a transaction with a single entry is refused', async () => {
    const op = await operator();
    expect(await rawOutcome(rawTransaction(op, [[10_000, 0]]))).toMatch(/at least 2|fewer than 2/);
  });

  it('a balanced raw transaction is allowed (the guard checks balance, not who wrote it)', async () => {
    const op = await operator();
    expect(
      await rawOutcome(
        rawTransaction(op, [
          [10_000, 0],
          [0, 10_000],
        ]),
      ),
    ).toBe('OK');
  });

  it('entries and transactions cannot be edited or deleted', async () => {
    const op = await operator();
    const { transactionId } = await post(op);
    const entry = await prisma.ledgerEntry.findFirst({ where: { transactionId } });

    await expect(
      prisma.ledgerEntry.update({ where: { id: entry.id }, data: { debitKobo: 1 } }),
    ).rejects.toThrow(/append-only/);
    await expect(prisma.ledgerEntry.delete({ where: { id: entry.id } })).rejects.toThrow(
      /append-only/,
    );
    await expect(
      prisma.ledgerTransaction.update({
        where: { id: transactionId },
        data: { description: 'edited' },
      }),
    ).rejects.toThrow(/append-only/);
  });

  it('…except when the whole operator is deleted (sandbox cleanup)', async () => {
    const op = await operator();
    await post(op);
    await prisma.operator.delete({ where: { id: op.id } });
    expect(await prisma.ledgerEntry.count({ where: { operatorId: op.id } })).toBe(0);
  });
});

describe('reversals', () => {
  it('undo a transaction without touching it, once only', async () => {
    const op = await operator();
    const { transactionId } = await post(op);

    await reverseTransaction(prisma, {
      operatorId: op.id,
      transactionId,
      reason: 'Posted to the wrong business',
    });

    expect(await balanceOf(op, 'TOUR_SALES')).toBe(0);
    expect(await prisma.ledgerTransaction.count({ where: { operatorId: op.id } })).toBe(2); // original kept
    await expect(
      reverseTransaction(prisma, { operatorId: op.id, transactionId, reason: 'again' }),
    ).rejects.toMatchObject({
      code: 'ALREADY_REVERSED',
    });
    const reversal = await prisma.ledgerTransaction.findFirst({
      where: { reversesId: transactionId },
    });
    await expect(
      reverseTransaction(prisma, { operatorId: op.id, transactionId: reversal.id, reason: 'x' }),
    ).rejects.toMatchObject({
      code: 'CANNOT_REVERSE_REVERSAL',
    });
  });
});

describe('statements', () => {
  it('show a running balance, carrying the opening balance into a date range', async () => {
    const op = await operator();
    await post(op, { description: 'Payment', lines: POSTINGS.paymentReceived(5_000_000) });
    await new Promise((r) => setTimeout(r, 20)); // distinct timestamps for the date filter
    const midpoint = new Date();
    await post(op, { type: 'payment_fee', description: 'Fee', lines: POSTINGS.paymentFee(75_000) });

    const all = await accountStatement(prisma, { operatorId: op.id, key: 'PROVIDER_CLEARING' });
    expect(all.entries.map((e) => [e.description, e.runningBalanceKobo])).toEqual([
      ['Payment', 5_000_000],
      ['Fee', 4_925_000],
    ]);

    const later = await accountStatement(prisma, {
      operatorId: op.id,
      key: 'PROVIDER_CLEARING',
      from: midpoint,
    });
    expect(later.entries.map((e) => e.runningBalanceKobo)).toEqual([4_925_000]); // not 75,000 negative
  });
});

describe('verifyLedger', () => {
  it('passes healthy books and warns about money paid out that never came in', async () => {
    const op = await operator();
    await post(op);
    expect(await verifyLedger(prisma, { operatorId: op.id })).toEqual({ ok: true, issues: [] });

    await post(op, { type: 'refund_paid', lines: POSTINGS.refundPaid(9_000_000) });
    const result = await verifyLedger(prisma, { operatorId: op.id });
    expect(result.ok).toBe(true); // legal, but suspicious:
    expect(result.issues.map((i) => i.detail)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('PROVIDER_CLEARING'),
        expect.stringContaining('REFUNDS_PAYABLE'),
      ]),
    );
  });
});

describe('CSV export', () => {
  it('one row per entry, naira with decimals, and formula injection neutralised', async () => {
    const op = await operator();
    await post(op, { description: '=HYPERLINK("http://evil.example","click")' });

    const csv = await exportLedgerCsv(prisma, { operatorId: op.id });
    const lines = csv.trim().split('\n');

    expect(lines[0]).toBe(
      'date,transaction_id,type,description,account_code,account,booking,debit_ngn,credit_ngn',
    );
    expect(lines).toHaveLength(3); // header + 2 entries
    // Both entries share a timestamp, so their order is decided by random ids: look rows up
    // by content, not position. (A first version assumed line 1 and failed ~1 run in 3.)
    const clearing = lines.find((l) => l.includes(',1100,'));
    expect(clearing).toContain(',1100,Paystack clearing,,50000.00,');
    expect(lines.find((l) => l.includes(',4000,'))).toContain(',4000,Tour sales,,,50000.00');
    expect(clearing).toContain(`"'=HYPERLINK(""http://evil.example"",""click"")"`); // quoted and defused
  });
});
