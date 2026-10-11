import { runProgram } from '../programs.js';
import { backupPlaces, type Place } from '../second-backup.js';

/*
 * "Göz at" in Mola Yönetim (Ayarlar → Yedek → İkinci yedek yeri, Ayarlar → Çalışma klasörü): Windows' own folder window on
 * the computer Mola Merkez runs on. Mola Yönetim is a page on that same computer, so the window opens in front of the vendor;
 * the route (server/merkez/app.ts) answers only an admin session on a direct loopback request (never through a proxy or
 * PUBLIC_ORIGIN, where the server's desktop is not the vendor's). PowerShell starts from the worker program runner
 * (server/programs.ts); the chosen path comes back base64 (UTF-8: "Drive'ım", "Masaüstü" survive any console code page).
 * Anywhere else (macOS, Linux, no PowerShell) the field stays a typed path.
 */
export type PickPurpose = 'second' | 'workfolder';
export type FolderPicker = {
  /** Whether a window can be opened here at all (Windows). */
  available(): boolean;
  /** The chosen folder, or null when the vendor closed the window. Throws when the window could not be opened. */
  pick(o: { purpose: PickPurpose; start?: string | null }): Promise<string | null>;
  /** Quick choices that exist now: Google Drive, OneDrive, flash drives (server/second-backup.ts backupPlaces). */
  places(): Promise<Place[]>;
};
const TITLES: Record<PickPurpose, string> = {
  second: 'Mola Merkez yedeğinin ikinci kopyası için bir klasör seçin (Google Drive, OneDrive ya da flash bellek).',
  workfolder: 'Mola Yönetim çalışma klasörünü seçin (OneDrive ve Google Drive dışında bir klasör).',
};
/** The window stays open while the vendor looks; after this it is closed and the field stays as it was. */
export const PICK_TIMEOUT_MS = 5 * 60_000;
// STA (WinForms needs it) and an invisible top-most owner, so the window comes up over the browser instead of behind it.
// The owner is shown first on purpose: the runner starts PowerShell hidden (windowsHide), and Windows applies that "hidden"
// to a process's first shown window; the owner takes it, the folder window opens normally.
export const PICK_SCRIPT = `$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
$text = { param($line) [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($line)) }
$start = & $text ([Console]::In.ReadLine())
$title = & $text ([Console]::In.ReadLine())
$owner = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true; ShowInTaskbar = $false; Opacity = 0; StartPosition = 'Manual'; Location = (New-Object System.Drawing.Point(-32000, -32000)); Size = (New-Object System.Drawing.Size(1, 1)) }
$owner.Show(); $owner.Activate()
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = $title
$dialog.ShowNewFolderButton = $true
if ($start -and (Test-Path -LiteralPath $start -PathType Container)) { $dialog.SelectedPath = $start }
$answer = $dialog.ShowDialog($owner)
$owner.Dispose()
if ($answer -eq [System.Windows.Forms.DialogResult]::OK -and $dialog.SelectedPath) { [Console]::Out.Write('OK:' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($dialog.SelectedPath))) } else { [Console]::Out.Write('CANCEL') }`;
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

export function folderPicker(o: { run?: typeof runProgram; platform?: NodeJS.Platform; places?: () => Promise<Place[]>; timeoutMs?: number } = {}): FolderPicker {
  const run = o.run ?? runProgram, platform = o.platform ?? process.platform;
  return {
    available: () => platform === 'win32',
    async pick({ purpose, start }) {
      if (platform !== 'win32') throw new Error('Klasör seçme penceresi yalnız Windows’ta açılır.');
      const { code, out } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(PICK_SCRIPT, 'utf16le').toString('base64')],
        { input: `${b64(start ?? '')}\n${b64(TITLES[purpose])}\n`, timeoutMs: o.timeoutMs ?? PICK_TIMEOUT_MS, output: true });
      const answer = out.trim();
      if (code === 0 && answer === 'CANCEL') return null;
      if (code === 0 && answer.startsWith('OK:')) {
        const path = Buffer.from(answer.slice(3), 'base64').toString('utf8');
        if (path && path.length <= 400 && !/[\0\r\n]/.test(path)) return path;
      }
      throw new Error('Klasör seçme penceresi açılamadı.');
    },
    places: o.places ?? (() => platform === 'win32' ? backupPlaces() : Promise.resolve([])),
  };
}
