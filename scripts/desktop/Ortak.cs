// Shared by Mola.cs, Kurulum.cs and Kaldir.cs (scripts/build-installer.mjs compiles each with Urun.cs and this file):
//   Local     this installation's server: port (environment + ayarlar.cmd), listening process, ownership proof, HTTP calls
//   Browser   the Mola window (Edge/Chrome with this installation's "pencere" profile): find, focus, close
//   Taskbar   this installation's taskbar identity on the Mola window and the shortcuts (sharp icon, pins start Mola.exe)
//   Firewall  inbound Windows firewall rules of this installation's runtime\node.exe: read (no admin), set or clean (admin)
//   Ui        DPI awareness and pixel scaling for the small Windows Forms windows
// Keep to C# 5 (.NET Framework 4 compiler).
using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Management;
using System.Net;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;

static class Local {
  public static bool IsAdmin() {
    try { return new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator); } catch (Exception) { return false; }
  }

  /// <summary>"set NAME=value" in ayarlar.cmd next to the program (the owner's own settings, kept by updates); "" if none.</summary>
  public static string Setting(string root, string name) {
    string value = "";
    try {
      foreach (string raw in File.ReadAllLines(Path.Combine(root, "ayarlar.cmd"))) {
        string line = raw.Trim().Trim('"');
        if (!line.StartsWith("set ", StringComparison.OrdinalIgnoreCase)) continue;
        line = line.Substring(4).Trim().Trim('"');
        if (line.StartsWith(name + "=", StringComparison.OrdinalIgnoreCase)) value = line.Substring(name.Length + 1).Trim();
      }
    } catch (Exception) { }
    return value;
  }

  /// <summary>The server's port: P.Port, the environment (PORT / MERKEZ_PORT), then ayarlar.cmd, which the server .cmd calls first.</summary>
  public static int Port(string root) {
    int port = P.Port, custom;
    if (int.TryParse(Environment.GetEnvironmentVariable(P.PortEnv), out custom) && custom > 0 && custom < 65536) port = custom;
    if (int.TryParse(Setting(root, P.PortEnv), out custom) && custom > 0 && custom < 65536) port = custom;
    return port;
  }

  public static string Node(string root) { return Path.GetFullPath(Path.Combine(root, "runtime\\node.exe")); }

  public static string Key(string root) {
    try { return File.ReadAllText(Path.Combine(root, "masaustu.anahtar")).Trim(); } catch (IOException) { return ""; } catch (UnauthorizedAccessException) { return ""; }
  }

  // ---------- Processes ----------
  [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool QueryFullProcessImageName(IntPtr process, int flags, StringBuilder name, ref int size);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);

  /// <summary>Full path of a process's program (works for 32/64 bit and elevated processes of this user); null if unknown.</summary>
  public static string ImagePath(int pid) {
    IntPtr h = OpenProcess(0x1000 /* PROCESS_QUERY_LIMITED_INFORMATION */, false, pid);
    if (h == IntPtr.Zero) return null;
    try { StringBuilder s = new StringBuilder(1024); int n = s.Capacity; return QueryFullProcessImageName(h, 0, s, ref n) ? s.ToString(0, n) : null; }
    finally { CloseHandle(h); }
  }

  /// <summary>The process runs this installation's runtime\node.exe (the server or its watchdog).</summary>
  public static bool Mine(string root, int pid) {
    if (pid <= 0) return false;
    string exe = ImagePath(pid);
    try { return exe != null && Path.GetFullPath(exe).Equals(Node(root), StringComparison.OrdinalIgnoreCase); } catch (Exception) { return false; }
  }

  /// <summary>This installation's node.exe processes: the server and its watchdog (nobetci.mjs).</summary>
  public static List<int> OurNodes(string root) {
    List<int> found = new List<int>();
    foreach (Process p in Process.GetProcessesByName("node")) { using (p) if (Mine(root, p.Id)) found.Add(p.Id); }
    return found;
  }

  public static string ProgramName(int pid) {
    try { using (Process p = Process.GetProcessById(pid)) return p.ProcessName + ".exe"; } catch (Exception) { return null; }
  }

  // The listening socket's process, from the Windows TCP tables (IPv4 and IPv6; no WMI, not language dependent).
  [DllImport("iphlpapi.dll", SetLastError = true)]
  static extern uint GetExtendedTcpTable(IntPtr table, ref int size, bool order, int family, int tableClass, uint reserved);

  public static int ListenerPid(int port) {
    const int TcpTableOwnerPidListener = 3;
    foreach (int family in new int[] { 2, 23 }) {
      int rowSize = family == 2 ? 24 : 56, portAt = family == 2 ? 8 : 20, pidAt = family == 2 ? 20 : 52, size = 0;
      GetExtendedTcpTable(IntPtr.Zero, ref size, false, family, TcpTableOwnerPidListener, 0);
      if (size <= 0) continue;
      IntPtr buffer = Marshal.AllocHGlobal(size);
      try {
        if (GetExtendedTcpTable(buffer, ref size, false, family, TcpTableOwnerPidListener, 0) != 0) continue;
        int count = Marshal.ReadInt32(buffer);
        for (int i = 0; i < count; i++) {
          IntPtr row = new IntPtr(buffer.ToInt64() + 4 + (long)i * rowSize);
          int raw = Marshal.ReadInt32(row, portAt), local = ((raw & 0xFF) << 8) | ((raw >> 8) & 0xFF);
          if (local == port) return Marshal.ReadInt32(row, pidAt);
        }
      } finally { Marshal.FreeHGlobal(buffer); }
    }
    return 0;
  }

  // ---------- HTTP to the local server (127.0.0.1: "localhost" may try IPv6 first) ----------
  /// <summary>Status code (0 = no answer) and body. key: the desktop key header, only for a server already proven to be ours.</summary>
  public static int Call(string method, string url, string key, int timeout, out string body) {
    body = "";
    try {
      HttpWebRequest request = (HttpWebRequest)WebRequest.Create(url);
      request.Method = method; request.Timeout = timeout; request.ReadWriteTimeout = timeout; request.Proxy = null; request.KeepAlive = false;
      if (!string.IsNullOrEmpty(key)) request.Headers.Add("X-Mola-Desktop", key);
      if (method == "POST") {
        byte[] data = Encoding.UTF8.GetBytes("{}");
        request.ContentType = "application/json"; request.ContentLength = data.Length;
        using (Stream s = request.GetRequestStream()) s.Write(data, 0, data.Length);
      }
      using (HttpWebResponse response = (HttpWebResponse)request.GetResponse())
      using (StreamReader reader = new StreamReader(response.GetResponseStream(), Encoding.UTF8)) { body = reader.ReadToEnd(); return (int)response.StatusCode; }
    } catch (WebException e) {
      HttpWebResponse r = e.Response as HttpWebResponse;
      if (r == null) return 0;
      try { using (StreamReader reader = new StreamReader(r.GetResponseStream(), Encoding.UTF8)) body = reader.ReadToEnd(); } catch (Exception) { }
      return (int)r.StatusCode;
    } catch (IOException) { return 0; }
  }

  public static string Hex(byte[] bytes) { StringBuilder s = new StringBuilder(); foreach (byte b in bytes) s.Append(b.ToString("x2")); return s.ToString(); }

  /// <summary>
  /// The server on the port proves it holds this installation's desktop key without seeing it: it answers HMAC-SHA256(key,
  /// "mola-masaustu-kanit:" + nonce) for a fresh random nonce (GET /api/desktop/kanit, server/desktop.ts). A program that
  /// merely answers 200 everywhere cannot, so the key is never sent to it.
  /// </summary>
  public static bool Proof(string origin, string key) {
    if (string.IsNullOrEmpty(key)) return false;
    byte[] random = new byte[16];
    using (RandomNumberGenerator rng = RandomNumberGenerator.Create()) rng.GetBytes(random);
    string nonce = Hex(random), body;
    if (Call("GET", origin + "/api/desktop/kanit?n=" + nonce, null, 1500, out body) != 200) return false;
    Match m = Regex.Match(body, "\"kanit\"\\s*:\\s*\"([0-9a-f]{64})\"");
    if (!m.Success) return false;
    string expected;
    using (HMACSHA256 hmac = new HMACSHA256(Encoding.UTF8.GetBytes(key))) expected = Hex(hmac.ComputeHash(Encoding.UTF8.GetBytes("mola-masaustu-kanit:" + nonce)));
    int diff = 0;
    for (int i = 0; i < 64; i++) diff |= expected[i] ^ m.Groups[1].Value[i];
    return diff == 0;
  }

  public static int Number(string json, string name) {
    Match m = Regex.Match(json ?? "", "\"" + name + "\"\\s*:\\s*(\\d+)");
    int n; return m.Success && int.TryParse(m.Groups[1].Value, out n) ? n : -1;
  }
}

