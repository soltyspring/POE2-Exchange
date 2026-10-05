import { Component, type ReactNode } from 'react'

export class AppBoundary extends Component<{children: ReactNode}, {failed: boolean}> {
  state = {failed: false}
  static getDerivedStateFromError() { return {failed: true} }
  render() {
    if (this.state.failed) return <main className="recovery-screen"><h1>화면을 다시 불러와 주세요.</h1><p>시세 기록은 서버에 보관됩니다. 관심 목록을 삭제하지 않고 화면을 복구할 수 있습니다.</p><button onClick={() => window.location.reload()}>다시 불러오기</button><a href="/guide/index.html">사용 가이드</a><a href="/contact.html">문제 제보</a></main>
    return this.props.children
  }
}
