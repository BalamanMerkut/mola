package com.merkutstudios.mola;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/**
 * Küçük, kütüphanesiz bir QR çözücü: kasadaki "Vardiya kodu" ekranının QR'ını okumak için (QrOkuyucu). Android'in kendi
 * çatısında QR çözücü yoktur ve uygulamaya dış kütüphane eklenmez; bu yüzden yalnız gereken kadarı burada:
 * sürüm 1–2 (21×21 ve 25×25 modül, tek blok), her hata düzeltme düzeyi, sayısal / harf-rakam / bayt kipi, Reed-Solomon
 * düzeltmesi. Sunucu kodu sürüm 1, M düzeyinde ve sayısal üretir (src/Shifts.tsx). Saf Java: android.* kullanmaz, böylece
 * bilgisayarda da denenir (tests/android-qr.test.ts).
 *
 * Adımlar: yerel ortalamayla siyah-beyaz → üç konum karesi (1:1:3:1:1) → yön ve boyut → modül ızgarası (afin) → biçim
 * bilgisi (BCH) → maske → kod sözcükleri → Reed-Solomon → veri.
 */
final class QrCozucu {
    private QrCozucu() {}

    /** Parlaklık (0–255, satır satır, genişlik × yükseklik) içinden QR metni; bulunamazsa null. */
    static String coz(byte[] parlaklik, int genislik, int yukseklik) {
        if (genislik < 21 || yukseklik < 21) return null;
        boolean[] siyah = ikiRenk(parlaklik, genislik, yukseklik);
        List<float[]> adaylar = konumKareleri(siyah, genislik, yukseklik);
        int n = Math.min(adaylar.size(), 6);
        for (int a = 0; a < n; a++) for (int b = a + 1; b < n; b++) for (int c = b + 1; c < n; c++) {
            String sonuc = dene(siyah, genislik, yukseklik, adaylar.get(a), adaylar.get(b), adaylar.get(c));
            if (sonuc != null) return sonuc;
        }
        return null;
    }

    // ---------- Siyah-beyaz: her nokta çevresinin ortalamasıyla karşılaştırılır (ekran parlaması, gölge) ----------

    static boolean[] ikiRenk(byte[] p, int w, int h) {
        long[] toplam = new long[(w + 1) * (h + 1)];
        for (int y = 0; y < h; y++) {
            long satir = 0;
            for (int x = 0; x < w; x++) {
                satir += p[y * w + x] & 0xFF;
                toplam[(y + 1) * (w + 1) + x + 1] = toplam[y * (w + 1) + x + 1] + satir;
            }
        }
        int r = Math.max(8, Math.min(w, h) / 10);
        boolean[] s = new boolean[w * h];
        for (int y = 0; y < h; y++) {
            int y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
            for (int x = 0; x < w; x++) {
                int x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
                long alan = (long) (x1 - x0) * (y1 - y0);
                long t = toplam[y1 * (w + 1) + x1] - toplam[y0 * (w + 1) + x1] - toplam[y1 * (w + 1) + x0] + toplam[y0 * (w + 1) + x0];
                int ortalama = (int) (t / alan), deger = p[y * w + x] & 0xFF;
                s[y * w + x] = deger + Math.max(6, ortalama / 16) < ortalama;
            }
        }
        return s;
    }

    // ---------- Konum kareleri (1:1:3:1:1) ----------

