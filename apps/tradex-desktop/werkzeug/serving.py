"""Serving module providing make_server using Python's standard wsgiref."""
from socketserver import ThreadingMixIn
from wsgiref.simple_server import WSGIServer, WSGIRequestHandler, make_server as _make_server

class ThreadedWSGIServer(ThreadingMixIn, WSGIServer):
    daemon_threads = True
    allow_reuse_address = True

class QuietHandler(WSGIRequestHandler):
    def log_message(self, format, *args):
        # Quiet standard server logging to keep terminal output clean
        pass

def make_server(host, port, app, **options):
    """Return a threaded WSGI server ready to serve requests."""
    server = _make_server(host, port, app, server_class=ThreadedWSGIServer, handler_class=QuietHandler)
    return server
