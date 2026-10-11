import { createOperationContext, OperationContextOptions } from './operation-context'

/** Keep add's measured yield policy separate from other command defaults. */
export function createCommandOperationContext(command: string, options: OperationContextOptions = {}) {
  return createOperationContext({ ...options, yieldEvery: 64, yieldAfterMs: command === 'add' ? 32 : 8 })
}
