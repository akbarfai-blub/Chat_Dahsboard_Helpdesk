import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { MockProvider } from "../../lib/providers/mock-provider";
import { SupabaseMockNetworkStore } from "../../lib/repositories/mock-network";
import type { Database } from "../../lib/supabase/database.types";

const customerId = "10000000-0000-4000-8000-000000000001";
const serviceId = "20000000-0000-4000-8000-000000000001";
function sql(input: string) {
  return execFileSync("docker", ["exec","-i","supabase_db_Chat_Automation_Helpdesk",
    "psql","-X","-At","-v","ON_ERROR_STOP=1","-U","postgres","-d","postgres"],
  { input, encoding:"utf8", stdio:["pipe","pipe","pipe"] }).trim();
}
test("local database: scenarios, constraints, privileges and repeatable seeds", async t => {
  const command = process.platform === "win32" ? "cmd.exe" : "npx";
  const args = process.platform === "win32" ? ["/d","/s","/c","npx.cmd supabase status -o json"] : ["supabase","status","-o","json"];
  const env = JSON.parse(execFileSync(command,args,{encoding:"utf8",stdio:["ignore","pipe","pipe"]}));
  assert(["localhost","127.0.0.1"].includes(new URL(env.API_URL).hostname), "only local Supabase");
  const admin = createClient<Database>(env.API_URL, env.SERVICE_ROLE_KEY, { auth: { persistSession:false, autoRefreshToken:false } });
  const email = "network-review-"+randomUUID()+"@example.test", password = randomUUID()+"Aa1!";
  const created = await admin.auth.admin.createUser({ email, password, email_confirm:true });
  assert.equal(created.error,null);
  const userId = created.data.user!.id;
  try {
    const cookies = new Map<string,string>();
    const staff = createServerClient<Database>(env.API_URL, env.ANON_KEY, { cookies: {
      getAll: () => [...cookies].map(([name,value]) => ({name,value})),
      setAll: values => values.forEach(({name,value}) => cookies.set(name,value)),
    } });
    assert.equal((await staff.auth.signInWithPassword({email,password})).error,null);
    const baseline = await staff.from("mock_onu_status").select("observed_at")
      .eq("scenario_id","normal").eq("service_id",serviceId).single();
    assert.equal(baseline.error,null);
    const checkedAt = baseline.data!.observed_at!;
    // Evaluate persisted fixtures at their original observation time: tests do not refresh data.
    const inspect = (scenario: string, id = serviceId, customer = customerId) =>
      new MockProvider(new SupabaseMockNetworkStore(staff), scenario).check({
        serviceId:id, customerId:customer, checkedAt,
        deadlineAt:new Date(Date.now()+2000).toISOString(),
      });
    await t.test("normal and single LOS read actual service topology", async () => {
      const normal = await inspect("normal");
      assert.equal(normal.outcome,"ok"); assert.equal(normal.onu.status,"online");
      assert.equal(normal.mapping?.odpCode,"ODP-DUMMY-01");
      assert.equal(normal.areas[0].total,10); assert.equal(normal.areas[1].total,12);
      const los = await inspect("los_individual");
      assert.equal(los.onu.status,"LOS"); assert.equal(los.indicatedArea,null);
    });
    await t.test("area thresholds and low coverage use full active membership", async () => {
      const area = await inspect("los_area");
      assert.equal(area.indicatedArea?.scope,"ODP");
      assert.equal(area.areas[0].valid,8); assert.equal(area.areas[0].los,4);
      assert.equal((await inspect("low_coverage")).areas[0].state,"unknown");
    });
    await t.test("stale, unknown, absent and invalid timestamp are distinguishable", async () => {
      for (const [scenario,quality] of [
        ["stale","stale"],["unknown","unknown"],["missing_status","not_found"],
        ["future_timestamp","invalid_timestamp"],["missing_timestamp","invalid_timestamp"],
      ]) assert.equal((await inspect(scenario)).onu.quality,quality,scenario);
    });
    await t.test("independent upstream impact, stable events, recovery and new incident", async () => {
      const down = await inspect("upstream_down"), repeat = await inspect("upstream_down");
      assert.equal(down.onu.status,"online"); assert.equal(down.upstream[0].observation.status,"down");
      assert.equal(down.upstream[0].observation.eventId,repeat.upstream[0].observation.eventId);
      const recovered = await inspect("recovered"), next = await inspect("new_event");
      assert.equal(recovered.upstream[0].observation.status,"up");
      assert.equal(recovered.upstream[0].observation.eventId,down.upstream[0].observation.eventId);
      assert.notEqual(next.upstream[0].observation.eventId,down.upstream[0].observation.eventId);
      const outside = await inspect("upstream_down",
        "20000000-0000-4000-8000-000000000011","10000000-0000-4000-8000-000000000011");
      assert.deepEqual(outside.upstream,[]);
    });
    await t.test("monitoring failure does not become network outage", async () => {
      assert.equal((await inspect("provider_error")).reason,"provider_error");
      assert.equal((await inspect("timeout")).reason,"timeout");
      const partial = await inspect("onu_error_upstream_down");
      assert.equal(partial.onu.quality,"provider_error");
      assert.equal(partial.upstream[0].observation.status,"down");
      assert.equal((await inspect("upstream_error_los")).onu.status,"LOS");
    });
    await t.test("wrong customer/service or scenario does not disclose observations", async () => {
      assert.equal((await inspect("normal",serviceId,randomUUID())).reason,"not_found");
      assert.equal((await inspect("no_such_scenario")).reason,"scenario_not_found");
    });
    await t.test("seed replay preserves data and timestamps including existing identities/Auth", () => {
      const digest = () => sql(`
        select md5(string_agg(r::text,'|' order by r::text)) from (
        select to_jsonb(t) r from public.mock_network_scenarios t union all
        select to_jsonb(t) from public.mock_onu_status t union all
        select to_jsonb(t) from public.mock_upstream_status t union all
        select to_jsonb(t) from public.mock_upstream_impacts t union all
        select to_jsonb(t) from public.customers t union all
        select to_jsonb(t) from public.service_topology t union all
        select to_jsonb(t) from auth.users t) snapshot;`);
      const before = digest();
      sql(readFileSync("supabase/fixtures/network.sql","utf8"));
      assert.equal(digest(),before);
    });
    await t.test("unique, state and impact version constraints reject invalid data", () => {
      sql(`begin;
      do $$ begin
        begin
          insert into public.mock_onu_status(scenario_id,service_id,status)
          values ('normal','${serviceId}','online');
          raise exception 'duplicate accepted';
        exception when unique_violation then null; end;
        begin
          insert into public.mock_upstream_status(scenario_id,link_id,status)
          values ('normal','test-invalid-state','broken');
          raise exception 'invalid state accepted';
        exception when check_violation then null; end;
        begin
          insert into public.mock_upstream_status(scenario_id,link_id,status)
          values ('normal','test-missing-event','down');
          raise exception 'missing event accepted';
        exception when check_violation then null; end;
        begin
          insert into public.mock_upstream_impacts(scenario_id,link_id,service_id,mapping_version)
          values ('normal','MOCK-UPLINK-01','20000000-0000-4000-8000-000000000012',9999);
          raise exception 'invalid mapping accepted';
        exception when foreign_key_violation then null; end;
      end $$; rollback;`);
    });
    await t.test("all mock tables have authenticated SELECT only and no anon access", async () => {
      const anon = createClient<Database>(env.API_URL,env.ANON_KEY,{auth:{persistSession:false}});
      for (const table of ["mock_network_scenarios","mock_onu_status","mock_upstream_status","mock_upstream_impacts"] as const) {
        assert((await anon.from(table).select("*").limit(1)).error,table);
        assert.equal(sql(`select has_table_privilege('authenticated','public.${table}','SELECT')
          and not has_table_privilege('authenticated','public.${table}','INSERT,UPDATE,DELETE')
          and relrowsecurity from pg_class where oid='public.${table}'::regclass;`),"t",table);
      }
    });
    if (process.env.NETWORK_TEST_BASE_URL) {
      await t.test("staff-only HTTP endpoint, validation, envelope and no cache", async () => {
        const base = new URL(process.env.NETWORK_TEST_BASE_URL!);
        assert(["localhost","127.0.0.1"].includes(base.hostname));
        const path = "/api/network-status?customerId="+customerId+"&serviceId="+serviceId;
        const cookie = [...cookies].map(([key,value])=>key+"="+encodeURIComponent(value)).join("; ");
        const anonymous = await fetch(new URL(path,base));
        assert.equal(anonymous.status,401); assert.equal((await anonymous.json()).success,false);
        const bad = await fetch(new URL("/api/network-status?serviceId=invalid",base),{headers:{cookie}});
        assert.equal(bad.status,400);
        const valid = await fetch(new URL(path,base),{headers:{cookie}});
        assert.equal(valid.status,200); assert(valid.headers.get("cache-control")?.includes("no-store"));
        const body = await valid.json(); assert.equal(body.success,true);
        assert.equal(body.data.source,"MOCK"); assert.equal(body.error,null);
        const missing = await fetch(new URL(path+"&scenario=not_seeded",base),{headers:{cookie}});
        assert.equal(missing.status,404);
      });
    }
  } finally {
    const removed = await admin.auth.admin.deleteUser(userId);
    assert.equal(removed.error,null,"temporary Auth user cleanup");
  }
});
