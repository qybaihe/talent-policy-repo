#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import subprocess
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Tuple

REPO_DIR = Path('/root/.openclaw/workspace/talent-policy-repo')
BACKLOG = REPO_DIR / 'city-backlog.json'
CITY_DIR = REPO_DIR / '重点城市速查版'
STATE_DIR = REPO_DIR / 'controller'
STATE_PATH = STATE_DIR / 'deepsearch_state.json'
PROMPT_PATH = REPO_DIR / 'scripts' / 'deepsearch_task_prompt.txt'
WORKERS = 3

PLACEHOLDER_MARKERS = ['首轮骨架', '待复核', '待补链', '待补', '严格核验版框架', '深挖受阻']
REQUIRED_HINTS = ['区', '链接', '金额', '有效期']


def load_json(path: Path, default):
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding='utf-8'))


def save_json(path: Path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding='utf-8')


def sh(args: List[str], cwd: Path | None = None) -> str:
    return subprocess.check_output(args, cwd=str(cwd or REPO_DIR), text=True).strip()


def git_status() -> str:
    return sh(['git', 'status', '--porcelain'])


def commit_if_needed(message: str) -> bool:
    if not git_status():
        return False
    sh(['git', 'add', '-A'])
    sh(['git', 'commit', '-m', message])
    sh(['git', 'push'])
    return True


def quality_check(path: Path) -> Tuple[bool, List[str]]:
    if not path.exists():
        return False, ['missing']
    text = path.read_text(encoding='utf-8', errors='ignore')
    issues = []
    for m in PLACEHOLDER_MARKERS:
        if m in text:
            issues.append(f'placeholder:{m}')
            break
    for h in REQUIRED_HINTS:
        if h not in text:
            issues.append(f'missing_hint:{h}')
    if 'http' not in text:
        issues.append('missing_links')
    district_mentions = sum(text.count(x) for x in ['鼓楼', '台江', '仓山', '晋安', '红谷滩', '东湖', '西湖', '五华', '盘龙', '官渡'])
    if district_mentions < 2:
        issues.append('missing_districts')
    return len(issues) == 0, issues


def load_backlog() -> List[Dict]:
    return load_json(BACKLOG, [])


def save_backlog(backlog: List[Dict]):
    save_json(BACKLOG, backlog)


def existing_city_files() -> Dict[str, Path]:
    out = {}
    for p in CITY_DIR.glob('*.md'):
        out[p.stem] = p
    return out


def build_candidates(backlog: List[Dict], limit: int = 20) -> List[Dict]:
    files = existing_city_files()
    candidates = []
    for item in sorted(backlog, key=lambda x: -(x.get('priority') or 0)):
        city = item['city']
        status = item.get('status', 'todo')
        p = files.get(city)
        if p:
            ok, issues = quality_check(p)
            if not ok:
                candidates.append({'city': city, 'reason': 'rewrite', 'issues': issues})
            elif status != 'done':
                item['status'] = 'done'
            continue
        if status != 'done':
            candidates.append({'city': city, 'reason': 'todo', 'issues': []})
        if len(candidates) >= limit:
            break
    return candidates


def spawn_blueprint(city: str) -> Dict:
    prompt = PROMPT_PATH.read_text(encoding='utf-8').replace('{city}', city)
    return {
        'city': city,
        'cwd': str(REPO_DIR),
        'label': f'talent-deep-{city}',
        'task': prompt,
        'runtime': 'subagent',
        'mode': 'run',
        'timeoutSeconds': 3600,
        'sandbox': 'inherit'
    }


def sync_completed(backlog: List[Dict]) -> List[str]:
    completed = []
    for item in backlog:
        city = item['city']
        p = CITY_DIR / f'{city}.md'
        if p.exists():
            ok, _ = quality_check(p)
            if ok and item.get('status') in {'deepsearching', 'drafting', 'todo'}:
                item['status'] = 'done'
                item['last_touched'] = datetime.now().isoformat(timespec='seconds')
                completed.append(city)
    if completed:
        save_backlog(backlog)
        commit_if_needed(f"docs: deepen city policy notes ({', '.join(completed[:5])})")
    return completed


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--workers', type=int, default=WORKERS)
    args = parser.parse_args()

    STATE_DIR.mkdir(parents=True, exist_ok=True)
    state = load_json(STATE_PATH, {'running': []})
    backlog = load_backlog()

    completed = sync_completed(backlog)

    running = state.get('running', [])
    running_cities = {r['city'] for r in running}
    candidates = [c for c in build_candidates(backlog) if c['city'] not in running_cities]
    open_slots = max(0, args.workers - len(running))
    launches = candidates[:open_slots]

    launched = []
    now = datetime.now().isoformat(timespec='seconds')
    for c in launches:
        launched.append({
            'city': c['city'],
            'reason': c['reason'],
            'issues': c['issues'],
            'started_at': now,
            'spawn_blueprint': spawn_blueprint(c['city'])
        })
        for item in backlog:
            if item['city'] == c['city']:
                item['status'] = 'deepsearching'
                item['last_touched'] = now
                break
    save_backlog(backlog)

    new_running = running + [{k: v for k, v in x.items() if k != 'spawn_blueprint'} for x in launched]
    payload = {
        'generated_at': now,
        'workers': args.workers,
        'actions': {
            'completed_since_last_run': completed,
            'launched': launched,
            'running_before': running,
            'running_after': new_running,
            'rewrite_preview': [c for c in candidates if c['reason'] == 'rewrite'][:10]
        },
        'summary': {
            'completed_count': len(completed),
            'launch_count': len(launched),
            'running_count': len(new_running),
            'open_slots': max(0, args.workers - len(new_running)),
            'backlog_total': len(backlog),
            'backlog_done': sum(1 for x in backlog if x.get('status') == 'done')
        },
        'running': new_running
    }
    save_json(STATE_PATH, payload)
    print(json.dumps(payload, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
