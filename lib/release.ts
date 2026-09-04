export const EXPECTED_SCHEMA_VERSION = "20260904_merchant_beta_v4";

export const releaseInfo = {
  commitSha: process.env.NEXT_PUBLIC_BUILD_SHA || "local-unset",
  branch: process.env.NEXT_PUBLIC_BUILD_BRANCH || "local-unset",
  buildTime: process.env.NEXT_PUBLIC_BUILD_TIME || "local-unset",
  environment: process.env.NEXT_PUBLIC_APP_ENV || "local",
} as const;
