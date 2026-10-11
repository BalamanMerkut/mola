// "Mola-Kaldir.exe": the Windows uninstaller. "Mola Kurulum.exe" copies it into the installation folder and runs it with
// --kaydet, which lists Mola in Windows "Ayarlar > Uygulamalar" (HKCU\...\Uninstall\Mola, no admin needed).
// Removing Mola: stops it, closes the Mola windows, removes the shortcuts, the firewall rules (administrator), the
// program files and the Windows entry. The café's data and backups stay unless "Verileri ve yedekleri de sil" is chosen,
// so a later installation continues where it left off. Second backup places (flash drive, OneDrive\Mola-Yedek) are never
// touched: only this installation folder is.
//
//   Mola-Kaldir.exe                                    window (the folder is the one this file is in)
//   Mola-Kaldir.exe --sessiz [--verileri-sil]          no window, exit code 0 = removed, 1 = failed
//   Mola-Kaldir.exe --kaydet                           only (re)write the Windows "Uygulamalar" entry (used by the installer)
//   Mola-Kaldir.exe --guvenlik-duvari-temizle [--dene] remove every inbound firewall rule of this folder's runtime\node.exe
//                                                      (administrator: the window's button starts it elevated; --dene only prints)
//   common: [--hedef <klasör>] [--kayit-adi <ad>]     another folder / the registry key name --kaydet writes (tests: Mola-Test)
// Removing deletes every Mola entry (Publisher Merkut Studios) whose InstallLocation is this folder and no other, so
// removing a test copy never touches the real one.
// Every run appends to <folder>\logs\kurulum.log (or %TEMP%\Mola-kaldirma.log when there is no such logs folder).
//
// The same source builds "Mola-Yonetim-Kaldir.exe" for the vendor's Mola Yönetim (/define:YONETIM): names, data items,
// registry key (MolaYonetim), colours and texts come from Urun.cs (class P).
//
// Built by scripts/build-installer.mjs with the C# compiler that ships with Windows (.NET Framework 4). Keep to C# 5.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Management;
using System.Reflection;
using System.Security.Principal;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: AssemblyTitle(P.Name + " Kaldır")]
[assembly: AssemblyDescription(P.Description + " kaldırma")]
[assembly: AssemblyProduct(P.Name)]
[assembly: AssemblyCompany("Merkut Studios")]
[assembly: AssemblyCopyright("© 2026 Merkut Studios")]
[assembly: AssemblyVersion("{{VERSION}}.0")]
[assembly: AssemblyFileVersion("{{VERSION}}.0")]

class RemoveError : Exception { public RemoveError(string message) : base(message) { } }

class Remover {
  public const string Version = "{{VERSION}}", ExeName = P.Uninstaller;
  const string UninstallKeys = "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\";
  // Program files: what the installer copies (plus older names). Everything else in the folder is the café's.
  static readonly string[] ProgramItems = P.ProgramItems;

  public string Target, KeyName = P.RegKey;
  public bool DeleteData;
  /// <summary>Firewall rules of this folder's node.exe left because this run is not an administrator.</summary>
  public int FirewallLeft;
  public readonly List<string> Notes = new List<string>();
  public Action<string> Progress = delegate { };
  readonly StringBuilder log = new StringBuilder();
  string savedLog;

  public Remover() { Target = AppDomain.CurrentDomain.BaseDirectory; }

