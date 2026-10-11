param([Parameter(Mandatory=$true)][string]$Address, [string]$OutputDirectory = '.local/https')
$ErrorActionPreference = 'Stop'
# PEM export and certificate serials need .NET 7+, which ships with PowerShell 7, not Windows PowerShell 5.1.
if ($PSVersionTable.PSVersion.Major -lt 7) { throw 'Bu betik PowerShell 7 gerektirir. Kurmak için: winget install Microsoft.PowerShell — ardından pwsh ile çalıştırın: pwsh ./scripts/local-https-cert.ps1 -Address <IP>' }
$ip = [System.Net.IPAddress]::Parse($Address)
if ($Address -notmatch '^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.|127\.)') { throw 'Yalnız yerel IPv4 adresi kullanılabilir.' }
$target = [System.IO.Path]::GetFullPath($OutputDirectory)
if (Test-Path -LiteralPath $target) { throw 'Hedef zaten var. Mevcut sertifika üzerine yazılmaz; farklı hedef seçin.' }
[System.IO.Directory]::CreateDirectory($target) | Out-Null
$caKey = [System.Security.Cryptography.RSA]::Create(3072)
$leafKey = [System.Security.Cryptography.RSA]::Create(2048)
try {
  $hash = [System.Security.Cryptography.HashAlgorithmName]::SHA256
  $padding = [System.Security.Cryptography.RSASignaturePadding]::Pkcs1
  $caRequest = [System.Security.Cryptography.X509Certificates.CertificateRequest]::new('CN=Mola Local Test CA', $caKey, $hash, $padding)
  $caRequest.CertificateExtensions.Add([System.Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]::new($true,$true,0,$true))
  $caRequest.CertificateExtensions.Add([System.Security.Cryptography.X509Certificates.X509KeyUsageExtension]::new([System.Security.Cryptography.X509Certificates.X509KeyUsageFlags]::KeyCertSign,$true))
  $start = [DateTimeOffset]::UtcNow.AddMinutes(-5)
  $end = [DateTimeOffset]::UtcNow.AddDays(90)
  $ca = $caRequest.CreateSelfSigned($start,$end)
  $request = [System.Security.Cryptography.X509Certificates.CertificateRequest]::new('CN=Mola Local Test', $leafKey, $hash, $padding)
  $request.CertificateExtensions.Add([System.Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]::new($false,$false,0,$true))
  $san = [System.Security.Cryptography.X509Certificates.SubjectAlternativeNameBuilder]::new()
  $san.AddDnsName('localhost'); $san.AddIpAddress([System.Net.IPAddress]::Loopback); $san.AddIpAddress($ip)
  $request.CertificateExtensions.Add($san.Build())
  $usages = [System.Security.Cryptography.OidCollection]::new()
  $usages.Add([System.Security.Cryptography.Oid]::new('1.3.6.1.5.5.7.3.1')) | Out-Null
  $request.CertificateExtensions.Add([System.Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension]::new($usages,$true))
  $leaf = $request.Create($ca,$start,$end,[System.Security.Cryptography.RandomNumberGenerator]::GetBytes(16))
  [System.IO.File]::WriteAllText((Join-Path $target 'server-key.pem'),$leafKey.ExportPkcs8PrivateKeyPem())
  [System.IO.File]::WriteAllText((Join-Path $target 'server-cert.pem'),$leaf.ExportCertificatePem())
  [System.IO.File]::WriteAllText((Join-Path $target 'ca.pem'),$ca.ExportCertificatePem())
  [System.IO.File]::WriteAllBytes((Join-Path $target 'Mola-Local-Test-CA.cer'),$ca.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Cert))
  @{ address=$Address; expiresAt=$end.ToString('o') } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $target 'config.json') -Encoding utf8
  Write-Output 'Yerel sertifika hazır. Sertifika deposuna otomatik kurulum yapılmadı. CA özel anahtarı diske kaydedilmedi.'
} finally { $caKey.Dispose(); $leafKey.Dispose(); if ($ca) { $ca.Dispose() }; if ($leaf) { $leaf.Dispose() } }
