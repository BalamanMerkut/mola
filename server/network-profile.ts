import { runPowerShell } from './os-lock.js';

/*
 * Windows' network profile ("Ağ profili türü": Genel / Özel) of the connections phones and tablets use. Mola's firewall rule
 * (Mola.exe --guvenlik-duvari, offered by the installer and Tabletler › "İzni düzelt") covers every profile but only the local
 * network (14 Ekim; scripts/desktop/Ortak.cs Firewall). The rule of 0.1.12 and before allowed private networks only: on a
 * connection Windows calls "Genel" (Public) the phones and tablets could not reach Mola. So "Genel" is reported only while the
 * rule is not yet the new one (`covered`); "İzni düzelt" then fixes it, no Windows setting needed.
 * Read only: Get-NetConnectionProfile from the worker thread of server/programs.ts (never on the server's own thread). Mola
 * never changes the profile or the firewall; the owner does it in Windows' Settings (the warning says how). Windows only;
 * elsewhere, and when PowerShell does not answer, there is simply no warning.
 */
export type ProfileReader = () => Promise<{ code: number | null; out: string }>;
/** `public`: the connections (Windows' names, e.g. "Wi-Fi", "Ethernet") phones would use that are on the "Genel" profile. */
export type NetworkProfileView = { checked: boolean; public: string[] };
export type NetworkProfileOptions = {
  /** Tests: a fake PowerShell. */
  read?: ProfileReader;
  platform?: NodeJS.Platform;
  /** The interfaces with the café network addresses phones open (server/desktop.ts lanOrigins); none: nothing to warn about. */
  lan?: () => string[];
  /** True when Mola's firewall rule already lets the local network in on every profile ("Genel" does not matter then). */
  covered?: () => Promise<boolean>;
  /** A result is reused this long (ms): the owner changes the profile and opens the window again. */
  ttlMs?: number;
  now?: () => number;
};
// UTF-8 out, so "Kablosuz Ağ Bağlantısı" arrives as written; one line per connection: "<Public|Private|DomainAuthenticated>|<name>".
const SCRIPT = "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8\nGet-NetConnectionProfile | ForEach-Object { '{0}|{1}' -f $_.NetworkCategory, $_.InterfaceAlias }";
const powershell: ProfileReader = () => runPowerShell(SCRIPT, '', 15_000);

export class NetworkProfile {
  private last?: { at: number; profiles: { category: string; name: string }[] | null; covered: boolean };
  private running?: Promise<void>;
  constructor(readonly options: NetworkProfileOptions = {}) {}
  get supported() { return (this.options.platform ?? process.platform) === 'win32'; }
  /** The connections on "Genel" among those phones use; asks Windows again when the last answer is older than ttlMs. Never throws. */
  async view(): Promise<NetworkProfileView> {
    if (!this.supported) return { checked: false, public: [] };
    // Mola open only to this computer (no café network address): no phone would use any connection, nothing to ask.
    const lan = new Set(this.options.lan?.() ?? []);
    if (!lan.size) return { checked: true, public: [] };
    const now = (this.options.now ?? Date.now)();
    if (!this.last || now - this.last.at >= (this.options.ttlMs ?? 15_000)) await (this.running ??= this.refresh().finally(() => { this.running = undefined; }));
    const profiles = this.last?.profiles;
    if (!profiles) return { checked: false, public: [] };
    if (this.last?.covered) return { checked: true, public: [] };
    return { checked: true, public: [...new Set(profiles.filter(p => p.category === 'Public' && lan.has(p.name)).map(p => p.name))] };
  }
  private async refresh() {
    let profiles: { category: string; name: string }[] | null = null;
    try {
      const { code, out } = await (this.options.read ?? powershell)();
      if (code === 0) profiles = out.split(/\r?\n/).map(line => line.trim()).filter(Boolean).flatMap(line => {
        const at = line.indexOf('|'); return at > 0 ? [{ category: line.slice(0, at).trim(), name: line.slice(at + 1).trim() }] : [];
      });
    } catch { profiles = null; }
    // The firewall rule is asked only when some connection is "Genel" (one helper run, reused with the profiles).
    let covered = false;
    if (profiles?.some(p => p.category === 'Public') && this.options.covered) try { covered = await this.options.covered(); } catch { covered = false; }
    this.last = { at: (this.options.now ?? Date.now)(), profiles, covered };
  }
}
