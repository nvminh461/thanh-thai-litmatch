import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import { getCollection } from "./mongo";
import { timingSafeEqualString } from "./crypto-utils";

const scrypt = promisify(scryptCallback);
const ADMIN_CREDENTIALS_KEY = "adminCredentials";

type AdminCredentialsDocument = {
  key: string;
  value: {
    username: string;
    passwordHash: string;
    salt: string;
  };
  createdAt: Date;
  updatedAt: Date;
};

function getBootstrapAdminCredentials() {
  const username = process.env.ADMIN_USERNAME?.trim();
  const password = process.env.ADMIN_PASSWORD?.trim();

  if (!username || !password) {
    throw new Error("ADMIN_USERNAME and ADMIN_PASSWORD are required");
  }

  return { username, password };
}

async function hashPassword(password: string, salt: string) {
  const derivedKey = (await scrypt(password, salt, 64)) as Buffer;

  return derivedKey.toString("hex");
}

export async function ensureAdminCredentials() {
  const collection =
    await getCollection<AdminCredentialsDocument>("app_settings");
  const existingCredentials = await collection.findOne({
    key: ADMIN_CREDENTIALS_KEY,
  });

  if (existingCredentials?.value) {
    return existingCredentials.value;
  }

  const { username, password } = getBootstrapAdminCredentials();

  return resetAdminCredentials(username, password, false);
}

export async function verifyAdminCredentials(
  username: string,
  password: string,
) {
  const credentials = await ensureAdminCredentials();

  if (username.trim() !== credentials.username) {
    return false;
  }

  const passwordHash = await hashPassword(password, credentials.salt);
  return timingSafeEqualString(passwordHash, credentials.passwordHash);
}

export async function resetAdminCredentials(
  username: string,
  password: string,
  overwrite = true,
) {
  const normalizedUsername = username.trim();
  const normalizedPassword = password.trim();

  if (!normalizedUsername || !normalizedPassword) {
    throw new Error("Username and password are required");
  }

  const collection =
    await getCollection<AdminCredentialsDocument>("app_settings");
  const salt = randomBytes(16).toString("hex");
  const passwordHash = await hashPassword(normalizedPassword, salt);
  const now = new Date();
  const credentials = {
    username: normalizedUsername,
    passwordHash,
    salt,
  };

  await collection.updateOne(
    { key: ADMIN_CREDENTIALS_KEY },
    overwrite
      ? {
          $set: {
            value: credentials,
            updatedAt: now,
          },
          $setOnInsert: {
            key: ADMIN_CREDENTIALS_KEY,
            createdAt: now,
          },
        }
      : {
          $setOnInsert: {
            key: ADMIN_CREDENTIALS_KEY,
            value: credentials,
            createdAt: now,
            updatedAt: now,
          },
        },
    { upsert: true },
  );

  const savedCredentials = await collection.findOne({
    key: ADMIN_CREDENTIALS_KEY,
  });

  return savedCredentials?.value ?? credentials;
}
