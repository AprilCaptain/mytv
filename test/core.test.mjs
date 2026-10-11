import test from 'node:test';
import assert from 'node:assert/strict';
import { createApi } from '../lib/api.mjs';
import { parsePayload, parseLines } from '../lib/providers.mjs';
import { Playback } from '../lib/playback.mjs';
import { isPublicAddress, remoteFetch, toWebStream, discardStream } from '../lib/network.mjs';
import { PassThrough } from 'node:stream';

const origin = 'http://127.0.0.1:3210';
const configUrl = 'https://config.example/list/config.json';
const sample = {
  vod_id: 42, vod_name: '<b>测试影片</b>', vod_pic: 'https://images.example/poster.jpg',
  vod_content: '<p>一段简介 &amp; 故事。</p>', vod_remarks: '更新第2集',
  vod_play_from: '网页$$$HLS',
  vod_play_url: '第一集$https://media.example/share/1$$$第一集$https://media.example/main.m3u8#第二集$https://media.example/second.m3u8'
};
const xmlSample = '<?xml version="1.0"?><rss><list page="2" pagecount="3" recordcount="21">' +
  '<video><id>7</id><tid>4</tid><name><![CDATA[动漫 & 测试]]></name><pic>https://images.example/a.jpg</pic>' +
  '<dl><dd flag="hls"><![CDATA[第一集$https://media.example/main.m3u8#第二集$https://media.example/second.m3u8]]></dd></dl>' +
  '</video></list><class><ty id="4">动漫</ty></class></rss>';

function fixture() {
  const calls = [];
  const fetcher = async (raw, options = {}) => {
    const url = new URL(raw);
    calls.push({ url, options });
    if (raw === configUrl) return Response.json({ sites: [
      { key: 'json', name: 'JSON 源', type: 1, api: '../json', header: { Referer: 'https://source.example/' } },
      { key: 'xml', name: 'XML 源', type: 0, api: '../xml' },
      { key: 'jar', name: '插件源', type: 3, api: 'csp_Test' }
    ] });
    if (url.pathname === '/json') {
      if (url.searchParams.get('ac') === 'list')
        return Response.json({ list: [{ vod_id: 42 }], class: [{ type_id: 1, type_name: '电影', type_pid: 0 }] });
      return Response.json({ list: [sample], page: url.searchParams.get('pg') || 1, pagecount: 3, total: 42 });
    }
    if (url.pathname === '/xml') return new Response(xmlSample);
    if (url.pathname.endsWith('main.m3u8')) {
      const response = new Response('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1200000\nvideo/playlist.m3u8\n',
        { headers: { 'content-type': 'application/vnd.apple.mpegurl' } });
      Object.defineProperty(response, 'url', { value: 'https://cdn.example/redirected/main.m3u8' });
      return response;
    }
    if (url.pathname.endsWith('playlist.m3u8'))
      return new Response('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="../key.bin"\n#EXT-X-MAP:URI="init.mp4"\n' +
        '#EXTINF:5,\nseg.ts?token=a%2Bb\n#EXT-X-ENDLIST\n');
    if (options.headers?.range) return new Response(new Uint8Array([1, 2, 3]), {
      status: 206, headers: { 'content-type': 'video/mp4', 'content-range': 'bytes 10-12/100', 'accept-ranges': 'bytes' }
    });
    return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'video/mp2t' } });
  };
  const api = createApi(fetcher);
  const call = (path, options = {}) => api(new Request(origin + path, {
    ...options, headers: { ...(options.body ? { 'content-type': 'application/json' } : {}), ...options.headers },
    body: options.body ? JSON.stringify(options.body) : undefined
  }));
  return { calls, fetcher, call };
}

async function imported(f) {
  const response = await f.call('/api/config', { method: 'POST', body: { url: configUrl } });
  assert.equal(response.status, 200);
  return response.json();
}

