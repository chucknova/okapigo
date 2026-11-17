/**
 * The ledger API (PAY-22).
 */
import { describe, it, expect, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import { createTestContext } from './helpers.js';

const ctx = createTestContext();
afterEach(() => ctx.cleanup());
afterAll(() => ctx.close());

function as(token) {
  const withAuth = (method) => (url) =>
    request(ctx.app)[method](url).set('Authorization', `Bearer ${token}`);
  return { get: withAuth('get'), post: withAuth('post') };
}

async function setup() {
  const seeded = await ctx.seedOperator();
  return {
    ...seeded,
    manager: as(await ctx.tokenFor(seeded.manager.id)), // payments: edit
    guide: as(await ctx.tokenFor(seeded.guides[0].id)), // payments: none
  };
}

const balances = async (client) =>
  Object.fromEntries(
    (await client.get('/api/ledger/accounts')).body.accounts.map((a) => [a.key, a.balanceKobo]),
  );

describe('reading the books', () => {
  it('lists the 7 accounts, all at zero for a new business', async () => {
    const { manager } = await setup();
    const res = await manager.get('/api/ledger/accounts');

    expect(res.status).toBe(200);
    expect(res.body.accounts.map((a) => a.code)).toEqual([
      '1100',
      '2100',
      '2200',
      '4000',
      '4100',
      '5100',
      '5900',
    ]);
    expect(res.body.accounts.every((a) => a.balanceKobo === 0)).toBe(true);
  });

  it('guides cannot see the books', async () => {
    const { guide } = await setup();
    expect((await guide.get('/api/ledger/accounts')).status).toBe(403);
    expect((await guide.get('/api/ledger/export.csv')).status).toBe(403);
  });
});

describe('adjustments', () => {
  it('posts a balanced correction with a reason, shown in the journal and statement', async () => {
    const { manager } = await setup();

    const res = await manager.post('/api/ledger/adjustments').send({
      account: 'PROVIDER_CLEARING',
      direction: 'debit',
      amountKobo: 150_000,
      reason: 'Opening balance from old system',
    });

    expect(res.status).toBe(201);
    expect(await balances(manager)).toMatchObject({
      PROVIDER_CLEARING: 150_000,
      ADJUSTMENTS: -150_000,
    });

    const journal = (await manager.get('/api/ledger/transactions')).body.transactions;
    expect(journal[0]).toMatchObject({
      type: 'adjustment',
      description: 'Adjustment: Opening balance from old system',
    });

    const statement = (await manager.get('/api/ledger/accounts/PROVIDER_CLEARING/statement')).body;
    expect(statement.entries.map((e) => e.runningBalanceKobo)).toEqual([150_000]);
  });

  it('a retried request with the same Idempotency-Key posts once', async () => {
    const { manager } = await setup();
    const body = {
      account: 'PROVIDER_CLEARING',
      direction: 'debit',
      amountKobo: 100_000,
      reason: 'Bank interest',
    };
    const send = () =>
      manager
        .post('/api/ledger/adjustments')
        .set('Idempotency-Key', 'adj-2026-11-17-001')
        .send(body);

    const first = await send();
    const retry = await send();

    expect(first.status).toBe(201);
    expect(retry.status).toBe(200);
    expect(retry.body.transactionId).toBe(first.body.transactionId);
    expect((await balances(manager)).PROVIDER_CLEARING).toBe(100_000); // not 200,000
  });

  it('requires a reason and a real account', async () => {
    const { manager } = await setup();
    const noReason = await manager
      .post('/api/ledger/adjustments')
      .send({ account: 'TOUR_SALES', direction: 'credit', amountKobo: 1 });
    const selfAdjust = await manager
      .post('/api/ledger/adjustments')
      .send({ account: 'ADJUSTMENTS', direction: 'credit', amountKobo: 1, reason: 'circular' });
    expect(noReason.status).toBe(400);
    expect(selfAdjust.status).toBe(400);
  });
});

describe('reversals', () => {
  it('undo a posting; doing it twice is refused', async () => {
    const { manager } = await setup();
    const { transactionId } = (
      await manager.post('/api/ledger/adjustments').send({
        account: 'TOUR_SALES',
        direction: 'credit',
        amountKobo: 500_000,
        reason: 'Typo test',
      })
    ).body;

    const undo = await manager
      .post(`/api/ledger/transactions/${transactionId}/reverse`)
      .send({ reason: 'Entered by mistake' });
    const again = await manager
      .post(`/api/ledger/transactions/${transactionId}/reverse`)
      .send({ reason: 'Entered by mistake' });

    expect(undo.status).toBe(201);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('ALREADY_REVERSED');
    expect((await balances(manager)).TOUR_SALES).toBe(0);
  });
});

describe('check and export', () => {
  it('the on-demand check passes, and the CSV downloads as a file', async () => {
    const { manager } = await setup();
    await manager.post('/api/ledger/adjustments').send({
      account: 'PROVIDER_CLEARING',
      direction: 'debit',
      amountKobo: 250_050,
      reason: 'Opening balance',
    });

    expect((await manager.get('/api/ledger/check')).body.ok).toBe(true);

    const csv = await manager.get('/api/ledger/export.csv');
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.headers['content-disposition']).toMatch(
      /attachment; filename="?ledger-\d{4}-\d{2}-\d{2}\.csv"?/,
    ); // quotes optional
    expect(csv.text).toContain('2500.50'); // ₦2,500.50 as plain decimals
  });
});

describe('tenant isolation', () => {
  it("cannot reverse another operator's transaction or see their books", async () => {
    const mine = await setup();
    const theirs = await setup();
    const { transactionId } = (
      await theirs.manager.post('/api/ledger/adjustments').send({
        account: 'TOUR_SALES',
        direction: 'credit',
        amountKobo: 1_000,
        reason: 'Theirs only',
      })
    ).body;

    expect(
      (
        await mine.manager
          .post(`/api/ledger/transactions/${transactionId}/reverse`)
          .send({ reason: 'Not mine' })
      ).status,
    ).toBe(404);
    expect((await balances(mine.manager)).TOUR_SALES).toBe(0);
  });
});
