// @ts-check
/**
 * companion.js — the AI trip companion (GST-16, stage 18a; flow brief 09).
 *
 *   askCompanion     a guest's question on their trip page → an answer, or "passed to the team"
 *   companionState   what the trip page shows: available or not, questions left today,
 *                    suggestions, and the conversation so far
 *
 * One question, step by step:
 *
 *   1. the booking must still have a trip to ask about           else COMPANION_CLOSED
 *   2. at most 20 questions per booking per (Lagos) day          else COMPANION_LIMIT
 *   3. a KEPT ANSWER for the same question about the same tour   → answered, free
 *   4. this month's spend under the cap (AI_MONTHLY_CAP_USD)     else COMPANION_UNAVAILABLE
 *   5. ask the model (packages/ai), with the business's own facts only
 *        answered  → kept for the next guest, unless it used this booking's details
 *        unsure    → the question becomes an inbox request (kind "question") at once
 *                    (decided 2026-11-22), unless the guest already has 3 waiting
 *
 * Every question is a row (companion_messages): the trip page's conversation, the day's
 * count and the month's spend come from those rows. The model call happens OUTSIDE any
 * transaction (it takes seconds), so two questions sent at the same instant could both pass
 * the day's count: at most a question over, which is harmless.
 */
import { createHash } from 'node:crypto';
import {
  COMPANION_LIMITS,
  COMPANION_VERSION,
  companionFacts,
  companionInstructions,
  companionSuggestions,
  questionKey,
} from '@okapigo/shared/companion';
import { localDate, zonedTimeToUtc } from '@okapigo/shared/time';
import { BookingError } from './booking-lifecycle.js';
import { createGuestRequest } from './guest-requests.js';

/** A trip to ask about: booked, or just finished (lost property, "what was that dish?"). */
const ASKABLE = ['confirmed', 'part_paid', 'paid', 'amended', 'completed'];

/** What the companion needs of a booking. */
const INCLUDE = {
  product: { include: { operator: true } },
  departure: true,
  travellers: { orderBy: { position: /** @type {const} */ ('asc') } },
  policyVersion: true,
  channelBooking: { select: { channel: { select: { name: true } } } },
};

/**
 * The trip page's view of one question. A handed-over one carries the team's reply once
 * there is one (designs: "Reply from Ìrìn · Tunde · Sun 22 Nov, 17:05"), with the replier's
 * first name only.
 * @param {any} m  with guestRequest, when loaded
 * @param {Map<string, string>} [names]  user id → name
 */
const messageView = (m, names = new Map()) => {
  const r = m.guestRequest;
  return {
    id: m.id,
    question: m.question,
    answer: m.answer,
    outcome: m.outcome,
    source: m.source,
    createdAt: m.createdAt,
    reply: r?.reply // set with repliedAt, always (replyGuestRequest)
      ? {
          text: r.reply,
          at: r.repliedAt,
          by: (names.get(r.repliedById) ?? '').split(/\s+/)[0] || null,
        }
      : null,
  };
};

/**
 * When the business's "today" began, as an instant (questions per day are per Lagos day).
 * @param {Date} now @param {string} timeZone
 */
const startOfLocalDay = (now, timeZone) =>
  zonedTimeToUtc(localDate(now, timeZone), '00:00', timeZone);

/** The first instant of this calendar month (UTC): the spend cap's month. @param {Date} now */
const startOfMonth = (now) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

/**
 * Spent on the model this month, across every business (it's one key, one bill).
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {Date} now
 */
export async function companionSpendThisMonth(prisma, now = new Date()) {
  const r = await prisma.companionMessage.aggregate({
    where: { createdAt: { gte: startOfMonth(now) } },
    _sum: { costMicroUsd: true },
  });
  return r._sum.costMicroUsd ?? 0;
}

/**
 * The key a kept answer is filed under: the rules' version, the model, the business's rules
 * and the tour's facts (not this booking's). Edit the tour's notes and every old answer
 * stops matching, so a guest never gets an answer from notes that have changed.
 * @param {string} model @param {string} instructions @param {import('@okapigo/shared/companion').Fact[]} facts
 */
export function factsKey(model, instructions, facts) {
  const shared = facts.filter((f) => !f.personal);
  return createHash('sha256')
    .update(JSON.stringify([COMPANION_VERSION, model, instructions, shared]))
    .digest('hex');
}

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {string} bookingId
 */
async function loadBooking(prisma, bookingId) {
  const b = await prisma.booking.findUnique({ where: { id: bookingId }, include: INCLUDE });
  if (!b) throw new BookingError('NOT_FOUND', 'Booking not found.');
  return b;
}

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{ model: string, answer: (input: { instructions: string, facts: any[], question: string }) => Promise<any> }} ai  an AiProvider (packages/ai)
 * @param {{ bookingId: string, question: string, monthlyCapMicroUsd: number, now?: Date }} input
 */
