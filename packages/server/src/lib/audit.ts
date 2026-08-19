import { randomUUID } from "node:crypto";
import { db } from "../db/index";
import { auditLog } from "../db/schema/index";

/**
 * 写入一条审计日志
 *
 * 不抛错：审计失败不应阻塞业务。最坏情况是日志丢失。
 */
export interface AuditInput {
  actor: string;
  action: string;
  resourceType?: string;
  resourceId?: string;
  payload?: string;
  ip?: string;
  userAgent?: string;
  status?: "success" | "failed";
  errorMessage?: string;
}

export async function writeAudit(input: AuditInput): Promise<void> {
  try {
    await db.insert(auditLog).values({
      id: randomUUID(),
      actor: input.actor,
      action: input.action,
      resourceType: input.resourceType ?? null,
      resourceId: input.resourceId ?? null,
      payload: input.payload ?? null,
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
      status: input.status ?? "success",
      errorMessage: input.errorMessage ?? null,
    });
  } catch (e) {
    console.error("[audit] write failed:", e);
  }
}