// Mola.exe: the Windows desktop app. Starts the local server if it is not running, then opens Mola in its own window
// (Edge or Chrome app mode: no address bar, no tabs). Closing the window does not stop the server, so tablets keep
// working; the window's "Kapat" button or Mola-Durdur.cmd stops it. Opening Mola.exe again brings the open window to
// the front instead of a second one. The window gets this installation's taskbar identity (Ortak.cs, Taskbar), so the taskbar
// shows Mola.exe's sharp multi-size icon instead of the page's enlarged 16-px favicon.
//
//   Mola.exe                              window
//   Mola.exe --arkaplan                   only the server (Windows start-up, the installer after an update)
//   Mola.exe --guvenlik-duvari            firewall rule for runtime\node.exe, private networks (asks Windows once, UAC);
//                                         started by the window's Tabletler > "İzni düzelt" (server/desktop.ts). Exit code
//                                         0 done / nothing to do, 1 failed, 3 the owner said no.
//            --guvenlik-duvari --durum    read only: one JSON line, exit code 0 = as Mola wants it, 4 = needs fixing
//            --guvenlik-duvari --dene     dry run: prints the rules found and the netsh commands it would run
//
// "Own server" means: the program listening on the port is this installation's runtime\node.exe (Windows TCP table) and
// it proves it holds this installation's desktop key without being sent the key (HMAC of a fresh nonce, Local.Proof).
// Only then does the key go into the window's address. Port: PORT (Mola Yönetim: MERKEZ_PORT) in ayarlar.cmd next to this
// file or in the environment, default 3000 / 4000.
//
// The same source builds "Mola Yönetim.exe" (/define:YONETIM, names from Urun.cs): the vendor's Mola Merkez on this
// computer (Merkez-Sunucu.cmd) and the Mola Yönetim window at "/". There the ownership check is the process plus
// "role":"merkez" from /api/merkez/v1/health. The first admin password (veri\merkez-first-login.txt, deleted by Merkez
// once the password is changed) is shown here, on this computer only.
//
// Built by scripts/build-installer.mjs with the C# compiler that ships with Windows (.NET Framework 4), together with
// Urun.cs and Ortak.cs. Keep to C# 5: that compiler does not know newer syntax.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: AssemblyTitle(P.Name)]
[assembly: AssemblyDescription(P.Description)]
[assembly: AssemblyProduct(P.Name)]
[assembly: AssemblyCompany("Merkut Studios")]
[assembly: AssemblyCopyright("© 2026 Merkut Studios")]
[assembly: AssemblyVersion("{{VERSION}}.0")]
[assembly: AssemblyFileVersion("{{VERSION}}.0")]

