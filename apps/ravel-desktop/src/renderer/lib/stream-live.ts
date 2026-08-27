/**
 * Live streaming buffers that sit outside React. Token/thinking deltas patch
 * these maps and notify subscribers (rAF-batched). Zustand only stores the
 * bubble identity so Header/ToolCard/the message list do not re-render per token.
 *
 * Snapshot the buffer into `messages[].text` on message_end / session switch.
 */
export interface StreamLiveSnapshot {
	text: string;
	thinking: string;
}

const live = new Map<string, StreamLiveSnapshot>();
const listeners = new Set<() => void>();
let notifyHandle = 0;

function schedule(fn: () => void): number {
	if (typeof requestAnimationFrame === "function") return requestAnimationFrame(fn);
	return setTimeout(fn, 16) as unknown as number;
}

function cancel(handle: number): void {
	if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(handle);
	else clearTimeout(handle);
}

function notify(): void {
	if (notifyHandle) return;
	notifyHandle = schedule(() => {
		notifyHandle = 0;
		for (const listener of listeners) listener();
	});
}

export function getStreamLive(id: string): StreamLiveSnapshot {
	return live.get(id) ?? { text: "", thinking: "" };
}

/** Primitive snapshot lets useSyncExternalStore skip unrelated bubbles. */
export function getStreamLiveKey(id: string): string {
	const snapshot = live.get(id);
	return snapshot ? `${snapshot.text}\u0000${snapshot.thinking}` : "";
}

export function resetStreamLive(id?: string): void {
	if (id) live.delete(id);
	else live.clear();
	notify();
}

export function seedStreamLive(id: string, snapshot: Partial<StreamLiveSnapshot>): void {
	const current = live.get(id) ?? { text: "", thinking: "" };
	live.set(id, {
		text: snapshot.text ?? current.text,
		thinking: snapshot.thinking ?? current.thinking,
	});
}

export function appendStreamText(id: string, delta: string): void {
	const current = live.get(id) ?? { text: "", thinking: "" };
	current.text += delta;
	live.set(id, current);
	notify();
}

export function appendStreamThinking(id: string, delta: string): void {
	const current = live.get(id) ?? { text: "", thinking: "" };
	current.thinking += delta;
	live.set(id, current);
	notify();
}

/** Rebind a streaming buffer when the authoritative message id arrives. */
export function moveStreamLive(fromId: string, toId: string): void {
	if (fromId === toId) return;
	const snapshot = live.get(fromId);
	if (snapshot) live.set(toId, snapshot);
	live.delete(fromId);
}

export function subscribeStreamLive(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

export function cancelStreamLiveNotifications(): void {
	if (notifyHandle) {
		cancel(notifyHandle);
		notifyHandle = 0;
	}
}

export function streamLiveSize(): number {
	return live.size;
}
