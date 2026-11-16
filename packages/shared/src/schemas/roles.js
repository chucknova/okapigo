// @ts-check
/**
 * Zod schemas for managing roles and staff (ACC-05).
 */
import { z } from 'zod';
import { MODULES, ACCESS_LEVELS } from '../permissions.js';
import { ContactSchema } from './auth.js';

/**
 * A permissions object: every module must be present with a valid level, and nothing else.
 *   { products: 'view', bookings: 'edit', ... }
 * Built from MODULES so adding a module in permissions.js updates validation automatically.
 */
export const PermissionsSchema = z
  .object(Object.fromEntries(MODULES.map((m) => [m, z.enum(ACCESS_LEVELS)])))
  .strict(); // .strict() rejects unknown keys, e.g. a misspelt "booking"

/** POST /api/roles: create a custom role, e.g. "Front desk". */
export const CreateRoleSchema = z.object({
  name: z.string().trim().min(2).max(50),
  permissions: PermissionsSchema,
});

/** PATCH /api/roles/:id: change a custom role's name and/or permissions. */
export const UpdateRoleSchema = CreateRoleSchema.partial().refine(
  (body) => Object.keys(body).length > 0,
  'Send at least one field to change',
);

/** POST /api/staff: add a staff member. */
export const CreateStaffSchema = z.object({
  name: z.string().trim().min(2).max(100),
  contact: ContactSchema,
  roleId: z.uuid(),
});

/** PATCH /api/staff/:id: change someone's role, or deactivate them. */
export const UpdateStaffSchema = z
  .object({
    roleId: z.uuid(),
    isActive: z.boolean(),
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, 'Send at least one field to change');
