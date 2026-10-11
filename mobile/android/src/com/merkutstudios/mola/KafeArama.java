package com.merkutstudios.mola;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.LinkAddress;
import android.net.LinkProperties;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.os.Handler;
import android.os.Looper;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.net.URL;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.json.JSONObject;

/**
 * Kafe bilgisayarını aynı Wi-Fi ağında bulur: telefonun alt ağındaki (en çok 254 adres) her adreste önce 3000, sonra
 * 3001-3010 numaralı bağlantı noktasına kısa süreli bağlanmayı dener; açık olanlarda /api/health yanıtında Mola'nın
 * imzasına ("role":"kafe") bakar, işletmenin adını /api/uygulama'dan alır. Sonuçlar ana iş parçacığına bildirilir.
 */
final class KafeArama {
    interface Dinleyici {
        void bulundu(Kafe kafe);
        void ilerleme(int yuzde);
        /** 3000 numaralı bağlantı noktası bütün ağda denendi (olağan kurulumların hepsi burada bulunur). */
        void ilkTurBitti(int bulunan);
        void bitti(int bulunan, boolean agVar);
    }

    static final class Kafe {
        final String adres;
        final String ad;
        Kafe(String adres, String ad) { this.adres = adres; this.ad = ad; }
        String gorunen() { return ad != null && !ad.isEmpty() ? ad : "Mola"; }
    }

    private final Handler ana = new Handler(Looper.getMainLooper());
    private volatile boolean durdu;
    private ExecutorService havuz;

    void durdur() {
        durdu = true;
        if (havuz != null) havuz.shutdownNow();
    }

    void basla(Context baglam, Dinleyici dinleyici) {
        final List<Alt> altlar = altAglar(baglam);
        havuz = Executors.newFixedThreadPool(64);
        final ExecutorService bu = havuz;
        new Thread(() -> {
            Set<String> bulunan = new LinkedHashSet<>();
            int toplam = 0;
            for (Alt a : altlar) toplam += a.adresler.size() * 11;
            final int hepsi = Math.max(1, toplam);
            AtomicInteger biten = new AtomicInteger();
            // Önce herkes 3000'de (Mola'nın olağan yeri), sonra diğer bağlantı noktaları.
            for (int tur = 0; tur < 2 && !durdu; tur++) {
                List<Runnable> isler = new ArrayList<>();
                for (Alt a : altlar) for (InetAddress ip : a.adresler) {
                    int ilk = tur == 0 ? 3000 : 3001, son = tur == 0 ? 3000 : 3010;
                    for (int port = ilk; port <= son; port++) {
                        final int p = port;
                        isler.add(() -> {
                            if (durdu) return;
                            Kafe k = yokla(a.ag, ip.getHostAddress(), p, sure(p));
                            int n = biten.incrementAndGet();
                            if (n % 32 == 0) ana.post(() -> { if (!durdu) dinleyici.ilerleme(n * 100 / hepsi); });
                            if (k != null) synchronized (bulunan) {
                                if (bulunan.add(k.adres)) ana.post(() -> { if (!durdu) dinleyici.bulundu(k); });
                            }
                        });
                    }
                }
                List<java.util.concurrent.Future<?>> bekle = new ArrayList<>();
                try { for (Runnable r : isler) bekle.add(bu.submit(r)); } catch (RuntimeException e) { break; }
                for (java.util.concurrent.Future<?> f : bekle) {
                    try { f.get(); } catch (Exception e) { if (durdu) break; }
                }
                if (tur == 0) {
                    final int simdi; synchronized (bulunan) { simdi = bulunan.size(); }
                    ana.post(() -> { if (!durdu) dinleyici.ilkTurBitti(simdi); });
                }
            }
            bu.shutdown();
            try { bu.awaitTermination(2, TimeUnit.SECONDS); } catch (InterruptedException ignored) {}
            final int adet; synchronized (bulunan) { adet = bulunan.size(); }
            final boolean ag = !altlar.isEmpty();
            ana.post(() -> { if (!durdu) dinleyici.bitti(adet, ag); });
        }, "mola-kafe-arama").start();
    }

    private static int sure(int port) { return port == 3000 ? 700 : 450; }

    /** Bir adres ve bağlantı noktası: açıksa Mola mı diye bakar. */
    private static Kafe yokla(Network ag, String ip, int port, int zaman) {
        try (Socket s = ag != null ? ag.getSocketFactory().createSocket() : new Socket()) {
            s.connect(new InetSocketAddress(ip, port), zaman);
        } catch (Exception e) {
            return null;
        }
        return dene(ag, "http://" + ip + ":" + port, 2500);
    }

    /** Bu adreste Mola'nın kafe sunucusu var mı? Varsa işletmenin adıyla döner (ad bilinmiyorsa null). */
    static Kafe dene(Network ag, String koken, int zaman) {
        try {
            JSONObject saglik = new JSONObject(oku(ag, koken + "/api/health", zaman));
            if (!saglik.optBoolean("ok") || !"kafe".equals(saglik.optString("role"))) return null;
        } catch (Exception e) {
            return null;
        }
        String ad = null;
        try {
            JSONObject bilgi = new JSONObject(oku(ag, koken + "/api/uygulama", zaman));
            if ("mola".equals(bilgi.optString("app")) && !bilgi.isNull("name")) ad = bilgi.optString("name", null);
        } catch (Exception ignored) {
            // Eski Mola sürümü ya da adı olmayan kurulum: adres gösterilir.
        }
        return new Kafe(koken, ad);
    }

