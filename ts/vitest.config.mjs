// Runs the vitest quickstart in vitest/ against the built package (npm test builds it first), exactly as a user's
// project imports it: "x402-conformance-svm/testing".
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["vitest/**/*.spec.ts"], testTimeout: 120_000 } });
