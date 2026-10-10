import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Icon } from './ui';

/**
 * Catches an error in one screen so the sidebar and every other screen keep working. Without it React unmounts the
 * whole window and leaves it blank. It clears itself when Rohit moves to another screen.
 */
export class ScreenBoundary extends Component<{ screen: string; children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`Screen ${this.props.screen} failed`, error, info.componentStack);
  }

  componentDidUpdate(prev: { screen: string }) {
    if (prev.screen !== this.props.screen && this.state.error) this.setState({ error: null });
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="page">
        <section className="panel screen-error" role="alert">
          <span className="screen-error-ic" aria-hidden="true">
            <Icon name="warning" size={22} weight="fill" />
          </span>
          <h2>This screen ran into a problem</h2>
          <p>Your data is safe and the rest of the app still works. Pick another screen in the sidebar, or try this one again.</p>
          <pre>{error.message}</pre>
          <div className="row gap wrap">
            <button type="button" className="primary" onClick={() => this.setState({ error: null })}>
              Try again
            </button>
            <button type="button" onClick={() => location.reload()}>
              Reload the app
            </button>
          </div>
        </section>
      </div>
    );
  }
}
