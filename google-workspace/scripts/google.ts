import { Script } from "scripting"
import {
  createCalendar, createEvent, deleteCalendar, deleteEvent, freebusy, getCalendar, getEvent,
  listCalendars, listEvents, updateCalendar, updateEvent,
} from "./lib/calendar"
import {
  completeTask, createTask, createTasklist, deleteTask, deleteTasklist, getTask,
  listTasks, listTasklists, updateTask, updateTasklist,
} from "./lib/tasks"
import { getStoredCredential } from "./lib/auth"

type Args = Record<string, any>

function status() {
  const credential = getStoredCredential()
  return { authorized: Boolean(credential?.oauthToken), hasRefreshToken: Boolean(credential?.oauthRefreshToken) }
}

async function main() {
  const params = Script.queryParameters as Args
  const service = String(params.service || "")
  const operation = String(params.operation || "")
  if (!["calendar", "tasks"].includes(service)) throw new Error("service_must_be_calendar_or_tasks")
  if (!operation) throw new Error("missing_operation")

  let result: any
  if (service === "calendar") {
    switch (operation) {
      case "list-calendars": result = await listCalendars(params); break
      case "get-calendar": result = await getCalendar(params); break
      case "create-calendar": result = await createCalendar(params); break
      case "update-calendar": result = await updateCalendar(params); break
      case "delete-calendar": result = await deleteCalendar(params); break
      case "list-events": result = await listEvents(params); break
      case "get-event": result = await getEvent(params); break
      case "create-event": result = await createEvent(params); break
      case "update-event": result = await updateEvent(params); break
      case "delete-event": result = await deleteEvent(params); break
      case "freebusy": result = await freebusy(params); break
      default: throw new Error(`unknown_calendar_operation:${operation}`)
    }
  } else {
    switch (operation) {
      case "list-tasklists": result = await listTasklists(params); break
      case "create-tasklist": result = await createTasklist(params); break
      case "update-tasklist": result = await updateTasklist(params); break
      case "delete-tasklist": result = await deleteTasklist(params); break
      case "list-tasks": result = await listTasks(params); break
      case "get-task": result = await getTask(params); break
      case "create-task": result = await createTask(params); break
      case "update-task": result = await updateTask(params); break
      case "complete-task": result = await completeTask(params); break
      case "delete-task": result = await deleteTask(params); break
      default: throw new Error(`unknown_tasks_operation:${operation}`)
    }
  }
  Script.exit({ ok: true, service, operation, result })
}

main().catch((error) => {
  Script.exit({ ok: false, error: error instanceof Error ? error.message : String(error), status: status() })
})
