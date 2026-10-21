import { db } from "@superset/db/client";
import { cloudWorkspaces } from "@superset/db/schema";
import { eq } from "drizzle-orm";
import { isSandboxHostSecret } from "./access";
import { topUpSandboxSession } from "./vercel";

export type KeepSandboxAliveOutcome =
	| "extended"
	| "not-running"
	| "not-ready"
	| "unauthorized";

export async function keepSandboxAlive(
	args: { workspaceId: string; presentedSecret: string },
	topUp: (
		providerSandboxId: string,
	) => Promise<Date | null> = topUpSandboxSession,
): Promise<KeepSandboxAliveOutcome> {
	if (!(await isSandboxHostSecret(args.workspaceId, args.presentedSecret))) {
		return "unauthorized";
	}
	const row = await db.query.cloudWorkspaces.findFirst({
		where: eq(cloudWorkspaces.id, args.workspaceId),
		columns: { providerSandboxId: true, status: true },
	});
	if (row?.status !== "ready") return "not-ready";
	return (await topUp(row.providerSandboxId)) ? "extended" : "not-running";
}
