import { useTranslation } from 'react-i18next'
import { errMsg, knownErrorKey } from './errors'

/** Returns a function turning any thrown value into "friendly sentence (raw server message)" in the current language. */
export function useFriendlyError() {
  const { t } = useTranslation('admin')
  return (e: unknown) => {
    const raw = errMsg(e)
    const key = knownErrorKey(raw)
    return key ? `${t(key)} (${raw})` : raw
  }
}
