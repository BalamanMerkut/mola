// Ekranları elle incelemek için: örnek işletmeyle iki geçici sunucuyu açar ve Ctrl+C'ye kadar açık tutar.
//   npx.cmd tsx docs/pdf/kaynak/kilavuz/sunucu-ac.ts
import { KAFE, MERKEZ, ADMIN_PASSWORD, startServers } from './sunucular.ts';
const started = Date.now();
const servers = await startServers();
console.log(`Hazır (${Math.round((Date.now() - started) / 1000)} sn). Kafe ${KAFE} (isletme / MolaDemo!2026), Mola Yönetim ${MERKEZ} (admin / ${ADMIN_PASSWORD}). Veri: ${servers.root}`);
process.on('SIGINT', () => { servers.stop(); process.exit(0); });
setInterval(() => {}, 1 << 30);
