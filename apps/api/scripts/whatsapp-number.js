// @ts-check
/**
 * Sets a business's WhatsApp number (Meta's "Phone number ID") from the terminal, until the
 * operator app has a screen for it (stage 13c-3). The same rule as PATCH /api/whatsapp:
 * digits only, one business per number.
 *
 *   pnpm --filter @okapigo/api whatsapp:number irin-lagos-tours 123456789012345
 *   pnpm --filter @okapigo/api whatsapp:number irin-lagos-tours none      (disconnects it)
 */
import { createPrismaClient } from '@okapigo/db';

const [slug, id] = process.argv.slice(2);
if (!slug || !id || !(id === 'none' || /^[0-9]{5,30}$/.test(id))) {
  process.stderr.write(
    'Usage: whatsapp:number <operator-slug> <phone-number-id | none>\n' +
      'The Phone number ID is on Meta’s WhatsApp → API Setup page (digits only).\n',
  );
  process.exit(1);
}
const prisma = createPrismaClient(/** @type {string} */ (process.env.DATABASE_URL));
try {
  const o = await prisma.operator.update({
    where: { slug },
    data: { whatsappPhoneNumberId: id === 'none' ? null : id },
  });
  process.stdout.write(
    `${o.name}: WhatsApp number ${o.whatsappPhoneNumberId ? `set (${o.whatsappPhoneNumberId})` : 'disconnected'}\n`,
  );
} catch (err) {
  const code = /** @type {any} */ (err).code;
  process.stderr.write(
    code === 'P2025'
      ? `No business called "${slug}".\n`
      : code === 'P2002'
        ? 'Another business already uses that number.\n'
        : `Failed: ${/** @type {Error} */ (err).message}\n`,
  );
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
