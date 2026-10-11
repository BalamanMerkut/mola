package com.merkutstudios.mola;

import android.Manifest;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;
import android.graphics.drawable.GradientDrawable;
import android.hardware.Camera;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.Looper;
import android.view.Gravity;
import android.view.Surface;
import android.view.SurfaceHolder;
import android.view.SurfaceView;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.TextView;
import android.widget.Toast;
import java.util.List;

/**
 * "QR okut": kasadaki "Vardiya kodu" ekranını telefonun kamerasıyla okur ve metni Mola'ya geri verir (MainActivity →
 * window.__molaQr). Dış kütüphane yok: önizleme Android'in kendi Camera arayüzüyle alınır (Android 7–14'te var), her
 * kareden ortadaki kare bölge saf Java QR çözücüyle (QrCozucu) okunur. Kamera izni yalnız bu ekran açılınca istenir;
 * verilmezse kod yine elle yazılır.
 */
@SuppressWarnings("deprecation")
public final class QrOkuyucu extends Activity implements SurfaceHolder.Callback, Camera.PreviewCallback {
    static final String METIN = "metin";
    private static final int IZIN = 7;

    private final Handler ana = new Handler(Looper.getMainLooper());
    private SurfaceView yuzey;
    private Camera kamera;
    private int kameraNo = -1, en, boy;
    private boolean yuzeyHazir, bitti;
    private volatile boolean cozuluyor;
    private HandlerThread isci;
    private Handler isciEli;
    private final Runnable odakla = new Runnable() {
        @Override public void run() {
            Camera k = kamera;
            if (k == null) return;
            try { k.autoFocus((basari, c) -> {}); } catch (RuntimeException ignored) {}
            ana.postDelayed(this, 2500);
        }
    };

