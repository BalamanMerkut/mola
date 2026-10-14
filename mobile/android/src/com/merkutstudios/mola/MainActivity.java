package com.merkutstudios.mola;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.content.res.ColorStateList;
import android.graphics.Bitmap;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.RippleDrawable;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.NetworkRequest;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.print.PrintAttributes;
import android.print.PrintManager;
import android.provider.MediaStore;
import android.text.InputType;
import android.util.Base64;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.view.inputmethod.EditorInfo;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.MimeTypeMap;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;
import java.io.IOException;
import java.io.OutputStream;
import java.util.List;
import org.json.JSONObject;

/**
 * Mola'nın tek ekranı: kafe bilgisayarındaki Mola'yı tam ekran bir WebView'da açar. Ekranlar sunucudan geldiği için
 * Mola güncellenince bu uygulamayı yeniden kurmak gerekmez. Burada yalnız telefonun yapması gerekenler var:
 * kafe bilgisayarını bulmak (ağda arama, mola://baglan bağlantısı, elle adres), ulaşılamayınca sade bir hata ekranı ve
 * Wi-Fi gelince yeniden deneme, ekranı açık tutmak, fotoğraf seçme/çekme, dosya kaydetme ve yazdırma.
 */
public final class MainActivity extends Activity {
    private static final int DOSYA_SEC = 1, DOSYA_KAYDET = 2, QR_OKU = 3, KAMERA_IZNI = 4;
    private static final String AYAR = "mola", ADRES = "adres", AD = "ad";
    private static final int YESIL = 0xFF234C3E, ZEMIN = 0xFFF6F7F4, MUREKKEP = 0xFF24382E, SOLUK = 0xFF66736A, KIRMIZI = 0xFFA34C34, CIZGI = 0xFFE4E8E0;

    /** Her sayfa açılışında eklenir: indirmeleri ve yazdırmayı Android'e verir (WebView bunları kendisi yapamaz). */
    private static final String EKLENTI = "(function(){if(window.__molaIndir)return;var k=window.MolaAndroid;if(!k)return;"
        + "function gonder(h,ad){fetch(h,{credentials:'same-origin'}).then(function(r){if(!r.ok)throw 0;return r.blob();})"
        + ".then(function(b){var f=new FileReader();f.onload=function(){var s=String(f.result);k.kaydet(s.slice(s.indexOf(',')+1),b.type||'',ad||'');};f.readAsDataURL(b);})"
        + ".catch(function(){k.hata('Dosya kaydedilemedi.');});}"
        + "window.__molaIndir=gonder;"
        + "document.addEventListener('click',function(e){var a=e.target&&e.target.closest?e.target.closest('a[download]'):null;if(!a)return;"
        + "var h=a.href||'';if(!/^(data|blob):/.test(h)&&h.indexOf(location.origin+'/')!==0)return;e.preventDefault();gonder(h,a.getAttribute('download')||'');},true);"
        + "window.print=function(){k.yazdir(document.title||'Mola');};})();";

    private final Handler ana = new Handler(Looper.getMainLooper());
    private final Runnable yenidenDeneme = this::yenidenDene;
    private SharedPreferences ayar;
    private FrameLayout kok;
    private WebView web;
    private View hataEkrani, secimEkrani;
    private TextView hataBaslik, hataMetni, hataDurum;
    /** Kafe bilgisayarının kökeni ("http://192.168.1.20:3000"); null: henüz seçilmedi. */
    private String adres;
    /** WebView'da açık sayfanın kökeni: JavaScript köprüsü yalnız kafenin kendi sayfasına yanıt verir. */
    private volatile String sayfaKokeni;
    private volatile String guvenliKoken;
    private boolean gecmisiTemizle;
    private int deneme;
    private ValueCallback<Uri[]> dosyaGeriDonus;
    private WebChromeClient.FileChooserParams bekleyenSecenek;
    private boolean kameraIzniSoruldu;
    private Uri kameraUri;
    private byte[] bekleyenDosya;
    private KafeArama arama, hataArama;
    private ConnectivityManager.NetworkCallback agDinleyici;
    private String surum = "0";

