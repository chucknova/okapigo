// @ts-check
/**
 * channel-money.js — what an OTA owes, booking by booking, and what it paid (session 17c-2:
 * "Record a payment from Sojourna").
 *
 * An OTA collects its guests' money and owes the business the price less its commission
 * (17b). For each of its bookings:
 *
 *   owed = the sale's net − each refund's net − what its payments already paid off
 *
 * at the commission frozen at the sale. A payment from the OTA pays off its OLDEST bookings
 * first (by when they were confirmed): the order an OTA's statement lists them, and the order
 * an owner would tick them off by hand.
 *
 *   owedFor(cb)              one booking: what's still owed for it (negative: we owe it back,
 *                            a refund after it was paid)
 *   recordChannelPayment()   a payment: its bookings paid off, and the ledger (Dr Bank /
 *                            Cr Owed by OTAs)
 */
import { percentOf } from '@okapigo/shared/pricing';
import { POSTINGS } from '@okapigo/shared/ledger';
import { formatNaira } from '@okapigo/shared/money';
import { postTransaction } from './ledger.js';

export class ChannelPaymentError extends Error {
  /** @param {'MORE_THAN_OWED' | 'NOT_FOUND'} code @param {string} message */
  constructor(code, message) {
    super(message);
    this.name = 'ChannelPaymentError';
    this.code = code;
  }
}

/** What a channel booking needs for its money. */
export const WITH_MONEY = {
  booking: { include: { payments: true, refunds: true } },
  allocations: true,
};

/**
 * What's still owed for one OTA booking.
 * @param {{ commissionBasisPoints: number, booking: { payments: any[], refunds: any[] }, allocations?: Array<{ amountKobo: number }> }} cb
 */
export function owedFor(cb) {
  const bp = cb.commissionBasisPoints;
  let owed = 0;
  for (const p of cb.booking.payments) {
    if (p.provider === 'ota' && p.status === 'succeeded')
      owed += p.amountKobo - percentOf(p.amountKobo, bp);
  }
  for (const r of cb.booking.refunds) {
    if (r.provider === 'ota' && r.status === 'processed')
      owed -= r.amountKobo - percentOf(r.amountKobo, bp);
  }
  for (const a of cb.allocations ?? []) owed -= a.amountKobo;
  return owed;
}

/**
 * Records money an OTA paid: which bookings it paid off (oldest first), and the ledger.
 * Refused when it's more than the OTA owes (a typo, most likely: nothing to pay off).
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{
 *   operatorId: string,
 *   channelId: string,
 *   amountKobo: number,
 *   receivedOn: string,       "2026-12-03"
 *   reference?: string | null,
 *   recordedById?: string | null,
 * }} p
 */
export async function recordChannelPayment(prisma, p) {
  return prisma.$transaction(
    async (tx) => {
      // One payment at a time per channel: two at once could pay off the same booking twice.
      const locked = await tx.$queryRaw`
        SELECT id, name FROM channels
         WHERE id = ${p.channelId}::uuid AND operator_id = ${p.operatorId}::uuid
         FOR UPDATE`;
      const channel = /** @type {Array<{ id: string, name: string }>} */ (locked)[0];
      if (!channel) throw new ChannelPaymentError('NOT_FOUND', 'Channel not found.');

      const bookings = await tx.channelBooking.findMany({
        where: { channelId: channel.id, confirmedAt: { not: null } },
        include: WITH_MONEY,
        orderBy: [{ confirmedAt: 'asc' }, { id: 'asc' }],
      });
      const owing = bookings.map((cb) => ({ cb, owed: owedFor(cb) })).filter((x) => x.owed > 0);
      const total = bookings.reduce((n, cb) => n + owedFor(cb), 0);
      if (p.amountKobo > total) {
        throw new ChannelPaymentError(
          'MORE_THAN_OWED',
          total > 0
            ? `${channel.name} owes ${formatNaira(total)}: record up to that.`
            : `${channel.name} owes nothing right now.`,
        );
      }

      const payment = await tx.channelPayment.create({
        data: {
          operatorId: p.operatorId,
          channelId: channel.id,
          amountKobo: p.amountKobo,
          receivedOn: new Date(`${p.receivedOn}T00:00:00Z`),
          reference: p.reference ?? null,
          recordedById: p.recordedById ?? null,
        },
      });
      let left = p.amountKobo;
      const allocations = [];
      for (const { cb, owed } of owing) {
        if (left === 0) break;
        const part = Math.min(owed, left);
        allocations.push({ paymentId: payment.id, channelBookingId: cb.id, amountKobo: part });
        left -= part;
      }
      await tx.channelPaymentAllocation.createMany({ data: allocations });
      await postTransaction(tx, {
        operatorId: p.operatorId,
        type: 'ota_payment',
        idempotencyKey: `ota-payment:${payment.id}`,
        description: `${channel.name} paid ${formatNaira(p.amountKobo)}${
          p.reference ? ` (${p.reference})` : ''
        }`,
        lines: POSTINGS.otaPayment(p.amountKobo),
        occurredAt: payment.receivedOn,
        createdById: p.recordedById ?? null,
      });
      return { payment, allocations };
    },
    { isolationLevel: 'ReadCommitted' },
  );
}