    /** Bulunan merkezler: {x, y, modül boyu, kaç kez görüldü}; çok görülen önce. */
    static List<float[]> konumKareleri(boolean[] s, int w, int h) {
        List<float[]> merkezler = new ArrayList<>();
        int adim = Math.max(1, h / 300);
        int[] say = new int[5];
        for (int y = 0; y < h; y += adim) {
            java.util.Arrays.fill(say, 0);
            int durum = 0;
            for (int x = 0; x < w; x++) {
                if (s[y * w + x]) {
                    if ((durum & 1) == 1) durum++;
                    say[durum]++;
                } else if ((durum & 1) == 0) {
                    if (durum == 4) {
                        if (oran(say) && merkezEkle(s, w, h, say, y, x, merkezler)) { java.util.Arrays.fill(say, 0); durum = 0; }
                        else { say[0] = say[2]; say[1] = say[3]; say[2] = say[4]; say[3] = 1; say[4] = 0; durum = 3; }
                    } else { durum++; say[durum]++; }
                } else say[durum]++;
            }
            if (durum == 4 && oran(say)) merkezEkle(s, w, h, say, y, w, merkezler);
        }
        merkezler.sort((a, b) -> Float.compare(b[3], a[3]));
        return merkezler;
    }

    private static boolean oran(int[] say) {
        int toplam = 0;
        for (int v : say) { if (v == 0) return false; toplam += v; }
        if (toplam < 7) return false;
        float modul = toplam / 7f, sapma = modul / 1.5f;
        return Math.abs(modul - say[0]) < sapma && Math.abs(modul - say[1]) < sapma && Math.abs(3 * modul - say[2]) < 3 * sapma && Math.abs(modul - say[3]) < sapma && Math.abs(modul - say[4]) < sapma;
    }

    private static boolean merkezEkle(boolean[] s, int w, int h, int[] say, int y, int sonX, List<float[]> merkezler) {
        int toplam = say[0] + say[1] + say[2] + say[3] + say[4];
        float mx = sonX - say[4] - say[3] - say[2] / 2f;
        float my = dikeyKontrol(s, w, h, (int) mx, y, say[2], toplam);
        if (Float.isNaN(my)) return false;
        mx = yatayKontrol(s, w, (int) mx, (int) my, say[2], toplam);
        if (Float.isNaN(mx)) return false;
        float modul = toplam / 7f;
        for (float[] m : merkezler) {
            if (Math.abs(my - m[1]) <= modul && Math.abs(mx - m[0]) <= modul && Math.abs(modul - m[2]) <= Math.max(1f, m[2])) {
                float k = m[3];
                m[0] = (k * m[0] + mx) / (k + 1); m[1] = (k * m[1] + my) / (k + 1); m[2] = (k * m[2] + modul) / (k + 1); m[3] = k + 1;
                return true;
            }
        }
        merkezler.add(new float[] { mx, my, modul, 1 });
        return true;
    }

    private static float dikeyKontrol(boolean[] s, int w, int h, int x, int y0, int orta, int toplamYatay) {
        if (x < 0 || x >= w) return Float.NaN;
        int[] c = new int[5];
        int y = y0;
        while (y >= 0 && s[y * w + x]) { c[2]++; y--; }
        if (y < 0) return Float.NaN;
        while (y >= 0 && !s[y * w + x] && c[1] <= orta) { c[1]++; y--; }
        if (y < 0 || c[1] > orta) return Float.NaN;
        while (y >= 0 && s[y * w + x] && c[0] <= orta) { c[0]++; y--; }
        if (c[0] > orta) return Float.NaN;
        y = y0 + 1;
        while (y < h && s[y * w + x]) { c[2]++; y++; }
        if (y == h) return Float.NaN;
        while (y < h && !s[y * w + x] && c[3] < orta) { c[3]++; y++; }
        if (y == h || c[3] >= orta) return Float.NaN;
        while (y < h && s[y * w + x] && c[4] < orta) { c[4]++; y++; }
        if (c[4] >= orta) return Float.NaN;
        int toplam = c[0] + c[1] + c[2] + c[3] + c[4];
        if (5 * Math.abs(toplam - toplamYatay) >= 2 * toplamYatay) return Float.NaN;
        return oran(c) ? y - c[4] - c[3] - c[2] / 2f : Float.NaN;
    }

