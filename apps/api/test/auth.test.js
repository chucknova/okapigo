/**
 * Sign-up, sign-in and sign-out (ACC-01) against the real database.
 *
 * Codes are read from a "capturing" OTP sender instead of a real inbox (see helpers.js).
 */
import { describe, it, expect, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import { createTestContext, uniqueEmail } from './helpers.js';
import { OTP_MAX_ATTEMPTS } from '../src/auth/otp-service.js';

const ctx = createTestContext();
afterEach(() => ctx.cleanup());
afterAll(() => ctx.close());

const api = () => request(ctx.app);

/** Asks for a sign-in code and returns it (read from the capturing sender). */
async function requestCode(contact, destination = contact) {
  const res = await api().post('/auth/otp/request').send({ contact });
  expect(res.status).toBe(202);
  return ctx.sender.lastCodeFor(destination);
}

describe('sign-in with a one-time code', () => {
  it('signs a staff member in and the token works', async () => {
    const { owner } = await ctx.seedOperator();

    const code = await requestCode(owner.email);
    const verify = await api().post('/auth/otp/verify').send({ contact: owner.email, code });

    expect(verify.status).toBe(200);
    expect(verify.body.user).toMatchObject({ name: owner.name, role: { key: 'owner' } });

    const me = await api().get('/api/me').set('Authorization', `Bearer ${verify.body.token}`);
    expect(me.status).toBe(200);
    expect(me.body.user.id).toBe(owner.id);
  });

  it('accepts the email in any case and with spaces', async () => {
    const { manager } = await ctx.seedOperator();

    const code = await requestCode(`  ${manager.email.toUpperCase()} `, manager.email);
    const res = await api().post('/auth/otp/verify').send({ contact: manager.email, code });

    expect(res.status).toBe(200);
  });

  it('answers the same for unknown contacts, and sends nothing', async () => {
    const res = await api()
      .post('/auth/otp/request')
      .send({ contact: uniqueEmail('stranger') });

    expect(res.status).toBe(202);
    expect(ctx.sender.sent).toHaveLength(0);
  });

  it('never stores the code itself, only a hash', async () => {
    const { owner } = await ctx.seedOperator();
    const code = await requestCode(owner.email);

    const row = await ctx.prisma.otpChallenge.findFirst({ where: { destination: owner.email } });
    expect(row.codeHash).not.toContain(code);
    expect(row.codeHash).toMatch(/^[0-9a-f]{64}$/); // a SHA-256 HMAC in hex
  });

  it('rejects a wrong code', async () => {
    const { owner } = await ctx.seedOperator();
    const code = await requestCode(owner.email);
    const wrong = code === '000000' ? '111111' : '000000';

    const res = await api().post('/auth/otp/verify').send({ contact: owner.email, code: wrong });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_CODE');
  });

  it('accepts a code only once', async () => {
    const { owner } = await ctx.seedOperator();
    const code = await requestCode(owner.email);

    const first = await api().post('/auth/otp/verify').send({ contact: owner.email, code });
    const second = await api().post('/auth/otp/verify').send({ contact: owner.email, code });

    expect(first.status).toBe(200);
    expect(second.status).toBe(400);
  });

  it('rejects an expired code', async () => {
    const { owner } = await ctx.seedOperator();
    const code = await requestCode(owner.email);
    // Time-travel: push the challenge's expiry into the past.
    await ctx.prisma.otpChallenge.updateMany({
      where: { destination: owner.email },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const res = await api().post('/auth/otp/verify').send({ contact: owner.email, code });

    expect(res.status).toBe(400);
  });

  it(`kills the code after ${OTP_MAX_ATTEMPTS} wrong guesses, even if the next one is right`, async () => {
    const { owner } = await ctx.seedOperator();
    const code = await requestCode(owner.email);
    const wrong = code === '000000' ? '111111' : '000000';

    for (let i = 0; i < OTP_MAX_ATTEMPTS; i++) {
      await api().post('/auth/otp/verify').send({ contact: owner.email, code: wrong });
    }
    const res = await api().post('/auth/otp/verify').send({ contact: owner.email, code });

    expect(res.status).toBe(400);
  });

  it('allows only 5 guesses even when 30 are sent at the same time', async () => {
    const { owner } = await ctx.seedOperator();
    const code = await requestCode(owner.email);
    const wrong = code === '000000' ? '111111' : '000000';

    // Fire 30 wrong guesses in parallel: the race condition otp-service.js defends against.
    await Promise.all(
      Array.from({ length: 30 }, () =>
        api().post('/auth/otp/verify').send({ contact: owner.email, code: wrong }),
      ),
    );

    const row = await ctx.prisma.otpChallenge.findFirst({ where: { destination: owner.email } });
    expect(row.attempts).toBe(OTP_MAX_ATTEMPTS); // exactly 5 claimed, not 30
    const res = await api().post('/auth/otp/verify').send({ contact: owner.email, code });
    expect(res.status).toBe(400); // and the real code is now dead
  });

  it('limits how often codes can be requested for one address', async () => {
    const { owner } = await ctx.seedOperator();
    await requestCode(owner.email);

    const again = await api().post('/auth/otp/request').send({ contact: owner.email });

    expect(again.status).toBe(429);
  });

  it('signs in by phone, typed in the Nigerian local format', async () => {
    const { owner } = await ctx.seedOperator();
    const phone = '+23480' + String(Date.now()).slice(-8); // unique per run
    await ctx.prisma.user.update({ where: { id: owner.id }, data: { phone } });
    const local = '0' + phone.slice(4); // +23480xxxxxxxx → 080xxxxxxxx

    const code = await requestCode(local, phone);
    const res = await api().post('/auth/otp/verify').send({ contact: local, code });

    expect(res.status).toBe(200);
    await ctx.prisma.user.update({ where: { id: owner.id }, data: { phone: null } });
  });
});

describe('deactivated staff', () => {
  it('get no code, and their existing sessions stop working', async () => {
    const { owner, guides } = await ctx.seedOperator();
    const guide = guides[0];
    const ownerToken = await ctx.tokenFor(owner.id);
    const guideToken = await ctx.tokenFor(guide.id);

    const deactivate = await api()
      .patch(`/api/staff/${guide.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ isActive: false });
    expect(deactivate.status).toBe(200);

    const me = await api().get('/api/me').set('Authorization', `Bearer ${guideToken}`);
    expect(me.status).toBe(401);

    await api().post('/auth/otp/request').send({ contact: guide.email });
    expect(ctx.sender.lastCodeFor(guide.email)).toBeUndefined();
  });
});

describe('sign-out', () => {
  it('revokes the session', async () => {
    const { owner } = await ctx.seedOperator();
    const token = await ctx.tokenFor(owner.id);

    const out = await api().post('/auth/logout').set('Authorization', `Bearer ${token}`);
    const me = await api().get('/api/me').set('Authorization', `Bearer ${token}`);

    expect(out.status).toBe(204);
    expect(me.status).toBe(401);
  });
});

describe('sign-up (a new business)', () => {
  it('creates nothing until the code is verified, then creates the business and its owner', async () => {
    const email = uniqueEmail('founder');
    const businessName = `Ọ̀ṣun Trails ${Date.now()}`;

    const start = await api()
      .post('/auth/signup')
      .send({ businessName, name: 'Bisi Ade', contact: email });
    expect(start.status).toBe(202);
    expect(await ctx.prisma.user.count({ where: { email } })).toBe(0);

    const code = ctx.sender.lastCodeFor(email);
    const done = await api().post('/auth/signup/verify').send({ contact: email, code });
    ctx.track(done.body.operator?.slug);

    expect(done.status).toBe(201);
    expect(done.body.operator.slug).toMatch(/^osun-trails-\d+$/); // tone marks stripped
    expect(done.body.user).toMatchObject({ name: 'Bisi Ade', role: { key: 'owner' } });

    const roles = await ctx.prisma.role.findMany({ where: { operatorId: done.body.operator.id } });
    expect(roles.map((r) => r.key).sort()).toEqual(['guide', 'manager', 'owner']);

    const me = await api().get('/api/me').set('Authorization', `Bearer ${done.body.token}`);
    expect(me.body.operator.name).toBe(businessName);
    await ctx.prisma.otpChallenge.deleteMany({ where: { destination: email } });
  });

  it('refuses an email that already has an account', async () => {
    const { owner } = await ctx.seedOperator();

    const res = await api()
      .post('/auth/signup')
      .send({ businessName: 'Another Tours', name: 'Adaeze', contact: owner.email });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONTACT_IN_USE');
  });

  it('explains every invalid field at once', async () => {
    const res = await api().post('/auth/signup').send({ businessName: 'X', contact: 'nope' });

    expect(res.status).toBe(400);
    expect(res.body.error.issues.map((i) => i.path).sort()).toEqual([
      'businessName',
      'contact',
      'name',
    ]);
  });
});