// ---------- The Mola window: Edge/Chrome started with this installation's "pencere" profile ----------
static class Browser {
  delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback, IntPtr lParam);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hWnd, int command);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern void SwitchToThisWindow(IntPtr hWnd, bool altTab);
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr hWnd, uint command);
  [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr hWnd, StringBuilder name, int size);
  [DllImport("user32.dll")] static extern bool PostMessage(IntPtr hWnd, uint message, IntPtr w, IntPtr l);

  public static string Profile(string root) { return Path.Combine(root, "pencere"); }

  public static bool UsesProfile(string commandLine, string profile) {
    int at = commandLine.IndexOf(profile, StringComparison.OrdinalIgnoreCase);
    while (at >= 0) {
      int end = at + profile.Length;
      if (end == commandLine.Length || commandLine[end] == '"' || commandLine[end] == ' ' || commandLine[end] == '\\') return true;
      at = commandLine.IndexOf(profile, end, StringComparison.OrdinalIgnoreCase);
    }
    return false;
  }

  /// <summary>Browser processes (main and helpers) started with this installation's profile; never the owner's own browser.</summary>
  public static List<int> Processes(string root, string where) {
    string profile = Profile(root);
    List<int> found = new List<int>();
    int self = Process.GetCurrentProcess().Id;
    try {
      using (ManagementObjectSearcher searcher = new ManagementObjectSearcher("SELECT ProcessId, CommandLine FROM Win32_Process" + where))
        foreach (ManagementObject p in searcher.Get()) {
          string line = p["CommandLine"] as string;
          int id = Convert.ToInt32(p["ProcessId"]);
          if (line != null && id != self && UsesProfile(line, profile)) found.Add(id);
        }
    } catch (Exception) { }
    return found;
  }

  /// <summary>The open Mola windows (visible app windows of this installation's profile).</summary>
  public static List<IntPtr> AppWindows(string root) { return Windows(Processes(root, BrowserNames)); }

  /// <summary>Visible top-level browser windows of these processes (the Mola app windows).</summary>
  static List<IntPtr> Windows(List<int> pids) {
    List<IntPtr> found = new List<IntPtr>();
    if (pids.Count == 0) return found;
    EnumWindows((h, l) => {
      uint pid; GetWindowThreadProcessId(h, out pid);
      if (!pids.Contains((int)pid) || !IsWindowVisible(h) || GetWindow(h, 4 /* GW_OWNER */) != IntPtr.Zero || GetWindowTextLength(h) == 0) return true;
      StringBuilder cls = new StringBuilder(64); GetClassName(h, cls, cls.Capacity);
      if (cls.ToString().StartsWith("Chrome_WidgetWin", StringComparison.Ordinal)) found.Add(h);
      return true;
    }, IntPtr.Zero);
    return found;
  }

  const string BrowserNames = " WHERE Name='msedge.exe' OR Name='chrome.exe'";

  /// <summary>Brings the open Mola window to the front (restored if minimised). False if there is none.</summary>
  public static bool Focus(string root) {
    List<IntPtr> windows = Windows(Processes(root, BrowserNames));
    if (windows.Count == 0) return false;
    IntPtr h = windows[0];
    ShowWindow(h, IsIconic(h) ? 9 /* SW_RESTORE */ : 5 /* SW_SHOW */);
    if (!SetForegroundWindow(h) || GetForegroundWindow() != h) SwitchToThisWindow(h, true);
    return true;
  }

  /// <summary>Closes the Mola windows (politely, then the processes of this profile only). Returns how many processes there were.</summary>
  public static int Close(string root) {
    List<int> pids = Processes(root, BrowserNames);
    if (pids.Count == 0) return 0;
    foreach (IntPtr h in Windows(pids)) PostMessage(h, 0x0010 /* WM_CLOSE */, IntPtr.Zero, IntPtr.Zero);
    for (int i = 0; i < 30 && Alive(pids); i++) Thread.Sleep(200);
    foreach (int id in pids) { try { using (Process p = Process.GetProcessById(id)) if (!p.HasExited) p.Kill(); } catch (Exception) { } }
    Thread.Sleep(300);
    return pids.Count;
  }

  static bool Alive(List<int> pids) {
    foreach (int id in pids) { try { using (Process p = Process.GetProcessById(id)) if (!p.HasExited) return true; } catch (Exception) { } }
    return false;
  }
}