    private static float yatayKontrol(boolean[] s, int w, int x0, int y, int orta, int toplamYatay) {
        int[] c = new int[5];
        int x = x0;
        while (x >= 0 && s[y * w + x]) { c[2]++; x--; }
        if (x < 0) return Float.NaN;
        while (x >= 0 && !s[y * w + x] && c[1] <= orta) { c[1]++; x--; }
        if (x < 0 || c[1] > orta) return Float.NaN;
        while (x >= 0 && s[y * w + x] && c[0] <= orta) { c[0]++; x--; }
        if (c[0] > orta) return Float.NaN;
        x = x0 + 1;
        while (x < w && s[y * w + x]) { c[2]++; x++; }
        if (x == w) return Float.NaN;
        while (x < w && !s[y * w + x] && c[3] < orta) { c[3]++; x++; }
        if (x == w || c[3] >= orta) return Float.NaN;
        while (x < w && s[y * w + x] && c[4] < orta) { c[4]++; x++; }
        if (c[4] >= orta) return Float.NaN;
        int toplam = c[0] + c[1] + c[2] + c[3] + c[4];
        if (5 * Math.abs(toplam - toplamYatay) >= toplamYatay) return Float.NaN;
        return oran(c) ? x - c[4] - c[3] - c[2] / 2f : Float.NaN;
    }

    // ---------- Üç kareden ızgara ----------

    private static String dene(boolean[] s, int w, int h, float[] p0, float[] p1, float[] p2) {
        float boy = (p0[2] + p1[2] + p2[2]) / 3f;
        for (float[] p : new float[][] { p0, p1, p2 }) if (Math.abs(p[2] - boy) > boy * 0.5f) return null;
        // Sol üst (B): diğer ikisine en yakın olan; A sol alt, C sağ üst (ZXing'in sıralamasıyla aynı).
        float d01 = uzaklik(p0, p1), d12 = uzaklik(p1, p2), d02 = uzaklik(p0, p2);
        float[] a, b, c;
        if (d12 >= d01 && d12 >= d02) { b = p0; a = p1; c = p2; }
        else if (d02 >= d12 && d02 >= d01) { b = p1; a = p0; c = p2; }
        else { b = p2; a = p0; c = p1; }
        if ((c[0] - b[0]) * (a[1] - b[1]) - (c[1] - b[1]) * (a[0] - b[0]) < 0) { float[] t = a; a = c; c = t; }
        float ust = uzaklik(b, c), sol = uzaklik(b, a);
        if (Math.abs(ust - sol) > Math.max(ust, sol) * 0.3f) return null;
        int tahmin = Math.round((ust / boy + sol / boy) / 2f) + 7;
        int[] boyutlar = { yuvarla(tahmin), yuvarla(tahmin) + 4, yuvarla(tahmin) - 4 };
        for (int boyut : boyutlar) {
            if (boyut != 21 && boyut != 25) continue;
            boolean[] izgara = ornekle(s, w, h, b, c, a, boyut);
            if (izgara == null) continue;
            String sonuc = izgaraCoz(izgara, boyut);
            if (sonuc != null) return sonuc;
        }
        return null;
    }

    private static int yuvarla(int boyut) { switch (boyut & 3) { case 0: return boyut + 1; case 2: return boyut - 1; case 3: return boyut - 2; default: return boyut; } }

    private static float uzaklik(float[] a, float[] b) { float dx = a[0] - b[0], dy = a[1] - b[1]; return (float) Math.sqrt(dx * dx + dy * dy); }

