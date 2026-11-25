// node scripts/qa-check.mjs <email> <password> : prints what a QA account stored in the cloud
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
const [email, password] = process.argv.slice(2)
const env = Object.fromEntries(readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n').filter(l => l.includes('=') && !l.startsWith('#')).map(l => l.split('=')))
const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } })
const { error } = await sb.auth.signInWithPassword({ email, password })
if (error) { console.log('sign-in failed:', error.message); process.exit(1) }
const { data: p } = await sb.from('projects').select('id,app,name,data').eq('app', 'staffing-hprd')
const { data: v } = await sb.from('project_versions').select('id,label,data').in('project_id', (p ?? []).map(x => x.id))
const blob = JSON.stringify({ p, v })
console.log('projects', p?.length, 'versions', v?.length, 'bytes', blob.length, 'days', p?.[0]?.data.project.days.length)
// Employee IDs and names from the synthetic export must not be in the cloud copy.
for (const word of ['E1', 'AG-RN', 'Alvarez', 'Okafor', '"shifts"', '"emp":"']) console.log(word, blob.includes(word) ? 'PRESENT' : 'absent')