static class Program {
  [STAThread]
  static int Main(string[] args) {
    Ui.DpiAware();
    Application.EnableVisualStyles();
    string root = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
    // Otomatik güncelleme: a new Mola.exe left beside this one while it was running (guncelleyici.mjs) takes its place now.
    int replaced = ReplaceSelf(args);
    if (replaced >= 0) return replaced;
    if (Has(args, "--guvenlik-duvari")) return FirewallCommand(root, args);
    bool background = Has(args, "--arkaplan");
    // One taskbar button with Mola.exe's own icon for the splash and the Mola window (Ortak.cs, Taskbar).
    if (!background) { Taskbar.ForProcess(root); Taskbar.TagShortcuts(root); }
    int port = Local.Port(root);
    // Checks use 127.0.0.1: "localhost" may try IPv6 first and the server listens on IPv4.
    string origin = "http://127.0.0.1:" + port;
    bool started = false;
    if (!Own(root, origin, port)) {
      if (Busy(root, port)) return Conflict(background, port, root, origin);
      // Mola-Sunucu.cmd runs the server under its watchdog (app\nobetci.mjs); a second watchdog of the same installation
      // (this server is just restarting after a crash) exits at once, so starting it again is harmless.
      StartServer(root);
      started = true;
      // While an update is put in place (the watchdog handed over to guncelleyici.mjs) the server comes later: up to 6 minutes.
      bool updating = Updating(root);
      Form splash = background ? null : Splash(updating);
      bool ready = false, busy = false;
      for (int i = 0; (i < 120 || (updating && i < 1440)) && !ready && !busy; i++) {
        if (splash != null) Application.DoEvents();
        Thread.Sleep(250);
        ready = Own(root, origin, port);
        busy = !ready && Busy(root, port);
        if (i % 8 == 0) updating = updating || Updating(root);
      }
      if (splash != null) splash.Close();
      if (!ready) {
        if (busy || Busy(root, port)) return Conflict(background, port, root, origin);
        if (!background) MessageBox.Show(P.Name + " başlatılamadı.\n\nAyrıntılar: " + Path.Combine(root, P.ServerLog), P.Name, MessageBoxButtons.OK, MessageBoxIcon.Error);
        return 1;
      }
    }
    if (background) return 0;
    // Opened again while the window is open: bring it to the front. If the server had to be started, an open window is
    // from before (for example "Mola kapatıldı" after Kapat): it is closed and a fresh one opened.
    if (!started && Browser.Focus(root)) { Taskbar.TagWindows(root, 0); AfterOpen(root); return 0; }
    if (started) Browser.Close(root);
#if YONETIM
    bool appWindow = OpenWindow(root, "http://127.0.0.1:" + port + "/");
#else
    bool appWindow = OpenWindow(root, "http://localhost:" + port + "/#masaustu=" + Local.Key(root));
#endif
    // The browser shows the page's 16-px favicon on the taskbar, blurry when enlarged: the window takes Mola.exe's identity
    // (and so its icon) as soon as it appears.
    if (appWindow) Taskbar.TagWindows(root, 20000);
    AfterOpen(root);
    return 0;
  }

  static bool Has(string[] args, string name) { foreach (string a in args) if (a.Equals(name, StringComparison.OrdinalIgnoreCase)) return true; return false; }

  /// <summary>An update waits or is being applied (guncelleme\bekleyen.json, guncelleme\gunluk.json beside the data folder).</summary>
  static bool Updating(string root) {
    string folder = Path.Combine(root, "guncelleme");
    return File.Exists(Path.Combine(folder, "gunluk.json")) || File.Exists(Path.Combine(folder, "bekleyen.json"));
  }

  /// <summary>
  /// Mola.exe.yeni beside this file (an update could not replace the running Mola.exe): this file is renamed to Mola.exe.eski
  /// (allowed while running), the new one takes its name and is started with the same arguments. -1: nothing to do.
  /// </summary>
  static int ReplaceSelf(string[] args) {
    string self = System.Reflection.Assembly.GetExecutingAssembly().Location, fresh = self + ".yeni", old = self + ".eski";
    try { if (File.Exists(old)) File.Delete(old); } catch (Exception) { }
    if (!File.Exists(fresh)) return -1;
    try {
      File.Move(self, old);
      try { File.Move(fresh, self); } catch (Exception) { File.Move(old, self); return -1; }
      StringBuilder line = new StringBuilder();
      foreach (string a in args) line.Append(" \"").Append(a.Replace("\"", "")).Append('"');
      ProcessStartInfo info = new ProcessStartInfo(self, line.ToString().Trim());
      info.UseShellExecute = false; info.WorkingDirectory = Path.GetDirectoryName(self);
      Process.Start(info);
      return 0;
    } catch (Exception) { return -1; }
  }

  /// <summary>Another program (not this installation's node.exe) listens on the port.</summary>
  static bool Busy(string root, int port) { int pid = Local.ListenerPid(port); return pid > 0 && !Local.Mine(root, pid); }

