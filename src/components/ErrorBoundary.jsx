import { Component } from 'react'

// A blank white page tells you nothing. If a screen fails to render, show what
// went wrong and let the person carry on using the rest of the app.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('Screen failed to render:', error, info)
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <div className="card" style={{ margin: 24 }}>
        <div className="eyebrow">Something went wrong</div>
        <h2 className="page-title">This screen could not be shown</h2>
        <p className="page-desc">
          The rest of the app is still fine ~ use the menu to go elsewhere, or reload the page.
        </p>
        <div className="placeholder-note" style={{ fontFamily: 'monospace' }}>
          {String(this.state.error?.message || this.state.error)}
        </div>
        <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
          <button className="btn btn-primary" onClick={() => window.location.reload()}>
            Reload
          </button>
          <button className="btn" onClick={() => this.setState({ error: null })}>
            Try again
          </button>
        </div>
      </div>
    )
  }
}
