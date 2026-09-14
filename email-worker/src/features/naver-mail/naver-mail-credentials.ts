import type { Env } from '../../app/types'
import { mailCredentialCipher } from '../../shared/security/mail-credentials'

const credentials = mailCredentialCipher('NAVER_MAIL_CREDENTIALS_KEY', 'NAVER Mail')

export const naverMailCredentialsReady = credentials.ready
export const encryptNaverMailCredential = credentials.encrypt
export const decryptNaverMailCredential = credentials.decrypt

export function naverMailImapEnabled(env: Env): boolean {
  return env.NAVER_MAIL_IMAP_ENABLED === 'true' && naverMailCredentialsReady(env)
}
