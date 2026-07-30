import "@testing-library/jest-dom/vitest";

Object.defineProperty(globalThis.URL, "createObjectURL", {
  value: () => "blob:test-preview",
});
Object.defineProperty(globalThis.URL, "revokeObjectURL", {
  value: () => undefined,
});
Object.defineProperty(globalThis.crypto, "randomUUID", {
  value: () => "test-id",
});

