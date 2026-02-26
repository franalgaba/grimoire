import { describe, expect, test } from "bun:test";
import { resolveSetupRpcUrl, selectWalletProvisionMode } from "./setup.js";

describe("setup command helpers", () => {
  test("resolveSetupRpcUrl prefers explicit value", () => {
    const rpc = resolveSetupRpcUrl(1, "https://explicit.example", {
      RPC_URL_1: "https://chain.example",
      RPC_URL: "https://default.example",
    });
    expect(rpc).toBe("https://explicit.example");
  });

  test("resolveSetupRpcUrl uses chain-specific env before default", () => {
    const rpc = resolveSetupRpcUrl(8453, undefined, {
      RPC_URL_8453: "https://base.example",
      RPC_URL: "https://default.example",
    });
    expect(rpc).toBe("https://base.example");
  });

  test("resolveSetupRpcUrl falls back to RPC_URL", () => {
    const rpc = resolveSetupRpcUrl(137, undefined, {
      RPC_URL: "https://default.example",
    });
    expect(rpc).toBe("https://default.example");
  });

  test("selectWalletProvisionMode picks existing keystore first", () => {
    const mode = selectWalletProvisionMode({
      keystoreExists: true,
      importKey: true,
      keyEnvValue: "0x123",
    });
    expect(mode).toBe("existing_keystore");
  });

  test("selectWalletProvisionMode imports env key when keystore is missing", () => {
    const mode = selectWalletProvisionMode({
      keystoreExists: false,
      importKey: false,
      keyEnvValue: "0xabc",
    });
    expect(mode).toBe("import_env_key");
  });

  test("selectWalletProvisionMode generates wallet when no key source exists", () => {
    const mode = selectWalletProvisionMode({
      keystoreExists: false,
      importKey: false,
      keyEnvValue: "",
    });
    expect(mode).toBe("generate");
  });
});