    static String oku(Network ag, String adres, int zaman) throws Exception {
        URL url = new URL(adres);
        HttpURLConnection c = (HttpURLConnection) (ag != null ? ag.openConnection(url) : url.openConnection());
        c.setConnectTimeout(zaman);
        c.setReadTimeout(zaman);
        c.setInstanceFollowRedirects(false);
        c.setRequestProperty("Accept", "application/json");
        try {
            if (c.getResponseCode() != 200) throw new Exception("HTTP " + c.getResponseCode());
            try (InputStream in = c.getInputStream()) {
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                byte[] tampon = new byte[4096];
                int n, toplam = 0;
                while ((n = in.read(tampon)) > 0) {
                    toplam += n;
                    if (toplam > 65536) throw new Exception("Yanıt çok büyük");
                    out.write(tampon, 0, n);
                }
                return out.toString("UTF-8");
            }
        } finally {
            c.disconnect();
        }
    }

    private static final class Alt {
        final Network ag;
        final List<InetAddress> adresler;
        Alt(Network ag, List<InetAddress> adresler) { this.ag = ag; this.adresler = adresler; }
    }

    /**
     * Telefonun Wi-Fi/Ethernet ağlarındaki özel IPv4 alt ağları. /24'ten büyük ağlarda yalnız telefonun kendi /24'ü
     * taranır (kafe ağlarının hemen hepsi /24'tür).
     */
    private static List<Alt> altAglar(Context baglam) {
        List<Alt> sonuc = new ArrayList<>();
        ConnectivityManager cm = (ConnectivityManager) baglam.getSystemService(Context.CONNECTIVITY_SERVICE);
        if (cm == null) return sonuc;
        Set<String> gorulen = new LinkedHashSet<>();
        for (Network ag : cm.getAllNetworks()) {
            NetworkCapabilities yetenek = cm.getNetworkCapabilities(ag);
            if (yetenek == null || !(yetenek.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) || yetenek.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET))) continue;
            LinkProperties lp = cm.getLinkProperties(ag);
            if (lp == null) continue;
            for (LinkAddress la : lp.getLinkAddresses()) {
                InetAddress a = la.getAddress();
                if (!(a instanceof Inet4Address) || !a.isSiteLocalAddress()) continue;
                byte[] b = a.getAddress();
                int onek = Math.max(24, Math.min(30, la.getPrefixLength()));
                int maske = onek == 0 ? 0 : (int) (0xffffffffL << (32 - onek));
                int ip = ((b[0] & 0xff) << 24) | ((b[1] & 0xff) << 16) | ((b[2] & 0xff) << 8) | (b[3] & 0xff);
                int taban = ip & maske, adet = (int) ((~maske & 0xffffffffL) - 1);
                if (!gorulen.add(taban + "/" + onek)) continue;
                List<InetAddress> liste = new ArrayList<>();
                for (int i = 1; i <= adet; i++) {
                    int h = taban + i;
                    if (h == ip) continue;
                    try {
                        liste.add(InetAddress.getByAddress(new byte[] { (byte) (h >>> 24), (byte) (h >>> 16), (byte) (h >>> 8), (byte) h }));
                    } catch (Exception ignored) {}
                }
                sonuc.add(new Alt(ag, liste));
            }
        }
        return sonuc;
    }

    /** Bu adresin bulunduğu Wi-Fi/Ethernet ağı (internet yoksa Android trafiği mobil veriye yollayabilir). */
    static Network agiBul(Context baglam, String koken) {
        ConnectivityManager cm = (ConnectivityManager) baglam.getSystemService(Context.CONNECTIVITY_SERVICE);
        if (cm == null || koken == null) return null;
        String host = Adres.host(koken);
        if (!host.matches("\\d{1,3}(\\.\\d{1,3}){3}")) return null;
        byte[] hedef;
        try { hedef = InetAddress.getByName(host).getAddress(); } catch (Exception e) { return null; }
        int h = ((hedef[0] & 0xff) << 24) | ((hedef[1] & 0xff) << 16) | ((hedef[2] & 0xff) << 8) | (hedef[3] & 0xff);
        for (Network ag : cm.getAllNetworks()) {
            LinkProperties lp = cm.getLinkProperties(ag);
            if (lp == null) continue;
            for (LinkAddress la : lp.getLinkAddresses()) {
                InetAddress a = la.getAddress();
                if (!(a instanceof Inet4Address)) continue;
                byte[] b = a.getAddress();
                int ip = ((b[0] & 0xff) << 24) | ((b[1] & 0xff) << 16) | ((b[2] & 0xff) << 8) | (b[3] & 0xff);
                int onek = la.getPrefixLength(), maske = onek == 0 ? 0 : (int) (0xffffffffL << (32 - onek));
                if ((ip & maske) == (h & maske)) return ag;
            }
        }
        return null;
    }
}
