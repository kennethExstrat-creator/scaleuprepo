/** Password policy for /set-password (shared by the form and its Server Action). */
export const MIN_PASSWORD_LENGTH = 12;

/** Supabase Auth hashes with bcrypt, which only uses the first 72 bytes. */
export const MAX_PASSWORD_LENGTH = 72;
