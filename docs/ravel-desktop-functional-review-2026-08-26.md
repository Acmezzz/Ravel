# Ravel 桌面端功能完善度深度审查（2026-08-26）

范围：`apps/ravel-desktop` 全部源码（electron 主进程/worker/preload 约 6800 行，renderer 约 9000 行，42 个测试文件 179 用例，4 个脚本，CI 与打包配置）。方法：多路并行代码审查 + 独立运行验证（typecheck / node --check / 全量测试 / 根 check 链），不依赖单一来源。

## 一、总体结论

**核心功能链路完整且安全设计扎实，但"完善"要打折扣：验证体系大量依赖静态断言，且存在若干已证实的功能性缺陷。**

分域评价：

| 领域 | 完善度 | 说明 |
|---|---|---|
| Agent 执行与事实层 | 高 | 切片 0+1 + 体检整改后，审批成对落盘、operation 时间线、恢复终态化、risk tier、streaming 分桶均已落地并有行为测试 |
| Electron 隔离与 IPC | 高（实现）/ 低（验证） | contextIsolation/sandbox/CSP/senderAllowed/allowlist 齐全；但验证几乎全是源码正则匹配 |
| 会话管理 | 中高 | 磁盘优先 JSONL reader、fork/clone/tree、搜索重命名删除均有；fork/clone/navigate 无真实路径测试 |
| Git 审查 | 中 | snapshot/stale token/预算有强测试；stage/unstage/commit/reject 写路径只有字符串断言 |
| 文件系统 | 中高 | 读取分页、上传冲突、路径逃逸防护有行为测试；file-watch 只有代理信号 |
| 设置与凭据 | 高 | 原子持久化、并发、加密回退、损坏备份均有真实测试（本轮修复的快捷键丢失除外） |
| 渲染器 UI | 中 | 功能面齐全（聊天/队列/审批/diff/worktree/资源中心/信任中心/palette），但存在下述 P1 状态一致性缺陷 |
| i18n | 中 | i18n 框架已建且部分 surface 迁移；ResourceCenter/FileViewer/Workbench/Header/ModelCenter 仍硬编码中文，en-US 实质不可用 |
| 测试真实性 | 弱→中 | 179 用例中约 500+ 断言是 `assert.match` 源码匹配；renderer 无任何 DOM/交互测试 |
| 打包发布 | 中 | electron-builder 配置一致（win 仅 dir 是既定决策）；release-gate 仅静态校验 manifest |

## 二、本轮审查中发现并已修复的缺陷

1. **CI 必挂**：`package.json` typecheck 脚本仍引用切片 0 已删除的 `electron/state-reader.js`。已移除并补上 `session-facts.js`。
2. **5 个 renderer 类型错误**（根 `npm run check` 不含桌面 renderer tsc，此前未暴露）：`MessageList.tsx:33` timeline 插值传 null、`ToolCard.tsx:210-211` 结构化 diff 统计联合类型字段名不一致（additions/deletions vs added/removed）、`useAppStore.ts:460` ES2022 target 下使用 `findLastIndex`、`ThemeProvider.tsx:49` MUI fontSize 类型。全部修复。
3. **快捷键持久化丢数据**：`sanitizeKeybindings` 归一化 6 个绑定，DTO 与设置界面也声明 6 个，但 `main.js` 的 `omega:updateDesktopSettings` 只持久化 commandPalette/newSession/abort——zoomIn/zoomOut/zoomReset 自定义在每次保存时被静默丢弃。已补全三个 zoom 字段。

修复后：桌面 typecheck（main+renderer）通过、179/179 测试通过、根 `npm run check` exit 0。

## 三、P1 功能性问题（2026-08-26 二次复核后的处置结果）

逐项复核后：3 项确认修复，5 项判定为审查误报（保留原始描述供追溯，括号内为复核结论）：