test('导入配置，正确解析相对路径并明确区分 Android 插件', async () => {
  const f = fixture(); const config = await imported(f);
  assert.equal(config.supported, 2);
  assert.equal(config.sources[2].supported, false);
  assert.match(config.sources[2].reason, /Android/);
  await f.call('/api/categories?source=' + config.sources[0].id);
  assert.equal(f.calls.at(-1).url.href, 'https://config.example/json?ac=list');
});

test('搜索与分页保留中文参数，并把 HTML 内容转换成文本', async () => {
  const f = fixture(); const config = await imported(f);
  const query = new URLSearchParams({ source: config.sources[0].id, q: '电影 & 动漫', page: '2' });
  const response = await f.call('/api/catalog?' + query); const result = await response.json();
  assert.equal(f.calls.some(call=>call.url.searchParams.get('wd')==='电影 & 动漫'),true);
  assert.equal(result.page, 2);
  assert.equal(result.list[0].title, '测试影片');
  assert.equal(result.list[0].poster, sample.vod_pic);
});

test('JSON 详情保留多条线路与完整的集数地址', async () => {
  const f = fixture(); const config = await imported(f);
  const response = await f.call('/api/detail?source=' + config.sources[0].id + '&id=42');
  const detail = await response.json();
  assert.equal(detail.lines.length, 2);
  assert.equal(detail.lines[1].episodes[1].url, 'https://media.example/second.m3u8');
  assert.equal(detail.lines[1].episodes[0].direct, true);
  assert.equal(detail.lines[0].episodes[0].direct, false);
  assert.equal(detail.description, '一段简介 & 故事。');
});

test('XML 接口正确解析 CDATA、属性、分类和多集内容', async () => {
  const parsed = parsePayload(xmlSample, 0);
  assert.equal(parsed.list[0].vod_name, '动漫 & 测试');
  assert.equal(parsed.class[0].type_id, '4');
  assert.equal(parsed.pagecount, '3');
  assert.equal(parseLines(parsed.list[0])[0].episodes.length, 2);
  const f = fixture(); const config = await imported(f);
  const response = await f.call('/api/catalog?source=' + config.sources[1].id);
  assert.equal((await response.json()).list[0].id, '7');
  assert.equal(f.calls.at(-1).url.searchParams.get('ac'), 'videolist');
});

test('HLS 代理以重定向后的地址解析子列表，并继续代理分片、密钥和初始化段', async () => {
  const f = fixture(); const config = await imported(f);
  const play = await f.call('/api/play', {
    method: 'POST', body: { source: config.sources[0].id, id: '42', line: 1, episode: 0 }
  });
  const result = await play.json();
  assert.equal(result.format, 'hls');
  const root = await f.call(result.url); const text = await root.text();
  const child = text.split('\n').find(line => line.startsWith('/api/media/'));
  assert.equal(Buffer.from(new URL(origin + child).searchParams.get('u'), 'base64url').toString(),
    'https://cdn.example/redirected/video/playlist.m3u8');
  const playlist = await f.call(child); const body = await playlist.text();
  const uris = [...body.matchAll(/URI="([^"]+)"/g)].map(match => match[1]);
  assert.equal(uris.length, 2);
  for (const uri of [...uris, body.split('\n').find(line => line.startsWith('/api/media/'))]) {
    const response = await f.call(uri);
    assert.equal(response.status, 200);
    await response.body.cancel();
    assert.equal(f.calls.at(-1).options.headers.referer, 'https://source.example/');
  }
});

test('MP4 的 Range 与 206 响应透传，支持拖动进度', async () => {
  const f = fixture();
  const play = await f.call('/api/play', { method: 'POST', body: { url: 'https://media.example/a.mp4' } });
  const response = await f.call((await play.json()).url, { headers: { range: 'bytes=10-12' } });
  assert.equal(response.status, 206);
  assert.equal(response.headers.get('content-range'), 'bytes 10-12/100');
  assert.equal(f.calls.at(-1).options.headers.range, 'bytes=10-12');
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), new Uint8Array([1, 2, 3]));
});

