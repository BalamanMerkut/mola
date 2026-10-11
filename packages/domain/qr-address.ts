// Table QR codes hold this computer's local address (http://192.168.1.20:3000/m/…). If the modem gives the computer another
// address (restart, DHCP), stickers already on the tables stop opening. Only local IP addresses carry that risk.
const localIp = /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/;
/** True when the last printed QR set points at a local address the computer no longer has. Unknown cases stay quiet. */
export function qrAddressChanged(printed: string | undefined, current: string[]) {
  if (!printed || !current.length) return false;
  try {
    const was = new URL(printed);
    if (!localIp.test(was.hostname)) return false;
    return !current.some(origin => new URL(origin).host === was.host);
  } catch { return false; }
}