    /** Modül (sütun, satır) → resimde nokta: konum karelerinin merkezleri (3,5; 3,5), (boyut−3,5; 3,5), (3,5; boyut−3,5). */
    static boolean[] ornekle(boolean[] s, int w, int h, float[] solUst, float[] sagUst, float[] solAlt, int boyut) {
        boolean[] izgara = new boolean[boyut * boyut];
        float bolum = boyut - 7f;
        for (int satir = 0; satir < boyut; satir++) {
            for (int sutun = 0; sutun < boyut; sutun++) {
                float u = (sutun + 0.5f - 3.5f) / bolum, v = (satir + 0.5f - 3.5f) / bolum;
                float x = solUst[0] + u * (sagUst[0] - solUst[0]) + v * (solAlt[0] - solUst[0]);
                float y = solUst[1] + u * (sagUst[1] - solUst[1]) + v * (solAlt[1] - solUst[1]);
                int xi = Math.round(x), yi = Math.round(y);
                if (xi < 1 || yi < 1 || xi >= w - 1 || yi >= h - 1) return null;
                int siyah = 0;
                if (s[yi * w + xi]) siyah += 2;
                if (s[yi * w + xi - 1]) siyah++;
                if (s[yi * w + xi + 1]) siyah++;
                if (s[(yi - 1) * w + xi]) siyah++;
                if (s[(yi + 1) * w + xi]) siyah++;
                izgara[satir * boyut + sutun] = siyah >= 3;
            }
        }
        return izgara;
    }

    // ---------- Izgaradan metin ----------

    /** Düzeltme düzeyi (biçim bilgisindeki 2 bit) → sürüm 1 ve 2 için veri kod sözcüğü sayısı. */
    private static final int[][] VERI = { { 16, 28 }, { 19, 34 }, { 9, 16 }, { 13, 22 } }; // M, L, H, Q
    private static final int[] TOPLAM = { 26, 44 };

    static String izgaraCoz(boolean[] g, int boyut) {
        int bicim = bicimOku(g, boyut);
        if (bicim < 0) return null;
        int duzey = bicim >> 3, maske = bicim & 7, surum = (boyut - 17) / 4;
        boolean[] islev = islevAlanlari(boyut, surum);
        byte[] sozcukler = new byte[TOPLAM[surum - 1]];
        int okunan = 0, bit = 0, bayt = 0;
        boolean yukari = true;
        for (int j = boyut - 1; j > 0; j -= 2) {
            if (j == 6) j--;
            for (int k = 0; k < boyut; k++) {
                int i = yukari ? boyut - 1 - k : k;
                for (int col = 0; col < 2; col++) {
                    int x = j - col;
                    if (islev[i * boyut + x]) continue;
                    boolean b = g[i * boyut + x] ^ maskeli(maske, i, x);
                    bayt = (bayt << 1) | (b ? 1 : 0);
                    if (++bit == 8) { if (okunan < sozcukler.length) sozcukler[okunan++] = (byte) bayt; bit = 0; bayt = 0; }
                }
            }
            yukari = !yukari;
        }
        if (okunan != sozcukler.length) return null;
        int veri = VERI[duzey][surum - 1];
        int[] kod = new int[sozcukler.length];
        for (int i = 0; i < kod.length; i++) kod[i] = sozcukler[i] & 0xFF;
        if (!ReedSolomon.duzelt(kod, kod.length - veri)) return null;
        return veriOku(kod, veri, surum);
    }

    private static boolean maskeli(int maske, int i, int j) {
        switch (maske) {
            case 0: return ((i + j) & 1) == 0;
            case 1: return (i & 1) == 0;
            case 2: return j % 3 == 0;
            case 3: return (i + j) % 3 == 0;
            case 4: return (((i / 2) + (j / 3)) & 1) == 0;
            case 5: return (i * j) % 2 + (i * j) % 3 == 0;
            case 6: return (((i * j) % 2 + (i * j) % 3) & 1) == 0;
            default: return (((i + j) % 2 + (i * j) % 3) & 1) == 0;
        }
    }

    private static boolean[] islevAlanlari(int boyut, int surum) {
        boolean[] f = new boolean[boyut * boyut];
        bolge(f, boyut, 0, 0, 9, 9);
        bolge(f, boyut, boyut - 8, 0, 8, 9);
        bolge(f, boyut, 0, boyut - 8, 9, 8);
        bolge(f, boyut, 6, 9, 1, boyut - 17);
        bolge(f, boyut, 9, 6, boyut - 17, 1);
        if (surum == 2) bolge(f, boyut, 16, 16, 5, 5);
        return f;
    }

