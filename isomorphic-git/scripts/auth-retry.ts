/** Retry only the rejected HTTP request, never the complete Git mutation. */
export function createAuthenticationRetry(reconfigure?:()=>Promise<{username:string;password:string}|null>){
 let prompted=false
 return async function request<T extends {status:number}>(send:()=>Promise<T>,update:(auth:{username:string;password:string})=>void):Promise<T>{
  const first=await send()
  if(first.status!==401||!reconfigure||prompted)return first
  prompted=true
  const auth=await reconfigure()
  if(!auth){const e:any=new Error('Authentication reconfiguration cancelled');e.code='AUTH_CANCELLED';throw e}
  update(auth)
  return send()
 }
}
