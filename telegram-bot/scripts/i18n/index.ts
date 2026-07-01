import { Device } from "scripting"
import en from "./en"
import zh from "./zh"

export function useI18n() {
  return getI18n()
}

export function getI18n(locale = Device.systemLocale) {
  return locale.startsWith("zh") ? zh : en
}

export type { I18nData } from "./en"