    @Override
    protected void onCreate(Bundle durum) {
        super.onCreate(durum);
        // Mutfak ve garson ekranı uyumamalı: uygulama açıkken ekran kapanmaz.
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        ayar = getSharedPreferences(AYAR, MODE_PRIVATE);
        try { surum = getPackageManager().getPackageInfo(getPackageName(), 0).versionName; } catch (PackageManager.NameNotFoundException ignored) {}
        DosyaSaglayici.eskileriSil(this);
        kok = new FrameLayout(this);
        kok.setBackgroundColor(ZEMIN);
        web = new WebView(this);
        webAyarla();
        kok.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(kok);
        // Merkut Studios açılışı: yalnız uygulamanın kendi açılışında (ekran döndürme ya da yeniden kurulumda değil) ve
        // src/studio-splash.json'da "android" açıksa (derlemede res/values/acilis.xml'e yazılır; şimdilik kapalı).
        if (durum == null && getResources().getBoolean(R.bool.merkut_acilis)) acilisGoster();
        adres = ayar.getString(ADRES, null);
        guvenliKoken = adres;
        if (!baglantiIstegi(getIntent())) {
            if (adres != null) ac(); else secimGoster(false);
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        baglantiIstegi(intent);
    }

    @Override
    protected void onStart() {
        super.onStart();
        ConnectivityManager cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
        if (cm == null || agDinleyici != null) return;
        agDinleyici = new ConnectivityManager.NetworkCallback() {
            @Override public void onAvailable(Network ag) {
                ana.post(() -> {
                    agaBagla();
                    // Wi-Fi geri geldi: hata ekranı açıksa hemen yeniden dene.
                    if (hataGorunur()) { ana.removeCallbacks(yenidenDeneme); ana.postDelayed(yenidenDeneme, 1500); }
                });
            }
            @Override public void onLost(Network ag) { ana.post(MainActivity.this::agaBagla); }
        };
        try {
            cm.registerNetworkCallback(new NetworkRequest.Builder().addTransportType(NetworkCapabilities.TRANSPORT_WIFI).addTransportType(NetworkCapabilities.TRANSPORT_ETHERNET).build(), agDinleyici);
        } catch (RuntimeException e) { agDinleyici = null; }
    }

    @Override
    protected void onStop() {
        super.onStop();
        CookieManager.getInstance().flush();
        ConnectivityManager cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
        if (cm != null && agDinleyici != null) { try { cm.unregisterNetworkCallback(agDinleyici); } catch (RuntimeException ignored) {} }
        agDinleyici = null;
    }

    @Override
    protected void onDestroy() {
        ana.removeCallbacksAndMessages(null);
        if (arama != null) arama.durdur();
        if (hataArama != null) hataArama.durdur();
        if (web != null) { kok.removeView(web); web.destroy(); web = null; }
        super.onDestroy();
    }

    // ---------- WebView ----------

    private void webAyarla() {
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        // Mutfak ve garson sesleri ilk dokunuşu beklemeden çalabilsin.
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setSupportMultipleWindows(false);
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        // Web uygulaması kabuğu buradan tanır ("Ana ekrana ekle" ipuçlarını gizler, ekranı uygulama açık tutar).
        s.setUserAgentString(s.getUserAgentString() + " MolaApp/" + surum);
        CookieManager.getInstance().setAcceptCookie(true);
        web.setBackgroundColor(ZEMIN);
        web.addJavascriptInterface(new Kopru(), "MolaAndroid");
        web.setWebViewClient(new Istemci());
        web.setWebChromeClient(new Krom());
        web.setDownloadListener((url, ua, ekBilgi, tur, uzunluk) -> indir(url, ekBilgi, tur));
    }

    private final class Istemci extends WebViewClient {
        @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest istek) { return yonlendir(istek.getUrl()); }
        @Override public void onPageStarted(WebView v, String url, Bitmap simge) { sayfaKokeni = koken(url); }
        @Override public void onPageFinished(WebView v, String url) {
            Uri u = Uri.parse(url);
            if (!Adres.ayniKoken(u, adres)) return;
            if (gecmisiTemizle) { v.clearHistory(); gecmisiTemizle = false; }
            v.evaluateJavascript(EKLENTI, null);
            CookieManager.getInstance().flush();
        }
        @Override public void onReceivedError(WebView v, WebResourceRequest istek, WebResourceError hata) {
            if (istek.isForMainFrame()) hataGoster();
        }
        @Override public boolean onRenderProcessGone(WebView v, android.webkit.RenderProcessGoneDetail ayrinti) {
            // WebView'ın çizim süreci kapandı (bellek): ekran baştan kurulur.
            recreate();
            return true;
        }
    }

