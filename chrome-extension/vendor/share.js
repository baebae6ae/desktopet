/**
 * share.js — 답변 상태 ↔ URL 프래그먼트 인코딩/디코딩.
 * 서버 없이 완성된 체크리스트 답변을 URL 하나로 공유하기 위한 순수 로직.
 * (DOM에 의존하지 않아 scripts/test.mjs 에서 그대로 왕복 테스트 가능)
 *
 * 형식: app.html#s=<base64url(JSON.stringify(answers) 의 UTF-8 바이트)>
 * 한글 등 멀티바이트 문자가 깨지지 않도록 TextEncoder/TextDecoder로 UTF-8을
 * 명시적으로 오가고, btoa/atob 는 바이트 문자열에만 사용한다.
 */

const PREFIX = 's=';

/** answers 객체 → URL 프래그먼트에 넣을 문자열 (# 제외, 예: "s=eyJ...") */
export function encodeAnswers(answers) {
  const json = JSON.stringify(answers || {});
  const bytes = new TextEncoder().encode(json);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  const b64 = btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return PREFIX + b64;
}

/**
 * location.hash(또는 그 안의 조각) → answers 객체, 파싱 실패 시 null.
 * "#s=..." 전체 해시나 "s=..." 조각 어느 쪽을 넘겨도 동작한다.
 */
export function decodeAnswers(hash) {
  if (!hash || typeof hash !== 'string') return null;
  const clean = hash.startsWith('#') ? hash.slice(1) : hash;
  const match = /(?:^|&)s=([^&]+)/.exec(clean);
  if (!match) return null;
  try {
    let b64 = match[1].replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4 !== 0) b64 += '=';
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const json = new TextDecoder().decode(bytes);
    const parsed = JSON.parse(json);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    return null;
  } catch {
    return null;
  }
}
