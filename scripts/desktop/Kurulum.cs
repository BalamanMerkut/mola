// "Mola Kurulum.exe": the Windows installer, the only program at the top of the Windows package. Copies the program from
// the package's "program" folder to %LOCALAPPDATA%\Mola (no admin needed for the files), keeps the café's data and
// backups, adds the desktop / Start menu / Startup shortcuts, the firewall rule for the tablets and starts Mola again.
// Also copies the uninstaller (Mola-Kaldir.exe, scripts/desktop/Kaldir.cs) and lets it list Mola in Windows
// "Ayarlar > Uygulamalar" (HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\Mola), on every install and update.
//
// Order: (an update over a running Mola) ask "Şimdi güncelle / Kapanışta güncelle", take a backup through the running
// server, close the Mola window, shut the server down; copy; register; shortcuts; firewall: if runtime\node.exe has not
// exactly Mola's rule ("Mola", inbound, allow, local network only, Ortak.cs Firewall), Windows asks ONCE for administrator approval (UAC)
// and only "--guvenlik-duvari" runs elevated, before the server ever listens, so Windows' own "Node.js JavaScript
// Runtime" question does not come up; if the owner says no, the installation goes on (Kafe içi cihazlar > "İzni düzelt" later);
// finally the server is started again in the background (Mola.exe --arkaplan).
//
//   "Mola Kurulum.exe"                                              window
//   "Mola Kurulum.exe" --sessiz [--hedef <klasör>] [--kisayolsuz]     no window, exit code 0 = installed, 1 = failed
//                      [--baslatma]                                   do not start the server afterwards
//   "Mola Kurulum.exe" --guvenlik-duvari --hedef <klasör> [--dene]   firewall rule only (started elevated by the window);
//                                                                    --dene prints what it would do, changes nothing
//   --kayit-adi <ad>   another name for the Windows "Uygulamalar" entry (tests: Mola-Test, so the real "Mola" stays)
// Silent mode never asks Windows for administrator rights: the rule is set only when it already runs as administrator.
// Every run appends a short log to <target>\logs\kurulum.log (or %TEMP%\Mola-kurulum.log if the target is unusable).
//
// The same source builds "Mola Yönetim Kurulum.exe" (the vendor's Mola Merkez, /define:YONETIM): names, folder
// (%LOCALAPPDATA%\Mola Yonetim), registry key (MolaYonetim), colours and texts come from Urun.cs (class P). Its firewall
// rule ("Mola Yönetim") only when MERKEZ_LAN=1 (ayarlar.cmd or the environment): otherwise Merkez is on 127.0.0.1 only.
//
// Built by scripts/build-installer.mjs with the C# compiler that ships with Windows (.NET Framework 4), together with
// Urun.cs and Ortak.cs. Keep to C# 5: that compiler does not know newer syntax.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: AssemblyTitle(P.Name + " Kurulum")]
[assembly: AssemblyDescription(P.Description + " kurulumu")]
[assembly: AssemblyProduct(P.Name)]
[assembly: AssemblyCompany("Merkut Studios")]
[assembly: AssemblyCopyright("© 2026 Merkut Studios")]
[assembly: AssemblyVersion("{{VERSION}}.0")]
[assembly: AssemblyFileVersion("{{VERSION}}.0")]

class InstallError : Exception { public InstallError(string message) : base(message) { } }
/// <summary>The owner chose not to update now ("Vazgeç"); nothing was changed.</summary>
class InstallCancelled : Exception { public InstallCancelled(string message) : base(message) { } }

/// <summary>What the installer learnt about a Mola that is running in the target folder.</summary>
class Running {
  /// <summary>The program on the port is this folder's node.exe: the desktop key may be sent to it.</summary>
  public bool Trusted;
  public int OpenAccounts = -1, PendingOrders = -1;
}

class Setup {
  public const string Version = "{{VERSION}}";
  public const string LongPath = "Klasör yolu Windows için çok uzun.\n\nPaketi Masaüstü gibi kısa bir klasöre kopyalayıp yeniden çalıştırın; kurulacak klasör de kısa bir yolda olsun (varsayılan klasör uygundur).";
  // Top-level folders and files of an installation that hold the café's data: never copied over, never deleted.
  static readonly string[] Kept = { "veri", "backups", "backup-keys", "restore-checks", "logs", "pencere" };

  public string Package, Program, Target, KeyName = P.RegKey;
  public bool Desktop = true, Startup = true, Shortcuts = true, NoStart;
  public readonly List<string> Warnings = new List<string>();
  public bool FirewallAdded, FirewallDeclined, FirewallNeeded, Started, Updated;
  public Action<string> Progress = delegate { };
  /// <summary>Window: "simdi" / "kapanis" / "vazgec" for an update over a running Mola. Silent: now.</summary>
  public Func<Running, string> Choose = delegate { return "simdi"; };
  /// <summary>Window: a yes/no question. Silent: yes (the reason goes to the log).</summary>
  public Func<string, bool> Confirm = delegate { return true; };
  /// <summary>Window: true, Windows may ask for administrator approval for the firewall rule. Silent: false.</summary>
  public bool MayElevate;
  public IntPtr Owner = IntPtr.Zero;
  /// <summary>Set by the window while it waits for Mola to be closed ("Kapanışta güncelle").</summary>
  public volatile bool Waiting, Cancelled;
  readonly StringBuilder log = new StringBuilder();

  public Setup() {
    Package = AppDomain.CurrentDomain.BaseDirectory;
    Program = Path.Combine(Package, "program");
    Target = DefaultTarget();
  }

