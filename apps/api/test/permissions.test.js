/**
 * Roles and permissions (ACC-05) against the real database:
 *   - every /api route needs sign-in
 *   - each role sees exactly what its permissions allow
 *   - custom roles work, preset roles are locked
 *   - one operator can never touch another's data
 */
import { describe, it, expect, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import { buildPermissions } from '@okapigo/shared/permissions';
import { createTestContext, uniqueEmail } from './helpers.js';

const ctx = createTestContext();
afterEach(() => ctx.cleanup());
afterAll(() => ctx.close());

/** request(app) with a Bearer token already set: as(token).get('/api/me') */
function as(token) {
  const agent = request(ctx.app);
  const withAuth = (method) => (url) => agent[method](url).set('Authorization', `Bearer ${token}`);
  return {
    get: withAuth('get'),
    post: withAuth('post'),
    patch: withAuth('patch'),
    delete: withAuth('delete'),
  };
}

const SOME_ID = '00000000-0000-4000-8000-000000000000';

describe('default deny', () => {
  // Every staff API route. When a session adds routes, add them here too.
  it.each([
    ['get', '/api/me'],
    ['get', '/api/roles'],
    ['post', '/api/roles'],
    ['patch', `/api/roles/${SOME_ID}`],
    ['delete', `/api/roles/${SOME_ID}`],
    ['get', '/api/staff'],
    ['post', '/api/staff'],
    ['patch', `/api/staff/${SOME_ID}`],
    ['get', '/api/products'],
    ['get', `/api/products/${SOME_ID}`],
    ['post', '/api/products'],
    ['patch', `/api/products/${SOME_ID}`],
    ['post', `/api/products/${SOME_ID}/price-categories`],
    ['patch', `/api/price-categories/${SOME_ID}`],
    ['post', `/api/products/${SOME_ID}/add-ons`],
    ['patch', `/api/add-ons/${SOME_ID}`],
    ['get', `/api/products/${SOME_ID}/schedules`],
    ['post', `/api/products/${SOME_ID}/schedules`],
    ['patch', `/api/schedules/${SOME_ID}`],
    ['get', '/api/departures'],
    ['post', `/api/products/${SOME_ID}/departures`],
    ['patch', `/api/departures/${SOME_ID}`],
    ['get', `/api/products/${SOME_ID}/availability`],
    ['post', '/api/quotes'],
    ['get', '/api/anything-new'],
  ])('%s %s needs sign-in', async (method, url) => {
    const res = await request(ctx.app)[method](url);
    expect(res.status).toBe(401);
  });

  it('rejects a made-up token', async () => {
    const res = await as('not-a-real-token').get('/api/me');
    expect(res.status).toBe(401);
  });
});

describe('preset roles', () => {
  it('owner can manage staff', async () => {
    const { owner } = await ctx.seedOperator();
    const res = await as(await ctx.tokenFor(owner.id)).get('/api/staff');

    expect(res.status).toBe(200);
    expect(res.body.staff).toHaveLength(6);
  });

  it('manager and guide cannot see staff settings', async () => {
    const { manager, guides } = await ctx.seedOperator();

    for (const user of [manager, guides[0]]) {
      const res = await as(await ctx.tokenFor(user.id)).get('/api/staff');
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    }
  });

  it('everyone can see who they are and what they may do', async () => {
    const { guides } = await ctx.seedOperator();
    const res = await as(await ctx.tokenFor(guides[0].id)).get('/api/me');

    expect(res.status).toBe(200);
    expect(res.body.permissions).toMatchObject({ operations: 'edit', payments: 'none' });
  });

  it('cannot be edited or deleted', async () => {
    const { operator, owner } = await ctx.seedOperator();
    const guideRole = await ctx.prisma.role.findFirst({
      where: { operatorId: operator.id, key: 'guide' },
    });
    const token = await ctx.tokenFor(owner.id);

    const patch = await as(token)
      .patch(`/api/roles/${guideRole.id}`)
      .send({ name: 'Senior guide' });
    const del = await as(token).delete(`/api/roles/${guideRole.id}`);

    expect(patch.status).toBe(403);
    expect(patch.body.error.code).toBe('PRESET_ROLE_LOCKED');
    expect(del.status).toBe(403);
  });
});

describe('custom roles', () => {
  it('a "Front desk" role with settings:view can list staff but not add them', async () => {
    const { owner, guides } = await ctx.seedOperator();
    const ownerToken = await ctx.tokenFor(owner.id);

    const created = await as(ownerToken)
      .post('/api/roles')
      .send({ name: 'Front desk', permissions: buildPermissions('view', { payments: 'none' }) });
    expect(created.status).toBe(201);
    expect(created.body.role).toMatchObject({ key: 'front-desk', isPreset: false });

    // Move a guide into the new role…
    const moved = await as(ownerToken)
      .patch(`/api/staff/${guides[0].id}`)
      .send({ roleId: created.body.role.id });
    expect(moved.status).toBe(200);

    // …and their access changes on their very next request (no re-login needed).
    const frontDesk = as(await ctx.tokenFor(guides[0].id));
    expect((await frontDesk.get('/api/staff')).status).toBe(200);
    expect(
      (
        await frontDesk
          .post('/api/staff')
          .send({ name: 'X', contact: uniqueEmail(), roleId: SOME_ID })
      ).status,
    ).toBe(403);
  });

  it('rejects incomplete permissions', async () => {
    const { owner } = await ctx.seedOperator();
    const res = await as(await ctx.tokenFor(owner.id))
      .post('/api/roles')
      .send({ name: 'Half role', permissions: { bookings: 'view' } });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('cannot be deleted while someone holds it, and can be once nobody does', async () => {
    const { operator, owner, guides } = await ctx.seedOperator();
    const token = await ctx.tokenFor(owner.id);
    const role = (
      await as(token)
        .post('/api/roles')
        .send({ name: 'Driver', permissions: buildPermissions('none') })
    ).body.role;
    await as(token).patch(`/api/staff/${guides[0].id}`).send({ roleId: role.id });

    const blocked = await as(token).delete(`/api/roles/${role.id}`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('ROLE_IN_USE');

    const guideRole = await ctx.prisma.role.findFirst({
      where: { operatorId: operator.id, key: 'guide' },
    });
    await as(token).patch(`/api/staff/${guides[0].id}`).send({ roleId: guideRole.id });
    expect((await as(token).delete(`/api/roles/${role.id}`)).status).toBe(204);
  });
});

describe('staff management', () => {
  it('owner adds a staff member who can then sign in', async () => {
    const { operator, owner } = await ctx.seedOperator();
    const guideRole = await ctx.prisma.role.findFirst({
      where: { operatorId: operator.id, key: 'guide' },
    });
    const email = `new-guide@${operator.slug}.example`;

    const res = await as(await ctx.tokenFor(owner.id))
      .post('/api/staff')
      .send({ name: 'Ngozi Obi', contact: email, roleId: guideRole.id });
    expect(res.status).toBe(201);

    await request(ctx.app).post('/auth/otp/request').send({ contact: email });
    const code = ctx.sender.lastCodeFor(email);
    const signIn = await request(ctx.app).post('/auth/otp/verify').send({ contact: email, code });
    expect(signIn.body.user).toMatchObject({ name: 'Ngozi Obi', role: { key: 'guide' } });
  });

  it('nobody can change their own role or deactivate themselves', async () => {
    const { owner } = await ctx.seedOperator();
    const res = await as(await ctx.tokenFor(owner.id))
      .patch(`/api/staff/${owner.id}`)
      .send({ isActive: false });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('CANNOT_CHANGE_SELF');
  });
});

describe('tenant isolation', () => {
  it("an owner cannot see, change or assign another operator's staff and roles", async () => {
    const lagos = await ctx.seedOperator();
    const other = await ctx.seedOperator();
    const token = await ctx.tokenFor(lagos.owner.id);
    const otherGuideRole = await ctx.prisma.role.findFirst({
      where: { operatorId: other.operator.id, key: 'guide' },
    });

    // Listing shows only their own six staff.
    const list = await as(token).get('/api/staff');
    expect(list.body.staff.every((s) => s.email.endsWith(`@${lagos.operator.slug}.example`))).toBe(
      true,
    );

    // Another operator's staff and roles are simply "not found".
    expect(
      (await as(token).patch(`/api/staff/${other.guides[0].id}`).send({ isActive: false })).status,
    ).toBe(404);
    expect((await as(token).delete(`/api/roles/${otherGuideRole.id}`)).status).toBe(404);

    // And their roles can't be handed to your own staff.
    const assign = await as(token)
      .patch(`/api/staff/${lagos.guides[0].id}`)
      .send({ roleId: otherGuideRole.id });
    expect(assign.status).toBe(400);
    expect(assign.body.error.code).toBe('INVALID_ROLE');
  });
});
