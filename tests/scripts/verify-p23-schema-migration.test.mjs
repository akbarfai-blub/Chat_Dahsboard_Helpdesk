import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runVerification, validateUrl } from "../../scripts/verify-p23-schema-migration.mjs";

describe("URL Validation (validateUrl)", () => {
  it("rejects malformed URL", () => {
    assert.throws(() => validateUrl("not-a-url"), /Invalid database URL format/);
  });

  it("rejects protocols other than postgres/postgresql", () => {
    assert.throws(() => validateUrl("mysql://localhost/db"), /Invalid database protocol/);
    assert.throws(() => validateUrl("http://localhost/db"), /Invalid database protocol/);
  });

  it("rejects non-local hosts", () => {
    assert.throws(() => validateUrl("postgresql://10.0.0.1/db"), /Invalid database host/);
    assert.throws(() => validateUrl("postgresql://example.com/db"), /Invalid database host/);
  });

  it("rejects query parameters (?host=10.0.0.1, options, etc)", () => {
    assert.throws(() => validateUrl("postgresql://localhost/db?host=10.0.0.1"), /query parameters are not allowed/);
    assert.throws(() => validateUrl("postgresql://localhost/db?options=-c"), /query parameters are not allowed/);
    assert.throws(() => validateUrl("postgresql://localhost/db?%6f%70%74%69%6f%6e%73=-c"), /query parameters are not allowed/); // encoded 'options'
  });

  it("accepts valid local loopback URLs without query params", () => {
    assert.doesNotThrow(() => validateUrl("postgresql://localhost/db"));
    assert.doesNotThrow(() => validateUrl("postgresql://127.0.0.1/db"));
    assert.doesNotThrow(() => validateUrl("postgres://[::1]/db"));
  });

  it("does not leak password in validation errors", () => {
    let err = null;
    try {
      validateUrl("postgresql://user:SuperSecretPassword123@example.com/db");
    } catch (e) {
      err = e;
    }
    assert.ok(err, "Should throw error");
    assert.ok(!err.message.includes("SuperSecretPassword123"), "Error message should not leak password");
  });
});

