/**
 * Keystore tests
 */

import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Wallet as EthersWallet } from "ethers";
import {
  KeyLoadError,
  createWallet,
  createWalletFromConfig,
  getAddressFromConfig,
  loadPrivateKey,
} from "./keystore.js";

// Test private key (DO NOT use in production!)
const TEST_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const TEST_ADDRESS = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

describe("Keystore", () => {
  describe("loadPrivateKey", () => {
    test("loads raw private key with 0x prefix", () => {
      const key = loadPrivateKey({ type: "raw", source: TEST_PRIVATE_KEY });
      expect(key).toBe(TEST_PRIVATE_KEY);
    });

    test("loads raw private key without 0x prefix", () => {
      const keyWithoutPrefix = TEST_PRIVATE_KEY.slice(2);
      const key = loadPrivateKey({ type: "raw", source: keyWithoutPrefix });
      expect(key).toBe(TEST_PRIVATE_KEY);
    });

    test("throws on invalid key length", () => {
      expect(() => loadPrivateKey({ type: "raw", source: "0x1234" })).toThrow(KeyLoadError);
    });

    test("throws on invalid hex characters", () => {
      const invalidKey = `0x${"g".repeat(64)}`;
      expect(() => loadPrivateKey({ type: "raw", source: invalidKey })).toThrow(KeyLoadError);
    });

    test("loads key from environment variable", () => {
      const originalEnv = process.env.TEST_KEY;
      process.env.TEST_KEY = TEST_PRIVATE_KEY;

      try {
        const key = loadPrivateKey({ type: "env", source: "TEST_KEY" });
        expect(key).toBe(TEST_PRIVATE_KEY);
      } finally {
        if (originalEnv !== undefined) {
          process.env.TEST_KEY = originalEnv;
        } else {
          process.env.TEST_KEY = undefined;
        }
      }
    });

    test("throws when env variable not set", () => {
      expect(() => loadPrivateKey({ type: "env", source: "NONEXISTENT_KEY_12345" })).toThrow(
        KeyLoadError
      );
    });

    test("loads key from keystore JSON", async () => {
      const password = "test-password";
      const wallet = new EthersWallet(TEST_PRIVATE_KEY);
      const keystoreJson = await wallet.encrypt(password);

      const key = loadPrivateKey({
        type: "keystore",
        source: keystoreJson,
        password,
      });

      expect(key).toBe(TEST_PRIVATE_KEY);
    });

    test("loads key from keystore file", async () => {
      const password = "test-password";
      const wallet = new EthersWallet(TEST_PRIVATE_KEY);
      const keystoreJson = await wallet.encrypt(password);

      const dir = mkdtempSync(join(tmpdir(), "grimoire-keystore-"));
      const filePath = join(dir, "keystore.json");
      writeFileSync(filePath, keystoreJson, "utf-8");

      try {
        const key = loadPrivateKey({
          type: "keystore",
          source: filePath,
          password,
        });

        expect(key).toBe(TEST_PRIVATE_KEY);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    test("throws when keystore password missing", async () => {
      const password = "test-password";
      const wallet = new EthersWallet(TEST_PRIVATE_KEY);
      const keystoreJson = await wallet.encrypt(password);

      expect(() =>
        loadPrivateKey({
          type: "keystore",
          source: keystoreJson,
        })
      ).toThrow(KeyLoadError);
    });

    test("loads key from keystore env var", async () => {
      const password = "test-password";
      const wallet = new EthersWallet(TEST_PRIVATE_KEY);
      const keystoreJson = await wallet.encrypt(password);

      const originalEnv = process.env.TEST_KEYSTORE;
      process.env.TEST_KEYSTORE = keystoreJson;

      try {
        const key = loadPrivateKey({
          type: "keystore",
          source: "TEST_KEYSTORE",
          password,
        });

        expect(key).toBe(TEST_PRIVATE_KEY);
      } finally {
        if (originalEnv !== undefined) {
          process.env.TEST_KEYSTORE = originalEnv;
        } else {
          process.env.TEST_KEYSTORE = undefined;
        }
      }
    });

    test("throws on mnemonic load via loadPrivateKey", () => {
      expect(() =>
        loadPrivateKey({
          type: "mnemonic",
          source: "test test test test test test test test test test test junk",
        })
      ).toThrow(KeyLoadError);
    });
  });

  describe("createWallet", () => {
    test("creates wallet from private key", () => {
      const wallet = createWallet(TEST_PRIVATE_KEY, 1, "https://eth.llamarpc.com");

      expect(wallet.address.toLowerCase()).toBe(TEST_ADDRESS.toLowerCase());
      expect(wallet.chainId).toBe(1);
    });

    test("throws on unsupported chain", () => {
      expect(() => createWallet(TEST_PRIVATE_KEY, 99999, "https://fake.rpc")).toThrow();
    });
  });

  describe("createWalletFromConfig", () => {
    test("creates wallet from raw key config", () => {
      const wallet = createWalletFromConfig(
        { type: "raw", source: TEST_PRIVATE_KEY },
        1,
        "https://eth.llamarpc.com"
      );

      expect(wallet.address.toLowerCase()).toBe(TEST_ADDRESS.toLowerCase());
    });

    test("creates wallet from env key config", () => {
      const originalEnv = process.env.TEST_KEY;
      process.env.TEST_KEY = TEST_PRIVATE_KEY;

      try {
        const wallet = createWalletFromConfig(
          { type: "env", source: "TEST_KEY" },
          1,
          "https://eth.llamarpc.com"
        );

        expect(wallet.address.toLowerCase()).toBe(TEST_ADDRESS.toLowerCase());
      } finally {
        if (originalEnv !== undefined) {
          process.env.TEST_KEY = originalEnv;
        } else {
          process.env.TEST_KEY = undefined;
        }
      }
    });

    test("creates wallet from keystore config", async () => {
      const password = "test-password";
      const wallet = new EthersWallet(TEST_PRIVATE_KEY);
      const keystoreJson = await wallet.encrypt(password);

      const created = createWalletFromConfig(
        { type: "keystore", source: keystoreJson, password },
        1,
        "https://eth.llamarpc.com"
      );

      expect(created.address.toLowerCase()).toBe(TEST_ADDRESS.toLowerCase());
    });

    test("creates wallet from mnemonic config", () => {
      const mnemonic = "test test test test test test test test test test test junk";
      const wallet = createWalletFromConfig(
        { type: "mnemonic", source: mnemonic },
        1,
        "https://eth.llamarpc.com"
      );

      expect(wallet.address).toBeDefined();
    });
  });

  describe("getAddressFromConfig", () => {
    test("gets address from raw key config", () => {
      const address = getAddressFromConfig({ type: "raw", source: TEST_PRIVATE_KEY });
      expect(address.toLowerCase()).toBe(TEST_ADDRESS.toLowerCase());
    });

    test("gets address from env key config", () => {
      const originalEnv = process.env.TEST_KEY;
      process.env.TEST_KEY = TEST_PRIVATE_KEY;

      try {
        const address = getAddressFromConfig({ type: "env", source: "TEST_KEY" });
        expect(address.toLowerCase()).toBe(TEST_ADDRESS.toLowerCase());
      } finally {
        if (originalEnv !== undefined) {
          process.env.TEST_KEY = originalEnv;
        } else {
          process.env.TEST_KEY = undefined;
        }
      }
    });

    test("gets address from keystore config", async () => {
      const password = "test-password";
      const wallet = new EthersWallet(TEST_PRIVATE_KEY);
      const keystoreJson = await wallet.encrypt(password);

      const address = getAddressFromConfig({
        type: "keystore",
        source: keystoreJson,
        password,
      });

      expect(address.toLowerCase()).toBe(TEST_ADDRESS.toLowerCase());
    });

    test("gets address from mnemonic config", () => {
      const address = getAddressFromConfig({
        type: "mnemonic",
        source: "test test test test test test test test test test test junk",
      });

      expect(address).toMatch(/^0x[a-fA-F0-9]{40}$/);
    });
  });
});
