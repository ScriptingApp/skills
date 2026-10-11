import {Script} from 'scripting'
import {createAuthenticationRetry} from '../auth-retry'
async function main(){let passed=0;function assert(v:any){if(!v)throw Error('auth retry contract failed')}
 let calls=0,prompts=0,updated=false;const retry=createAuthenticationRetry(async()=>{prompts++;return{username:'test',password:'fake-test-only'}});const result=await retry(async()=>({status:++calls===1?401:200}),()=>{updated=true});assert(result.status===200&&calls===2&&prompts===1&&updated);passed++
 calls=0;await retry(async()=>{calls++;return{status:401}},()=>{});assert(calls===1&&prompts===1);passed++
 let forbidden=0;const not401=createAuthenticationRetry(async()=>{forbidden++;return null});assert((await not401(async()=>({status:403}),()=>{})).status===403&&forbidden===0);passed++
 let cancelCalls=0,error:any;try{await createAuthenticationRetry(async()=>null)(async()=>{cancelCalls++;return{status:401}},()=>{})}catch(e){error=e}assert(error.code==='AUTH_CANCELLED'&&cancelCalls===1);passed++
 let refusedCalls=0,refusedPrompts=0;const refused=await createAuthenticationRetry(async()=>{refusedPrompts++;return{username:'test',password:'fake'}})(async()=>{refusedCalls++;return{status:401}},()=>{});assert(refused.status===401&&refusedCalls===2&&refusedPrompts===1);passed++
 let inline=0;await createAuthenticationRetry()(async()=>{inline++;return{status:401}},()=>{});assert(inline===1);passed++
 Script.exit({ok:true,passed,note:'Pure request retry tests; no network, real credentials or UI.401 once only,403/no callback unchanged,cancel no retry.'})}
main().catch(e=>Script.exit({ok:false,error:e.message}))
