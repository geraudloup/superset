import type { TerminalAgentStore } from "../../terminal-agents/store";

export interface SandboxKeepaliveTiming {
	/** The box stops between one session timeout and this much longer after its agent's last activity. */
	intervalMs: number;
	retryBaseMs: number;
}

const DEFAULT_TIMING: SandboxKeepaliveTiming = {
	intervalMs: 15 * 60_000,
	retryBaseMs: 30_000,
};

/**
 * Asks the API for more session time while the box's agents are active. The
 * API tops the session up to a full timeout, so the box stops a timeout after
 * the last activity, whether or not anyone has the workspace open.
 */
export function startSandboxKeepalive(args: {
	apiUrl: string;
	workspaceId: string;
	hostSecret: string;
	store: Pick<TerminalAgentStore, "on" | "off">;
	timing?: Partial<SandboxKeepaliveTiming>;
	fetch?: typeof fetch;
}): () => void {
	const timing = { ...DEFAULT_TIMING, ...args.timing };
	const post = args.fetch ?? fetch;
	let nextAt = 0;
	let failures = 0;
	let active = false;
	let inFlight = false;
	let stopped = false;
	let timer: ReturnType<typeof setTimeout> | null = null;

	const schedule = () => {
		if (timer || inFlight || !active || stopped) return;
		timer = setTimeout(() => void ping(), Math.max(0, nextAt - Date.now()));
		timer.unref?.();
	};

	const ping = async () => {
		timer = null;
		active = false;
		inFlight = true;
		try {
			const response = await post(
				`${args.apiUrl}/api/cloud-workspaces/${args.workspaceId}/keepalive`,
				{
					method: "POST",
					headers: { authorization: `Bearer ${args.hostSecret}` },
					signal: AbortSignal.timeout(10_000),
				},
			);
			if (response.status >= 500) {
				throw new Error(`answered ${response.status}`);
			}
			// A refusal will not change on retry; the next activity asks again.
			if (!response.ok) {
				console.warn(`[sandbox-keepalive] refused: ${response.status}`);
			}
			failures = 0;
			nextAt = Date.now() + timing.intervalMs;
		} catch (error) {
			console.warn(
				"[sandbox-keepalive] failed:",
				error instanceof Error ? error.message : error,
			);
			active = true;
			failures += 1;
			const backoff = Math.min(
				timing.intervalMs,
				timing.retryBaseMs * 2 ** (failures - 1),
			);
			nextAt = Date.now() + backoff * (0.5 + Math.random() / 2);
		} finally {
			inFlight = false;
			schedule();
		}
	};

	const onActivity = () => {
		active = true;
		schedule();
	};

	args.store.on("activity", onActivity);
	return () => {
		stopped = true;
		args.store.off("activity", onActivity);
		if (timer) clearTimeout(timer);
	};
}