    /** (sol, üst) köşesinden genişlik × yükseklik kadar modül. */
    private static void bolge(boolean[] f, int boyut, int sol, int ust, int en, int boy) {
        for (int y = ust; y < ust + boy; y++) for (int x = sol; x < sol + en; x++) f[y * boyut + x] = true;
    }

    /** 15 bitlik biçim bilgisi (iki kopya); en çok 3 bit hatayla en yakın geçerli değer. Düzey ve maske (5 bit) ya da -1. */
    static int bicimOku(boolean[] g, int boyut) {
        int b1 = 0, b2 = 0;
        for (int i = 0; i < 6; i++) b1 = ekle(b1, g, boyut, i, 8);
        b1 = ekle(b1, g, boyut, 7, 8);
        b1 = ekle(b1, g, boyut, 8, 8);
        b1 = ekle(b1, g, boyut, 8, 7);
        for (int j = 5; j >= 0; j--) b1 = ekle(b1, g, boyut, 8, j);
        for (int j = boyut - 1; j >= boyut - 7; j--) b2 = ekle(b2, g, boyut, 8, j);
        for (int i = boyut - 8; i < boyut; i++) b2 = ekle(b2, g, boyut, i, 8);
        int enIyi = -1, enAz = 4;
        for (int veri = 0; veri < 32; veri++) {
            int kod = bicimKodu(veri);
            int fark = Math.min(Integer.bitCount(kod ^ b1), Integer.bitCount(kod ^ b2));
            if (fark < enAz) { enAz = fark; enIyi = veri; }
        }
        return enIyi;
    }

    /** (sütun x, satır y) modülünü bitlere ekler (ZXing'in okuma sırası). */
    private static int ekle(int bitler, boolean[] g, int boyut, int x, int y) { return (bitler << 1) | (g[y * boyut + x] ? 1 : 0); }

    /** 5 bit veri → BCH(15,5) ve 0x5412 maskesi. */
    static int bicimKodu(int veri) {
        int k = veri << 10;
        for (int i = 14; i >= 10; i--) if ((k & (1 << i)) != 0) k ^= 0x537 << (i - 10);
        return ((veri << 10) | k) ^ 0x5412;
    }

    private static final String HARF_RAKAM = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";

    private static String veriOku(int[] kod, int veri, int surum) {
        Bitler b = new Bitler(kod, veri);
        StringBuilder metin = new StringBuilder();
        while (b.kalan() >= 4) {
            int kip = b.oku(4);
            if (kip == 0) break;
            if (kip == 1) {
                int adet = b.oku(10);
                while (adet >= 3) { if (b.kalan() < 10) return null; int v = b.oku(10); if (v > 999) return null; metin.append(String.format(java.util.Locale.ROOT, "%03d", v)); adet -= 3; }
                if (adet == 2) { if (b.kalan() < 7) return null; int v = b.oku(7); if (v > 99) return null; metin.append(String.format(java.util.Locale.ROOT, "%02d", v)); }
                else if (adet == 1) { if (b.kalan() < 4) return null; int v = b.oku(4); if (v > 9) return null; metin.append(v); }
            } else if (kip == 2) {
                int adet = b.oku(9);
                while (adet >= 2) { if (b.kalan() < 11) return null; int v = b.oku(11); metin.append(HARF_RAKAM.charAt(v / 45)).append(HARF_RAKAM.charAt(v % 45)); adet -= 2; }
                if (adet == 1) { if (b.kalan() < 6) return null; metin.append(HARF_RAKAM.charAt(b.oku(6))); }
            } else if (kip == 4) {
                int adet = b.oku(8);
                if (b.kalan() < adet * 8) return null;
                byte[] baytlar = new byte[adet];
                for (int i = 0; i < adet; i++) baytlar[i] = (byte) b.oku(8);
                metin.append(new String(baytlar, StandardCharsets.UTF_8));
            } else return null;
        }
        return metin.length() == 0 ? null : metin.toString();
    }

