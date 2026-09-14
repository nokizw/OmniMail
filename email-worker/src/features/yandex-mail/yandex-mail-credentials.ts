import type { Env } from '../../app/types'
import { mailCredentialCipher } from '../../shared/security/mail-credentials'

const credentials = mailCredentialCipher('YANDEX_MAIL_CREDENTIALS_KEY', 'Yandex Mail')

export const yandexMailCredentialsReady = credentials.ready
export const encryptYandexMailCredential = credentials.encrypt
export const decryptYandexMailCredential = credentials.decrypt

export function yandexMailImapEnabled(env: Env): boolean {
  return env.YANDEX_MAIL_IMAP_ENABLED === 'true' && yandexMailCredentialsReady(env)
}
