import { loginRequest, openLoginAnswer, type LoginDevice, type LoginInner } from './remote-crypto.js';

/*
 * Raporlarım giriş (0.1.22), the device's side: the Raporlarım page (src/ReportsPhone.tsx) and the tests run this very code.
 *   1. POST /phone/login/start { email }        Mola Merkez finds the business by its verified owner e-mail and hands out the
 *                                               café's public key (or says plainly what is missing: package, phone code, café off).
 *   2. POST /phone/login { email, request }     the sealed request (remote-crypto.ts loginRequest) goes through the köprü to the
 *                                               café computer, which checks the password and the phone code itself and answers
 *                                               sealed; Merkez adds the token it will know this device by.
 * Merkez never sees the password or the code: they are inside `request.ct`.
 */
export type PhonePost = (path: string, body: unknown) => Promise<{ status: number; data: Record<string, any> }>;
export type LoginResult =
  | { kind: 'paired'; phoneId: string; token: string; business: string; name: string; cafePublic: string }
  /** "En fazla 3 cihaz": the owner picks the one to replace; the ticket stands for the password and code just given. */
  | { kind: 'full'; message: string; devices: LoginDevice[]; ticket: string; cafePublic: string }
  | { kind: 'error'; code: string; message: string };
const failed = (data: Record<string, any>, fallback = 'Giriş yapılamadı. Biraz sonra yeniden deneyin.'): LoginResult => ({ kind: 'error', code: typeof data.code === 'string' ? data.code : 'LOGIN_FAILED', message: typeof data.message === 'string' ? data.message : fallback });

/** `cafePublic`: from the step before ("Hangisinin yerine?"), so the same key is used again. */
export async function deviceLogin(post: PhonePost, keys: { privateKey: CryptoKey; publicKey: string }, email: string, inner: LoginInner, options: { at?: number; cafePublic?: string } = {}): Promise<LoginResult> {
  let cafePublic = options.cafePublic;
  if (!cafePublic) {
    const start = await post('login/start', { email });
    if (start.status !== 200 || typeof start.data.cafePublic !== 'string') return failed(start.data);
    cafePublic = start.data.cafePublic as string;
  }
  const { request, key } = await loginRequest(keys.privateKey, keys.publicKey, cafePublic, inner, options.at);
  const r = await post('login', { email, request });
  if (r.status !== 200 || !r.data.box) return failed(r.data);
  let answer;
  try { answer = await openLoginAnswer(key, request.nonce, r.data.box); } catch { return { kind: 'error', code: 'LOGIN_INVALID', message: 'Giriş doğrulanamadı. Sayfayı yenileyip yeniden deneyin.' }; }
  if (!answer.ok) return answer.code === 'DEVICE_LIMIT' && answer.ticket && answer.devices ? { kind: 'full', message: answer.message, devices: answer.devices, ticket: answer.ticket, cafePublic } : { kind: 'error', code: answer.code, message: answer.message };
  // The café said which device id it gave; Merkez's token must be for that same id.
  if (answer.phoneId !== r.data.phoneId || typeof r.data.token !== 'string') return { kind: 'error', code: 'LOGIN_INVALID', message: 'Giriş doğrulanamadı. Sayfayı yenileyip yeniden deneyin.' };
  return { kind: 'paired', phoneId: answer.phoneId, token: r.data.token, business: answer.business, name: answer.name, cafePublic };
}
