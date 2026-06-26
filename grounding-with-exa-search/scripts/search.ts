import { fetch, Response } from 'scripting'

interface Result {
  type: string
  text: string
}

interface MCPEventPayload {
  jsonrpc?: string
  id?: number | string
  result?: {
    content?: Array<{
      type?: string
      text?: string
      [key: string]: unknown
    }>
  }
  error?: {
    code?: number
    message?: string
    data?: unknown
  }
}

// ===== Error types =====
export class SearchValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SearchValidationError'
  }
}

export class SearchNetworkError extends Error {
  constructor(
    message: string,
    public originalError?: Error
  ) {
    super(message)
    this.name = 'SearchNetworkError'
  }
}

export class SearchAPIError extends Error {
  constructor(
    message: string,
    public status: number,
    public errorDetails?: string
  ) {
    super(message)
    this.name = 'SearchAPIError'
  }
}

export class SearchParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SearchParseError'
  }
}

export class SearchResultError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SearchResultError'
  }
}

// ===== Response type =====
export interface SearchResponse {
  result: Result[]
  query: string
  timestamp: number
  limit: number
}

function buildExaMcpUrl(): string {
  const base = 'https://mcp.exa.ai/mcp'
  const key = Storage.get('EXA_API_KEY') as string | undefined

  if (!key || typeof key !== 'string' || key.trim().length === 0) {
    Storage.set('EXA_API_KEY', '')
    console.warn(
      'Exa API key is not set. You can set the EXA_API_KEY in storage. Proceeding without an API key may lead to rate limiting.'
    )
    return base
  }

  return `${base}?exaApiKey=${encodeURIComponent(key.trim())}`
}

function parseSSEData(raw: string): string[] {
  const chunks = raw.split(/\r?\n\r?\n/)
  const payloads: string[] = []

  for (const chunk of chunks) {
    const trimmed = chunk.trim()
    if (trimmed.length === 0) continue

    let eventName = ''
    const dataLines: string[] = []

    for (const line of chunk.split(/\r?\n/)) {
      if (line.startsWith('event:')) {
        eventName = line.slice(6).trim()
        continue
      }
      if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trimStart())
      }
    }

    if (dataLines.length === 0) continue
    if (eventName !== '' && eventName !== 'message') continue
    payloads.push(dataLines.join('\n'))
  }

  return payloads
}

export async function search(query: string, limit: number = 5): Promise<SearchResponse> {
  // Input validation
  if (!query || query.trim().length === 0) {
    throw new SearchValidationError('Search query cannot be empty. Please provide a valid search query.')
  }

  const timestamp = Date.now()

  // Send request
  let response: Response
  try {
    response = await fetch(buildExaMcpUrl(), {
      method: 'POST',
      headers: {
        'sec-ch-ua-platform': '"macOS"',
        'sec-ch-ua': '"Not=A?Brand";v="24", "Chromium";v="140"',
        'sec-ch-ua-mobile': '?0',
        'x-title': 'Cherry Studio',
        'user-agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) CherryStudio/1.7.17 Chrome/140.0.7339.249 Electron/38.7.0 Safari/537.36',
        accept: 'application/json, text/event-stream',
        'http-referer': 'https://cherry-ai.com',
        'Content-Type': 'application/json',
        'sec-fetch-site': 'cross-site',
        'sec-fetch-mode': 'cors',
        'sec-fetch-dest': 'empty',
        'accept-encoding': 'gzip, deflate, br, zstd',
        'accept-language': 'zh-CN',
        priority: 'u=1, i',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'web_search_exa',
          arguments: {
            query: `today is ${new Date().toISOString().split('T')[0]} \r\n ${query}`,
            type: 'auto',
            numResults: limit,
            livecrawl: 'fallback',
          },
        },
      }),
    })
  } catch (error) {
    throw new SearchNetworkError(
      `Failed to connect to search service. Network error occurred while searching for: "${query}". ${error instanceof Error ? error.message : 'Unknown error'}`,
      error instanceof Error ? error : undefined
    )
  }

  // Check response status
  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unable to read error response')
    throw new SearchAPIError(
      `Search request failed with status ${response.status}. Query: "${query}". Error details: ${errorText}`,
      response.status,
      errorText
    )
  }

  // Parse SSE response
  const rawText = await response.text()
  if (!rawText || rawText.trim().length === 0) {
    throw new SearchParseError(`Received empty response from Exa MCP. Query: "${query}"`)
  }

  const payloads = parseSSEData(rawText)
  if (payloads.length === 0) {
    throw new SearchParseError(`Failed to parse SSE response from Exa MCP. Query: "${query}"`)
  }

  const result: Result[] = []

  for (const payload of payloads) {
    if (payload === '[DONE]') continue

    let data: MCPEventPayload
    try {
      data = JSON.parse(payload) as MCPEventPayload
    } catch {
      continue
    }

    if (data.error) {
      throw new SearchAPIError(
        `Exa MCP returned an error for query: "${query}". ${data.error.message ?? 'Unknown MCP error'}`,
        response.status,
        typeof data.error.data === 'string' ? data.error.data : JSON.stringify(data.error.data ?? '')
      )
    }

    const content = data.result?.content
    if (!Array.isArray(content)) continue

    for (const item of content) {
      if (!item || typeof item !== 'object') continue
      if (typeof item.text !== 'string' || item.text.trim().length === 0) {
        continue
      }

      result.push({
        type: typeof item.type === 'string' ? item.type : 'text',
        text: item.text,
      })
    }
  }

  // Result validation
  if (!Array.isArray(result)) {
    throw new SearchResultError(
      `Invalid search result format. Expected array content but received ${typeof result} for query: "${query}"`
    )
  }

  if (result.length === 0) {
    throw new SearchResultError(`Search returned empty content. No meaningful results found for query: "${query}"`)
  }

  return {
    result,
    query,
    timestamp,
    limit,
  }
}

export function normalizeError(error: unknown): {
  type: string
  message: string
  status?: number
  details?: string
} {
  if (error instanceof SearchValidationError) {
    return { type: 'validation', message: error.message }
  }
  if (error instanceof SearchNetworkError) {
    return { type: 'network', message: error.message }
  }
  if (error instanceof SearchAPIError) {
    return {
      type: 'api',
      message: error.message,
      status: error.status,
      details: error.errorDetails,
    }
  }
  if (error instanceof SearchParseError) {
    return { type: 'parse', message: error.message }
  }
  if (error instanceof SearchResultError) {
    return { type: 'result', message: error.message }
  }
  const fallback = error instanceof Error ? error.message : 'Unknown error'
  return { type: 'unknown', message: fallback }
}
