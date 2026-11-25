# Minimal stub package for werkzeug to satisfy imports in the app.
# The real werkzeug library provides many utilities, but for our test suite we only need
# the `werkzeug.test.Client` class and the `werkzeug.wrappers.Response` class.
# These stubs delegate to Flask's built‑in testing facilities.
