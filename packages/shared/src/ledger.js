// @ts-check
/**
 * ledger.js — the chart of accounts and the POSTING RULES of the double-entry ledger (PAY-22).
 *
 * Double-entry in one sentence: every money event is a TRANSACTION of two or more ENTRIES,
 * and the debits always equal the credits. Money is never created or lost, only moved
 * between accounts, so the books always balance and every naira can be traced.
 *
 * DEBIT vs CREDIT is just "left column vs right column". Which one INCREASES an account
 * depends on its type:
 *   asset, expense            increase with a DEBIT   ("normal debit balance")
 *   liability, equity, revenue increase with a CREDIT ("normal credit balance")
 *   contra-revenue (refunds)  a revenue account that increases with a DEBIT, so refunds
 *                             reduce sales without erasing the original sale
 *
 * This file is PURE (no database): it says WHICH entries each kind of event produces.
 * packages/db/src/ledger.js writes them, and the database refuses anything unbalanced.
 */

/** The accounts every operator gets. Codes follow the usual 1xxx assets … 5xxx expenses. */
export const ACCOUNTS = /** @type {const} */ ({
  PROVIDER_CLEARING: { code: '1100', name: 'Paystack clearing', type: 'asset', normal: 'debit' },
  REFUNDS_PAYABLE: { code: '2100', name: 'Refunds payable', type: 'liability', normal: 'credit' },
  UNALLOCATED_RECEIPTS: {
    code: '2200',
    name: 'Unallocated receipts',
    type: 'liability',
    normal: 'credit',
  },
  TOUR_SALES: { code: '4000', name: 'Tour sales', type: 'revenue', normal: 'credit' },
  SALES_REFUNDS: { code: '4100', name: 'Sales refunds', type: 'revenue', normal: 'debit' },
  PAYMENT_FEES: { code: '5100', name: 'Payment fees', type: 'expense', normal: 'debit' },
  ADJUSTMENTS: { code: '5900', name: 'Adjustments', type: 'expense', normal: 'debit' },
});

/** @typedef {keyof typeof ACCOUNTS} AccountKey */
/** @typedef {{ account: AccountKey, debitKobo: number, creditKobo: number }} Line */

