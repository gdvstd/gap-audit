"use server";

import { revalidatePath } from "next/cache";
import { getMemory } from "@/lib/runtime/container";
import { confirmFinding } from "@/lib/review/confirm";
import { dismissFinding } from "@/lib/review/dismiss";
import { convertFindingToEval } from "@/lib/review/convert";
import { allSeedArtifacts } from "@/lib/seeds/index";
import type { AuditArtifact } from "@/lib/contracts/audit-artifact";

export async function confirmAction(finding_id: string): Promise<void> {
  const memory = await getMemory();
  await confirmFinding({ finding_id, memory });
  revalidatePath(`/findings/${finding_id}`);
  revalidatePath("/findings");
}

export async function dismissAction(finding_id: string): Promise<void> {
  const memory = await getMemory();
  await dismissFinding({ finding_id, memory });
  revalidatePath(`/findings/${finding_id}`);
  revalidatePath("/findings");
}

export async function convertToEvalAction(finding_id: string): Promise<void> {
  const memory = await getMemory();
  const artifactsById = new Map<string, AuditArtifact>(
    allSeedArtifacts.map((a) => [a.task_id, a])
  );
  await convertFindingToEval({ finding_id, memory, artifactsById });
  revalidatePath(`/findings/${finding_id}`);
  revalidatePath("/findings");
  revalidatePath("/evals");
}
