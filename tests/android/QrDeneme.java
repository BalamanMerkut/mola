package com.merkutstudios.mola;

import java.nio.file.Files;
import java.nio.file.Paths;

/**
 * tests/android-qr.test.ts için: Android uygulamasının QR çözücüsünü (mobile/android/.../QrCozucu.java) bilgisayarda
 * çalıştırır. Her dosya: 4 bayt genişlik, 4 bayt yükseklik (büyük uçlu), sonra parlaklık baytları. Her dosya için bir
 * satır yazar: çözülen metin ya da "-".
 */
public final class QrDeneme {
    public static void main(String[] args) throws Exception {
        for (String yol : args) {
            byte[] d = Files.readAllBytes(Paths.get(yol));
            int w = ((d[0] & 0xFF) << 24) | ((d[1] & 0xFF) << 16) | ((d[2] & 0xFF) << 8) | (d[3] & 0xFF);
            int h = ((d[4] & 0xFF) << 24) | ((d[5] & 0xFF) << 16) | ((d[6] & 0xFF) << 8) | (d[7] & 0xFF);
            byte[] p = new byte[w * h];
            System.arraycopy(d, 8, p, 0, w * h);
            String sonuc = QrCozucu.coz(p, w, h);
            System.out.println(sonuc == null ? "-" : sonuc);
        }
    }
}
