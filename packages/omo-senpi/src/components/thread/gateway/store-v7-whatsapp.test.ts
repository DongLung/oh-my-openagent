import { Database } from "bun:sqlite"
import { afterEach, expect, test } from "bun:test"

import { gatewayDatabasePath } from "./paths"
import { GATEWAY_MIGRATIONS } from "./schema"
import { createGatewayHarness, type GatewayHarness } from "./testing/harness"

let harness: GatewayHarness | undefined
afterEach(async () => { await harness?.dispose(); harness = undefined })

const BINDINGS_V6_CHECK = "platform IN ('discord', 'telegram', 'slack', 'notion', 'feishu', 'herdr', 'custom')"

test("#given a store migrated from v6 with a live binding #when v7 rebuilds the table #then the row and indexes survive and whatsapp binds", async () => {
  const h = (harness = createGatewayHarness())
  const initial = h.store()
  await initial.identity()
  await initial.dispose()

  const path = gatewayDatabasePath(h.agentDir)
  const db = new Database(path)
  const v6 = GATEWAY_MIGRATIONS.length - 1
  db.exec("PRAGMA foreign_keys = OFF")
  db.exec(`CREATE TABLE bindings_keep AS SELECT * FROM bindings`)
  db.exec(`DROP TABLE bindings`)
  db.exec(`CREATE TABLE bindings (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      binding_id TEXT NOT NULL UNIQUE,
      schema_version INTEGER NOT NULL DEFAULT 1,
      revision INTEGER NOT NULL CHECK (revision >= 1),
      status TEXT NOT NULL CHECK (status IN ('active', 'detached', 'expired')),
      platform TEXT NOT NULL CHECK (${BINDINGS_V6_CHECK}),
      account_id TEXT NOT NULL,
      chat_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      root_message_id TEXT,
      progress_message_id TEXT,
      session_realm_id TEXT NOT NULL,
      session_durable_id TEXT NOT NULL,
      direction_inbound INTEGER NOT NULL CHECK (direction_inbound IN (0, 1)),
      direction_outbound INTEGER NOT NULL CHECK (direction_outbound IN (0, 1)),
      inbound_mode TEXT NOT NULL CHECK (inbound_mode IN ('auto', 'follow_up')),
      outbound_events TEXT NOT NULL,
      policy_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      lease_started_at TEXT NOT NULL,
      ttl_seconds INTEGER,
      expires_at TEXT,
      CHECK (direction_inbound = 1 OR direction_outbound = 1)
    )`)
  db.exec(`INSERT INTO bindings SELECT * FROM bindings_keep`)
  db.exec(`DROP TABLE bindings_keep`)
  db.exec("CREATE UNIQUE INDEX bindings_one_active_thread ON bindings (platform, account_id, chat_id, thread_id) WHERE status = 'active'")
  db.exec("CREATE INDEX bindings_session ON bindings (session_durable_id, status)")
  db.exec(`INSERT INTO bindings (binding_id, revision, status, platform, account_id, chat_id, thread_id, session_realm_id, session_durable_id, direction_inbound, direction_outbound, inbound_mode, outbound_events, policy_id, created_at, updated_at, lease_started_at)
    VALUES ('bnd-keep', 1, 'active', 'slack', 'T1', 'C1', 't1', 'realm-1', 'S1', 1, 1, 'auto', '[]', 'default', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`)
  db.exec(`PRAGMA user_version = ${v6}`)
  db.close()

  const migrated = h.store()
  await migrated.identity()
  const check = new Database(path)
  try {
    expect(check.query("PRAGMA user_version").get()).toEqual({ user_version: GATEWAY_MIGRATIONS.length })
    expect(check.query("SELECT binding_id, platform, account_id FROM bindings").all()).toEqual([{ binding_id: "bnd-keep", platform: "slack", account_id: "T1" }])
    expect(check.query("SELECT name FROM sqlite_master WHERE type='index' AND name IN ('bindings_one_active_thread','bindings_session') ORDER BY name").all()).toEqual([
      { name: "bindings_one_active_thread" },
      { name: "bindings_session" },
    ])
    check.exec("INSERT INTO bindings (binding_id, revision, status, platform, account_id, chat_id, thread_id, session_realm_id, session_durable_id, direction_inbound, direction_outbound, inbound_mode, outbound_events, policy_id, created_at, updated_at, lease_started_at) VALUES ('bnd-wa', 1, 'active', 'whatsapp', 'wa1', 'c1', 't1', 'realm-1', 'S2', 1, 1, 'auto', '[]', 'default', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')")
  } finally { check.close() }
  await migrated.dispose()
})
