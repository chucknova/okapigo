/**
 * Posting rules of the double-entry ledger (PAY-22).
 */
import { describe, it, expect } from 'vitest';
import { ACCOUNTS, POSTINGS, assertBalanced, reverseLines, normalBalance } from '../src/ledger.js';

/** Totals per account after applying transactions: { PROVIDER_CLEARING: balance, … } */
function balances(transactions) {
  const totals = {};
  for (const lines of transactions) {
    for (const l of lines) {
      totals[l.account] ??= { debits: 0, credits: 0 };
      totals[l.account].debits += l.debitKobo;
      totals[l.account].credits += l.creditKobo;
    }
  }
  return Object.fromEntries(
    Object.entries(totals).map(([k, t]) => [
      k,
      normalBalance(ACCOUNTS[k].normal, t.debits, t.credits),
    ]),
  );
}

describe('posting rules', () => {
  it.each(Object.keys(POSTINGS).filter((k) => k !== 'adjustment'))('%s is balanced', (name) => {
    expect(() => assertBalanced(POSTINGS[name](12_500_00))).not.toThrow();
  });

  it('an OTA’s sale and refund (17b): owed the net, its commission an expense, handed back pro rata', () => {
    // ₦40,000 sold, the OTA keeps 20%.
    expect(POSTINGS.otaSale(4_000_000, 800_000)).toEqual([
      { account: 'OTA_RECEIVABLE', debitKobo: 3_200_000, creditKobo: 0 },
      { account: 'OTA_COMMISSION', debitKobo: 800_000, creditKobo: 0 },
      { account: 'TOUR_SALES', debitKobo: 0, creditKobo: 4_000_000 },
    ]);
    // Half refunded: it owes ₦16,000 less and hands back ₦4,000 of commission.
    expect(POSTINGS.otaRefund(2_000_000, 400_000)).toEqual([
      { account: 'REFUNDS_PAYABLE', debitKobo: 2_000_000, creditKobo: 0 },
      { account: 'OTA_RECEIVABLE', debitKobo: 0, creditKobo: 1_600_000 },
      { account: 'OTA_COMMISSION', debitKobo: 0, creditKobo: 400_000 },
    ]);
    // An OTA that keeps everything (or nothing): one line fewer, still balanced.
    expect(POSTINGS.otaSale(100, 100).map((l) => l.account)).toEqual([
      'OTA_COMMISSION',
      'TOUR_SALES',
    ]);
    expect(POSTINGS.otaSale(100).map((l) => l.account)).toEqual(['OTA_RECEIVABLE', 'TOUR_SALES']);
    expect(POSTINGS.otaRefund(100, 100).map((l) => l.account)).toEqual([
      'REFUNDS_PAYABLE',
      'OTA_COMMISSION',
    ]);
    for (const bad of [-1, 101, 1.5]) {
      expect(() => POSTINGS.otaSale(100, bad)).toThrow('A commission must be 0 to the price');
      expect(() => POSTINGS.otaRefund(100, bad)).toThrow('A commission must be 0 to the refund');
    }
  });

  it('an OTA pays what it owes (17c-2): into the bank, off what OTAs owe', () => {
    expect(POSTINGS.otaPayment(32_960_000)).toEqual([
      { account: 'BANK', debitKobo: 32_960_000, creditKobo: 0 },
      { account: 'OTA_RECEIVABLE', debitKobo: 0, creditKobo: 32_960_000 },
    ]);
    expect(() => POSTINGS.otaPayment(0)).toThrow();
  });

  it('a full story: paid ₦50,000, fee ₦750, cancelled with ₦25,000 owed, then refunded', () => {
    const story = [
      POSTINGS.paymentReceived(5_000_000),
      POSTINGS.paymentFee(75_000),
      POSTINGS.refundOwed(2_500_000),
      POSTINGS.refundPaid(2_500_000),
    ];

    expect(balances(story)).toEqual({
      PROVIDER_CLEARING: 2_425_000, // ₦50,000 − ₦750 fee − ₦25,000 refund
      TOUR_SALES: 5_000_000, // the original sale is still visible…
      SALES_REFUNDS: 2_500_000, // …next to what was given back
      PAYMENT_FEES: 75_000,
      REFUNDS_PAYABLE: 0, // owed, then paid: nothing outstanding
    });
  });

  it('an owed refund shows up as a liability until it is paid', () => {
    expect(
      balances([POSTINGS.paymentReceived(1_000_000), POSTINGS.refundOwed(400_000)]).REFUNDS_PAYABLE,
    ).toBe(400_000);
  });

  it('adjustments move money between Adjustments and one other account', () => {
    const lines = POSTINGS.adjustment({
      account: 'PROVIDER_CLEARING',
      direction: 'credit',
      kobo: 10_000,
    });
    expect(lines).toEqual([
      { account: 'ADJUSTMENTS', debitKobo: 10_000, creditKobo: 0 },
      { account: 'PROVIDER_CLEARING', debitKobo: 0, creditKobo: 10_000 },
    ]);
  });

  it('refuses zero, negative and fractional amounts', () => {
    for (const bad of [0, -100, 10.5]) {
      expect(() => POSTINGS.paymentReceived(bad)).toThrow(/whole kobo/);
    }
  });
});

