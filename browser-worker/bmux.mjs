import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'

export let createBmuxBrowser = ({ authorized, execute = promisify(execFile), pause = ms => new Promise(resolve => setTimeout(resolve, ms)), now = Date.now }) => {
 let jobs = new Map()
 let cli = async (...args) => {
  let output
  try { output = await execute(process.env.BMUX_BIN || 'bmux', args, { timeout: 90000, maxBuffer: 2 * 1024 * 1024 }) }
  catch (error) {
   let response
   try { response = JSON.parse(error.stdout || '{}') } catch {}
   throw new Error(response?.error === 'CONTROL_HELD' ? 'CONTROL_HELD' : response?.error === 'PROXY_UNAVAILABLE' ? 'PROXY_UNAVAILABLE' : 'bmux command failed')
  }
  let response = JSON.parse(output.stdout)
  if (!response.ok) throw new Error(response.error || 'bmux command failed')
  return response.result
 }
 let report = async (job, result) => { try { await cli('rpc', 'remote.job', JSON.stringify({ id: job.id, attempt: job.attempt, ...(result ? { result } : {}) })) } catch { /* Observation availability does not stop scraping. */ } }
 let retry = async (job, operation) => {
  let deadline = now() + 300000
  for (;;) {
   if (!(await authorized(job.id))) throw new Error('Job cancelled')
   await job.heartbeat()
   try { return await operation() } catch (error) {
    if (error.message !== 'CONTROL_HELD' || now() >= deadline) throw error
    await pause(2000)
   }
  }
 }
 return {
  begin: async (job, heartbeat) => {
   if (jobs.has(job.id)) throw new Error('bmux job already active')
   let profiles = await cli('profile', 'list')
   let profile = profiles.find(profile => profile.name === 'sitelytics-pilot') || await cli('profile', 'create', 'sitelytics-pilot', '--background')
   let session = await cli('new-session', '-s', `seo-${job.id}`, '--profile', profile.id)
   let running = { id: job.id, attempt: randomUUID(), session: session.id, pane: session.windows[0].panes[0].id, heartbeat }
   jobs.set(job.id, running)
   await report(running)
  },
  render: async (job, url) => {
   let running = jobs.get(job.id)
   if (!running) throw new Error('bmux job is not active')
   await retry(running, () => cli('navigate', '-t', running.pane, url.href))
   await retry(running, () => cli('wait', '-t', running.pane, '--selector', 'body'))
   await pause(1500)
   let result = await retry(running, () => cli('dom', '-t', running.pane, '--html'))
   if (typeof result.content !== 'string' || Buffer.byteLength(result.content) > 1048576) throw new Error('bmux returned incomplete HTML')
   return { html: result.content, url: result.url }
  },
  end: async (id, result) => {
   let job = jobs.get(id)
   if (!job) return
   await report(job, result || 'failed')
   try { await cli('rpc', 'kill-session', JSON.stringify({ session: job.session, confirm: true })) } catch { /* Retain a session still held by a human for inspection. */ }
   jobs.delete(id)
  },
 }
}
