// @ts-check
/**
 * channels.js — OTAs connected to a business, selling its tours through the OCTO API
 * (session 17, DST-01/02).
 *
 *   makeApiKey()        a new key: "octo_" + 32 random bytes, URL-safe
 *   hashApiKey(key)     its SHA-256 (hex): what's stored; the key itself never is
 *   createChannel()     a channel, its key's hash and hint, and the tours it may sell
 *   channelByKey()      the active channel a key belongs to, with its business; or null
 *
 * Why a hash and not the key: like sessions' tokens (session 3), a leaked database must not
 * hand anyone a working key. SHA-256 is enough here (unlike passwords): the key is 32 random
 * bytes, so there's nothing to guess.
 */
import { createHash, randomBytes } from 'node:crypto';

export const API_KEY_PREFIX = 'octo_';

/** A new API key, shown to the owner once. */
export const makeApiKey = () => `${API_KEY_PREFIX}${randomBytes(32).toString('base64url')}`;

/** @param {string} key */
export const hashApiKey = (key) => createHash('sha256').update(key, 'utf8').digest('hex');

/** "…k3Qz": the last 4 characters, to tell keys apart. @param {string} key */
export const keyHint = (key) => `…${key.slice(-4)}`;

/**
 * @param {import('@prisma/client').Prisma.TransactionClient | import('@prisma/client').PrismaClient} db
 * @param {{ operatorId: string, name: string, commissionBasisPoints?: number, productIds?: string[], apiKey?: string }} c
 *   apiKey: a given key (the demo's mock OTA, from its settings); otherwise a new one
 * @returns {Promise<{ channel: import('@prisma/client').Channel, apiKey: string }>}
 */
export async function createChannel(
  db,
  { operatorId, name, commissionBasisPoints, productIds = [], apiKey },
) {
  const key = apiKey ?? makeApiKey();
  const channel = await db.channel.create({
    data: {
      operatorId,
      name,
      commissionBasisPoints,
      apiKeyHash: hashApiKey(key),
      apiKeyHint: keyHint(key),
      products: { create: productIds.map((productId) => ({ productId })) },
    },
  });
  return { channel, apiKey: key };
}

/**
 * The active channel this key belongs to, with its business; null for an unknown key or a
 * switched-off channel. @param {import('@prisma/client').PrismaClient} prisma @param {string} key
 */
export async function channelByKey(prisma, key) {
  const channel = await prisma.channel.findUnique({
    where: { apiKeyHash: hashApiKey(key) },
    include: { operator: true },
  });
  return channel?.isActive ? channel : null;
}