// ---------- Taskbar: the Mola window shows Mola.exe's own sharp icon ----------
// The Mola window is Edge/Chrome in app mode (--app). The browser gives such a window a taskbar identity of its own
// (AppUserModelID) with no shortcut behind it, so Windows draws the window's icon there: the page's favicon, a 16-px picture
// blown up to 24–48 px, blurry (10 Ekim, the owner's report). Here the window gets this installation's identity, the same one
// the installer writes into the Start menu and desktop shortcuts: Windows then takes the shortcut's icon, i.e. Mola.exe's
// multi-size icon (16–256 px, scripts/mola-icons.mjs), the splash and the Mola window share one taskbar button, and pinning
// the window pins Mola.exe (not the browser, and never the window's address with the desktop key).
static class Taskbar {
  [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IPropertyStore {
    [PreserveSig] int GetCount(out uint count);
    [PreserveSig] int GetAt(uint index, out PropertyKey key);
    [PreserveSig] int GetValue(ref PropertyKey key, out PropVariant value);
    [PreserveSig] int SetValue(ref PropertyKey key, ref PropVariant value);
    [PreserveSig] int Commit();
  }
  [StructLayout(LayoutKind.Sequential, Pack = 4)]
  struct PropertyKey {
    public Guid Format; public uint Id;
    public PropertyKey(string format, uint id) { Format = new Guid(format); Id = id; }
  }
  // PROPVARIANT: type, three reserved words, then the value (16 bytes on 32-bit Windows, 24 on 64-bit).
  [StructLayout(LayoutKind.Explicit, Size = 24)]
  struct PropVariant { [FieldOffset(0)] public ushort Type; [FieldOffset(8)] public IntPtr Value; }

  [DllImport("shell32.dll")] static extern int SHGetPropertyStoreForWindow(IntPtr hwnd, ref Guid iid, [MarshalAs(UnmanagedType.Interface)] out IPropertyStore store);
  [DllImport("shell32.dll", CharSet = CharSet.Unicode)] static extern int SHGetPropertyStoreFromParsingName(string path, IntPtr bind, int flags, ref Guid iid, [MarshalAs(UnmanagedType.Interface)] out IPropertyStore store);
  [DllImport("shell32.dll", CharSet = CharSet.Unicode)] static extern int SetCurrentProcessExplicitAppUserModelID(string id);
  [DllImport("ole32.dll")] static extern int PropVariantClear(ref PropVariant value);

  const string AppModel = "9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3";  // System.AppUserModel.*
  const uint RelaunchCommand = 2, RelaunchIcon = 3, RelaunchName = 4, AppId = 5;
  const ushort VT_LPWSTR = 31;

  /// <summary>
  /// This installation's taskbar identity: "MerkutStudios.Mola." / "MerkutStudios.MolaYonetim." + a short hash of the install
  /// folder, so two installations (another folder, a test copy) never share a button. The installer (Kurulum.cs, target
  /// folder) and Mola.exe (its own folder) compute the same text.
  /// </summary>
  public static string Id(string root) {
    string path;
    try { path = Path.GetFullPath(root); } catch (Exception) { path = root; }
    path = path.TrimEnd('\\').ToLowerInvariant();
    using (SHA256 sha = SHA256.Create()) return "MerkutStudios." + P.RegKey + "." + Local.Hex(sha.ComputeHash(Encoding.UTF8.GetBytes(path))).Substring(0, 12);
  }

  /// <summary>Mola.exe's own windows (splash, first login) join the same taskbar button.</summary>
  public static void ForProcess(string root) { try { SetCurrentProcessExplicitAppUserModelID(Id(root)); } catch (Exception) { } }

  static string Get(IPropertyStore store, string format, uint id) {
    PropertyKey key = new PropertyKey(format, id); PropVariant value;
    if (store.GetValue(ref key, out value) < 0) return null;
    try { return value.Type == VT_LPWSTR && value.Value != IntPtr.Zero ? Marshal.PtrToStringUni(value.Value) : null; } finally { PropVariantClear(ref value); }
  }

  static bool Set(IPropertyStore store, uint id, string text) {
    PropertyKey key = new PropertyKey(AppModel, id);
    PropVariant value = new PropVariant(); value.Type = VT_LPWSTR; value.Value = Marshal.StringToCoTaskMemUni(text);
    try { return store.SetValue(ref key, ref value) >= 0; } finally { PropVariantClear(ref value); }
  }

  /// <summary>A window's taskbar identity (null: none of its own). For logs and tests/desktop-icons.test.ts.</summary>
  public static string IdOf(IntPtr window) {
    Guid iid = typeof(IPropertyStore).GUID; IPropertyStore store;
    try { if (SHGetPropertyStoreForWindow(window, ref iid, out store) < 0 || store == null) return null; } catch (Exception) { return null; }
    try { return Get(store, AppModel, AppId); } catch (Exception) { return null; } finally { Marshal.ReleaseComObject(store); }
  }

  /// <summary>Gives one window this installation's identity and relaunch details (Mola.exe, its name and icon).</summary>
  public static bool TagWindow(IntPtr window, string root) {
    Guid iid = typeof(IPropertyStore).GUID; IPropertyStore store;
    try { if (SHGetPropertyStoreForWindow(window, ref iid, out store) < 0 || store == null) return false; } catch (Exception) { return false; }
    try {
      string exe = Path.Combine(root, P.Launcher);
      bool ok = Set(store, RelaunchCommand, "\"" + exe + "\"") & Set(store, RelaunchName, P.Name) & Set(store, RelaunchIcon, exe + ",0");
      if (Get(store, AppModel, AppId) != Id(root)) ok &= Set(store, AppId, Id(root));
      store.Commit();
      return ok;
    } catch (Exception) { return false; } finally { Marshal.ReleaseComObject(store); }
  }

  /// <summary>
  /// Waits up to `wait` ms for the Mola window (a cold browser start takes a few seconds) and tags it; once more a moment later
  /// in case the browser set its own identity after showing the window. Number of windows tagged.
  /// </summary>
  public static int TagWindows(string root, int wait) {
    Stopwatch clock = Stopwatch.StartNew();
    List<IntPtr> windows = Browser.AppWindows(root);
    while (windows.Count == 0 && clock.ElapsedMilliseconds < wait) { Thread.Sleep(250); windows = Browser.AppWindows(root); }
    if (windows.Count == 0) return 0;
    int tagged = 0;
    foreach (IntPtr h in windows) if (TagWindow(h, root)) tagged++;
    if (wait > 0) { Thread.Sleep(1500); foreach (IntPtr h in Browser.AppWindows(root)) TagWindow(h, root); }
    return tagged;
  }

  /// <summary>
  /// Writes this installation's identity into a shortcut (.lnk). With `target` given, only when the shortcut starts that
  /// program (an older install's shortcuts, Kur.cmd's: Mola.exe brings them up to date). True when it carries the identity.
  /// </summary>
  public static bool TagShortcut(string link, string root, string target) {
    if (!File.Exists(link)) return false;
    // The target is only in the read-only view (a writable one holds just the writable properties).
    if (target != null) {
      string points = null;
      IPropertyStore view = Store(link, 0 /* GPS_DEFAULT */);
      if (view == null) return false;
      try { points = Get(view, "B9B4B3FC-2B51-4A42-B5D8-324146AFCF25", 2); }  // System.Link.TargetParsingPath
      catch (Exception) { } finally { Marshal.ReleaseComObject(view); }
      try { if (points == null || !Path.GetFullPath(points).Equals(Path.GetFullPath(target), StringComparison.OrdinalIgnoreCase)) return false; } catch (Exception) { return false; }
    }
    IPropertyStore store = Store(link, 2 /* GPS_READWRITE */);
    if (store == null) return false;
    try {
      string id = Id(root);
      if (Get(store, AppModel, AppId) == id) return true;
      return Set(store, AppId, id) && store.Commit() >= 0;
    } catch (Exception) { return false; } finally { Marshal.ReleaseComObject(store); }
  }

  static IPropertyStore Store(string file, int flags) {
    Guid iid = typeof(IPropertyStore).GUID; IPropertyStore store;
    try { return SHGetPropertyStoreFromParsingName(file, IntPtr.Zero, flags, ref iid, out store) < 0 ? null : store; } catch (Exception) { return null; }
  }

  /// <summary>The Start menu and desktop "Mola" shortcuts that start this folder's Mola.exe get its identity (if not yet).</summary>
  public static void TagShortcuts(string root) {
    string exe = Path.Combine(root, P.Launcher);
    foreach (Environment.SpecialFolder folder in new Environment.SpecialFolder[] { Environment.SpecialFolder.Programs, Environment.SpecialFolder.DesktopDirectory }) {
      try { TagShortcut(Path.Combine(Environment.GetFolderPath(folder), P.Name + ".lnk"), root, exe); } catch (Exception) { }
    }
  }
}

// ---------- Windows firewall: inbound rules of this installation's runtime\node.exe ----------
// Reading needs no administrator (HNetCfg.FwPolicy2, the same list "Gelişmiş ayarlar" shows). Changes run netsh with both the
// rule's name and this program's path, so a rule of another program with the same name ("Node.js JavaScript Runtime" of a
// developer's Node.js, another Mola folder's "Mola") is never touched.
static class Firewall {
  public class Rule { public string Name, Program; public int Profiles, Protocol; public bool Allow, Enabled; public string Ports; }

