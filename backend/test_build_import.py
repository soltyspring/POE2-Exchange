import asyncio
import unittest
from unittest.mock import AsyncMock, patch

import httpx
from fastapi import FastAPI, HTTPException
from build_import import BuildRequest, analyze_document, fetch_document, import_build, parse_build_url, router
import build_import as module

ID = 'ceb4700a-5adb-4162-be37-b0593958aff3'
URL = f'https://mobalytics.gg/poe-2/profile/iron-key-im2mtp/builds/{ID}'


def document():
    return {'id': ID, 'status': 'PUBLISHED', 'author': {'name': 'Author'}, 'data': {'name': 'Test build', 'buildVariants': {'values': [
        {'id': 'empty', 'equipment': {'mainHand': {'set1': {'commonItem': None}}}},
        {'id': 'ready', 'equipment': {'helmet': {'commonItem': {'name': '<script>item</script>', 'isUnique': True}},
                                     'mainHand': {'set1': {'commonItem': {'name': 'Weapon 1'}}, 'set2': {'commonItem': {'name': 'Weapon 2'}}}},
         'skillGems': {'gems': [{'activeSkill': {'name': 'Skill', 'level': 20}, 'subSkills': [{'gemSlug': 'support'}]}]},
         'passiveTree': {'mainTree': {'selectedSlugs': ['a', 'a', 'b']}, 'ascendancyTree': {'selectedSlugs': ['c']}},
         'atlasTree': {'ritualTree': {'selectedSlugs': ['ritual']}}}
    ]}}, 'content': [{'__typename': 'NgfDocumentCmWidgetContentVariantsV1', 'data': {'childrenVariants': [{'id': 'ready', 'title': 'Final'}]}}]}


class BuildImportTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        module._cache.clear()
        module._blocked_until = 0
        module._gate = asyncio.Semaphore(2)

    def test_only_https_build_urls_on_exact_host(self):
        self.assertEqual(parse_build_url(URL + '?utm_source=test')[0], ID)
        for value in ['http://127.0.0.1/a', URL.replace('https:', 'http:'), URL.replace('mobalytics.gg', 'mobalytics.gg.attacker.com'),
                      URL.replace('https://', 'https://user:password@'), URL.replace('.gg/', '.gg:8443/'),
                      URL.replace('poe-2', 'poe'), URL.replace(ID, '../secret'), 'https://mobalytics.gg/poe-2/profile/user']:
            with self.subTest(value=value), self.assertRaises(HTTPException) as caught:
                parse_build_url(value)
            self.assertEqual(caught.exception.status_code, 400)

    def test_empty_default_and_weapon_sets_are_preserved(self):
        summary = analyze_document(document())
        self.assertEqual(summary['default_variant_id'], 'ready')
        self.assertFalse(summary['variants'][0]['populated'])
        ready = summary['variants'][1]
        self.assertEqual(ready['name'], 'Final')
        self.assertEqual(ready['counts']['equipment'], 3)
        self.assertEqual(ready['counts']['passives'], 2)
        self.assertEqual(ready['counts']['supports'], 1)
        self.assertEqual(ready['counts']['atlas'], 1)

    async def test_invalid_url_never_fetches_and_cache_is_bounded(self):
        with patch('build_import.fetch_document', new_callable=AsyncMock, return_value=document()) as fetch:
            with self.assertRaises(HTTPException):
                await import_build(BuildRequest(url='https://localhost/'))
            fetch.assert_not_awaited()
            first = await import_build(BuildRequest(url=URL))
            first['document']['data']['name'] = 'changed'
            second = await import_build(BuildRequest(url=URL))
            fetch.assert_awaited_once()
            self.assertTrue(second['cached'])
            self.assertEqual(second['document']['data']['name'], 'Test build')

    async def test_fixed_endpoint_and_document_access_checks(self):
        real_client = httpx.AsyncClient
        for status in ['PUBLISHED', 'DRAFT']:
            doc = document(); doc['status'] = status
            def upstream(request):
                self.assertEqual(str(request.url), module.ENDPOINT)
                self.assertNotIn('password', request.content.decode())
                return httpx.Response(200, json={'data': {'game': {'documents': {'userGeneratedDocumentById': {'data': doc}}}}})
            with patch('build_import.httpx.AsyncClient', side_effect=lambda **kwargs: real_client(transport=httpx.MockTransport(upstream), **kwargs)):
                if status == 'PUBLISHED':
                    self.assertEqual((await fetch_document(ID))['id'], ID)
                else:
                    with self.assertRaises(HTTPException) as caught:
                        await fetch_document(ID)
                    self.assertEqual(caught.exception.status_code, 404)

    async def test_rate_limit_stops_a_second_upstream_request(self):
        real_client = httpx.AsyncClient
        hits = []
        def upstream(request):
            hits.append(request)
            return httpx.Response(429, headers={'Retry-After': '120'})
        with patch('build_import.httpx.AsyncClient', side_effect=lambda **kwargs: real_client(transport=httpx.MockTransport(upstream), **kwargs)):
            for _ in range(2):
                with self.assertRaises(HTTPException) as caught:
                    await fetch_document(ID)
                self.assertEqual(caught.exception.status_code, 429)
        self.assertEqual(len(hits), 1)

    async def test_api_contract_no_background_collector(self):
        app = FastAPI(); app.include_router(router)
        with patch('build_import.fetch_document', new_callable=AsyncMock, return_value=document()):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://local') as client:
                response = await client.post('/api/builds/mobalytics', json={'url': URL})
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json()['analysis']['default_variant_id'], 'ready')
                self.assertEqual((await client.post('/api/builds/mobalytics', json={'url': URL * 100})).status_code, 422)


if __name__ == '__main__':
    unittest.main()
