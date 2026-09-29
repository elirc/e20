"""Real browser checks against an exclusively created fictional SQLite workspace."""
from pathlib import Path
import json, os, socket, subprocess, time, urllib.request
from playwright.sync_api import sync_playwright, expect
ROOT=Path(__file__).resolve().parents[1]
OUT=Path(os.environ.get('ERP_CHECK_DIR',str(ROOT/'.verification/browser'))).resolve();OUT.mkdir(parents=True,exist_ok=True)
DB=OUT/'erp.sqlite';CREDENTIALS=OUT/'credentials.json';BASE='http://127.0.0.1:5182';results=[]
env={**os.environ,'ERP_DATABASE':str(DB),'ERP_CREDENTIALS':str(CREDENTIALS),'PORT':'5182'}
with socket.socket() as probe:
 try:probe.bind(('127.0.0.1',5182))
 except OSError:raise SystemExit('Port 5182 occupied; no existing process was used or stopped.')
subprocess.run(['node','dist/src/setup.js'],cwd=ROOT,env=env,check=True,capture_output=True,text=True,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
passwords=json.loads(CREDENTIALS.read_text())['passwords'];log=(OUT/'server.log').open('w',encoding='utf-8')
server=subprocess.Popen(['node','dist/src/server.js'],cwd=ROOT,env=env,stdout=log,stderr=subprocess.STDOUT,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
def accept_dialog(dialog):dialog.accept()
def nav(p,name):p.get_by_role('navigation',name='Modules').get_by_role('button',name=name,exact=True).click()
def saved(p):expect(p.get_by_role('status')).to_contain_text('Saved record at version')
def login(p,email='admin@acme.local'):
 p.goto(BASE);p.get_by_label('Email',exact=True).fill(email);p.get_by_label('Password',exact=True).fill(passwords[email])
 with p.expect_response(lambda r:r.url.endswith('/auth/login')) as response:p.get_by_role('button',name='Sign in',exact=True).click()
 data=response.value.json();expect(p.locator('#workspace')).to_be_visible();expect(p.get_by_role('status')).to_contain_text('Signed in.');return data

def create(p,module,name,code=None):
 nav(p,module);p.get_by_role('button',name='New record',exact=True).click();p.get_by_label('Name',exact=True).fill(name)
 if code:p.get_by_label('Code',exact=True).fill(code)
 p.get_by_role('button',name='Save record',exact=True).click();saved(p)

def call(p,auth,method,path,data=None):
 r=p.request.fetch(BASE+path,method=method,headers={'Authorization':'Bearer '+auth['token'],'x-company-id':auth['companies'][0]['id']},data=data)
 assert r.ok, (r.status,r.text());return r.json()
try:
 deadline=time.monotonic()+120
 while time.monotonic()<deadline:
  if server.poll() is not None:raise RuntimeError('Owned server stopped early')
  try:
   with urllib.request.urlopen(BASE+'/health',timeout=2) as r:
    if r.status==200:break
  except OSError:time.sleep(.2)
 else:raise RuntimeError('Server readiness timeout')
 with sync_playwright() as pw:
  browser=pw.chromium.launch(headless=True,**({'executable_path':os.environ['ASTRA_BROWSER_EXECUTABLE']} if os.environ.get('ASTRA_BROWSER_EXECUTABLE') else {}))
  def run(name,action,email='admin@acme.local'):
   selected=os.environ.get('ERP_BROWSER_CHECKS','').split('|')
   if selected!=[''] and name not in selected:return
   c=browser.new_context(viewport={'width':1440,'height':1050},accept_downloads=True);p=c.new_page();p.set_default_timeout(60000);p.on('dialog',accept_dialog);errors=[];p.on('pageerror',lambda e:errors.append(str(e)))
   try:
    auth=login(p,email);action(p,c,auth);assert p.evaluate('''() => { const message=document.getElementById('message').getBoundingClientRect(); return [...document.querySelectorAll('input,select,textarea,button')].filter(e=>e.getClientRects().length).every(e=>{const r=e.getBoundingClientRect();return !(r.left<message.right&&r.right>message.left&&r.top<message.bottom&&r.bottom>message.top);}); }'''), 'Status banner overlaps a control';assert not errors,errors;results.append({'name':name,'passed':True});print('PASS',name,flush=True)
   except Exception as e:
    results.append({'name':name,'passed':False,'error':str(e)});print('FAIL',name,str(e)[:350],flush=True)
    try:p.screenshot(path=str(OUT/f'failure-{len(results)}.png'),full_page=True,timeout=10000)
    except Exception:pass
   finally:c.close()
  def masters(p,c,auth):
   for module,name,code in [('Customers','Browser customer','B-CUST'),('Suppliers','Browser supplier','B-SUP'),('Warehouses','Browser warehouse','B-WH')]:
    create(p,module,name,code);p.get_by_role('button',name='Edit '+name,exact=True).click();p.get_by_label('Name',exact=True).fill(name+' updated');p.get_by_role('button',name='Save record',exact=True).click();saved(p);p.get_by_role('button',name='Edit '+name+' updated',exact=True).click();p.get_by_role('button',name='Delete record',exact=True).click();expect(p.get_by_role('status')).to_have_text('Record deleted.')
   nav(p,'Items');p.get_by_role('button',name='New record',exact=True).click();p.get_by_label('SKU',exact=True).fill('B-ITEM');p.get_by_label('Name',exact=True).fill('Browser widget');p.get_by_label('Unit of measure',exact=True).fill('Each');p.get_by_label('Item group',exact=True).fill('Practice');p.get_by_label('Standard cost (USD)',exact=True).fill('1.35');p.get_by_label('Sales price (USD)',exact=True).fill('4.05');p.get_by_role('button',name='Save record',exact=True).click();saved(p)
   item=next(i for i in call(p,auth,'GET','/items') if i['sku']=='B-ITEM');assert item['standardCost']==1.35 and item['salesPrice']==4.05
   p.screenshot(path=str(OUT/'01-items-desktop.png'),full_page=True)
  run('customer supplier warehouse CRUD and exact item cents',masters)
  def projects(p,c,auth):
   create(p,'Projects','Browser delivery');nav(p,'Tasks');p.get_by_role('button',name='New record',exact=True).click();p.get_by_label('Project',exact=True).select_option(label='Browser delivery');p.get_by_label('Title',exact=True).fill('Write acceptance checks');p.get_by_label('Due date',exact=True).fill('2026-09-30');p.get_by_role('button',name='Save record',exact=True).click();saved(p)
   nav(p,'Timesheets');p.get_by_role('button',name='New record',exact=True).click();p.get_by_label('Project',exact=True).select_option(label='Browser delivery');p.get_by_label('Task',exact=True).select_option(label='Write acceptance checks');p.get_by_label('Team member',exact=True).select_option(label='Company Admin');p.get_by_label('Hours',exact=True).fill('1.5');p.get_by_label('Work date',exact=True).fill('2026-09-09');p.get_by_role('button',name='Save record',exact=True).click();saved(p)
   nav(p,'Projects');p.get_by_role('button',name='Edit Browser delivery',exact=True).click();p.get_by_role('button',name='Delete record',exact=True).click();expect(p.get_by_role('status')).to_contain_text('reference not found');expect(p.get_by_label('Name',exact=True)).to_have_value('Browser delivery');p.get_by_label('Status',exact=True).select_option('completed');p.get_by_role('button',name='Save record',exact=True).click();saved(p)
   p.get_by_role('button',name='Edit Browser delivery',exact=True).click();p.screenshot(path=str(OUT/'02-project-editor.png'),full_page=True)
  run('project task timesheet relationships and guarded delete',projects)
  def conflict(p,c,auth):
   create(p,'Customers','Two tab customer','B-TWO');p.get_by_role('button',name='Edit Two tab customer',exact=True).click();p.get_by_label('Name',exact=True).fill('Unsaved second draft')
   other=c.new_page();other.set_default_timeout(60000);other.on('dialog',lambda d:d.accept());login(other);other.get_by_role('button',name='Edit Two tab customer',exact=True).click();other.get_by_label('Name',exact=True).fill('Saved first draft');other.get_by_role('button',name='Save record',exact=True).click();saved(other)
   p.bring_to_front();p.get_by_role('button',name='Save record',exact=True).click();expect(p.get_by_role('status')).to_contain_text('Record changed');expect(p.get_by_label('Name',exact=True)).to_have_value('Unsaved second draft')
   with p.expect_download() as download:p.get_by_role('button',name='Export draft',exact=True).click()
   exported=json.loads(Path(download.value.path()).read_text());assert exported['data']['name']=='Unsaved second draft';assert exported['version']==1
   p.screenshot(path=str(OUT/'03-conflict-draft.png'),full_page=True);p.get_by_role('button',name='Load current record',exact=True).click();expect(p.get_by_label('Name',exact=True)).to_have_value('Saved first draft');other.close()
  run('two tabs reject stale edits and retain exportable drafts',conflict)
  def permissions(p,c,auth):
   expect(p.get_by_role('button',name='New record',exact=True)).to_have_count(0);expect(p.get_by_role('button',name='View Northwind Retail',exact=True)).to_be_visible();p.get_by_role('button',name='View Northwind Retail',exact=True).click();expect(p.get_by_label('Name',exact=True)).to_be_disabled();expect(p.get_by_role('button',name='Save record',exact=True)).to_have_count(0)
   r=p.request.post(BASE+'/customers',headers={'Authorization':'Bearer '+auth['token'],'x-company-id':auth['companies'][0]['id']},data={'name':'Denied browser write'});assert r.status==403
   p.screenshot(path=str(OUT/'04-auditor-view.png'),full_page=True)
  run('auditor UI and API remain read only',permissions,'audit@acme.local')
  def uncertain(p,c,auth):
   p.get_by_role('button',name='New record',exact=True).click();p.get_by_label('Name',exact=True).fill('Acknowledgement lost');p.get_by_label('Code',exact=True).fill('B-ACK')
   def lose(route):
    if route.request.method=='POST':route.fetch();route.abort('failed')
    else:route.continue_()
   p.route('**/customers',lose);p.get_by_role('button',name='Save record',exact=True).click();expect(p.get_by_role('status')).to_contain_text('may have saved');expect(p.get_by_label('Name',exact=True)).to_have_value('Acknowledgement lost');p.unroute('**/customers',lose);p.get_by_role('button',name='Refresh list',exact=True).click();expect(p.get_by_role('button',name='Edit Acknowledgement lost',exact=True)).to_be_visible();assert len([r for r in call(p,auth,'GET','/customers') if r['code']=='B-ACK'])==1
  run('lost acknowledgement retains draft and reveals accepted save',uncertain)
  def layout(p,c,auth):
   p.get_by_role('button',name='New record',exact=True).click();p.get_by_label('Name',exact=True).fill('Keep my draft');p.get_by_label('Code',exact=True).fill('B-DRAFT')
   # Replace the blanket accept handler so navigation cancellation is exercised.
   p.remove_listener('dialog',accept_dialog);p.on('dialog',lambda d:d.dismiss());nav(p,'Items');expect(p.get_by_label('Name',exact=True)).to_have_value('Keep my draft');expect(p.get_by_role('heading',name='Customers',exact=True)).to_be_visible()
   for width,height in [(1440,1050),(800,1050),(390,844)]:
    p.set_viewport_size({'width':width,'height':height});assert p.evaluate('document.documentElement.scrollWidth<=innerWidth+1');assert p.locator('nav button').evaluate_all('(buttons)=>buttons.every(b=>b.scrollWidth<=b.clientWidth+1)');p.screenshot(path=str(OUT/f'05-draft-{width}.png'),full_page=True)
  run('draft navigation guard and responsive widths',layout)
  def pagination(p,c,auth):
   for n in range(21):call(p,auth,'POST','/customers',{'name':f'Page learner {n:02d}','code':f'B-PAGE-{n:02d}'})
   p.get_by_role('button',name='Refresh list',exact=True).click();p.get_by_label('Search records',exact=True).fill('Page learner');expect(p.locator('.record')).to_have_count(20);p.get_by_role('button',name='Next',exact=True).click();expect(p.locator('.record')).to_have_count(1);p.get_by_role('button',name='Edit Page learner 20',exact=True).click();p.get_by_role('button',name='Delete record',exact=True).click();expect(p.get_by_role('status')).to_have_text('Record deleted.');expect(p.locator('#page')).to_have_text('Page 1 of 1');p.get_by_label('Search records',exact=True).fill('[');expect(p.locator('.record')).to_have_count(0)
   with p.expect_download() as download:p.get_by_role('button',name='Export current module',exact=True).click()
   exported=json.loads(Path(download.value.path()).read_text());assert len(exported['records'])>=20;assert 'passwordHash' not in json.dumps(exported)
  run('pagination clamps after deletion and exports permitted module',pagination)
  browser.close()
finally:
 server.terminate()
 try:server.wait(timeout=15)
 except subprocess.TimeoutExpired:server.kill();server.wait(timeout=10)
 log.close()
(OUT/'results.json').write_text(json.dumps({'passed':all(r['passed'] for r in results),'total':len(results),'checks':results},indent=2),encoding='utf-8')
if not results or not all(r['passed'] for r in results):raise SystemExit(1)
