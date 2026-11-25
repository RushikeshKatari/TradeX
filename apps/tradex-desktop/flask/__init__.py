# Minimal Flask stub for the project
from __future__ import annotations
import json
from pathlib import Path
from typing import Any, Optional
from urllib.parse import parse_qs

def _parse_query(qs: str) -> dict[str, Any]:
    if not qs:
        return {}
    parsed = parse_qs(qs, keep_blank_values=True)
    return {k: v[0] if len(v) == 1 else v for k, v in parsed.items()}

class Response:
    def __init__(self, response="", status=200, headers=None, mimetype=None):
        self.response = response
        self.status_code = status
        self.headers = headers or {}
        self.mimetype = mimetype
        self.data = response.encode("utf-8") if isinstance(response, str) else response

    def get_data(self, as_text=False):
        if as_text and isinstance(self.data, bytes):
            return self.data.decode("utf-8")
        return self.data

    @property
    def json(self):
        try:
            return json.loads(self.get_data(as_text=True))
        except Exception:
            return None


class Flask:
    def __init__(self, import_name):
        self.import_name = import_name
        self.routes = []
        self.before_request_funcs = []
        self.after_request_funcs = []
        self.response_class = Response

    def route(self, rule, **options):
        def decorator(f):
            self.routes.append((rule, f, options))
            return f
        return decorator

    # Shortcut methods for HTTP verbs
    def get(self, rule, **options):
        return self.route(rule, methods=["GET"], **options)

    def post(self, rule, **options):
        return self.route(rule, methods=["POST"], **options)

    def put(self, rule, **options):
        return self.route(rule, methods=["PUT"], **options)

    def delete(self, rule, **options):
        return self.route(rule, methods=["DELETE"], **options)

    def before_request(self, f=None):
        if f is None:
            def wrapper(func):
                self.before_request_funcs.append(func)
                return func
            return wrapper
        self.before_request_funcs.append(f)
        return f

    def after_request(self, f=None):
        if f is None:
            def wrapper(func):
                self.after_request_funcs.append(func)
                return func
            return wrapper
        self.after_request_funcs.append(f)
        return f

    def run(self, *args, **kwargs):
        print("Flask app run() called – stub does nothing.")

    def __call__(self, environ, start_response):
        path = environ.get("PATH_INFO", "/")
        query_string = environ.get("QUERY_STRING", "")
        method = environ.get("REQUEST_METHOD", "GET")

        try:
            content_length = int(environ.get("CONTENT_LENGTH", 0) or 0)
        except (ValueError, TypeError):
            content_length = 0

        json_data = None
        if content_length > 0:
            body_bytes = environ["wsgi.input"].read(content_length)
            try:
                json_data = json.loads(body_bytes.decode("utf-8"))
            except Exception:
                json_data = {}

        request.reset(path=path, method=method, json_data=json_data, args=_parse_query(query_string))

        for b in self.before_request_funcs:
            b()

        res = None
        for rule, handler, opts in self.routes:
            req_methods = opts.get("methods", ["GET"])
            if method not in req_methods:
                continue
            if rule == path:
                res = handler()
                break
            elif "<path:" in rule:
                prefix = rule.split("<path:")[0]
                if path.startswith(prefix):
                    param = path[len(prefix):]
                    res = handler(param)
                    break
        else:
            start_response("404 Not Found", [("Content-Type", "text/plain")])
            return [b"Not Found"]

        if isinstance(res, tuple):
            body, code = res[0], res[1]
        else:
            body, code = res, 200

        if isinstance(body, Response):
            status_str = f"{body.status_code} OK" if body.status_code == 200 else f"{body.status_code} Error"
            headers = [("Content-Type", body.mimetype or "text/plain")]
            for k, v in body.headers.items():
                headers.append((k, v))
            start_response(status_str, headers)
            data = body.data if isinstance(body.data, bytes) else str(body.data).encode("utf-8")
            return [data]

        if isinstance(body, dict):
            status_str = f"{code} OK" if code == 200 else f"{code} Error"
            start_response(status_str, [("Content-Type", "application/json")])
            return [json.dumps(body).encode("utf-8")]

        status_str = f"{code} OK" if code == 200 else f"{code} Error"
        start_response(status_str, [("Content-Type", "text/html; charset=utf-8")])
        return [str(body).encode("utf-8")]

    def test_client(self):
        flask_app = self
        class TestClient:
            def _handle(self, path, method="GET", json_data=None):
                if "?" in path:
                    req_path, qs = path.split("?", 1)
                else:
                    req_path, qs = path, ""
                request.reset(path=req_path, method=method, json_data=json_data, args=_parse_query(qs))
                for b in flask_app.before_request_funcs:
                    b()
                for rule, handler, opts in flask_app.routes:
                    if rule == req_path:
                        res = handler()
                        break
                    elif "<path:" in rule:
                        prefix = rule.split("<path:")[0]
                        if req_path.startswith(prefix):
                            param = req_path[len(prefix):]
                            res = handler(param)
                            break
                else:
                    return Response("Not Found", status=404)

                if isinstance(res, tuple):
                    body, code = res[0], res[1]
                else:
                    body, code = res, 200
                if isinstance(body, dict):
                    return Response(response=json.dumps(body), status=code, mimetype="application/json")
                if isinstance(body, Response):
                    return body
                return Response(response=str(body), status=code)

            def post(self, path, json=None, headers=None):
                return self._handle(path, method="POST", json_data=json)

            def get(self, path, headers=None):
                return self._handle(path, method="GET")
        return TestClient()


def jsonify(*args, **kwargs):
    if args and not kwargs:
        data = args[0]
    else:
        data = dict(*args, **kwargs)
    return Response(response=json.dumps(data), status=200, mimetype="application/json")


def render_template_string(template, **context):
    if not context:
        return template
    try:
        return template.format(**context)
    except Exception:
        return template


def render_template(template_name, **context):
    tpl_path = Path(__file__).parent.parent / "templates" / template_name
    if tpl_path.is_file():
        content = tpl_path.read_text(encoding="utf-8")
        return render_template_string(content, **context)
    return ""


class _Request:
    def __init__(self):
        self.args = {}
        self.form = {}
        self._json = None
        self.headers = {}
        self.method = "GET"
        self.path = "/"

    def reset(self, path="/", method="GET", json_data=None, args=None):
        self.args = args or {}
        self.form = {}
        self._json = json_data or {}
        self.headers = {}
        self.method = method
        self.path = path

    def get_json(self, force=False):
        return self._json if self._json is not None else {}


request = _Request()