  static int Conflict(bool background, int port, string root, string origin) {
    if (background) return 2;
    int pid = Local.ListenerPid(port);
    string who = pid > 0 ? Local.ProgramName(pid) : null;
    string settings = Path.Combine(root, "ayarlar.cmd");
#if YONETIM
    string what = HealthIsMerkez(origin) ? "başka bir Merkez (örneğin geliştirme sunucusu: npm run merkez:dev)" : "başka bir program" + (who != null ? " (" + who + ")" : "");
    string text = "Mola Yönetim açılamadı: " + port + " numaralı bağlantı noktasını " + what + " kullanıyor.\n\n" +
      "Onu kapatıp Mola Yönetim'i yeniden açın ya da Merkez'e başka bir bağlantı noktası verin. Ayarlar: " + settings + " dosyasına\n\n    set MERKEZ_PORT=" + (port + 100) +
      "\n\nsatırını yazın (kafe paketlerindeki Merkez adresi de bu bağlantı noktasıyla olmalı).\n\nAyarlar dosyası şimdi açılsın mı?";
#else
    string text = "Mola açılamadı: " + port + " numaralı bağlantı noktasını başka bir program kullanıyor" + (who != null ? " (" + who + ")" : "") + ".\n\n" +
      "O programı kapatıp Mola'yı yeniden açın ya da Mola'ya başka bir bağlantı noktası verin. Ayarlar: " + settings + " dosyasına\n\n    set PORT=" + (port + 100) +
      "\n\nsatırını yazıp Mola'yı yeniden açın. Bağlantı noktası değişince tabletler ve masalardaki QR kodları yeni adresi kullanır: QR kodlarını yeniden yazdırın.\n\nAyarlar dosyası şimdi açılsın mı?";
#endif
    if (MessageBox.Show(text, P.Name, MessageBoxButtons.YesNo, MessageBoxIcon.Warning, MessageBoxDefaultButton.Button2) == DialogResult.Yes) {
      try {
        if (!File.Exists(settings)) File.WriteAllText(settings, "@rem " + P.Name + " ayarları. Değiştirdikten sonra " + P.Acc + " kapatıp yeniden açın.\r\n@rem set " + P.PortEnv + "=" + (port + 100) + "\r\n", new UTF8Encoding(false));
        Process.Start("notepad.exe", "\"" + settings + "\"");
      } catch (Exception e) { MessageBox.Show("Ayarlar dosyası açılamadı: " + e.Message, P.Name, MessageBoxButtons.OK, MessageBoxIcon.Error); }
    }
    return 2;
  }

#if YONETIM
  // ---------- Mola Yönetim: whose Merkez is on the port ----------
  static bool Own(string root, string origin, int port) { return Local.Mine(root, Local.ListenerPid(port)) && HealthIsMerkez(origin); }

  static bool HealthIsMerkez(string origin) {
    string body;
    return Local.Call("GET", origin + P.Health, null, 1500, out body) == 200 && body.Replace(" ", "").IndexOf("\"role\":\"merkez\"", StringComparison.Ordinal) >= 0;
  }

  static void AfterOpen(string root) { FirstLogin(root); }

