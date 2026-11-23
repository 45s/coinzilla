import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const REQUIRED_INSTRUCTION_PATHS = ['AGENTS.md','docs/engineering/AI_TASK_COMPLIANCE_STANDARD.md','ENGINEERING_STANDARDS.md','AI_AGENT_WORKFLOW.md','docs/engineering/TASK_WORKFLOWS.md','docs/DOCUMENTATION_GOVERNANCE.md','docs/MARKDOWN_STYLE.md'];
export const REQUIRED_ISSUE_SECTIONS = ['Problem','Expected behavior','Investigation','Possible solutions','Implementation plan','Acceptance criteria','Verification','Resolution'];
const START = '<!-- coinzilla-agent-preflight:v1 -->';
const END = '<!-- /coinzilla-agent-preflight -->';
const IGNORE = new Set(['.git','node_modules','.pnpm-store','coverage','dist','build','.next','.turbo']);

export function calculateGitBlobSha(content) {
  const bytes = Buffer.from(content, 'utf8');
  return createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
}
export function discoverApplicableInstructionPaths(paths, targets) {
  return paths.filter((path) => path === 'AGENTS.md' || targets.some((target) => {
    const dir = dirname(path).replaceAll('\\','/');
    const item = target.replaceAll('\\','/').replace(/^\.\//,'').replace(/\/$/,'');
    return item === dir || item.startsWith(dir + '/') || dir.startsWith(item + '/');
  })).sort();
}
export function parsePreflightReport(body) {
  if (typeof body !== 'string' || !body.includes(START) || !body.includes(END)) throw new Error('Versioned preflight report missing.');
  const block = body.slice(body.indexOf(START), body.indexOf(END));
  const issue = block.match(/^Task issue:\s*#(\d+)\s*$/m);
  const commit = block.match(/^Preflight commit:\s*\x60?([0-9a-f]{40})\x60?\s*$/im);
  const status = block.match(/^Status:\s*(\w+)\s*$/m);
  if (!issue || !commit || !status) throw new Error('Preflight report missing issue, commit SHA, or status.');
  const instructions = [...block.matchAll(/^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|$/gim)]
    .map((m) => ({ path: m[1].replaceAll('\x60', '').trim(), sha: m[2].replaceAll('\x60', '').trim().toLowerCase() }))
    .filter((m) => m.path !== 'Instruction file' && /^[0-9a-f]{40}$/.test(m.sha));
  return { issueNumber: Number(issue[1]), commitSha: commit[1].toLowerCase(), status: status[1].toUpperCase(), instructions };
}
export function validateInstructionSnapshot(report, actual, required) {
  const errors = [], recorded = new Map(report.instructions.map((x) => [x.path,x.sha]));
  for (const path of [...new Set(required)].sort()) {
    if (!recorded.has(path)) errors.push('Required instruction missing from report: ' + path);
    else if (!actual.has(path)) errors.push('Required instruction file missing: ' + path);
    else if (recorded.get(path) !== actual.get(path)) errors.push('Instruction hash stale: ' + path);
  }
  for (const path of recorded.keys()) if (!actual.has(path)) errors.push('Recorded instruction no longer exists: ' + path);
  return errors;
}
function plain(text) {
  return text
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^\s*(?:What\b|Describe\b|List\b|Record\b|Which\b|Who\b|How\b|Summarize\b|Complete when resolved\b).*$/gim, '')
    .replace(/^\s*[-*]\s*\[[ xX]\]\s*(?:Observable outcome:?|TBD|TODO)?\s*$/gim, '')
    .replace(/^\s*[-*]\s*\[[ xX]\]\s*(?:Regression test reproduces the original defect and passes after the fix\.|Relevant failure and boundary cases are covered\.|No existing behavior or invariant regresses\.)\s*$/gim, '')
    .replace(/\b(?:TBD|TODO)\b/gi, '')
    .replace(/[\x60*_>#|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
export function validateIssueBody(body) {
  if (typeof body !== 'string' || !body.trim()) return ['Issue body is empty.'];
  const headings = [...body.matchAll(/^##\s+(.+?)\s*$/gm)];
  const sections = new Map(headings.map((m,i) => [m[1].toLowerCase(),body.slice(m.index+m[0].length,headings[i+1]?.index ?? body.length)]));
  const errors = [];
  for (const name of REQUIRED_ISSUE_SECTIONS) {
    const section = sections.get(name.toLowerCase());
    if (!section) errors.push('Required issue section missing: ' + name);
    else if (plain(section).length < 12 || /^(?:tbd|todo|n\/a|none|pending|not started)[.! ]*$/i.test(plain(section))) errors.push('Issue section has no meaningful content: ' + name);
  }
  return errors;
}
export function validatePreflightReport(report, ctx) {
  if (!report || report.status !== 'COMPLETE') return ['A COMPLETE preflight report is required.'];
  const errors = [];
  if (report.issueNumber !== ctx.issueNumber) errors.push('Preflight report references a different issue.');
  errors.push(...validateInstructionSnapshot(report,ctx.actualHashes,ctx.requiredPaths));
  if (!ctx.isAncestor) errors.push('Preflight commit is not an ancestor of PR head.');
  if (ctx.recordedBeforeImplementation === false) errors.push('Preflight report was not recorded before the first implementation commit.');
  return errors;
}
export function extractTrackingIssueNumber(body) {
  const refs = [...(body || '').matchAll(/(?:close[sd]?|fix(?:es|ed)?|resolve[sd]?|tracking issue)\s*:?\s*#(\d+)/gi)];
  return refs.length === 1 ? Number(refs[0][1]) : null;
}
export function validatePullRequestEvidence(ctx) {
  const errors = [];
  if (extractTrackingIssueNumber(ctx.body) !== ctx.issueNumber) errors.push('PR must reference exactly one valid tracking issue.');
  const reported = ctx.body.replaceAll('*','').match(/^\s*-?\s*Final source commit:?\s*([0-9a-f]{40})\s*$/im)?.[1]?.toLowerCase();
  if (reported !== ctx.headSha?.toLowerCase()) errors.push('Reported source commit does not match PR head SHA.');
  const docs = ctx.body.match(/^##\s+Documentation impact\s*$([\s\S]*?)(?=^##\s+|$)/im)?.[1];
  if (!docs || plain(docs).length < 12) errors.push('PR documentation impact is missing or empty.');
  const changedDocs = (ctx.changedPaths || []).filter((path) => /\.mdx?$/i.test(path));
  for (const path of changedDocs) {
    if (!docs?.includes(path)) errors.push('Changed documentation path is missing from PR documentation impact: ' + path);
  }
  if ((ctx.changedPaths || []).length && changedDocs.length === 0 &&
      !/N\/A.{0,100}(?:because|reason|no documentation)/i.test(docs || '')) {
    errors.push('PR must explain why no documentation update is required.');
  }
  errors.push(...validateIssueBody(ctx.issueBody));
  const evidence = ctx.issueComments || '';
  if (!/verification evidence/i.test(evidence) || !/\bpassed\b/i.test(evidence) || !/\b(?:pnpm|npm|node|git)\b/i.test(evidence) || !/\b[0-9a-f]{40}\b/i.test(evidence)) errors.push('Issue lacks command-based verification evidence and commit SHA.');
  errors.push(...validatePreflightReport(ctx.preflightReport,{issueNumber:ctx.issueNumber,requiredPaths:ctx.requiredInstructionPaths,actualHashes:ctx.actualInstructionHashes,isAncestor:ctx.preflightCommitIsAncestor,recordedBeforeImplementation:ctx.preflightRecordedBeforeImplementation}));
  return errors;
}
function git(args) { return execFileSync('git',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']}); }
function hashAt(ref,path) { try { return calculateGitBlobSha(git(['show',ref+':'+path])); } catch { return null; } }
function workHash(root,path) { const file=join(root,path); return existsSync(file)?calculateGitBlobSha(readFileSync(file,'utf8')):null; }
function findAgents(root) {
  const found=['AGENTS.md'];
  function walk(dir) {
    for (const e of readdirSync(dir,{withFileTypes:true})) {
      if (e.isDirectory() && !IGNORE.has(e.name)) walk(join(dir,e.name));
      else if (e.isFile() && e.name==='AGENTS.md') found.push(relative(root,join(dir,e.name)).split(sep).join('/'));
    }
  }
  for (const name of ['apps','packages','docs','scripts','.github']) { const dir=join(root,name); if(existsSync(dir)) walk(dir); }
  return [...new Set(found)].sort();
}
function makeReport(n,sha,paths,hashes,scope) {
  return [START,'## Agent preflight','',
    '- [x] Root AGENTS.md read','- [x] AI task compliance standard read','- [x] Engineering standards read',
    '- [x] AI agent workflow read','- [x] Applicable task workflow read','- [x] Documentation governance read',
    '- [x] Markdown style standard read','- [x] Applicable nested instructions identified and read','',
    'Relevant constraints:','- Follow TDD and preserve existing contracts.','- Keep the issue as the single source of truth.','- Missing or unverifiable evidence is BLOCKED.','',
    'Task scope paths: '+scope.join(', '),'Task issue: #'+n,'Preflight commit: '+sha,'Status: COMPLETE','',
    '| Instruction file | Git blob SHA |','| --- | --- |',...paths.map(p=>'| '+p+' | '+hashes.get(p)+' |'),END].join('\n');
}
async function api(path,token,method='GET',body) {
  const res=await fetch('https://api.github.com'+path,{method,headers:{Accept:'application/vnd.github+json',Authorization:'Bearer '+token,'X-GitHub-Api-Version':'2022-11-28',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  if(!res.ok) throw new Error('GitHub API BLOCKED ('+res.status+'): '+await res.text());
  return res.status===204?null:res.json();
}
async function issueData(repo,n,token) {
  const issue=await api('/repos/'+repo+'/issues/'+n,token);
  if(issue.pull_request||issue.state!=='open') throw new Error('Tracking issue #'+n+' is not an open issue.');
  const comments=[];
  for(let page=1;page<=10;page+=1){const batch=await api('/repos/'+repo+'/issues/'+n+'/comments?per_page=100&page='+page,token);comments.push(...batch);if(batch.length<100)break;}
  return {issue,comments};
}
function latestReport(comments) {
  const found=comments.filter(x=>x.body?.includes(START)).sort((a,b)=>a.created_at.localeCompare(b.created_at));
  return found.length?{...parsePreflightReport(found.at(-1).body),createdAt:found.at(-1).created_at}:null;
}
function parseArgs(argv) {
  const a={issue:0,paths:[],record:false,pr:false,attestRead:false,attestNested:false};
  for(let i=0;i<argv.length;i+=1){if(argv[i]==='--issue')a.issue=Number(argv[++i]);else if(argv[i]==='--paths')a.paths=argv[++i].split(',').map(x=>x.trim()).filter(Boolean);else if(argv[i]==='--record')a.record=true;else if(argv[i]==='--pull-request')a.pr=true;else if(argv[i]==='--attest-read')a.attestRead=true;else if(argv[i]==='--attest-nested')a.attestNested=true;else throw new Error('Unknown argument: '+argv[i]);}
  return a;
}
async function local(root,args,repo,token) {
  if(!Number.isInteger(args.issue)||args.issue<1||!args.paths.length)throw new Error('Use --issue <number> --paths <comma-separated paths> --attest-read --attest-nested [--record].');
  if(!args.attestRead||!args.attestNested)throw new Error('Explicit self-attestation flags are required: --attest-read --attest-nested.');
  if(!token)throw new Error('GH_TOKEN or GITHUB_TOKEN required; BLOCKED.');
  const {issue}=await issueData(repo,args.issue,token), gaps=validateIssueBody(issue.body);
  if(gaps.length)throw new Error('Issue incomplete:\n- '+gaps.join('\n- '));
  const paths=[...new Set([...REQUIRED_INSTRUCTION_PATHS,...discoverApplicableInstructionPaths(findAgents(root),args.paths)])].sort();
  const hashes=new Map(paths.map(p=>[p,workHash(root,p)])), missing=paths.filter(p=>!hashes.get(p));
  if(missing.length)throw new Error('Instruction files missing:\n- '+missing.join('\n- '));
  const body=makeReport(args.issue,git(['rev-parse','HEAD']).trim(),paths,hashes,args.paths).replace('## Agent preflight','## Agent preflight\\n\\nAgent self-attestation (not independently provable):');
  if(args.record){await api('/repos/'+repo+'/issues/'+args.issue+'/comments',token,'POST',{body});process.stdout.write('COMPLETE: preflight report recorded on #'+args.issue+'.\n');}
  else process.stdout.write(body+'\n\nNot recorded; rerun with --record before implementation.\n');
}
async function pullRequest(repo,token) {
  if(!token||!process.env.GITHUB_EVENT_PATH)throw new Error('GitHub token or PR event metadata unavailable; BLOCKED.');
  const event=JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH,'utf8'));
  const pr=event.pull_request;
  if(!pr||pr.base?.ref!=='develop')throw new Error('Validator requires a PR targeting develop.');
  const number=extractTrackingIssueNumber(pr.body||'');
  if(!number)throw new Error('PR must reference exactly one tracking issue; BLOCKED.');
  const {issue,comments}=await issueData(repo,number,token);
  const preflight=latestReport(comments);
  if(!preflight)throw new Error('No versioned preflight report on issue; BLOCKED.');

  const compare=await api('/repos/'+repo+'/compare/'+preflight.commitSha+'...'+pr.head.sha,token);
  const ancestor=compare.status==='ahead'||compare.status==='identical';
  const firstDate=compare.commits?.[0]?.commit?.committer?.date||compare.commits?.[0]?.commit?.author?.date||'';
  const recordedBeforeImplementation=Boolean(firstDate&&preflight.createdAt&&Date.parse(preflight.createdAt)<=Date.parse(firstDate));

  const changed=[];
  for(let page=1;page<=10;page+=1){
    const batch=await api('/repos/'+repo+'/pulls/'+pr.number+'/files?per_page=100&page='+page,token);
    changed.push(...batch.map((file)=>file.filename));
    if(batch.length<100)break;
    if(page===10)throw new Error('PR changes exceed the validator pagination limit; BLOCKED.');
  }
  const tree=await api('/repos/'+repo+'/git/trees/'+pr.base.sha+'?recursive=1',token);
  if(tree.truncated)throw new Error('Base instruction tree is truncated; applicable nested instructions cannot be verified. BLOCKED.');
  const baseAgents=(tree.tree||[]).filter((item)=>item.type==='blob'&&(item.path==='AGENTS.md'||item.path.endsWith('/AGENTS.md'))).map((item)=>item.path);
  const required=[...new Set([...REQUIRED_INSTRUCTION_PATHS,...discoverApplicableInstructionPaths(baseAgents,changed),...preflight.instructions.map((item)=>item.path)])].sort();
  const hashes=new Map();
  for(const path of required){
    const encodedPath=path.split('/').map(encodeURIComponent).join('/');
    try{
      const blob=await api('/repos/'+repo+'/contents/'+encodedPath+'?ref='+pr.base.sha,token);
      hashes.set(path,blob.sha||null);
    }catch(error){
      if(String(error.message).includes('(404)'))hashes.set(path,null);
      else throw error;
    }
  }
  const errors=validatePullRequestEvidence({
    body:pr.body||'',headSha:pr.head.sha,issueNumber:number,issueBody:issue.body||'',
    issueComments:comments.map((item)=>item.body||'').join('\n'),
    preflightReport:preflight,requiredInstructionPaths:required,actualInstructionHashes:hashes,changedPaths:changed,
    preflightCommitIsAncestor:ancestor,preflightRecordedBeforeImplementation:recordedBeforeImplementation,
  });
  if(errors.length)throw new Error('BLOCKED:\n- '+errors.join('\n- '));
  process.stdout.write('PASS: preflight, issue, PR SHA and evidence validated on '+pr.head.sha+'.\n');
}
async function main() {
  const root=fileURLToPath(new URL('../',import.meta.url)),args=parseArgs(process.argv.slice(2));
  const repo=process.env.GITHUB_REPOSITORY,token=process.env.GH_TOKEN??process.env.GITHUB_TOKEN;
  if(!repo)throw new Error('GITHUB_REPOSITORY is required.');
  if(args.pr)await pullRequest(repo,token);else await local(root,args,repo,token);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{process.stderr.write('BLOCKED: '+e.message+'\n');process.exitCode=1;});