/** Thrown when lines can't form a valid transaction. */
export class LedgerError extends Error {
  /** @param {string} code @param {string} message */
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/** @param {AccountKey} account @param {number} kobo @returns {Line} */
const debit = (account, kobo) => ({ account, debitKobo: kobo, creditKobo: 0 });
/** @param {AccountKey} account @param {number} kobo @returns {Line} */
const credit = (account, kobo) => ({ account, debitKobo: 0, creditKobo: kobo });

/** @param {number} kobo */
function assertAmount(kobo) {
  if (!Number.isSafeInteger(kobo) || kobo <= 0) {
    throw new LedgerError(
      'INVALID_AMOUNT',
      `Ledger amounts must be whole kobo above zero, got ${kobo}.`,
    );
  }
}

/**
 * The posting rules: one function per kind of money event. Each returns balanced lines.
 * The comment on each is the "journal entry" an accountant would write.
 */
export const POSTINGS = {
  /** A guest paid us.            Dr Paystack clearing / Cr Tour sales */
  paymentReceived(/** @type {number} */ kobo) {
    assertAmount(kobo);
    return [debit('PROVIDER_CLEARING', kobo), credit('TOUR_SALES', kobo)];
  },

  /** Paystack took its fee.      Dr Payment fees / Cr Paystack clearing */
  paymentFee(/** @type {number} */ kobo) {
    assertAmount(kobo);
    return [debit('PAYMENT_FEES', kobo), credit('PROVIDER_CLEARING', kobo)];
  },

  /** A cancellation means we OWE the guest money (not paid yet).
   *                               Dr Sales refunds / Cr Refunds payable */
  refundOwed(/** @type {number} */ kobo) {
    assertAmount(kobo);
    return [debit('SALES_REFUNDS', kobo), credit('REFUNDS_PAYABLE', kobo)];
  },

  /** We paid that refund out.    Dr Refunds payable / Cr Paystack clearing */
  refundPaid(/** @type {number} */ kobo) {
    assertAmount(kobo);
    return [debit('REFUNDS_PAYABLE', kobo), credit('PROVIDER_CLEARING', kobo)];
  },

  /** Money arrived we can't match to a booking yet (a bank transfer, stage 10d).
   *                               Dr Paystack clearing / Cr Unallocated receipts */
  unallocatedReceipt(/** @type {number} */ kobo) {
    assertAmount(kobo);
    return [debit('PROVIDER_CLEARING', kobo), credit('UNALLOCATED_RECEIPTS', kobo)];
  },

  /** Staff matched it to a booking. Dr Unallocated receipts / Cr Tour sales */
  receiptAllocated(/** @type {number} */ kobo) {
    assertAmount(kobo);
    return [debit('UNALLOCATED_RECEIPTS', kobo), credit('TOUR_SALES', kobo)];
  },

  /**
   * A manual correction between Adjustments and another account, in either direction.
   * `direction: 'debit'` means the OTHER account is debited (Adjustments credited).
   * @param {{ account: AccountKey, direction: 'debit' | 'credit', kobo: number }} input
   */
  adjustment({ account, direction, kobo }) {
    assertAmount(kobo);
    if (account === 'ADJUSTMENTS')
      throw new LedgerError('INVALID_ACCOUNT', 'Adjust a different account against Adjustments.');
    return direction === 'debit'
      ? [debit(account, kobo), credit('ADJUSTMENTS', kobo)]
      : [debit('ADJUSTMENTS', kobo), credit(account, kobo)];
  },
};

/**
 * Checks lines form a valid transaction: at least two lines, each line one-sided and
 * positive, known accounts, and total debits = total credits.
 * @param {Line[]} lines
 */
export function assertBalanced(lines) {
  if (lines.length < 2)
    throw new LedgerError('TOO_FEW_LINES', 'A transaction needs at least two entries.');
  let debits = 0;
  let credits = 0;
  for (const line of lines) {
    if (!(line.account in ACCOUNTS))
      throw new LedgerError('INVALID_ACCOUNT', `Unknown account ${line.account}.`);
    const oneSided =
      (line.debitKobo > 0 && line.creditKobo === 0) ||
      (line.creditKobo > 0 && line.debitKobo === 0);
    if (
      !oneSided ||
      !Number.isSafeInteger(line.debitKobo) ||
      !Number.isSafeInteger(line.creditKobo)
    ) {
      throw new LedgerError(
        'INVALID_LINE',
        'Each entry is either a debit or a credit, in whole kobo above zero.',
      );
    }
    debits += line.debitKobo;
    credits += line.creditKobo;
  }
  if (debits !== credits) {
    throw new LedgerError('UNBALANCED', `Debits (${debits}) must equal credits (${credits}).`);
  }
}

/**
 * The lines that exactly undo a transaction: every debit becomes a credit and vice versa.
 * This is how mistakes are corrected in an append-only ledger: never edit, always reverse.
 * @param {Line[]} lines
 * @returns {Line[]}
 */
export function reverseLines(lines) {
  return lines.map((l) => ({
    account: l.account,
    debitKobo: l.creditKobo,
    creditKobo: l.debitKobo,
  }));
}

/**
 * An account's balance on its NORMAL side: positive means "the usual direction".
 *   Paystack clearing (normal debit): debits ₦100, credits ₦30 → balance ₦70
 *   Tour sales (normal credit):       credits ₦100           → balance ₦100
 * @param {'debit' | 'credit'} normal
 * @param {number} debits
 * @param {number} credits
 */
export function normalBalance(normal, debits, credits) {
  return normal === 'debit' ? debits - credits : credits - debits;
}
