"""Bounded, sandboxed Spider process. Network requests are brokered by Node."""
import sys
import json
import base64
import types
import re
import threading
import resource
from http.cookies import SimpleCookie
from urllib.parse import urljoin, urlparse
import requests
from requests.structures import CaseInsensitiveDict
from lxml import etree

for limit in (resource.RLIMIT_AS, resource.RLIMIT_DATA):
    try:
        resource.setrlimit(limit, (512 * 1024 * 1024, 512 * 1024 * 1024))
    except (ValueError, OSError):
        pass
resource.setrlimit(resource.RLIMIT_CPU, (90, 90))
resource.setrlimit(resource.RLIMIT_NPROC, (0, 0))
resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
wire_out = sys.stdout
sys.stdout = sys.stderr
wire_lock = threading.RLock()
context = {"proxy": "", "cache": {}}


def send(value):
    wire_out.write(json.dumps(value, ensure_ascii=False) + "\n")
    wire_out.flush()


def network_request(session, method, url, **kwargs):
    request = requests.Request(method, url, headers=kwargs.get("headers"),
                               params=kwargs.get("params"), data=kwargs.get("data"),
                               json=kwargs.get("json"), cookies=kwargs.get("cookies"), auth=kwargs.get("auth"))
    prepared = session.prepare_request(request)
    payload = {"method": prepared.method, "headers": dict(prepared.headers),
               "redirect": kwargs.get("allow_redirects", True)}
    timeout = kwargs.get("timeout", 12)
    payload["timeout"] = min(15000, int((timeout[0] if isinstance(timeout, tuple) else timeout or 12) * 1000))
    if prepared.body is not None:
        if isinstance(prepared.body, bytes):
            payload["bodyBase64"] = base64.b64encode(prepared.body).decode()
        elif isinstance(prepared.body, str):
            payload["body"] = prepared.body
        else:
            raise RuntimeError("插件请求体不受支持")
    with wire_lock:
        send({"type": "request", "url": prepared.url, "options": payload})
        reply = json.loads(sys.stdin.readline())
    if reply.get("error"):
        raise requests.ConnectionError(reply["error"])
    result = reply["result"]
    response = requests.Response()
    response.status_code = result["code"]
    response.url = result["url"]
    response.headers = CaseInsensitiveDict(result["headers"])
    response._content = base64.b64decode(result["base64"])
    response.encoding = requests.utils.get_encoding_from_headers(response.headers) or "utf-8"
    response.request = prepared
    cookies = SimpleCookie()
    try:
        cookies.load(response.headers.get("set-cookie", ""))
        for key, value in cookies.items():
            domain = value["domain"] or urlparse(response.url).hostname
            path = value["path"] or "/"
            session.cookies.set(key, value.value, domain=domain, path=path)
            response.cookies.set(key, value.value, domain=domain, path=path)
    except Exception:
        pass
    return response


requests.sessions.Session.request = network_request


class BaseSpider:
    def init(self, extend=""):
        pass

    def fetch(self, url, headers=None, cookies=None, params=None, timeout=12, **kwargs):
        return requests.get(url, headers=headers, cookies=cookies, params=params, timeout=timeout, **kwargs)

    def post(self, url, headers=None, data=None, json=None, timeout=12, **kwargs):
        return requests.post(url, headers=headers, data=data, json=json, timeout=timeout, **kwargs)

    def html(self, content):
        return etree.HTML(content)

    def getProxyUrl(self, *args):
        return context["proxy"]

    def getCache(self, key):
        return context["cache"].get(str(key))

    def setCache(self, key, value):
        if len(context["cache"]) >= 128:
            context["cache"].pop(next(iter(context["cache"])))
        context["cache"][str(key)] = value

    def delCache(self, key):
        context["cache"].pop(str(key), None)

    def getDependence(self):
        return []

    def homeVideoContent(self):
        return {"list": []}

    def localProxy(self, params):
        raise RuntimeError("插件没有提供代理方法")

    def _proxy_request(self, params):
        url = params.get("url", "")
        if not str(url).startswith("http"):
            try:
                url = base64.b64decode(url).decode()
            except Exception:
                pass
        headers = params.get("__headers") or getattr(self, "header", {})
        return requests.get(url, headers=headers, timeout=12)

    def proxyM3u8(self, params):
        response = self._proxy_request(params)
        response.raise_for_status()
        lines = []
        for line in response.text.splitlines():
            if line.startswith("#"):
                line = re.sub(r'URI="([^"]+)"', lambda m: 'URI="' + urljoin(response.url, m.group(1)) + '"', line)
            elif line.strip():
                line = urljoin(response.url, line.strip())
            lines.append(line)
        return [200, "application/vnd.apple.mpegurl", "\n".join(lines)]

    def proxyMedia(self, params):
        response = self._proxy_request(params)
        response.raise_for_status()
        headers = {key: response.headers[key] for key in ("content-range", "accept-ranges") if key in response.headers}
        return [response.status_code, response.headers.get("content-type", "application/octet-stream"), response.content, headers]

    def proxyTs(self, params):
        return self.proxyMedia(params)

    def destroy(self):
        pass


base_package = types.ModuleType("base")
base_package.__path__ = []
spider_module = types.ModuleType("base.spider")
spider_module.Spider = BaseSpider
sys.modules["base"] = base_package
sys.modules["base.spider"] = spider_module


def serializable(value):
    if isinstance(value, bytes):
        return {"__bytes": base64.b64encode(value).decode()}
    if isinstance(value, requests.Response):
        return {"__bytes": base64.b64encode(value.content).decode()}
    if isinstance(value, (tuple, list)):
        return [serializable(item) for item in value]
    if isinstance(value, dict):
        return {str(key): serializable(item) for key, item in value.items()}
    return value


spider = None
for line in sys.stdin:
    try:
        command = json.loads(line)
        if command["method"] == "__init":
            context["proxy"] = command["proxy"]
            module = types.ModuleType("tv_spider")
            exec(compile(command["code"], "<remote-spider>", "exec"), module.__dict__)
            spider = module.Spider()
            spider.init(command.get("ext", ""))
            result = {"ready": True}
        else:
            method = getattr(spider, command["method"])
            args = command.get("args", [])
            result = method(*args)
        send({"type": "result", "result": serializable(result)})
    except ModuleNotFoundError as error:
        send({"type": "result", "error": "插件缺少模块：" + str(error.name)})
    except Exception as error:
        send({"type": "result", "error": type(error).__name__ + ": " + str(error)[:180]})
