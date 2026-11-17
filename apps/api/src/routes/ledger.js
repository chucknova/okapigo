// @ts-check
/**
 * The ledger API (PAY-22). Reading needs payments: view; changing needs payments: edit.
 * (Guides have payments: none, so the books are invisible to them.)
 *
 *   GET  /api/ledger/accounts                       balances of all 7 accounts
 *   GET  /api/ledger/accounts/:key/statement        entries + running balance (?from&to)
 *   GET  /api/ledger/transactions                   journal, newest first (?bookingId&page)
 *   GET  /api/ledger/check                          the integrity check, on demand
 *   GET  /api/ledger/export.csv                     for the accountant (?from&to)
 *   POST /api/ledger/adjustments                    manual correction (Idempotency-Key header)
 *   POST /api/ledger/transactions/:id/reverse       undo a transaction by posting its mirror
 *
 * There is no PUT/PATCH/DELETE, and there never will be: the ledger is append-only.
 */
import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  accountBalances,
  accountStatement,
  verifyLedger,
  exportLedgerCsv,
  postTransaction,
  reverseTransaction,
  LedgerActionError,
} from '@okapigo/db';
import { POSTINGS, LedgerError } from '@okapigo/shared/ledger';
import { addDays, zonedTimeToUtc } from '@okapigo/shared/time';
import {
  AdjustmentSchema,
  ReverseSchema,
  LedgerRangeQuerySchema,
  LedgerTransactionsQuerySchema,
} from '@okapigo/shared/schemas/ledger';
import { requirePermission } from '../middleware/auth.js';
import { validate, IdParamsSchema } from '../middleware/validate.js';
import { HttpError } from '../middleware/errors.js';

const PAGE_SIZE = 50;

/** @param {{ prisma: import('@prisma/client').PrismaClient }} deps */
export function ledgerRouter({ prisma }) {
  const router = Router();
  const canView = requirePermission('payments', 'view');
  const canEdit = requirePermission('payments', 'edit');

  /** @returns {import('../middleware/auth.js').AuthContext} */
  // @ts-ignore: req.auth is set by requireAuth
  const authOf = (req) => req.auth;

  /** ?from&to local dates → UTC instants [from 00:00, day after `to` 00:00). */
  function range(req) {
    const parsed = LedgerRangeQuerySchema.safeParse(req.query);
    if (!parsed.success) throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid date range.');
    const { timeZone } = authOf(req);
    return {
      from: parsed.data.from ? zonedTimeToUtc(parsed.data.from, '00:00', timeZone) : undefined,
      to: parsed.data.to
        ? zonedTimeToUtc(addDays(parsed.data.to, 1), '00:00', timeZone)
        : undefined,
    };
  }

  /** Domain errors → HTTP. */
  function toHttp(err) {
    if (err instanceof LedgerActionError)
      return new HttpError(err.code === 'NOT_FOUND' ? 404 : 409, err.code, err.message);
    if (err instanceof LedgerError) return new HttpError(400, err.code, err.message);
    return err;
  }

  router.get('/ledger/accounts', canView, async (req, res) => {
    res.json({ accounts: await accountBalances(prisma, authOf(req).operatorId) });
  });

  router.get(
    '/ledger/accounts/:key/statement',
    canView,
    validate({ params: z.object({ key: z.string().regex(/^[A-Z_]{3,40}$/) }) }),
    async (req, res) => {
      try {
        res.json(
          await accountStatement(prisma, {
            operatorId: authOf(req).operatorId,
            key: req.params.key,
            ...range(req),
          }),
        );
      } catch (err) {
        throw toHttp(err);
      }
    },
  );

  router.get('/ledger/transactions', canView, async (req, res) => {
    const query = LedgerTransactionsQuerySchema.safeParse(req.query);
    if (!query.success) throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid filters.');
    const { bookingId, page } = query.data;
    const where = {
      operatorId: authOf(req).operatorId,
      ...(bookingId && { entries: { some: { bookingId } } }),
    };
    const transactions = await prisma.ledgerTransaction.findMany({
      where,
      include: { entries: { include: { account: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    });
    res.json({
      page,
      transactions: transactions.map((t) => ({
        id: t.id,
        type: t.type,
        description: t.description,
        occurredAt: t.occurredAt,
        reversesId: t.reversesId,
        entries: t.entries.map((e) => ({
          account: e.account.key,
          accountName: e.account.name,
          debitKobo: e.debitKobo,
          creditKobo: e.creditKobo,
          bookingId: e.bookingId,
        })),
      })),
    });
  });

  router.get('/ledger/check', canView, async (req, res) => {
    res.json(await verifyLedger(prisma, { operatorId: authOf(req).operatorId }));
  });

  router.get('/ledger/export.csv', canView, async (req, res) => {
    const csv = await exportLedgerCsv(prisma, {
      operatorId: authOf(req).operatorId,
      ...range(req),
    });
    res
      .type('text/csv; charset=utf-8')
      // "attachment" makes the browser download it as a file instead of showing it.
      .attachment(`ledger-${new Date().toISOString().slice(0, 10)}.csv`)
      .send(csv);
  });

  router.post(
    '/ledger/adjustments',
    canEdit,
    validate({ body: AdjustmentSchema }),
    async (req, res) => {
      const { operatorId, userId } = authOf(req);
      // IDEMPOTENCY-KEY header: if the request is retried (a timeout on a bad connection), the
      // client sends the same key and the adjustment is posted ONCE. Without a key, every
      // request is a new adjustment.
      const clientKey = req.get('Idempotency-Key');
      if (clientKey !== undefined && !/^[A-Za-z0-9_-]{8,100}$/.test(clientKey)) {
        throw new HttpError(
          400,
          'VALIDATION_ERROR',
          'Idempotency-Key must be 8–100 letters, digits, - or _.',
        );
      }
      const { account, direction, amountKobo, reason } = req.body;
      try {
        const result = await prisma.$transaction((tx) =>
          postTransaction(tx, {
            operatorId,
            type: 'adjustment',
            idempotencyKey: `adjustment:${clientKey ?? randomUUID()}`,
            description: `Adjustment: ${reason}`,
            lines: POSTINGS.adjustment({ account, direction, kobo: amountKobo }),
            createdById: userId,
          }),
        );
        // 201 for a new transaction; 200 when an earlier request with this key already posted it.
        res.status(result.created ? 201 : 200).json(result);
      } catch (err) {
        throw toHttp(err);
      }
    },
  );

  router.post(
    '/ledger/transactions/:id/reverse',
    canEdit,
    validate({ params: IdParamsSchema, body: ReverseSchema }),
    async (req, res) => {
      const { operatorId, userId } = authOf(req);
      try {
        const result = await reverseTransaction(prisma, {
          operatorId,
          transactionId: req.params.id,
          reason: req.body.reason,
          createdById: userId,
        });
        res.status(201).json(result);
      } catch (err) {
        throw toHttp(err);
      }
    },
  );

  return router;
}