  public static string DefaultTarget() { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), P.Folder); }

  public static bool IsAdmin() { return Local.IsAdmin(); }

  public static string Normalize(string path) {
    string full = Path.GetFullPath(Environment.ExpandEnvironmentVariables(path.Trim().Trim('"')));
    return full.Length > 3 ? full.TrimEnd('\\') : full;
  }

  public void Log(string line) { lock (log) log.AppendLine(DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "  " + line); }

  void Step(string text) { Log(text); Progress(text); }

  // ---------- The installation ----------
  public void Run() {
    Log(P.Name + " " + Version + " kurulumu. Paket: " + Package + "  Hedef: " + Target + "  Yönetici: " + (IsAdmin() ? "evet" : "hayır") +
        "  Kısayollar: " + (Shortcuts ? ("masaüstü=" + Desktop + ", başlangıç=" + Startup) : "yok") + (NoStart ? "  Başlatma: hayır" : ""));
    CheckSource();
    CheckTarget();
    Directory.CreateDirectory(Target);
    int port = Local.Port(Target);
    Running running = null;
    if (Local.OurNodes(Target).Count > 0) running = PrepareUpdate(port);
    StopRunning(port, running);

    int total = CountFiles(Path.Combine(Program, "app")) + CountFiles(Path.Combine(Program, "runtime"));
    int[] done = { 0 };
    Step("Dosyalar kopyalanıyor…");
    Mirror(Path.Combine(Program, "app"), Path.Combine(Target, "app"), done, total);
    Mirror(Path.Combine(Program, "runtime"), Path.Combine(Target, "runtime"), done, total);
    foreach (string name in new string[] { P.Launcher, P.ServerCmd, P.StopCmd, P.Uninstaller }) CopyFile(Path.Combine(Program, name), Path.Combine(Target, name));
    string readme = Path.Combine(Package, "BENIOKU.txt");
    if (File.Exists(readme)) CopyFile(readme, Path.Combine(Target, "BENIOKU.txt"));
    foreach (string old in P.OldItems) DeleteFile(Path.Combine(Target, old));
    Log(done[0] + " dosya denetlendi.");

    if (!File.Exists(Path.Combine(Target, P.Launcher)) || !File.Exists(Path.Combine(Target, P.ServerFile)))
      throw new InstallError("Kopyalama bitti ama " + P.Launcher + " ya da " + P.ServerFile + " hedefte yok. Kurulumu yeniden deneyin.");

    Step("Windows'a kaydediliyor…");
    int registered = RunHidden(Path.Combine(Target, P.Uninstaller), "--kaydet --kayit-adi " + KeyName, 30000);
    Log("Windows \"Uygulamalar\" kaydı (" + KeyName + "): " + (registered == 0 ? "yazıldı" : "yazılamadı, çıkış kodu " + registered));
    if (registered != 0) Warnings.Add(P.Name + ", Windows \"Uygulamalar\" listesine eklenemedi. Kaldırmak için " + Path.Combine(Target, P.Uninstaller) + " dosyasını çalıştırın.");
    if (Shortcuts) { Step("Simgeler ekleniyor…"); MakeShortcuts(); }
    EnsureFirewall();
    if (NoStart) Log("Sunucu başlatılmadı (--baslatma).");
    else StartServer();
    foreach (string w in Warnings) Log("Uyarı: " + w);
    Step("Kurulum tamamlandı.");
  }

  void CheckSource() {
    // Windows (and .NET Framework here) stops at 260 characters: a package deep in a folder tree fails with a vague error.
    // Checked before anything is copied, for the package and for the target folder.
    try {
      int deepest = 0;
      foreach (string file in Directory.GetFiles(Program, "*", SearchOption.AllDirectories)) deepest = Math.Max(deepest, file.Length - Program.TrimEnd('\\').Length);
      if (Program.TrimEnd('\\').Length + deepest >= 248 || Target.Length + deepest >= 248) throw new PathTooLongException();
    } catch (PathTooLongException) { throw new InstallError(LongPath); } catch (DirectoryNotFoundException) { }
    foreach (string need in new string[] { P.ServerFile, "app\\manifest.json", "runtime\\node.exe", P.Launcher, P.ServerCmd, P.StopCmd, P.Uninstaller })
      if (!File.Exists(Path.Combine(Program, need)))
        throw new InstallError("Kurulum dosyaları eksik (" + "program\\" + need + " yok).\n\n\"" + P.Setup + "\" ile \"program\" klasörü yan yana olmalı. " +
          P.PackageFolder + " klasörünün tamamını kopyalayın; ZIP içindeyse önce dışarı çıkarın.");
  }

  void CheckTarget() {
    string target = Target, program = Normalize(Program);
    if (Path.GetPathRoot(target).TrimEnd('\\').Equals(target.TrimEnd('\\'), StringComparison.OrdinalIgnoreCase))
      throw new InstallError("Bir sürücünün kökü seçilemez (" + target + "). İçinde bir klasör seçin, örneğin " + Path.Combine(target, P.Folder) + ".");
    if (Inside(target, program))
      throw new InstallError(P.Name + ", kurulum paketinin \"program\" klasörüne kurulamaz. Başka bir klasör seçin.");
    // The program folders are mirrored (extra files deleted); refuse folders with these names that are not Mola's.
    if (Directory.Exists(Path.Combine(target, "app")) && !File.Exists(Path.Combine(target, "app\\manifest.json")) && Directory.GetFileSystemEntries(Path.Combine(target, "app")).Length > 0)
      throw new InstallError("Seçilen klasörde " + P.Dat + " ait olmayan bir \"app\" klasörü var (" + target + "). Boş ya da yeni bir klasör seçin.");
    if (Directory.Exists(Path.Combine(target, "runtime")) && !File.Exists(Path.Combine(target, "runtime\\node.exe")) && Directory.GetFileSystemEntries(Path.Combine(target, "runtime")).Length > 0)
      throw new InstallError("Seçilen klasörde " + P.Dat + " ait olmayan bir \"runtime\" klasörü var (" + target + "). Boş ya da yeni bir klasör seçin.");
  }

  // ---------- Updating over a running Mola ----------
  Running PrepareUpdate(int port) {
    Running info = Inspect(port);
    Log("Çalışan " + P.Name + " bulundu (port " + port + ", " + (info.Trusted ? "bu kuruluma ait" : "yanıt vermiyor") + ")" +
        (info.OpenAccounts >= 0 ? ": " + info.OpenAccounts + " açık masa/hesap, " + info.PendingOrders + " bekleyen sipariş." : "."));
    string choice = Choose(info);
    Log("Seçim: " + (choice == "kapanis" ? "kapanışta güncelle" : choice == "simdi" ? "şimdi güncelle" : "vazgeç"));
    if (choice == "vazgec") throw new InstallCancelled("Güncelleme yapılmadı; " + P.Name + " çalışmaya devam ediyor.");
    string note;
    bool backedUp = Backup(info, port, out note);
    if (choice == "kapanis") {
      Waiting = true;
      try {
        Step(P.Name + " kapatılınca güncelleme kendiliğinden başlar…");
        while (Local.OurNodes(Target).Count > 0) {
          if (Cancelled) throw new InstallCancelled("Güncelleme yapılmadı; " + P.Name + " çalışmaya devam ediyor.");
          Thread.Sleep(2000);
        }
      } finally { Waiting = false; }
      Log(P.Name + " kapatıldı; güncelleme başlıyor.");
      info.Trusted = false;  // nothing to ask any more
    } else if (!backedUp && !Confirm("Güncelleme öncesi yedek alınamadı: " + note + "\n\nVerileriniz güncellemede korunur ve son otomatik yedek duruyor. Yine de şimdi güncellensin mi?")) {
      throw new InstallCancelled("Güncelleme yapılmadı; " + P.Name + " çalışmaya devam ediyor.");
    }
    Updated = true;
    return info;
  }

  Running Inspect(int port) {
    Running info = new Running();
    int pid = Local.ListenerPid(port);
    info.Trusted = pid > 0 && Local.Mine(Target, pid);
#if !YONETIM
    string body;
    if (info.Trusted && Local.Call("GET", "http://127.0.0.1:" + port + "/api/desktop/activity", Local.Key(Target), 3000, out body) == 200) {
      info.OpenAccounts = Local.Number(body, "openAccounts"); info.PendingOrders = Local.Number(body, "pendingOrders");
    }
#endif
    return info;
  }

  /// <summary>A backup through the running café server (rail "Yedekle" does the same). Mola Merkez relies on its own nightly backup.</summary>
  bool Backup(Running info, int port, out string note) {
#if YONETIM
    note = "Mola Merkez her gece kendini yedekler (merkez-yedek klasörü); güncellemede veriler korunur";
    Log("Yedek: " + note + ".");
    return true;
#else
    note = "";
    if (!info.Trusted) { note = "çalışan Mola yanıt vermiyor"; Log("Güncelleme öncesi yedek alınamadı: " + note + "."); return false; }
    Step("Güncelleme öncesi yedek alınıyor…");
    string body;
    int code = Local.Call("POST", "http://127.0.0.1:" + port + "/api/desktop/backup", Local.Key(Target), 15 * 60000, out body);
    if (code == 200 && System.Text.RegularExpressions.Regex.IsMatch(body, "\"lastError\"\\s*:\\s*null")) { Log("Güncelleme öncesi yedek alındı."); return true; }
    System.Text.RegularExpressions.Match m = System.Text.RegularExpressions.Regex.Match(body, "\"(?:message|lastError)\"\\s*:\\s*\"([^\"]*)\"");
    note = code == 0 ? "Mola yanıt vermedi" : m.Success ? m.Groups[1].Value : "yanıt " + code;
    Log("Güncelleme öncesi yedek alınamadı: " + note + ".");
    return false;
#endif
  }

  /// <summary>Closes the Mola window, lets the server finish its requests and close, then makes sure nothing of this folder runs.</summary>
  void StopRunning(int port, Running info) {
    int windows = Browser.Close(Target);
    if (windows > 0) Log(P.Name + " penceresi kapatıldı.");
    if (Local.OurNodes(Target).Count == 0) { KillLeftovers(); return; }
    Step("Çalışan " + P.Name + " durduruluyor…");
#if !YONETIM
    string body;
    if (info != null && info.Trusted && Local.Call("POST", "http://127.0.0.1:" + port + "/api/desktop/shutdown", Local.Key(Target), 5000, out body) == 200) {
      for (int i = 0; i < 60 && Local.OurNodes(Target).Count > 0; i++) Thread.Sleep(250);
      Log(Local.OurNodes(Target).Count == 0 ? "Sunucu kendisi kapandı." : "Sunucu 15 sn içinde kapanmadı.");
    }
#endif
    string stop = Path.Combine(Target, P.StopCmd);
    if (Local.OurNodes(Target).Count > 0 && File.Exists(stop)) RunHidden("cmd.exe", "/d /c \"\"" + stop + "\"\"", 30000);
    for (int i = 0; i < 40 && Local.OurNodes(Target).Count > 0; i++) Thread.Sleep(250);
    KillLeftovers();
  }

  /// <summary>node.exe and the launcher of this folder (an older Mola-Durdur.cmd stops only the server).</summary>
  void KillLeftovers() {
    foreach (string name in new string[] { "node", Path.GetFileNameWithoutExtension(P.Launcher) }) {
      foreach (Process p in Process.GetProcessesByName(name)) {
        using (p) {
          string exe = Local.ImagePath(p.Id);
          if (exe == null || !Inside(exe, Target)) continue;
          try { p.Kill(); p.WaitForExit(5000); Log("Durduruldu: " + exe + " (" + p.Id + ")"); } catch (Exception e) { Log("Durdurulamadı: " + exe + ": " + e.Message); }
        }
      }
    }
  }

  // ---------- Firewall: before the server listens, so Windows' own question does not come up ----------
  void EnsureFirewall() {
    if (P.FirewallOnlyWithLan && !Lan()) { Log("Güvenlik duvarı izni gerekmiyor (Merkez yalnız bu bilgisayardan erişilir; MERKEZ_LAN yok)."); return; }
    if (!P.FirewallOnlyWithLan && Local.Setting(Target, "MOLA_LAN") == "0") { Log("Güvenlik duvarı izni gerekmiyor (ayarlar.cmd: MOLA_LAN=0, yalnız bu bilgisayar)."); return; }
    string node = Local.Node(Target);
    List<Firewall.Rule> rules = Firewall.Inbound(node);
    if (rules == null) { Log("Güvenlik duvarı kuralları okunamadı."); FirewallNeeded = true; return; }
    if (Firewall.Exact(rules, P.FirewallRule)) { Log("Güvenlik duvarı: \"" + P.FirewallRule + "\" kuralı zaten var (yerel ağ)."); FirewallAdded = true; return; }
    foreach (Firewall.Rule r in rules) Log("Güvenlik duvarı: bu program için " + Firewall.Describe(r) + " kuralı var; düzeltilecek.");
    FirewallNeeded = true;
    if (IsAdmin()) { Step("Güvenlik duvarı izni ekleniyor…"); FirewallAdded = SetFirewall(false); }
    else if (MayElevate) {
      Step("Güvenlik duvarı izni için Windows onay istiyor…");
      int code = Firewall.Elevated("--guvenlik-duvari --hedef \"" + Target + "\"", Owner);
      FirewallAdded = code == 0; FirewallDeclined = code == 3;
      Log("Güvenlik duvarı (yönetici olarak): " + (code == 0 ? "izin eklendi" : code == 3 ? "Windows onayı verilmedi" : "eklenemedi, çıkış kodu " + code));
    } else Log("Yönetici değil (sessiz kurulum): güvenlik duvarı izni eklenmedi.");
    if (!FirewallAdded) Warnings.Add((FirewallDeclined ? "Güvenlik duvarı izni verilmedi. " : "Güvenlik duvarı izni eklenemedi. ") + P.FirewallHint);
  }

  /// <summary>Mola Yönetim: Merkez open to the network (ayarlar.cmd wins over the environment, as in Merkez-Sunucu.cmd).</summary>
  bool Lan() {
    string value = Local.Setting(Target, "MERKEZ_LAN");
    if (value.Length == 0) value = Environment.GetEnvironmentVariable("MERKEZ_LAN") ?? "";
    return value == "1";
  }

  /// <summary>Administrator (or dry run): only Mola's rule for this node.exe stays. Also "--guvenlik-duvari --hedef".</summary>
  public bool SetFirewall(bool dry) {
    string node = Local.Node(Target);
    List<Firewall.Rule> rules = Firewall.Inbound(node);
    if (rules == null) { Log("Güvenlik duvarı kuralları okunamadı."); return false; }
    List<string> plan = Firewall.Plan(node, P.FirewallRule, rules, true);
    if (dry) {
      Firewall.Print("DENEME: hiçbir şey değiştirilmez. Program: " + node + "  Yönetici: " + (IsAdmin() ? "evet" : "hayır"));
      Firewall.Print("Bu program için gelen bağlantı kuralları: " + (rules.Count == 0 ? "yok" : ""));
      foreach (Firewall.Rule r in rules) Firewall.Print("  " + Firewall.Describe(r) + "  " + r.Program);
      Firewall.Print(plan.Count == 0 ? "Değişiklik gerekmiyor." : "Çalıştırılacak komutlar:");
    }
    Firewall.Run(plan, dry, dry ? (Action<string>)(line => { Firewall.Print("  " + line); Log("Güvenlik duvarı (deneme): " + line); }) : (line => Log("Güvenlik duvarı: " + line)));
    if (dry) return true;
    bool ok = Firewall.Exact(Firewall.Inbound(node), P.FirewallRule);
    Log("Güvenlik duvarı kuralı (" + node + "): " + (ok ? "hazır" : "kurulamadı"));
    return ok;
  }

  // ---------- Start again ----------
  void StartServer() {
    Step(P.Name + " başlatılıyor…");
    int code = RunHidden(Path.Combine(Target, P.Launcher), "--arkaplan", 120000);
    Started = code == 0;
    Log("Sunucu: " + (code == 0 ? "çalışıyor" : code == 2 ? "başlatılamadı, bağlantı noktası başka bir programda" : "başlatılamadı, çıkış kodu " + code));
    if (code == 2) Warnings.Add(P.Name + " başlatılamadı: " + Local.Port(Target) + " numaralı bağlantı noktasını başka bir program kullanıyor. " + P.Acc + " açınca ne yapılacağı yazar.");
    else if (code != 0) Warnings.Add(P.Name + " başlatılamadı. Ayrıntılar: " + Path.Combine(Target, P.ServerLog));
  }

  static bool Inside(string path, string folder) {
    string a = path.TrimEnd('\\') + "\\", b = folder.TrimEnd('\\') + "\\";
    return a.StartsWith(b, StringComparison.OrdinalIgnoreCase);
  }

  static bool IsKept(string name) {
    foreach (string k in Kept) if (name.Equals(k, StringComparison.OrdinalIgnoreCase)) return true;
    return name.EndsWith(".anahtar", StringComparison.OrdinalIgnoreCase) || name.IndexOf("-tasima-oncesi-", StringComparison.OrdinalIgnoreCase) >= 0;
  }

  static int CountFiles(string dir) { return Directory.GetFiles(dir, "*", SearchOption.AllDirectories).Length; }

  // Like robocopy /MIR: copies new and changed files, deletes what the new version no longer has. Data names are skipped.
  void Mirror(string source, string target, int[] done, int total) {
    if (File.Exists(target)) DeleteFile(target);
    Directory.CreateDirectory(target);
    HashSet<string> wanted = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
    foreach (string dir in Directory.GetDirectories(source)) {
      string name = Path.GetFileName(dir); wanted.Add(name);
      Mirror(dir, Path.Combine(target, name), done, total);
    }
    foreach (string file in Directory.GetFiles(source)) {
      string name = Path.GetFileName(file); wanted.Add(name);
      string to = Path.Combine(target, name);
      if (Directory.Exists(to)) DeleteDirectory(to);
      FileInfo a = new FileInfo(file), b = new FileInfo(to);
      if (!b.Exists || a.Length != b.Length || a.LastWriteTimeUtc != b.LastWriteTimeUtc) CopyFile(file, to);
      done[0]++;
      if (done[0] % 40 == 0 || done[0] == total) Progress("Dosyalar kopyalanıyor… " + (total > 0 ? (done[0] * 100 / total) : 100) + "%");
    }
    foreach (string entry in Directory.GetFileSystemEntries(target)) {
      string name = Path.GetFileName(entry);
      if (wanted.Contains(name) || IsKept(name)) continue;
      if (Directory.Exists(entry)) DeleteDirectory(entry); else DeleteFile(entry);
    }
  }

  // A running Mola can hold files for a few seconds after it stops: retry instead of failing at once.
  static void CopyFile(string from, string to) {
    for (int attempt = 1; ; attempt++) {
      try {
        if (File.Exists(to)) File.SetAttributes(to, FileAttributes.Normal);
        File.Copy(from, to, true);
        return;
      } catch (PathTooLongException) { throw; }
      catch (IOException) { if (attempt >= 20) throw; Thread.Sleep(500); }
      catch (UnauthorizedAccessException) { if (attempt >= 20) throw; Thread.Sleep(500); }
    }
  }

  static void DeleteFile(string path) {
    if (!File.Exists(path)) return;
    for (int attempt = 1; ; attempt++) {
      try { File.SetAttributes(path, FileAttributes.Normal); File.Delete(path); return; }
      catch (PathTooLongException) { throw; }
      catch (IOException) { if (attempt >= 10) throw; Thread.Sleep(500); }
      catch (UnauthorizedAccessException) { if (attempt >= 10) throw; Thread.Sleep(500); }
    }
  }

  static void DeleteDirectory(string path) {
    foreach (string file in Directory.GetFiles(path)) DeleteFile(file);
    foreach (string dir in Directory.GetDirectories(path)) DeleteDirectory(dir);
    Directory.Delete(path, false);
  }

  static int RunHidden(string file, string arguments, int timeout) {
    ProcessStartInfo info = new ProcessStartInfo(file, arguments);
    info.UseShellExecute = false; info.CreateNoWindow = true; info.WindowStyle = ProcessWindowStyle.Hidden;
    if (Path.IsPathRooted(file)) info.WorkingDirectory = Path.GetDirectoryName(file);
    using (Process p = System.Diagnostics.Process.Start(info)) {
      if (!p.WaitForExit(timeout)) { try { p.Kill(); } catch (Exception) { } return -1; }
      return p.ExitCode;
    }
  }

  // ---------- Shortcuts (WScript.Shell through late binding: C# 5 here has no "dynamic") ----------
  void MakeShortcuts() {
    string exe = Path.Combine(Target, P.Launcher), link = P.Name + ".lnk";
    try {
      // The Start menu and desktop "Mola" carry this installation's taskbar identity (Ortak.cs, Taskbar): the Mola window
      // (Edge/Chrome app mode) gets the same one, so the taskbar shows this shortcut's icon (Mola.exe, 16–256 px), not the
      // page's enlarged favicon.
      string menu = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), link);
      Shortcut(menu, exe, "");
      Identity(menu);
      Shortcut(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), P.UninstallShortcut + ".lnk"), Path.Combine(Target, P.Uninstaller), KeyName == P.RegKey ? "" : "--kayit-adi " + KeyName);
      if (Desktop) { string onDesktop = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), link); Shortcut(onDesktop, exe, ""); Identity(onDesktop); }
      string startup = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Startup), link);
      if (Startup) Shortcut(startup, exe, "--arkaplan");
      else if (File.Exists(startup)) { DeleteFile(startup); Log("Başlangıç kısayolu kaldırıldı (\"Bilgisayar açılınca başlat\" seçilmedi)."); }
    } catch (Exception e) {
      Warnings.Add("Simgeler eklenemedi (" + Inner(e).Message + "). " + P.Acc + " " + exe + " dosyasından açabilirsiniz.");
    }
  }

  void Shortcut(string path, string exe, string arguments) {
    Directory.CreateDirectory(Path.GetDirectoryName(path));
    Type type = Type.GetTypeFromProgID("WScript.Shell", true);
    object shell = Activator.CreateInstance(type);
    object link = type.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { path });
    Type lt = link.GetType();
    lt.InvokeMember("TargetPath", BindingFlags.SetProperty, null, link, new object[] { exe });
    lt.InvokeMember("Arguments", BindingFlags.SetProperty, null, link, new object[] { arguments });
    lt.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, link, new object[] { Target });
    lt.InvokeMember("Description", BindingFlags.SetProperty, null, link, new object[] { P.Description });
    lt.InvokeMember("IconLocation", BindingFlags.SetProperty, null, link, new object[] { exe + ",0" });
    lt.InvokeMember("Save", BindingFlags.InvokeMethod, null, link, null);
    Log("Kısayol: " + path);
  }

  void Identity(string link) {
    Log(Taskbar.TagShortcut(link, Target, null) ? "Görev çubuğu kimliği: " + Taskbar.Id(Target) + " (" + Path.GetFileName(link) + ")" : "Görev çubuğu kimliği yazılamadı: " + link);
  }

  public static Exception Inner(Exception e) { return e is TargetInvocationException && e.InnerException != null ? e.InnerException : e; }

  public string SaveLog() {
    string text; lock (log) { text = log.ToString(); log.Clear(); }
    try {
      string dir = Path.Combine(Target, "logs");
      Directory.CreateDirectory(dir);
      string file = Path.Combine(dir, "kurulum.log");
      File.AppendAllText(file, text + Environment.NewLine, Encoding.UTF8);
      return file;
    } catch (Exception) {
      try { string file = Path.Combine(Path.GetTempPath(), "Mola-kurulum.log"); File.AppendAllText(file, text + Environment.NewLine, Encoding.UTF8); return file; } catch (Exception) { return null; }
    }
  }

  public void LogFailure(Exception e) {
    Log((Inner(e) is InstallCancelled ? "" : "Hata: ") + Describe(e));
    if (!(Inner(e) is InstallError) && !(Inner(e) is InstallCancelled) && !(Inner(e) is PathTooLongException)) Log(Inner(e).ToString());
  }

  /// <summary>
  /// The Node.js runtime in runtime\ (shipped in the package, nothing is downloaded) needs 64-bit Windows 10 or newer.
  /// Environment.OSVersion lies without a compatibility manifest, so the registry value only Windows 10+ has is read.
  /// </summary>
  public static string UnsupportedSystem() {
    if (!Environment.Is64BitOperatingSystem) return P.Name + " 64 bit Windows 10 ya da 11 ister; bu bilgisayarda 32 bit Windows var.\n\nBu bilgisayara kurulamaz. Mola ekibiyle görüşün.";
    object major = null;
    try { using (RegistryKey k = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\Microsoft\Windows NT\CurrentVersion")) if (k != null) major = k.GetValue("CurrentMajorVersionNumber"); } catch (Exception) { }
    if (!(major is int) || (int)major < 10) return P.Name + " Windows 10 ya da 11 ister; bu bilgisayarda daha eski bir Windows var (Windows 7 / 8).\n\nWindows'u güncelleyin ya da Mola ekibiyle görüşün.";
    return null;
  }

  public static string Describe(Exception e) {
    e = Inner(e);
    if (e is InstallError || e is InstallCancelled) return e.Message;
    if (e is PathTooLongException) return LongPath;
    if (e is UnauthorizedAccessException) return "Klasöre yazma izni yok: " + e.Message + "\n\nBaşka bir klasör seçin ya da açık " + P.Name + " pencerelerini kapatıp yeniden deneyin.";
    if (e is IOException) return "Dosyalar kopyalanamadı: " + e.Message + "\n\n" + P.CloseHint + ", diskte yer olduğundan emin olun ve yeniden deneyin.";
    return "Beklenmeyen hata: " + e.Message;
  }
}

static class Entry {
  [STAThread]
  static int Main(string[] args) {
    Ui.DpiAware();
    bool silent = false, firewallOnly = false, dry = false;
    Setup setup = new Setup();
    try {
      for (int i = 0; i < args.Length; i++) {
        string a = args[i].ToLowerInvariant();
        if (a == "--sessiz") silent = true;
        else if (a == "--kisayolsuz") setup.Shortcuts = false;
        else if (a == "--baslatma") setup.NoStart = true;
        else if (a == "--guvenlik-duvari") firewallOnly = true;
        else if (a == "--dene") dry = true;
        else if (a == "--hedef" && i + 1 < args.Length) setup.Target = args[++i];
        else if (a == "--kayit-adi" && i + 1 < args.Length) setup.KeyName = args[++i];
        else throw new InstallError("Bilinmeyen seçenek: " + args[i] + "\nKullanım: \"" + P.Setup + "\" [--sessiz] [--hedef <klasör>] [--kisayolsuz] [--baslatma] [--kayit-adi <ad>]");
      }
      if (setup.KeyName.Length == 0 || setup.KeyName.Length > 40 || !System.Text.RegularExpressions.Regex.IsMatch(setup.KeyName, "^[A-Za-z0-9_-]+$"))
        throw new InstallError("Kayıt adı yalnız harf, rakam, - ve _ içerebilir: " + setup.KeyName);
      if (dry && !firewallOnly) throw new InstallError("--dene yalnız --guvenlik-duvari ile kullanılır.");
      setup.Target = Setup.Normalize(setup.Target);
      if (!firewallOnly) { string old = Setup.UnsupportedSystem(); if (old != null) throw new InstallError(old); }
    } catch (Exception e) {
      setup.Log("Hata: " + Setup.Describe(e)); setup.SaveLog();
      if (!silent && !firewallOnly) MessageBox.Show(Setup.Describe(e), P.Name + " kurulumu", MessageBoxButtons.OK, MessageBoxIcon.Error);
      return 1;
    }

    if (firewallOnly) {
      bool ok;
      if (!dry && !Setup.IsAdmin()) { setup.Log("Güvenlik duvarı: yönetici yetkisi yok."); ok = false; }
      else ok = setup.SetFirewall(dry);
      setup.SaveLog();
      return ok ? 0 : 1;
    }

    if (silent) {
      try { setup.Run(); setup.SaveLog(); return 0; }
      catch (Exception e) { setup.LogFailure(e); setup.SaveLog(); return 1; }
    }

    Application.EnableVisualStyles();
    Application.SetCompatibleTextRenderingDefault(false);
    Application.Run(new SetupWindow(setup));
    return 0;
  }
}

// ---------- The window: Mola colours, like the splash of Mola.exe. Pixel values are for 96 DPI and go through Ui.S ----------
class SetupWindow : Form {
#if YONETIM
  const int OpenWidth = 170;
#else
  const int OpenWidth = 120;
#endif
  static readonly Color Green = P.Back, Field = P.Field, Cream = P.Cream, Soft = P.Soft, Warn = P.Warn;
  readonly Setup setup;
  readonly Label heading = new Label(), sentence = new Label(), folderTitle = new Label(), status = new Label(), note = new Label();
  readonly TextBox folder = new TextBox();
  readonly Button change = new Button(), install = new Button(), open = new Button(), close = new Button();
  readonly CheckBox desktop = new CheckBox(), startup = new CheckBox();
  readonly LinkLabel elevate = new LinkLabel();
  bool busy;

  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern bool ShutdownBlockReasonCreate(IntPtr hWnd, string reason);
  [DllImport("user32.dll")] static extern bool ShutdownBlockReasonDestroy(IntPtr hWnd);

  public SetupWindow(Setup s) {
    setup = s;
    Text = P.Name + " kurulumu"; BackColor = Green; ForeColor = Cream; Font = new Font("Segoe UI", 10f);
    FormBorderStyle = FormBorderStyle.FixedSingle; MaximizeBox = false; StartPosition = FormStartPosition.CenterScreen; ClientSize = Ui.Z(540, 360);
    Icon = Ui.AppIcon();

    Place(heading, P.Name + " kurulumu"); heading.Font = new Font("Georgia", 20f);
    Place(sentence, P.SetupSentence); sentence.ForeColor = Soft;
    Place(folderTitle, "Kurulacak klasör"); folderTitle.ForeColor = Soft; folderTitle.Font = new Font("Segoe UI", 9f);
    folder.ReadOnly = true; folder.BorderStyle = BorderStyle.FixedSingle; folder.BackColor = Field; folder.ForeColor = Cream; folder.Text = setup.Target;
    folder.TabStop = false; Controls.Add(folder);
    Style(change, "Değiştir", 100, 29, false); change.Click += delegate { Choose(); };
    desktop.Text = "Masaüstüne simge ekle"; desktop.Checked = true; desktop.AutoSize = true; Controls.Add(desktop);
    startup.Text = P.StartupLabel; startup.Checked = true; startup.AutoSize = true; Controls.Add(startup);
    if (!setup.Shortcuts) { desktop.Checked = startup.Checked = false; desktop.Enabled = startup.Enabled = false; }
    Place(note, ""); note.ForeColor = Soft; note.Visible = false;
    elevate.Text = "Yönetici olarak izin ver"; elevate.LinkColor = Warn; elevate.ActiveLinkColor = Cream; elevate.AutoSize = true; elevate.Visible = false;
    elevate.LinkClicked += delegate { Elevate(); }; Controls.Add(elevate);
    Place(status, ""); status.ForeColor = Soft;
    Style(install, "Kur", 130, 36, true); install.Click += delegate { Start(); };
    Style(open, P.Acc + " aç", OpenWidth, 36, true); open.Visible = false; open.Click += delegate { OpenMola(); };
    Style(close, "Kapat", 100, 36, false); close.Visible = false; close.Click += delegate { if (setup.Waiting) { setup.Cancelled = true; close.Enabled = false; } else Close(); };
    AcceptButton = install; ActiveControl = install;
    FormClosing += (sender, e) => {
      if (setup.Waiting) { setup.Cancelled = true; return; }  // nothing changed yet: closing just gives up waiting
      if (!busy) return;
      e.Cancel = true;
      if (e.CloseReason == CloseReason.WindowsShutDown) ShutdownBlockReasonCreate(Handle, P.Name + " güncelleniyor; birkaç saniye bekleyin.");
    };
    Relayout();
  }

  /// <summary>Top to bottom; wrapped texts get the height they need at this screen's DPI (no cut lines).</summary>
  void Relayout() {
    int x = Ui.S(30), width = Ui.S(480);
    heading.SetBounds(Ui.S(28), Ui.S(20), width, Ui.S(40));
    sentence.SetBounds(x, heading.Bottom + Ui.S(8), width, 10); sentence.Height = Ui.TextHeight(sentence, 22);
    int y = sentence.Bottom + Ui.S(12);
    folderTitle.SetBounds(x, y, Ui.S(300), Ui.S(20));
    folder.SetBounds(x, folderTitle.Bottom + Ui.S(3), Ui.S(370), folder.Height);
    change.SetBounds(Ui.S(410), folder.Top - Ui.S(2), Ui.S(100), Math.Max(Ui.S(29), folder.Height + Ui.S(4)));
    y = folder.Bottom + Ui.S(16);
    if (IsShown(desktop)) { desktop.Location = new Point(x, y); startup.Location = new Point(x, desktop.Bottom + Ui.S(6)); y = startup.Bottom + Ui.S(12); }
    if (IsShown(note)) { note.SetBounds(x, y, width, 10); note.Height = Math.Min(Ui.S(150), Ui.TextHeight(note, 20)); y = note.Bottom + Ui.S(6); }
    if (IsShown(elevate)) { elevate.Location = new Point(x, y); y = elevate.Bottom + Ui.S(6); }
    y = Math.Max(y + Ui.S(8), Ui.S(200));
    int right = Ui.S(510), buttonHeight = Ui.S(36);
    install.SetBounds(right - Ui.S(130), y, Ui.S(130), buttonHeight);
    close.SetBounds(right - Ui.S(100), y, Ui.S(100), buttonHeight);
    open.SetBounds(close.Left - Ui.S(10) - Ui.S(OpenWidth), y, Ui.S(OpenWidth), buttonHeight);
    int statusRight = (IsShown(install) ? install.Left : IsShown(open) ? open.Left : IsShown(close) ? close.Left : right) - Ui.S(14);
    status.SetBounds(x, y, statusRight - x, 10); status.Height = Math.Max(buttonHeight, Ui.TextHeight(status, 20));
    ClientSize = new Size(Ui.S(540), Math.Max(status.Bottom, install.Bottom) + Ui.S(22));
  }

  // Its own "visible" flag: Control.Visible reads false for every control until the window itself is on screen.
  static readonly MethodInfo GetState = typeof(Control).GetMethod("GetState", BindingFlags.Instance | BindingFlags.NonPublic);
  static bool IsShown(Control c) { try { return (bool)GetState.Invoke(c, new object[] { 2 /* STATE_VISIBLE */ }); } catch (Exception) { return c.Visible; } }

  void Place(Label label, string text) {
    label.Text = text; label.BackColor = Color.Transparent; Controls.Add(label);
  }

  void Style(Button button, string text, int w, int h, bool primary) {
    button.Text = text; button.Size = Ui.Z(w, h); button.FlatStyle = FlatStyle.Flat; button.Cursor = Cursors.Hand;
    button.FlatAppearance.BorderColor = Cream; button.FlatAppearance.BorderSize = 1;
    button.BackColor = primary ? Cream : Green; button.ForeColor = primary ? Green : Cream;
    if (primary) button.Font = new Font("Segoe UI", 10f, FontStyle.Bold);
    Controls.Add(button);
  }

  // A chosen parent folder gets its own "Mola" ("Mola Yonetim") subfolder, so the program never mixes with other files.
  void Choose() {
    using (FolderBrowserDialog dialog = new FolderBrowserDialog()) {
      dialog.Description = P.ChooseText;
      dialog.SelectedPath = Directory.Exists(setup.Target) ? setup.Target : Path.GetDirectoryName(setup.Target);
      if (dialog.ShowDialog(this) != DialogResult.OK || string.IsNullOrEmpty(dialog.SelectedPath)) return;
      string path = dialog.SelectedPath;
      if (!Path.GetFileName(path.TrimEnd('\\')).Equals(P.Folder, StringComparison.OrdinalIgnoreCase) && !File.Exists(Path.Combine(path, P.Launcher))) path = Path.Combine(path, P.Folder);
      try { setup.Target = Setup.Normalize(path); folder.Text = setup.Target; }
      catch (PathTooLongException) { MessageBox.Show(this, Setup.LongPath, P.Name + " kurulumu", MessageBoxButtons.OK, MessageBoxIcon.Warning); }
    }
  }

  void SetStatus(string text) { status.Text = text; Relayout(); }

  void Start() {
    busy = true; install.Enabled = false; change.Enabled = false; desktop.Enabled = false; startup.Enabled = false;
    status.ForeColor = Soft; SetStatus("Başlıyor…");
    setup.Desktop = desktop.Checked; setup.Startup = startup.Checked; setup.Warnings.Clear(); setup.Cancelled = false;
    setup.MayElevate = true; setup.Owner = Handle;
    setup.Progress = text => BeginInvoke((MethodInvoker)delegate {
      SetStatus(text);
      // "Kapanışta güncelle": nothing has changed yet, the window may be closed; "Vazgeç" gives up waiting.
      busy = !setup.Waiting;
      install.Visible = !setup.Waiting; close.Visible = setup.Waiting; close.Text = "Vazgeç"; close.Enabled = true; Relayout();
    });
    setup.Choose = info => (string)Invoke(new Func<string>(() => UpdateDialog.Ask(this, info)));
    setup.Confirm = text => (bool)Invoke(new Func<bool>(() => MessageBox.Show(this, text, P.Name + " kurulumu", MessageBoxButtons.YesNo, MessageBoxIcon.Warning, MessageBoxDefaultButton.Button2) == DialogResult.Yes));
    Thread worker = new Thread(() => {
      Exception error = null;
      try { setup.Run(); } catch (Exception e) { error = e; setup.LogFailure(e); }
      string logFile = setup.SaveLog();
      try { BeginInvoke((MethodInvoker)delegate { Finished(error, logFile); }); } catch (InvalidOperationException) { }  // window closed while waiting
    });
    // Shortcuts (WScript.Shell) and the Windows administrator question (ShellExecute "runas") want a single-threaded apartment.
    worker.SetApartmentState(ApartmentState.STA);
    worker.IsBackground = true; worker.Start();
  }

  void Finished(Exception error, string logFile) {
    busy = false;
    try { ShutdownBlockReasonDestroy(Handle); } catch (Exception) { }
    close.Visible = false; close.Text = "Kapat"; install.Visible = true;
    if (error != null) {
      bool cancelled = Setup.Inner(error) is InstallCancelled;
      status.ForeColor = cancelled ? Soft : Warn;
      install.Text = cancelled ? "Kur" : "Yeniden dene"; install.Enabled = true; change.Enabled = true; desktop.Enabled = startup.Enabled = setup.Shortcuts;
      SetStatus(cancelled ? Setup.Describe(error) : "Kurulum yarıda kaldı. Verileriniz değiştirilmedi.");
      if (!cancelled) MessageBox.Show(this, Setup.Describe(error) + "\n\nVerileriniz ve yedekleriniz değiştirilmedi." + (logFile != null ? "\nAyrıntılar: " + logFile : ""), P.Name + " kurulumu", MessageBoxButtons.OK, MessageBoxIcon.Error);
      return;
    }
    heading.Text = setup.Updated ? "Güncelleme tamamlandı" : "Kurulum tamamlandı";
    sentence.Text = (setup.Updated ? P.Name + " güncellendi" : P.Name + " kuruldu") + (setup.Started ? " ve çalışıyor" : "") + ". " +
      (setup.Desktop && setup.Shortcuts ? "Bundan sonra masaüstündeki " + P.Name + " simgesiyle açabilirsiniz." : "Bundan sonra Başlat menüsündeki " + P.Name + " ile açabilirsiniz.");
    folderTitle.Text = "Kurulduğu klasör"; folder.Text = setup.Target;
    change.Visible = false; desktop.Visible = false; startup.Visible = false; install.Visible = false;
    StringBuilder text = new StringBuilder();
    foreach (string w in setup.Warnings) text.AppendLine(w);
    if (P.FinishNote.Length > 0) text.AppendLine(P.FinishNote);
    if (setup.FirewallAdded && setup.FirewallNeeded) text.AppendLine("Güvenlik duvarı izni eklendi (yalnız yerel ağ); tabletler bağlanabilir.");
    elevate.Visible = setup.FirewallNeeded && !setup.FirewallAdded;
    note.Text = text.ToString().Trim(); note.Visible = note.Text.Length > 0; note.ForeColor = setup.Warnings.Count > 0 ? Warn : Soft;
    status.Visible = false; open.Visible = true; close.Visible = true; close.Enabled = true; AcceptButton = open; open.Focus();
    Relayout();
  }

  // Only the firewall step runs elevated, with the folder passed along: elevating the whole installer could switch to
  // another Windows account (its own %LOCALAPPDATA% and desktop) when an administrator types their password.
  void Elevate() {
    int code = Firewall.Elevated("--guvenlik-duvari --hedef \"" + setup.Target + "\"", Handle);
    if (code == 3) return;  // the owner said no to the Windows question
    bool ok = code == 0;
    note.ForeColor = ok ? Soft : Warn;
    note.Text = ok ? "Güvenlik duvarı izni eklendi (yalnız yerel ağ); tabletler bağlanabilir." : "Güvenlik duvarı izni eklenemedi. Ayrıntılar: " + Path.Combine(setup.Target, "logs\\kurulum.log");
    note.Visible = true; elevate.Visible = !ok; Relayout();
  }

  void OpenMola() {
    try {
      ProcessStartInfo info = new ProcessStartInfo(Path.Combine(setup.Target, P.Launcher));
      info.WorkingDirectory = setup.Target; info.UseShellExecute = true;
      Process.Start(info);
      Close();
    } catch (Exception e) { MessageBox.Show(this, P.Name + " açılamadı: " + e.Message, P.Name + " kurulumu", MessageBoxButtons.OK, MessageBoxIcon.Error); }
  }
}

// ---------- "Mola şu anda açık": update now, at closing time, or not at all ----------
class UpdateDialog : Form {
  string result = "vazgec";

  public static string Ask(IWin32Window owner, Running info) {
    using (UpdateDialog d = new UpdateDialog(info)) { d.ShowDialog(owner); return d.result; }
  }

  UpdateDialog(Running info) {
    Text = P.Name + " kurulumu"; BackColor = P.Back; ForeColor = P.Cream; Font = new Font("Segoe UI", 10f);
    FormBorderStyle = FormBorderStyle.FixedDialog; MaximizeBox = false; MinimizeBox = false; StartPosition = FormStartPosition.CenterParent; ShowInTaskbar = false;
    bool open = info.OpenAccounts > 0 || info.PendingOrders > 0;
#if YONETIM
    string head = "Mola Merkez şu anda çalışıyor.";
    string body = "Güncelleme sırasında Merkez birkaç dakika kapanır: kafeler bu sürede başvuru gönderemez, kod giremez, lisans yenileyemez. Çalışan lisanslar etkilenmez, veriler korunur.";
    string later = "Kapanışta güncelle: Merkez'i Merkez-Durdur.cmd ile durdurduğunuzda güncelleme kendiliğinden başlar; bu pencere açık kalmalı.";
#else
    string head = info.OpenAccounts < 0 ? "Mola şu anda açık. Açık masa ya da sipariş olup olmadığı öğrenilemedi."
      : open ? "Mola şu anda açık: " + info.OpenAccounts + " açık masa, " + info.PendingOrders + " hazırlanmayı ya da servisi bekleyen sipariş var."
      : "Mola şu anda açık. Açık masa ya da bekleyen sipariş yok.";
    string body = "Güncelleme sırasında Mola birkaç dakika kapanır; tabletler bu sürede sipariş gönderemez. Açık masalar ve siparişler kaybolmaz. Önce yedek alınır, sonra Mola kendiliğinden yeniden açılır.";
    string later = "Kapanışta güncelle: gün sonunda şeritteki \"Kapat\" ile Mola'yı kapattığınızda güncelleme kendiliğinden başlar; bu pencere açık kalmalı.";
#endif
    Label h = AddText(head, 24, 20, 470); h.Font = new Font("Segoe UI", 10.5f, FontStyle.Bold);
    Label b = AddText(body, 24, 0, 470); b.Top = h.Bottom + Ui.S(10); b.ForeColor = P.Soft;
    Label l = AddText(later, 24, 0, 470); l.Top = b.Bottom + Ui.S(10); l.ForeColor = P.Soft; l.Font = new Font("Segoe UI", 9f);
    int y = l.Bottom + Ui.S(18);
    Button now = AddButton("Şimdi güncelle", 150, !open), atClose = AddButton("Kapanışta güncelle", 170, open), cancel = AddButton("Vazgeç", 100, false);
    cancel.Location = new Point(Ui.S(494) - cancel.Width, y);
    atClose.Location = new Point(cancel.Left - Ui.S(10) - atClose.Width, y);
    now.Location = new Point(atClose.Left - Ui.S(10) - now.Width, y);
    now.Click += delegate { result = "simdi"; Close(); };
    atClose.Click += delegate { result = "kapanis"; Close(); };
    cancel.Click += delegate { result = "vazgec"; Close(); };
    AcceptButton = open ? atClose : now; CancelButton = cancel; ActiveControl = open ? atClose : now;
    ClientSize = new Size(Ui.S(518), cancel.Bottom + Ui.S(20));
  }

  Label AddText(string text, int x, int y, int w) {
    Label label = new Label(); label.Text = text; label.BackColor = Color.Transparent; label.Location = Ui.S(x, y); label.Width = Ui.S(w);
    Controls.Add(label); label.Height = Ui.TextHeight(label, 20); return label;
  }

  Button AddButton(string text, int w, bool primary) {
    Button button = new Button(); button.Text = text; button.Size = Ui.Z(w, 36); button.FlatStyle = FlatStyle.Flat; button.Cursor = Cursors.Hand;
    button.FlatAppearance.BorderColor = P.Cream; button.FlatAppearance.BorderSize = 1;
    button.BackColor = primary ? P.Cream : P.Back; button.ForeColor = primary ? P.Back : P.Cream;
    if (primary) button.Font = new Font("Segoe UI", 10f, FontStyle.Bold);
    Controls.Add(button); return button;
  }
}
