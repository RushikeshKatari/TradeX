from flask import Flask
from flask.testing import FlaskClient

class Client:
    """Test client wrapper that uses Flask's built-in FlaskClient.
    This avoids recursion caused by calling app.test_client() which may be overridden.
    """
    def __init__(self, app: Flask, *args, **kwargs):
        # Directly instantiate FlaskClient instead of delegating to app.test_client()
        self._client = FlaskClient(app, *args, **kwargs)

    def open(self, *args, **kwargs):
        return self._client.open(*args, **kwargs)

    def get(self, *args, **kwargs):
        return self._client.get(*args, **kwargs)

    def post(self, *args, **kwargs):
        return self._client.post(*args, **kwargs)

    def put(self, *args, **kwargs):
        return self._client.put(*args, **kwargs)

    def delete(self, *args, **kwargs):
        return self._client.delete(*args, **kwargs)

    def __getattr__(self, name):
        return getattr(self._client, name)
