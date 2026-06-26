import { Script } from 'scripting'
import { search, normalizeError, type SearchResponse } from './search'

async function main() {
  const params = Script.queryParameters ?? {}

  try {
    const rawQuery = params.query
    const query = typeof rawQuery === 'string' ? rawQuery : ''

    const limitParam = params.limit
    const limit =
      limitParam !== undefined && limitParam !== null && `${limitParam}`.trim().length > 0
        ? parseInt(`${limitParam}`, 10)
        : undefined

    const result: SearchResponse = await search(query, limit)
    Script.exit(JSON.stringify({ ok: true, result }))
  } catch (error) {
    Script.exit(JSON.stringify({ ok: false, error: normalizeError(error) }))
  }
}

main()
