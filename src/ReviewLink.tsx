import { ExternalLink } from 'lucide-react';
import { isGoogleReviewUrl } from '../packages/domain/review-link';
import { SocialIcon } from './socialIcons';
/** The Google review button after the bill (src/Customer.tsx): the Google "G", one clear label, a new tab. */
export function ReviewLink({ url, en = false }: { url?: string; en?: boolean }) {
 if (!url || !isGoogleReviewUrl(url)) return null;
 return <a className="review-link" href={url} target="_blank" rel="noopener noreferrer"><SocialIcon platform="review" size={18} /><span>{en ? 'Review us on Google' : 'Google’da değerlendirin'}</span><ExternalLink size={14} aria-hidden="true" /></a>;
}
