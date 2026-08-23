import { readFileSync, writeFileSync } from 'node:fs'

const required = [
  'SUPER_ADMIN_EMAIL',
  'D1_DATABASE_ID',
  'D1_DATABASE_NAME',
  'MAIL_BUCKET',
  'BACKUP_BUCKET',
]

const missing = required.filter((name) => !process.env[name]?.trim())
if (missing.length) {
  throw new Error(`Missing production binding env: ${missing.join(', ')}`)
}

const path = 'wrangler.jsonc'
const config = JSON.parse(readFileSync(path, 'utf8'))

config.keep_vars = true
config.vars = {
  ...(config.vars || {}),
  SUPER_ADMIN_EMAIL: process.env.SUPER_ADMIN_EMAIL.trim(),
  COOKIE_SECURE: 'true',
}

const database = (config.d1_databases || []).find((item) => item.binding === 'DB')
if (!database) throw new Error('wrangler.jsonc is missing the DB D1 binding')
database.database_name = process.env.D1_DATABASE_NAME.trim()
database.database_id = process.env.D1_DATABASE_ID.trim()

const mailBucket = (config.r2_buckets || []).find((item) => item.binding === 'MAIL_BUCKET')
if (!mailBucket) throw new Error('wrangler.jsonc is missing the MAIL_BUCKET R2 binding')
mailBucket.bucket_name = process.env.MAIL_BUCKET.trim()

const backupBucket = (config.r2_buckets || []).find((item) => item.binding === 'BACKUP_BUCKET')
if (!backupBucket) throw new Error('wrangler.jsonc is missing the BACKUP_BUCKET R2 binding')
backupBucket.bucket_name = process.env.BACKUP_BUCKET.trim()

writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`)
console.log('Applied production D1, R2, and SUPER_ADMIN_EMAIL bindings for CI deploy.')
