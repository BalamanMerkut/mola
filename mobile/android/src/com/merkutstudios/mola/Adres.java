package com.merkutstudios.mola;

import android.net.Uri;
import java.util.Locale;

/**
 * Kafe bilgisayarının adresi: "http://192.168.1.20:3000" biçiminde bir köken (origin). Düz HTTP yalnız özel ağ
 * adreslerine açılır (kafede TLS yoktur); internetteki her adres HTTPS olmak zorundadır.
 */
final class Adres {
    private Adres() {}

    static final int VARSAYILAN_PORT = 3000;

    /** Elle yazılan ya da bağlantıdan gelen adresi kökene çevirir; kabul edilmeyen adres için null. */
    static String duzenle(String girdi) {
        if (girdi == null) return null;
        String metin = girdi.trim();
        if (metin.isEmpty() || metin.length() > 300) return null;
        if (!metin.contains("://")) metin = "http://" + metin;
        Uri uri;
        try { uri = Uri.parse(metin); } catch (RuntimeException e) { return null; }
        String sema = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
        String host = uri.getHost();
        if (!sema.equals("http") && !sema.equals("https")) return null;
        if (host == null || host.isEmpty() || uri.getUserInfo() != null) return null;
        host = host.toLowerCase(Locale.ROOT);
        if (!host.matches("[a-z0-9.\\-]+|\\[[0-9a-f:.]+\\]")) return null;
        int port = uri.getPort();
        if (sema.equals("http") && !yerelAg(host)) return null;
        // "192.168.1.20" yazıldıysa Mola'nın bağlantı noktası (3000) kastedilmiştir.
        if (port == -1 && sema.equals("http")) port = VARSAYILAN_PORT;
        if (port == 0 || port > 65535) return null;
        boolean varsayilan = port == -1 || (sema.equals("http") && port == 80) || (sema.equals("https") && port == 443);
        return sema + "://" + host + (varsayilan ? "" : ":" + port);
    }

    /** Özel ağ: 10/8, 172.16/12, 192.168/16, 169.254/16, IPv6 fc00::/7 ve fe80::/10, ".local" ya da noktasız bilgisayar adı. */
    static boolean yerelAg(String host) {
        String h = host.toLowerCase(Locale.ROOT);
        if (h.startsWith("[")) {
            String ip = h.substring(1, h.length() - 1);
            return ip.startsWith("fc") || ip.startsWith("fd") || ip.startsWith("fe8") || ip.startsWith("fe9") || ip.startsWith("fea") || ip.startsWith("feb");
        }
        if (h.matches("\\d{1,3}(\\.\\d{1,3}){3}")) {
            String[] p = h.split("\\.");
            int a = Integer.parseInt(p[0]), b = Integer.parseInt(p[1]);
            for (String s : p) if (Integer.parseInt(s) > 255) return false;
            return a == 10 || (a == 172 && b >= 16 && b <= 31) || (a == 192 && b == 168) || (a == 169 && b == 254);
        }
        if (h.endsWith(".local")) return true;
        return !h.contains(".") && h.matches("[a-z0-9\\-]+");
    }

    /** Aynı köken mi (şema, ad, bağlantı noktası)? WebView yalnız kafenin kendi adresini açar, gerisi tarayıcıya gider. */
    static boolean ayniKoken(Uri uri, String koken) {
        return koken != null && koken.equals(koken(uri));
    }

    /** Bir sayfa adresinin kökeni, duzenle() ile aynı biçimde (varsayılan bağlantı noktası yazılmaz); http(s) değilse null. */
    static String koken(Uri uri) {
        if (uri == null || uri.getScheme() == null || uri.getHost() == null) return null;
        String sema = uri.getScheme().toLowerCase(Locale.ROOT);
        if (!sema.equals("http") && !sema.equals("https")) return null;
        int port = uri.getPort();
        boolean varsayilan = port == -1 || (sema.equals("http") && port == 80) || (sema.equals("https") && port == 443);
        return sema + "://" + uri.getHost().toLowerCase(Locale.ROOT) + (varsayilan ? "" : ":" + port);
    }

    /** Ekranda gösterilecek kısa biçim: "192.168.1.20:3000". */
    static String kisa(String koken) {
        return koken == null ? "" : koken.replaceFirst("^http://", "");
    }

    static String host(String koken) {
        Uri u = Uri.parse(koken);
        String h = u.getHost();
        return h == null ? "" : h;
    }
}