  // ---------- First admin password: on this computer's screen only, never over the network ----------
  static void FirstLogin(string root) {
    string data = Local.Setting(root, "MERKEZ_DATA_DIR");
    if (data.Length == 0) data = Environment.GetEnvironmentVariable("MERKEZ_DATA_DIR");
    if (string.IsNullOrEmpty(data)) data = Path.Combine(root, "veri");
    string text;
    try { text = File.ReadAllText(Path.Combine(data, "merkez-first-login.txt")); } catch (Exception) { return; }  // changed already: nothing to show
    string user = Line(text, "Kullanıcı:"), password = Line(text, "Şifre:");
    if (password.Length == 0) return;
    Form form = new Form();
    form.Text = "Mola Yönetim · İlk giriş"; form.BackColor = P.Back; form.ForeColor = P.Cream; form.Font = new Font("Segoe UI", 10f);
    form.FormBorderStyle = FormBorderStyle.FixedSingle; form.MaximizeBox = false; form.MinimizeBox = false; form.StartPosition = FormStartPosition.CenterScreen;
    form.TopMost = true; form.ShowInTaskbar = true;
    form.Icon = Ui.AppIcon();
    Label heading = Text(form, "İlk giriş", 24, 18, 420, 36); heading.Font = new Font("Georgia", 18f);
    Label intro = Text(form, "Mola Yönetim'e bu bilgilerle girin. Bu şifre yalnız bu bilgisayarda gösterilir.", 26, 60, 420, 40); intro.ForeColor = P.Soft;
    intro.Height = Ui.TextHeight(intro, 40);
    int y = intro.Bottom + Ui.S(8);
    Text(form, "Kullanıcı adı", 26, 0, 120, 22).Top = y + Ui.S(2);
    TextBox userBox = Field(form, user.Length > 0 ? user : "admin", 150, 0, 290); userBox.Top = y;
    y = userBox.Bottom + Ui.S(12);
    Text(form, "İlk giriş şifresi", 26, 0, 120, 22).Top = y + Ui.S(2);
    TextBox passwordBox = Field(form, password, 150, 0, 290); passwordBox.Top = y;
    Label warn = Text(form, "Girdikten sonra \"Hesap güvenliği\" bölümünde kendi şifrenizi belirleyin. Şifre değişince bu bilgi silinir ve bir daha gösterilmez.", 26, 0, 420, 60);
    warn.ForeColor = P.Warn; warn.Top = passwordBox.Bottom + Ui.S(14); warn.Height = Ui.TextHeight(warn, 40);
    Button copy = new Button(), ok = new Button();
    Style(copy, "Şifreyi kopyala", 170, 0, 150, 36, false); form.Controls.Add(copy);
    Style(ok, "Tamam", 330, 0, 110, 36, true); form.Controls.Add(ok);
    copy.Top = ok.Top = warn.Bottom + Ui.S(14);
    form.ClientSize = new Size(Ui.S(470), ok.Bottom + Ui.S(22));
    copy.Click += delegate { try { Clipboard.SetText(password); copy.Text = "Kopyalandı"; } catch (Exception) { } };
    ok.Click += delegate { form.Close(); };
    form.AcceptButton = ok; form.CancelButton = ok;
    Application.Run(form);
  }

  static string Line(string text, string label) {
    foreach (string line in text.Split('\n')) if (line.StartsWith(label, StringComparison.Ordinal)) return line.Substring(label.Length).Trim();
    return "";
  }

  static Label Text(Form form, string text, int x, int y, int w, int h) {
    Label label = new Label(); label.Text = text; label.Location = Ui.S(x, y); label.Size = Ui.Z(w, h); label.BackColor = Color.Transparent; label.ForeColor = P.Soft; form.Controls.Add(label); return label;
  }

  static TextBox Field(Form form, string value, int x, int y, int w) {
    TextBox box = new TextBox(); box.ReadOnly = true; box.BorderStyle = BorderStyle.FixedSingle; box.BackColor = P.Field; box.ForeColor = P.Cream;
    box.Font = new Font("Consolas", 11f); box.Text = value; box.Location = Ui.S(x, y); box.Width = Ui.S(w); form.Controls.Add(box); return box;
  }

  static void Style(Button button, string text, int x, int y, int w, int h, bool primary) {
    button.Text = text; button.Location = Ui.S(x, y); button.Size = Ui.Z(w, h); button.FlatStyle = FlatStyle.Flat; button.Cursor = Cursors.Hand;
    button.FlatAppearance.BorderColor = P.Cream; button.FlatAppearance.BorderSize = 1;
    button.BackColor = primary ? P.Cream : P.Back; button.ForeColor = primary ? P.Back : P.Cream;
  }
#else
  // ---------- Mola (café): own server = this installation's node.exe, proving it holds this installation's desktop key ----------
  static bool Own(string root, string origin, int port) { return Local.Mine(root, Local.ListenerPid(port)) && Local.Proof(origin, Local.Key(root)); }

  static void AfterOpen(string root) { }
#endif

