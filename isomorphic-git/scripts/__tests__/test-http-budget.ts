import { Script } from 'scripting'
import { createHttpTransport, redactRemoteUrl } from '../remote-commands'
async function main() {
 let passed = 0
 const check = (v: boolean, s: string) => { if(!v) throw new Error(s); passed++ }
 check(redactRemoteUrl('https://user:secret@host/repo?token=secret') === 'https://[redacted]@host/repo', 'redaction')
 let rejected = false
 try { createHttpTransport(undefined, undefined, {maxTransferBytes:-1}) } catch { rejected=true }
 check(rejected, 'negative budget')
 const original = (globalThis as any).fetch
 let calls = 0
 ;(globalThis as any).fetch = async () => { calls++; return { status:200, headers:{get:()=>null,forEach:()=>{}}, data: async()=>({toArrayBuffer:()=>new Uint8Array([1,2,3]).buffer}) } }
 try {
  const http = createHttpTransport(undefined, undefined, {maxTransferBytes:2})
  rejected=false
  try { await http.request({url:'https://mock.invalid/repo',body:(async function*(){yield new Uint8Array([1,2,3])})()}) } catch(e:any){rejected=e.code==='TRANSFER_LIMIT'}
  check(rejected && calls===0, 'request limit before fetch')
  rejected=false
  try { await http.request({url:'https://mock.invalid/repo'}) } catch(e:any){rejected=e.code==='TRANSFER_LIMIT'}
  check(rejected, 'response post-read budget not swallowed')
  const response= await createHttpTransport(undefined,undefined,{maxTransferBytes:10}).request({url:'https://mock.invalid/repo'})
  let bytes:any
  for await (const chunk of response.body) bytes=chunk
  check(bytes.length===3 && bytes[2]===3,'response bytes')
 } finally { (globalThis as any).fetch=original }
 Script.exit({ok:true,passed})
}
main().catch((e:any)=>Script.exit({ok:false,error:e.message}))
