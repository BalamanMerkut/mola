import { Bike, Boxes, CalendarCheck, ChartLine, CloudUpload, Columns2, ConciergeBell, FileChartColumn, Mail, MonitorSmartphone, QrCode, ReceiptText, Share2, UsersRound, type LucideIcon } from 'lucide-react';
import type { FeatureId } from '../packages/domain/features';

/** One icon per Mola service (packages/domain/features.ts), for "Paketiniz" and the "Deneme süreniz bitti" window. */
export const featureIcons: Record<FeatureId, LucideIcon> = {
  core: ReceiptText, 'qr-menu': QrCode, 'qr-order': ConciergeBell, 'reports-advanced': FileChartColumn, stock: Boxes,
  reservations: CalendarCheck, shifts: UsersRound, social: Share2, 'remote-reports': ChartLine, 'remote-admin': MonitorSmartphone,
  'email-reports': Mail, 'split-screen': Columns2, 'cloud-backup': CloudUpload, integrations: Bike,
};
