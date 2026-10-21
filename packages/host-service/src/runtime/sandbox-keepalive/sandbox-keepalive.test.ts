import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { startSandboxKeepalive } from "./sandbox-keepalive";

const timing = { intervalMs: 30, retryBaseMs: 2 };
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let store: EventEmitter;
let answers: number[];
let calls: number;
let stop: () => void;

function start(fetchImpl?: typeof fetch) {
	stop = startSandboxKeepalive({
		apiUrl: "https://api.test",
		workspaceId: "ws",
		hostSecret: "secret",
		store: store as never,
		timing,
		fetch:
			fetchImpl ??
			((async () => {
				calls += 1;
				return new Response(null, { status: answers.shift() ?? 200 });
			}) as unknown as typeof fetch),
	});
}

beforeEach(() => {
	store = new EventEmitter();
	answers = [];
	calls = 0;
});

afterEach(() => stop());

describe("startSandboxKeepalive", () => {
	test("pings on activity at most once per interval, and not at all when idle", async () => {
		start();
		await sleep(40);
		expect(calls).toBe(0);

		store.emit("activity");
		await sleep(5);
		expect(calls).toBe(1);

		for (let i = 0; i < 5; i++) store.emit("activity");
		await sleep(5);
		expect(calls).toBe(1);
		await sleep(75);
		expect(calls).toBe(2);

		await sleep(80);
		expect(calls).toBe(2);
	});

	test("retries a server error, but not a refusal", async () => {
		answers = [503, 503, 200];
		start();
		store.emit("activity");
		await sleep(30);
		expect(calls).toBe(3);

		stop();
		calls = 0;
		answers = [401];
		start();
		store.emit("activity");
		await sleep(80);
		expect(calls).toBe(1);
	});

	test("stops retrying once stopped, even mid-request", async () => {
		let release: (response: Response) => void = () => {};
		start((() => {
			calls += 1;
			return new Promise<Response>((resolve) => {
				release = resolve;
			});
		}) as unknown as typeof fetch);
		store.emit("activity");
		await sleep(5);
		stop();
		release(new Response(null, { status: 503 }));
		await sleep(40);
		expect(calls).toBe(1);
	});
});
