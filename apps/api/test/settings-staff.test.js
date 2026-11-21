/**
 * Stage 16e-3: what Settings › Staff and roles needs from the server.
 *   - everyone, with how they stand in words: Active · synced 07:31 · Invited · No access
 *   - inviting: emailed (when this server has email), or the words to copy; sent again
 *   - editing: the name, how they sign in, the role; never your own role or access
 *   - at least one owner, always
 *   - removing: signed out at once, off their coming departures (which are listed), their
 *     chats back to "Needs a person", and what their phone had waiting, said beforehand
 */
import { describe, it, expect, afterAll, afterEach, vi } from 'vitest';
import request from 'supertest';
import { randomInt } from 'node:crypto';
import { createTestContext, buildApp } from './helpers.js';
import { localDate } from '@okapigo/shared/time';

const ctx = createTestContext();
afterEach(() => ctx.cleanup());
afterAll(() => ctx.close());
vi.setConfig({ testTimeout: 60_000, hookTimeout: 30_000 });

/** A pretend mailbox: what was sent, or a failure. */
function fakeMailer(fail = false) {
  /** @type {any[]} */
  const sent = [];
  return {
    sent,
    mailer: {
      name: 'fake',
      send: async (/** @type {any} */ e) => {
        if (fail) throw new Error('MAILPIT_DOWN: the local mailbox isn’t running');
        sent.push(e);
        return { id: String(sent.length) };
      },
    },
  };
}

/** @param {any} app @param {string} token */
const as = (app, token) => ({
  get: (/** @type {string} */ url) => request(app).get(url).set('Authorization', `Bearer ${token}`),
  post: (/** @type {string} */ url) =>
    request(app).post(url).set('Authorization', `Bearer ${token}`),
  patch: (/** @type {string} */ url) =>
    request(app).patch(url).set('Authorization', `Bearer ${token}`),
});

async function setup(mailer = /** @type {any} */ (null)) {
  const s = await ctx.seedOperator();
  const app = buildApp({ prisma: ctx.prisma, mailer, emailFrom: 'team@okapigo.example' });
  const api = as(app, await ctx.tokenFor(s.owner.id)); // the owner, signed in
  const roles = Object.fromEntries(
    (await ctx.prisma.role.findMany({ where: { operatorId: s.operator.id } })).map((r) => [
      r.key,
      r,
    ]),
  );
  return { ...s, app, api, roles };
}

/** A fresh, unused phone ("0809 …"), for someone new. */
const aPhone = () => `0809${String(randomInt(10 ** 6, 10 ** 7))}`;

