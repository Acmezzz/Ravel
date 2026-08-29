/**
 * 任务五：Chat Surface 的 Composer 外壳。
 *
 * 复用 components/chat/Composer（含 PlanReview / GoalBar / 输入历史 / @补全 /
 * 附件 / steer / abort / 队列召回），仅提供表面内稳定的 DOM 外壳标识。
 */
import * as React from "react";
import { Composer } from "../../components/chat/Composer";

export function ChatComposer(): React.ReactElement {
  return <Composer />;
}