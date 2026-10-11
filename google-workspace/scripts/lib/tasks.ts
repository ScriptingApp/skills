import {
  googleFetch, jsonBody, normalizePage, objectBody, pathId, query, requireConfirm,
} from "./google-http"

type Json = Record<string, any>
const BASE = "https://tasks.googleapis.com/tasks/v1"

function tasklistId(args: Json): string { return pathId(args.tasklistId || args.id, "tasklist_id") }
function taskId(args: Json): string { return pathId(args.taskId || args.id, "task_id") }

function taskParams(args: Json) {
  return query({ maxResults: args.maxResults, pageToken: args.pageToken, showCompleted: args.showCompleted, showDeleted: args.showDeleted, showHidden: args.showHidden, dueMin: args.dueMin, dueMax: args.dueMax, updatedMin: args.updatedMin })
}

function taskBody(args: Json): Json {
  const input = objectBody(args.body)
  const result = { ...input }
  if (result.due !== undefined) {
    const due = String(result.due)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) throw new Error("tasks_due_must_be_date")
    // Tasks API requires RFC3339, while this interface intentionally exposes date-only due values.
    result.due = `${due}T00:00:00.000Z`
  }
  return result
}

function normalizeTask(task: Json): Json {
  if (!task || typeof task !== "object") return task
  const result = { ...task }
  if (result.due) result.due = String(result.due).slice(0, 10)
  return result
}
function normalizeTasks(data: Json) {
  const page = normalizePage(data, "items")
  return { ...page, items: page.items.map(normalizeTask) }
}

export async function listTasklists(args: Json) {
  return normalizePage(await googleFetch(`${BASE}/users/@me/lists${query({ maxResults: args.maxResults, pageToken: args.pageToken })}`), "items")
}
export async function createTasklist(args: Json) {
  return googleFetch(`${BASE}/users/@me/lists`, { method: "POST", body: jsonBody(objectBody(args.body)) })
}
export async function updateTasklist(args: Json) {
  return googleFetch(`${BASE}/users/@me/lists/${tasklistId(args)}`, { method: "PUT", body: jsonBody(objectBody(args.body)) })
}
export async function deleteTasklist(args: Json) {
  requireConfirm(args)
  return googleFetch(`${BASE}/users/@me/lists/${tasklistId(args)}`, { method: "DELETE" })
}
export async function listTasks(args: Json) {
  const data = await googleFetch(`${BASE}/lists/${tasklistId(args)}/tasks${taskParams(args)}`)
  return normalizeTasks(data)
}
export async function getTask(args: Json) {
  return normalizeTask(await googleFetch(`${BASE}/lists/${tasklistId(args)}/tasks/${taskId(args)}`))
}
export async function createTask(args: Json) {
  return normalizeTask(await googleFetch(`${BASE}/lists/${tasklistId(args)}/tasks`, { method: "POST", body: jsonBody(taskBody(args)) }))
}
export async function updateTask(args: Json) {
  return normalizeTask(await googleFetch(`${BASE}/lists/${tasklistId(args)}/tasks/${taskId(args)}`, { method: "PUT", body: jsonBody(taskBody(args)) }))
}
export async function completeTask(args: Json) {
  const existing = { status: "completed" }
  return normalizeTask(await googleFetch(`${BASE}/lists/${tasklistId(args)}/tasks/${taskId(args)}`, { method: "PATCH", body: jsonBody(existing) }))
}
export async function deleteTask(args: Json) {
  requireConfirm(args)
  return googleFetch(`${BASE}/lists/${tasklistId(args)}/tasks/${taskId(args)}`, { method: "DELETE" })
}
