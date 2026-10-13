# Mola: satıcı bilgisayarında olup başka hiçbir yerde olmayan dosyaları Google Drive'a kopyalar (npm run bilgisayar:yedek).
# Format atılırsa kaybolacaklar (docs/pdf/kaynak/kilavuz/yonetim.ts, "Satıcı bilgisayarı formatlanırsa"):
#   claude-sohbetleri\  %USERPROFILE%\.claude\projects: Claude Code sohbetleri ve proje hafızası (memory\)
#   android-imza\       .local\android-imza: APK imza anahtarı (mola-android.p12). Şifresi (sifre.txt) KOPYALANMAZ:
#                       şifre yöneticisinde ayrıca saklanır; anahtar şifresiz işe yaramaz.
#   ssh\                %USERPROFILE%\.ssh: VDS'e giriş anahtarı (parolalı) ve sunucunun kimliği (known_hosts)
# Yalnız yeni ve değişen dosyaları kopyalar, Drive'da HİÇBİR ŞEYİ SİLMEZ (format sonrası boş bir klasörden çalışsa bile
# yedek yerinde kalır). Geri koymak: aynı klasörleri aynı yerlere kopyalayın; Claude sohbetleri yeniden listelenir.
# Görev Zamanlayıcı için: scripts\bilgisayar-yedek.cmd (komutu "npm run bilgisayar:yedek -- -Zamanla" yazar).
param([string]$Hedef = '', [switch]$Zamanla)
$ErrorActionPreference = 'Stop'
$kok = Split-Path -Parent $PSScriptRoot
$gunluk = Join-Path $kok '.local\kayitlar\bilgisayar-yedek.log'
New-Item -ItemType Directory -Force (Split-Path $gunluk) | Out-Null
function Yaz([string]$satir) { $s = "$((Get-Date).ToString('yyyy-MM-ddTHH:mm:ss'))`t$satir"; Add-Content -Encoding utf8 -Path $gunluk -Value $s; Write-Output $satir }

if ($Zamanla) {
  $cmd = Join-Path $PSScriptRoot 'bilgisayar-yedek.cmd'
  Write-Output "Görev Zamanlayıcı'ya her gün 07:15 için bir görev eklemek size kalmış (sistem ayarıdır; bu araç eklemez)."
  Write-Output 'PowerShell''de, bir kez, kendiniz çalıştırın:'
  Write-Output "  schtasks --% /Create /TN `"Mola\Bilgisayar yedek`" /TR `"\`"$cmd\`"`" /SC DAILY /ST 07:15 /IT /F"
  Write-Output 'Kontrol: schtasks /Query /TN "Mola\Bilgisayar yedek" /V /FO LIST'
  exit 0
}

# Google Drive: verilen klasör, yoksa "My Drive" ya da "Drive'ım" olan ilk sürücü.
if (-not $Hedef) {
  foreach ($d in Get-PSDrive -PSProvider FileSystem) {
    foreach ($ad in 'My Drive', "Drive'ım") { $y = Join-Path $d.Root $ad; if (Test-Path -LiteralPath $y) { $Hedef = Join-Path $y 'Mola-Bilgisayar-Yedegi'; break } }
    if ($Hedef) { break }
  }
}
if (-not $Hedef) { Yaz 'Google Drive bulunamadı (Drive masaüstü uygulaması açık mı?). Hiçbir şey kopyalanmadı.'; exit 1 }
$drive = Split-Path -Parent $Hedef
if (-not (Test-Path -LiteralPath $drive)) { Yaz "Hedef bulunamadı: $drive. Hiçbir şey kopyalanmadı."; exit 1 }

$isler = @(
  @{ Ad = 'claude-sohbetleri'; Kaynak = Join-Path $env:USERPROFILE '.claude\projects'; Haric = @() },
  @{ Ad = 'android-imza'; Kaynak = Join-Path $kok '.local\android-imza'; Haric = @('sifre.txt') },
  @{ Ad = 'ssh'; Kaynak = Join-Path $env:USERPROFILE '.ssh'; Haric = @('known_hosts.old') }
)
$hata = 0; $ozet = @()
foreach ($is in $isler) {
  if (-not (Test-Path -LiteralPath $is.Kaynak)) { $ozet += "$($is.Ad): kaynak yok"; continue }
  $varis = Join-Path $Hedef $is.Ad
  $arg = @($is.Kaynak, $varis, '/E', '/R:2', '/W:5', '/NP', '/NFL', '/NDL', '/NJH', '/NJS', '/XJ')
  if ($is.Haric.Count) { $arg += '/XF'; $arg += $is.Haric }
  & robocopy @arg | Out-Null
  $kod = $LASTEXITCODE
  # robocopy: 0-7 başarılı (1 = dosya kopyalandı), 8 ve üstü hata.
  if ($kod -ge 8) { $hata++; $ozet += "$($is.Ad): HATA (robocopy $kod)" } else { $ozet += "$($is.Ad): tamam" }
}
Yaz ("Bilgisayar yedeği → $Hedef · " + ($ozet -join ' · '))
if ($hata) { exit 1 } else { exit 0 }