    @Override
    protected void onCreate(Bundle durum) {
        super.onCreate(durum);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        FrameLayout kok = new FrameLayout(this);
        kok.setBackgroundColor(Color.BLACK);
        yuzey = new SurfaceView(this);
        yuzey.getHolder().addCallback(this);
        kok.addView(yuzey, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        kok.addView(new Cerceve(this), new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        TextView ipucu = new TextView(this);
        ipucu.setText("Kasadaki vardiya kodunun QR'ını çerçeveye getirin");
        ipucu.setTextColor(Color.WHITE);
        ipucu.setTextSize(16);
        ipucu.setGravity(Gravity.CENTER);
        FrameLayout.LayoutParams ust = new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP);
        ust.topMargin = dp(48); ust.leftMargin = dp(24); ust.rightMargin = dp(24);
        kok.addView(ipucu, ust);
        Button vazgec = new Button(this);
        vazgec.setText("Vazgeç");
        vazgec.setAllCaps(false);
        vazgec.setTextSize(16);
        vazgec.setTextColor(0xFF234C3E);
        GradientDrawable zemin = new GradientDrawable();
        zemin.setColor(Color.WHITE); zemin.setCornerRadius(dp(24));
        vazgec.setBackground(zemin);
        vazgec.setOnClickListener(v -> bitir(null));
        FrameLayout.LayoutParams alt = new FrameLayout.LayoutParams(dp(180), dp(52), Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL);
        alt.bottomMargin = dp(40);
        kok.addView(vazgec, alt);
        setContentView(kok);
        if (Build.VERSION.SDK_INT >= 23 && checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) requestPermissions(new String[] { Manifest.permission.CAMERA }, IZIN);
    }

    @Override
    public void onRequestPermissionsResult(int istek, String[] izinler, int[] sonuclar) {
        if (istek != IZIN) return;
        if (sonuclar.length > 0 && sonuclar[0] == PackageManager.PERMISSION_GRANTED) { if (yuzeyHazir) kameraAc(); }
        else { Toast.makeText(this, "Kamera izni verilmedi. Kodu elle yazabilirsiniz.", Toast.LENGTH_LONG).show(); bitir(null); }
    }

    @Override protected void onResume() { super.onResume(); if (yuzeyHazir) kameraAc(); }
    @Override protected void onPause() { kameraKapat(); super.onPause(); }
    @Override public void onBackPressed() { bitir(null); }
    @Override public void onConfigurationChanged(Configuration yeni) { super.onConfigurationChanged(yeni); if (kamera != null) yonAyarla(kamera); }

    @Override public void surfaceCreated(SurfaceHolder h) { yuzeyHazir = true; kameraAc(); }
    @Override public void surfaceChanged(SurfaceHolder h, int bicim, int g, int y) {}
    @Override public void surfaceDestroyed(SurfaceHolder h) { yuzeyHazir = false; kameraKapat(); }

    private boolean izinVar() { return Build.VERSION.SDK_INT < 23 || checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED; }

    private void kameraAc() {
        if (kamera != null || bitti || !izinVar() || !yuzeyHazir) return;
        try {
            Camera.CameraInfo bilgi = new Camera.CameraInfo();
            for (int i = 0; i < Camera.getNumberOfCameras(); i++) { Camera.getCameraInfo(i, bilgi); if (bilgi.facing == Camera.CameraInfo.CAMERA_FACING_BACK) { kameraNo = i; break; } }
            if (kameraNo < 0 && Camera.getNumberOfCameras() > 0) kameraNo = 0;
            if (kameraNo < 0) throw new RuntimeException("kamera yok");
            Camera k = Camera.open(kameraNo);
            Camera.Parameters p = k.getParameters();
            Camera.Size secilen = null;
            for (Camera.Size s : p.getSupportedPreviewSizes()) {
                if (s.width > 1920 || s.height > 1080) continue;
                if (secilen == null || Math.abs(s.width * s.height - 1280 * 720) < Math.abs(secilen.width * secilen.height - 1280 * 720)) secilen = s;
            }
            if (secilen != null) p.setPreviewSize(secilen.width, secilen.height);
            List<String> odaklar = p.getSupportedFocusModes();
            boolean surekli = odaklar != null && odaklar.contains(Camera.Parameters.FOCUS_MODE_CONTINUOUS_PICTURE);
            if (surekli) p.setFocusMode(Camera.Parameters.FOCUS_MODE_CONTINUOUS_PICTURE);
            else if (odaklar != null && odaklar.contains(Camera.Parameters.FOCUS_MODE_AUTO)) p.setFocusMode(Camera.Parameters.FOCUS_MODE_AUTO);
            k.setParameters(p);
            Camera.Size boyut = k.getParameters().getPreviewSize();
            en = boyut.width; boy = boyut.height;
            yonAyarla(k);
            k.setPreviewDisplay(yuzey.getHolder());
            isci = new HandlerThread("qr-cozucu"); isci.start(); isciEli = new Handler(isci.getLooper());
            int tampon = en * boy * 3 / 2;
            k.addCallbackBuffer(new byte[tampon]); k.addCallbackBuffer(new byte[tampon]);
            k.setPreviewCallbackWithBuffer(this);
            k.startPreview();
            kamera = k;
            if (!surekli) ana.postDelayed(odakla, 800);
        } catch (Exception e) {
            kameraKapat();
            Toast.makeText(this, "Kamera açılamadı. Kodu elle yazabilirsiniz.", Toast.LENGTH_LONG).show();
            bitir(null);
        }
    }

    private void yonAyarla(Camera k) {
        Camera.CameraInfo bilgi = new Camera.CameraInfo();
        Camera.getCameraInfo(kameraNo, bilgi);
        int derece;
        switch (getWindowManager().getDefaultDisplay().getRotation()) { case Surface.ROTATION_90: derece = 90; break; case Surface.ROTATION_180: derece = 180; break; case Surface.ROTATION_270: derece = 270; break; default: derece = 0; }
        int yon = bilgi.facing == Camera.CameraInfo.CAMERA_FACING_FRONT ? (360 - (bilgi.orientation + derece) % 360) % 360 : (bilgi.orientation - derece + 360) % 360;
        try { k.setDisplayOrientation(yon); } catch (RuntimeException ignored) {}
    }

    private void kameraKapat() {
        ana.removeCallbacks(odakla);
        Camera k = kamera; kamera = null;
        if (k != null) { try { k.setPreviewCallbackWithBuffer(null); k.stopPreview(); } catch (RuntimeException ignored) {} k.release(); }
        if (isci != null) { isci.quitSafely(); isci = null; isciEli = null; }
        cozuluyor = false;
    }

    /** Bir kare: yalnız ortadaki kare bölge (çerçeve), parlaklık düzlemi (NV21'in ilk en×boy baytı). */
    @Override
    public void onPreviewFrame(byte[] veri, Camera k) {
        Handler el = isciEli;
        if (veri == null || el == null || cozuluyor || bitti) { if (veri != null) k.addCallbackBuffer(veri); return; }
        cozuluyor = true;
        final int w = en, h = boy;
        el.post(() -> {
            String metin = null;
            try {
                int kenar = Math.min(w, h) * 4 / 5, x0 = (w - kenar) / 2, y0 = (h - kenar) / 2;
                byte[] kare = new byte[kenar * kenar];
                for (int y = 0; y < kenar; y++) System.arraycopy(veri, (y0 + y) * w + x0, kare, y * kenar, kenar);
                metin = QrCozucu.coz(kare, kenar, kenar);
            } catch (RuntimeException ignored) {}
            final String sonuc = metin;
            ana.post(() -> {
                if (sonuc != null) { bitir(sonuc); return; }
                Camera simdiki = kamera;
                if (simdiki == k) { try { k.addCallbackBuffer(veri); } catch (RuntimeException ignored) {} }
                cozuluyor = false;
            });
        });
    }

    private void bitir(String metin) {
        if (bitti) return;
        bitti = true;
        kameraKapat();
        if (metin != null) { Intent sonuc = new Intent(); sonuc.putExtra(METIN, metin); setResult(RESULT_OK, sonuc); }
        else setResult(RESULT_CANCELED);
        finish();
    }

    private int dp(float v) { return Math.round(v * getResources().getDisplayMetrics().density); }

    /** Ortada kare bir çerçeve; dışı hafif karartılır (okunan bölge burası). */
    private static final class Cerceve extends View {
        private final Paint karartma = new Paint(), cizgi = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Path yol = new Path();
        private final RectF kutu = new RectF();
        Cerceve(Context c) {
            super(c);
            karartma.setColor(0x99000000);
            cizgi.setColor(Color.WHITE); cizgi.setStyle(Paint.Style.STROKE); cizgi.setStrokeWidth(4 * c.getResources().getDisplayMetrics().density);
        }
        @Override protected void onDraw(Canvas tuval) {
            int w = getWidth(), h = getHeight(), kenar = Math.min(w, h) * 7 / 10;
            float sol = (w - kenar) / 2f, ust = (h - kenar) / 2f, r = kenar / 14f;
            kutu.set(sol, ust, sol + kenar, ust + kenar);
            yol.reset(); yol.addRect(0, 0, w, h, Path.Direction.CW); yol.addRoundRect(kutu, r, r, Path.Direction.CCW);
            tuval.drawPath(yol, karartma);
            tuval.drawRoundRect(kutu, r, r, cizgi);
        }
    }
}
