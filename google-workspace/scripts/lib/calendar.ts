import {
  googleFetch, jsonBody, normalizePage, objectBody, pathId, query, requireConfirm, sendUpdates,
} from "./google-http"

type Json = Record<string, any>
const BASE = "https://www.googleapis.com/calendar/v3"

function calendarId(args: Json): string { return pathId(args.calendarId || args.id, "calendar_id") }
function eventId(args: Json): string { return pathId(args.eventId || args.id, "event_id") }
function body(args: Json): Json { return objectBody(args.body) }

function calendarListParams(args: Json) {
  return query({
    maxResults: args.maxResults,
    minAccessRole: args.minAccessRole,
    pageToken: args.pageToken,
    showDeleted: args.showDeleted,
    showHidden: args.showHidden,
  })
}
function eventListParams(args: Json) {
  return query({
    alwaysIncludeEmail: args.alwaysIncludeEmail,
    maxAttendees: args.maxAttendees,
    maxResults: args.maxResults,
    orderBy: args.orderBy,
    pageToken: args.pageToken,
    privateExtendedProperty: args.privateExtendedProperty,
    q: args.q,
    sharedExtendedProperty: args.sharedExtendedProperty,
    showDeleted: args.showDeleted,
    singleEvents: args.singleEvents,
    syncToken: args.syncToken,
    timeMax: args.timeMax,
    timeMin: args.timeMin,
    timeZone: args.timeZone,
  })
}
function eventWriteParams(args: Json, includeSendUpdates = true) {
  return query({
    conferenceDataVersion: args.conferenceDataVersion,
    maxAttendees: args.maxAttendees,
    sendUpdates: includeSendUpdates ? sendUpdates(args) : undefined,
  })
}

export async function listCalendars(args: Json) {
  return normalizePage(await googleFetch(`${BASE}/users/me/calendarList${calendarListParams(args)}`), "items")
}
export async function getCalendar(args: Json) {
  return googleFetch(`${BASE}/calendars/${calendarId(args)}`)
}
export async function createCalendar(args: Json) {
  return googleFetch(`${BASE}/calendars`, { method: "POST", body: jsonBody(body(args)) })
}
export async function updateCalendar(args: Json) {
  return googleFetch(`${BASE}/calendars/${calendarId(args)}`, { method: "PATCH", body: jsonBody(body(args)) })
}
export async function deleteCalendar(args: Json) {
  requireConfirm(args)
  return googleFetch(`${BASE}/calendars/${calendarId(args)}`, { method: "DELETE" })
}
export async function listEvents(args: Json) {
  return normalizePage(await googleFetch(`${BASE}/calendars/${calendarId(args)}/events${eventListParams(args)}`), "items")
}
export async function getEvent(args: Json) {
  return googleFetch(`${BASE}/calendars/${calendarId(args)}/events/${eventId(args)}${eventListParams(args)}`)
}
export async function createEvent(args: Json) {
  return googleFetch(`${BASE}/calendars/${calendarId(args)}/events${eventWriteParams(args)}`, { method: "POST", body: jsonBody(body(args)) })
}
export async function updateEvent(args: Json) {
  return googleFetch(`${BASE}/calendars/${calendarId(args)}/events/${eventId(args)}${eventWriteParams(args)}`, { method: "PATCH", body: jsonBody(body(args)) })
}
export async function deleteEvent(args: Json) {
  requireConfirm(args)
  return googleFetch(`${BASE}/calendars/${calendarId(args)}/events/${eventId(args)}${eventWriteParams(args)}`, { method: "DELETE" })
}
export async function freebusy(args: Json) {
  return googleFetch(`${BASE}/freeBusy`, { method: "POST", body: jsonBody(body(args)) })
}
