/** Display helper for a SHA-256 hex (skill version id). */
export function shortContentHash(hash: string | undefined, length = 12): string {
	if (!hash) return "";
	return hash.slice(0, length);
}