describe('everyone, in words', () => {
  it('active (synced), invited, no access; their coming departures', async () => {
    const s = await setup();
    const [guide, other] = s.guides;
    await ctx.tokenFor(guide.id); // has signed in
    await ctx.prisma.user.update({
      where: { id: guide.id },
      data: { lastSyncedAt: new Date(), outboxWaiting: 3 },
    });
    await ctx.prisma.user.update({ where: { id: s.manager.id }, data: { isActive: false } });
    const d = await ctx.prisma.departure.findFirstOrThrow({
      where: { operatorId: s.operator.id, startsAt: { gt: new Date(Date.now() + 3 * 86_400_000) } },
      include: { product: true },
      orderBy: { startsAt: 'asc' },
    });
    await ctx.prisma.departure.update({ where: { id: d.id }, data: { guideId: guide.id } });

    // A cancelled one isn't theirs to guide any more.
    const off = await ctx.prisma.departure.findFirstOrThrow({
      where: { operatorId: s.operator.id, startsAt: { gt: new Date(Date.now() + 9 * 86_400_000) } },
      orderBy: { startsAt: 'asc' },
    });
    await ctx.prisma.departure.update({
      where: { id: off.id },
      data: { guideId: guide.id, status: 'cancelled' },
    });
    // The other guide: synced, nothing waiting; one departure in a minute (today, mostly).
    await ctx.tokenFor(other.id);
    await ctx.prisma.user.update({
      where: { id: other.id },
      data: { lastSyncedAt: new Date(), outboxWaiting: 0 },
    });
    const soonAt = new Date(Date.now() + 60_000);
    const later = await ctx.prisma.departure.findFirstOrThrow({
      where: {
        operatorId: s.operator.id,
        startsAt: { gt: new Date(Date.now() + 20 * 86_400_000) },
      },
      orderBy: { startsAt: 'desc' },
    });
    await ctx.prisma.departure.update({
      where: { id: later.id },
      data: { startsAt: soonAt, endsAt: new Date(soonAt.getTime() + 3_600_000), guideId: other.id },
    });

    const res = await s.api.get('/api/staff');
    expect(res.body.you).toBe(s.owner.id);
    const row = (/** @type {string} */ id) =>
      res.body.staff.find((/** @type {any} */ u) => u.id === id);
    expect(row(s.owner.id)).toMatchObject({ status: 'active', statusText: 'Active' });
    expect(row(guide.id)).toMatchObject({
      status: 'active',
      statusText: expect.stringMatching(/^Active · synced \d\d:\d\d$/),
      waiting: expect.stringMatching(
        /^3 changes waiting on their phone at its last sync \(\d\d:\d\d\)$/,
      ),
      upcoming: [
        {
          id: d.id,
          text: expect.stringMatching(
            new RegExp(
              `^${d.product.shortTitle ?? d.product.title} · \\w{3} \\d{1,2} \\w{3}, \\d\\d:\\d\\d$`,
            ),
          ),
        },
      ],
    });
    expect(row(other.id)).toMatchObject({ status: 'active', waiting: null });
    const sameDay = localDate(soonAt, 'Africa/Lagos') === localDate(new Date(), 'Africa/Lagos');
    expect(row(other.id).upcoming).toEqual([
      { id: later.id, text: expect.stringMatching(sameDay ? / \(today\)$/ : /\d\d:\d\d$/) },
    ]);
    // Someone added, not yet signed in.
    const added = await s.api
      .post('/api/staff')
      .send({ name: 'Dayo Ogunleye', contact: aPhone(), roleId: s.roles.guide.id });
    expect(added.body.user).toMatchObject({
      status: 'invited',
      statusText: 'Invited · hasn’t signed in',
      waiting: null,
      upcoming: [],
    });
    expect(row(s.manager.id)).toMatchObject({ status: 'removed', statusText: 'No access' });
    // How they sign in, as people write it.
    expect(row(s.owner.id).contact).toBe(s.owner.email);
  });
});

