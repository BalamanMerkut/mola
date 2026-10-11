// Product constants shared by Mola.cs, Kurulum.cs and Kaldir.cs. scripts/build-installer.mjs compiles each of them
// together with this file and Ortak.cs (shared code): without symbols for the café's "Mola", with /define:YONETIM for the vendor's "Mola Yönetim"
// (Mola Merkez on the vendor's own computer). Keep to C# 5 (.NET Framework 4 compiler).
using System.Drawing;

static class P {
#if YONETIM
  public const string Name = "Mola Yönetim";
  /// <summary>"Mola Yönetim'i" (accusative) and "Mola Yönetim'e" (dative), for Turkish sentences.</summary>
  public const string Acc = "Mola Yönetim'i", Dat = "Mola Yönetim'e";
  public const string Description = "Mola Yönetim: lisans, etkinleştirme ve destek (Mola Merkez)";
  public const string Folder = "Mola Yonetim", PackageFolder = "Mola-Yonetim";
  public const string Launcher = "Mola Yönetim.exe", Setup = "Mola Yönetim Kurulum.exe", Uninstaller = "Mola-Yonetim-Kaldir.exe";
  public const string ServerCmd = "Merkez-Sunucu.cmd", StopCmd = "Merkez-Durdur.cmd", ServerFile = "app\\merkez.mjs", ServerLog = "logs\\merkez.log";
  public const string RegKey = "MolaYonetim";
  public const string UninstallShortcut = "Mola Yönetim'i kaldır";
  /// <summary>Inbound rule for runtime\node.exe (private networks). Only when MERKEZ_LAN=1: otherwise Merkez listens on 127.0.0.1.</summary>
  public const string FirewallRule = "Mola Yönetim";
  public static readonly bool FirewallOnlyWithLan = true;
  public const string FirewallPurpose = "başka bilgisayarlardaki kafeler Merkez'e yalnız özel (ev/iş) ağdan bağlanır.";
  public const string FirewallHint = "Başka bilgisayardaki kafeler bağlanamazsa kurulumu yeniden çalıştırıp Windows'un yönetici sorusuna Evet deyin.";
  public const int Port = 4000;
  public const string PortEnv = "MERKEZ_PORT", Health = "/api/merkez/v1/health";
  public const string SetupSentence = "Mola Yönetim ve Mola Merkez bu bilgisayara kurulur. İnternet ve yönetici yetkisi gerekmez. Önceki kurulumdaki Merkez verileri (işletmeler, lisanslar, imza anahtarı) korunur.";
  public const string StartupLabel = "Bilgisayar açılınca Merkez'i başlat (kafeler bağlanabilsin)";
  public const string ChooseText = "Mola Yönetim'in kurulacağı klasörü seçin. Merkez verileri de bu klasörde durur.";
  public const string CloseHint = "Mola Yönetim penceresini kapatın";
  public const string FinishNote = "Mola Merkez yalnız bu bilgisayardan erişilir. Başka bilgisayardaki kafeler bağlanacaksa BENIOKU.txt'deki \"MERKEZ_LAN\" bölümüne bakın.\nİlk açılışta giriş şifresi gösterilir.";
  public const string KeepText = "Program, simgeler ve Windows'taki kaydı silinir.\nMerkez verileri (işletmeler, lisanslar ve lisansları imzalayan anahtar) bu klasörde kalır; yeniden kurarsanız kaldığı yerden devam eder.";
  public const string WipeLabel = "Merkez verilerini ve imza anahtarını da sil";
  public const string WipeText = "Program ile birlikte Merkez verileri ve lisansları imzalayan anahtar da kalıcı olarak silinir.\nBu anahtarla hazırlanmış kafe paketleri bir daha lisans alamaz ve uzatamaz.";
  public const string WipeQuestion = "Mola Merkez verileri (işletmeler, lisanslar, destek talepleri) ve lisansları imzalayan anahtar KALICI OLARAK silinecek. Bu geri alınamaz.\n\n" +
    "Bu anahtarla hazırlanmış kafe paketleri bir daha lisans alamaz ve uzatamaz; kafelere yeni anahtarla hazırlanmış yeni paket kurmanız gerekir.\n" +
    "\"veri\" klasörünün bir kopyası yoksa Hayır'a basın.\n\nVeriler silinsin mi?";
  public const string WipeTitle = "Merkez verilerini de sil";
  public const string RemovedKeep = "Mola Yönetim'i yeniden kurarsanız kaldığı yerden devam eder. \"veri\" klasörü lisans imza anahtarını içerir: silmeyin, bir kopyasını saklayın.";
  public const string RemovedWiped = "Merkez verileri ve imza anahtarı silindi.";
  public static readonly string[] DataItems = { "veri", "logs", "ayarlar.cmd", "merkez-yedek", "merkez-yedek-prova", "merkez-guncellemeler" };
  public static readonly string[] ProgramItems = { "app", "runtime", Launcher, ServerCmd, StopCmd, "Sifre-Sifirla.cmd", "sifre-sifirla.sh", "BENIOKU.txt", "pencere" };
  public static readonly string[] OldItems = { };
  // Dark ink and gold: never confused with the café's green Mola.
  public static readonly Color Back = Color.FromArgb(28, 34, 48), Field = Color.FromArgb(44, 53, 72), Cream = Color.FromArgb(243, 235, 221), Soft = Color.FromArgb(196, 204, 220), Warn = Color.FromArgb(232, 176, 74);
#else
  public const string Name = "Mola";
  public const string Acc = "Mola'yı", Dat = "Mola'ya";
  public const string Description = "Mola adisyon ve QR menü";
  public const string Folder = "Mola", PackageFolder = "Windows";
  public const string Launcher = "Mola.exe", Setup = "Mola Kurulum.exe", Uninstaller = "Mola-Kaldir.exe";
  public const string ServerCmd = "Mola-Sunucu.cmd", StopCmd = "Mola-Durdur.cmd", ServerFile = "app\\server.mjs", ServerLog = "logs\\sunucu.log";
  public const string RegKey = "Mola";
  public const string UninstallShortcut = "Mola'yı kaldır";
  public const string FirewallRule = "Mola";
  public static readonly bool FirewallOnlyWithLan = false;
  public const string FirewallPurpose = "tabletler ve telefonlar bu bilgisayara yalnız özel (ev/iş) ağdan bağlanır.";
  public const string FirewallHint = "Tabletler bağlanamazsa Mola penceresinde Tabletler > \"İzni düzelt\"e basın.";
  public const int Port = 3000;
  public const string PortEnv = "PORT", Health = "/api/health";
  public const string SetupSentence = "Mola bu bilgisayara kurulur. İnternet gerekmez. Windows yalnız tabletlerin bağlanabilmesi (güvenlik duvarı izni) için bir kez yönetici onayı sorar. Önceki verileriniz ve yedekleriniz korunur.";
  public const string StartupLabel = "Bilgisayar açılınca başlat";
  public const string ChooseText = "Mola'nın kurulacağı klasörü seçin. Verileriniz ve yedekleriniz de bu klasörde durur.";
  public const string CloseHint = "Mola açıksa şeritteki \"Kapat\" ile kapatın";
  public const string FinishNote = "";
  public const string KeepText = "Program, simgeler ve Windows'taki kaydı silinir.\nSatışlar, işletme verileri ve yedekler bu klasörde kalır; Mola'yı yeniden kurarsanız kaldığı yerden devam eder.\nFlash bellek ya da OneDrive'daki ikinci yedeklere hiç dokunulmaz.";
  public const string WipeLabel = "Verileri ve yedekleri de sil";
  public const string WipeText = "Program ile birlikte satış geçmişi, işletme verileri ve bu bilgisayardaki yedekler de kalıcı olarak silinir.\nFlash bellek ya da OneDrive'daki ikinci yedeklere dokunulmaz.";
  public const string WipeQuestion = "Satış geçmişi, işletme verileri ve bu bilgisayardaki yedekler KALICI OLARAK silinecek. Bu geri alınamaz.\n\n" +
    "Bu bilgisayarda açılacak veri kalmayacağı için kurtarma kodu burada bir işe yaramaz.\n" +
    "Flash bellek ya da OneDrive'daki (Mola-Yedek) ikinci yedekler silinmez; onları ileride geri yüklemek isterseniz kurtarma kodunu saklamaya devam edin.\n\n" +
    "Veriler ve yedekler silinsin mi?";
  public const string WipeTitle = "Verileri de sil";
  public const string RemovedKeep = "Mola'yı yeniden kurarsanız kaldığı yerden devam eder. Tamamen silmek isterseniz bu klasörü silebilirsiniz.";
  public const string RemovedWiped = "İkinci yedek yerindeki (flash bellek, OneDrive) yedekler duruyor.";
  public static readonly string[] DataItems = { "veri", "backups", "backup-keys", "restore-checks", "logs", "ayarlar.cmd", "lisans-izi", "guncelleme-yedek" };
  public static readonly string[] ProgramItems = { "app", "runtime", "Mola.exe", "Mola-Sunucu.cmd", "Mola-Durdur.cmd", "BENIOKU.txt", "Mola-Ac.cmd", "Mola-Arkaplan.vbs", "pencere", "guncelleme", "onceki", "Mola.exe.yeni", "Mola.exe.eski" };
  /// <summary>Files of older versions that an update removes.</summary>
  public static readonly string[] OldItems = { "Mola-Ac.cmd", "Mola-Arkaplan.vbs" };
  public static readonly Color Back = Color.FromArgb(23, 52, 42), Field = Color.FromArgb(36, 72, 59), Cream = Color.FromArgb(243, 235, 221), Soft = Color.FromArgb(200, 214, 202), Warn = Color.FromArgb(240, 190, 120);
#endif
}
