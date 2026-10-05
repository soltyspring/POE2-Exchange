import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { AppBoundary } from './AppBoundary'
import './style.css'
import './liquidity.css'
import './scout.css'
import './MarketWindow.css'
import './Product.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><AppBoundary><App /></AppBoundary></React.StrictMode>,
)
