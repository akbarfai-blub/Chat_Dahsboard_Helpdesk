import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../../lib/supabase/database.types";
import { SupabaseIdentitySnapshotStore } from "../../lib/repositories/sender-identities";
import { StoredIdentityLookup } from "../../lib/providers/stored-identity-lookup";
import { analyzeInboundMessage } from "../../lib/application/analyze-inbound-message";

test("P1.1 reads real identity snapshots with staff RLS and cleans up temporary fixtures", async t => {
  const command = process.platform === "win32" ? "cmd.exe" : "npx";
  const args = process.platform === "win32" ? ["/d","/s","/c","npx.cmd supabase status -o json"] : ["supabase","status","-o","json"];
  const output = execFileSync(command, args, { encoding:"utf8", stdio:["ignore","pipe","pipe"] });
  const env = JSON.parse(output);
  assert(["localhost","127.0.0.1"].includes(new URL(env.API_URL).hostname), "local Supabase only");
  const admin = createClient<Database>(env.API_URL,env.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  const tag = "p11-"+randomUUID(), password = randomUUID()+"Aa1!", email = tag+"@example.test";
  const customers = Array.from({length:6},(_,n)=>({
    id:randomUUID(), customer_code:tag+"-customer-"+n, display_name:"P1.1 Test "+n,
    status:n===3?"inactive":"active",
  }));
  const services = [0,1,3,4,5,5].map((customer,n)=>({
    id:randomUUID(), customer_id:customers[customer].id, service_code:tag+"-service-"+n,
    status:n===3 || n===5 ? "inactive":"active",
  }));
  const baseSender = { channel:"telegram", channelAccountId:tag+"-bot-a", senderExternalId:"000123" };
  const identities = [
    { channel:"telegram", account:tag+"-bot-a", sender:"000123", customer:0 },
    { channel:"telegram", account:tag+"-bot-b", sender:"000123", customer:1 },
    { channel:"whatsapp", account:tag+"-bot-a", sender:"000123", customer:1 },
    { channel:"telegram", account:tag+"-bot-a", sender:"unknown", customer:null },
    { channel:"telegram", account:tag+"-bot-a", sender:"no-service", customer:2 },
    { channel:"telegram", account:tag+"-bot-a", sender:"inactive-customer", customer:3 },
    { channel:"telegram", account:tag+"-bot-a", sender:"inactive-service", customer:4 },
    { channel:"telegram", account:tag+"-bot-a", sender:"multiple-services", customer:5 },
  ].map(row=>({
    id:randomUUID(), channel:row.channel, channel_account_id:row.account, sender_external_id:row.sender,
    customer_id:row.customer===null?null:customers[row.customer].id,
    verification_status:row.customer===null?"unverified":"verified",
    verified_at:row.customer===null?null:new Date(Date.now()-1000).toISOString(),
  }));
  let authUserId: string | undefined;
  try {
    const created = await admin.auth.admin.createUser({email,password,email_confirm:true});
    assert.equal(created.error,null); authUserId=created.data.user!.id;
    assert.equal((await admin.from("customers").insert(customers)).error,null);
    assert.equal((await admin.from("services").insert(services)).error,null);
    assert.equal((await admin.from("channel_identities").insert(identities)).error,null);
    const staff = createClient<Database>(env.API_URL,env.ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
    assert.equal((await staff.auth.signInWithPassword({email,password})).error,null);
    const lookup = new StoredIdentityLookup(new SupabaseIdentitySnapshotStore(staff));

    await t.test("verified identity resolves the actual customer and service",async()=>{
      const result=await lookup.resolve(baseSender);
      assert.equal(result.outcome,"resolved");
      assert.equal(result.identityId,identities[0].id);
      assert.equal(result.customerId,customers[0].id);
      assert.equal(result.serviceId,services[0].id);
    });
    await t.test("same sender ID on another account or channel stays isolated",async()=>{
      const account=await lookup.resolve({...baseSender,channelAccountId:tag+"-bot-b"});
      const channel=await lookup.resolve({...baseSender,channel:"whatsapp"});
      assert.equal(account.customerId,customers[1].id); assert.equal(channel.customerId,customers[1].id);
      assert.notEqual(account.identityId,channel.identityId);
      assert.equal((await lookup.resolve({...baseSender,senderExternalId:"123"})).reason,"no_match");
    });
    await t.test("unverified and unknown senders retain distinct reasons",async()=>{
      const unverified=await lookup.resolve({...baseSender,senderExternalId:"unknown"});
      assert.equal(unverified.reason,"unverified"); assert.equal(unverified.identityId,identities[3].id);
      assert.equal(unverified.customerId,null); assert.equal(unverified.serviceId,null);
      assert.equal((await lookup.resolve({...baseSender,senderExternalId:"not-present"})).reason,"no_match");
    });
    await t.test("no service, inactive records, and multiple services need manual review",async()=>{
      for(const [sender,reason]of[
        ["no-service","no_service"],["inactive-customer","inactive_customer"],
        ["inactive-service","inactive_service"],["multiple-services","multiple_services"],
      ]){
        const result=await lookup.resolve({...baseSender,senderExternalId:sender});
        assert.equal(result.reason,reason,sender); assert.equal(result.customerId,null);
        assert.equal(result.serviceId,null);
      }
    });
    await t.test("typed customer code never overrides sender mapping or triggers a database write",async()=>{
      const text=customers[1].customer_code+" wifi mati";
      const result=await analyzeInboundMessage({sender:baseSender,text},lookup);
      assert.equal(result.identity.customerId,customers[0].id);
      assert.equal(result.classification.category,"connection_complaint");
      const unknown=await analyzeInboundMessage({sender:{...baseSender,senderExternalId:"not-present"},text},lookup);
      assert.equal(unknown.identity.reason,"no_match");
      const after=await admin.from("channel_identities").select("id",{count:"exact",head:true})
        .eq("channel_account_id",baseSender.channelAccountId);
      assert.equal(after.error,null); assert.equal(after.count,7);
    });
    await t.test("anonymous lookup returns lookup_error instead of pretending sender was not found",async()=>{
      const anon=createClient<Database>(env.API_URL,env.ANON_KEY,{auth:{persistSession:false}});
      const result=await new StoredIdentityLookup(new SupabaseIdentitySnapshotStore(anon)).resolve(baseSender);
      assert.equal(result.reason,"lookup_error"); assert.equal(result.customerId,null);
    });
    await t.test("database uniqueness rejects a duplicate identity within the same account/channel",async()=>{
      const duplicate=await admin.from("channel_identities").insert({...identities[0],id:randomUUID()});
      assert.equal(duplicate.error?.code,"23505");
    });
  }finally{
    // Only test-owned UUIDs are deleted; existing customer data and staff accounts stay intact.
    const cleanupErrors=[];
    for(const result of [
      await admin.from("channel_identities").delete().in("id",identities.map(row=>row.id)),
      await admin.from("services").delete().in("id",services.map(row=>row.id)),
      await admin.from("customers").delete().in("id",customers.map(row=>row.id)),
    ])if(result.error)cleanupErrors.push(result.error.code);
    if(authUserId){
      const removed=await admin.auth.admin.deleteUser(authUserId);
      if(removed.error)cleanupErrors.push("auth_cleanup_failed");
    }
    assert.deepEqual(cleanupErrors,[],"temporary fixture cleanup");
  }
});
