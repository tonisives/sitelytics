import test from 'node:test'
import assert from 'node:assert/strict'
import { createBmuxBrowser } from './bmux.mjs'

let fixture = overrides => {
 let calls = [], now = 0, heartbeats = 0
 let execute = async (_bin,args) => {
  calls.push(args)
  let custom = await overrides?.(args)
  if (custom !== undefined) return custom
  let result = args[0] === 'profile' ? [{id:'profile',name:'sitelytics-pilot'}]
   : args[0] === 'new-session' ? {id:'session',windows:[{panes:[{id:'pane'}]}]}
   : args[0] === 'dom' ? {content:'<body>Fixture</body>',url:'https://example.com/'} : {}
  return {stdout:JSON.stringify({ok:true,result})}
 }
 return { calls, options:{ execute, pause:async ms=>{now+=ms},now:()=>now }, heartbeat:async()=>{heartbeats++}, heartbeats:()=>heartbeats }
}
test('isolates jobs and yields while a human controls the pane', async()=>{
 let blocked = true
 let f = fixture(args=>{
  if(args[0]==='navigate' && blocked){blocked=false;throw Object.assign(new Error('fixture'),{stdout:'{"ok":false,"error":"CONTROL_HELD"}'})}
 })
 let browser = createBmuxBrowser({...f.options,authorized:async()=>true})
 await browser.begin({id:'job'},f.heartbeat)
 assert.deepEqual(await browser.render({id:'job'},new URL('https://example.com/')),{html:'<body>Fixture</body>',url:'https://example.com/'})
 assert.equal(f.calls.filter(args=>args[0]==='navigate').length,2)
 assert.ok(f.heartbeats()>=3)
 await browser.end('job','succeeded')
 assert.ok(f.calls.some(args=>args[1]==='kill-session'))
 let reports=f.calls.filter(args=>args[1]==='remote.job').map(args=>JSON.parse(args[2]))
 assert.equal(reports.length,2)
 assert.equal(reports[0].attempt,reports[1].attempt)
 assert.equal(reports[1].result,'succeeded')
})
test('checks cancellation before navigation and does not fall back after proxy failure',async()=>{
 let f=fixture(args=>{if(args[0]==='navigate')throw Object.assign(new Error('fixture'),{stdout:'{"ok":false,"error":"PROXY_UNAVAILABLE"}'})})
 let active=true
 let browser=createBmuxBrowser({...f.options,authorized:async()=>active})
 await browser.begin({id:'job'},f.heartbeat)
 await assert.rejects(browser.render({id:'job'},new URL('https://example.com/')),/PROXY_UNAVAILABLE/)
 active=false
 await assert.rejects(browser.render({id:'job'},new URL('https://example.com/')),/cancelled/)
 assert.equal(f.calls.filter(args=>args[0]==='navigate').length,1)
})
