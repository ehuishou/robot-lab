/** Shared nickname identity: trim, collapse spaces, NFC, case insensitive. */
export function normalizeNickname(value: unknown): { nickname: string; key: string } {
  if (typeof value !== 'string' || /[\x00-\x1f\x7f-\x9f]/u.test(value)) throw new RangeError('请输入 1–20 个字的昵称，不含控制字符。');
  const nickname = value.normalize('NFC').trim().replace(/\s+/gu, ' ');
  if (!nickname || [...nickname].length > 20) throw new RangeError('请输入 1–20 个字的昵称。');
  return { nickname, key: nickname.toLowerCase() };
}