    private final class Krom extends WebChromeClient {
        @Override public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> geriDonus, FileChooserParams secenek) {
            return dosyaSec(geriDonus, secenek);
        }
    }

    /** Kafenin kendi sayfaları WebView'da; WhatsApp, Google yorumu gibi başka adresler telefonun tarayıcısında açılır. */
    private boolean yonlendir(Uri u) {
        if (Adres.ayniKoken(u, adres)) return false;
        String sema = u.getScheme() == null ? "" : u.getScheme();
        if (sema.equals("mola")) { baglantiIstegi(new Intent(Intent.ACTION_VIEW, u)); return true; }
        if (sema.equals("about")) return false;
        disariAc(u);
        return true;
    }

    private void disariAc(Uri u) {
        Intent i = new Intent(Intent.ACTION_VIEW, u).addCategory(Intent.CATEGORY_BROWSABLE);
        try { startActivity(i); } catch (ActivityNotFoundException e) { bildir("Bu bağlantıyı açacak uygulama yok."); }
    }

    private static String koken(String url) {
        return Adres.koken(Uri.parse(url));
    }

    /** Kafeyi açar: giriş ekranı (çalışanların başlangıcı). */
    private void ac() {
        if (adres == null) { secimGoster(false); return; }
        guvenliKoken = adres;
        secimKapat();
        hataGizle();
        agaBagla();
        web.setVisibility(View.VISIBLE);
        gecmisiTemizle = true;
        web.loadUrl(adres + "/");
    }

    /**
     * Kafe bilgisayarının adresi telefonun Wi-Fi ağındaysa uygulamanın trafiği o ağa bağlanır: modemin interneti kesilince
     * Android trafiği mobil veriye yollasa da Mola kafe bilgisayarına ulaşmaya devam eder.
     */
    private void agaBagla() {
        ConnectivityManager cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
        if (cm == null) return;
        try { cm.bindProcessToNetwork(adres == null ? null : KafeArama.agiBul(this, adres)); } catch (RuntimeException ignored) {}
    }

    private void kaydet(KafeArama.Kafe kafe) {
        adres = kafe.adres;
        guvenliKoken = adres;
        ayar.edit().putString(ADRES, kafe.adres).putString(AD, kafe.ad).apply();
    }

    // ---------- mola://baglan?u=... ----------

    /** /uygulama sayfasındaki "Uygulamada aç": o kafeye bağlan (başka bir kafe kayıtlıysa önce sorar). */
    private boolean baglantiIstegi(Intent i) {
        if (i == null || !Intent.ACTION_VIEW.equals(i.getAction()) || i.getData() == null || !"mola".equals(i.getData().getScheme())) return false;
        Uri veri = i.getData();
        setIntent(new Intent(this, MainActivity.class));
        String yeni = "baglan".equals(veri.getHost()) ? Adres.duzenle(veri.getQueryParameter("u")) : null;
        if (yeni == null) {
            bildir("Bağlantıdaki kafe adresi geçersiz.");
            if (adres == null) secimGoster(false);
            return true;
        }
        if (yeni.equals(adres)) { if (secimGorunur() || hataGorunur() || web.getUrl() == null) ac(); return true; }
        final String eski = adres;
        Network ag = KafeArama.agiBul(this, yeni);
        new Thread(() -> {
            KafeArama.Kafe kafe = KafeArama.dene(ag, yeni, 5000);
            ana.post(() -> {
                if (isFinishing()) return;
                if (kafe == null) {
                    pencere().setTitle("Kafe bilgisayarına ulaşılamadı")
                        .setMessage(Adres.kisa(yeni) + " adresinde Mola bulunamadı. Telefon kafenin Wi-Fi ağına bağlı mı?")
                        .setPositiveButton("Tamam", null).show();
                    if (adres == null) secimGoster(false);
                    return;
                }
                if (eski == null) { kaydet(kafe); ac(); return; }
                pencere().setTitle("Kafe değiştirilsin mi?")
                    .setMessage("Şu an: " + ayar.getString(AD, Adres.kisa(eski)) + " (" + Adres.kisa(eski) + ")\nYeni: " + kafe.gorunen() + " (" + Adres.kisa(kafe.adres) + ")")
                    .setPositiveButton("Değiştir", (d, w) -> { kaydet(kafe); ac(); })
                    .setNegativeButton("Vazgeç", null).show();
            });
        }, "mola-baglanti").start();
        return true;
    }

    // ---------- "Kafe bilgisayarına ulaşılamıyor" ----------

    private boolean hataGorunur() { return hataEkrani != null && hataEkrani.getVisibility() == View.VISIBLE; }

    private void hataGoster() {
        if (adres == null) { secimGoster(false); return; }
        if (hataEkrani == null) hataEkraniKur();
        String ad = ayar.getString(AD, null);
        hataMetni.setText("Telefon kafenin Wi-Fi ağına bağlı mı? Kafe bilgisayarı ve Mola açık mı?\n\n" + (ad != null ? ad + " · " : "") + Adres.kisa(adres));
        hataDurum.setText("Wi-Fi gelince kendiliğinden yeniden denenir.");
        if (hataGorunur()) return;
        web.setVisibility(View.INVISIBLE);
        hataEkrani.setVisibility(View.VISIBLE);
        hataEkrani.bringToFront();
        deneme = 0;
        ana.removeCallbacks(yenidenDeneme);
        ana.postDelayed(yenidenDeneme, 6000);
        adresDegistiMi();
    }

    private void hataGizle() {
        ana.removeCallbacks(yenidenDeneme);
        if (hataArama != null) { hataArama.durdur(); hataArama = null; }
        if (hataEkrani != null) hataEkrani.setVisibility(View.GONE);
    }

    private void yenidenDene() {
        if (!hataGorunur() || adres == null) return;
        hataDurum.setText("Bağlanılıyor…");
        final String k = adres;
        Network ag = KafeArama.agiBul(this, k);
        new Thread(() -> {
            KafeArama.Kafe kafe = KafeArama.dene(ag, k, 4000);
            ana.post(() -> {
                if (!hataGorunur() || !k.equals(adres)) return;
                if (kafe != null) {
                    if (kafe.ad != null) ayar.edit().putString(AD, kafe.ad).apply();
                    ac();
                } else {
                    hataDurum.setText("Ulaşılamadı. Biraz sonra kendiliğinden yeniden denenecek.");
                    ana.postDelayed(yenidenDeneme, Math.min(30000, 6000 + 4000L * ++deneme));
                }
            });
        }, "mola-yeniden").start();
    }

    /**
     * Modem yeniden başlayınca kafe bilgisayarının adresi değişebilir: aynı ağda aynı adlı Mola bulunursa oraya geçilir,
     * böylece her tablette "Kafe değiştir" demek gerekmez.
     */
    private void adresDegistiMi() {
        final String ad = ayar.getString(AD, null);
        if (ad == null || ad.isEmpty() || hataArama != null) return;
        hataArama = new KafeArama();
        final KafeArama bu = hataArama;
        bu.basla(this, new KafeArama.Dinleyici() {
            @Override public void bulundu(KafeArama.Kafe kafe) {
                if (hataArama != bu || !hataGorunur() || !ad.equals(kafe.ad) || kafe.adres.equals(adres)) return;
                bu.durdur();
                hataArama = null;
                kaydet(kafe);
                bildir("Kafe bilgisayarının adresi değişmiş; yeni adrese bağlanıldı.");
                ac();
            }
            @Override public void ilerleme(int yuzde) {}
            @Override public void ilkTurBitti(int bulunan) {}
            @Override public void bitti(int bulunan, boolean agVar) { if (hataArama == bu) hataArama = null; }
        });
    }

    private void hataEkraniKur() {
        LinearLayout sutun = sutun();
        sutun.setGravity(Gravity.CENTER_HORIZONTAL);
        sutun.addView(simge(), new LinearLayout.LayoutParams(dp(64), dp(64)));
        hataBaslik = yazi("Kafe bilgisayarına ulaşılamıyor", 22, true, MUREKKEP);
        hataBaslik.setGravity(Gravity.CENTER);
        sutun.addView(hataBaslik, aralik(20));
        hataMetni = yazi("", 16, false, SOLUK);
        hataMetni.setGravity(Gravity.CENTER);
        sutun.addView(hataMetni, aralik(12));
        Button tekrar = dugme("Yeniden dene", true, v -> { ana.removeCallbacks(yenidenDeneme); deneme = 0; yenidenDene(); });
        sutun.addView(tekrar, genis(24));
        sutun.addView(dugme("Kafe değiştir", false, v -> secimGoster(true)), genis(8));
        hataDurum = yazi("", 14, false, SOLUK);
        hataDurum.setGravity(Gravity.CENTER);
        sutun.addView(hataDurum, aralik(16));
        hataEkrani = kaydir(sutun, true);
        hataEkrani.setVisibility(View.GONE);
        kok.addView(hataEkrani, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
    }

    // ---------- Kafe seçimi: ağda arama ve elle adres ----------

    private boolean secimGorunur() { return secimEkrani != null && secimEkrani.getVisibility() == View.VISIBLE; }

    private void secimKapat() {
        if (arama != null) { arama.durdur(); arama = null; }
        if (secimEkrani != null) { kok.removeView(secimEkrani); secimEkrani = null; }
    }

    private void secimGoster(boolean vazgecilir) {
        secimKapat();
        LinearLayout sutun = sutun();
        sutun.addView(simge(), new LinearLayout.LayoutParams(dp(56), dp(56)));
        sutun.addView(yazi("Kafe bilgisayarını seçin", 24, true, MUREKKEP), aralik(16));
        sutun.addView(yazi("Telefon kafenin Wi-Fi ağına bağlı olmalı. Mola aynı ağdaki kafe bilgisayarını arıyor.", 16, false, SOLUK), aralik(8));
        ProgressBar cubuk = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        cubuk.setMax(100);
        cubuk.setProgressTintList(ColorStateList.valueOf(YESIL));
        sutun.addView(cubuk, genis(18));
        TextView durum = yazi("Aranıyor…", 14, false, SOLUK);
        sutun.addView(durum, aralik(4));
        LinearLayout liste = new LinearLayout(this);
        liste.setOrientation(LinearLayout.VERTICAL);
        sutun.addView(liste, genis(8));
        Button yeniden = dugme("Yeniden ara", false, null);
        sutun.addView(yeniden, aralik(4));

        sutun.addView(yazi("Adresi elle yazın", 18, true, MUREKKEP), aralik(28));
        sutun.addView(yazi("Kafe bilgisayarında Mola penceresi → Cihaz bağla'da yazan adres. Örnek: 192.168.1.20:3000", 14, false, SOLUK), aralik(4));
        EditText alan = new EditText(this);
        alan.setSingleLine(true);
        alan.setHint("192.168.1.20:3000");
        alan.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        alan.setImeOptions(EditorInfo.IME_ACTION_GO);
        String kayitli = adres != null ? Adres.kisa(adres) : null;
        if (kayitli != null) alan.setText(kayitli);
        sutun.addView(alan, genis(8));
        TextView hata = yazi("", 14, false, KIRMIZI);
        hata.setVisibility(View.GONE);
        Button baglan = dugme("Bağlan", true, null);
        sutun.addView(baglan, genis(8));
        sutun.addView(hata, aralik(8));
        if (vazgecilir && adres != null) sutun.addView(dugme("Vazgeç", false, v -> { secimKapat(); if (hataGorunur()) return; web.setVisibility(View.VISIBLE); }), aralik(20));
        sutun.addView(yazi("Mola " + surum, 12, false, SOLUK), aralik(24));

        View.OnClickListener elle = v -> {
            String k = Adres.duzenle(alan.getText().toString());
            if (k == null) { hata.setText("Adres geçersiz. Örnek: 192.168.1.20:3000 (internetteki adresler için https://)"); hata.setVisibility(View.VISIBLE); return; }
            hata.setVisibility(View.GONE);
            baglan.setEnabled(false);
            baglan.setText("Bağlanılıyor…");
            Network ag = KafeArama.agiBul(this, k);
            new Thread(() -> {
                KafeArama.Kafe kafe = KafeArama.dene(ag, k, 5000);
                ana.post(() -> {
                    baglan.setEnabled(true);
                    baglan.setText("Bağlan");
                    if (kafe == null) { hata.setText("Bu adreste Mola bulunamadı. Adresi ve telefonun Wi-Fi bağlantısını kontrol edin."); hata.setVisibility(View.VISIBLE); return; }
                    kaydet(kafe);
                    ac();
                });
            }, "mola-elle").start();
        };
        baglan.setOnClickListener(elle);
        alan.setOnEditorActionListener((v, eylem, olay) -> {
            if (eylem == EditorInfo.IME_ACTION_GO || (olay != null && olay.getKeyCode() == KeyEvent.KEYCODE_ENTER)) { elle.onClick(baglan); return true; }
            return false;
        });

        final boolean ilkKurulum = adres == null;
        Runnable ara = new Runnable() {
            @Override public void run() {
                if (arama != null) arama.durdur();
                liste.removeAllViews();
                cubuk.setProgress(0);
                cubuk.setVisibility(View.VISIBLE);
                durum.setText("Aranıyor…");
                yeniden.setEnabled(false);
                final KafeArama bu = new KafeArama();
                arama = bu;
                bu.basla(MainActivity.this, new KafeArama.Dinleyici() {
                    int adet;
                    @Override public void bulundu(KafeArama.Kafe kafe) {
                        if (arama != bu) return;
                        adet++;
                        liste.addView(kafeKarti(kafe), genis(8));
                    }
                    @Override public void ilerleme(int yuzde) { if (arama == bu) cubuk.setProgress(yuzde); }
                    @Override public void ilkTurBitti(int bulunan) {
                        // İlk kurulumda ağda tek bir Mola varsa beklemeden ona bağlanılır.
                        if (arama != bu || !ilkKurulum || bulunan != 1 || liste.getChildCount() != 1) return;
                        liste.getChildAt(0).performClick();
                    }
                    @Override public void bitti(int bulunan, boolean agVar) {
                        if (arama != bu) return;
                        arama = null;
                        cubuk.setVisibility(View.GONE);
                        yeniden.setEnabled(true);
                        durum.setText(!agVar ? "Telefon bir Wi-Fi ağına bağlı değil. Wi-Fi'ı açıp kafenin ağına bağlanın."
                            : bulunan == 0 ? "Bu ağda Mola bulunamadı. Kafe bilgisayarı ve Mola açık mı, telefon aynı Wi-Fi'da mı? Adresi aşağıya elle de yazabilirsiniz."
                            : bulunan == 1 ? "Kafe bilgisayarı bulundu. Bağlanmak için dokunun." : bulunan + " kafe bilgisayarı bulundu. Bağlanmak için birine dokunun.");
                    }
                });
            }
        };
        yeniden.setOnClickListener(v -> ara.run());
        secimEkrani = kaydir(sutun, false);
        kok.addView(secimEkrani, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        secimEkrani.bringToFront();
        ara.run();
    }

    private View kafeKarti(KafeArama.Kafe kafe) {
        LinearLayout kart = new LinearLayout(this);
        kart.setOrientation(LinearLayout.VERTICAL);
        kart.setPadding(dp(18), dp(14), dp(18), dp(14));
        GradientDrawable zemin = new GradientDrawable();
        zemin.setColor(0xFFFFFFFF);
        zemin.setCornerRadius(dp(12));
        zemin.setStroke(dp(1), CIZGI);
        kart.setBackground(new RippleDrawable(ColorStateList.valueOf(0x22234C3E), zemin, null));
        kart.setClickable(true);
        kart.setFocusable(true);
        kart.addView(yazi(kafe.gorunen(), 18, true, MUREKKEP));
        kart.addView(yazi(Adres.kisa(kafe.adres), 14, false, SOLUK));
        kart.setContentDescription(kafe.gorunen() + ", " + Adres.kisa(kafe.adres));
        kart.setOnClickListener(v -> { kaydet(kafe); ac(); });
        return kart;
    }

    // ---------- Geri tuşu ve küçük menü ----------

    @Override
    public void onBackPressed() {
        if (acilis != null) { acilisKapat(); return; }
        if (secimGorunur()) {
            if (adres != null && !hataGorunur()) { secimKapat(); web.setVisibility(View.VISIBLE); }
            else if (adres == null) finish();
            else secimKapat();
            return;
        }
        if (!hataGorunur() && web.canGoBack()) { web.goBack(); return; }
        menuGoster();
    }

    private void menuGoster() {
        String ad = ayar.getString(AD, null);
        String baslik = (ad != null ? ad : "Mola") + (adres != null ? " · " + Adres.kisa(adres) : "");
        pencere().setTitle(baslik)
            .setItems(new CharSequence[] { "Kafe değiştir", "Sayfayı yenile", "Hakkında", "Mola'dan çık" }, (d, secim) -> {
                if (secim == 0) secimGoster(true);
                else if (secim == 1) { if (hataGorunur()) yenidenDene(); else web.reload(); }
                else if (secim == 2) hakkinda();
                else finish();
            })
            .setNegativeButton("Vazgeç", null).show();
    }

    // ---------- Hakkında: uygulamanın ve kafe bilgisayarındaki Mola'nın sürümü ----------

    private void hakkinda() {
        final String k = adres;
        final AlertDialog p = pencere().setTitle("Hakkında").setMessage(hakkindaMetni(k == null ? "bağlı değil" : "soruluyor…"))
            .setPositiveButton("Tamam", null).show();
        if (k == null) return;
        Network ag = KafeArama.agiBul(this, k);
        new Thread(() -> {
            String s;
            try {
                s = new JSONObject(KafeArama.oku(ag, k + "/api/health", 4000)).optString("version", "");
                if (s.isEmpty()) s = "bilinmiyor";
            } catch (Exception e) { s = "ulaşılamadı"; }
            final String sunucu = s;
            ana.post(() -> { if (p.isShowing()) p.setMessage(hakkindaMetni(sunucu)); });
        }, "mola-hakkinda").start();
    }

    private String hakkindaMetni(String sunucu) {
        String ad = ayar.getString(AD, null);
        return "Mola uygulaması: " + surum + "\nKafe bilgisayarındaki Mola: " + sunucu
            + (adres != null ? "\n" + (ad != null ? ad + " · " : "") + Adres.kisa(adres) : "")
            + "\n\nMola · Merkut Studios";
    }

    // ---------- Merkut Studios açılışı (src/studio-splash.json "android"; şimdilik kapalı) ----------

    private View acilis;
    private int acilisOncekiGezinme;
    private final Runnable acilisKapatma = this::acilisKapat;

    /**
     * Siyah ekran → logo 600 ms'de belirir → ~1,2 sn durur → 600 ms'de kararır → uygulama (WebView bu sırada arkada yüklenir).
     * Dokunmak ya da geri tuşu atlar. "Animasyonları kaldır" açıksa logo 600 ms hareketsiz görünür. Pencerenin en üstünde
     * (addContentView): seçim ve hata ekranları öne gelse de altında kalır.
     */
    private void acilisGoster() {
        FrameLayout perde = new FrameLayout(this);
        perde.setBackgroundColor(0xFF000000);
        perde.setClickable(true);
        perde.setContentDescription("Merkut Studios");
        perde.setOnClickListener(v -> acilisKapat());
        ImageView logo = new ImageView(this);
        logo.setImageResource(R.drawable.merkut_studios);
        logo.setAdjustViewBounds(true);
        logo.setScaleType(ImageView.ScaleType.FIT_CENTER);
        logo.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        int ekranEn = getResources().getDisplayMetrics().widthPixels, ekranBoy = getResources().getDisplayMetrics().heightPixels;
        float oran = logo.getDrawable() != null && logo.getDrawable().getIntrinsicWidth() > 0 ? (float) logo.getDrawable().getIntrinsicHeight() / logo.getDrawable().getIntrinsicWidth() : 1.3f;
        int en = Math.min(dp(300), Math.min(Math.round(ekranEn * 0.62f), Math.round(ekranBoy * 0.66f / oran)));
        perde.addView(logo, new FrameLayout.LayoutParams(en, Math.round(en * oran), Gravity.CENTER));
        acilis = perde;
        addContentView(perde, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        acilisOncekiGezinme = getWindow().getNavigationBarColor();
        getWindow().setStatusBarColor(0xFF000000);
        getWindow().setNavigationBarColor(0xFF000000);
        float hiz = android.provider.Settings.Global.getFloat(getContentResolver(), android.provider.Settings.Global.ANIMATOR_DURATION_SCALE, 1f);
        if (hiz == 0f) { logo.setAlpha(1f); ana.postDelayed(acilisKapatma, 600); return; }
        logo.setAlpha(0f);
        logo.animate().alpha(1f).setDuration(600).withEndAction(() ->
            logo.animate().alpha(0f).setStartDelay(1150).setDuration(600).withEndAction(() ->
                perde.animate().alpha(0f).setDuration(150).withEndAction(this::acilisKapat)));
        // Bir şey takılırsa en geç 2,5 sn sonra kalkar.
        ana.postDelayed(acilisKapatma, Math.round(2700 * Math.max(1f, hiz)));
    }

    private void acilisKapat() {
        View p = acilis;
        acilis = null;
        if (p == null) return;
        ana.removeCallbacks(acilisKapatma);
        p.animate().cancel();
        if (p instanceof ViewGroup && ((ViewGroup) p).getChildCount() > 0) ((ViewGroup) p).getChildAt(0).animate().cancel();
        if (p.getParent() instanceof ViewGroup) ((ViewGroup) p.getParent()).removeView(p);
        getWindow().setStatusBarColor(YESIL);
        getWindow().setNavigationBarColor(acilisOncekiGezinme);
    }

    // ---------- Fotoğraf ve logo yükleme (kamera dahil) ----------

    private boolean dosyaSec(ValueCallback<Uri[]> geriDonus, WebChromeClient.FileChooserParams secenek) {
        if (dosyaGeriDonus != null) dosyaGeriDonus.onReceiveValue(null);
        dosyaGeriDonus = geriDonus;
        kameraUri = null;
        boolean resim = resimMi(secenek.getAcceptTypes());
        // Mola declares the CAMERA permission (for "QR okut"); Android then hands a photo to the camera app only when that
        // permission is granted. Asked once here; refused: the gallery alone.
        if (resim && !kameraIzni() && !kameraIzniSoruldu) {
            kameraIzniSoruldu = true; bekleyenSecenek = secenek;
            requestPermissions(new String[] { android.Manifest.permission.CAMERA }, KAMERA_IZNI);
            return true;
        }
        secimAc(geriDonus, secenek, resim);
        return true;
    }

    private boolean kameraIzni() { return Build.VERSION.SDK_INT < 23 || checkSelfPermission(android.Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED; }

    @Override
    public void onRequestPermissionsResult(int istek, String[] izinler, int[] sonuclar) {
        super.onRequestPermissionsResult(istek, izinler, sonuclar);
        if (istek != KAMERA_IZNI) return;
        WebChromeClient.FileChooserParams secenek = bekleyenSecenek;
        bekleyenSecenek = null;
        if (secenek != null && dosyaGeriDonus != null) secimAc(dosyaGeriDonus, secenek, true);
    }

    private void secimAc(ValueCallback<Uri[]> geriDonus, WebChromeClient.FileChooserParams secenek, boolean resim) {
        Intent sec;
        try { sec = secenek.createIntent(); }
        catch (RuntimeException e) { sec = new Intent(Intent.ACTION_GET_CONTENT).addCategory(Intent.CATEGORY_OPENABLE).setType(resim ? "image/*" : "*/*"); }
        Intent kamera = null;
        if (resim && kameraIzni()) {
            try {
                kameraUri = DosyaSaglayici.yeniFoto(this);
                kamera = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
                kamera.putExtra(MediaStore.EXTRA_OUTPUT, kameraUri);
                kamera.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
                kamera.setClipData(ClipData.newRawUri("foto", kameraUri));
                List<ResolveInfo> kameralar = getPackageManager().queryIntentActivities(kamera, PackageManager.MATCH_DEFAULT_ONLY);
                if (kameralar.isEmpty()) kamera = null;
                else for (ResolveInfo r : kameralar) grantUriPermission(r.activityInfo.packageName, kameraUri, Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            } catch (IOException | RuntimeException e) { kamera = null; }
        }
        Intent baslat;
        if (kamera != null && secenek.isCaptureEnabled()) baslat = kamera;
        else {
            baslat = Intent.createChooser(sec, resim ? "Fotoğraf seçin ya da çekin" : "Dosya seçin");
            if (kamera != null) baslat.putExtra(Intent.EXTRA_INITIAL_INTENTS, new Intent[] { kamera });
        }
        try {
            startActivityForResult(baslat, DOSYA_SEC);
        } catch (ActivityNotFoundException | SecurityException e) {
            dosyaGeriDonus = null;
            geriDonus.onReceiveValue(null);
            bildir("Dosya seçecek uygulama bulunamadı.");
        }
    }

    private static boolean resimMi(String[] turler) {
        if (turler == null || turler.length == 0) return true;
        for (String t : turler) {
            if (t == null || t.isEmpty()) continue;
            for (String parca : t.split(",")) {
                String p = parca.trim().toLowerCase(java.util.Locale.ROOT);
                if (p.startsWith("image/") || p.equals("*/*") || p.endsWith(".jpg") || p.endsWith(".jpeg") || p.endsWith(".png") || p.endsWith(".webp")) return true;
            }
            return false;
        }
        return true;
    }

    @Override
    protected void onActivityResult(int istek, int sonucKodu, Intent veri) {
        super.onActivityResult(istek, sonucKodu, veri);
        if (istek == DOSYA_SEC) {
            ValueCallback<Uri[]> geriDonus = dosyaGeriDonus;
            dosyaGeriDonus = null;
            if (geriDonus == null) return;
            Uri[] sonuc = null;
            if (sonucKodu == RESULT_OK) {
                sonuc = WebChromeClient.FileChooserParams.parseResult(sonucKodu, veri);
                if ((sonuc == null || sonuc.length == 0) && kameraUri != null && DosyaSaglayici.dolu(this, kameraUri)) sonuc = new Uri[] { kameraUri };
            }
            geriDonus.onReceiveValue(sonuc);
        } else if (istek == QR_OKU) {
            // "QR okut" (vardiya kodu): the text goes back only to the café's own page; null = cancelled.
            String metin = sonucKodu == RESULT_OK && veri != null ? veri.getStringExtra(QrOkuyucu.METIN) : null;
            String s = sayfaKokeni;
            if (web != null && s != null && s.equals(guvenliKoken)) web.evaluateJavascript("window.__molaQr&&window.__molaQr(" + (metin == null ? "null" : JSONObject.quote(metin)) + ")", null);
        } else if (istek == DOSYA_KAYDET) {
            byte[] dosya = bekleyenDosya;
            bekleyenDosya = null;
            if (sonucKodu != RESULT_OK || veri == null || veri.getData() == null || dosya == null) return;
            try (OutputStream o = getContentResolver().openOutputStream(veri.getData())) {
                if (o == null) throw new IOException("Yazılamadı");
                o.write(dosya);
                bildir("Dosya kaydedildi.");
            } catch (IOException | RuntimeException e) {
                bildir("Dosya kaydedilemedi.");
            }
        }
    }

    // ---------- İndirme (PDF, CSV, QR resmi) ve yazdırma ----------

    private void indir(String url, String ekBilgi, String tur) {
        Uri u = Uri.parse(url);
        if (url.startsWith("data:") || url.startsWith("blob:") || Adres.ayniKoken(u, adres)) {
            String ad = URLUtil.guessFileName(url, ekBilgi, tur);
            web.evaluateJavascript("window.__molaIndir&&window.__molaIndir(" + JSONObject.quote(url) + "," + JSONObject.quote(ad) + ")", null);
        } else {
            disariAc(u);
        }
    }

    /** JavaScript köprüsü: yalnız kafenin kendi sayfası kullanabilir. */
    private final class Kopru {
        private boolean guvenli() { String s = sayfaKokeni; return s != null && s.equals(guvenliKoken); }

        @JavascriptInterface public void kaydet(String base64, String tur, String ad) {
            if (!guvenli() || base64 == null) return;
            final byte[] veri;
            try { veri = Base64.decode(base64, Base64.DEFAULT); } catch (IllegalArgumentException e) { return; }
            ana.post(() -> dosyaKaydet(veri, tur, ad));
        }

        @JavascriptInterface public void yazdir(String baslik) {
            if (!guvenli()) return;
            ana.post(() -> yazdirmaBaslat(baslik));
        }

        @JavascriptInterface public void hata(String mesaj) {
            if (!guvenli()) return;
            ana.post(() -> bildir(mesaj == null ? "İşlem tamamlanamadı." : mesaj));
        }

        /** "QR okut": the vardiya code from the counter screen, read by the app's own camera reader (QrOkuyucu). */
        @JavascriptInterface public void qrOku() {
            if (!guvenli()) return;
            ana.post(() -> {
                try { startActivityForResult(new Intent(MainActivity.this, QrOkuyucu.class), QR_OKU); }
                catch (ActivityNotFoundException e) { bildir("Kamera açılamadı. Kodu elle yazın."); }
            });
        }
    }

    private void dosyaKaydet(byte[] veri, String tur, String ad) {
        String mime = tur == null || tur.trim().isEmpty() ? "application/octet-stream" : tur.split(";")[0].trim().toLowerCase(java.util.Locale.ROOT);
        String isim = temizAd(ad, mime);
        if (Build.VERSION.SDK_INT >= 29) {
            ContentResolver cr = getContentResolver();
            ContentValues d = new ContentValues();
            d.put(MediaStore.MediaColumns.DISPLAY_NAME, isim);
            d.put(MediaStore.MediaColumns.MIME_TYPE, mime);
            d.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
            d.put(MediaStore.MediaColumns.IS_PENDING, 1);
            Uri u = null;
            try {
                u = cr.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, d);
                if (u == null) throw new IOException("Kayıt açılamadı");
                try (OutputStream o = cr.openOutputStream(u)) {
                    if (o == null) throw new IOException("Yazılamadı");
                    o.write(veri);
                }
                d.clear();
                d.put(MediaStore.MediaColumns.IS_PENDING, 0);
                cr.update(u, d, null, null);
                final Uri kayit = u;
                pencere().setTitle("Kaydedildi")
                    .setMessage(isim + " İndirilenler klasörüne kaydedildi.")
                    .setPositiveButton("Aç", (p, w) -> {
                        Intent ac = new Intent(Intent.ACTION_VIEW).setDataAndType(kayit, mime).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                        try { startActivity(ac); } catch (ActivityNotFoundException e) { bildir("Bu dosyayı açacak uygulama yok."); }
                    })
                    .setNegativeButton("Tamam", null).show();
            } catch (IOException | RuntimeException e) {
                if (u != null) { try { cr.delete(u, null, null); } catch (RuntimeException ignored) {} }
                bildir("Dosya kaydedilemedi.");
            }
        } else {
            // Android 9 ve öncesi: izin istemeden, kullanıcının seçtiği yere kaydedilir.
            bekleyenDosya = veri;
            Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType(mime).putExtra(Intent.EXTRA_TITLE, isim);
            try { startActivityForResult(i, DOSYA_KAYDET); } catch (ActivityNotFoundException e) { bekleyenDosya = null; bildir("Dosya kaydedilemedi."); }
        }
    }

    private static String temizAd(String ad, String mime) {
        String s = ad == null ? "" : ad.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_").trim();
        if (s.isEmpty() || s.startsWith(".")) s = "mola-dosya";
        if (s.length() > 100) s = s.substring(s.length() - 100);
        if (!s.contains(".")) {
            String uzanti = MimeTypeMap.getSingleton().getExtensionFromMimeType(mime);
            if (uzanti != null) s += "." + uzanti;
        }
        return s;
    }

    /** Masa QR kodlarını yazdırma: Android'in yazdırma ekranı (yazıcı ya da PDF olarak kaydet). */
    private void yazdirmaBaslat(String baslik) {
        PrintManager yazici = (PrintManager) getSystemService(Context.PRINT_SERVICE);
        if (yazici == null || web == null) { bildir("Bu cihaz yazdıramıyor."); return; }
        String ad = baslik == null || baslik.trim().isEmpty() ? "Mola" : baslik.trim();
        yazici.print(ad, web.createPrintDocumentAdapter(ad), new PrintAttributes.Builder().build());
    }

    // ---------- Küçük görünüm yardımcıları ----------

    private AlertDialog.Builder pencere() { return new AlertDialog.Builder(this, android.R.style.Theme_Material_Light_Dialog_Alert); }

    private void bildir(String mesaj) { Toast.makeText(this, mesaj, Toast.LENGTH_LONG).show(); }

    private int dp(float v) { return Math.round(v * getResources().getDisplayMetrics().density); }

    /** Tablette satırlar fazla uzamasın: en çok 560 dp genişlik, ortada. */
    private final class Sutun extends LinearLayout {
        Sutun() { super(MainActivity.this); }
        @Override protected void onMeasure(int en, int boy) {
            int sinir = dp(560);
            if (MeasureSpec.getSize(en) > sinir) en = MeasureSpec.makeMeasureSpec(sinir, MeasureSpec.EXACTLY);
            super.onMeasure(en, boy);
        }
    }

    private LinearLayout sutun() {
        LinearLayout s = new Sutun();
        s.setOrientation(LinearLayout.VERTICAL);
        s.setPadding(dp(24), dp(32), dp(24), dp(32));
        return s;
    }

    private ScrollView kaydir(LinearLayout sutun, boolean ortala) {
        ScrollView k = new ScrollView(this);
        k.setFillViewport(true);
        k.setBackgroundColor(ZEMIN);
        FrameLayout.LayoutParams yer = new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        yer.gravity = ortala ? Gravity.CENTER : Gravity.CENTER_HORIZONTAL;
        FrameLayout ic = new FrameLayout(this);
        ic.addView(sutun, yer);
        k.addView(ic, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        return k;
    }

    private ImageView simge() {
        ImageView i = new ImageView(this);
        i.setImageResource(R.mipmap.ic_launcher);
        i.setContentDescription("Mola");
        return i;
    }

    private TextView yazi(CharSequence metin, float sp, boolean kalin, int renk) {
        TextView t = new TextView(this);
        t.setText(metin);
        t.setTextSize(sp);
        t.setTextColor(renk);
        t.setLineSpacing(0, 1.15f);
        if (kalin) t.setTypeface(Typeface.DEFAULT_BOLD);
        return t;
    }

    private Button dugme(String metin, boolean birincil, View.OnClickListener tik) {
        Button b = new Button(this, null, 0, birincil ? android.R.style.Widget_Material_Button_Colored : android.R.style.Widget_Material_Button_Borderless_Colored);
        b.setText(metin);
        b.setAllCaps(false);
        b.setTextSize(16);
        b.setMinHeight(dp(52));
        if (tik != null) b.setOnClickListener(tik);
        return b;
    }

    private LinearLayout.LayoutParams aralik(int ust) {
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        p.topMargin = dp(ust);
        return p;
    }

    private LinearLayout.LayoutParams genis(int ust) {
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        p.topMargin = dp(ust);
        return p;
    }
}
