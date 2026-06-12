export interface GitAuthor {
  name: string
  email: string
}

export interface GitAuth {
  username: string
  password: string
}

export interface GitCommand {
  command: string
  dir?: string
  name?: string
  filepath?: string
  message?: string
  author?: GitAuthor
  depth?: number
  ref?: string
  checkout?: boolean
  refA?: string
  refB?: string
  op?: string
  refIdx?: number
  url?: string
  remote?: string
  force?: boolean
  tag?: string
  oid?: string
  lightweight?: boolean
  singleBranch?: boolean
  noCheckout?: boolean
  auth?: GitAuth
  maxFiles?: number
  summaryOnly?: boolean
}
