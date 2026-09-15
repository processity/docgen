import { spawnSync } from 'child_process';

// Exercise the real provisioning script against a fake Azure CLI boundary: no cloud writes.
const check = String.raw`
import importlib.util,json,sys
from pathlib import Path
env,mode=sys.argv[1:]
spec=importlib.util.spec_from_file_location('mount_setup','scripts/mount-reconnect-files.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
group='docgen-'+env+'-rg';name='docgen-'+env;account='docgen'+env+'settings'
resource='/subscriptions/test-sub/resourceGroups/'+group
app={'id':resource+'/providers/Microsoft.App/containerApps/'+name,'location':'eastus',
 'properties':{'latestRevisionName':'revision-1','managedEnvironmentId':resource+'/providers/Microsoft.App/managedEnvironments/'+name+'-env',
 'template':{'containers':[{'name':'api','image':'keep-this-image','imageType':'ContainerImage','env':[{'name':'SECRET','secretRef':'keep-this-secret'}]}]}}}
if mode=='wrong-environment':app['properties']['managedEnvironmentId']=app['properties']['managedEnvironmentId'].replace(group,'another-rg')
writes=[]
def az(args,label):
 assert args[args.index('--subscription')+1]=='test-sub'
 if args[:2]==['containerapp','show']:
  return ('revision-2' if mode=='concurrent-deployment' else 'revision-1') if '--query' in args else app
 if args[:4]==['containerapp','env','storage','list']:return []
 if args[:3]==['storage','account','list']:return []
 if args[:3]==['storage','account','create']:
  assert args[args.index('-g')+1]==group
  assert args[args.index('-n')+1]==account
  writes.append('account')
  return {'allowBlobPublicAccess':False,'enableHttpsTrafficOnly':True,'allowSharedKeyAccess':True}
 if args[:3]==['storage','share-rm','list']:return []
 if args[:3]==['storage','share-rm','create']:
  assert args[args.index('--storage-account')+1]==account
  writes.append('share');return None
 if args[:4]==['storage','account','keys','list']:return [{'value':'FAKE-KEY'}]
 if args[:4]==['containerapp','env','storage','set']:
  assert args[args.index('--azure-file-account-name')+1]==account
  writes.append('link');return None
 if args[0]=='rest':
  assert args[args.index('--uri')+1].startswith('https://management.azure.com'+resource+'/')
  patch=json.loads(Path(args[args.index('--body')+1][1:]).read_text())
  container=patch['properties']['template']['containers'][0]
  assert container['image']=='keep-this-image'
  assert {'name':'SECRET','secretRef':'keep-this-secret'} in container['env']
  assert 'configuration' not in patch['properties']
  assert 'FAKE-KEY' not in json.dumps(patch)
  writes.append('mount');return None
 raise AssertionError('Unexpected Azure operation')
m.az=az
sys.argv=['mount-setup','--subscription','test-sub','--resource-group',group,'--app',name,'--storage-account',account,'--share','connection-settings']
if mode!='missing-storage':sys.argv+=['--create-storage']
try:m.main()
except SystemExit:
 if mode in ['wrong-environment','missing-storage']:assert writes==[]
 elif mode=='concurrent-deployment':assert 'mount' not in writes
 else:raise
else:
 assert mode=='success'
 assert writes==['account','share','link','mount']
`;

it.each(['uat', 'production'])('provisions isolated %s storage using the same script and preserves runtime image/secrets', environment => {
  const result = spawnSync('python3', ['-c', check, environment, 'success'], { encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
  expect(result.stderr).toBe(''); expect(result.status).toBe(0);
});
it.each(['wrong-environment', 'missing-storage', 'concurrent-deployment'])('fails safely for %s', mode => {
  const result = spawnSync('python3', ['-c', check, 'production', mode], { encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
  expect(result.stderr).toBe(''); expect(result.status).toBe(0);
});
