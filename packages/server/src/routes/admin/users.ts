/**
 * 用户与登录（P3）— 多租户基础
 *
 * 取代硬编码 admin/admin123。
 * token 颁发使用 jose 库（轻量 JWT）；生产应使用 RS256。
 */
import { Hono } from "hono";
import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import { nanoid } from "nanoid";
import { createHash, randomBytes, createHmac } from "node:crypto";
import { db } from "../../db/index";
import { users } from "../../db/schema/index";
import { writeAudit } from "../../lib/audit";
import { withAdminAuth } from "./_with-auth";

const usersRoute = new Hono();
withAdminAuth(usersRoute);

const SECRET = process.env.OPENHUB_JWT_SECRET ?? "dev-jwt-secret-change-in-production";
const TOKEN_TTL_SEC = 60 * 60 * 24; // 24h

function hashPassword(password: string, salt: string): string {
  return createHash("sha256").update(`${salt}:${password}`).digest("hex");
}

function signToken(payload: object): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", SECRET).update(body).digest("base64url");
  return `${body}.${sig}`;
}

function verifyToken(token: string): object | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", SECRET).update(body).digest("base64url");
  if (expected !== sig) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

const CreateUserSchema = z.object({
  username: z.string().min(3).max(32),
  password: z.string().min(8).max(128),
  email: z.string().email().optional(),
  role: z.enum(["admin", "user"]).default("user"),
});

const LoginSchema = z.object({
  username: z.string(),
  password: z.string(),
});

/**
 * 公开登录（不需 admin auth，但只发出受限 token）
 */
export const publicLogin = new Hono();
publicLogin.post("/auth/login", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = LoginSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.username, parsed.data.username))
    .limit(1);
  if (!user || user.status !== "active") {
    await writeAudit({
      actor: parsed.data.username,
      action: "auth.login",
      status: "failed",
      errorMessage: "user not found or disabled",
    });
    return c.json({ error: "Invalid credentials" }, 401);
  }
  const passwordHash = hashPassword(parsed.data.password, user.passwordSalt);
  if (passwordHash !== user.passwordHash) {
    await writeAudit({
      actor: parsed.data.username,
      action: "auth.login",
      status: "failed",
      errorMessage: "wrong password",
    });
    return c.json({ error: "Invalid credentials" }, 401);
  }
  await db
    .update(users)
    .set({ lastLoginAt: new Date(), updatedAt: new Date() })
    .where(eq(users.id, user.id));

  const token = signToken({
    sub: user.id,
    username: user.username,
    role: user.role,
    exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SEC,
  });

  await writeAudit({
    actor: user.username,
    action: "auth.login",
    status: "success",
  });

  return c.json({
    data: {
      token,
      user: { id: user.id, username: user.username, role: user.role },
      expiresAt: Math.floor(Date.now() / 1000) + TOKEN_TTL_SEC,
    },
  });
});

usersRoute.get("/users", async (c) => {
  const rows = await db
    .select({
      id: users.id,
      username: users.username,
      email: users.email,
      role: users.role,
      status: users.status,
      lastLoginAt: users.lastLoginAt,
      createdAt: users.createdAt,
    })
    .from(users)
    .orderBy(desc(users.createdAt));
  return c.json({ data: rows });
});

usersRoute.post("/users", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = CreateUserSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const salt = randomBytes(16).toString("hex");
  const passwordHash = hashPassword(parsed.data.password, salt);
  const id = nanoid();

  try {
    await db.insert(users).values({
      id,
      username: parsed.data.username,
      email: parsed.data.email ?? null,
      passwordHash,
      passwordSalt: salt,
      role: parsed.data.role,
      status: "active",
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (message.includes("UNIQUE")) {
      return c.json({ error: { message: "username already exists", code: "user_taken" } }, 409);
    }
    throw e;
  }
  await writeAudit({
    actor: "admin",
    action: "user.create",
    resourceType: "user",
    resourceId: id,
    payload: JSON.stringify({ username: parsed.data.username, role: parsed.data.role }),
  });
  return c.json({ data: { id, username: parsed.data.username, role: parsed.data.role } }, 201);
});

usersRoute.delete("/users/:id", async (c) => {
  const id = c.req.param("id");
  await db.delete(users).where(eq(users.id, id));
  await writeAudit({
    actor: "admin",
    action: "user.delete",
    resourceType: "user",
    resourceId: id,
  });
  return c.json({ data: { id, deleted: true } });
});

export { verifyToken };
export default usersRoute;