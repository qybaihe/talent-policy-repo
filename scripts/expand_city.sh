#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

BACKLOG="$REPO_ROOT/city-backlog.json"
TEMPLATE="$REPO_ROOT/templates/city.md"
OUT_DIR="$REPO_ROOT/重点城市速查版"
INDEX_MD="$OUT_DIR/README.md"
VERIFY_MD="$REPO_ROOT/待复核清单.md"

if [[ ! -f "$BACKLOG" ]]; then
  echo "missing backlog: $BACKLOG" >&2
  exit 1
fi

CITY=$(node - <<'NODE'
const fs=require('fs');
const backlog=JSON.parse(fs.readFileSync('city-backlog.json','utf8'));
const pick=backlog
  .filter(x=>x.status==='todo')
  .sort((a,b)=>(b.priority||0)-(a.priority||0))[0];
if(!pick){process.exit(2);} // no todo
process.stdout.write(pick.city);
NODE
) || code=$?

if [[ "${code:-0}" -eq 2 ]]; then
  echo "no todo city";
  exit 0
fi

DATE=$(date +%F)
OUT_FILE="$OUT_DIR/${CITY}.md"

mkdir -p "$OUT_DIR" "$REPO_ROOT/templates" "$REPO_ROOT/scripts"

if [[ ! -f "$OUT_FILE" ]]; then
  python3 - <<PY 2>/dev/null || node - <<'NODE'
const fs=require('fs');
const city=process.env.CITY;
const date=process.env.DATE;
let tpl=fs.readFileSync('templates/city.md','utf8');
tpl=tpl.replaceAll('{{CITY}}',city).replaceAll('{{DATE}}',date);
fs.writeFileSync(`重点城市速查版/${city}.md`,tpl);
NODE
  
else
  echo "exists: $OUT_FILE; skip file creation"
fi

# Append index entry if missing
if [[ -f "$INDEX_MD" ]]; then
  if ! grep -q "\[${CITY}\.md\]" "$INDEX_MD"; then
    printf "\n- [%s](%s.md)（首轮骨架）\n" "$CITY" "$CITY" >> "$INDEX_MD"
  fi
else
  printf "# 重点城市速查版\n\n- [%s](%s.md)（首轮骨架）\n" "$CITY" "$CITY" > "$INDEX_MD"
fi

# Append verify skeleton line
if ! grep -q "^## ${CITY}$" "$VERIFY_MD"; then
  printf "\n## %s\n- 待复核：学历/年龄/社保/补贴口径/区县差异/政策有效期\n" "$CITY" >> "$VERIFY_MD"
fi

# Update backlog status
node - <<'NODE'
const fs=require('fs');
const path='city-backlog.json';
const backlog=JSON.parse(fs.readFileSync(path,'utf8'));
const city=process.env.CITY;
const now=new Date().toISOString();
let changed=false;
for(const item of backlog){
  if(item.city===city && item.status==='todo'){
    item.status='drafting';
    item.last_touched=now;
    changed=true;
    break;
  }
}
if(changed) fs.writeFileSync(path, JSON.stringify(backlog,null,2)+"\n");
NODE

# Commit (one city per run)
git add "$OUT_FILE" "$INDEX_MD" "$VERIFY_MD" "$BACKLOG"

git commit -m "chore(city): add draft skeleton for ${CITY}" || true
