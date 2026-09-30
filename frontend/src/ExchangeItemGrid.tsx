import type { ReactNode } from 'react'
import './ExchangeItemGrid.css'

type Item = { id: string; name: string }
type Group<T> = { label: string; markets: T[] }

export function ExchangeItemGrid<T extends Item>({groups, selectedId, onSelect, quote, renderIcon, renderWarning, renderPrice}: {
  groups: Group<T>[]
  selectedId: string
  onSelect: (id: string) => void
  quote: (item: T) => {value: string; unit: string}
  renderIcon: (item: T) => ReactNode
  renderWarning: (item: T) => ReactNode
  renderPrice: (value: string) => ReactNode
}) {
  return <div className="exchange-item-grid">
    {groups.map(group => <section className="exchange-group" key={group.label}>
      <h3><span>{group.label}</span><small>{group.markets.length}개</small></h3>
      <div className="exchange-blocks">
        {Array.from({length: Math.ceil(group.markets.length / 15)}, (_, block) =>
          <div className="exchange-grid" key={block}>
            {group.markets.slice(block * 15, block * 15 + 15).map(item => {
              const {value, unit} = quote(item)
              return <button key={item.id} className={`exchange-item ${selectedId === item.id ? 'selected' : ''}`}
                onClick={() => onSelect(item.id)} title={`${item.name} · ${value} ${unit}`}>
                {renderIcon(item)}
                <span className="exchange-item-name"><span>{item.name}</span>{renderWarning(item)}</span>
                <span className="exchange-item-price">{renderPrice(value)} <small>{unit}</small></span>
              </button>
            })}
          </div>)}
      </div>
    </section>)}
  </div>
}
