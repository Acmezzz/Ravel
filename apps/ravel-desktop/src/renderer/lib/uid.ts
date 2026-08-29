/**
 * 生成非安全上下文也能用的唯一 id。
 *
 * 打包后的 Renderer 通过自定义 `app://` 协议加载，Chromium 不把它当作 secure
 * context，因此 `crypto.randomUUID` 在该环境下是 undefined，而开发运行时却存在。
 * 任何需要会话/追踪 id 的地方都走这里，不要直接调用 `crypto.randomUUID`。
 */
export function createId(prefix = "id"): string {
  const webcrypto = typeof globalThis.crypto !== "undefined" ? globalThis.crypto : undefined;
  if (webcrypto && typeof webcrypto.randomUUID === "function") {
    return `${prefix}-${webcrypto.randomUUID()}`;
  }

  const bytes = new Uint8Array(16);
  if (webcrypto && typeof webcrypto.getRandomValues === "function") {
    webcrypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }

  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return `${prefix}-${hex}`;
}
