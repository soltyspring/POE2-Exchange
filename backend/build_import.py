"""Public Mobalytics build retrieval and deterministic structure analysis.

Uses the endpoint supplied in export_mobalytics_build.ps1. No credentials,
arbitrary URL fetches, browser automation, DB writes or AI calls.
"""
from __future__ import annotations

import asyncio
import copy
import json
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

router = APIRouter()
ENDPOINT = 'https://mobalytics.gg/api/poe-2/v1/graphql/query'
QUERY = Path(__file__).with_name('mobalytics_build.gql').read_text(encoding='utf-8')
NAMES_KR = json.loads(Path(__file__).with_name('build_names_kr.json').read_text(encoding='utf-8'))


def korean_build_name(name, slug=None):
    if name:
        key = re.sub(r'\s+', ' ', name.strip().lower()).replace('’', "'")
        if key in NAMES_KR:
            return NAMES_KR[key]
    if slug:
        identifier = re.sub(r'^(?:gem|skill|support|jewel)-', '', slug)
        if 'skill:' + identifier in NAMES_KR:
            return NAMES_KR['skill:' + identifier]
        key = identifier.replace('-', ' ')
        if key in NAMES_KR:
            return NAMES_KR[key]
    return name or slug or '이름 미제공'
TTL = 300
MAX_BYTES = 8 * 1024 * 1024
_cache: dict[str, tuple[float, dict]] = {}
_gate = asyncio.Semaphore(2)
_blocked_until = 0.0
SLOTS = {'helmet': '투구', 'body': '갑옷', 'gloves': '장갑', 'boots': '장화',
         'amulet': '목걸이', 'belt': '허리띠', 'leftRing': '왼쪽 반지', 'rightRing': '오른쪽 반지',
         'extraRing': '추가 반지', 'flask1': '플라스크 1', 'flask2': '플라스크 2',
         'charm1': '부적 1', 'charm2': '부적 2', 'charm3': '부적 3'}


class BuildRequest(BaseModel):
    url: str = Field(min_length=1, max_length=2048)


def parse_build_url(value: str) -> tuple[str, str]:
    try:
        parts = urlsplit(value.strip())
        valid = parts.scheme == 'https' and parts.hostname in {'mobalytics.gg', 'www.mobalytics.gg'}
        valid = valid and not parts.username and not parts.password and parts.port in {None, 443}
    except ValueError:
        valid = False
    match = re.fullmatch(r'/poe-2/profile/([A-Za-z0-9_-]+)/builds/([0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12})/?', parts.path) if valid else None
    if not match:
        raise HTTPException(400, 'Mobalytics의 POE2 빌드 공유 링크를 입력해 주세요. 프로필이나 POE1 링크는 지원하지 않습니다.')
    build_id = match[2].lower()
    return build_id, f'https://mobalytics.gg/poe-2/profile/{match[1]}/builds/{build_id}'


def _list(value):
    return value if isinstance(value, list) else []


def _dict(value):
    return value if isinstance(value, dict) else {}


