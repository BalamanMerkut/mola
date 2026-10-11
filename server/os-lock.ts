import { runProgram } from './programs.js';

/**
 * The "OS lock" of the master key: something only this computer's signed-in user can open.
 * Windows: DPAPI (CurrentUser), bound to the Windows account and its password. macOS: the login Keychain.
 * Linux: no keyring every café PC has, so the key stays in the file as is ("korumasız"); disk encryption must protect it.
 * `data` is what is written into anahtar.json; the key itself never goes on a command line or into a temp file.
 */
export type OsLockKind = 'dpapi' | 'keychain' | 'file';
export type OsLock = {
  kind: OsLockKind;
  /** false: the key is only encoded (Linux); a stolen disk is readable unless the disk itself is encrypted. */
  protects: boolean;
  seal(key: Buffer, installId: string): Promise<string>;
  open(data: string, installId: string): Promise<Buffer>;
};
/** denied: the lock answered "not yours" (other user, reset password, other computer); retrying will not help. */
export class OsLockError extends Error {
  constructor(message: string, readonly denied: boolean) { super(message); }
}

/**
 * Runs a program with the secret on stdin only; stdout comes back to this process through a pipe. Started from a worker
 * thread (server/programs.ts): a process start never holds the tablets.
 */
export function runQuiet(command: string, args: string[], input = '', timeoutMs = 30000) {
  return runProgram(command, args, { input, timeoutMs, output: true });
}
export function runPowerShell(script: string, input = '', timeoutMs = 30000) {
  return runQuiet('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(`$ProgressPreference='SilentlyContinue'\n${script}`, 'utf16le').toString('base64')], input, timeoutMs);
}

// Exit 3: DPAPI refused (another user, a reset password, another computer). Anything else is "could not ask".
const dpapi = (op: 'Protect' | 'Unprotect') => `$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Security
$data = [Convert]::FromBase64String([Console]::In.ReadLine())
$entropy = [Text.Encoding]::UTF8.GetBytes('mola:anahtar:v1:' + [Console]::In.ReadLine())
try { $out = [Security.Cryptography.ProtectedData]::${op}($data, $entropy, [Security.Cryptography.DataProtectionScope]::CurrentUser) }
catch [Security.Cryptography.CryptographicException] { exit 3 }
[Console]::Out.Write([Convert]::ToBase64String($out))`;
async function callDpapi(op: 'Protect' | 'Unprotect', data: string, installId: string) {
  let result;
  try { result = await runPowerShell(dpapi(op), `${data}\n${installId}\n`); }
  catch { throw new OsLockError('Windows anahtar kilidine ulaşılamadı (PowerShell açılmadı).', false); }
  if (result.code === 3) throw new OsLockError('Windows kilidi bu anahtarı açmadı: başka kullanıcı, sıfırlanan Windows şifresi ya da başka bilgisayar.', true);
  if (result.code !== 0 || !/^[A-Za-z0-9+/=]+$/.test(result.out.trim())) throw new OsLockError('Windows anahtar kilidi yanıt vermedi.', false);
  return result.out.trim();
}
export const dpapiLock: OsLock = {
  kind: 'dpapi', protects: true,
  seal: (key, installId) => callDpapi('Protect', key.toString('base64'), installId),
  async open(data, installId) {
    if (!/^[A-Za-z0-9+/=]{20,4000}$/.test(data)) throw new OsLockError('Anahtar kaydı bozuk.', true);
    const key = Buffer.from(await callDpapi('Unprotect', data, installId), 'base64');
    if (key.length !== 32) throw new OsLockError('Windows kilidinden gelen anahtar geçersiz.', true);
    return key;
  },
};

// macOS: `security -i` reads its command from stdin, so the key is never visible in the process list.
const SERVICE = 'com.merkutstudios.mola';
const account = (installId: string) => { if (!/^[a-f0-9-]{36}$/.test(installId)) throw new OsLockError('Kurulum kimliği geçersiz.', true); return `anahtar-${installId}`; };
export const keychainLock: OsLock = {
  kind: 'keychain', protects: true,
  async seal(key, installId) {
    const name = account(installId);
    let result;
    try { result = await runQuiet('/usr/bin/security', ['-i'], `add-generic-password -U -s ${SERVICE} -a ${name} -w ${key.toString('hex')}\n`); }
    catch { throw new OsLockError('Anahtarlık (Keychain) açılamadı.', false); }
    if (result.code !== 0) throw new OsLockError('Anahtar, anahtarlığa (Keychain) yazılamadı.', false);
    return name;
  },
  async open(data, installId) {
    if (data !== account(installId)) throw new OsLockError('Anahtar kaydı bu kuruluma ait değil.', true);
    let result;
    try { result = await runQuiet('/usr/bin/security', ['find-generic-password', '-s', SERVICE, '-a', data, '-w']); }
    catch { throw new OsLockError('Anahtarlık (Keychain) açılamadı.', false); }
    // 44: no such item (another Mac or another user). Other codes: the keychain is locked or the user said no.
    if (result.code === 44) throw new OsLockError('Bu bilgisayarın anahtarlığında Mola anahtarı yok.', true);
    const hex = result.out.trim();
    if (result.code !== 0 || !/^[a-f0-9]{64}$/.test(hex)) throw new OsLockError('Anahtarlık (Keychain) anahtarı vermedi.', false);
    return Buffer.from(hex, 'hex');
  },
};

/** Linux: no lock at all. Marked "korumasız" everywhere it is shown. */
export const fileLock: OsLock = {
  kind: 'file', protects: false,
  async seal(key) { return key.toString('base64'); },
  async open(data) {
    const key = Buffer.from(data, 'base64');
    if (key.length !== 32 || key.toString('base64') !== data) throw new OsLockError('Anahtar kaydı bozuk.', true);
    return key;
  },
};

export function platformOsLock(): OsLock {
  return process.platform === 'win32' ? dpapiLock : process.platform === 'darwin' ? keychainLock : fileLock;
}