export async function askCompanion(
  prisma,
  ai,
  { bookingId, question, monthlyCapMicroUsd, now = new Date() },
) {
  const words = question.trim();
  if (!words) throw new BookingError('EMPTY_QUESTION', 'Write your question first.');
  if (words.length > COMPANION_LIMITS.questionMaxLength) {
    throw new BookingError('QUESTION_TOO_LONG', 'Please keep your question shorter.');
  }
  const b = await loadBooking(prisma, bookingId);
  const op = b.product.operator;
  if (!ASKABLE.includes(b.status)) {
    throw new BookingError('COMPANION_CLOSED', 'Questions aren’t open for this booking.');
  }
  const today = await prisma.companionMessage.count({
    where: { bookingId, createdAt: { gte: startOfLocalDay(now, op.timeZone) } },
  });
  if (today >= COMPANION_LIMITS.perBookingPerDay) {
    throw new BookingError('COMPANION_LIMIT', 'That’s all the questions for today.');
  }

  const instructions = companionInstructions(op.name);
  const facts = companionFacts(b);
  const key = {
    productId: b.productId,
    questionKey: questionKey(words),
    factsKey: factsKey(ai.model, instructions, facts),
  };
  const base = {
    operatorId: b.operatorId,
    bookingId,
    question: words,
    model: ai.model,
    createdAt: now,
  };

  // A kept answer: the same question about the same tour, from the same notes.
  const kept = await prisma.companionAnswer.findUnique({
    where: { productId_questionKey_factsKey: key },
  });
  if (kept) {
    await prisma.companionAnswer.update({
      where: { id: kept.id },
      data: { hits: { increment: 1 } },
    });
    const m = await prisma.companionMessage.create({
      data: {
        ...base,
        answer: kept.answer,
        source: kept.source,
        outcome: 'answered',
        cached: true,
      },
    });
    return { message: messageView(m), left: COMPANION_LIMITS.perBookingPerDay - today - 1 };
  }

  if ((await companionSpendThisMonth(prisma, now)) >= monthlyCapMicroUsd) {
    throw new BookingError('COMPANION_UNAVAILABLE', 'The assistant isn’t available right now.');
  }
  let reply;
  try {
    reply = await ai.answer({ instructions, facts, question: words });
  } catch (err) {
    if (/** @type {any} */ (err)?.name === 'AiUnavailableError') {
      throw new BookingError('COMPANION_UNAVAILABLE', 'The assistant isn’t available right now.');
    }
    throw err;
  }
  const spent = {
    inputTokens: reply.usage.inputTokens,
    outputTokens: reply.usage.outputTokens,
    costMicroUsd: reply.usage.costMicroUsd,
  };

  if (reply.status === 'answered') {
    const m = await prisma.companionMessage.create({
      data: { ...base, ...spent, answer: reply.answer, source: reply.source, outcome: 'answered' },
    });
    // Kept for the next guest, unless it used THIS booking's details (their date, names…).
    if (!reply.usesBookingDetails) {
      await prisma.companionAnswer.createMany({
        data: [{ ...key, answer: reply.answer, source: reply.source }],
        skipDuplicates: true, // two guests asking at once: the first one's is kept
      });
    }
    return { message: messageView(m), left: COMPANION_LIMITS.perBookingPerDay - today - 1 };
  }

  // Not sure: the team answers, by WhatsApp or email and on the trip page (12f-2, 16d-2).
  let request = null;
  try {
    request = await createGuestRequest(prisma, { bookingId, kind: 'question', message: words });
  } catch (err) {
    // Three requests already waiting, or a finished trip: nothing is sent; the page says
    // to message the business instead.
    if (!(err instanceof BookingError)) throw err;
  }
  const m = await prisma.companionMessage.create({
    data: {
      ...base,
      ...spent,
      outcome: request ? 'handed_over' : 'unsure',
      guestRequestId: request?.id ?? null,
    },
  });
  return { message: messageView(m), left: COMPANION_LIMITS.perBookingPerDay - today - 1 };
}

/**
 * What the trip page's "Ask a question" card shows.
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{ bookingId: string, monthlyCapMicroUsd: number, now?: Date }} input
 */
export async function companionState(prisma, { bookingId, monthlyCapMicroUsd, now = new Date() }) {
  const b = await loadBooking(prisma, bookingId);
  const op = b.product.operator;
  const messages = await prisma.companionMessage.findMany({
    where: { bookingId },
    orderBy: { createdAt: 'asc' },
    take: 100,
    include: { guestRequest: true },
  });
  const ids = [
    ...new Set(messages.map((m) => m.guestRequest?.repliedById).filter((x) => x != null)),
  ];
  const names = new Map(
    (
      await prisma.user.findMany({
        where: { operatorId: b.operatorId, id: { in: /** @type {string[]} */ (ids) } },
        select: { id: true, name: true },
      })
    ).map((u) => [u.id, u.name]),
  );
  const today = messages.filter((m) => m.createdAt >= startOfLocalDay(now, op.timeZone)).length;
  const left = Math.max(0, COMPANION_LIMITS.perBookingPerDay - today);
  /** @type {'closed' | 'limit' | 'paused' | null} */
  const reason = !ASKABLE.includes(b.status)
    ? 'closed'
    : left === 0
      ? 'limit'
      : (await companionSpendThisMonth(prisma, now)) >= monthlyCapMicroUsd
        ? 'paused'
        : null;
  return {
    available: reason === null,
    reason,
    left,
    suggestions: companionSuggestions(/** @type {any} */ (b.product.faqs)),
    messages: messages.map((m) => messageView(m, names)),
  };
}