  /// <summary>null when the firewall list cannot be read.</summary>
  public static List<Rule> Inbound(string node) {
    List<Rule> found = new List<Rule>();
    try {
      Type type = Type.GetTypeFromProgID("HNetCfg.FwPolicy2", false);
      if (type == null) return null;
      object policy = Activator.CreateInstance(type);
      object rules = type.InvokeMember("Rules", BindingFlags.GetProperty, null, policy, null);
      foreach (object r in (IEnumerable)rules) {
        try {
          string app = Get(r, "ApplicationName") as string;
          if (string.IsNullOrEmpty(app) || Convert.ToInt32(Get(r, "Direction")) != 1 /* in */ || !SamePath(app, node)) continue;
          Rule rule = new Rule();
          rule.Name = Get(r, "Name") as string ?? ""; rule.Program = app;
          rule.Profiles = Convert.ToInt32(Get(r, "Profiles")); rule.Protocol = Convert.ToInt32(Get(r, "Protocol"));
          rule.Allow = Convert.ToInt32(Get(r, "Action")) == 1; rule.Enabled = Convert.ToBoolean(Get(r, "Enabled"));
          rule.Ports = Get(r, "LocalPorts") as string ?? "*";
          found.Add(rule);
        } finally { Marshal.ReleaseComObject(r); }
      }
    } catch (Exception) { return null; }
    return found;
  }

