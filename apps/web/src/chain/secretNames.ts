/**
 * Names that say "secret". Anything prefixed `VITE_` is bundled into the
 * browser build, so a variable with one of these names in a web `.env` is a
 * secret in a JavaScript file. Shared by the runtime check in `config.ts`
 * and the build-time check in `vite.config.ts`, so `vite build` refuses
 * before the bundle exists and the app refuses again if a bundle got made
 * some other way.
 *
 * Deliberately not `KEY` on its own: a public anon key for the content store
 * is a legitimate `VITE_` variable. `OPERATOR` is here because hard rule 2
 * names operator ids alongside keys and seeds.
 */

export const SECRET_NAME = /PRIVATE|SECRET|MNEMONIC|SEED|SERVICE_KEY|SERVICE_ROLE|OPERATOR|SIGNING/i;

export function looksLikeSecretName(name: string): boolean {
  return name.startsWith("VITE_") && SECRET_NAME.test(name);
}

export function secretNameMessage(name: string): string {
  return `${name} looks like a secret. Anything prefixed VITE_ is bundled into the browser build. Remove it.`;
}