def analyze_document(document: dict) -> dict:
    data = document.get('data') or {}
    labels = {}
    for widget in _list(document.get('content')):
        if widget.get('__typename') == 'NgfDocumentCmWidgetContentVariantsV1':
            for item in _list((widget.get('data') or {}).get('childrenVariants')):
                labels[item.get('id')] = item.get('title')
    variants = []
    for index, variant in enumerate(_list((data.get('buildVariants') or {}).get('values'))):
        equipment = variant.get('equipment') or {}
        items = []

        def add_item(slot, label, value):
            value = value or {}
            common = value.get('commonItem') or {}
            if not common:
                return
            items.append({'slot': slot, 'slot_label': label, 'name': korean_build_name(common.get('name'), common.get('slug')),
                          'unique': bool(common.get('isUnique')), 'item_class': common.get('itemClassSlug'), 'icon': common.get('iconURL'),
                          'explicit': _list(common.get('explicitDescriptions')), 'implicit': _list(common.get('implicitDescriptions')),
                          'stats': _list(common.get('stats')), 'requirements': _list(common.get('requirements')),
                          'runes': _list(value.get('runes')), 'anointment': (value.get('anointment') or {}).get('slug')})

        for slot, label in SLOTS.items():
            add_item(slot, label, equipment.get(slot))
        for slot, label in [('mainHand', '주무기'), ('offHand', '보조무기')]:
            for set_id in ['set1', 'set2']:
                add_item(f'{slot}.{set_id}', f'{label} · 세트 {set_id[-1]}', (equipment.get(slot) or {}).get(set_id))
        skills = variant.get('skillGems') or {}
        priority_names = {gem.get('gemSlug'): gem.get('name') for gem in _list(skills.get('priorityGems'))}
        gems = []
        for gem in _list(skills.get('gems')):
            active = gem.get('activeSkill') or {}
            if active:
                gems.append({'name': korean_build_name(active.get('name'), active.get('gemSlug')),
                             'slug': active.get('gemSlug'), 'icon': active.get('iconURL') or active.get('gemIconURL'),
                             'level': active.get('level'), 'weapon_set': gem.get('weaponSet'),
                             'supports': [{**support, 'name': korean_build_name(priority_names.get(support.get('gemSlug')), support.get('gemSlug'))} for support in _list(gem.get('subSkills'))]})
        passive = variant.get('passiveTree') or {}
        tree = {key: list(dict.fromkeys(_list((passive.get(key) or {}).get('selectedSlugs'))))
                for key in ['mainTree', 'set1Tree', 'set2Tree', 'ascendancyTree']}
        atlas = {key: list(dict.fromkeys(_list((value or {}).get('selectedSlugs'))))
                 for key, value in (variant.get('atlasTree') or {}).items()}
        populated = bool(items or gems or any(tree.values()) or any(atlas.values()))
        variants.append({'id': variant.get('id') or f'variant-{index}', 'name': labels.get(variant.get('id')) or f'구성 {index + 1}',
                         'populated': populated, 'equipment': items, 'skills': gems, 'gem_requirements': skills.get('gemRequirements'),
                         'passives': tree, 'passive_priority': {key: _list((passive.get(key) or {}).get('priorityList')) for key in ['mainTree', 'ascendancyTree']},
                         'jewels': _list(passive.get('jewels')), 'atlas': atlas,
                         'counts': {'equipment': len(items), 'unique': sum(item['unique'] for item in items),
                                    'skills': len(gems), 'supports': sum(len(g['supports']) for g in gems),
                                    'passives': len(tree['mainTree']), 'ascendancy': len(tree['ascendancyTree']),
                                    'jewels': len(_list(passive.get('jewels'))), 'atlas': len(set(n for nodes in atlas.values() for n in nodes))}})
    return {'name': data.get('name') or '이름 없는 빌드', 'author': (document.get('author') or {}).get('name') or '작성자 미제공',
            'updated_at': document.get('updatedAt'), 'variants': variants,
            'default_variant_id': next((v['id'] for v in variants if v['populated']), variants[0]['id'] if variants else None),
            'has_pob': bool(data.get('pobCode')), 'has_loot_filter': bool(data.get('lootFilter')),
            'notes': ['공유 문서에 저장된 장비·젬·노드를 정리한 결과입니다. DPS나 생존력 계산은 포함하지 않습니다.',
                      '장비 개수에는 무기 세트 1·2가 모두 포함됩니다. 패시브는 저장된 노드 수이며 총 소모 포인트와 다를 수 있습니다.',
                      '아이템·젬 이름은 서미누기 게임 데이터와 대조한 한국어 명칭입니다. 미일치 이름은 원문을 유지하며 빌드 JSON은 원본 데이터입니다. 보조 스킬에는 하위 스킬도 포함될 수 있습니다.']}


