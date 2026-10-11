import { CheckCircle2, Clock3, CircleAlert } from 'lucide-react';
import type { PublicOrder } from '../packages/domain/types';
export function CustomerCancellation({ order, en }: { order: PublicOrder; en: boolean }) {
 const cancelled = order.status === 'cancelled';
 if (!cancelled && !order.cancelRequested && !order.cancelDeclineReason) return null;
 const Icon = cancelled ? CheckCircle2 : order.cancelRequested ? Clock3 : CircleAlert;
 const title = cancelled ? (en ? 'Order cancelled' : 'Sipariş iptal edildi') : order.cancelRequested ? (en ? 'Cancellation awaiting approval' : 'İptal talebi onay bekliyor') : (en ? 'Cancellation not approved' : 'İptal talebi onaylanmadı');
 const detail = cancelled ? (en ? 'This order is no longer being prepared.' : 'Bu sipariş için hazırlık devam etmeyecek.') : order.cancelRequested ? (en ? 'Your order has not been cancelled yet. The café is reviewing your request.' : 'Siparişiniz henüz iptal edilmedi. İşletme talebinizi değerlendiriyor.') : order.cancelDeclineReason;
 return <div className="customer-cancel-status" role="status"><Icon size={18} /><div><strong>{title}</strong><p>{detail}</p></div></div>;
}
