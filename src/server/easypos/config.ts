import { EasyPosClientError } from "./types";

const DEFAULT_API_BASE_URL = "https://api.easypos.vn";
const DEFAULT_APP_ORIGIN = "https://app.easypos.vn";
const DEFAULT_TAX_AUTHORITY_PREFIX = "M2-26-RVWOC";
const DEFAULT_WEB_VERSION = "0.0.2";
const DEFAULT_TIMEOUT_MS = 10000;

function readEnv(name: string) {
  return process.env[name]?.trim() ?? "";
}

function readBooleanEnv(name: string) {
  const value = readEnv(name).toLowerCase();

  return value === "1" || value === "true" || value === "yes";
}

function readPositiveIntegerEnv(name: string, fallback: number) {
  const value = Number(readEnv(name));

  return Number.isInteger(value) && value > 0 ? value : fallback;
}

export function isEasyPosEnabled() {
  return readBooleanEnv("EASYPOS_ENABLED");
}

export function getEasyPosConfig() {
  const enabled = isEasyPosEnabled();
  const apiBaseUrl = readEnv("EASYPOS_API_BASE_URL") || DEFAULT_API_BASE_URL;
  const appOrigin = readEnv("EASYPOS_APP_ORIGIN") || DEFAULT_APP_ORIGIN;
  const username = readEnv("EASYPOS_USERNAME");
  const password = readEnv("EASYPOS_PASSWORD");
  const deviceId = readEnv("EASYPOS_DEVICE_ID");
  const taxAuthorityPrefix =
    readEnv("EASYPOS_TAX_AUTHORITY_PREFIX") || DEFAULT_TAX_AUTHORITY_PREFIX;
  const webVersion = readEnv("EASYPOS_WEB_VERSION") || DEFAULT_WEB_VERSION;
  const timeoutMs = readPositiveIntegerEnv(
    "EASYPOS_TIMEOUT_MS",
    DEFAULT_TIMEOUT_MS,
  );

  if (!enabled) {
    throw new EasyPosClientError("EasyPos chưa được bật.");
  }

  if (!username || !password || !deviceId || !apiBaseUrl || !appOrigin) {
    throw new EasyPosClientError("Thiếu cấu hình EasyPos.");
  }

  return {
    apiBaseUrl: apiBaseUrl.replace(/\/+$/, ""),
    appOrigin: appOrigin.replace(/\/+$/, ""),
    username,
    password,
    deviceId,
    taxAuthorityPrefix,
    webVersion,
    timeoutMs,
  };
}