  public static bool IsAdmin() {
    try { return new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator); } catch (Exception) { return false; }
  }

  public static string Normalize(string path) {
    string full = Path.GetFullPath(Environment.ExpandEnvironmentVariables(path.Trim().Trim('"')));
    return full.Length > 3 ? full.TrimEnd('\\') : full;
  }

  public static string SelfPath() { return Normalize(Assembly.GetExecutingAssembly().Location); }

  static bool Inside(string path, string folder) {
    return (path.TrimEnd('\\') + "\\").StartsWith(folder.TrimEnd('\\') + "\\", StringComparison.OrdinalIgnoreCase);
  }

  public void Log(string line) { lock (log) log.AppendLine(DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "  " + line); }
  void Step(string text) { Log(text); Progress(text); }

  public void CheckTarget() {
    if (Path.GetPathRoot(Target).TrimEnd('\\').Equals(Target.TrimEnd('\\'), StringComparison.OrdinalIgnoreCase))
      throw new RemoveError("Bir sürücünün kökü kaldırılamaz (" + Target + ").");
    foreach (string marker in new string[] { P.Launcher, ExeName, "app\\manifest.json", "runtime\\node.exe" })
      if (File.Exists(Path.Combine(Target, marker))) return;
    throw new RemoveError("Bu klasörde " + P.Name + " kurulumu bulunamadı: " + Target);
  }

  // ---------- Windows "Uygulamalar" entry ----------
  public void Register() {
    CheckTarget();
    long bytes = 0;
    foreach (string name in new string[] { "app", "runtime" }) { string d = Path.Combine(Target, name); if (Directory.Exists(d)) foreach (string f in Directory.GetFiles(d, "*", SearchOption.AllDirectories)) bytes += new FileInfo(f).Length; }
    foreach (string f in Directory.GetFiles(Target, "*.exe")) bytes += new FileInfo(f).Length;
    string exe = "\"" + Path.Combine(Target, ExeName) + "\"" + (KeyName == P.RegKey ? "" : " --kayit-adi " + KeyName);
    using (RegistryKey key = Registry.CurrentUser.CreateSubKey(UninstallKeys + KeyName)) {
      key.SetValue("DisplayName", KeyName == P.RegKey ? P.Name : P.Name + " (" + KeyName + ")");
      key.SetValue("DisplayVersion", Version);
      key.SetValue("Publisher", "Merkut Studios");
      key.SetValue("DisplayIcon", Path.Combine(Target, P.Launcher) + ",0");
      key.SetValue("InstallLocation", Target);
      key.SetValue("InstallDate", DateTime.Now.ToString("yyyyMMdd"));
      key.SetValue("UninstallString", exe);
      key.SetValue("QuietUninstallString", exe + " --sessiz");
      key.SetValue("NoModify", 1, RegistryValueKind.DWord);
      key.SetValue("NoRepair", 1, RegistryValueKind.DWord);
      key.SetValue("EstimatedSize", (int)(bytes / 1024), RegistryValueKind.DWord);
    }
    Log("Windows \"Uygulamalar\" kaydı yazıldı: HKCU\\" + UninstallKeys + KeyName + " (" + Target + ")");
  }

  // Every Mola entry that points at this folder (whatever its key name), and only those.
  void Unregister() {
    List<string> mine = new List<string>();
    using (RegistryKey all = Registry.CurrentUser.OpenSubKey(UninstallKeys.TrimEnd('\\'))) {
      if (all != null) foreach (string name in all.GetSubKeyNames()) {
        using (RegistryKey key = all.OpenSubKey(name)) {
          if (key == null || !"Merkut Studios".Equals(key.GetValue("Publisher") as string)) continue;
          string location = key.GetValue("InstallLocation") as string;
          if (string.IsNullOrEmpty(location)) continue;
          try { if (Normalize(location).Equals(Target, StringComparison.OrdinalIgnoreCase)) mine.Add(name); }
          catch (Exception) { }
          if (!mine.Contains(name)) Log("Windows kaydı " + name + " başka bir klasörü gösteriyor (" + location + "), dokunulmadı.");
        }
      }
    }
    if (mine.Count == 0) Log("Bu klasör için Windows kaydı yok.");
    foreach (string name in mine) { Registry.CurrentUser.DeleteSubKeyTree(UninstallKeys + name, false); Log("Windows kaydı silindi: " + name); }
  }

  // ---------- Removal ----------
  public void Run() {
    Log(P.Name + " " + Version + " kaldırılıyor. Klasör: " + Target + "  Veriler: " + (DeleteData ? "SİLİNECEK" : "korunuyor") + "  Yönetici: " + (IsAdmin() ? "evet" : "hayır"));
    CheckTarget();

    Step(P.Name + " pencereleri kapatılıyor…");
    CloseWindows();
    Step("Çalışan " + P.Name + " durduruluyor…");
    string stop = Path.Combine(Target, P.StopCmd);
    if (File.Exists(stop)) RunHidden("cmd.exe", "/d /c \"\"" + stop + "\"\"", 30000);
    StopPrograms();

    Step("Simgeler kaldırılıyor…");
    RemoveShortcuts();

    Step("Güvenlik duvarı izni denetleniyor…");
    RemoveFirewallRule();

    Step("Program dosyaları siliniyor…");
    foreach (string name in ProgramItems) Delete(Path.Combine(Target, name));
    if (DeleteData) {
      Step("Veriler ve yedekler siliniyor…");
      foreach (string entry in Directory.GetFileSystemEntries(Target)) if (IsData(Path.GetFileName(entry))) Delete(entry);
      foreach (string entry in Directory.GetFileSystemEntries(Target)) {
        if (Normalize(entry).Equals(SelfPath(), StringComparison.OrdinalIgnoreCase)) continue;
        Notes.Add("Klasörde " + P.Dat + " ait olmayan dosyalar olduğu için klasör silinmedi: " + Target);
        Log("Silinmeyen öğe: " + entry);
        break;
      }
    } else Log("Veriler korundu (" + string.Join(", ", P.DataItems) + ", *.anahtar, *-tasima-oncesi-*).");

    Unregister();
    Step(P.Name + " kaldırıldı.");
  }

  // Data that "Verileri ve yedekleri de sil" removes. Only names Mola itself creates in its own folder.
  static bool IsData(string name) {
    foreach (string k in P.DataItems) if (name.Equals(k, StringComparison.OrdinalIgnoreCase)) return true;
    return name.StartsWith("veri-", StringComparison.OrdinalIgnoreCase) || name.StartsWith("veri.", StringComparison.OrdinalIgnoreCase) ||
      name.EndsWith(".anahtar", StringComparison.OrdinalIgnoreCase) || name.IndexOf("-tasima-oncesi-", StringComparison.OrdinalIgnoreCase) >= 0;
  }

  // The Mola window is Edge/Chrome with this folder's "pencere" profile: only processes started with that profile
  // (the browser and its helpers) are closed, never the owner's own browser windows (Ortak.cs, Browser).
  void CloseWindows() {
    int count = Browser.Close(Target);
    if (count > 0) Log(count + " " + P.Name + " pencere işlemi kapatıldı.");
  }
  // Anything still running from this folder (the server's node.exe, Mola.exe), except this uninstaller.
  void StopPrograms() {
    int self = Process.GetCurrentProcess().Id;
    bool any = false;
    foreach (ManagementObject p in Query("SELECT ProcessId, ExecutablePath FROM Win32_Process")) {
      string path = p["ExecutablePath"] as string;
      int id = Convert.ToInt32(p["ProcessId"]);
      if (path == null || id == self || !Inside(path, Target)) continue;
      try { Process.GetProcessById(id).Kill(); any = true; Log("Durduruldu: " + path + " (" + id + ")"); } catch (Exception e) { Log("Durdurulamadı: " + path + ": " + e.Message); }
    }
    if (any) Thread.Sleep(1500);
  }

  static ManagementObjectCollection Query(string wql) { return new ManagementObjectSearcher(wql).Get(); }

  // Desktop, Start menu and Startup shortcuts whose target is inside this folder.
  void RemoveShortcuts() {
    Type type = Type.GetTypeFromProgID("WScript.Shell", false);
    if (type == null) { Notes.Add("Simgeler kaldırılamadı; masaüstündeki " + P.Name + " simgesini elle silin."); return; }
    object shell = Activator.CreateInstance(type);
    foreach (Environment.SpecialFolder folder in new Environment.SpecialFolder[] { Environment.SpecialFolder.DesktopDirectory, Environment.SpecialFolder.Programs, Environment.SpecialFolder.Startup }) {
      string dir = Environment.GetFolderPath(folder);
      if (string.IsNullOrEmpty(dir) || !Directory.Exists(dir)) continue;
      foreach (string link in Directory.GetFiles(dir, "*.lnk")) {
        try {
          object l = type.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { link });
          string target = l.GetType().InvokeMember("TargetPath", BindingFlags.GetProperty, null, l, null) as string;
          if (string.IsNullOrEmpty(target) || !Inside(target, Target)) continue;
          DeleteFile(link); Log("Kısayol silindi: " + link);
        } catch (Exception e) { Log("Kısayol okunamadı: " + link + ": " + e.Message); }
      }
    }
  }

  // Every inbound rule whose program is this folder's runtime\node.exe, whatever its name: Mola's own ("Mola",
  // "Mola Yönetim") and the ones Windows made when the owner answered its question ("Node.js JavaScript Runtime", also
  // "block" rules). Rules of other programs are never touched (Ortak.cs, Firewall). Deleting needs an administrator: without
  // one the window offers a button that runs "--guvenlik-duvari-temizle" elevated (Windows asks once).
  void RemoveFirewallRule() {
    List<Firewall.Rule> rules = Firewall.Inbound(Local.Node(Target));
    if (rules == null) { Log("Güvenlik duvarı kuralları okunamadı."); return; }
    if (rules.Count == 0) { Log("Güvenlik duvarı: bu klasörün programı için kural yok."); return; }
    foreach (Firewall.Rule r in rules) Log("Güvenlik duvarı: " + Firewall.Describe(r));
    if (IsAdmin()) { if (!CleanFirewall(false)) Notes.Add("Güvenlik duvarındaki " + P.Name + " izinleri silinemedi. Ayrıntılar: " + Path.Combine(Target, "logs\\kurulum.log")); return; }
    FirewallLeft = rules.Count;
    Log("Güvenlik duvarı kuralları kaldı (yönetici değil): " + rules.Count);
  }

  /// <summary>Administrator (or dry run): removes every inbound rule of this folder's node.exe. True when none is left.</summary>
  public bool CleanFirewall(bool dry) {
    string node = Local.Node(Target);
    List<Firewall.Rule> rules = Firewall.Inbound(node);
    if (rules == null) { Log("Güvenlik duvarı kuralları okunamadı."); return false; }
    List<string> plan = Firewall.Plan(node, P.FirewallRule, rules, false);
    if (dry) {
      Firewall.Print("DENEME: hiçbir şey değiştirilmez. Program: " + node + "  Yönetici: " + (IsAdmin() ? "evet" : "hayır"));
      Firewall.Print("Bu program için gelen bağlantı kuralları: " + (rules.Count == 0 ? "yok" : ""));
      foreach (Firewall.Rule r in rules) Firewall.Print("  " + Firewall.Describe(r) + "  " + r.Program);
      Firewall.Print(plan.Count == 0 ? "Silinecek kural yok." : "Çalıştırılacak komutlar:");
      Firewall.Run(plan, true, line => { Firewall.Print("  " + line); Log("Güvenlik duvarı (deneme): " + line); });
      return true;
    }
    Firewall.Run(plan, false, line => Log("Güvenlik duvarı: " + line));
    List<Firewall.Rule> left = Firewall.Inbound(node);
    bool ok = left != null && left.Count == 0;
    Log("Güvenlik duvarı: " + (ok ? "bu klasörün bütün kuralları silindi." : "silinemeyen kural var."));
    return ok;
  }
  // ---------- Files ----------
  void Delete(string path) {
    if (Directory.Exists(path)) {
      try { DeleteDirectory(path); }
      catch (IOException) {
        // .NET Framework stops at 260 characters; Edge's "pencere" profile goes ~120 characters deep. Windows' own "rd"
        // with a \\?\ path does not (links inside are removed, never followed).
        if ((File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0) throw;
        RunHidden("cmd.exe", "/d /c rd /s /q \"\\\\?\\" + path + "\"", 120000);
        if (Directory.Exists(path)) throw;
        Log("Uzun yollu klasör silindi: " + path);
      }
    }
    else if (File.Exists(path)) DeleteFile(path);
  }

  // A stopped program can hold its files for a few seconds: retry before giving up.
  static void DeleteFile(string path) {
    for (int attempt = 1; ; attempt++) {
      try { if (!File.Exists(path)) return; File.SetAttributes(path, FileAttributes.Normal); File.Delete(path); return; }
      catch (IOException) { if (attempt >= 20) throw; Thread.Sleep(500); }
      catch (UnauthorizedAccessException) { if (attempt >= 20) throw; Thread.Sleep(500); }
    }
  }

  static void DeleteDirectory(string path) {
    if ((File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0) { Directory.Delete(path, false); return; }  // a link: never follow it
    foreach (string file in Directory.GetFiles(path)) DeleteFile(file);
    foreach (string dir in Directory.GetDirectories(path)) DeleteDirectory(dir);
    for (int attempt = 1; ; attempt++) {
      try { Directory.Delete(path, false); return; }
      catch (IOException) { if (attempt >= 20) throw; Thread.Sleep(500); }
      catch (UnauthorizedAccessException) { if (attempt >= 20) throw; Thread.Sleep(500); }
    }
  }

  static int RunHidden(string file, string arguments, int timeout) {
    ProcessStartInfo info = new ProcessStartInfo(file, arguments);
    info.UseShellExecute = false; info.CreateNoWindow = true; info.WindowStyle = ProcessWindowStyle.Hidden;
    using (Process p = Process.Start(info)) {
      if (!p.WaitForExit(timeout)) { try { p.Kill(); } catch (Exception) { } return -1; }
      return p.ExitCode;
    }
  }

  static string Output(string file, string arguments) {
    try {
      ProcessStartInfo info = new ProcessStartInfo(file, arguments);
      info.UseShellExecute = false; info.CreateNoWindow = true; info.RedirectStandardOutput = true;
      info.StandardOutputEncoding = Encoding.GetEncoding(System.Globalization.CultureInfo.CurrentCulture.TextInfo.OEMCodePage);
      using (Process p = Process.Start(info)) { string text = p.StandardOutput.ReadToEnd(); p.WaitForExit(30000); return text; }
    } catch (Exception) { return null; }
  }

  // This program cannot delete itself while it runs: a hidden cmd waits ~2 seconds, deletes it, then removes the
  // folder if nothing else is left in it.
  public void ScheduleSelfDelete() {
    string self = SelfPath();
    if (!Inside(self, Target)) return;
    ProcessStartInfo info = new ProcessStartInfo("cmd.exe", "/d /c \"ping -n 3 127.0.0.1 >nul & del /f /q \"" + self + "\" & rmdir \"" + Target + "\" 2>nul\"");
    info.UseShellExecute = false; info.CreateNoWindow = true; info.WorkingDirectory = Path.GetTempPath();
    try { Process.Start(info); } catch (Exception e) { Log("Kaldırma programı kendini silemedi: " + e.Message); }
  }

  public string SaveLog() {
    string text; lock (log) { text = log.ToString(); log.Clear(); }
    if (text.Length == 0) return savedLog;
    string dir = Path.Combine(Target, "logs");
    try {
      // Only into an existing Mola logs folder: never create files in a folder that is not (or no longer) Mola's.
      if (!Directory.Exists(dir)) throw new IOException();
      string file = Path.Combine(dir, "kurulum.log");
      File.AppendAllText(file, text + Environment.NewLine, Encoding.UTF8);
      return savedLog = file;
    } catch (Exception) {
      try { string file = Path.Combine(Path.GetTempPath(), "Mola-kaldirma.log"); File.AppendAllText(file, text + Environment.NewLine, Encoding.UTF8); return savedLog = file; } catch (Exception) { return null; }
    }
  }

  public void LogFailure(Exception e) { Log("Hata: " + Describe(e)); if (!(e is RemoveError)) Log(e.ToString()); }

  public static string Describe(Exception e) {
    if (e is RemoveError) return e.Message;
    if (e is UnauthorizedAccessException || e is IOException) return "Bazı dosyalar silinemedi: " + e.Message + "\n\n" + P.CloseHint + " ve yeniden deneyin.";
    return "Beklenmeyen hata: " + e.Message;
  }
}

static class Entry {
  [STAThread]
  static int Main(string[] args) {
    Ui.DpiAware();
    bool silent = false, register = false, firewall = false, dry = false;
    Remover remover = new Remover();
    try {
      for (int i = 0; i < args.Length; i++) {
        string a = args[i].ToLowerInvariant();
        if (a == "--sessiz") silent = true;
        else if (a == "--verileri-sil") remover.DeleteData = true;
        else if (a == "--kaydet") register = true;
        else if (a == "--guvenlik-duvari-temizle") firewall = true;
        else if (a == "--dene") dry = true;
        else if (a == "--hedef" && i + 1 < args.Length) remover.Target = args[++i];
        else if (a == "--kayit-adi" && i + 1 < args.Length) remover.KeyName = args[++i];
        else throw new RemoveError("Bilinmeyen seçenek: " + args[i] + "\nKullanım: " + P.Uninstaller + " [--sessiz [--verileri-sil]] [--hedef <klasör>] [--kayit-adi <ad>]");
      }
      if (remover.KeyName.Length == 0 || remover.KeyName.Length > 40 || !System.Text.RegularExpressions.Regex.IsMatch(remover.KeyName, "^[A-Za-z0-9_-]+$"))
        throw new RemoveError("Kayıt adı yalnız harf, rakam, - ve _ içerebilir: " + remover.KeyName);
      if (dry && !firewall) throw new RemoveError("--dene yalnız --guvenlik-duvari-temizle ile kullanılır.");
      remover.Target = Remover.Normalize(remover.Target);
      if (register) { remover.Register(); return 0; }  // the installer logs the result in its own order
      if (!silent && remover.DeleteData) throw new RemoveError("--verileri-sil yalnız --sessiz ile kullanılır; pencerede kutuyu işaretleyin.");
      remover.CheckTarget();
    } catch (Exception e) {
      remover.Log("Hata: " + Remover.Describe(e)); remover.SaveLog();
      if (!silent && !register && !firewall) MessageBox.Show(Remover.Describe(e), P.Acc + " kaldır", MessageBoxButtons.OK, MessageBoxIcon.Error);
      return 1;
    }

    // Firewall rules of this folder's node.exe only (started elevated by the window's button; --dene changes nothing).
    if (firewall) {
      bool ok;
      if (!dry && !Remover.IsAdmin()) { remover.Log("Güvenlik duvarı: yönetici yetkisi yok."); ok = false; }
      else ok = remover.CleanFirewall(dry);
      remover.SaveLog();
      return ok ? 0 : 1;
    }

    if (silent) {
      try {
        remover.Run();
        if (remover.FirewallLeft > 0) remover.Log("Güvenlik duvarında bu klasörün programı için " + remover.FirewallLeft + " kural kaldı; silmek için yönetici olarak: " + P.Uninstaller + " --guvenlik-duvari-temizle --hedef \"" + remover.Target + "\"");
        remover.SaveLog(); remover.ScheduleSelfDelete(); return 0;
      }
      catch (Exception e) { remover.LogFailure(e); remover.SaveLog(); return 1; }
    }

    Application.EnableVisualStyles();
    Application.SetCompatibleTextRenderingDefault(false);
    RemoveWindow window = new RemoveWindow(remover);
    Application.Run(window);
    if (window.Removed) remover.ScheduleSelfDelete();
    return window.Removed ? 0 : 1;
  }
}

// ---------- The window: Mola colours, like "Mola Kurulum.exe". Pixel values are for 96 DPI and go through Ui.S ----------
class RemoveWindow : Form {
  static readonly Color Green = P.Back, Field = P.Field, Cream = P.Cream, Soft = P.Soft, Warn = P.Warn;
  readonly Remover remover;
  readonly Label heading = new Label(), sentence = new Label(), folderTitle = new Label(), note = new Label(), status = new Label();
  readonly TextBox folder = new TextBox();
  readonly CheckBox wipe = new CheckBox();
  readonly Button remove = new Button(), cancel = new Button(), firewall = new Button();
  bool busy;
  public bool Removed;

  const string KeepText = P.KeepText;

  public RemoveWindow(Remover r) {
    remover = r;
    Text = P.Acc + " kaldır"; BackColor = Green; ForeColor = Cream; Font = new Font("Segoe UI", 10f);
    FormBorderStyle = FormBorderStyle.FixedSingle; MaximizeBox = false; StartPosition = FormStartPosition.CenterScreen;
    Icon = Ui.AppIcon();  // the same multi-size icon as Mola.exe

    Place(heading, P.Acc + " kaldır", 28, 20, 480, 40); heading.Font = new Font("Georgia", 20f);
    Place(sentence, P.Name + " bu bilgisayardan kaldırılsın mı?", 30, 68, 480, 24);
    Place(folderTitle, "Kurulu olduğu klasör", 30, 100, 300, 20); folderTitle.ForeColor = Soft; folderTitle.Font = new Font("Segoe UI", 9f);
    folder.ReadOnly = true; folder.BorderStyle = BorderStyle.FixedSingle; folder.BackColor = Field; folder.ForeColor = Cream; folder.Text = remover.Target;
    folder.Location = Ui.S(30, 122); folder.Width = Ui.S(480); folder.TabStop = false; Controls.Add(folder);
    // Room for the longest of the two texts, so switching the box never cuts a line.
    Place(note, P.WipeText, 30, 0, 480, 20); note.Top = folder.Bottom + Ui.S(16); note.ForeColor = Soft;
    int noteHeight = Ui.TextHeight(note, 40); note.Text = KeepText; note.Height = Math.Max(noteHeight, Ui.TextHeight(note, 40));
    wipe.Text = P.WipeLabel; wipe.Location = new Point(Ui.S(30), note.Bottom + Ui.S(8)); wipe.AutoSize = true; wipe.ForeColor = Warn; Controls.Add(wipe);
    wipe.CheckedChanged += delegate {
      note.Text = wipe.Checked ? P.WipeText : KeepText;
      note.ForeColor = wipe.Checked ? Warn : Soft;
    };
    int y = wipe.Top + Ui.S(48);
    Place(status, "", 30, 0, 250, 50); status.Top = y - Ui.S(6); status.ForeColor = Soft;
    Style(cancel, "Vazgeç", 290, 0, 100, 36, false); cancel.Top = y; cancel.Click += delegate { Close(); };
    Style(remove, "Kaldır", 400, 0, 110, 36, true); remove.Top = y; remove.Click += delegate { Start(); };
    Style(firewall, "Güvenlik duvarı izinlerini sil", 30, 0, 250, 36, false); firewall.Top = y; firewall.Visible = false; firewall.Click += delegate { CleanFirewall(); };
    ClientSize = new Size(Ui.S(540), cancel.Bottom + Ui.S(22));
    CancelButton = cancel; ActiveControl = cancel;
    FormClosing += (sender, e) => { if (busy) e.Cancel = true; };
  }

  void Place(Label label, string text, int x, int y, int w, int h) {
    label.Text = text; label.Location = Ui.S(x, y); label.Size = Ui.Z(w, h); label.BackColor = Color.Transparent; Controls.Add(label);
  }

  void Style(Button button, string text, int x, int y, int w, int h, bool primary) {
    button.Text = text; button.Location = Ui.S(x, y); button.Size = Ui.Z(w, h); button.FlatStyle = FlatStyle.Flat; button.Cursor = Cursors.Hand;
    button.FlatAppearance.BorderColor = Cream; button.FlatAppearance.BorderSize = 1;
    button.BackColor = primary ? Cream : Green; button.ForeColor = primary ? Green : Cream;
    if (primary) button.Font = new Font("Segoe UI", 10f, FontStyle.Bold);
    Controls.Add(button);
  }

  void Start() {
    if (wipe.Checked && MessageBox.Show(this, P.WipeQuestion, P.WipeTitle, MessageBoxButtons.YesNo, MessageBoxIcon.Warning, MessageBoxDefaultButton.Button2) != DialogResult.Yes) return;
    busy = true; remove.Enabled = false; cancel.Enabled = false; wipe.Enabled = false;
    remover.DeleteData = wipe.Checked; remover.Notes.Clear();
    status.Text = "Başlıyor…";
    remover.Progress = text => BeginInvoke((MethodInvoker)delegate { status.Text = text; });
    Thread worker = new Thread(() => {
      Exception error = null;
      try { remover.Run(); } catch (Exception e) { error = e; remover.LogFailure(e); }
      string logFile = remover.SaveLog();
      BeginInvoke((MethodInvoker)delegate { Finished(error, logFile); });
    });
    worker.SetApartmentState(ApartmentState.STA);
    worker.IsBackground = true; worker.Start();
  }

  void Finished(Exception error, string logFile) {
    busy = false;
    if (error != null) {
      status.ForeColor = Warn; status.Text = "Kaldırma yarıda kaldı.";
      remove.Text = "Yeniden dene"; remove.Enabled = true; cancel.Enabled = true; wipe.Enabled = true;
      MessageBox.Show(this, Remover.Describe(error) + (logFile != null ? "\n\nAyrıntılar: " + logFile : ""), P.Acc + " kaldır", MessageBoxButtons.OK, MessageBoxIcon.Error);
      return;
    }
    Removed = true;
    heading.Text = P.Name + " kaldırıldı";
    sentence.Text = remover.DeleteData ? "Program, veriler ve yedekler silindi." : "Program silindi. Verileriniz ve yedekleriniz bu klasörde duruyor:";
    folderTitle.Visible = false; folder.Top = Ui.S(100); folder.Visible = !remover.DeleteData;
    if (remover.FirewallLeft > 0) remover.Notes.Add("Windows güvenlik duvarında bu " + P.Dat + " ait " + remover.FirewallLeft + " izin kaldı. Silmek için aşağıdaki düğmeye basın (Windows yönetici onayı sorar); kalırsa zararsızdır.");
    ShowNotes();
    wipe.Visible = false; status.Visible = false; remove.Visible = false;
    firewall.Visible = remover.FirewallLeft > 0;
    cancel.Text = "Kapat"; cancel.Left = Ui.S(410); cancel.Enabled = true; AcceptButton = cancel; cancel.Focus();
  }

  void ShowNotes() {
    StringBuilder text = new StringBuilder();
    text.AppendLine(remover.DeleteData ? P.RemovedWiped : P.RemovedKeep);
    foreach (string n in remover.Notes) text.AppendLine(n);
    note.Text = text.ToString().Trim(); note.Top = Ui.S(140); note.Height = Math.Min(cancel.Top - Ui.S(150), Ui.TextHeight(note, 40)); note.ForeColor = remover.Notes.Count > 0 ? Warn : Soft;
  }

  // The same program, elevated, with only "--guvenlik-duvari-temizle": Windows asks once; nothing else runs as administrator.
  void CleanFirewall() {
    firewall.Enabled = false;
    int code = Firewall.Elevated("--guvenlik-duvari-temizle --hedef \"" + remover.Target + "\"", Handle);
    firewall.Enabled = true;
    if (code == 3) return;  // the owner said no to the Windows question
    remover.Notes.Clear();
    remover.Notes.Add(code == 0 ? "Güvenlik duvarındaki " + P.Name + " izinleri silindi." : "Güvenlik duvarındaki izinler silinemedi.");
    if (code == 0) { remover.FirewallLeft = 0; firewall.Visible = false; }
    ShowNotes(); if (code == 0) note.ForeColor = Soft;
  }
}