  static object Get(object com, string name) { return com.GetType().InvokeMember(name, BindingFlags.GetProperty, null, com, null); }

  static bool SamePath(string a, string b) {
    try { return Path.GetFullPath(Environment.ExpandEnvironmentVariables(a.Trim().Trim('"'))).Equals(Path.GetFullPath(b), StringComparison.OrdinalIgnoreCase); }
    catch (Exception) { return false; }
  }

  /// <summary>Exactly what Mola wants: one enabled "allow" rule with Mola's name, private networks only, any port, nothing else.</summary>
  public static bool Exact(List<Rule> rules, string name) {
    return rules != null && rules.Count == 1 && rules[0].Name == name && rules[0].Allow && rules[0].Enabled && rules[0].Profiles == 2 && rules[0].Protocol == 256 && (rules[0].Ports == "*" || rules[0].Ports == "");
  }

  public static string Describe(Rule r) {
    string profile = r.Profiles == 2 ? "özel" : r.Profiles == 4 ? "ortak" : r.Profiles == 1 ? "etki alanı" : (r.Profiles & 0x7) == 0x7 ? "hepsi" : "profil " + r.Profiles;
    return "\"" + r.Name + "\" (" + (r.Allow ? "izin" : "engel") + ", " + profile + (r.Enabled ? "" : ", kapalı") + ")";
  }