async def fetch_document(build_id: str) -> dict:
    global _blocked_until
    if time.monotonic() < _blocked_until:
        raise HTTPException(429, 'Mobalytics 요청 제한 중입니다. 잠시 후 다시 시도해 주세요.', headers={'Retry-After': str(max(1, int(_blocked_until-time.monotonic())))})
    try:
        async with httpx.AsyncClient(timeout=25, follow_redirects=False) as client:
            async with client.stream('POST', ENDPOINT, json={'operationName': 'Poe2UgNormalDocumentByIdQuery', 'query': QUERY,
                                     'variables': {'input': {'id': build_id}}},
                                     headers={'User-Agent': 'POE2Market/0.1 BuildExporter', 'Accept': 'application/json',
                                              'Referer': 'https://mobalytics.gg/', 'Origin': 'https://mobalytics.gg'}) as response:
                if response.status_code == 429:
                    retry = response.headers.get('Retry-After', '60')
                    delay = min(3600, max(30, int(retry))) if retry.isdigit() else 60
                    _blocked_until = time.monotonic() + delay
                    raise HTTPException(429, 'Mobalytics 요청 제한 중입니다. 잠시 후 다시 시도해 주세요.', headers={'Retry-After': str(delay)})
                if response.status_code in {401, 403}:
                    raise HTTPException(403, 'Mobalytics가 접근을 허용하지 않았습니다. 로그인 없이 공개된 빌드인지 확인해 주세요.')
                if response.status_code == 404:
                    raise HTTPException(404, '빌드를 찾을 수 없습니다. 링크와 공유 설정을 확인해 주세요.')
                if response.status_code != 200:
                    raise HTTPException(502, 'Mobalytics 응답에 문제가 있습니다. 잠시 후 다시 시도해 주세요.')
                body = bytearray()
                async for chunk in response.aiter_bytes():
                    body.extend(chunk)
                    if len(body) > MAX_BYTES:
                        raise HTTPException(502, '빌드 데이터가 지원 크기를 초과했습니다.')
        payload = json.loads(body)
    except httpx.TimeoutException as exc:
        raise HTTPException(504, '빌드를 가져오는 데 시간이 오래 걸립니다. 잠시 후 다시 시도해 주세요.') from exc
    except (httpx.HTTPError, ValueError) as exc:
        raise HTTPException(502, 'Mobalytics 데이터를 읽지 못했습니다. 잠시 후 다시 시도해 주세요.') from exc
    if not isinstance(payload, dict) or payload.get('errors'):
        raise HTTPException(502, 'Mobalytics 빌드 데이터 형식이 변경되었거나 조회에 실패했습니다.')
    container = _dict(_dict(_dict(payload.get('data')).get('game')).get('documents'))
    container = _dict(container.get('userGeneratedDocumentById'))
    document = container.get('data')
    if container.get('error') or not isinstance(document, dict) or not _dict(document.get('data')):
        raise HTTPException(404, '공개 빌드 데이터를 찾지 못했습니다. 링크와 공유 설정을 확인해 주세요.')
    if document.get('status') != 'PUBLISHED' or document.get('id') != build_id:
        raise HTTPException(404, '공개된 빌드만 가져올 수 있습니다. 공유 설정을 확인해 주세요.')
    return document


async def _load_build(build_id: str):
    async with _gate:
        cached = _cache.get(build_id)
        is_cached = bool(cached and time.monotonic() - cached[0] < TTL)
        if is_cached:
            result = copy.deepcopy(cached[1])
        else:
            document = await fetch_document(build_id)
            result = {'build_id': build_id, 'fetched_at': datetime.now(timezone.utc).isoformat(),
                      'analysis': analyze_document(document), 'document': document}
            if len(_cache) >= 32:
                _cache.pop(next(iter(_cache)))
            _cache[build_id] = (time.monotonic(), copy.deepcopy(result))
        return result, is_cached


@router.post('/api/builds/mobalytics')
async def import_build(payload: BuildRequest):
    build_id, source_url = parse_build_url(payload.url)
    try:
        result, is_cached = await asyncio.wait_for(_load_build(build_id), timeout=35)
    except asyncio.TimeoutError as exc:
        raise HTTPException(504, '빌드 요청이 지연되고 있습니다. 잠시 후 다시 시도해 주세요.') from exc
    return {**result, 'source_url': source_url, 'cached': is_cached, 'cache_seconds': TTL}
