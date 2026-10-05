import type { ButtonHTMLAttributes } from 'react'
import { ArrowLeft } from 'lucide-react'

// Shared structure; text colors stay owned by the existing page styles.
export function UiButton({className = '', ...props}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} className={`ui-button ${className}`}/>
}

export function SiteHeader() {
  return <header className="site-header build-header"><a className="build-brand" href="/">POE2 <span>MARKET</span></a><a href="/"><ArrowLeft size={15}/>시세 대시보드</a></header>
}