describe("Database lifecycle and cleanup (runVerification)", () => {
  function createEnvDeps(overrides = {}) {
    const events = [];
    let poolInstances = [];
    class MockPool {
      constructor(config) {
        this.config = config;
        poolInstances.push(this);
        this.isClosed = false;
        events.push(`pool_created:${config.connectionString}`);
      }
      async query(sql, params) {
        events.push(`query:${sql.substring(0, 50).trim()}`);
        if (overrides.onQuery) {
          await overrides.onQuery(sql, params);
        }
      }
      async end() {
        this.isClosed = true;
        events.push(`pool_end`);
        if (overrides.onEnd) {
          await overrides.onEnd();
        }
      }
    }
    return {
      Pool: MockPool,
      getMigrationsDir: () => "/mock/dir",
      readDir: () => ["20260929200000_mock.sql"],
      readFile: () => "select 1;",
      extractSnapshot: async () => ({
        conversationsColumns: [],
        conversationsConstraints: [],
        messagesConversationColumn: [],
        messagesConversationConstraints: [],
        indexes: [],
        rlsStatus: [],
        policies: [],
        grants: [],
        migrations: []
      }),
      events,
      poolInstances,
      ...overrides
    };
  }

  it("uses different database names for different executions", async () => {
    const deps1 = createEnvDeps();
    await runVerification("postgresql://localhost/db", deps1);
    const dbName1 = deps1.events.find(e => e.startsWith("query:create database")).split('"')[1];

    const deps2 = createEnvDeps();
    await runVerification("postgresql://localhost/db", deps2);
    const dbName2 = deps2.events.find(e => e.startsWith("query:create database")).split('"')[1];

    assert.notEqual(dbName1, dbName2, "Database names must be unique");
  });

  it("does not run DROP DATABASE if CREATE DATABASE fails", async () => {
    const deps = createEnvDeps({
      onQuery: async (sql) => {
        if (sql.startsWith("create database")) throw new Error("Create failed");
      }
    });

    await assert.rejects(() => runVerification("postgresql://localhost/db", deps), /Create failed/);

    const hasDrop = deps.events.some(e => e.includes("drop database"));
    assert.equal(hasDrop, false, "Should not drop database if create failed");
  });

  it("does not run DROP DATABASE before CREATE DATABASE", async () => {
    const deps = createEnvDeps();
    await runVerification("postgresql://localhost/db", deps);
    
    const createIdx = deps.events.findIndex(e => e.startsWith("query:create database"));
    const dropIdx = deps.events.findIndex(e => e.startsWith("query:drop database"));
    assert.ok(createIdx > -1, "CREATE DATABASE should occur");
    assert.ok(dropIdx > createIdx, "DROP DATABASE should occur after CREATE DATABASE");
    
    const preCreateDrops = deps.events.slice(0, createIdx).some(e => e.includes("drop database"));
    assert.equal(preCreateDrops, false, "No DROP DATABASE before CREATE DATABASE");
  });

  it("successful verification: temporary connection closed before DROP, cleanup finishes", async () => {
    const deps = createEnvDeps();
    await runVerification("postgresql://localhost/db", deps);
    
    const dropIdx = deps.events.findIndex(e => e.startsWith("query:drop database"));
    const poolEnds = deps.events.reduce((acc, curr, idx) => {
      if (curr === "pool_end") acc.push(idx);
      return acc;
    }, []);
    
    assert.ok(poolEnds.length > 0 && poolEnds[0] < dropIdx, "freshPool.end() should occur before DROP DATABASE");
    assert.ok(poolEnds[1] > dropIdx, "adminPool.end() should occur after DROP DATABASE");
  });

  it("controlled failure after CREATE: cleanup is still attempted, returns nonzero error", async () => {
    const deps = createEnvDeps({
      onQuery: async (sql) => {
        if (sql.includes("auth.users")) throw new Error("Migration failed");
      }
    });

    await assert.rejects(() => runVerification("postgresql://localhost/db", deps), /Migration failed/);
    
    const hasDrop = deps.events.some(e => e.includes("drop database"));
    assert.ok(hasDrop, "Cleanup should be attempted even if verification fails");
  });

  it("verification succeeds but DROP fails: nonzero error and database name reported", async () => {
    const deps = createEnvDeps({
      onQuery: async (sql) => {
        if (sql.startsWith("drop database")) throw new Error("Drop failed");
      }
    });

    let err = null;
    try {
      await runVerification("postgresql://localhost/db", deps);
    } catch (e) { err = e; }
    
    assert.ok(err, "Should throw error if cleanup fails");
    assert.match(err.message, /Failed to teardown database/);
    assert.ok(err.dbName && err.dbName.startsWith("p23_verify_"), "Should report remaining database name");
  });

  it("verification fails AND DROP fails: both errors reported, nonzero", async () => {
    const deps = createEnvDeps({
      onQuery: async (sql) => {
        if (sql.includes("auth.users")) throw new Error("Main failed");
        if (sql.startsWith("drop database")) throw new Error("Drop failed");
      }
    });

    let err = null;
    try {
      await runVerification("postgresql://localhost/db", deps);
    } catch (e) { err = e; }
    
    assert.ok(err, "Should throw error");
    assert.match(err.message, /Verification failed and cleanup also failed/);
    assert.match(err.mainError.message, /Main failed/);
    assert.match(err.cleanupError.message, /Failed to teardown database/);
    assert.ok(err.dbName.startsWith("p23_verify_"));
  });

  it("validation failure does not create pool", async () => {
    const deps = createEnvDeps();
    let err = null;
    try {
      await runVerification("postgresql://10.0.0.1/db", deps);
    } catch (e) { err = e; }
    
    assert.ok(err);
    assert.ok(err.isValidationError);
    assert.equal(deps.poolInstances.length, 0, "No pool should be created on validation failure");
  });
});
