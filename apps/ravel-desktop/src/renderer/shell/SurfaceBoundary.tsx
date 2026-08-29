import * as React from "react";
import { Button } from "../ui/Button";

interface SurfaceBoundaryState {
  error: Error | null;
}

/**
 * 防止单个面板抛错把整个工作台变成白屏。
 *
 * IDE 终端曾在 effect 里调用只在 secure context 下存在的 UUID API（打包后走
 * `app://`，该 API 为 undefined），React 因此卸载整棵树，窗口只剩白底且无法恢复。
 * 这里把崩溃收敛成一张可恢复的卡片；`resetKey` 绑定当前 surface，切换模式即重挂载，
 * 用户无需重启应用。
 */
export class SurfaceBoundary extends React.Component<
  { children: React.ReactNode; resetKey: string },
  SurfaceBoundaryState
> {
  override state: SurfaceBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): SurfaceBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // 保留一条可检索的日志，便于在打包环境里定位（DevTools 仍可用）。
    console.error(`[ravel:surface ${this.props.resetKey}]`, error, info.componentStack);
  }

  override componentDidUpdate(prev: { resetKey: string }): void {
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  override render(): React.ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <section className="ravel-surface-error" role="alert" aria-label="界面渲染失败">
        <span className="ravel-surface-error-mark" aria-hidden="true">!</span>
        <p className="ravel-surface-error-title">该模式渲染失败</p>
        <p className="ravel-surface-error-detail">{error.message}</p>
        <Button size="sm" variant="quiet" onClick={() => this.setState({ error: null })}>
          重试
        </Button>
      </section>
    );
  }
}
