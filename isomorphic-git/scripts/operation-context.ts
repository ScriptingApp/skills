export type OperationBackend = "file-manager" | "node-promises" | "auto"
export interface ResourceBudget { maxOperations?: number; maxBytesRead?: number; maxBytesWritten?: number; maxOpenFiles?: number }
export interface OperationStats { readonly startedAt:number; readonly elapsedMs:number; readonly operations:number; readonly checkpoints:number; readonly yields:number; readonly bytesRead:number; readonly bytesWritten:number; readonly openFiles:number; readonly peakOpenFiles:number; readonly backend:OperationBackend }
export interface OperationContextOptions { deadlineMs?:number; yieldEvery?:number; yieldAfterMs?:number; budget?:ResourceBudget; backend?:OperationBackend; now?:()=>number; scheduler?:()=>Promise<void> }
export interface OperationLike { checkpoint(label?:string):void; yieldIfNeeded(force?:boolean):Promise<void>; charge(read?:number, written?:number):void; enter():void; leave():void; readonly deadline:number|undefined; readonly stats:OperationStats }
export interface OperationContext { readonly operation:OperationLike; readonly stats:OperationStats; readonly deadline:number|undefined; checkpoint(label?:string):void; yieldIfNeeded(force?:boolean):Promise<void>; close():OperationStats }
function limit(code:string,message:string):any { const e:any=new Error(`${code}: ${message}`);e.code=code;return e }
function nonNegativeInt(name:string,value:any):number { if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0)throw new TypeError(`${name} must be a non-negative safe integer`);return value }
function optionalBudget(name:string,value:any):number|undefined { return value==null?undefined:nonNegativeInt(name,value) }
export function createOperationContext(options:OperationContextOptions={}):OperationContext {
  const now=options.now||(()=>Date.now()),start=now(),budget=options.budget||{}
  const deadlineValue=options.deadlineMs==null?undefined:nonNegativeInt('deadlineMs',options.deadlineMs)
  const deadline=deadlineValue===undefined||deadlineValue===0?undefined:start+deadlineValue
  const every=nonNegativeInt('yieldEvery',options.yieldEvery==null?64:options.yieldEvery)||1
  const after=nonNegativeInt('yieldAfterMs',options.yieldAfterMs==null?8:options.yieldAfterMs)
  const maxOperations=optionalBudget('maxOperations',budget.maxOperations),maxBytesRead=optionalBudget('maxBytesRead',budget.maxBytesRead),maxBytesWritten=optionalBudget('maxBytesWritten',budget.maxBytesWritten),maxOpenFiles=optionalBudget('maxOpenFiles',budget.maxOpenFiles)
  const schedule=options.scheduler||(()=>new Promise<void>(r=>setTimeout(r,0)))
  const s:any={startedAt:start,elapsedMs:0,operations:0,checkpoints:0,yields:0,bytesRead:0,bytesWritten:0,openFiles:0,peakOpenFiles:0,backend:options.backend||'auto'};let closed=false,lastYieldAt=start,operationsAtYield=0
  const check=()=>{if(deadline!==undefined&&now()>deadline)throw limit('ETIMEDOUT','git operation deadline exceeded');if(maxOperations!==undefined&&s.operations>maxOperations)throw limit('EOVERFLOW','operation budget exceeded')}
  const operation:OperationLike={
    get deadline(){return deadline},get stats(){s.elapsedMs=Math.max(0,now()-start);return {...s}},
    checkpoint(){if(closed)return;s.checkpoints++;s.operations++;operationsAtYield++;check()},
    async yieldIfNeeded(force=false){if(closed)return;check();const due=force||operationsAtYield>=every||now()-lastYieldAt>=after;if(due){s.yields++;await schedule();lastYieldAt=now();operationsAtYield=0;check()}},
    charge(read=0,written=0){const r=nonNegativeInt('bytesRead',read),w=nonNegativeInt('bytesWritten',written);s.bytesRead+=r;s.bytesWritten+=w;s.operations++;operationsAtYield++;check();if(maxBytesRead!==undefined&&s.bytesRead>maxBytesRead)throw limit('EOVERFLOW','read byte budget exceeded');if(maxBytesWritten!==undefined&&s.bytesWritten>maxBytesWritten)throw limit('EOVERFLOW','write byte budget exceeded')},
    enter(){s.openFiles++;s.peakOpenFiles=Math.max(s.peakOpenFiles,s.openFiles);try{if(maxOpenFiles!==undefined&&s.openFiles>maxOpenFiles)throw limit('EMFILE','open resource budget exceeded');check()}catch(e){s.openFiles--;throw e}},
    leave(){s.openFiles=Math.max(0,s.openFiles-1)}
  }
  return {operation,get stats(){return operation.stats},get deadline(){return deadline},checkpoint:operation.checkpoint,yieldIfNeeded:operation.yieldIfNeeded,close(){closed=true;s.elapsedMs=Math.max(0,now()-start);return {...s}}}
}
