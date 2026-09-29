import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHash,
} from "node:crypto";
export const sessionToken = () => randomBytes(32).toString("hex");
export const tokenHash = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export function hashPassword(password: string): string {
  if (password.length < 12 || password.length > 256)
    throw new Error("Setup password must have 12 to 256 characters");
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}
const dummyHash = hashPassword(
  "Unused-fixture-" + randomBytes(24).toString("hex"),
);
export function verifyPassword(password: string, encoded = dummyHash): boolean {
  const [salt, hash] = encoded.split(":");
  if (!/^[a-f0-9]{32}$/.test(salt) || !/^[a-f0-9]{128}$/.test(hash))
    return false;
  return timingSafeEqual(
    scryptSync(password, salt, 64),
    Buffer.from(hash, "hex"),
  );
}