describe('assertBalanced', () => {
  it.each([
    [
      'unbalanced',
      [
        { account: 'PROVIDER_CLEARING', debitKobo: 100, creditKobo: 0 },
        { account: 'TOUR_SALES', debitKobo: 0, creditKobo: 90 },
      ],
      'UNBALANCED',
    ],
    [
      'a single line',
      [{ account: 'PROVIDER_CLEARING', debitKobo: 100, creditKobo: 0 }],
      'TOO_FEW_LINES',
    ],
    [
      'a two-sided line',
      [
        { account: 'PROVIDER_CLEARING', debitKobo: 100, creditKobo: 100 },
        { account: 'TOUR_SALES', debitKobo: 0, creditKobo: 0 },
      ],
      'INVALID_LINE',
    ],
    [
      'an unknown account',
      [
        { account: 'PETTY_CASH', debitKobo: 100, creditKobo: 0 },
        { account: 'TOUR_SALES', debitKobo: 0, creditKobo: 100 },
      ],
      'INVALID_ACCOUNT',
    ],
  ])('rejects %s', (_label, lines, code) => {
    expect(() => assertBalanced(lines)).toThrow(expect.objectContaining({ code }));
  });
});

describe('reversals', () => {
  it('a transaction plus its reversal leaves every account at zero', () => {
    const original = POSTINGS.paymentReceived(3_500_000);
    const result = balances([original, reverseLines(original)]);
    expect(Object.values(result).every((b) => b === 0)).toBe(true);
  });
});

describe('for ANY sequence of events', () => {
  it('500 random histories: debits always equal credits, and the accounting equation holds', () => {
    let seed = 99;
    const rand = (n) => (seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648) % n;
    const kinds = [
      'paymentReceived',
      'paymentFee',
      'refundOwed',
      'refundPaid',
      'unallocatedReceipt',
      'receiptAllocated',
      'receiptRefunded',
    ];

    for (let i = 0; i < 500; i++) {
      const history = Array.from({ length: 1 + rand(20) }, () =>
        POSTINGS[kinds[rand(kinds.length)]](1 + rand(10_000_000)),
      );
      const all = history.flat();
      const debits = all.reduce((s, l) => s + l.debitKobo, 0);
      const credits = all.reduce((s, l) => s + l.creditKobo, 0);
      expect(debits).toBe(credits);

      // Assets = Liabilities + (Revenue − Contra-revenue − Expenses), the accounting equation.
      const b = balances(history);
      const v = (k) => b[k] ?? 0;
      const assets = v('PROVIDER_CLEARING');
      const liabilities = v('REFUNDS_PAYABLE') + v('UNALLOCATED_RECEIPTS');
      const profit = v('TOUR_SALES') - v('SALES_REFUNDS') - v('PAYMENT_FEES') - v('ADJUSTMENTS');
      expect(assets).toBe(liabilities + profit);
    }
  });
});