describe('inviting', () => {
  it('by email: the invitation is emailed, names kept as text', async () => {
    const box = fakeMailer();
    const s = await setup(box.mailer);
    const res = await s.api.post('/api/staff').send({
      name: 'Amaka <b>Obi</b>',
      contact: `amaka.${randomInt(10 ** 6)}@example.com`,
      roleId: s.roles.guide.id,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.user).toMatchObject({ status: 'invited', role: { key: 'guide' } });
    expect(res.body.invite).toMatchObject({ how: 'email', problem: null });
    expect(res.body.invite.words).toBe(
      `Hi Amaka, Adaeze has added you to ${s.operator.name} on OkapiGo as a guide.\n\nOpen http://localhost:4000/app/ on your phone and sign in with ${res.body.user.email}. We’ll send you a code.`,
    );
    expect(box.sent).toHaveLength(1);
    const e = box.sent[0];
    expect(e.to.email).toBe(res.body.user.email);
    expect(e.from).toEqual({ name: s.operator.name, email: 'team@okapigo.example' });
    expect(e.replyTo).toBe(s.owner.email);
    expect(e.subject).toBe(`Join ${s.operator.name} on OkapiGo`);
    expect(e.html).toContain('Hi Amaka,');
    expect(e.html).not.toContain('<b>Obi');
    expect(e.html).toContain('href="http://localhost:4000/app/"');
    expect(e.text).toBe(res.body.invite.words);

    // Sent again ("Resend").
    const again = await s.api.post(`/api/staff/${res.body.user.id}/invite`);
    expect(again.body.invite.how).toBe('email');
    expect(box.sent).toHaveLength(2);
  });

  it('by phone: words to copy; "an" before a vowel', async () => {
    const box = fakeMailer();
    const s = await setup(box.mailer);
    const phone = aPhone();
    const res = await s.api
      .post('/api/staff')
      .send({ name: 'Dayo Ogunleye', contact: phone, roleId: s.roles.manager.id });
    expect(res.body.invite).toMatchObject({ how: 'copy', problem: null });
    expect(res.body.invite.to).toBe(`${phone.slice(0, 4)} ${phone.slice(4, 7)} ${phone.slice(7)}`);
    expect(res.body.invite.words).toMatch(
      /^Hi Dayo, Adaeze has added you to .+ as an operations manager\./,
    );
    expect(res.body.invite.words).toContain(`sign in with ${res.body.invite.to}.`);
    expect(box.sent).toHaveLength(0);
  });

  it('no email here, or the email fails: the words to copy, and why', async () => {
    const none = await setup();
    const a = await none.api.post('/api/staff').send({
      name: 'Kunle Bello',
      contact: `kunle.${randomInt(10 ** 6)}@example.com`,
      roleId: none.roles.guide.id,
    });
    expect(a.body.invite).toMatchObject({
      how: 'copy',
      problem:
        'Email isn’t set up on this OkapiGo server yet. Copy the words and send them yourself.',
    });
    const broken = await setup(fakeMailer(true).mailer);
    const b = await broken.api.post('/api/staff').send({
      name: 'Kunle Bello',
      contact: `kunle.${randomInt(10 ** 6)}@example.com`,
      roleId: broken.roles.guide.id,
    });
    expect(b.status).toBe(201); // they're added either way
    expect(b.body.invite.how).toBe('copy');
    expect(b.body.invite.problem).toMatch(/^The email didn’t go \(MAILPIT_DOWN/);
  });

  it('someone already on OkapiGo can’t be added twice; no invitation without access', async () => {
    const s = await setup();
    const taken = await s.api
      .post('/api/staff')
      .send({ name: 'Someone', contact: s.guides[0].email, roleId: s.roles.guide.id });
    expect(taken.status).toBe(409);
    expect(taken.body.error.code).toBe('CONTACT_IN_USE');
    await s.api.patch(`/api/staff/${s.guides[0].id}`).send({ isActive: false });
    const res = await s.api.post(`/api/staff/${s.guides[0].id}/invite`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('NO_ACCESS');
  });
});

describe('editing', () => {
  it('the name; the contact shown is the one replaced; never twice', async () => {
    const s = await setup();
    const g = s.guides[0];
    const phone = aPhone();
    const res = await s.api
      .patch(`/api/staff/${g.id}`)
      .send({ name: 'Femi Adebayo', contact: phone });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.user).toMatchObject({ name: 'Femi Adebayo', email: null });
    expect(res.body.user.phone).toBe(`+234${phone.slice(1)}`);
    // Back to an email: the phone shown goes.
    const email = `femi.${randomInt(10 ** 6)}@example.com`;
    const back = await s.api.patch(`/api/staff/${g.id}`).send({ contact: email });
    expect(back.body.user).toMatchObject({ email, phone: null, contact: email });
    // Someone else's.
    const clash = await s.api.patch(`/api/staff/${g.id}`).send({ contact: s.manager.email });
    expect(clash.body.error.code).toBe('CONTACT_IN_USE');
    // Their own contact again is fine.
    expect((await s.api.patch(`/api/staff/${g.id}`).send({ contact: email })).status).toBe(200);
  });

  it('your own name, yes; your own role or access, no', async () => {
    const s = await setup();
    const mine = await s.api.patch(`/api/staff/${s.owner.id}`).send({ name: 'Adaeze O.' });
    expect(mine.body.user.name).toBe('Adaeze O.');
    const role = await s.api.patch(`/api/staff/${s.owner.id}`).send({ roleId: s.roles.guide.id });
    expect(role.body.error.code).toBe('CANNOT_CHANGE_SELF');
  });

  it('at least one owner, always', async () => {
    const s = await setup();
    // A custom role that can manage staff, held by someone who isn't an owner.
    const desk = await s.api.post('/api/roles').send({
      name: 'Front desk',
      permissions: {
        products: 'view',
        bookings: 'edit',
        operations: 'edit',
        payments: 'view',
        marketing: 'view',
        settings: 'edit',
        channels: 'view',
        reports: 'view',
      },
    });
    expect(desk.status, JSON.stringify(desk.body)).toBe(201);
    await s.api.patch(`/api/staff/${s.manager.id}`).send({ roleId: desk.body.role.id });
    const front = as(s.app, await ctx.tokenFor(s.manager.id));
    // The only owner: can't be made a guide, or removed.
    for (const body of [{ roleId: s.roles.guide.id }, { isActive: false }]) {
      const res = await front.patch(`/api/staff/${s.owner.id}`).send(body);
      expect(res.status).toBe(409);
      expect(res.body.error).toMatchObject({
        code: 'LAST_OWNER',
        message: 'There must always be at least one owner.',
      });
    }
    // With a second owner, either is fine.
    await s.api.patch(`/api/staff/${s.guides[0].id}`).send({ roleId: s.roles.owner.id });
    expect((await front.patch(`/api/staff/${s.owner.id}`).send({ isActive: false })).status).toBe(
      200,
    );
    // Someone who isn't an owner is never held back by the rule (even with no owner left at
    // all, a state only older data could be in).
    await ctx.prisma.user.updateMany({
      where: { operatorId: s.operator.id, role: { key: 'owner' } },
      data: { isActive: false },
    });
    expect(
      (await front.patch(`/api/staff/${s.guides[1].id}`).send({ roleId: s.roles.manager.id }))
        .status,
    ).toBe(200);
    await ctx.prisma.user.update({ where: { id: s.guides[0].id }, data: { isActive: true } });
    // A removed owner doesn't count: the other is now the only one.
    expect(
      (await front.patch(`/api/staff/${s.guides[0].id}`).send({ roleId: s.roles.guide.id })).body
        .error.code,
    ).toBe('LAST_OWNER');
  });
});

describe('removing', () => {
  it('signed out at once; off their coming departures; chats back to a person; back again', async () => {
    const s = await setup();
    const g = s.guides[0];
    const token = await ctx.tokenFor(g.id);
    const coming = await ctx.prisma.departure.findMany({
      where: { operatorId: s.operator.id, startsAt: { gt: new Date(Date.now() + 86_400_000) } },
      orderBy: { startsAt: 'asc' },
      take: 2,
    });
    // One they've already guided (a departure moved into the past for the test).
    const later = await ctx.prisma.departure.findFirstOrThrow({
      where: {
        operatorId: s.operator.id,
        startsAt: { gt: new Date(Date.now() + 20 * 86_400_000) },
      },
      orderBy: { startsAt: 'desc' },
    });
    const past = await ctx.prisma.departure.update({
      where: { id: later.id },
      data: {
        startsAt: new Date(Date.now() - 2 * 86_400_000),
        endsAt: new Date(Date.now() - 2 * 86_400_000 + 3_600_000),
      },
    });
    for (const d of [...coming, past]) {
      await ctx.prisma.departure.update({ where: { id: d.id }, data: { guideId: g.id } });
    }
    const chat = await ctx.prisma.conversation.create({
      data: {
        operatorId: s.operator.id,
        channel: 'simulator',
        guestPhone: `+234812${String(randomInt(10 ** 6, 10 ** 7))}`,
        handledBy: 'staff',
        handledById: g.id,
        handledSince: new Date(),
      },
    });

    const res = await s.api.patch(`/api/staff/${g.id}`).send({ isActive: false });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.user).toMatchObject({ status: 'removed', statusText: 'No access' });
    expect(res.body.unguided.map((/** @type {any} */ d) => d.id)).toEqual(coming.map((d) => d.id));
    // The coming ones have no guide now; the one that's been kept its record.
    for (const d of coming) {
      expect(
        (await ctx.prisma.departure.findUniqueOrThrow({ where: { id: d.id } })).guideId,
      ).toBeNull();
    }
    expect((await ctx.prisma.departure.findUniqueOrThrow({ where: { id: past.id } })).guideId).toBe(
      g.id,
    );
    // Their chat: someone else's to answer.
    expect(
      await ctx.prisma.conversation.findUniqueOrThrow({ where: { id: chat.id } }),
    ).toMatchObject({ handledBy: 'bot', handledById: null, needsPersonSince: expect.any(Date) });
    // Signed out: their phone's next request is refused.
    expect((await as(s.app, token).get('/api/me')).status).toBe(401);
    // Removing again changes nothing more.
    const twice = await s.api.patch(`/api/staff/${g.id}`).send({ isActive: false });
    expect(twice.body.unguided).toEqual([]);

    // Access back: they sign in again (the old sign-in stays ended).
    const back = await s.api.patch(`/api/staff/${g.id}`).send({ isActive: true });
    expect(back.body.user.status).toBe('active');
    expect((await as(s.app, token).get('/api/me')).status).toBe(401);
  });
});
