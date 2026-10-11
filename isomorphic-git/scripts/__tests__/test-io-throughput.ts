import { Script } from 'scripting'
import { createOperationContext } from '../operation-context'
import { createFS } from '../fs-adapter'
async function main(){const base=FileManager.temporaryDirectory+'/git-io-probe-'+Date.now();const result:any={};try{await FileManager.createDirectory(base,true);await FileManager.writeAsString(base+'/file','x');for(const backend of ['promises','sync','file-manager'] as const){const context=createOperationContext();const fs=createFS(base+'/git',base,{backend,operation:context.operation});let start=Date.now();for(let i=0;i<100;i++)await fs.lstat(base+'/file');result[backend]={elapsedMs:Date.now()-start,stats:context.close()}}}catch(e:any){result.error=e.message}finally{await FileManager.remove(base).catch(()=>{})}Script.exit(result)}main()