  // ---------- Firewall helper (the window's "İzni düzelt"; the installer has the same with --hedef) ----------
  static int FirewallCommand(string root, string[] args) {
    string node = Local.Node(root);
    List<Firewall.Rule> rules = Firewall.Inbound(node);
    if (Has(args, "--durum")) {
      Firewall.Print(Firewall.Json(rules, P.FirewallRule));
      return rules == null ? 1 : Firewall.Exact(rules, P.FirewallRule) ? 0 : 4;
    }
    StringBuilder log = new StringBuilder();
    Action<string> note = line => log.AppendLine(DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "  Güvenlik duvarı: " + line);
    int code = FirewallFix(node, rules, args, note);
    try { Directory.CreateDirectory(Path.Combine(root, "logs")); File.AppendAllText(Path.Combine(root, "logs\\kurulum.log"), log.ToString(), Encoding.UTF8); } catch (Exception) { }
    return code;
  }

  static int FirewallFix(string node, List<Firewall.Rule> rules, string[] args, Action<string> note) {
    bool dry = Has(args, "--dene");
    if (rules == null) { note("kurallar okunamadı."); Firewall.Print("Güvenlik duvarı kuralları okunamadı."); return 1; }
    List<string> plan = Firewall.Plan(node, P.FirewallRule, rules, true);
    if (dry) {
      Firewall.Print("DENEME: hiçbir şey değiştirilmez. Program: " + node + "  Yönetici: " + (Local.IsAdmin() ? "evet" : "hayır (gerçek çalıştırmada Windows bir kez onay sorar)"));
      Firewall.Print("Bu program için gelen bağlantı kuralları: " + (rules.Count == 0 ? "yok" : ""));
      foreach (Firewall.Rule r in rules) Firewall.Print("  " + Firewall.Describe(r) + "  " + r.Program);
      Firewall.Print(plan.Count == 0 ? "Değişiklik gerekmiyor." : "Çalıştırılacak komutlar:");
      Firewall.Run(plan, true, line => Firewall.Print("  " + line));
      note("deneme: " + plan.Count + " komut.");
      return 0;
    }
    if (plan.Count == 0) { note("\"" + P.FirewallRule + "\" kuralı zaten doğru."); return 0; }
    if (!Local.IsAdmin()) {
      if (Has(args, "--yonetici")) { note("yönetici yetkisi alınamadı."); return 1; }  // never ask twice in a loop
      note("Windows'tan yönetici onayı isteniyor.");
      int code = AskWindows("--guvenlik-duvari --yonetici");
      note(code == 0 ? "izin eklendi." : code == 3 ? "yönetici onayı verilmedi." : "izin eklenemedi (çıkış kodu " + code + ").");
      return code;
    }
    bool ok = Firewall.Run(plan, false, note) && Firewall.Exact(Firewall.Inbound(node), P.FirewallRule);
    note(ok ? "\"" + P.FirewallRule + "\" kuralı hazır (özel ağ, gelen bağlantı)." : "kural tam olarak kurulamadı.");
    return ok ? 0 : 1;
  }

  // A small window while Windows asks: started from the background server, the UAC question may only flash in the taskbar.
  static int AskWindows(string arguments) {
    Form form = new Form();
    form.FormBorderStyle = FormBorderStyle.FixedSingle; form.MaximizeBox = false; form.MinimizeBox = false; form.StartPosition = FormStartPosition.CenterScreen;
    form.TopMost = true; form.BackColor = P.Back; form.ForeColor = P.Cream; form.Font = new Font("Segoe UI", 10f); form.Text = P.Name + " · Güvenlik duvarı";
    form.Icon = Ui.AppIcon();
    Label text = new Label(); text.Location = Ui.S(20, 18); text.Size = Ui.Z(400, 60); text.ForeColor = P.Cream;
    text.Text = "Güvenlik duvarı izni (yalnız özel ağ) için Windows yönetici onayı istiyor. Onay penceresi görünmüyorsa görev çubuğunda yanıp sönen simgeye tıklayın.";
    text.Height = Ui.TextHeight(text, 40); form.Controls.Add(text);
    form.ClientSize = new Size(Ui.S(440), text.Bottom + Ui.S(20));
    form.Show(); form.Activate(); Application.DoEvents();
    int code = 1;
    Thread worker = new Thread(() => { code = Firewall.Elevated(arguments, IntPtr.Zero); });
    worker.SetApartmentState(ApartmentState.STA); worker.Start();
    while (worker.IsAlive) { Application.DoEvents(); Thread.Sleep(50); }
    form.Close();
    return code;
  }