    private static final class Bitler {
        private final int[] kod; private final int son; private int konum;
        Bitler(int[] kod, int veri) { this.kod = kod; this.son = veri * 8; }
        int kalan() { return son - konum; }
        int oku(int n) {
            int v = 0;
            for (int i = 0; i < n; i++, konum++) v = (v << 1) | (konum < son && ((kod[konum >> 3] >> (7 - (konum & 7))) & 1) == 1 ? 1 : 0);
            return v;
        }
    }

    /** GF(256) üzerinde Reed-Solomon (QR: x^8+x^4+x^3+x^2+1, kökler α^0…). Berlekamp-Massey, Chien, Forney. */
    static final class ReedSolomon {
        private static final int[] US = new int[512], LOG = new int[256];
        static {
            int x = 1;
            for (int i = 0; i < 255; i++) { US[i] = x; LOG[x] = i; x <<= 1; if (x >= 256) x ^= 0x11D; }
            for (int i = 255; i < 512; i++) US[i] = US[i - 255];
        }
        private static int carp(int a, int b) { return a == 0 || b == 0 ? 0 : US[LOG[a] + LOG[b]]; }
        private static int bol(int a, int b) { return a == 0 ? 0 : US[(LOG[a] + 255 - LOG[b]) % 255]; }

        /** Kod sözcüklerini yerinde düzeltir; düzeltilemezse false. */
        static boolean duzelt(int[] c, int ec) {
            int n = c.length;
            int[] s = new int[ec];
            boolean temiz = true;
            for (int i = 0; i < ec; i++) {
                int v = 0;
                for (int k = 0; k < n; k++) v = carp(v, US[i]) ^ c[k];
                s[i] = v; if (v != 0) temiz = false;
            }
            if (temiz) return true;
            // Berlekamp-Massey: hata konum çok terimlisi (artan dereceler, C[0] = 1).
            int[] cc = new int[ec + 1], bb = new int[ec + 1];
            cc[0] = 1; bb[0] = 1;
            int l = 0, m = 1, sonD = 1;
            for (int r = 0; r < ec; r++) {
                int d = s[r];
                for (int i = 1; i <= l; i++) d ^= carp(cc[i], s[r - i]);
                if (d == 0) { m++; continue; }
                int[] onceki = cc.clone();
                int katsayi = bol(d, sonD);
                for (int i = 0; i + m <= ec; i++) cc[i + m] ^= carp(katsayi, bb[i]);
                if (2 * l <= r) { l = r + 1 - l; bb = onceki; sonD = d; m = 1; } else m++;
            }
            if (2 * l > ec) return false;
            // Ω(x) = S(x)·Λ(x) mod x^ec
            int[] omega = new int[ec];
            for (int i = 0; i < ec; i++) for (int j = 0; j <= i && j <= l; j++) omega[i] ^= carp(cc[j], s[i - j]);
            int bulunan = 0;
            for (int konum = 0; konum < n; konum++) {
                int derece = n - 1 - konum, xTers = US[(255 - derece % 255) % 255];
                int deger = 0, ust = 1;
                for (int i = 0; i <= l; i++) { deger ^= carp(cc[i], ust); ust = carp(ust, xTers); }
                if (deger != 0) continue;
                // Forney (ilk kök α^0): e = X · Ω(X⁻¹) / Λ'(X⁻¹)
                int om = 0; ust = 1;
                for (int i = 0; i < ec; i++) { om ^= carp(omega[i], ust); ust = carp(ust, xTers); }
                int turev = 0; ust = 1;
                for (int i = 1; i <= l; i++) { if ((i & 1) == 1) turev ^= carp(cc[i], ust); ust = carp(ust, xTers); }
                if (turev == 0) return false;
                c[konum] ^= carp(US[derece % 255], bol(om, turev));
                bulunan++;
            }
            if (bulunan != l) return false;
            for (int i = 0; i < ec; i++) {
                int v = 0;
                for (int k = 0; k < n; k++) v = carp(v, US[i]) ^ c[k];
                if (v != 0) return false;
            }
            return true;
        }
    }
}
