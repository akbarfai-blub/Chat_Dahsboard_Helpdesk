import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../../lib/supabase/database.types";
import { SupabaseIdentitySnapshotStore } from "../../lib/repositories/sender-identities";
import { StoredIdentityLookup } from "../../lib/providers/stored-identity-lookup";
import { analyzeInboundMessage } from "../../lib/application/analyze-inbound-message";
import { SupabaseMockNetworkStore } from "../../lib/repositories/mock-network";
import { MockProvider } from "../../lib/providers/mock-provider";
import { decideTriage } from "../../lib/domain/triage-decision";
import type { TemplateKey } from "../../lib/domain/triage-contracts";

test("P1.2 composes real identity/classification and mock network snapshots without sending or claims", async t => {
  const command = process.platform === "win32" ? "cmd.exe" : "npx";
  const args = process.platform === "win32" ? ["/d","/s","/c","npx.cmd supabase status -o json"] : ["supabase","status","-o","json"];
  const env = JSON.parse(execFileSync(command,args,{encoding:"utf8",stdio:["ignore","pipe","pipe"]}));
  assert(["localhost","127.0.0.1"].includes(new URL(env.API_URL).hostname));
  const admin = createClient<Database>(env.API_URL,env.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  const email="p12-"+randomUUID()+"@example.test",password=randomUUID()+"Aa1!";
  const created=await admin.auth.admin.createUser({email,password,email_confirm:true});
  assert.equal(created.error,null); const userId=created.data.user!.id;
  try {
    const staff=createClient<Database>(env.API_URL,env.ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
    assert.equal((await staff.auth.signInWithPassword({email,password})).error,null);
    const analyzed=await analyzeInboundMessage({
      sender:{channel:"telegram",channelAccountId:"dummy-bot-upaznet",senderExternalId:"dummy-sender-001"},
      text:"wifi mati",
    },new StoredIdentityLookup(new SupabaseIdentitySnapshotStore(staff)));
    assert.equal(analyzed.identity.outcome,"resolved");
    if(analyzed.identity.outcome!=="resolved")throw new Error("Required base identity fixture is missing");
    const {customerId,serviceId}=analyzed.identity;
    const baseline=await staff.from("mock_onu_status").select("observed_at").eq("scenario_id","normal").eq("service_id",serviceId).single();
    assert.equal(baseline.error,null);const evaluatedAt=baseline.data!.observed_at!;
    const cases: [string,TemplateKey][]=[
      ["normal","ONLINE_CHECK"],["los_individual","LOS_INDIVIDUAL"],
      ["los_area","LOS_AREA"],["low_coverage","LOS_INDIVIDUAL"],
      ["upstream_down","NETWORK_DISRUPTION"],["stale","GENERIC"],["unknown","GENERIC"],
      ["missing_status","GENERIC"],["future_timestamp","GENERIC"],["missing_timestamp","GENERIC"],
      ["provider_error","GENERIC"],["timeout","GENERIC"],
      ["onu_error_upstream_down","NETWORK_DISRUPTION"],["upstream_error_los","LOS_INDIVIDUAL"],
      ["recovered","ONLINE_CHECK"],["new_event","NETWORK_DISRUPTION"],
    ];
    for(const [scenario,expected]of cases){
      await t.test(scenario+" chooses "+expected,async()=>{
        const provider=new MockProvider(new SupabaseMockNetworkStore(staff),scenario);
        const network=await provider.check({customerId,serviceId,checkedAt:evaluatedAt,
          deadlineAt:new Date(Date.now()+2000).toISOString()});
        for(const mode of ["SHADOW","LOS_AND_GENERIC","FULL"] as const){
          const result=decideTriage({...analyzed,network,evaluatedAt,mode});
          assert.equal(result.candidateTemplateKey,expected);
          assert.equal(result.effectiveTemplateKey,expected==="ONLINE_CHECK"&&mode==="LOS_AND_GENERIC"?"GENERIC":expected);
          assert.equal(result.automation.disposition,mode==="SHADOW"?"blocked":"pending_delivery_checks");
          assert.equal(result.dispatchAuthorized,false);
        }
      });
    }
    await t.test("unknown sender still gets generic and cannot reuse another customer's network evidence",async()=>{
      const unknown=await analyzeInboundMessage({
        sender:{channel:"telegram",channelAccountId:"dummy-bot-upaznet",senderExternalId:"dummy-sender-unknown"},
        text:"internet lemot",
      },new StoredIdentityLookup(new SupabaseIdentitySnapshotStore(staff)));
      assert.equal(unknown.identity.outcome,"manual");
      const result=decideTriage({...unknown,network:null,evaluatedAt,mode:"FULL"});
      assert.equal(result.candidateTemplateKey,"GENERIC");assert.deepEqual(result.evidence,[]);
    });
  }finally{
    assert.equal((await admin.auth.admin.deleteUser(userId)).error,null,"temporary Auth cleanup");
  }
});
