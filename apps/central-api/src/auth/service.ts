import { createHash, randomBytes } from "node:crypto";
import argon2 from "argon2";
import jwt from "jsonwebtoken";
import type { PrismaClient, User } from "@prisma/client";

const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

const JWT_SECRET_MINIMO = 32;

export function requireJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET não definido no ambiente");
  }
  if (secret.length < JWT_SECRET_MINIMO) {
    throw new Error(`JWT_SECRET precisa ter pelo menos ${JWT_SECRET_MINIMO} caracteres`);
  }
  return secret;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function emitirTokens(prisma: PrismaClient, user: User): Promise<TokenPair> {
  const accessToken = jwt.sign({ role: user.role }, requireJwtSecret(), {
    subject: user.id,
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
  });

  const refreshToken = randomBytes(32).toString("hex");
  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(refreshToken),
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
    },
  });

  return { accessToken, refreshToken };
}

const HASH_DUMMY =
  "$argon2id$v=19$m=65536,p=4,t=3$GpRPK1yiOkvfB9oPq4/FDA$Es2wB8Lw7lkTcbESWB/VShfMi2fzKhhqDC3Y74QfMV0";

export async function login(
  prisma: PrismaClient,
  username: string,
  password: string,
): Promise<TokenPair | null> {
  const user = await prisma.user.findUnique({ where: { username } });
  if (!user || !user.active) {
    await argon2.verify(HASH_DUMMY, password).catch(() => false);
    return null;
  }
  if (!(await argon2.verify(user.passwordHash, password))) {
    return null;
  }
  return emitirTokens(prisma, user);
}

export async function refresh(prisma: PrismaClient, refreshToken: string): Promise<TokenPair | null> {
  const tokenHash = hashToken(refreshToken);
  const salvo = await prisma.refreshToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });
  if (!salvo || salvo.revokedAt !== null || salvo.expiresAt < new Date() || !salvo.user.active) {
    return null;
  }

  const revoked = await prisma.refreshToken.updateMany({
    where: { id: salvo.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (revoked.count === 0) {
    return null;
  }

  return emitirTokens(prisma, salvo.user);
}

export async function logout(prisma: PrismaClient, refreshToken: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { tokenHash: hashToken(refreshToken), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
