import { AsyncLocalStorage } from "node:async_hooks";

const customGlobal = globalThis as unknown as { AsyncLocalStorage?: unknown };
if (typeof customGlobal.AsyncLocalStorage === "undefined") {
  customGlobal.AsyncLocalStorage = AsyncLocalStorage;
}
