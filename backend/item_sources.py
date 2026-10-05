"""Public Scout catalogue and manually reviewed official trade search preparation."""
import json
import re
import time
from datetime import datetime
from urllib.parse import quote

from pydantic import BaseModel, Field


class InspectItem(BaseModel):
    league: str = Field(min_length=1, max_length=120)
    text: str = Field(min_length=1, max_length=20000)


def inspect_item(payload):
    blocks = re.split(r'\n-{4,}\n', payload.text.replace('\r', '').strip())
    header = [line.strip() for line in blocks[0].splitlines() if line.strip()]
    rarity = next((line.split(':', 1)[1].strip() for line in header
                   if line.startswith(('희귀도:', 'Rarity:'))), None)
    names = [line for line in header if not line.startswith(('아이템 종류:', '아이템 클래스:', 'Item Class:', '희귀도:', 'Rarity:'))]
    if not rarity or not names:
        raise ValueError('게임에서 복사한 아이템 텍스트를 붙여 넣어 주세요.')
    properties, modifiers, other = [], [], []
    for block in blocks[1:]:
        lines = [line.strip() for line in block.splitlines() if line.strip()]
        if any(line.startswith(('요구 사항:', '요구사항:', 'Requirements:', '아이템 레벨:', 'Item Level:',
                                '미확인', 'Unidentified', '타락', 'Corrupted', '참고:', 'Note:')) for line in lines):
            other.extend(lines)
        elif any(line.startswith(('방어도:', '회피:', '회피도:', '에너지 보호막:', '퀄리티:', 'Quality:',
                                  'Armour:', 'Evasion Rating:', 'Energy Shield:', '물리 피해:', 'Physical Damage:',
                                  '공격 속도:', 'Attacks per Second:')) for line in lines):
            properties.extend(lines)
        else:
            # Preserve source lines; do not pretend to resolve undocumented stat identifiers.
            modifiers.extend(lines)
    return dict(name=names[0] if len(names) > 1 else None, baseType=names[-1], rarity=rarity,
                properties=properties, modifierCandidates=modifiers, other=other,
                tradeUrl='https://www.pathofexile.com/trade2/search/poe2/' + quote(payload.league, safe=''),
                state='manual_comparison',
                note='베이스와 옵션을 공식 거래 사이트에서 확인해 검색하세요. 자동 매물 조회나 가격 추정은 수행하지 않습니다.')


def init_source_tables(db):
    db.execute('''CREATE TABLE IF NOT EXISTS scout_catalog (
        league TEXT NOT NULL, item_id INTEGER NOT NULL, payload TEXT NOT NULL,
        fetched_at INTEGER NOT NULL, PRIMARY KEY (league,item_id))''')


def timestamp(value):
    try:
        # .NET emits seven fractional digits; Ubuntu Python 3.10 accepts six.
        value = re.sub(r'(\.\d{6})\d+', r'\1', value.replace('Z', '+00:00'))
        return int(datetime.fromisoformat(value).timestamp())
    except (TypeError, ValueError, AttributeError):
        return None


def save_catalog(connect, league, items, histories, league_info, translate):
    if not isinstance(items, list) or not items or not isinstance(histories.get('ItemHistories'), list):
        raise ValueError('Invalid Scout catalogue response; previous data retained')
    logs = {int(entry['ItemId']): entry.get('History', []) for entry in histories['ItemHistories']}
    unit = league_info.get('BaseCurrencyApiId')
    rows = []
    now = int(time.time())
    for item in items:
        item_id = int(item['ItemId'])
        history = [log for log in logs.get(item_id, []) if timestamp(log.get('Time')) is not None]
        latest = max(history, key=lambda log: timestamp(log['Time']), default=None)
        record = dict(id=f'scout:{item_id}', name=translate(item.get('Name') or item['Text']),
                      baseType=translate(item.get('Type')), originalName=item.get('Name'),
                      originalText=item['Text'], category=item['CategoryApiId'], apiId=item.get('ApiId'),
                      kind='unique' if item.get('Name') else 'consumable', icon=item.get('IconUrl'),
                      rawCurrentPrice=item.get('CurrentPrice'), priceUnit=unit,
                      priceExalted=latest.get('Price') if latest and unit == 'exalted' else None,
                      observedAt=timestamp(latest['Time']) if latest else None,
                      source='poe2scout', fetchedAt=now)
        rows.append((league, item_id, json.dumps(record, ensure_ascii=False), now))
    db = connect()
    try:
        with db:
            db.execute('DELETE FROM scout_catalog WHERE league=?', (league,))
            db.executemany('INSERT INTO scout_catalog VALUES (?,?,?,?)', rows)
    finally:
        db.close()
    return len(rows)


def combined_catalog(connect, league):
    db = connect()
    try:
        ninja = [dict(row) for row in db.execute(
            'SELECT id,name,base_type,category,price_divine,observed_at FROM markets WHERE league=?', (league,))]
        scout = [json.loads(row[0]) for row in db.execute(
            'SELECT payload FROM scout_catalog WHERE league=? ORDER BY item_id', (league,))]
    finally:
        db.close()
    name_index, api_index = {}, {}
    def norm(value):
        return ' '.join((value or '').casefold().split())
    for item in ninja:
        name_index.setdefault((norm(item['name']), norm(item['base_type'])), []).append(item['id'])
        if item['id'].startswith('exchange:'):
            api_index.setdefault(item['id'].split(':', 2)[-1], []).append(item['id'])
    now = int(time.time())
    for item in scout:
        matches = api_index.get(item['apiId'], []) if item['apiId'] else name_index.get((norm(item['name']), norm(item['baseType'])), [])
        item['ninjaMatchCandidates'] = matches
        observed = item['observedAt']
        item['state'] = 'missing' if observed is None else 'ready' if 0 <= now - observed <= 1800 else 'stale'
        if item['state'] != 'ready':
            item['priceExalted'] = None
    unmatched = [item for item in scout if not item['ninjaMatchCandidates']]
    return dict(league=league, ninja=ninja, scout=scout, scoutAdditional=unmatched,
                counts=dict(ninja=len(ninja), scout=len(scout), scoutUnmatched=len(unmatched)),
                note='일치 후보는 베이스/이름 또는 API id 기준입니다. 고유 변형의 완전한 동일성을 보장하지 않습니다.')