  public static string State(List<Rule> rules, string name) { return rules == null ? "bilinmiyor" : Exact(rules, name) ? "tamam" : rules.Count == 0 ? "eksik" : "duzelt"; }

  /// <summary>netsh arguments that leave only Mola's rule (add) or no rule at all (add = false) for this node.exe.</summary>
  public static List<string> Plan(string node, string name, List<Rule> current, bool add) {
    List<string> plan = new List<string>();
    if (add && Exact(current, name)) return plan;
    List<string> done = new List<string>();
    foreach (Rule r in current) {
      string key = r.Name + "\n" + r.Program;
      if (done.Contains(key)) continue;
      done.Add(key);
      if (r.Name.IndexOf('"') >= 0) continue;  // netsh cannot name it; reported by the caller as left over
      plan.Add("advfirewall firewall delete rule name=\"" + r.Name + "\" dir=in program=\"" + r.Program + "\"");
    }
    if (add) plan.Add("advfirewall firewall add rule name=\"" + name + "\" dir=in action=allow program=\"" + node + "\" profile=private enable=yes" +
      " description=\"" + P.Name + ": " + P.FirewallPurpose + "\"");
    return plan;
  }

  /// <summary>Runs (or with dry, only reports) the plan. True if every command succeeded.</summary>
  public static bool Run(List<string> plan, bool dry, Action<string> log) {
    bool ok = true;
    foreach (string args in plan) {
      if (dry) { log("netsh.exe " + args); continue; }
      int code = Hidden("netsh.exe", args, 30000);
      log("netsh " + args + " → " + (code == 0 ? "tamam" : "çıkış kodu " + code));
      if (code != 0) ok = false;
    }
    return ok;
  }