1. ~~前台会话切换竞态~~（**误报**：App.tsx:128 的 background 判定即 sessionId 等值护栏，切换瞬间的旧事件最终被 loadTranscript 整体替换覆盖）
2. replay 重放窗口过宽（**部分成立**：仅流中恢复路径重放且 sequence 谓词自保护；已加固 `appendMessage` 按 id 原位替换，同 id 重投递不再产生重复气泡）
3. 工具卡全局键冲突（**降级**：后台会话事件不进 upsertToolCard，loadTranscript 按会话整体替换，toolCallId 跨运行由模型保证唯一——不改）
4. ~~切换 workspace 后旧 transcript 残留~~（**误报**：switchTo 第 84 行调用 loadTranscript 替换 transcript；真实小缺陷是异步流程无异常保护导致 busy 卡死——已修，Promise.all 加 catch、三个流程加 try/finally）
5. 历史加载可见性（**误报**：磁盘加载页同步扩大 windowSize，prepend 消息在可见窗口内）
6. ~~Composer 失败态残留~~（**误报**：失败路径按 lastAgentStartAt 分流，未启动还文本回 ready，已启动保持 running 等 agent_end 收尾是正确语义）
7. 设置 onBlur 闭包竞态（**误报**：React 离散事件在 blur 处理前已提交 state；持久化丢字段问题已在§二修复）
8. ToolCard 懒加载结果不渲染（**确认，已修**：args/result 渲染条件改用 `detail ?? card` 兜底）

## 四、测试真实性缺口（审查重点结论）

当前 179 个用例中约 509 个断言是"读源码 + 正则匹配"。语义等价重构（保留函数名与调用结构）可让大量测试继续通过。具体：

- **完全静态的测试文件**：file-watch、git-refresh、trust-center、retry-recovery、default-open、history-request-coalescing、credential-restore、custom-provider-restore/UI 等。
- **零直接测试的模块**：`project-trust.js`（72 行，控制未信任项目扩展是否加载——安全相关）、`export-html.js`（XSS 转义无回归保护）、preload 真实桥接、WorkerHost 真实 utilityProcess 启动/RPC 超时/崩溃重启。
- **smoke 深度不足**：electron-smoke 只验证三条 stdout 信号 + 固定 25 秒退出；sdk-check 默认跳过 live prompt。业务链断裂时两者仍可通过。
- **Git 写路径**：snapshot token 有强测试，但 stage/unstage/commit/reject/accept 从未在临时仓库里真实验证过。
- **测试名与实现不符示例**：file-viewer.test.mjs "rejects non-regular files" 实际只匹配源码字符串。

建议优先级（发布门禁视角）：
- P0：IPC 黑盒（非法 sender/参数 → forbidden/invalid_args）、真实 WorkerHost 集成（init/RPC/超时/崩溃重启/generation 隔离）、临时 Git 仓库全生命周期、project-trust once/always/never 行为。
- P1：Agent 主流程 E2E（prompt→流事件→落盘→reload）、资源安装/启停/reload、updater 本地 HTTPS fixture、React 组件交互测试（先 Composer/MessageList/DiffViewer）。
- P2：export-html XSS 回归、事件投影 fuzz、原生窗口生命周期、a11y 键盘导航。

## 五、其他观察

- **project-trust Windows 大小写**：sessionOnly Map 用 `keyOf()` 折叠大小写，但 Pi `ProjectTrustStore.get/set` 直接收原始 cwd——若 Pi 内部不折叠，Windows 上混合大小写路径可能出现 trust 判定不一致（需读 Pi store 实现确认，标待确认）。
- **性能**：MessageList 订阅整个 messages/toolCards，每个 delta 全量 filter/map；agent_end/compaction_end 每次都拉 getState。单用户规模可接受，长会话会劣化。
- **可访问性**：FileViewer 行元素可点击但无 tabIndex/键盘角色；TreeOverlay 有 treeitem 角色但键盘处理覆盖不全；多数 aria 标签仍是硬编码中文。
- **相对时间戳**不随时间刷新，仅在 store 变更时重算。

## 六、建议路线

1. 先修第三节 P1 清单中的 1/3/4/6（状态一致性，影响日常正确性），每项配行为测试。
2. 测试体系转向：新增测试一律要求真实行为断言；存量静态测试按第四节 P0 顺序替换为集成测试。
3. 把 `typecheck:renderer` 纳入根 check 链（本次 5 个类型错误长期漏检的根因）。