test('流式播放不等待整部视频，客户端取消后取消上游流', async () => {
  let cancelled = false; let pulls = 0;
  const player = new Playback(async () => new Response(new ReadableStream({
    pull(controller) { pulls++; controller.enqueue(new Uint8Array(1024)); },
    cancel() { cancelled = true; }
  }), { headers: { 'content-type': 'video/mp4' } }));
  const play = await player.create('https://media.example/a.mp4');
  const url = new URL(play.url, origin);
  const response = await player.media(url.pathname.split('/').at(-1),
    url.searchParams.get('u'), url.searchParams.get('s'));
  assert.ok(pulls <= 2);
  const reader = response.body.getReader();
  assert.equal((await reader.read()).value.length, 1024);
  await reader.cancel();
  assert.equal(cancelled, true);
});

test('没有扩展名的 HLS 通过媒体类型识别', async () => {
  const player = new Playback(async () => new Response('#EXTM3U',
    { headers: { 'content-type': 'application/vnd.apple.mpegurl' } }));
  assert.equal((await player.create('https://media.example/watch?id=1')).format, 'hls');
});

test('播放地址签名防止任意篡改代理目标', async () => {
  const f = fixture();
  const play = await f.call('/api/play', { method: 'POST', body: { url: 'https://media.example/a.mp4' } });
  const url = new URL((await play.json()).url, origin);
  url.searchParams.set('u', Buffer.from('https://other.example/private').toString('base64url'));
  const response = await f.call(url.pathname + url.search);
  assert.equal(response.status, 403);
  assert.equal(f.calls.length, 0);
});

test('网页播放线路、被拦截的接口、DTD 和跨站请求给出明确错误', async () => {
  const f = fixture();
  const response = await f.call('/api/play', { method: 'POST', body: { url: 'https://media.example/share/1' } });
  assert.equal(response.status, 422);
  assert.throws(() => parsePayload('<html>blocked</html>', 1), /JSON/);
  assert.throws(() => parsePayload('<!DOCTYPE rss><rss/>', 0), /DTD/);
  const denied = await f.call('/api/config', {
    method: 'POST', body: { url: configUrl }, headers: { origin: 'https://other.example' }
  });
  assert.equal(denied.status, 403);
  assert.equal(f.calls.length, 0);
});

test('本机、私网、IPv4 映射 IPv6 和非 HTTP 地址不能成为源目标', async () => {
  for (const ip of ['127.0.0.1', '10.0.0.1', '192.168.1.1', '169.254.169.254',
    '::1', '::ffff:127.0.0.1', '::ffff:7f00:1', 'fc00::1', 'fe80::1'])
    assert.equal(isPublicAddress(ip), false, ip);
  assert.equal(isPublicAddress('8.8.8.8'), true);
  await assert.rejects(remoteFetch('http://127.0.0.1:9/'), /本机或局域网/);
  await assert.rejects(remoteFetch('file:///etc/passwd'), /HTTP/);
});

test('取消 Node 上游流后，迟到的数据和 socket 错误不会写入已关闭的控制器', async () => {
  const source = new PassThrough();
  const reader = toWebStream(source).getReader();
  source.write(Buffer.from('first'));
  assert.equal(Buffer.from((await reader.read()).value).toString(), 'first');
  await reader.cancel();
  assert.equal(source.destroyed, true);
  assert.doesNotThrow(() => {
    source.emit('data', Buffer.from('late'));
    source.emit('error', new Error('late socket error'));
  });
});

test('丢弃重定向或拦截响应时处理上游取消错误，服务继续运行', async () => {
  const source = new PassThrough({
    destroy(_error, callback) { callback(new Error('upstream aborted')); }
  });
  discardStream(source);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(source.destroyed, true);
});