  static int Hidden(string file, string arguments, int timeout) {
    ProcessStartInfo info = new ProcessStartInfo(file, arguments);
    info.UseShellExecute = false; info.CreateNoWindow = true; info.WindowStyle = ProcessWindowStyle.Hidden;
    using (Process p = Process.Start(info)) {
      if (!p.WaitForExit(timeout)) { try { p.Kill(); } catch (Exception) { } return -1; }
      return p.ExitCode;
    }
  }

  /// <summary>"--durum" output: one line of JSON for the café server (GET /api/desktop/firewall).</summary>
  public static string Json(List<Rule> rules, string name) {
    StringBuilder s = new StringBuilder("{\"durum\":\"" + State(rules, name) + "\",\"kurallar\":[");
    if (rules != null) for (int i = 0; i < rules.Count; i++) {
      Rule r = rules[i];
      s.Append(i > 0 ? "," : "").Append("{\"ad\":\"").Append(r.Name.Replace("\\", "\\\\").Replace("\"", "\\\"")).Append("\",\"izin\":").Append(r.Allow ? "true" : "false")
       .Append(",\"acik\":").Append(r.Enabled ? "true" : "false").Append(",\"profiller\":").Append(r.Profiles).Append("}");
    }
    return s.Append("]}").ToString();
  }

