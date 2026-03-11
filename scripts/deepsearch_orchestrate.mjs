import fs from 'fs';
import { execSync } from 'child_process';

const PLAN_PATH = 'scripts/search_plan.json';
const BACKLOG = 'city-backlog.json';
const OUT_DIR = '重点城市速查版';

function sh(cmd){
  return execSync(cmd,{stdio:'pipe'}).toString('utf8');
}

function readJson(p){return JSON.parse(fs.readFileSync(p,'utf8'));}
function writeJson(p,obj){fs.writeFileSync(p, JSON.stringify(obj,null,2)+"\n");}

function allowed(url, allowedDomains){
  try{
    const u=new URL(url);
    const host=u.hostname;
    return allowedDomains.some(d=>d.startsWith('.') ? host.endsWith(d) : host===d || host.endsWith('.'+d));
  }catch{ return false; }
}

function extractLinksFromSearch(html){
  // very lightweight: grab http(s) links, de-dupe
  const re=/https?:\/\/[^\s"'<>]+/g;
  const m=html.match(re)||[];
  const seen=new Set();
  const out=[];
  for(const s of m){
    const clean=s.replace(/[).,;]+$/,'');
    if(!seen.has(clean)) {seen.add(clean); out.push(clean);}    
  }
  return out;
}

function pick3Todo(backlog){
  return backlog.filter(x=>x.status==='todo')
    .sort((a,b)=>(b.priority||0)-(a.priority||0))
    .slice(0,3);
}

function markDrafting(backlog, cities){
  const now=new Date().toISOString();
  for(const item of backlog){
    if(cities.includes(item.city) && item.status==='todo'){
      item.status='drafting';
      item.last_touched=now;
    }
  }
}

function ensureFile(city){
  const p=`${OUT_DIR}/${city}.md`;
  if(!fs.existsSync(p)) throw new Error(`missing city file: ${p}`);
  return p;
}

function appendEvidence(filePath, block){
  const s=fs.readFileSync(filePath,'utf8');
  if(s.includes(block.marker)) return false;
  fs.appendFileSync(filePath, `\n\n---\n\n## ✅ 严格版证据摘录（自动抓取｜待你复核）\n\n${block.content}\n`);
  return true;
}

async function webFetch(url){
  // use OpenClaw web_fetch via CLI-less: here we rely on curl as fallback
  // NOTE: keep simple; many gov sites work with curl.
  const cmd = `curl -L --max-time 20 -A 'Mozilla/5.0' ${JSON.stringify(url)}`;
  return sh(cmd);
}

const plan = readJson(PLAN_PATH);
let backlog = readJson(BACKLOG);
const pick = pick3Todo(backlog);
let cities = pick.map(x=>x.city);

// If no todo, allow continuing drafting cities (useful after skeleton stage)
if(cities.length===0){
  cities = backlog.filter(x=>x.status==='drafting')
    .sort((a,b)=>(b.priority||0)-(a.priority||0))
    .slice(0,3)
    .map(x=>x.city);
}

if(cities.length===0){
  console.log('no todo/drafting city');
  process.exit(0);
}

// mark picked as deepsearching (state machine)
const now=new Date().toISOString();
for(const item of backlog){
  if(cities.includes(item.city)){
    item.status='deepsearching';
    item.last_touched=now;
  }
}
writeJson(BACKLOG, backlog);

const touched = new Set([PLAN_PATH, BACKLOG]);

for(const city of cities){
  const filePath = ensureFile(city);
  const marker = `AUTO_EVIDENCE_${city}_${new Date().toISOString().slice(0,10)}`;

  let content = `<!-- ${marker} -->\n`;
  content += `> 说明：以下为“搜索结果页 → 官方域名链接 → 原文页面”自动抓取摘录。请你人工复核关键数字。\n\n`;

  // crude city gov hint
  const cityGovHint = `${city}市人民政府`;

  for(const field of plan.fields){
    content += `### ${field.name}\n`;
    const queries = field.queries.slice(0,3);
    for(const qtpl of queries){
      const q = qtpl
        .replaceAll('{city}', city)
        .replaceAll('{cityGov}', 'gov.cn');

      // try multiple engines
      const urls = Object.values(plan.engines).map(t=>t.replace('{q}', encodeURIComponent(q)));
      let found = [];
      for(const surl of urls){
        try{
          const html = await webFetch(surl);
          const links = extractLinksFromSearch(html)
            .filter(u=>allowed(u, plan.allowedDomains));
          for(const l of links){
            if(!found.includes(l)) found.push(l);
          }
          if(found.length>=5) break;
        }catch{ /* ignore */ }
      }

      found = found.slice(0,5);
      if(found.length===0){
        content += `- query: ${q}\n  - 未抓到可用官方链接（可能验证码/反爬）\n`;
        continue;
      }

      content += `- query: ${q}\n`;
      for(const l of found){
        content += `  - ${l}\n`;
      }

      // fetch first 1-2 pages and include a short excerpt
      for(const l of found.slice(0,2)){
        try{
          const page = await webFetch(l);
          const excerpt = page
            .replace(/\s+/g,' ')
            .slice(0,600);
          content += `\n  摘录（前600字，需复核）：${excerpt}\n`;
        }catch{ /* ignore */ }
      }
    }
    content += `\n`;
  }

  const changed = appendEvidence(filePath, { marker, content });
  if(changed) touched.add(filePath);
}

sh('git add ' + Array.from(touched).map(f=>`"${f}"`).join(' '));
try{
  sh(`git commit -m "feat: add deepsearch plan + evidence blocks (3-city batch)"`);
}catch{
  console.log('nothing to commit');
  process.exit(0);
}
sh('git push');
console.log('done:', cities.join(', '));
