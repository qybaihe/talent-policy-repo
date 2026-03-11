import fs from 'fs';
import { execSync } from 'child_process';

const REPO = process.cwd();
const BACKLOG = 'city-backlog.json';
const TEMPLATE = 'templates/city.md';
const OUT_DIR = '重点城市速查版';
const INDEX_MD = `${OUT_DIR}/README.md`;
const VERIFY_MD = '待复核清单.md';

function sh(cmd){
  return execSync(cmd,{stdio:'pipe'}).toString('utf8');
}

function nowIso(){return new Date().toISOString();}
function today(){
  const d=new Date();
  const yyyy=d.getFullYear();
  const mm=String(d.getMonth()+1).padStart(2,'0');
  const dd=String(d.getDate()).padStart(2,'0');
  return `${yyyy}-${mm}-${dd}`;
}

function readJson(p){return JSON.parse(fs.readFileSync(p,'utf8'));}
function writeJson(p,obj){fs.writeFileSync(p, JSON.stringify(obj,null,2)+"\n");}

function ensureDir(p){ if(!fs.existsSync(p)) fs.mkdirSync(p,{recursive:true}); }

function ensureIndexHas(city){
  if(!fs.existsSync(INDEX_MD)){
    fs.writeFileSync(INDEX_MD, `# 重点城市速查版\n\n- [${city}](${city}.md)（首轮骨架）\n`);
    return;
  }
  const s=fs.readFileSync(INDEX_MD,'utf8');
  if(!s.includes(`](${city}.md)`)){
    fs.appendFileSync(INDEX_MD, `\n- [${city}](${city}.md)（首轮骨架）\n`);
  }
}

function ensureVerifyHas(city){
  const s=fs.readFileSync(VERIFY_MD,'utf8');
  if(!s.includes(`## ${city}\n`)){
    fs.appendFileSync(VERIFY_MD, `\n## ${city}\n- 待复核：学历/年龄/社保/补贴口径/区县差异/政策有效期\n`);
  }
}

function makeCityFile(city){
  ensureDir(OUT_DIR);
  const outFile = `${OUT_DIR}/${city}.md`;
  if(fs.existsSync(outFile)) return {outFile, created:false};
  let tpl=fs.readFileSync(TEMPLATE,'utf8');
  tpl=tpl.replaceAll('{{CITY}}', city).replaceAll('{{DATE}}', today());
  fs.writeFileSync(outFile, tpl);
  return {outFile, created:true};
}

// pick 1 city by priority desc
// prefer todo; if none, recover drafting/deepsearching entries missing file
const backlog = readJson(BACKLOG);
const todo = backlog.filter(x=>x.status==='todo').sort((a,b)=>(b.priority||0)-(a.priority||0));
let pick = todo.slice(0,1);

if(pick.length===0){
  const candidates = backlog
    .filter(x=>['drafting','deepsearching'].includes(x.status))
    .sort((a,b)=>(b.priority||0)-(a.priority||0));
  pick = candidates.slice(0,1);
}

if(pick.length===0){
  console.log('no todo city');
  process.exit(0);
}

// mark as drafting
const pickedCities = pick.map(x=>x.city);
for(const item of backlog){
  if(pickedCities.includes(item.city)){
    item.status='drafting';
    item.last_touched=nowIso();
  }
}
writeJson(BACKLOG, backlog);

// apply filesystem changes
const touchedFiles = new Set([BACKLOG, INDEX_MD, VERIFY_MD]);
for(const city of pickedCities){
  const {outFile} = makeCityFile(city);
  ensureIndexHas(city);
  ensureVerifyHas(city);
  touchedFiles.add(outFile);
}

// commit & push
sh('git add ' + Array.from(touchedFiles).map(f=>`"${f}"`).join(' '));
try{
  sh(`git commit -m "chore(city): add draft skeleton for ${pickedCities[0]}"`);
}catch(e){
  console.log('nothing to commit');
  process.exit(0);
}
sh('git push');
console.log('done:', pickedCities[0]);
