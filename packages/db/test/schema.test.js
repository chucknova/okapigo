/**
 * Tests that the DATABASE itself enforces our rules, independent of any app code.
 *
 * Each test seeds its own throwaway copy of the demo business under a random slug and
 * deletes it afterwards, so tests never touch your seeded `irin-lagos-tours` data and can
 * run in any order.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createPrismaClient, seedDemoOperator } from '../src/index.js';

/** @type {import('@prisma/client').PrismaClient} */
let prisma;
/** Operators created by the current test, deleted in afterEach. */
let created = [];

/** Seeds a fresh demo copy with a unique slug like "test-3f9a1c2b". */
async function seedTestOperator() {
  const operator = await seedDemoOperator(prisma, { slug: `test-${randomUUID().slice(0, 8)}` });
  created.push(operator.id);
  return operator;
}

/** Looks up a role by key ("owner", "guide", ...) for an operator. */
function role(operatorId, key) {
  return prisma.role.findUniqueOrThrow({ where: { operatorId_key: { operatorId, key } } });
}

beforeAll(() => {
  prisma = createPrismaClient(process.env.DATABASE_URL);
});
afterAll(() => prisma.$disconnect());

beforeEach(() => {
  created = [];
});
afterEach(async () => {
  // Cascades remove each test operator's roles and users too.
  await prisma.operator.deleteMany({ where: { id: { in: created } } });
});

describe('seedDemoOperator', () => {
  it('creates the operator, three preset roles and six staff', async () => {
    const operator = await seedTestOperator();

    const roles = await prisma.role.findMany({ where: { operatorId: operator.id } });
    const users = await prisma.user.findMany({
      where: { operatorId: operator.id },
      include: { role: true },
    });

    expect(operator.currency).toBe('NGN');
    expect(operator.timeZone).toBe('Africa/Lagos');
    expect(roles.map((r) => r.key).sort()).toEqual(['guide', 'manager', 'owner']);
    expect(roles.every((r) => r.isPreset)).toBe(true);

    const countByRole = {};
    for (const u of users) countByRole[u.role.key] = (countByRole[u.role.key] ?? 0) + 1;
    expect(countByRole).toEqual({ owner: 1, manager: 1, guide: 4 });
  });

  it('can create several copies side by side (needed for visitor sandboxes)', async () => {
    const a = await seedTestOperator();
    const b = await seedTestOperator();

    expect(a.id).not.toBe(b.id);
    // Two operators may both have a "guide" role: role keys are unique per operator only.
    expect((await role(a.id, 'guide')).id).not.toBe((await role(b.id, 'guide')).id);
  });
});

describe('tenant isolation', () => {
  it("refuses to give a user another operator's role (composite foreign key)", async () => {
    const lagos = await seedTestOperator();
    const other = await seedTestOperator();
    const otherOwnerRole = await role(other.id, 'owner');

    await expect(
      prisma.user.create({
        data: {
          operatorId: lagos.id,
          roleId: otherOwnerRole.id, // belongs to the OTHER operator
          name: 'Sneaky Owner',
          email: `sneaky-${randomUUID()}@example.test`,
        },
      }),
      // Assert on the constraint NAME, so the test can't pass because of some other error.
    ).rejects.toThrow(/users_role_id_operator_id_fkey/);
  });

  it('refuses a second role with the same key in one operator', async () => {
    const op = await seedTestOperator();

    await expect(
      prisma.role.create({ data: { operatorId: op.id, key: 'guide', name: 'Another guide' } }),
    ).rejects.toThrow(/roles_operator_id_key_key/);
  });
});

describe('user CHECK constraints', () => {
  /** Tries to create a user in a fresh operator with the given contact details. */
  async function createUser(contact) {
    const op = await seedTestOperator();
    const guide = await role(op.id, 'guide');
    return prisma.user.create({
      data: { operatorId: op.id, roleId: guide.id, name: 'Test Guide', ...contact },
    });
  }

  it('requires an email or a phone', async () => {
    await expect(createUser({})).rejects.toThrow(/users_email_or_phone_required/);
  });

  it('accepts a phone-only user', async () => {
    const phone = `+23480${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
    await expect(createUser({ phone })).resolves.toMatchObject({ phone, email: null });
  });

  it('rejects an email with capital letters', async () => {
    await expect(createUser({ email: 'Kemi@Example.test' })).rejects.toThrow(
      /users_email_lowercase/,
    );
  });

  it('rejects a phone that is not in +234... format', async () => {
    await expect(createUser({ phone: '0803 000 0009' })).rejects.toThrow(/users_phone_e164/);
  });
});

describe('operator CHECK constraints', () => {
  it('rejects a slug that is not URL-safe', async () => {
    await expect(
      prisma.operator.create({ data: { name: 'Bad Slug Tours', slug: 'Bad Slug!' } }),
    ).rejects.toThrow(/operators_slug_format/);
  });
});

describe('deleting', () => {
  it('will not delete a role while staff still hold it', async () => {
    const op = await seedTestOperator();
    const guide = await role(op.id, 'guide');

    await expect(prisma.role.delete({ where: { id: guide.id } })).rejects.toThrow(
      /users_role_id_operator_id_fkey/,
    );
  });

  it('deleting an operator removes all of its roles and staff', async () => {
    const op = await seedTestOperator();

    await prisma.operator.delete({ where: { id: op.id } });

    expect(await prisma.role.count({ where: { operatorId: op.id } })).toBe(0);
    expect(await prisma.user.count({ where: { operatorId: op.id } })).toBe(0);
  });
});