  /// <summary>
  /// Runs "&lt;this program&gt; &lt;arguments&gt;" as administrator (Windows asks once, UAC) and waits.
  /// Exit code of the elevated copy; 3 when the owner said no to the Windows question.
  /// </summary>
  public static int Elevated(string arguments, IntPtr owner) {
    ProcessStartInfo info = new ProcessStartInfo(Assembly.GetExecutingAssembly().Location, arguments);
    info.UseShellExecute = true; info.Verb = "runas"; info.WindowStyle = ProcessWindowStyle.Hidden; info.ErrorDialog = false;
    if (owner != IntPtr.Zero) info.ErrorDialogParentHandle = owner;
    try {
      using (Process p = Process.Start(info)) {
        if (p == null) return 1;
        p.WaitForExit();
        return p.ExitCode;
      }
    } catch (System.ComponentModel.Win32Exception e) { return e.NativeErrorCode == 1223 /* ERROR_CANCELLED */ ? 3 : 1; }
  }

  static StreamWriter output;
  /// <summary>For --dene / --durum: standard output in UTF-8 when redirected (the café server, tests), nothing otherwise.</summary>
  public static void Print(string line) {
    try {
      if (output == null) { output = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false)); output.AutoFlush = true; }
      output.WriteLine(line);
    } catch (Exception) { }
  }
}

// ---------- Sharp windows on high-DPI screens ----------
static class Ui {
  [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
  public static float K = 1f;

  /// <summary>Call first in Main, before any window: text stays sharp; the layouts multiply their pixel values with S().</summary>
  public static void DpiAware() {
    try { SetProcessDPIAware(); } catch (Exception) { }
    try { using (Graphics g = Graphics.FromHwnd(IntPtr.Zero)) K = Math.Max(1f, g.DpiX / 96f); } catch (Exception) { }
  }

  public static int S(int value) { return (int)Math.Round(value * K); }
  public static Point S(int x, int y) { return new Point(S(x), S(y)); }
  public static Size Z(int w, int h) { return new Size(S(w), S(h)); }

  /// <summary>
  /// The program's icon with all its sizes (mola.ico, embedded by scripts/build-installer.mjs next to the Windows icon). A window
  /// given it picks 16/20/24 for the title bar and 32/40/48 for the taskbar and Alt+Tab at this screen's scaling; the icon of
  /// the program file (ExtractAssociatedIcon) is 32 px only and looked soft at 125–200 %.
  /// </summary>
  public static Icon AppIcon() {
    try { using (Stream s = Assembly.GetExecutingAssembly().GetManifestResourceStream("mola.ico")) if (s != null) return new Icon(s); } catch (Exception) { }
    try { return Icon.ExtractAssociatedIcon(Assembly.GetExecutingAssembly().Location); } catch (Exception) { return null; }
  }

  /// <summary>Height a wrapped label needs for its text at its width (DPI-correct), at least min (unscaled pixels).</summary>
  public static int TextHeight(Label label, int min) { return Math.Max(S(min), label.GetPreferredSize(new Size(label.Width, 0)).Height + S(2)); }
}
