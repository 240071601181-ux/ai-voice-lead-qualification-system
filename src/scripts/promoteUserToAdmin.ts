import { pool } from '../database';
import { normalizeEmail } from '../services/authService';
import { promoteUserToAdmin } from '../repositories/userRepository';

const main = async (): Promise<void> => {
  const email = normalizeEmail(process.argv[2]);
  if (!email || process.argv.length !== 3) {
    throw new Error('Usage: npm run admin:promote -- <existing-account-email>');
  }
  if (!(await promoteUserToAdmin(email))) {
    throw new Error('No active account matched the supplied email');
  }
  console.log('Active account promoted to ADMIN');
};

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Admin promotion failed');
  process.exitCode = 1;
}).finally(() => pool.end());
