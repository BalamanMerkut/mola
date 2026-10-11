import { socialEntries, socialInfo, type SocialLinks } from '../packages/domain/social-links';
import { SocialIcon } from './socialIcons';
import './social.css';

/**
 * "Bizi takip edin": the café's social links as quiet round icon buttons in the menu's own colours (brand colour only on
 * hover and focus). At the foot of the guest menu every row shows, the Google review too ("Google’da değerlendirin"); in the
 * "sent" window (the review comes after eating) and in the after-the-bill card (where the review is its own button,
 * src/ReviewLink.tsx) the Google icon is left out. Only filled links; nothing at all when there are none. New tab each.
 */
export function SocialFollow({ links, en = false, variant = 'footer', heading = true }: { links?: SocialLinks; en?: boolean; variant?: 'footer' | 'sent' | 'prompt'; heading?: boolean }) {
  const entries = socialEntries(links, variant === 'footer' ? [] : ['review']);
  if (!entries.length) return null;
  const title = entries.every(e => e.platform === 'review') ? (en ? 'Review us' : 'Bizi değerlendirin') : en ? 'Follow us' : 'Bizi takip edin';
  return <nav className={`social-follow social-follow-${variant}`} aria-label={title}>
    {heading && <p className="social-follow-title">{title}</p>}
    <ul>{entries.map(({ platform, url }) => {
      const label = en ? socialInfo[platform].followEn : socialInfo[platform].follow;
      return <li key={platform}><a className="social-follow-link" data-platform={platform} href={url} target="_blank" rel="noopener noreferrer" aria-label={label} title={label}><SocialIcon platform={platform} size={19} /></a></li>;
    })}</ul>
  </nav>;
}
