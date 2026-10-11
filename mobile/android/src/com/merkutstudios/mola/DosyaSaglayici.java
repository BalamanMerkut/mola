package com.merkutstudios.mola;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import java.io.File;
import java.io.FileNotFoundException;
import java.io.IOException;

/**
 * Kameranın çektiği fotoğrafı yazacağı geçici dosya: content://com.merkutstudios.mola.dosya/kamera/foto-....jpg
 * (Android 7+ file:// adresini başka uygulamaya vermeyi yasaklar; androidx FileProvider'ın küçük bir karşılığı).
 * Dosyalar uygulamanın önbelleğinde durur, bir günden eskileri açılışta silinir. Dışa açık değildir: kamera uygulamasına
 * yalnız o tek dosya için geçici yazma izni verilir.
 */
public final class DosyaSaglayici extends ContentProvider {
    static final String YETKI = "com.merkutstudios.mola.dosya";

    static File klasor(Context baglam) {
        File k = new File(baglam.getCacheDir(), "kamera");
        //noinspection ResultOfMethodCallIgnored
        k.mkdirs();
        return k;
    }

    static Uri yeniFoto(Context baglam) throws IOException {
        File f = new File(klasor(baglam), "foto-" + System.currentTimeMillis() + ".jpg");
        if (!f.exists() && !f.createNewFile()) throw new IOException("Dosya açılamadı");
        return Uri.parse("content://" + YETKI + "/kamera/" + f.getName());
    }

    /** Kameranın yazdığı dosyada bir şey var mı (vazgeçilen çekimde boş kalır)? */
    static boolean dolu(Context baglam, Uri uri) {
        File f = dosya(baglam, uri);
        return f != null && f.length() > 0;
    }

    static void eskileriSil(Context baglam) {
        File[] liste = klasor(baglam).listFiles();
        if (liste == null) return;
        long sinir = System.currentTimeMillis() - 24L * 3600_000L;
        //noinspection ResultOfMethodCallIgnored
        for (File f : liste) if (f.lastModified() < sinir) f.delete();
    }

    private static File dosya(Context baglam, Uri uri) {
        if (uri == null || !YETKI.equals(uri.getAuthority())) return null;
        java.util.List<String> parca = uri.getPathSegments();
        if (parca.size() != 2 || !"kamera".equals(parca.get(0)) || !parca.get(1).matches("foto-\\d{1,20}\\.jpg")) return null;
        return new File(klasor(baglam), parca.get(1));
    }

    @Override public boolean onCreate() { return true; }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        File f = dosya(getContext(), uri);
        if (f == null) throw new FileNotFoundException("Bulunamadı");
        return ParcelFileDescriptor.open(f, ParcelFileDescriptor.parseMode(mode));
    }

    @Override
    public Cursor query(Uri uri, String[] sutunlar, String secim, String[] secimDegerleri, String siralama) {
        File f = dosya(getContext(), uri);
        if (f == null) return null;
        String[] adlar = sutunlar != null ? sutunlar : new String[] { OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE };
        MatrixCursor c = new MatrixCursor(adlar, 1);
        Object[] satir = new Object[adlar.length];
        for (int i = 0; i < adlar.length; i++) {
            if (OpenableColumns.DISPLAY_NAME.equals(adlar[i])) satir[i] = f.getName();
            else if (OpenableColumns.SIZE.equals(adlar[i])) satir[i] = f.length();
        }
        c.addRow(satir);
        return c;
    }

    @Override public String getType(Uri uri) { return dosya(getContext(), uri) != null ? "image/jpeg" : null; }
    @Override public Uri insert(Uri uri, ContentValues degerler) { return null; }
    @Override public int delete(Uri uri, String secim, String[] secimDegerleri) { return 0; }
    @Override public int update(Uri uri, ContentValues degerler, String secim, String[] secimDegerleri) { return 0; }
}