  // Mola-Sunucu.cmd / Merkez-Sunucu.cmd holds the server settings (data folder, port, network); started hidden, it outlives this program.
  static void StartServer(string root) {
    ProcessStartInfo info = new ProcessStartInfo("cmd.exe", "/d /c \"\"" + Path.Combine(root, P.ServerCmd) + "\"\"");
    info.UseShellExecute = false; info.CreateNoWindow = true; info.WindowStyle = ProcessWindowStyle.Hidden; info.WorkingDirectory = root;
    Process.Start(info);
  }

  static Form Splash(bool updating) {
    Form form = new Form();
    form.FormBorderStyle = FormBorderStyle.None; form.StartPosition = FormStartPosition.CenterScreen; form.ShowInTaskbar = true;
    form.Size = Ui.Z(360, 130); form.BackColor = P.Back; form.Text = P.Name;
    form.Icon = Ui.AppIcon();
    Label title = new Label();
#if YONETIM
    title.Text = "mola. yönetim";
#else
    title.Text = "mola.";
#endif
    title.ForeColor = P.Cream; title.Font = new Font("Georgia", 22f);
    title.AutoSize = true; title.Location = Ui.S(28, 22);
    Label text = new Label();
    text.Text = updating ? "Güncelleniyor… Birkaç dakika sürebilir." : "Açılıyor…"; text.ForeColor = P.Soft; text.Font = new Font("Segoe UI", 10f);
    text.AutoSize = true; text.Location = Ui.S(31, 80);
    form.Controls.Add(title); form.Controls.Add(text);
    form.Show(); Application.DoEvents();
    return form;
  }

  // Edge is part of Windows 10/11; Chrome is the fallback; the default browser is the last resort. The window has its own
  // profile with extensions and sync off: otherwise Edge signs in with the Windows account, installs the user's own
  // extensions into it and opens their welcome tabs. --lang=tr (8 Ekim denetimi): on an English Windows the browser's own
  // parts spoke English and US formats ("Please fill out this field.", date fields as 10/08/2026 = month first); with it
  // they say "Lütfen bu alanı doldurun." and 08.10.2026, whatever the computer's language.
  /// <summary>True when Mola got its own app window (false: the default browser's tab, nothing to tag).</summary>
  static bool OpenWindow(string root, string url) {
    string browser = Find("msedge.exe", "Microsoft\\Edge\\Application\\msedge.exe") ?? Find("chrome.exe", "Google\\Chrome\\Application\\chrome.exe");
    if (browser == null) { Process.Start(url); return false; }
    Process.Start(browser, "--app=\"" + url + "\" --user-data-dir=\"" + Browser.Profile(root) + "\" --lang=tr --no-first-run --no-default-browser-check --disable-extensions --disable-sync --start-maximized");
    return true;
  }

  static string Find(string exe, string relative) {
    foreach (RegistryKey hive in new RegistryKey[] { Registry.CurrentUser, Registry.LocalMachine }) {
      try {
        using (RegistryKey key = hive.OpenSubKey("SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\" + exe)) {
          string path = key == null ? null : key.GetValue("") as string;
          if (!string.IsNullOrEmpty(path) && File.Exists(path)) return path;
        }
      } catch (System.Security.SecurityException) { }
    }
    foreach (string folder in new string[] { Environment.GetEnvironmentVariable("ProgramFiles(x86)"), Environment.GetEnvironmentVariable("ProgramFiles"), Environment.GetEnvironmentVariable("LOCALAPPDATA") }) {
      if (string.IsNullOrEmpty(folder)) continue;
      string path = Path.Combine(folder, relative);
      if (File.Exists(path)) return path;
    }
    return null;
  }
}
