import { useEffect, type RefObject } from 'react'

/** Shared focus, keyboard and scroll behavior for the two full-screen market views. */
export function useMarketDialog(open: boolean, close: () => void, ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return
    const dialog = ref.current
    if (!dialog) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const overflow = document.body.style.overflow
    const main = document.querySelector('.main')
    const siblings = [...(main?.children || [])].filter(node => node !== dialog && !node.contains(dialog))
    // aria-modal describes the view; inert enforces that the background cannot be operated.
    const contentSiblings = [...(document.querySelector('.content')?.children || [])]
      .filter(node => node !== dialog && !node.contains(dialog))
    const background = [...document.querySelectorAll('.sidebar, .mobile-dock'), ...siblings, ...contentSiblings]
    const priorInert = background.map(node => [node, (node as HTMLElement).inert] as const)
    priorInert.forEach(([node]) => { (node as HTMLElement).inert = true })
    document.body.style.overflow = 'hidden'
    const search = dialog.querySelector<HTMLInputElement>('input[type="search"], input')
    const first = search || dialog.querySelector<HTMLElement>('button') || dialog
    first.focus()
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); close(); return }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault(); search?.focus(); return
      }
      if (event.key !== 'Tab') return
      const nodes = [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input, select, a[href], [tabindex="0"]')]
        .filter(node => node.getClientRects().length > 0 && !node.closest('[inert]'))
      const start = nodes[0], end = nodes.at(-1)
      if (event.shiftKey && (document.activeElement === start || !dialog.contains(document.activeElement))) {
        event.preventDefault(); end?.focus()
      } else if (!event.shiftKey && (document.activeElement === end || !dialog.contains(document.activeElement))) {
        event.preventDefault(); start?.focus()
      }
    }
    document.addEventListener('keydown', keyboard)
    return () => {
      document.removeEventListener('keydown', keyboard)
      document.body.style.overflow = overflow
      priorInert.forEach(([node, wasInert]) => { (node as HTMLElement).inert = wasInert })
      previous?.focus()
    }
  }, [open, close, ref])
}
