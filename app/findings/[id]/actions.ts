"use server";

import { revalidatePath } from "next/cache";
import { getMemory } from "@/lib/runtime/container";
import { confirmFinding } from "@/lib/review/confirm";
import { dismissFinding } from "@/lib/review/dismiss";

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

