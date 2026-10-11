# Ana panel — Authenticator

Ana panel → Hesap güvenliği → İki adımlı giriş bölümünden kurulur. Mevcut şifre doğrulanır; 10 dakikalık kurulum için QR/elle girilecek anahtar ve sekiz kurtarma kodu gösterilir. Kodlar saklanmadan ve Authenticator uygulamasının ürettiği kod doğrulanmadan koruma açılmaz. Vazgeçmek mevcut giriş ayarını değiştirmez.

Koruma açılınca bütün ana panel oturumları kapanır. Yeniden girişte şifreye ek olarak Authenticator kodu veya kullanılmamış kurtarma kodu gerekir. Etkinleştirme kodu tüketildiği için uygulamada yeni kodun oluşması beklenmelidir. Kurtarma koduyla giriş korumayı kapatmaz; yalnız kullanılan kod tüketilir. Kapatmak için açık oturumda şifre ve yeni bir doğrulama/kurtarma kodu gerekir; ardından tüm oturumlar kapanır.

Kodlar tekrar gösterilmez. Kurtarma kodlarının yalnız SHA-256 özetleri kalıcı kayda girer. Kurulum yanıtı kaybolursa koruma henüz açılmamıştır; kurulum yeniden başlatılabilir. Etkinleştirme yanıtı kaybolursa sayfa yenilenip önceden saklanan kodlar veya Authenticator ile giriş durumu kontrol edilir. Kodlar ve sırlar tarayıcı kalıcı depolamasına yazılmaz. Kimlik doğrulama girişimleri hız sınırına tabidir.

Şifre değişikliği MFA ayarını korur. Açma/kapatma ve kurtarma kodu kullanımı ana panel işlem geçmişinde gösterilir. Mali rapor Authenticator koruması ayrı bir özelliktir; işletme hesapları bundan etkilenmez.

Bu özellik isteğe bağlıdır; geliştirme sırasında mevcut gerçek ana panel hesabında etkinleştirilmedi. Telefon ve tüm kurtarma kodları birlikte kaybolursa otomatik e-posta/SMS kurtarma bulunmaz. TOTP sırrı platform verisiyle aynı yerel şifreleme korumasındadır; E2E veya harici anahtar kasası değildir.
